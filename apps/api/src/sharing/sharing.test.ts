import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { id, digest } from "@album/server-core";
import { testDatabase } from "../../test/database";
import { NotificationsService } from "../notifications/service";
import { SharingService } from "./service";
import { storageFixture } from "../../test/asset-fixtures";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "sharing and transactional notification delivery",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      service: NotificationsService,
      userId: string,
      wid: string;
    const auth = { authorize: async () => {} };
    beforeAll(async () => {
      db = await testDatabase();
      userId = id();
      wid = id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO users(id,display_name) VALUES($1,'Recipient')",
          [userId],
        );
        await tx.query(
          "INSERT INTO workspaces(id,owner_user_id,kind,name) VALUES($1,$2,'personal','Test')",
          [wid, userId],
        );
        await tx.query(
          "INSERT INTO workspace_members(id,workspace_id,user_id,role) VALUES($1,$2,$3,'owner')",
          [id(), wid, userId],
        );
      });
      service = new NotificationsService(db.database, auth);
    }, 60000);
    afterAll(async () => {
      await db?.close();
    });
    const event = (
      eventId: string,
      channel: "in_app" | "wechat" | "sms" = "in_app",
    ) => ({
      workspaceId: wid,
      recipientId: userId,
      eventId,
      category: "job" as const,
      templateKey: "ready",
      templateVersion: 1,
      kind: "job_succeeded" as const,
      title: "Ready",
      body: "Your album is ready",
      channel,
    });
    it("commits one in-app fact and one delivery after 100 event replays", async () => {
      const key = id();
      await Promise.all(
        Array.from({ length: 100 }, () => service.enqueue(event(key))),
      );
      const outboxKey = digest(`${key}:${userId}:in_app`);
      await Promise.all(
        Array.from({ length: 100 }, () =>
          service.deliverNotification(outboxKey),
        ),
      );
      const counts = await db.database.transaction(async (tx) => ({
        notifications: (
          await tx.query(
            "SELECT count(*) FROM notifications WHERE event_key=$1",
            [key],
          )
        ).rows[0].count,
        deliveries: (
          await tx.query("SELECT count(*) FROM notification_deliveries")
        ).rows[0].count,
      }));
      expect(counts).toEqual({ notifications: "1", deliveries: "1" });
    });
    it("does not send without verified consent and skips unconfigured SMS", async () => {
      let sends = 0;
      const adapter = {
        send: async () => {
          sends++;
          return { providerMessageId: "provider" };
        },
      };
      for (const channel of ["wechat", "sms"] as const) {
        const key = id();
        await service.enqueue(event(key, channel));
        expect(
          await service.deliverNotification(
            digest(`${key}:${userId}:${channel}`),
            adapter,
          ),
        ).toBe("skipped");
      }
      expect(sends).toBe(0);
    });
    it("deduplicates provider sends and honors opt-out", async () => {
      await db.database.transaction((tx) =>
        tx.query(
          "INSERT INTO notification_consents(workspace_id,user_id,template_key,template_version,enabled,destination_verified,proof_digest) VALUES($1,$2,'ready',1,true,true,$3)",
          [wid, userId, digest("proof")],
        ),
      );
      const key = id();
      await service.enqueue(event(key, "wechat"));
      let sends = 0;
      const adapter = {
        send: async () => {
          sends++;
          return { providerMessageId: "provider" };
        },
      };
      await Promise.all(
        Array.from({ length: 100 }, () =>
          service.deliverNotification(
            digest(`${key}:${userId}:wechat`),
            adapter,
          ),
        ),
      );
      expect(sends).toBe(1);
      await db.database.transaction((tx) =>
        tx.query("UPDATE notification_consents SET enabled=false"),
      );
      const second = id();
      await service.enqueue(event(second, "wechat"));
      expect(
        await service.deliverNotification(
          digest(`${second}:${userId}:wechat`),
          adapter,
        ),
      ).toBe("skipped");
      expect(sends).toBe(1);
    });
    it("rejects an absent frozen preview and unknown share/session tokens", async () => {
      const sharing = new SharingService(db.database, auth);
      const actor = {
        userId,
        sessionId: id(),
        client: "web" as const,
        platformPermissions: [],
      };
      await expect(
        sharing.create(
          actor,
          wid,
          {
            outputIds: [id()],
            expiresInHours: 1,
            allowDownload: false,
            accessMode: "link",
          },
          id(),
        ),
      ).rejects.toThrow("PREVIEW_NOT_READY");
      await expect(sharing.access("unrecognized")).rejects.toThrow(
        "SHARE_UNAVAILABLE",
      );
      await expect(
        sharing.authorizeShare("unrecognized", id()),
      ).rejects.toThrow("SHARE_UNAVAILABLE");
    });
    it("revocation and expiry prevent new authorization, with account deletion failing closed", async () => {
      const config = await storageFixture(db.database),
        project = id(),
        revision = id(),
        object = id(),
        shareId = id(),
        raw = id() + id(),
        session = id() + id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state) VALUES($1,$2,$3,'private',$5,'document',$4,1,'application/json','verified')",
          [object, wid, config.profileVersionId, digest("document"), object],
        );
        await tx.query(
          "INSERT INTO projects(id,workspace_id,name,created_by) VALUES($1,$2,'Frozen',$3)",
          [project, wid, userId],
        );
        await tx.query(
          "INSERT INTO project_revisions(id,workspace_id,project_id,number,schema_version,storage_object_id,document_hash,spread_count,photo_count,created_by,command_id,base_revision) VALUES($1,$2,$3,1,1,$4,$5,1,0,$6,$7,0)",
          [revision, wid, project, object, digest("document"), userId, id()],
        );
        await tx.query(
          "INSERT INTO share_links(id,workspace_id,project_id,revision_id,created_by,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()-interval '2 hours',now()+interval '1 hour')",
          [shareId, wid, project, revision, userId, digest(raw)],
        );
        await tx.query(
          "INSERT INTO share_sessions(token_hash,workspace_id,share_id,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",
          [digest(session), wid, shareId],
        );
      });
      const sharing = new SharingService(db.database, auth);
      await db.database.transaction((tx) =>
        tx.query("UPDATE share_links SET state='revoked' WHERE id=$1", [
          shareId,
        ]),
      );
      await expect(sharing.authorizeShare(session, id())).rejects.toThrow(
        "SHARE_REVOKED",
      );
      await db.database.transaction((tx) =>
        tx.query(
          "UPDATE share_links SET state='active',expires_at=now()-interval '1 hour' WHERE id=$1",
          [shareId],
        ),
      );
      await expect(sharing.authorizeShare(session, id())).rejects.toThrow(
        "SHARE_EXPIRED",
      );
      await db.database.transaction((tx) =>
        tx.query("UPDATE users SET status='deleting' WHERE id=$1", [userId]),
      );
      await expect(sharing.access(raw)).rejects.toThrow("SHARE_UNAVAILABLE");
    });
  },
);
