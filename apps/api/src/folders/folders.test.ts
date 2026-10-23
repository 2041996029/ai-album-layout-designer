import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { FolderService } from "./service";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "transactional folder trees",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      folders: FolderService,
      actor: any,
      wid: string;
    beforeAll(async () => {
      db = await testDatabase();
      const auth = new AuthService(db.database, {
        secret: "x".repeat(40),
        environment: "dev",
      });
      actor = (
        await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "app",
              subject: "folders",
              unionId: null,
              openPlatformId: null,
            }),
          },
          "folders-code",
          "mini",
        )
      ).actor;
      const ws = new WorkspaceService(db.database, auth);
      wid = (await ws.createWorkspace(actor, "personal", "w")).workspaceId;
      folders = new FolderService(db.database, ws);
    }, 60000);
    afterAll(async () => {
      await db?.close();
    });
    it("rejects cycles, subtree depth overflow, stale updates and normalized sibling collisions", async () => {
      const a = await folders.createFolder(actor, wid, null, "a", "a"),
        b = await folders.createFolder(actor, wid, a.id, "b", "b");
      await expect(
        folders.updateFolder(actor, wid, a.id, 1, { parentId: b.id }),
      ).rejects.toThrow("FOLDER_CYCLE");
      await folders.createFolder(actor, wid, null, "café", "cafe");
      await expect(
        folders.updateFolder(actor, wid, a.id, 1, { name: "CAFÉ" }),
      ).rejects.toThrow("FOLDER_NAME_CONFLICT");
      let last = b;
      for (let i = 3; i <= 10; i++)
        last = await folders.createFolder(
          actor,
          wid,
          last.id,
          "level" + i,
          "level" + i,
        );
      await expect(
        folders.createFolder(actor, wid, last.id, "overflow", "overflow"),
      ).rejects.toThrow("FOLDER_DEPTH_EXCEEDED");
      await expect(
        folders.updateFolder(actor, wid, a.id, 0, { name: "stale" }),
      ).rejects.toThrow("REVISION_CONFLICT");
    });
    it("rejects cross-workspace parents and restores the entire subtree", async () => {
      const other = await db.database.transaction(async (tx) => {
        const result = await tx.query(
          "SELECT id FROM workspaces WHERE owner_user_id=$1",
          [actor.userId],
        );
        return result.rows[0].id;
      });
      await expect(
        folders.createFolder(actor, wid, "foreign-folder", "no", "foreign"),
      ).rejects.toThrow("NOT_FOUND");
      const parent = await folders.createFolder(
        actor,
        wid,
        null,
        "trash-parent",
        "trash-parent",
      );
      const child = await folders.createFolder(
        actor,
        wid,
        parent.id,
        "trash-child",
        "trash-child",
      );
      await folders.trashFolder(actor, wid, parent.id, 1, "trash");
      expect(
        (await folders.listFolders(actor, wid)).items.some(
          (f) => f.id === child.id,
        ),
      ).toBe(false);
      await folders.restoreFolder(
        actor,
        wid,
        parent.id,
        null,
        "restored",
        "restore",
      );
      expect(
        (await folders.listFolders(actor, wid)).items.some(
          (f) => f.id === child.id,
        ),
      ).toBe(true);
    });
    it("lists trashed children with true depth, filters and signed paginated cursors", async () => {
      const parent = await folders.createFolder(
        actor,
        wid,
        null,
        "recycle-root",
        "recycle-root",
      );
      const one = await folders.createFolder(
          actor,
          wid,
          parent.id,
          "recycle-one",
          "recycle-one",
        ),
        two = await folders.createFolder(
          actor,
          wid,
          parent.id,
          "recycle-two",
          "recycle-two",
        );
      await folders.trashFolder(actor, wid, parent.id, 1, "recycle");
      const page = await folders.listFolders(actor, wid, {
        state: "trashed",
        parentId: parent.id,
        q: "recycle",
        limit: 1,
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].depth).toBe(2);
      expect(page.hasMore).toBe(true);
      const next = await folders.listFolders(actor, wid, {
        state: "trashed",
        parentId: parent.id,
        q: "recycle",
        limit: 1,
        cursor: page.nextCursor,
      });
      expect(next.items).toHaveLength(1);
      expect(new Set([page.items[0].id, next.items[0].id])).toEqual(
        new Set([one.id, two.id]),
      );
      expect(next.hasMore).toBe(false);
      await expect(
        folders.listFolders(actor, wid, {
          state: "active",
          cursor: page.nextCursor,
        }),
      ).rejects.toThrow("INVALID_CURSOR");
      await expect(
        folders.listFolders(actor, wid, { cursor: "forged" }),
      ).rejects.toThrow("INVALID_CURSOR");
    });

    it("uses full default Unicode case folding for sibling uniqueness", async () => {
      await folders.createFolder(actor, wid, null, "ﬃ", "unicode-ligature");
      await expect(
        folders.createFolder(actor, wid, null, "FFI", "unicode-ascii"),
      ).rejects.toThrow("FOLDER_NAME_CONFLICT");
      await folders.createFolder(actor, wid, null, "ẞ", "unicode-sharp");
      await expect(
        folders.createFolder(actor, wid, null, "ss", "unicode-sharp-ascii"),
      ).rejects.toThrow("FOLDER_NAME_CONFLICT");
      await folders.createFolder(actor, wid, null, "ΟΣ", "unicode-sigma");
      await expect(
        folders.createFolder(actor, wid, null, "ος", "unicode-final-sigma"),
      ).rejects.toThrow("FOLDER_NAME_CONFLICT");
    });

    it("rejects stale restore CAS before restoring any subtree item", async () => {
      const root = await folders.createFolder(
        actor,
        wid,
        null,
        "restore-cas",
        "restore-cas",
      );
      await folders.trashFolder(actor, wid, root.id, 1, "restore-cas-trash");
      await expect(
        folders.restoreFolder(
          actor,
          wid,
          root.id,
          null,
          "restored-cas",
          "restore-cas-stale",
          1,
        ),
      ).rejects.toThrow("REVISION_CONFLICT");
      expect((await folders.getFolder(actor, wid, root.id)).state).toBe(
        "trashed",
      );
      expect(
        (
          await folders.restoreFolder(
            actor,
            wid,
            root.id,
            null,
            "restored-cas",
            "restore-cas-valid",
            2,
          )
        ).state,
      ).toBe("active");
    });
  },
);
