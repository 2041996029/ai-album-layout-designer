import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { id, digest, fail } from "@album/server-core";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { ReauthService } from "../auth/reauthentication";
import { bindCommerceRuntime } from "../commerce/runtime";
import { createApplication } from "../app.module";
import type { ApiRuntime } from "./runtime";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "Task8 reviewed auxiliary routes",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      app: any,
      runtime: ApiRuntime,
      session: any,
      wid: string,
      rid: string;
    const call = (
      method: string,
      url: string,
      payload?: unknown,
      headers: Record<string, string> = {},
    ) =>
      app.inject({
        method,
        url,
        payload,
        headers: {
          cookie: `album_session=${session.accessToken}`,
          origin: "https://album.test",
          "x-csrf-token": session.csrfToken,
          "x-workspace-id": wid,
          "idempotency-key": id(),
          ...headers,
        },
      });
    const deliveries = new Map<
      string,
      {
        code: string;
        userId: string;
        sessionId: string;
        purpose: string;
        used: boolean;
      }
    >();
    const human = {
      start: async ({ actor, purpose, challengeId }: any) => {
        deliveries.set(challengeId, {
          code: String(100000 + Math.floor(Math.random() * 900000)),
          userId: actor.userId,
          sessionId: actor.sessionId,
          purpose,
          used: false,
        });
        return { destinationHint: "手机尾号1234" };
      },
      complete: async ({ actor, purpose, challengeId, code }: any) => {
        const c = deliveries.get(challengeId);
        if (
          !c ||
          c.used ||
          c.userId !== actor.userId ||
          c.sessionId !== actor.sessionId ||
          c.purpose !== purpose ||
          c.code !== code
        )
          fail("REAUTH_INVALID_CODE", 401);
        c.used = true;
        return {
          provider: "sms" as const,
          appId: "review-sms",
          subject: "phone-" + actor.userId,
          unionId: null,
          openPlatformId: null,
        };
      },
    };
    async function proof(purpose: string) {
      const start = await call("POST", "/v1/auth/reauthentication/challenges", {
        purpose,
      });
      expect(start.statusCode, start.body).toBe(200);
      const challenge = start.json().data,
        code = deliveries.get(challenge.id)!.code;
      const verified = await call("POST", "/v1/auth/reauthenticate", {
        purpose,
        proof: {
          provider: "phone",
          challengeId: challenge.id,
          proof: code,
          purpose,
        },
      });
      expect(verified.statusCode, verified.body).toBe(200);
      return verified.json().data.reauthProof;
    }
    async function job(manifest: unknown = {}) {
      const jid = id(),
        snapshot = id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO job_snapshots(id,workspace_id,kind,config_release_id,schema_version,normalized_spec_hash,manifest_hash,manifest,entitlement_snapshot,warnings_acknowledged) VALUES($1,$2,'layout',$3,1,$4,$4,$5,'{}','[]')",
          [snapshot, wid, rid, digest(JSON.stringify(manifest)), manifest],
        );
        await tx.query(
          "INSERT INTO jobs(id,workspace_id,kind,snapshot_id,created_by) VALUES($1,$2,'layout',$3,$4)",
          [jid, wid, snapshot, session.actor.userId],
        );
      });
      return jid;
    }
    beforeAll(async () => {
      db = await testDatabase();
      const auth = new AuthService(db.database, {
          secret: "review-test-secret-".repeat(3),
          environment: "dev",
        }),
        login = await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "review",
              subject: "ops",
              unionId: null,
              openPlatformId: null,
            }),
          },
          id(),
          "mini",
        );
      session = await auth.createWebSession(login.actor);
      const workspaces = new WorkspaceService(db.database, auth);
      wid = (await workspaces.createWorkspace(session.actor, "personal", id()))
        .workspaceId;
      runtime = {
        db: db.database,
        auth,
        workspaces,
        environment: "dev",
        allowedOrigin: "https://album.test",
      };
      await db.database.transaction((tx) =>
        tx.query(
          "INSERT INTO admin_role_assignments(id,user_id,role) VALUES($1,$2,'platform_ops')",
          [id(), session.actor.userId],
        ),
      );
      await db.database.transaction((tx) =>
        tx.query(
          "INSERT INTO auth_identities(id,user_id,provider,app_id,subject_digest,verified_at) VALUES($1,$2,'phone','review-sms',$3,now())",
          [
            id(),
            session.actor.userId,
            auth.hash("phone-" + session.actor.userId),
          ],
        ),
      );
      await bindCommerceRuntime(
        runtime,
        new ReauthService(db.database, auth, {}, human),
      );
      rid = id();
      await db.database.transaction((tx) =>
        tx.query(
          "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',1,1,$2,'{}',$3)",
          [rid, digest("review"), session.actor.userId],
        ),
      );
      app = await createApplication(runtime);
    });
    afterAll(async () => {
      await app?.close();
      await db?.close();
    });
    it("publishes and rolls back through real authentication with stable HTTP replay and live role checks", async () => {
      expect(
        (await runtime.auth.authenticate(session.accessToken, "web"))
          .platformPermissions,
      ).toEqual([]);
      const config = runtime.commerce!.config;
      const payload = {
        kind: "share",
        defaultPrivate: true,
        sharingEnabled: true,
        maxShareTtlSeconds: 3600,
        downloadTtlSeconds: 60,
        revokeMode: "shortLivedUrl",
        allowOriginalDownload: false,
      } as const;
      async function publish(sharingEnabled: boolean) {
        let base: number | null = null;
        try {
          base = (await config.loadRelease()).versions.share.version;
        } catch {}
        const draft = await config.createConfigDraft(
          session.actor,
          "share",
          { ...payload, sharingEnabled },
          base,
        );
        const test = await config.testConfigDraft(
          session.actor,
          draft.id,
          "schema",
        );
        const headers = {
          "idempotency-key": id(),
          "if-match": `"${draft.revision}"`,
          "x-reauthentication-proof": await proof("admin_publish"),
        };
        const body = {
          configHash: draft.payloadHash,
          testIds: [test.id],
          reason: "release review",
        };
        const url = `/v1/admin/config/drafts/${draft.id}/publish`;
        const first = await call("POST", url, body, headers);
        expect(first.statusCode, first.body).toBe(200);
        return { draft, test, url, headers, body, result: first.json().data };
      }
      const first = await publish(true);
      expect(
        (await call("POST", first.url, first.body, first.headers)).json().data,
      ).toEqual(first.result);
      const second = await publish(false);
      expect(
        (await call("POST", first.url, first.body, first.headers)).json().data,
      ).toEqual(first.result);
      expect(
        (
          await call(
            "POST",
            first.url,
            { ...first.body, reason: "changed" },
            first.headers,
          )
        ).statusCode,
      ).toBe(409);
      const rollbackHeaders = {
        "idempotency-key": id(),
        "x-reauthentication-proof": await proof("admin_publish"),
      };
      const rollbackBody = {
        sourceReleaseId: first.result.id,
        testIds: [first.test.id],
        reason: "restore",
      };
      const rollback = await call(
        "POST",
        "/v1/admin/config/rollback",
        rollbackBody,
        rollbackHeaders,
      );
      expect(rollback.statusCode, rollback.body).toBe(200);
      expect(
        (
          await call(
            "POST",
            "/v1/admin/config/rollback",
            rollbackBody,
            rollbackHeaders,
          )
        ).json().data,
      ).toEqual(rollback.json().data);
      await publish(true);
      expect(
        (
          await call(
            "POST",
            "/v1/admin/config/rollback",
            rollbackBody,
            rollbackHeaders,
          )
        ).json().data,
      ).toEqual(rollback.json().data);
      const count = (
        await db.pool.query("SELECT count(*) FROM ai_album.config_releases")
      ).rows[0].count;
      await db.database.transaction((tx) =>
        tx.query(
          "UPDATE admin_role_assignments SET role='finance' WHERE user_id=$1",
          [session.actor.userId],
        ),
      );
      try {
        expect(
          (await call("POST", first.url, first.body, first.headers)).statusCode,
        ).toBe(403);
        expect(
          (
            await call(
              "POST",
              "/v1/admin/config/rollback",
              rollbackBody,
              rollbackHeaders,
            )
          ).statusCode,
        ).toBe(403);
      } finally {
        await db.database.transaction((tx) =>
          tx.query(
            "UPDATE admin_role_assignments SET role='platform_ops' WHERE user_id=$1",
            [session.actor.userId],
          ),
        );
      }
      await db.database.transaction((tx) =>
        tx.query(
          "UPDATE admin_role_assignments SET revoked_at=clock_timestamp() WHERE user_id=$1",
          [session.actor.userId],
        ),
      );
      try {
        expect(
          (await call("POST", second.url, second.body, second.headers))
            .statusCode,
        ).toBe(403);
      } finally {
        await db.database.transaction((tx) =>
          tx.query(
            "UPDATE admin_role_assignments SET revoked_at=NULL WHERE user_id=$1",
            [session.actor.userId],
          ),
        );
      }
      expect(
        (await db.pool.query("SELECT count(*) FROM ai_album.config_releases"))
          .rows[0].count,
      ).toBe(count);
    });
    it("binds human challenges to session, purpose, linked identity, expiry and one use", async () => {
      const availability = await call("GET", "/v1/auth/reauthentication");
      expect(availability.json().data).toMatchObject({
        state: "available",
        method: "sms",
      });
      const start = await call("POST", "/v1/auth/reauthentication/challenges", {
          purpose: "billing_refund",
        }),
        c = start.json().data,
        code = deliveries.get(c.id)!.code;
      expect(c).not.toHaveProperty("reauthProof");
      expect(c).not.toHaveProperty("proof");
      const body = {
        purpose: "billing_refund",
        proof: {
          provider: "phone",
          challengeId: c.id,
          proof: code,
          purpose: "billing_refund",
        },
      };
      const wrongPurpose = await call("POST", "/v1/auth/reauthenticate", {
        purpose: "admin_operations",
        proof: { ...body.proof, purpose: "admin_operations" },
      });
      expect(wrongPurpose.statusCode, wrongPurpose.body).toBe(403);
      expect(deliveries.get(c.id)!.used).toBe(false);
      const second = await runtime.auth.createWebSession(session.actor),
        cross = await call("POST", "/v1/auth/reauthenticate", body, {
          cookie: `album_session=${second.accessToken}`,
          "x-csrf-token": second.csrfToken,
        });
      expect(cross.statusCode, cross.body).toBe(403);
      expect(deliveries.get(c.id)!.used).toBe(false);
      const wrongCode = await call("POST", "/v1/auth/reauthenticate", {
        ...body,
        proof: {
          ...body.proof,
          proof: code === "000000" ? "111111" : "000000",
        },
      });
      expect(wrongCode.statusCode, wrongCode.body).toBe(401);
      const verified = await call("POST", "/v1/auth/reauthenticate", body);
      expect(verified.statusCode, verified.body).toBe(200);
      expect(
        (await call("POST", "/v1/auth/reauthenticate", body)).statusCode,
      ).toBe(409);
      const persisted = (
        await db.pool.query(
          "SELECT purpose,session_id,consumed_at FROM ai_album.reauth_proofs WHERE token_hash=$1",
          [runtime.auth.hash(verified.json().data.reauthProof)],
        )
      ).rows[0];
      expect(persisted).toMatchObject({
        purpose: "billing_refund",
        session_id: session.actor.sessionId,
        consumed_at: null,
      });
      const expired = await call(
          "POST",
          "/v1/auth/reauthentication/challenges",
          { purpose: "billing_refund" },
        ),
        eid = expired.json().data.id;
      await db.pool.query(
        "UPDATE ai_album.auth_challenges SET expires_at=created_at+interval '1 microsecond' WHERE id=$1",
        [eid],
      );
      expect(
        (
          await call("POST", "/v1/auth/reauthenticate", {
            purpose: "billing_refund",
            proof: {
              provider: "phone",
              challengeId: eid,
              proof: deliveries.get(eid)!.code,
              purpose: "billing_refund",
            },
          })
        ).statusCode,
      ).toBe(410);
      const prior = human.complete;
      human.complete = async (input: any) => ({
        ...(await prior(input)),
        subject: "different-linked-person",
      });
      try {
        const begin = await call(
            "POST",
            "/v1/auth/reauthentication/challenges",
            { purpose: "billing_refund" },
          ),
          bid = begin.json().data.id;
        const mismatch = await call("POST", "/v1/auth/reauthenticate", {
          purpose: "billing_refund",
          proof: {
            provider: "phone",
            challengeId: bid,
            proof: deliveries.get(bid)!.code,
            purpose: "billing_refund",
          },
        });
        expect(mismatch.statusCode, mismatch.body).toBe(403);
      } finally {
        human.complete = prior;
      }
    });
    it("wires the trusted human adapter through createRuntime without a manual token port", async () => {
      const { createRuntime } = await import("../runtime"),
        url = new URL(process.env.C3_TEST_DATABASE_URL!);
      url.pathname =
        "/" +
        (await db.pool.query("SELECT current_database() AS name")).rows[0].name;
      const server = await createRuntime(
        {
          C3_ENV: "dev",
          C3_DATABASE_URL: url.toString(),
          C3_AUTH_SECRET: "review-test-secret-".repeat(3),
          C3_ALLOWED_ORIGIN: "https://album.test",
        },
        { reauthentication: { human } },
      );
      let configured: any;
      try {
        configured = await createApplication(server.runtime);
        const headers = {
          cookie: `album_session=${session.accessToken}`,
          origin: "https://album.test",
          "x-csrf-token": session.csrfToken,
          "idempotency-key": id(),
        };
        const start = await configured.inject({
          method: "POST",
          url: "/v1/auth/reauthentication/challenges",
          payload: { purpose: "billing_refund" },
          headers,
        });
        expect(start.statusCode, start.body).toBe(200);
        const challengeId = start.json().data.id;
        const verified = await configured.inject({
          method: "POST",
          url: "/v1/auth/reauthenticate",
          payload: {
            purpose: "billing_refund",
            proof: {
              provider: "phone",
              challengeId,
              proof: deliveries.get(challengeId)!.code,
              purpose: "billing_refund",
            },
          },
          headers: { ...headers, "idempotency-key": id() },
        });
        expect(verified.statusCode, verified.body).toBe(200);
        expect(verified.json().data.purpose).toBe("billing_refund");
      } finally {
        await configured?.close();
        await server.close();
      }
    });
    it("shows verification unavailable with no trusted human adapter", async () => {
      const old = runtime.commerce!.reauth;
      runtime.commerce!.reauth = new ReauthService(
        db.database,
        runtime.auth,
        {},
      );
      try {
        expect(
          (await call("GET", "/v1/auth/reauthentication")).json().data.state,
        ).toBe("unconfigured");
        const start = await call(
          "POST",
          "/v1/auth/reauthentication/challenges",
          { purpose: "billing_refund" },
        );
        expect(start.statusCode, start.body).toBe(503);
      } finally {
        runtime.commerce!.reauth = old;
      }
    });
    it("honors emergency disabled booleans and replays a valid Accepted response without another proof", async () => {
      for (const disabled of [true, false]) {
        const token = await proof("admin_operations"),
          key = id(),
          body = { capability: "purchase", disabled, reason: "review switch" },
          headers = {
            "idempotency-key": key,
            "x-reauthentication-proof": token,
          };
        const result = await call(
          "POST",
          "/v1/admin/config/emergency-disable",
          body,
          headers,
        );
        expect(result.statusCode, result.body).toBe(200);
        expect(result.json().data).toMatchObject({
          operationId: expect.any(String),
          state: "completed",
          acceptedAt: expect.any(String),
        });
        const replay = await call(
          "POST",
          "/v1/admin/config/emergency-disable",
          body,
          headers,
        );
        expect(replay.json().data).toEqual(result.json().data);
        const row = (
          await db.pool.query(
            "SELECT redacted_details FROM ai_album.audit_events WHERE action='config.emergency' ORDER BY created_at DESC,id DESC LIMIT 1",
          )
        ).rows[0];
        expect(row.redacted_details.disabled).toBe(disabled);
        if (disabled)
          await expect(
            runtime.commerce!.config.assertNewRequestsAllowed("purchase"),
          ).rejects.toThrow("CAPABILITY_DISABLED");
        else
          await expect(
            runtime.commerce!.config.assertNewRequestsAllowed("purchase"),
          ).resolves.toBeUndefined();
      }
    });
    it("revokes unused secrets and blocks live frozen job obligations without consuming failed proof", async () => {
      const unused = id(),
        busy = id();
      await db.database.transaction(async (tx) => {
        for (const secret of [unused, busy])
          await tx.query(
            "INSERT INTO secret_references(id,environment,purpose,secret_ref,secret_version,state) VALUES($1::text,'dev','payment',$1::text,'v1','available')",
            [secret],
          );
      });
      await job({ credential: { secretRef: busy, secretVersion: "v1" } });
      const ok = await call(
        "POST",
        `/v1/admin/secrets/${unused}/versions/v1/revoke`,
        { reason: "unused revoke", emergency: false },
        { "x-reauthentication-proof": await proof("admin_secret") },
      );
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json().data.state).toBe("revoked");
      const token = await proof("admin_secret"),
        blocked = await call(
          "POST",
          `/v1/admin/secrets/${busy}/versions/v1/revoke`,
          { reason: "in-use revoke", emergency: false },
          { "x-reauthentication-proof": token },
        );
      expect(blocked.statusCode, blocked.body).toBe(409);
      expect(blocked.json().error.code).toBe("SECRET_IN_USE");
      expect(
        (
          await db.pool.query(
            "SELECT consumed_at FROM ai_album.reauth_proofs WHERE token_hash=$1",
            [runtime.auth.hash(token)],
          )
        ).rows[0].consumed_at,
      ).toBeNull();
    });
    it("discovers durable workspace refund history and reads changed server state under authorization", async () => {
      const sku = id(),
        version = id(),
        oid = id(),
        attempt = id(),
        refund = id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO billing_skus(id,code,name) VALUES($1::text,$1::text,'test')",
          [sku],
        );
        await tx.query(
          "INSERT INTO sku_versions(id,sku_id,version,price_fen,duration_days,credit_grant,features) VALUES($1,$2,1,123,30,0,'{}')",
          [version, sku],
        );
        await tx.query(
          "INSERT INTO orders(id,workspace_id,sku_version_id,buyer_user_id,amount_fen,channel,client_platform,state,paid_at,expires_at) VALUES($1,$2,$3,$4,123,'wechat_pay','web','paid',now(),now()+interval '1 day')",
          [oid, wid, version, session.actor.userId],
        );
        await tx.query(
          "INSERT INTO payment_attempts(id,workspace_id,order_id,attempt,channel,merchant_account_ref,provider_request_id,state,amount_fen) VALUES($1::text,$2,$3,1,'wechat_pay','local',$1::text,'paid',123)",
          [attempt, wid, oid],
        );
        await tx.query(
          "INSERT INTO refunds(id,workspace_id,order_id,payment_attempt_id,operation_id,amount_fen,state,reason_code) VALUES($1::text,$2,$3,$4,$1::text,123,'manual_review','REVIEW_REQUIRED')",
          [refund, wid, oid, attempt],
        );
      });
      const found = await call("GET", `/v1/workspaces/${wid}/refunds`);
      expect(found.statusCode, found.body).toBe(200);
      expect(found.json().data.items).toEqual([
        expect.objectContaining({ id: refund, state: "manual_review" }),
      ]);
      await db.pool.query(
        "UPDATE ai_album.refunds SET state='succeeded',revision=revision+1 WHERE id=$1",
        [refund],
      );
      const refreshed = await call("GET", `/v1/workspaces/${wid}/refunds`);
      expect(refreshed.json().data.items[0].state).toBe("succeeded");
      expect(
        (await call("GET", `/v1/refunds/${refund}`)).json().data.state,
      ).toBe("succeeded");
      const stranger = (
          await runtime.auth.login(
            {
              exchange: async () => ({
                provider: "wechat",
                appId: "review",
                subject: "stranger",
                unionId: null,
                openPlatformId: null,
              }),
            },
            id(),
            "mini",
          )
        ).actor,
        otherSession = await runtime.auth.createWebSession(stranger);
      const denied = await call(
        "GET",
        `/v1/workspaces/${wid}/refunds`,
        undefined,
        { cookie: `album_session=${otherSession.accessToken}` },
      );
      expect(denied.statusCode, denied.body).toBe(404);
      const foreign = (
        await runtime.workspaces.createWorkspace(session.actor, "studio", id())
      ).workspaceId;
      expect(
        (
          await call("GET", `/v1/workspaces/${foreign}/refunds`, undefined, {
            "x-workspace-id": foreign,
          })
        ).json().data.items,
      ).toEqual([]);
      expect(
        (
          await call("GET", `/v1/refunds/${refund}`, undefined, {
            "x-workspace-id": foreign,
          })
        ).statusCode,
      ).toBe(404);
    });
    it("atomically restores only the targeted scheduling fact and returns/replays the contract Job", async () => {
      const target = await job(),
        other = await job(),
        token = await proof("admin_operations"),
        key = id(),
        body = {
          action: "reschedule_dispatch",
          expectedRevision: 1,
          reason: "restore dispatch",
        },
        headers = { "idempotency-key": key, "x-reauthentication-proof": token };
      const wrong = await proof("admin_secret");
      const wrongPurpose = await call(
        "POST",
        `/v1/admin/jobs/${target}/actions`,
        body,
        { "x-reauthentication-proof": wrong },
      );
      expect(wrongPurpose.statusCode, wrongPurpose.body).toBe(401);
      expect(
        (
          await db.pool.query(
            "SELECT consumed_at FROM ai_album.reauth_proofs WHERE token_hash=$1",
            [runtime.auth.hash(wrong)],
          )
        ).rows[0].consumed_at,
      ).toBeNull();
      const first = await call(
        "POST",
        `/v1/admin/jobs/${target}/actions`,
        body,
        headers,
      );
      expect(first.statusCode, first.body).toBe(202);
      expect(first.json().data).toMatchObject({
        id: target,
        state: "queued",
        revision: 2,
      });
      const replay = await call(
        "POST",
        `/v1/admin/jobs/${target}/actions`,
        body,
        headers,
      );
      expect(replay.json().data).toEqual(first.json().data);
      expect(
        (
          await db.pool.query(
            "SELECT aggregate_id FROM ai_album.outbox WHERE event_type='job.ready' AND aggregate_id=ANY($1::text[])",
            [[target, other]],
          )
        ).rows,
      ).toEqual([{ aggregate_id: target }]);
      const stale = await call(
        "POST",
        `/v1/admin/jobs/${target}/actions`,
        body,
        { "x-reauthentication-proof": await proof("admin_operations") },
      );
      expect(stale.statusCode, stale.body).toBe(409);
      expect(
        (
          await db.pool.query(
            "SELECT count(*) FROM ai_album.audit_events WHERE action='commerce.job_action' AND target_id=$1",
            [target],
          )
        ).rows[0].count,
      ).toBe("1");
    });
  },
);

it("defines strict human challenge and authorized refund history contracts", async () => {
  const { loadContracts } = await import("./contracts"),
    { contract, validate } = await loadContracts();
  expect(
    contract.paths["/workspaces/{workspaceId}/refunds"]?.get?.operationId,
  ).toBe("listWorkspaceRefunds");
  expect(
    contract.paths["/auth/reauthentication/challenges"]?.post?.security,
  ).toBeDefined();
  const challenge = {
    id: id(),
    method: "sms",
    destinationHint: "手机尾号1234",
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    purpose: "billing_refund",
  };
  expect(() =>
    validate({ $ref: "#/components/schemas/HumanReauthChallenge" }, challenge),
  ).not.toThrow();
  expect(() =>
    validate(
      { $ref: "#/components/schemas/HumanReauthChallenge" },
      { ...challenge, reauthProof: "raw-protocol-token" },
    ),
  ).toThrow();
});
