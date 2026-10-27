import { it, expect } from "vitest";
import { aiFixture } from "../../test/ai-fixture";
import { GenerationService } from "./quotes";
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "quotes hold no credits, acceptance is atomic/idempotent and ten requests share one provider budget",
  async () => {
    const f = await aiFixture();
    try {
      const s = new GenerationService({
        db: f.database,
        workspaces: f.workspaces,
        registry: f.registry,
        loadRelease: async () => f.release,
        environment: "dev",
        allowReplay: true,
      });
      const q = await s.createGenerationQuote(f.actor, f.input);
      expect(q.credits).toBe(1);
      expect(JSON.stringify(q)).not.toContain("estimatedCostFen");
      expect(
        (
          await f.pool.query(
            "SELECT count(*) FROM ai_album.credit_reservations",
          )
        ).rows[0].count,
      ).toBe("0");
      await f.pool.query(
        "UPDATE ai_album.ai_billing_accounts SET daily_budget_fen=10",
      );
      const qs = await Promise.all(
        Array.from({ length: 10 }, () =>
          s.createGenerationQuote(f.actor, f.input),
        ),
      );
      const results = await Promise.allSettled(
        qs.map((quote, i) =>
          s.acceptGenerationQuote(
            f.actor,
            {
              quoteId: quote.id,
              inputHash: quote.inputHash,
              policyConsentVersion: quote.policyVersion,
            },
            "accept-key-" + i,
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (await f.pool.query("SELECT count(*) FROM ai_album.jobs")).rows[0]
          .count,
      ).toBe("1");
      expect(
        (await f.pool.query("SELECT reserved_fen FROM ai_album.budget_days"))
          .rows[0].reserved_fen,
      ).toBe("10");
      const won = results.findIndex((r) => r.status === "fulfilled"),
        again = await s.acceptGenerationQuote(
          f.actor,
          {
            quoteId: qs[won].id,
            inputHash: qs[won].inputHash,
            policyConsentVersion: qs[won].policyVersion,
          },
          "replay-new-key",
        );
      expect(again.jobId).toBe(
        (results[won] as PromiseFulfilledResult<any>).value.jobId,
      );
      await expect(
        s.acceptGenerationQuote(
          f.actor,
          {
            quoteId: q.id,
            inputHash: "0".repeat(64),
            policyConsentVersion: q.policyVersion,
          },
          "changed-hash",
        ),
      ).rejects.toThrow("QUOTE_INPUT_MISMATCH");
    } finally {
      await f.close();
    }
  },
  60000,
);
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "Shanghai midnight retains yesterday reservations and quote expiry rejects new paid work",
  async () => {
    const f = await aiFixture();
    try {
      let at = new Date("2026-10-27T15:59:00Z");
      const s = new GenerationService({
        db: f.database,
        workspaces: f.workspaces,
        registry: f.registry,
        loadRelease: async () => f.release,
        environment: "dev",
        allowReplay: true,
        now: () => at,
      });
      const q = await s.createGenerationQuote(f.actor, f.input);
      await s.acceptGenerationQuote(
        f.actor,
        {
          quoteId: q.id,
          inputHash: q.inputHash,
          policyConsentVersion: q.policyVersion,
        },
        "old-day",
      );
      at = new Date("2026-10-27T16:01:00Z");
      const next = await s.createGenerationQuote(f.actor, f.input);
      await s.acceptGenerationQuote(
        f.actor,
        {
          quoteId: next.id,
          inputHash: next.inputHash,
          policyConsentVersion: next.policyVersion,
        },
        "new-day",
      );
      const days = (
        await f.pool.query(
          "SELECT budget_date::text,reserved_fen FROM ai_album.budget_days ORDER BY budget_date",
        )
      ).rows;
      expect(days).toEqual([
        { budget_date: "2026-10-27", reserved_fen: "10" },
        { budget_date: "2026-10-28", reserved_fen: "10" },
      ]);
      const stale = await s.createGenerationQuote(f.actor, f.input);
      at = new Date(+at + 300001);
      await expect(
        s.acceptGenerationQuote(
          f.actor,
          {
            quoteId: stale.id,
            inputHash: stale.inputHash,
            policyConsentVersion: stale.policyVersion,
          },
          "expired",
        ),
      ).rejects.toThrow("QUOTE_EXPIRED");
    } finally {
      await f.close();
    }
  },
  60000,
);
