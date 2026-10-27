import { it, expect } from "vitest";
import { aiFixture } from "../../test/ai-fixture";
import { AiFinanceService } from "./finance";
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "AI budget changes require finance, fresh proof and revision; replay never resets reservations",
  async () => {
    const f = await aiFixture();
    try {
      let proofs = 0;
      const service = new AiFinanceService(
        f.database,
        f.auth,
        {
          verifyFresh: async (_actor: any, proof: string) => {
            if (proof !== "fresh-proof") throw Error("REAUTH_REQUIRED");
            proofs++;
          },
        } as any,
        "dev",
      );
      const page = await service.listBudgets(f.actor, {});
      expect(page.items[0].dailyBudgetFen).toBe(100);
      const input = {
        dailyBudgetFen: 50,
        state: "active" as const,
        reason: "Lower budget",
      };
      await expect(
        service.updateBudget(f.actor, f.ids.account, input, 1, {
          idempotencyKey: "budget-without-proof",
          reauthProof: "",
        }),
      ).rejects.toThrow("REAUTH_REQUIRED");
      const first = await service.updateBudget(
        f.actor,
        f.ids.account,
        input,
        1,
        { idempotencyKey: "budget-once-00000001", reauthProof: "fresh-proof" },
      );
      expect(first.revision).toBe(2);
      expect(
        await service.updateBudget(f.actor, f.ids.account, input, 1, {
          idempotencyKey: "budget-once-00000001",
          reauthProof: "",
        }),
      ).toEqual(first);
      expect(proofs).toBe(1);
      await expect(
        service.updateBudget(f.actor, f.ids.account, input, 1, {
          idempotencyKey: "budget-stale-000001",
          reauthProof: "fresh-proof",
        }),
      ).rejects.toThrow("REVISION_CONFLICT");
      await f.pool.query(
        "UPDATE ai_album.admin_role_assignments SET revoked_at=clock_timestamp() WHERE role='finance'",
      );
      await expect(
        service.updateBudget(f.actor, f.ids.account, input, 1, {
          idempotencyKey: "budget-once-00000001",
          reauthProof: "",
        }),
      ).rejects.toThrow("FORBIDDEN");
    } finally {
      await f.close();
    }
  },
  60000,
);
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "cost rules create immutable named versions with authoritative integer amounts",
  async () => {
    const f = await aiFixture();
    try {
      const service = new AiFinanceService(
        f.database,
        f.auth,
        { verifyFresh: async () => {} } as any,
        "dev",
      );
      const input = {
        name: "基础水墨",
        creditsPerImage: 3,
        estimatedProviderCostFen: 12,
        maxCostFen: 15,
        reason: "Approve pricing",
      };
      const context = {
        idempotencyKey: "price-once-000000001",
        reauthProof: "fresh-proof",
      };
      const first = await service.createCostRule(f.actor, input, context);
      expect(await service.createCostRule(f.actor, input, context)).toEqual(
        first,
      );
      const next = await service.createCostRule(
        f.actor,
        { ...input, creditsPerImage: 4 },
        { ...context, idempotencyKey: "price-version-00002" },
      );
      expect(next.version).toBe(2);
      expect(
        (
          await f.pool.query(
            "SELECT credit_cost FROM ai_album.cost_rule_versions WHERE id=$1",
            [first.id],
          )
        ).rows[0].credit_cost,
      ).toBe("3");
      await expect(
        service.createCostRule(
          f.actor,
          { ...input, estimatedProviderCostFen: 16 },
          { ...context, idempotencyKey: "price-invalid-00001" },
        ),
      ).rejects.toThrow("AI_COST_INVALID");
      const page = await service.listCostRules(f.actor, { limit: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.hasMore).toBe(true);
    } finally {
      await f.close();
    }
  },
  60000,
);
