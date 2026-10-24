import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { id, digest } from "@album/server-core";
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
    async function proof(purpose: string) {
      const raw = "review-proof-" + id();
      await db.database.transaction((tx) =>
        tx.query(
          "INSERT INTO reauth_proofs(token_hash,user_id,session_id,purpose,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')",
          [
            runtime.auth.hash(raw),
            session.actor.userId,
            session.actor.sessionId,
            purpose,
          ],
        ),
      );
      return raw;
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
      await bindCommerceRuntime(
        runtime,
        new ReauthService(db.database, auth, {}),
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
