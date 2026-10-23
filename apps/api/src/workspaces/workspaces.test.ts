import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "./service";
import { id } from "@album/server-core";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "live workspace authorization",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      auth: AuthService,
      service: WorkspaceService;
    const login = (subject: string) =>
      auth.login(
        {
          exchange: async () => ({
            provider: "wechat",
            appId: "app",
            subject,
            unionId: null,
            openPlatformId: null,
          }),
        },
        id(),
        "mini",
      );
    beforeAll(async () => {
      db = await testDatabase();
      auth = new AuthService(db.database, {
        secret: "local-test-signing-secret-at-least-32-characters",
        environment: "dev",
      });
      service = new WorkspaceService(db.database, auth);
    }, 60000);
    afterAll(async () => {
      await db?.close();
    });
    it("creates personal workspace idempotently and refuses same key changed payload", async () => {
      const { actor } = await login("owner");
      const a = await service.createWorkspace(actor, "personal", "create");
      expect(a.seatLimit).toBe(1);
      expect(
        await service.createWorkspace(actor, "personal", "create"),
      ).toEqual(a);
      await expect(
        service.createWorkspace(actor, "studio", "create"),
      ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    });
    it("rejects cross tenant and live removed memberships even with a still valid session", async () => {
      const owner = await login("owner2"),
        outsider = await login("other"),
        admin = await login("admin");
      const { workspaceId } = await service.createWorkspace(
        owner.actor,
        "studio",
        "studio",
      );
      await expect(
        service.authorize(outsider.actor, workspaceId, "read"),
      ).rejects.toThrow("NOT_FOUND");
      await db.database.transaction((tx) =>
        tx.query(
          "INSERT INTO workspace_members(id,workspace_id,user_id,role) VALUES($1,$2,$3,'admin')",
          [id(), workspaceId, admin.actor.userId],
        ),
      );
      expect(
        (await service.authorize(admin.actor, workspaceId, "manageSettings"))
          .role,
      ).toBe("admin");
      await expect(
        service.authorize(admin.actor, workspaceId, "purchase"),
      ).rejects.toThrow("FORBIDDEN");
      await db.database.transaction((tx) =>
        tx.query(
          "UPDATE workspace_members SET state='removed' WHERE workspace_id=$1 AND user_id=$2",
          [workspaceId, admin.actor.userId],
        ),
      );
      await expect(
        service.authorize(admin.actor, workspaceId, "read"),
      ).rejects.toThrow("FORBIDDEN");
    });
  },
);
