import { it, expect } from "vitest";
import sharp from "sharp";
import { digest } from "@album/server-core";
import { JobRepository } from "@album/jobs";
import { aiFixture } from "../../api/test/ai-fixture";
import { UploadService } from "../../api/src/assets/upload";
import { GenerationService } from "../../api/src/ai/quotes";
import { GenerationOutputService } from "../../api/src/ai/output";
import { provisionDevelopmentStorage } from "../../api/src/assets/development";
import type { ObjectStore, StorageLocator } from "../../api/src/assets/types";
import { ProviderRegistry, ReplayProvider } from "@album/providers";
import { GenerationWorker } from "./generate-job";
for (const decision of [
  "approved",
  "rejected",
  "review",
  "accepted_timeout",
  "cancel_during_review",
  "forbidden_url",
  "commit_ack_lost",
] as const)
  it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
    `generation ${decision}: fenced output and credits/budget close once`,
    async () => {
      const f = await aiFixture();
      try {
        const registry = new ProviderRegistry();
        const provider = new ReplayProvider({
          outputUrl:
            decision === "forbidden_url"
              ? "https://untrusted.example.com/image.png"
              : undefined,
          scenario:
            decision === "accepted_timeout" ? "accepted_timeout" : "success",
        });
        registry.register(provider);
        const approved =
          decision === "approved" ||
          decision === "accepted_timeout" ||
          decision === "commit_ack_lost";
        const storage = await provisionDevelopmentStorage(f.database, "dev");
        const service = new GenerationService({
          db: f.database,
          workspaces: f.workspaces,
          registry,
          loadRelease: async () => f.release,
          environment: "dev",
          allowReplay: true,
          quota: {
            readQuota: async () => ({
              limitBytes: 100000000,
              maxProjectPhotos: 500,
            }),
          },
        });
        const q = await service.createGenerationQuote(f.actor, f.input);
        const job = await service.acceptGenerationQuote(
          f.actor,
          {
            quoteId: q.id,
            inputHash: q.inputHash,
            policyConsentVersion: q.policyVersion,
          },
          "worker-test",
        );
        const jobs = new JobRepository(
          f.database,
          async () => ({
            deployment: { global: 4, workspace: 1 },
            release: { global: 4, workspace: 1 },
            entitlement: { global: 4, workspace: 1 },
            leaseSeconds: 60,
            maxAttempts: 1,
            retryBackoffSeconds: [],
          }),
          async (tx, j, o) => {
            await service.credits.creditTerminalHook(tx, j, o);
            await service.terminalHook(tx, j, o);
          },
        );
        if (decision === "commit_ack_lost") {
          const finish = jobs.finishJob.bind(jobs);
          jobs.finishJob = async (...args) => {
            const done = await finish(...args);
            if (done && args[1].state === "succeeded")
              throw Error("COMMIT_ACK_LOST");
            return done;
          };
        }
        const blobs = new Map<string, Uint8Array>();
        let signedKey = "";
        const objects: ObjectStore = {
          put: async (l, b) => {
            blobs.set(l.key, b);
          },
          read: async (l) => blobs.get(l.key)!,
          head: async (l) => ({
            bytes: blobs.get(l.key)!.length,
            sha256: digest(blobs.get(l.key)!),
          }),
          remove: async (l) => {
            blobs.delete(l.key);
          },
          sign: async (locator) => {
            signedKey = locator.key;
            return "https://private.example.com/output";
          },
        };
        if (decision === "approved") {
          const uploads = new UploadService(
            f.database,
            f.workspaces,
            objects,
            {
              readQuota: async () => ({
                limitBytes: 100000000,
                maxProjectPhotos: 500,
              }),
            },
            storage,
          );
          await expect(
            uploads.beginUpload(
              f.actor,
              f.wid,
              {
                bytes: 100,
                sha256: "a".repeat(64),
                mime: "image/png",
                folderId: null,
                projectId: null,
              },
              "quota-cross-category",
            ),
          ).rejects.toThrow("STORAGE_QUOTA_EXCEEDED");
        }
        const bytes = await sharp({
          create: {
            width: 128,
            height: 128,
            channels: 3,
            background: "#abcdef",
          },
        })
          .png()
          .toBuffer();
        const output = new GenerationOutputService({
          db: f.database,
          objects,
          storage,
          moderator: {
            review: async () => {
              if (decision === "cancel_during_review")
                await jobs.requestCancel(f.actor, f.wid, job.jobId);
              return {
                state:
                  decision === "rejected" || decision === "review"
                    ? decision
                    : "approved",
                reasonCode: decision,
                policyVersion: "moderation@1",
                reviewId: null,
              };
            },
          },
          allowedResultHosts: ["outputs.example.com"],
          labelPolicies: new Set(["label@1"]),
          download: async () => bytes,
        });
        const worker = new GenerationWorker({
          db: f.database,
          jobs,
          registry,
          output,
          makeContext: async (m) => ({
            connectionVersionId: m.providerVersionId,
            secretRef: m.secretRef,
            secretVersion: m.secretVersion,
            endpoint: m.endpoint,
            allowedResultHosts: ["outputs.example.com"],
          }),
        });
        const lease = await jobs.claimJob(
          job.jobId,
          "worker",
          new Date().toISOString(),
        );
        expect(lease).not.toBeNull();
        await worker.runGenerationJob(lease!, new AbortController().signal);
        if (decision === "accepted_timeout") {
          await f.pool.query(
            "UPDATE ai_album.jobs SET lease_expires_at=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1",
            [job.jobId],
          );
          await jobs.recoverExpiredJobs(100);
          const next = await jobs.claimJob(
            job.jobId,
            "confirmer",
            new Date().toISOString(),
          );
          expect(next).not.toBeNull();
          await worker.runGenerationJob(next!, new AbortController().signal);
        }
        await worker.runGenerationJob(lease!, new AbortController().signal);
        const final = (
          await f.pool.query(
            "SELECT state,error_code FROM ai_album.jobs WHERE id=$1",
            [job.jobId],
          )
        ).rows[0];
        expect(final, JSON.stringify(final)).toMatchObject({
          state: approved
            ? "succeeded"
            : decision === "cancel_during_review"
              ? "cancelled"
              : "failed",
        });
        expect(
          (
            await f.pool.query(
              "SELECT count(*) FROM ai_album.generation_provenance",
            )
          ).rows[0].count,
        ).toBe(approved ? "1" : "0");
        expect(
          (
            await f.pool.query(
              "SELECT reserved_fen,spent_fen FROM ai_album.budget_days",
            )
          ).rows[0],
        ).toMatchObject({ reserved_fen: "0", spent_fen: "1" });
        expect(
          (
            await f.pool.query(
              "SELECT state FROM ai_album.storage_quota_reservations",
            )
          ).rows[0].state,
        ).toBe(approved ? "consumed" : "released");
        await output.cleanupStaged();
        expect(
          (
            await f.pool.query(
              "SELECT count(*) FROM ai_album.generation_staged_objects",
            )
          ).rows[0].count,
        ).toBe("0");
        if (approved) {
          const asset = (
            await f.pool.query(
              "SELECT id FROM ai_album.assets WHERE origin='generated'",
            )
          ).rows[0];
          const uploads = new UploadService(
            f.database,
            f.workspaces,
            objects,
            {
              readQuota: async () => ({
                limitBytes: 100000000,
                maxProjectPhotos: 500,
              }),
            },
            storage,
          );
          await uploads.download(f.actor, f.wid, asset.id, "original");
          expect(signedKey).toMatch(/original\.png$/);
          const metadata = await uploads.getAsset(f.actor, f.wid, asset.id);
          expect(digest(blobs.get(signedKey)!)).toBe(
            metadata.editorResource!.variants.original.sha256,
          );
          expect(metadata.editorResource!.variants.original.sha256).toBe(
            metadata.editorResource!.variants.normalized.sha256,
          );
        }
        expect(
          (await f.pool.query("SELECT available FROM ai_album.credit_lots"))
            .rows[0].available,
        ).toBe(approved ? "99" : "100");
        expect(provider.submissions).toBe(1);
        expect(blobs.size).toBe(approved ? 3 : 0);
      } finally {
        await f.close();
      }
    },
    60000,
  );
