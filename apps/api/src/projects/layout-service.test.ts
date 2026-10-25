import { bindCommerceRuntime } from "../commerce/runtime";
import { startCommerceHost } from "../commerce/host";
import { createApplication } from "../app.module";
import { ReauthService } from "../auth/reauthentication";
import { payloadHash, type ConfigPayload } from "../config/types";
import type { ApiRuntime } from "../http/runtime";
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
    let db: Awaited<ReturnType<typeof testDatabase>>,
      root: string,
      app: any,
      host: ReturnType<typeof startCommerceHost> | undefined;
    beforeAll(async () => {
      db = await testDatabase();
      root = await mkdtemp(tmpdir() + "/layout-c4-");
    });
    afterAll(async () => {
      await host?.close();
      await app?.close();
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
      const rid = id(),
        payloads: ConfigPayload[] = [
          {
            kind: "layout",
            algorithmVersion: "local-layout-v1",
            candidateCount: 3,
            minPhotosPerSpread: 1,
            maxPhotosPerSpread: 4,
            selectionPolicy: "all",
            duplicatePolicy: "forbid",
            weights: {
              subject: 0.3,
              timeline: 0.2,
              whitespace: 0.2,
              variety: 0.2,
              color: 0.1,
            },
          },
          {
            kind: "queue",
            workerKind: "layout",
            maxGlobalConcurrency: 4,
            maxWorkspaceConcurrency: 2,
            leaseSeconds: 60,
            heartbeatSeconds: 5,
            retryLimit: 3,
            maxWaitingSeconds: 600,
            retryBackoffSeconds: [10, 30, 90],
            maxAttemptsPerTask: 4,
          },
        ];
      const versions = Object.fromEntries(
          payloads.map((payload) => [
            payload.kind,
            {
              id: id(),
              namespace: payload.kind,
              version: 1,
              revision: 1,
              environment: "dev",
              state: "published",
              payload,
              payloadHash: payloadHash(payload),
            },
          ]),
        ),
        manifest = {
          versions,
          sourceDrafts: {},
          reason: "local layout",
          previousReleaseId: null,
        };
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',1,1,$2,$3,$4)",
          [rid, payloadHash(manifest), manifest, actor.userId],
        );
        for (const v of Object.values(versions))
          await tx.query(
            "INSERT INTO config_release_items(id,release_id,namespace,schema_version,body_hash,body) VALUES($1,$2,$3,1,$4,$5)",
            [id(), rid, v.namespace, v.payloadHash, v.payload],
          );
        await tx.query(
          "INSERT INTO config_active_releases(id,environment,release_id) VALUES($1,'dev',$2)",
          [id(), rid],
        );
      });
      const runtime: ApiRuntime = {
        db: db.database,
        auth,
        workspaces: ws,
        revisions,
        environment: "dev",
        allowedOrigin: "https://album.test",
      };
      await bindCommerceRuntime(
        runtime,
        new ReauthService(db.database, auth, {}),
      );
      const jobs = runtime.commerce!.jobs,
        layout = runtime.cloudLayout!;
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
      const retrySource = await layout.createCloudLayoutJob(
        actor,
        wid,
        doc.projectId,
        input,
        id(),
      );
      await jobs.requestCancel(actor, wid, retrySource.jobId);
      const revision = Number(
        (
          await db.pool.query(
            "SELECT revision FROM ai_album.jobs WHERE id=$1",
            [retrySource.jobId],
          )
        ).rows[0].revision,
      );
      const retried = await layout.retryCloudLayoutJob(
        actor,
        wid,
        retrySource.jobId,
        revision,
        "retry layout",
        id(),
      );
      expect(
        (
          await db.pool.query(
            "SELECT parent_job_id FROM ai_album.jobs WHERE id=$1",
            [retried.jobId],
          )
        ).rows[0].parent_job_id,
      ).toBe(retrySource.jobId);
      // Begin with the actual failure normalizer; production stores RESOURCE_EXHAUSTED.
      const oom = await layout.createCloudLayoutJob(
        actor,
        wid,
        doc.projectId,
        input,
        id(),
      );
      const oomLease = await jobs.claimJob(
        oom.jobId,
        "oom-test",
        new Date().toISOString(),
      );
      await jobs.failAttempt(oomLease!, {
        code: "OOM",
        retryable: false,
        definite: true,
      });
      const oomRow = (
        await db.pool.query(
          "SELECT error_code,revision FROM ai_album.jobs WHERE id=$1",
          [oom.jobId],
        )
      ).rows[0];
      expect(oomRow.error_code).toBe("RESOURCE_EXHAUSTED");
      await expect(
        layout.retryCloudLayoutJob(
          actor,
          wid,
          oom.jobId,
          Number(oomRow.revision),
          "same specification",
          id(),
        ),
      ).rejects.toMatchObject({ code: "RESOURCE_BUDGET_REVIEW_REQUIRED" });
      const requestKey = id();
      const accepted = await layout.createCloudLayoutJob(
        actor,
        wid,
        doc.projectId,
        input,
        requestKey,
      );
      const counts = async () =>
        (
          await db.pool.query(
            "SELECT (SELECT count(*) FROM ai_album.job_snapshots WHERE workspace_id=$1) AS snapshots,(SELECT count(*) FROM ai_album.resource_pins WHERE workspace_id=$1) AS pins",
            [wid],
          )
        ).rows[0];
      const beforeReplay = await counts();
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
      expect(await counts()).toEqual(beforeReplay);
      await expect(
        layout.createCloudLayoutJob(
          actor,
          wid,
          doc.projectId,
          { layoutSpec: { ...input.layoutSpec, seed: 99 } },
          requestKey,
        ),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
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
      expect(candidates[0].score).toBeLessThan(1);
      const applied = await layout.applyCloudLayout(
        actor,
        wid,
        doc.projectId,
        candidates[0].id,
        1,
        id(),
      );
      expect(applied.doc.revision).toBe(2);
      const nextRelease = id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',2,1,$2,$3,$4)",
          [nextRelease, payloadHash(manifest), manifest, actor.userId],
        );
        for (const v of Object.values(versions))
          await tx.query(
            "INSERT INTO config_release_items(id,release_id,namespace,schema_version,body_hash,body) VALUES($1,$2,$3,1,$4,$5)",
            [id(), nextRelease, v.namespace, v.payloadHash, v.payload],
          );
        await tx.query(
          "UPDATE config_active_releases SET release_id=$1 WHERE environment='dev'",
          [nextRelease],
        );
      });
      const afterApply = await counts();
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
      expect(await counts()).toEqual(afterApply);
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
      if (process.env.C4_TEST_REDIS_URL) {
        const session = await auth.createWebSession(actor);
        app = await createApplication(runtime);
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
        const acceptedHttp = await call(
          "POST",
          `/v1/projects/${doc.projectId}/layout-jobs`,
          { layoutSpec: { ...input.layoutSpec, baseRevision: 2 } },
        );
        expect(acceptedHttp.statusCode, acceptedHttp.body).toBe(202);
        host = startCommerceHost(runtime, process.env.C4_TEST_REDIS_URL);
        await host.recover();
        const httpJob = acceptedHttp.json().data.id;
        await expect
          .poll(
            async () => {
              const r = await call("GET", `/v1/jobs/${httpJob}`);
              return r.json().data?.state;
            },
            { timeout: 15000 },
          )
          .toBe("succeeded");
        const result = await call(
          "GET",
          `/v1/jobs/${httpJob}/layout-candidates`,
        );
        expect(result.statusCode, result.body).toBe(200);
        expect(result.json().data.items.length).toBeGreaterThan(0);
        const appliedHttp = await call(
          "POST",
          `/v1/projects/${doc.projectId}/apply-layout`,
          {
            candidateId: result.json().data.items[0].id,
            baseRevision: 2,
            commandId: id(),
          },
          { "if-match": '"2"' },
        );
        expect(appliedHttp.statusCode, appliedHttp.body).toBe(200);
        expect(appliedHttp.json().data.document.revision).toBe(3);
      }
      await expect(
        db.pool.query("UPDATE ai_album.layout_candidates SET score=0"),
      ).rejects.toThrow();
    });
  },
);
