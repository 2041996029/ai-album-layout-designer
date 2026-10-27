import { fail, id, digest } from "@album/server-core";
import type { PoolClient } from "pg";
export const shanghaiBudgetDate = (at: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
export async function reserveProviderBudget(
  tx: PoolClient,
  accountBillingId: string,
  providerVersionId: string,
  estimatedCostFen: number,
  jobId: string,
  at: string,
) {
  if (!Number.isSafeInteger(estimatedCostFen) || estimatedCostFen < 0)
    fail("AI_COST_INVALID", 422);
  const old = (
    await tx.query("SELECT * FROM budget_reservations WHERE job_id=$1", [jobId])
  ).rows[0];
  if (old) {
    if (Number(old.reserved_fen) !== estimatedCostFen)
      fail("BUDGET_RESERVATION_MISMATCH", 409);
    return old;
  }
  const c = (
    await tx.query(
      "SELECT p.*,b.account_billing_id,b.daily_budget_fen AS account_limit,b.state AS account_state,c.state AS connection_state FROM ai_provider_versions p JOIN ai_billing_accounts b ON b.id=p.billing_account_id JOIN ai_provider_connections c ON c.id=p.connection_id WHERE p.id=$1 AND b.account_billing_id=$2",
      [providerVersionId, accountBillingId],
    )
  ).rows[0];
  if (!c || c.account_state !== "active" || c.connection_state !== "ready")
    fail("AI_CONNECTION_UNAVAILABLE", 503);
  const day = shanghaiBudgetDate(at);
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "ai-budget:" + c.environment + ":" + c.billing_account_id + ":" + day,
  ]);
  const b = (
    await tx.query(
      "INSERT INTO budget_days(id,billing_account_id,budget_date,limit_fen) VALUES($1,$2,$3,$4) ON CONFLICT(billing_account_id,budget_date) DO UPDATE SET limit_fen=excluded.limit_fen RETURNING *",
      [id(), c.billing_account_id, day, c.account_limit],
    )
  ).rows[0];
  const p = (
    await tx.query(
      "INSERT INTO provider_budget_days(id,connection_id,billing_account_id,budget_day_id,limit_fen) VALUES($1,$2,$3,$4,$5) ON CONFLICT(connection_id,budget_day_id) DO UPDATE SET limit_fen=excluded.limit_fen RETURNING *",
      [id(), c.connection_id, c.billing_account_id, b.id, c.daily_budget_fen],
    )
  ).rows[0];
  if (
    Number(b.reserved_fen) + Number(b.spent_fen) + estimatedCostFen >
      Number(b.limit_fen) ||
    Number(p.reserved_fen) + Number(p.spent_fen) + estimatedCostFen >
      Number(p.limit_fen)
  )
    fail("PROVIDER_BUDGET_EXHAUSTED", 409);
  const j = (
    await tx.query(
      "SELECT workspace_id,quote_id FROM jobs WHERE id=$1 FOR UPDATE",
      [jobId],
    )
  ).rows[0];
  if (!j?.quote_id) fail("BUDGET_QUOTED_JOB_REQUIRED", 409);
  const r = (
    await tx.query(
      "INSERT INTO budget_reservations(id,workspace_id,job_id,quote_id,billing_account_id,connection_id,provider_version_id,budget_day_id,provider_budget_day_id,reserved_fen,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp()+interval '30 minutes') RETURNING *",
      [
        id(),
        j.workspace_id,
        jobId,
        j.quote_id,
        c.billing_account_id,
        c.connection_id,
        c.id,
        b.id,
        p.id,
        estimatedCostFen,
      ],
    )
  ).rows[0];
  await tx.query(
    "UPDATE budget_days SET reserved_fen=reserved_fen+$2,revision=revision+1 WHERE id=$1",
    [b.id, estimatedCostFen],
  );
  await tx.query(
    "UPDATE provider_budget_days SET reserved_fen=reserved_fen+$2,revision=revision+1 WHERE id=$1",
    [p.id, estimatedCostFen],
  );
  await tx.query(
    "INSERT INTO provider_cost_ledger(id,billing_account_id,budget_day_id,reservation_id,operation_id,entry_type,amount_fen,reason_code) VALUES($1,$2,$3,$4,$5,'reserve',$6,'generation_acceptance')",
    [
      id(),
      c.billing_account_id,
      b.id,
      r.id,
      digest(r.id + ":reserve"),
      estimatedCostFen,
    ],
  );
  return r;
}
export async function closeProviderBudget(
  tx: PoolClient,
  reservationId: string,
  actualCostFen: number,
  state: "settled" | "released",
) {
  if (!Number.isSafeInteger(actualCostFen) || actualCostFen < 0)
    fail("AI_COST_INVALID", 422);
  const r = (
    await tx.query("SELECT * FROM budget_reservations WHERE id=$1 FOR UPDATE", [
      reservationId,
    ])
  ).rows[0];
  if (!r) fail("BUDGET_RESERVATION_MISSING", 409);
  if (r.state !== "held") return;
  await tx.query("SELECT id FROM budget_days WHERE id=$1 FOR UPDATE", [
    r.budget_day_id,
  ]);
  const cost = state === "settled" ? actualCostFen : 0;
  await tx.query(
    "UPDATE budget_days SET reserved_fen=reserved_fen-$2,spent_fen=spent_fen+$3,revision=revision+1 WHERE id=$1",
    [r.budget_day_id, r.reserved_fen, cost],
  );
  await tx.query(
    "UPDATE provider_budget_days SET reserved_fen=reserved_fen-$2,spent_fen=spent_fen+$3,revision=revision+1 WHERE id=$1",
    [r.provider_budget_day_id, r.reserved_fen, cost],
  );
  await tx.query(
    "UPDATE budget_reservations SET state=$2,actual_fen=$3,settled_at=clock_timestamp(),revision=revision+1 WHERE id=$1",
    [r.id, state, cost],
  );
  await tx.query(
    "INSERT INTO provider_cost_ledger(id,billing_account_id,budget_day_id,reservation_id,operation_id,entry_type,amount_fen,reason_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id(),
      r.billing_account_id,
      r.budget_day_id,
      r.id,
      digest(r.id + ":terminal"),
      state === "settled" ? "settle" : "release",
      state === "settled" ? cost : Number(r.reserved_fen),
      cost > Number(r.reserved_fen)
        ? "provider_overrun_platform_absorbed"
        : "generation_terminal",
    ],
  );
}
