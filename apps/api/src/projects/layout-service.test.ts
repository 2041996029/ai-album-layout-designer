import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { id, digest } from "@album/server-core";
import { testDatabase } from "../../test/database";
import { storageFixture } from "../../test/asset-fixtures";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { LocalObjectStore } from "../assets/object-store";
import { UploadService } from "../assets/upload";
import { RevisionService } from "./revisions";
import { CloudLayoutService } from "./layout-service";
import { JobRepository } from "@album/jobs";
import { templateVersions, type DocumentModel } from "@album/document";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
import sharp from "sharp";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "durable deterministic cloud layout",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>, root: string;
    beforeAll(async () => {
      db = await testDatabase();
      root = await mkdtemp(tmpdir() + "/layout-c4-");
    });
    afterAll(async () => {
      await db?.close();
      await rm(root, { recursive: true, force: true });
    });
    it("publishes fenced immutable candidates and applies with revision CAS", async () => {
      const auth = new AuthService(db.database, {
          secret: "x".repeat(40),
          environment: "dev",
        }),
        actor = (
          await auth.login(
            {
              exchange: async () => ({
                provider: "wechat",
                appId: "layout",
                subject: "a",
                unionId: null,
                openPlatformId: null,
              }),
            },
            id(),
            "mini",
          )
        ).actor,
        ws = new WorkspaceService(db.database, auth),
        wid = (await ws.createWorkspace(actor, "personal", id())).workspaceId,
        storage = await storageFixture(db.database),
        objects = new LocalObjectStore({
          root,
          secret: "o".repeat(40),
          environment: "dev",
          baseUrl: "http://local.invalid",
        }),
        uploads = new UploadService(
          db.database,
          ws,
          objects,
          {
            readQuota: async () => ({
              limitBytes: 100000000,
              maxProjectPhotos: 500,
            }),
          },
          storage,
        ),
        revisions = new RevisionService(db.database, ws, objects, storage);
      const bytes = await sharp({
          create: { width: 800, height: 600, channels: 3, background: "#ddd" },
        })
          .png()
          .toBuffer(),
        ticket = await uploads.beginUpload(
          actor,
          wid,
          {
            bytes: bytes.length,
            sha256: digest(bytes),
            mime: "image/png",
            folderId: null,
            projectId: null,
          },
          id(),
        );
      await objects.put(
        objects.verify(ticket.url.split("/").at(-1)!, "upload"),
        bytes,
      );
      const completed = await uploads.completeUpload(
        actor,
        wid,
        ticket.uploadId,
        id(),
      );
      const asset = await uploads.getAsset(actor, wid, completed.id);
      const doc = structuredClone(fixture) as DocumentModel;
      doc.projectId = id();
      await revisions.createInitialProject(
        actor,
        wid,
        doc,
        { assets: [asset.editorResource!], fonts: [] },
        id(),
        "Layout",
      );
      const rid = id();
      await db.database.transaction((tx) =>
        tx.query(
          "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',1,1,$2,'{}',$3)",
          [rid, digest("layout"), actor.userId],
        ),
      );
      const jobs = new JobRepository(db.database, async () => ({
        deployment: { global: 2, workspace: 2 },
        release: { global: 2, workspace: 2 },
        entitlement: { global: 2, workspace: 2 },
        leaseSeconds: 60,
        maxAttempts: 3,
        retryBackoffSeconds: [10, 30, 90],
      }));
      const layout = new CloudLayoutService({
        db: db.database,
        workspaces: ws,
        revisions,
        jobs,
        release: async () => ({
          releaseId: rid,
          policy: {
            algorithmVersion: "local-layout-v1",
            candidateCount: 3,
            weights: {
              subject: 0.3,
              timeline: 0.2,
              whitespace: 0.2,
              variety: 0.2,
              color: 0.1,
            },
          },
        }),
      });
      const template = templateVersions.find((t) => t.id === "tpl_travel")!;
      const input = {
        layoutSpec: {
          projectId: doc.projectId,
          baseRevision: 1,
          photos: [{ assetId: asset.id, width: 800, height: 600 }],
          constraints: {
            spreadCount: 1,
            minPhotosPerSpread: 1,
            maxPhotosPerSpread: 4,
            selectionPolicy: "all",
            duplicatePolicy: "forbid",
            orderPolicy: "user",
          },
          templateRef: {
            id: template.id,
            version: template.version,
            sha256: template.sha256,
          },
          algorithmVersion: "local-layout-v1",
          seed: 1,
        },
      } as any;
      const requestKey = id();
      const accepted = await layout.createCloudLayoutJob(
        actor,
        wid,
        doc.projectId,
        input,
        requestKey,
      );
      expect(
        (
          await layout.createCloudLayoutJob(
            actor,
            wid,
            doc.projectId,
            input,
            requestKey,
          )
        ).jobId,
      ).toBe(accepted.jobId);
      const lease = await jobs.claimJob(
        accepted.jobId,
        "layout-test",
        new Date().toISOString(),
      );
      expect(
        await layout.runCloudLayoutJob({ ...lease!, fence: lease!.fence + 1 }),
      ).toBe(false);
      expect(await layout.listCandidates(actor, wid, accepted.jobId)).toEqual(
        [],
      );
      await layout.runCloudLayoutJob(lease!);
      const candidates = await layout.listCandidates(
        actor,
        wid,
        accepted.jobId,
      );
      expect(candidates.length).toBeGreaterThan(0);
      const applied = await layout.applyCloudLayout(
        actor,
        wid,
        doc.projectId,
        candidates[0].id,
        1,
        id(),
      );
      expect(applied.doc.revision).toBe(2);
      await expect(
        layout.applyCloudLayout(
          actor,
          wid,
          doc.projectId,
          candidates[0].id,
          1,
          id(),
        ),
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      const foreign = (await ws.createWorkspace(actor, "studio", id()))
        .workspaceId;
      await expect(
        layout.listCandidates(actor, foreign, accepted.jobId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        db.pool.query("UPDATE ai_album.layout_candidates SET score=0"),
      ).rejects.toThrow();
    });
  },
);
