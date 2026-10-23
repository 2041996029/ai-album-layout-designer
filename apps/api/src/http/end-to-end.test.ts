import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDatabase } from "../../test/database";
import { createApplication } from "../app.module";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { UploadService } from "../assets/upload";
import { LocalObjectStore } from "../assets/object-store";
import { provisionDevelopmentStorage } from "../assets/development";
import { RevisionService } from "../projects/revisions";
import { FolderService } from "../folders/service";
import { id, digest } from "@album/server-core";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "C3 real HTTP upload and cross-device revisions",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      app: any,
      root: string,
      web: any,
      mini: any,
      wid: string;
    const call = async (
      method: string,
      url: string,
      payload?: unknown,
      extra: Record<string, string> = {},
    ) =>
      app.inject({
        method,
        url,
        payload,
        headers: {
          cookie: `album_session=${web.accessToken}`,
          origin: "https://album.test",
          "x-csrf-token": web.csrfToken,
          "x-workspace-id": wid,
          "idempotency-key": id(),
          ...extra,
        },
      });
    beforeAll(async () => {
      db = await testDatabase();
      root = await mkdtemp(join(tmpdir(), "c3-http-"));
      const auth = new AuthService(db.database, {
        secret: "local-test-signing-secret-at-least-32-characters",
        environment: "dev",
      });
      mini = await auth.login(
        {
          exchange: async () => ({
            provider: "wechat",
            appId: "e2e",
            subject: "e2e",
            unionId: null,
            openPlatformId: null,
          }),
        },
        id(),
        "mini",
      );
      web = await auth.createWebSession(mini.actor);
      const workspaces = new WorkspaceService(db.database, auth),
        config = await provisionDevelopmentStorage(db.database, "dev"),
        objects = new LocalObjectStore({
          root,
          secret: "local-object-test-key-at-least-32-chars",
          environment: "dev",
          baseUrl: "http://localhost",
        }),
        uploads = new UploadService(
          db.database,
          workspaces,
          objects,
          {
            readQuota: async () => ({
              limitBytes: 100000000,
              maxProjectPhotos: 500,
            }),
          },
          config,
        ),
        revisions = new RevisionService(
          db.database,
          workspaces,
          objects,
          config,
          undefined,
          async (_tx, actor, w, aid) => {
            const a = await uploads.getAsset(actor, w, aid);
            return a.editorResource!;
          },
        );
      app = await createApplication({
        db: db.database,
        auth,
        workspaces,
        uploads,
        revisions,
        folders: new FolderService(db.database, workspaces),
        localObjects: objects,
        environment: "dev",
        allowedOrigin: "https://album.test",
      });
      wid = (await workspaces.createWorkspace(web.actor, "personal", id()))
        .workspaceId;
    }, 60000);
    afterAll(async () => {
      await app?.close();
      await db?.close();
      if (root) await rm(root, { recursive: true, force: true });
    });
    it("uploads actual bytes through signed private URL, saves with CAS and rejects mini whole-document writes", async () => {
      const bytes = await readFile(
        new URL(
          "../../../../tests/fixtures/images/transparent.png",
          import.meta.url,
        ),
      );
      let r = await call("POST", `/v1/workspaces/${wid}/uploads`, {
        filename: "photo.png",
        declaredMime: "image/png",
        sizeBytes: bytes.length,
        sha256: digest(bytes),
        folderId: null,
      });
      expect(r.statusCode, r.body).toBe(201);
      const ticket = r.json().data;
      r = await app.inject({
        method: "PUT",
        url: new URL(ticket.url).pathname,
        headers: { "content-type": "image/png" },
        payload: bytes,
      });
      expect(r.statusCode, r.body).toBe(204);
      r = await call("POST", `/v1/assets/${ticket.assetId}/complete`, {
        uploadId: ticket.uploadId,
        sha256: digest(bytes),
        sizeBytes: bytes.length,
      });
      expect(r.statusCode, r.body).toBe(202);
      const asset = r.json().data.editorResource;
      expect(asset.variants.preview.sha256).toMatch(/^[0-9a-f]{64}$/);
      r = await call("POST", `/v1/workspaces/${wid}/projects`, {
        name: "跨端相册",
        mode: "full_editor",
        scene: "family",
        pageWidthMm: 300,
        pageHeightMm: 300,
        spreadCount: 2,
      });
      expect(r.statusCode, r.body).toBe(201);
      const created = r.json().data,
        doc = created.document;
      doc.customExtension = { mustSurvive: true };
      doc.spreads[0].layers = [
        {
          id: "image",
          type: "image",
          assetId: asset.id,
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          fitMode: "cover",
        },
      ];
      r = await call(
        "PATCH",
        `/v1/projects/${doc.projectId}`,
        {
          commandId: id(),
          clientPlatform: "web",
          commands: [{ type: "replaceDocument", document: doc }],
          resources: { assets: [asset], fonts: [] },
        },
        { "if-match": '"1"' },
      );
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().data.document.revision).toBe(2);
      expect(r.json().data.document.customExtension.mustSurvive).toBe(true);
      const bad = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${doc.projectId}`,
        headers: {
          authorization: `Bearer ${mini.accessToken}`,
          "x-workspace-id": wid,
          "idempotency-key": id(),
          "if-match": '"2"',
        },
        payload: {
          commandId: id(),
          clientPlatform: "mini",
          commands: [{ type: "replaceDocument", document: doc }],
        },
      });
      expect(bad.statusCode, bad.body).toBe(403);
      r = await call("GET", `/v1/projects/${doc.projectId}`);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().data.document.revision).toBe(2);
      const workspaceBefore = await call("GET", `/v1/workspaces/${wid}`);
      expect(workspaceBefore.statusCode, workspaceBefore.body).toBe(200);
      expect(workspaceBefore.json().data.defaults.pageWidthMm).toBe(300);
      const workspaceChanged = await call(
        "PATCH",
        `/v1/workspaces/${wid}`,
        { defaultPageWidthMm: 210, defaultPageHeightMm: 297 },
        { "if-match": '"1"' },
      );
      expect(workspaceChanged.statusCode, workspaceChanged.body).toBe(200);
      expect(workspaceChanged.json().data.defaults).toMatchObject({
        pageWidthMm: 210,
        pageHeightMm: 297,
      });
      const unchangedProject = await call(
        "GET",
        `/v1/projects/${doc.projectId}`,
      );
      expect(unchangedProject.json().data.document.pageSize).toEqual(
        doc.pageSize,
      );
      const history = await call(
        "GET",
        `/v1/projects/${doc.projectId}/revisions?limit=1`,
      );
      expect(history.statusCode, history.body).toBe(200);
      expect(history.json().data.items[0].revision).toBe(2);
      expect(history.json().data.hasMore).toBe(true);
      const restoredProject = await call(
        "POST",
        `/v1/projects/${doc.projectId}/restore-revision`,
        { sourceRevision: 1, commandId: id() },
        { "if-match": '"2"' },
      );
      expect(restoredProject.statusCode, restoredProject.body).toBe(200);
      expect(restoredProject.json().data.document.revision).toBe(3);
      expect(
        restoredProject.json().data.document.customExtension,
      ).toBeUndefined();
      const refs = await call(
        "GET",
        `/v1/assets/${asset.id}/references`,
        undefined,
        { "x-workspace-id": "" },
      );
      expect(refs.statusCode, refs.body).toBe(200);
      expect(refs.json().data.projects).toContain(doc.projectId);
      const blocked = await call(
        "DELETE",
        `/v1/assets/${asset.id}`,
        undefined,
        { "if-match": '"2"' },
      );
      expect(blocked.statusCode, blocked.body).toBe(409);
      let folder = await call("POST", `/v1/workspaces/${wid}/folders`, {
        parentId: null,
        name: "待回收",
      });
      expect(folder.statusCode, folder.body).toBe(201);
      const f = folder.json().data;
      let preview = await call("GET", `/v1/folders/${f.id}/delete-preview`);
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json().data.canDelete).toBe(true);
      let trash = await call("DELETE", `/v1/folders/${f.id}`, undefined, {
        "if-match": '"1"',
      });
      expect(trash.statusCode, trash.body).toBe(200);
      let recycle = await call(
        "GET",
        `/v1/workspaces/${wid}/folders?state=trashed`,
      );
      expect(recycle.statusCode, recycle.body).toBe(200);
      expect(recycle.json().data.items.map((v: any) => v.id)).toContain(f.id);
      const restored = await call(
        "POST",
        `/v1/folders/${f.id}/restore`,
        { parentId: null },
        { "if-match": '"2"' },
      );
      expect(restored.statusCode, restored.body).toBe(200);
      expect(restored.json().data.state).toBe("active");
      const usage = await call("GET", `/v1/workspaces/${wid}/usage`);
      expect(usage.statusCode, usage.body).toBe(200);
      expect(usage.json().data.storageBytes).toBeGreaterThan(bytes.length);
    });
  },
);
