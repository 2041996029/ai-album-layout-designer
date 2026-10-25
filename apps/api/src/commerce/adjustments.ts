import { fail, id, type Actor } from "@album/server-core";
import type { components } from "@album/contracts";
import type { ApiRuntime } from "../http/runtime";
import type { ReauthService } from "../auth/reauthentication";
import { audit, requireRoles } from "../config/secrets";
import { payloadHash, type RequestContext } from "../config/types";
import {
  lockCreditAccount,
  creditLedgerLine,
  syncCreditAccount,
  sourceCreditFrozenSql,
} from "./credits";
/** Adjustments reference an existing immutable source; never invent purchases or redemption codes. */
export async function adjustFinancial(
  runtime: ApiRuntime,
  reauth: ReauthService,
  actor: Actor,
  wid: string,
  input: components["schemas"]["FinancialAdjustmentCreate"],
  request: RequestContext,
): Promise<components["schemas"]["FinancialAdjustment"]> {
  if (!input.reason.trim() || !input.ticketId.trim())
    fail("REASON_REQUIRED", 422);
  if (
    (input.kind === "credits" &&
      (!Number.isSafeInteger(input.creditDelta) ||
        !input.creditDelta ||
        input.durationDays !== undefined)) ||
    (input.kind === "membership" &&
      (!Number.isSafeInteger(input.durationDays) ||
        !input.durationDays ||
        input.creditDelta !== undefined))
  )
    fail("INVALID_ADJUSTMENT", 422);
  if (!request.idempotencyKey) fail("IDEMPOTENCY_KEY_REQUIRED", 428);
  const hash = payloadHash({ actor: actor.userId, wid, input });
  return runtime.db.transaction(async (tx) => {
    await requireRoles(tx, runtime.auth, actor, ["finance"]);
    await lockCreditAccount(tx, wid);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `workspace:${wid}:${request.idempotencyKey}`,
    ]);
    const prior = (
      await tx.query(
        "SELECT * FROM financial_adjustments WHERE workspace_id=$1 AND operation_key=$2",
        [wid, request.idempotencyKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) fail("IDEMPOTENCY_CONFLICT", 409);
      return prior.facts.response;
    }
    const occupied = (
      await tx.query(
        "SELECT 1 FROM idempotency_keys WHERE workspace_id=$1 AND principal_scope='workspace' AND idempotency_key=$2",
        [wid, request.idempotencyKey],
      )
    ).rowCount;
    if (occupied) fail("IDEMPOTENCY_CONFLICT", 409);
    await reauth.verifyFresh(
      actor,
      request.reauthProof ?? "",
      "admin_operations",
      tx,
    );
    const source = (
      await tx.query(
        `SELECT g.*,${sourceCreditFrozenSql()} AS frozen FROM entitlement_grants g WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
        [wid, input.sourceGrantId],
      )
    ).rows[0];
    if (
      !source ||
      source.state !== "active" ||
      source.frozen ||
      source.grant_type !== input.kind ||
      new Date(source.ends_at) <= new Date()
    )
      fail("ADJUSTMENT_SOURCE_INELIGIBLE", 409);
    const adjustmentId = id(),
      grantId = id(),
      now = new Date();
    const response: components["schemas"]["FinancialAdjustment"] = {
      id: adjustmentId,
      workspaceId: wid,
      sourceGrantId: source.id,
      kind: input.kind,
      createdAt: now.toISOString(),
      ...(input.kind === "membership" || input.creditDelta! > 0
        ? { grantId }
        : {}),
    };
    const before = { sourceGrantId: source.id, endsAt: date(source.ends_at) },
      after = {
        creditDelta: input.creditDelta ?? null,
        durationDays: input.durationDays ?? null,
        grantId: response.grantId ?? null,
      };
    await tx.query(
      "INSERT INTO financial_adjustments(id,workspace_id,source_grant_id,actor_user_id,operation_key,request_hash,kind,reason,ticket_id,facts,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        adjustmentId,
        wid,
        source.id,
        actor.userId,
        request.idempotencyKey,
        hash,
        input.kind,
        input.reason,
        input.ticketId,
        { before, after, response },
        now,
      ],
    );
    if (input.kind === "credits" && input.creditDelta! < 0) {
      const lot = (
          await tx.query(
            "SELECT * FROM credit_lots WHERE workspace_id=$1 AND source_grant_id=$2 FOR UPDATE",
            [wid, source.id],
          )
        ).rows[0],
        amount = -input.creditDelta!;
      if (!lot || Number(lot.available) < amount)
        fail("ADJUSTMENT_INSUFFICIENT_AVAILABLE", 409);
      await tx.query(
        "UPDATE credit_lots SET available=available-$3,revoked=revoked+$3,revision=revision+1 WHERE workspace_id=$1 AND id=$2",
        [wid, lot.id, amount],
      );
      await creditLedgerLine(tx, {
        wid,
        lotId: lot.id,
        groupId: adjustmentId,
        line: 1,
        type: "revoke",
        amount,
        from: "available",
        to: "revoked",
        balanceAfter: Number(lot.available) - amount,
        reason: "financial_adjustment",
      });
    } else {
      let starts = now,
        ends = new Date(source.ends_at),
        features = source.features;
      if (input.kind === "membership") {
        const rows = (
          await tx.query(
            "SELECT features,ends_at FROM entitlement_grants WHERE workspace_id=$1 AND grant_type='membership' AND state='active' AND ends_at>now()",
            [wid],
          )
        ).rows;
        if (rows.some((g) => g.features.tierKey !== features.tierKey))
          fail("MEMBERSHIP_TIER_CONFLICT", 409);
        starts = new Date(
          Math.max(+now, ...rows.map((g) => +new Date(g.ends_at))),
        );
        ends = new Date(+starts + input.durationDays! * 86400000);
      } else features = { ...features, creditGrant: input.creditDelta };
      await tx.query(
        "INSERT INTO entitlement_grants(id,workspace_id,source_adjustment_id,grant_type,starts_at,ends_at,features) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [grantId, wid, adjustmentId, input.kind, starts, ends, features],
      );
      if (input.kind === "credits") {
        const lotId = id();
        await tx.query(
          "INSERT INTO credit_lots(id,workspace_id,source_grant_id,granted,available,expires_at) VALUES($1,$2,$3,$4,$4,$5)",
          [lotId, wid, grantId, input.creditDelta, ends],
        );
        await creditLedgerLine(tx, {
          wid,
          lotId,
          groupId: adjustmentId,
          line: 1,
          type: "grant",
          amount: input.creditDelta!,
          from: "external",
          to: "available",
          balanceAfter: input.creditDelta!,
          reason: "financial_adjustment",
        });
      }
    }
    await syncCreditAccount(tx, wid, now);
    await audit(
      tx,
      actor,
      request,
      "commerce.financial_adjustment",
      "financial_adjustment",
      adjustmentId,
      input.reason,
      { ticketId: input.ticketId, before, after },
    );
    await tx.query(
      "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,expires_at) VALUES($1,$2,'workspace',$3,$4,'financial.adjustment','completed',201,$5,now()+interval '7 days')",
      [id(), wid, request.idempotencyKey, hash, response],
    );
    return response;
  });
}
const date = (v: unknown) => new Date(v as string).toISOString();
