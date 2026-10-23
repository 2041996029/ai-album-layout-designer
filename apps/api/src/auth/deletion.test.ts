import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { testDatabase } from "../../test/database";
import { AuthService } from "./identity";
import { AccountDeletionService } from "./account-deletion";
import { PrivacyExportService } from "./privacy-export";
import { id, digest } from "@album/server-core";
import { storageFixture } from "../../test/asset-fixtures";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "account deletion real transactions",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>, auth: AuthService;
    beforeAll(async () => {
      db = await testDatabase();
      auth = new AuthService(db.database, {
        secret: "x".repeat(40),
        environment: "dev",
      });
    }, 60000);
    afterAll(async () => {
      await db?.close();
    });
    const login = () =>
      auth.login(
        {
          exchange: async () => ({
            provider: "wechat",
            appId: "deletion",
            subject: id(),
            unionId: null,
            openPlatformId: null,
          }),
        },
        id(),
        "mini",
      );
    const proof = { verify: async () => {} };
    it("fails closed without a real fresh-proof verifier", async () => {
      const { actor } = await login();
      await expect(
        new AccountDeletionService(db.database, auth).requestAccountDeletion(
          actor,
          {
            reauthProof: "proof-long-enough-to-test",
            confirm: "DELETE_ACCOUNT",
          },
        ),
      ).rejects.toThrow("REAUTH_UNCONFIGURED");
    });
    it("accepts confirmed deletion, revokes every session, requires restricted recovery, and never fabricates completed cleanup", async () => {
      const session = await login(),
        service = new AccountDeletionService(db.database, auth, proof);
      const storage = await storageFixture(db.database),
        project = id(),
        revision = id(),
        object = id(),
        share = id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state) VALUES($1,$2,$3,'private',$4,'document',$5,1,'application/json','verified')",
          [
            object,
            await (async () => {
              const wid = id();
              await tx.query(
                "INSERT INTO workspaces(id,owner_user_id,kind,name) VALUES($1,$2,'personal','Private')",
                [wid, session.actor.userId],
              );
              return wid;
            })(),
            storage.profileVersionId,
            object,
            digest("document"),
          ],
        );
        const w = (
          await tx.query(
            "SELECT workspace_id FROM storage_objects WHERE id=$1",
            [object],
          )
        ).rows[0].workspace_id;
        await tx.query(
          "INSERT INTO projects(id,workspace_id,name,created_by) VALUES($1,$2,'Frozen',$3)",
          [project, w, session.actor.userId],
        );
        await tx.query(
          "INSERT INTO project_revisions(id,workspace_id,project_id,number,schema_version,storage_object_id,document_hash,spread_count,photo_count,created_by,command_id,base_revision) VALUES($1,$2,$3,1,1,$4,$5,1,0,$6,$7,0)",
          [
            revision,
            w,
            project,
            object,
            digest("document"),
            session.actor.userId,
            id(),
          ],
        );
        await tx.query(
          "INSERT INTO share_links(id,workspace_id,project_id,revision_id,created_by,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",
          [share, w, project, revision, session.actor.userId, digest(id())],
        );
      });
      const result = await service.requestAccountDeletion(session.actor, {
        reauthProof: "proof-long-enough-to-test",
        confirm: "DELETE_ACCOUNT",
      });
      expect(result.state).toBe("confirmed");
      const revoked = await db.database.transaction((tx) =>
        tx.query("SELECT state FROM share_links WHERE id=$1", [share]),
      );
      expect(revoked.rows[0].state).toBe("revoked");
      await expect(
        auth.authenticate(session.accessToken, "mini"),
      ).rejects.toThrow("UNAUTHORIZED");
      await expect(
        service.cancelAccountDeletion(session.actor),
      ).rejects.toThrow("DELETION_REAUTH_REQUIRED");
      await expect(service.execute(result.id)).rejects.toThrow(
        "CLEANUP_UNCONFIGURED",
      );
      const state = await db.database.transaction((tx) =>
        tx.query("SELECT status FROM users WHERE id=$1", [
          session.actor.userId,
        ]),
      );
      expect(state.rows[0].status).toBe("deleting");
      const recovery = { assertActor: async () => {} };
      const recovered = new AccountDeletionService(
        db.database,
        auth,
        proof,
        recovery,
      );
      expect((await recovered.cancelAccountDeletion(session.actor)).state).toBe(
        "cancelled",
      );
      await expect(
        auth.authenticate(session.accessToken, "mini"),
      ).rejects.toThrow("UNAUTHORIZED");
    });
    it("records owned studios as actual blockers", async () => {
      const { actor } = await login();
      await db.database.transaction((tx) =>
        tx.query(
          "INSERT INTO workspaces(id,owner_user_id,kind,name) VALUES($1,$2,'studio','Owned studio')",
          [id(), actor.userId],
        ),
      );
      const result = await new AccountDeletionService(
        db.database,
        auth,
        proof,
      ).requestAccountDeletion(actor, {
        reauthProof: "proof-long-enough-to-test",
        confirm: "DELETE_ACCOUNT",
      });
      expect(result.state).toBe("blocked");
      expect(result.blockers).toContain("owned_studio");
    });
    it("does not invent privacy jobs while C4 scheduler is absent", async () => {
      const { actor } = await login();
      await db.database.transaction((tx) =>
        tx.query(
          "INSERT INTO workspaces(id,owner_user_id,kind,name) VALUES($1,$2,'personal','Private')",
          [id(), actor.userId],
        ),
      );
      await expect(
        new PrivacyExportService(db.database, auth, proof).request(actor, {
          reauthProof: "proof-long-enough-to-test",
          includeAssetManifest: true,
        }),
      ).rejects.toThrow("PRIVACY_EXPORT_UNCONFIGURED");
      const jobs = await db.database.transaction((tx) =>
        tx.query("SELECT count(*) FROM jobs WHERE created_by=$1", [
          actor.userId,
        ]),
      );
      expect(jobs.rows[0].count).toBe("0");
    });
  },
);
