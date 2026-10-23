import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { testDatabase } from "../../test/database";
import { storageFixture } from "../../test/asset-fixtures";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { LocalObjectStore } from "./object-store";
import { provisionBundledFonts } from "./bundled-fonts";
import { UploadService } from "./upload";
import { digest } from "@album/server-core";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "trusted bundled font publication",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>, root: string;
    beforeAll(async () => {
      db = await testDatabase();
      root = await mkdtemp(tmpdir() + "/c3-fonts-");
    }, 60000);
    afterAll(async () => {
      await db?.close();
      await rm(root, { recursive: true, force: true });
    });
    it("stores exact C1 bundle metadata and every real font face with immutable byte identities", async () => {
      const auth = new AuthService(db.database, {
          secret: "x".repeat(40),
          environment: "dev",
        }),
        actor = (
          await auth.login(
            {
              exchange: async () => ({
                provider: "wechat",
                appId: "app",
                subject: "fonts",
                unionId: null,
                openPlatformId: null,
              }),
            },
            "fonts-code",
            "mini",
          )
        ).actor,
        wid = (
          await new WorkspaceService(db.database, auth).createWorkspace(
            actor,
            "personal",
            "w",
          )
        ).workspaceId,
        config = await storageFixture(db.database),
        objects = new LocalObjectStore({
          root,
          secret: "x".repeat(40),
          environment: "dev",
          baseUrl: "http://localhost",
        });
      const actual = await provisionBundledFonts(
        db.database,
        objects,
        config,
        wid,
      );
      const expected = JSON.parse(
        await readFile(
          new URL("../../../web/public/fonts/manifest.json", import.meta.url),
          "utf8",
        ),
      );
      expect(actual).toEqual(expected.fonts);
      const resources = new UploadService(
        db.database,
        new WorkspaceService(db.database, auth),
        objects,
        {
          readQuota: async () => ({
            limitBytes: 100000,
            maxProjectPhotos: 500,
          }),
        },
        config,
      ).createResourcePort(actor, wid);
      expect(digest(await resources.read(actual[0].faces[0].id, "font"))).toBe(
        actual[0].faces[0].sha256,
      );
      const rows = await db.database.transaction((tx) =>
        tx.query(
          "SELECT count(*) FROM editor_font_faces WHERE workspace_id=$1",
          [wid],
        ),
      );
      expect(Number(rows.rows[0].count)).toBe(
        actual.reduce((n, f) => n + f.faces.length, 0),
      );
      expect(
        await provisionBundledFonts(db.database, objects, config, wid),
      ).toEqual(actual);
    }, 120000);
  },
);
