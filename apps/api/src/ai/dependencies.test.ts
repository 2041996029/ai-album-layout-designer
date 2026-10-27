import { it, expect } from "vitest";
import { aiFixture } from "../../test/ai-fixture";
import { aiCatalogDependencies } from "./dependencies";
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "static dependency approvals cannot bypass model catalog state or environment",
  async () => {
    const f = await aiFixture();
    try {
      const deps = aiCatalogDependencies({ assertAvailable: async () => {} });
      await f.database.transaction(async (tx) => {
        await deps.assertAvailable(
          "aiModel",
          { id: f.ids.model, version: 1 },
          "dev",
          tx,
        );
        await deps.assertAvailable(
          "aiPreset",
          { id: f.ids.preset, version: 1 },
          "dev",
          tx,
        );
      });
      await f.pool.query(
        "UPDATE ai_album.ai_provider_connections SET state='disabled',revision=revision+1",
      );
      await f.database.transaction((tx) =>
        deps.assertAvailable(
          "aiModel",
          { id: f.ids.model, version: 1 },
          "dev",
          tx,
        ),
      );
      await expect(
        f.database.transaction((tx) =>
          deps.assertAvailable(
            "aiModel",
            { id: f.ids.model, version: 1 },
            "prod",
            tx,
          ),
        ),
      ).rejects.toThrow("CONFIG_DEPENDENCY_UNAVAILABLE");
      await expect(
        f.database.transaction((tx) =>
          deps.assertAvailable(
            "aiModel",
            { id: "static-approval-only", version: 1 },
            "dev",
            tx,
          ),
        ),
      ).rejects.toThrow("CONFIG_DEPENDENCY_UNAVAILABLE");
      await f.pool.query(
        "UPDATE ai_album.ai_models SET state='disabled',revision=revision+1",
      );
      await expect(
        f.database.transaction((tx) =>
          deps.assertAvailable(
            "aiModel",
            { id: f.ids.model, version: 1 },
            "dev",
            tx,
          ),
        ),
      ).rejects.toThrow("CONFIG_DEPENDENCY_UNAVAILABLE");
    } finally {
      await f.close();
    }
  },
  60000,
);
