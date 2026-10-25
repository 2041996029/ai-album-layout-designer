import { fail, id } from "@album/server-core";
import type { PoolClient } from "pg";
import type { PublishedSkuMaterializationPort } from "../payments/types";
import { frozenOrderSnapshot } from "../payments/orders";
import { canonical, validateConfigPayload } from "../config/types";
import {
  creditLedgerLine,
  lockCreditAccount,
  syncCreditAccount,
} from "./credits";

/** Tier identity uses actual entitlement features. Monthly/yearly/price/bonus
 * variants can differ while granting exactly the same tier. */
export const membershipTierKey = (features: unknown) => canonical(features);
/** Bind in the config publication transaction. Only a release's exact typed SKU
 * can materialize billing facts. ConfigVersion.id is the immutable SKU row ID. */
export class PublishedSkuMaterializer implements PublishedSkuMaterializationPort {
  async materialize(
    tx: PoolClient,
    input: Parameters<PublishedSkuMaterializationPort["materialize"]>[1],
  ): Promise<{ skuVersionId: string }> {
    const { releaseId, skuConfigVersionId, sku, refundPolicy } = input;
    validateConfigPayload("sku", sku);
    if (!sku.enabled) fail("SKU_UNPUBLISHED", 409);
    const published = (
      await tx.query(
        "SELECT i.body,r.manifest FROM config_releases r JOIN config_release_items i ON i.release_id=r.id AND i.namespace='sku' WHERE r.id=$1",
        [releaseId],
      )
    ).rows[0];
    if (
      !published ||
      published.manifest?.versions?.sku?.id !== skuConfigVersionId ||
      canonical(published.body) !== canonical(sku)
    )
      fail("SKU_UNPUBLISHED", 409);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "album.sku:" + sku.skuId,
    ]);
    const existing = (
      await tx.query("SELECT * FROM sku_versions WHERE id=$1", [
        skuConfigVersionId,
      ])
    ).rows[0];
    if (existing) {
      if (
        existing.sku_id !== sku.skuId ||
        existing.currency !== sku.currency ||
        Number(existing.price_fen) !== sku.priceFen ||
        existing.duration_days !== sku.durationDays ||
        Number(existing.credit_grant) !== sku.credits ||
        canonical(existing.features.publishedSku) !== canonical(sku) ||
        existing.features.skuConfigVersionId !== skuConfigVersionId ||
        canonical(existing.features.refundPolicy) !== canonical(refundPolicy)
      )
        fail("SKU_VERSION_IMMUTABLE", 409);
      // Reuse across releases retains the first publication provenance.
      return { skuVersionId: existing.id };
    }
    await tx.query(
      "INSERT INTO billing_skus(id,code,name,state) VALUES($1::text,$1::text,$2,'active') ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,state='active',revision=billing_skus.revision+1",
      [sku.skuId, sku.name],
    );
    await tx.query("SELECT id FROM billing_skus WHERE id=$1 FOR UPDATE", [
      sku.skuId,
    ]);
    const version = Number(
      (
        await tx.query(
          "SELECT coalesce(max(version),0)+1 AS next FROM sku_versions WHERE sku_id=$1",
          [sku.skuId],
        )
      ).rows[0].next,
    );
    await tx.query(
      "INSERT INTO sku_versions(id,sku_id,version,currency,price_fen,duration_days,credit_grant,features) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        skuConfigVersionId,
        sku.skuId,
        version,
        sku.currency,
        sku.priceFen,
        sku.durationDays,
        sku.credits,
        { publishedSku: sku, skuConfigVersionId, releaseId, refundPolicy },
      ],
    );
    return { skuVersionId: skuConfigVersionId };
  }
}
/** Concrete publication dependency for Task8; no pricing defaults. */
export const actualPublishedSkuMaterializer = new PublishedSkuMaterializer();

export class OrderFulfillment {
  constructor(readonly now: () => Date = () => new Date()) {}
  /** PaymentConfirmation supplies this exact transaction; no nested commit. */
  readonly fulfillOrder = async (
    tx: PoolClient,
    orderId: string,
  ): Promise<void> => {
    const order = (
      await tx.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [orderId])
    ).rows[0];
    if (
      !order ||
      order.state !== "paid" ||
      !["unfulfilled", "fulfilled"].includes(order.fulfillment_state)
    )
      fail("ORDER_NOT_FULFILLABLE", 409);
    const snapshot = await frozenOrderSnapshot(tx, orderId, order.workspace_id),
      sku = snapshot.sku,
      wid = order.workspace_id,
      at = this.now();
    validateConfigPayload("sku", sku);
    // Eligibility is determined by captured facts, never current SKU/config state.
    if (
      order.sku_version_id !== snapshot.skuVersionId ||
      Number(order.amount_fen) !== sku.priceFen ||
      order.currency !== sku.currency
    )
      fail("ORDER_SNAPSHOT_MISMATCH", 409);
    await lockCreditAccount(tx, wid);
    const grants = (
      await tx.query(
        "SELECT * FROM entitlement_grants WHERE workspace_id=$1 AND source_order_id=$2",
        [wid, orderId],
      )
    ).rows;
    if (grants.length) return; // all effects are atomic, including the source-unique lots
    if (sku.skuKind === "membership") {
      const key = membershipTierKey(sku.features),
        active = (
          await tx.query(
            "SELECT * FROM entitlement_grants WHERE workspace_id=$1 AND grant_type='membership' AND state='active' AND ends_at>$2 ORDER BY ends_at,id",
            [wid, at],
          )
        ).rows;
      if (active.some((g) => g.features.tierKey !== key)) {
        // Admission cannot prevent two already captured orders racing. Preserve
        // their paid receipts in the caller's transaction for audited resolution.
        await tx.query(
          "UPDATE orders SET fulfillment_state='manual_review',revision=revision+1 WHERE workspace_id=$1 AND id=$2",
          [wid, orderId],
        );
        await tx.query(
          "INSERT INTO audit_events(id,workspace_id,action,target_kind,target_id,request_id,reason,redacted_details) VALUES($1,$2,'commerce.fulfillment_manual_review','order',$3,$4,'Captured membership conflicts with existing tier',$5)",
          [
            id(),
            wid,
            orderId,
            id(),
            {
              reasonCode: "CROSS_TIER_MEMBERSHIP_DISABLED",
              fulfillmentState: "manual_review",
            },
          ],
        );
        return;
      }
      if (!sku.durationDays) fail("MEMBERSHIP_DURATION_INVALID", 409);
      const starts = new Date(Math.max(+at, ...active.map((g) => +g.ends_at))),
        ends = new Date(+starts + sku.durationDays * 86400000),
        grantId = id();
      await tx.query(
        "INSERT INTO entitlement_grants(id,created_at,workspace_id,source_order_id,grant_type,starts_at,ends_at,features) VALUES($1,$2,$3,$4,'membership',$5,$6,$7)",
        [
          grantId,
          at,
          wid,
          orderId,
          starts,
          ends,
          {
            skuId: sku.skuId,
            skuVersionId: snapshot.skuVersionId,
            tierKey: key,
            entitlements: sku.features,
          },
        ],
      );
      await tx.query(
        "INSERT INTO subscriptions(id,created_at,workspace_id,entitlement_grant_id,source_order_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id(), at, wid, grantId, orderId, starts, ends],
      );
    }
    if (sku.credits > 0) {
      if (!sku.creditValidityDays) fail("CREDIT_VALIDITY_INVALID", 409);
      const expires = new Date(+at + sku.creditValidityDays * 86400000),
        grantId = id(),
        lotId = id();
      await tx.query(
        "INSERT INTO entitlement_grants(id,created_at,workspace_id,source_order_id,grant_type,starts_at,ends_at,features) VALUES($1,$2,$3,$4,'credits',$2,$5,$6)",
        [
          grantId,
          at,
          wid,
          orderId,
          expires,
          {
            skuId: sku.skuId,
            skuVersionId: snapshot.skuVersionId,
            creditGrant: sku.credits,
          },
        ],
      );
      await tx.query(
        "INSERT INTO credit_lots(id,created_at,workspace_id,source_grant_id,granted,available,expires_at) VALUES($1,$2,$3,$4,$5,$5,$6)",
        [lotId, at, wid, grantId, sku.credits, expires],
      );
      await creditLedgerLine(tx, {
        wid,
        lotId,
        groupId: orderId,
        line: 1,
        type: "grant",
        amount: sku.credits,
        from: "external",
        to: "available",
        balanceAfter: sku.credits,
        reason: "frozen_order_fulfillment",
      });
    }
    await syncCreditAccount(tx, wid, at);
  };
}
