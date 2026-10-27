import { it, expect } from "vitest";
import { aiFixture } from "../../test/ai-fixture";
import { id } from "@album/server-core";
import { materializeAiConfig } from "./materialize";
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "published provider versions retain billing account budgets across credential and connection changes",
  async () => {
    const f = await aiFixture();
    try {
      const release = structuredClone(f.release);
      const connection = release.versions.aiConnection;
      connection.id = id();
      connection.version = 2;
      if (connection.payload.kind !== "aiConnection") throw Error();
      connection.payload.credential = {
        secretRef: "contract-only",
        secretVersion: "v1",
      };
      connection.payload.name = "Another connection";
      await f.database.transaction((tx) =>
        materializeAiConfig(tx, release, "dev", f.registry),
      );
      await f.database.transaction((tx) =>
        materializeAiConfig(tx, release, "dev", f.registry),
      );
      expect(
        (
          await f.pool.query(
            "SELECT count(*) FROM ai_album.ai_billing_accounts",
          )
        ).rows[0].count,
      ).toBe("1");
      expect(
        (
          await f.pool.query(
            "SELECT daily_budget_fen FROM ai_album.ai_billing_accounts",
          )
        ).rows[0].daily_budget_fen,
      ).toBe("100");
      const version = (
        await f.pool.query(
          "SELECT billing_account_id,connection_id FROM ai_album.ai_provider_versions WHERE id=$1",
          [connection.id],
        )
      ).rows[0];
      expect(version.billing_account_id).toBe(f.ids.account);
      expect(version.connection_id).not.toBe(f.ids.connection);
      const routed = structuredClone(release);
      routed.versions.aiRoute.id = id();
      routed.versions.aiRoute.version = 2;
      await f.database.transaction((tx) =>
        materializeAiConfig(tx, routed, "dev", f.registry),
      );
      expect(
        (
          await f.pool.query(
            "SELECT primary_model_version_id,fallback_model_version_id FROM ai_album.ai_route_versions WHERE id=$1",
            [routed.versions.aiRoute.id],
          )
        ).rows[0],
      ).toEqual({
        primary_model_version_id: f.ids.model,
        fallback_model_version_id: null,
      });

      const next = structuredClone(release);
      next.versions.aiConnection.id = id();
      next.versions.aiConnection.version = 3;
      if (next.versions.aiConnection.payload.kind !== "aiConnection")
        throw Error();
      next.versions.aiConnection.payload.name = "New account";
      next.versions.aiConnection.payload.accountBillingId =
        "new-stable-vendor-account";
      await f.database.transaction((tx) =>
        materializeAiConfig(tx, next, "dev", f.registry),
      );
      expect(
        (
          await f.pool.query(
            "SELECT daily_budget_fen FROM ai_album.ai_billing_accounts WHERE account_billing_id='new-stable-vendor-account'",
          )
        ).rows[0].daily_budget_fen,
      ).toBe("0");
    } finally {
      await f.close();
    }
  },
  60000,
);
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "invalid route rolls provider materialization back atomically",
  async () => {
    const f = await aiFixture();
    try {
      const release = structuredClone(f.release);
      release.versions.aiConnection.id = id();
      release.versions.aiConnection.version = 2;
      if (
        release.versions.aiConnection.payload.kind !== "aiConnection" ||
        release.versions.aiRoute.payload.kind !== "aiRoute"
      )
        throw Error();
      release.versions.aiConnection.payload.name = "Must roll back";
      release.versions.aiConnection.payload.credential = {
        secretRef: "contract-only",
        secretVersion: "v1",
      };
      release.versions.aiRoute.id = id();
      release.versions.aiRoute.version = 2;
      release.versions.aiRoute.payload.primaryModelRef = {
        id: "missing-model",
        version: 1,
      };
      await expect(
        f.database.transaction((tx) =>
          materializeAiConfig(tx, release, "dev", f.registry),
        ),
      ).rejects.toThrow("MODEL_UNVERIFIED");
      expect(
        (
          await f.pool.query(
            "SELECT count(*) FROM ai_album.ai_provider_versions WHERE id=$1",
            [release.versions.aiConnection.id],
          )
        ).rows[0].count,
      ).toBe("0");
      expect(
        (
          await f.pool.query(
            "SELECT count(*) FROM ai_album.ai_provider_connections WHERE name='Must roll back'",
          )
        ).rows[0].count,
      ).toBe("0");
    } finally {
      await f.close();
    }
  },
  60000,
);
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "provider publication accepts the public secret metadata binding supported by C4",
  async () => {
    const f = await aiFixture();
    try {
      const release = structuredClone(f.release);
      release.versions.aiConnection.id = id();
      release.versions.aiConnection.version = 2;
      if (release.versions.aiConnection.payload.kind !== "aiConnection")
        throw Error();
      release.versions.aiConnection.payload.credential = {
        secretRef: f.ids.secret,
        secretVersion: "v1",
      };
      await f.database.transaction((tx) =>
        materializeAiConfig(tx, release, "dev", f.registry),
      );
      expect(
        (
          await f.pool.query(
            "SELECT secret_reference_id FROM ai_album.ai_provider_versions WHERE id=$1",
            [release.versions.aiConnection.id],
          )
        ).rows[0].secret_reference_id,
      ).toBe(f.ids.secret);
    } finally {
      await f.close();
    }
  },
  60000,
);
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "activation of an existing version restores state and zero budget disables new submissions",
  async () => {
    const f = await aiFixture();
    try {
      const stopped = structuredClone(f.release);
      stopped.versions.aiConnection.id = id();
      stopped.versions.aiConnection.version = 2;
      if (stopped.versions.aiConnection.payload.kind !== "aiConnection")
        throw Error();
      stopped.versions.aiConnection.payload.name = "Replay";
      stopped.versions.aiConnection.payload.enabled = false;
      await f.database.transaction((tx) =>
        materializeAiConfig(tx, stopped, "dev", f.registry),
      );
      expect(
        (
          await f.pool.query(
            "SELECT state FROM ai_album.ai_provider_connections WHERE id=$1",
            [f.ids.connection],
          )
        ).rows[0].state,
      ).toBe("disabled");
      await f.database.transaction((tx) =>
        materializeAiConfig(tx, f.release, "dev", f.registry),
      );
      expect(
        (
          await f.pool.query(
            "SELECT state FROM ai_album.ai_provider_connections WHERE id=$1",
            [f.ids.connection],
          )
        ).rows[0].state,
      ).toBe("ready");
      const zero = structuredClone(stopped);
      zero.versions.aiConnection.id = id();
      zero.versions.aiConnection.version = 3;
      if (zero.versions.aiConnection.payload.kind !== "aiConnection")
        throw Error();
      zero.versions.aiConnection.payload.enabled = true;
      zero.versions.aiConnection.payload.dailyBudgetFen = 0;
      await f.database.transaction((tx) =>
        materializeAiConfig(tx, zero, "dev", f.registry),
      );
      expect(
        (
          await f.pool.query(
            "SELECT state FROM ai_album.ai_provider_connections WHERE id=$1",
            [f.ids.connection],
          )
        ).rows[0].state,
      ).toBe("disabled");
    } finally {
      await f.close();
    }
  },
  60000,
);
