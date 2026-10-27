import { it, expect } from "vitest";
import { aiFixture } from "../../test/ai-fixture";
import { ConfigService } from "../config/service";
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "content origin categories are not interpreted as external endpoints",
  async () => {
    const f = await aiFixture();
    try {
      let probes = 0;
      const service = new ConfigService(
        f.database,
        f.auth,
        {
          write: async () => ({ secretRef: "local", secretVersion: "1" }),
          read: async () => Buffer.from("local-test-only"),
          isRevoked: async () => false,
        },
        {
          environment: "dev",
          reauth: { verifyFresh: async () => {} } as any,
          assertEndpoint: async () => {
            probes++;
            throw Error("CONTENT_ENUM_TREATED_AS_URL");
          },
        },
      );
      const draft = await service.createConfigDraft(
        f.actor,
        "content",
        f.release.versions.content.payload,
        1,
      );
      expect(draft.payload.kind).toBe("content");
      expect(probes).toBe(0);
    } finally {
      await f.close();
    }
  },
  60000,
);
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "C4 can publish disabled then enabled AI connection while retaining model references",
  async () => {
    const f = await aiFixture();
    try {
      const { materializeAiConfig } = await import("./materialize");
      const { aiCatalogDependencies } = await import("./dependencies");
      const options: any = {
        environment: "dev",
        reauth: { verifyFresh: async () => {} },
        dependencies: aiCatalogDependencies({
          assertAvailable: async () => {},
        }),
        assertEndpoint: async () => {},
        integrations: {
          aiConnection: {
            test: async () => ({
              state: "passed",
              verifiedChecks: ["dns", "authentication", "contract"],
            }),
          },
        },
        onPublished: (tx: any, release: any) =>
          materializeAiConfig(tx, release, "dev", f.registry),
      };
      const service = new ConfigService(
        f.database,
        f.auth,
        {
          write: async () => ({ secretRef: "local", secretVersion: "1" }),
          read: async () => Buffer.from("local-test-only"),
          isRevoked: async () => false,
        },
        options,
      );
      const original = f.release.versions.aiConnection.payload;
      if (original.kind !== "aiConnection") throw Error();
      const { GenerationService } = await import("./quotes");
      const generation = new GenerationService({
        db: f.database,
        workspaces: f.workspaces,
        registry: f.registry,
        loadRelease: (id) => service.loadRelease(id),
        environment: "dev",
        allowReplay: true,
      });
      const originalQuote = await generation.createGenerationQuote(
        f.actor,
        f.input,
      );
      const disabled = await service.createConfigDraft(
        f.actor,
        "aiConnection",
        { ...original, name: "Replay", enabled: false },
        1,
      );
      const proof = await service.testConfigDraft(
        f.actor,
        disabled.id,
        "schema",
      );
      const stopped = await service.publishConfig(
        f.actor,
        [disabled.id],
        [proof.id],
        "Pause generation",
        f.release.releaseId,
      );
      expect(
        (
          await f.pool.query(
            "SELECT state FROM ai_album.ai_provider_connections WHERE id=$1",
            [f.ids.connection],
          )
        ).rows[0].state,
      ).toBe("disabled");
      const enabled = await service.createConfigDraft(
        f.actor,
        "aiConnection",
        { ...original, name: "Replay", enabled: true, dailyBudgetFen: 10 },
        2,
      );
      const schema = await service.testConfigDraft(
          f.actor,
          enabled.id,
          "schema",
        ),
        connection = await service.testConfigDraft(
          f.actor,
          enabled.id,
          "connection",
        );
      expect(connection.state, JSON.stringify(connection)).toBe("passed");
      const resumed = await service.publishConfig(
        f.actor,
        [enabled.id],
        [schema.id, connection.id],
        "Resume generation",
        stopped.releaseId,
      );
      expect(resumed.releaseId).not.toBe(stopped.releaseId);
      expect(await generation.listPresets(f.actor, f.wid)).toHaveLength(1);
      const quote = await generation.createGenerationQuote(f.actor, f.input);
      expect(quote.modelVersionId).toBe(f.ids.model);
      expect(
        (
          await f.pool.query(
            "SELECT provider_version_id FROM ai_album.generation_quotes WHERE id=$1",
            [quote.id],
          )
        ).rows[0].provider_version_id,
      ).toBe(f.ids.provider);
      const frozen = (
        await f.pool.query(
          "SELECT context_json FROM ai_album.generation_quote_inputs WHERE quote_id=$1",
          [quote.id],
        )
      ).rows[0].context_json;
      expect(frozen.executionProviderVersionId).toBe(
        resumed.versions.aiConnection.id,
      );
      await generation.acceptGenerationQuote(
        f.actor,
        {
          quoteId: quote.id,
          inputHash: quote.inputHash,
          policyConsentVersion: quote.policyVersion,
        },
        "resume-budget-one",
      );
      await expect(
        generation.acceptGenerationQuote(
          f.actor,
          {
            quoteId: originalQuote.id,
            inputHash: originalQuote.inputHash,
            policyConsentVersion: originalQuote.policyVersion,
          },
          "old-quote-lowered-cap",
        ),
      ).rejects.toThrow("PROVIDER_BUDGET_EXHAUSTED");
      const second = await generation.createGenerationQuote(f.actor, f.input);
      await expect(
        generation.acceptGenerationQuote(
          f.actor,
          {
            quoteId: second.id,
            inputHash: second.inputHash,
            policyConsentVersion: second.policyVersion,
          },
          "resume-budget-two",
        ),
      ).rejects.toThrow("PROVIDER_BUDGET_EXHAUSTED");
      const rotatedId = "rotated-" + f.ids.secret;
      await f.pool.query(
        "INSERT INTO ai_album.secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'dev','rotated-contract-only','v2','ai')",
        [rotatedId],
      );
      await f.pool.query(
        "UPDATE ai_album.secret_references SET state='revoked' WHERE id=$1",
        [f.ids.secret],
      );
      const rotated = await service.createConfigDraft(
        f.actor,
        "aiConnection",
        {
          ...original,
          name: "Replay",
          enabled: true,
          credential: { secretRef: rotatedId, secretVersion: "v2" },
        },
        3,
      );
      const rotatedSchema = await service.testConfigDraft(
          f.actor,
          rotated.id,
          "schema",
        ),
        rotatedConnection = await service.testConfigDraft(
          f.actor,
          rotated.id,
          "connection",
        );
      await service.publishConfig(
        f.actor,
        [rotated.id],
        [rotatedSchema.id, rotatedConnection.id],
        "Rotate credentials",
        resumed.releaseId,
      );
      expect(await generation.listPresets(f.actor, f.wid)).toEqual([]);
      expect(
        (
          await f.pool.query(
            "SELECT context_json FROM ai_album.generation_quote_inputs WHERE quote_id=$1",
            [quote.id],
          )
        ).rows[0].context_json,
      ).toEqual(frozen);
      expect(
        (await f.pool.query("SELECT reserved_fen FROM ai_album.budget_days"))
          .rows[0].reserved_fen,
      ).toBe("10");

      expect(
        (
          await f.pool.query(
            "SELECT state FROM ai_album.ai_provider_connections WHERE id=$1",
            [f.ids.connection],
          )
        ).rows[0].state,
      ).toBe("ready");
    } finally {
      await f.close();
    }
  },
  60000,
);
