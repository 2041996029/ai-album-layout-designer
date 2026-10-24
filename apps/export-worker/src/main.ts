import { pathToFileURL } from "node:url";
import { Worker, type Queue } from "bullmq";
import {
  JobRepository,
  type PolicyPort,
  type TerminalCommit,
} from "@album/jobs";
import type { Database } from "@album/server-core";
import {
  exportTerminalHook,
  type RendererIdentity,
} from "../../api/src/exports/service";
import type { ObjectStore, StorageConfig } from "../../api/src/assets/types";
import { CliRenderer, ExportWorker } from "./render-job";
export { ExportWorker, CliRenderer } from "./render-job";
export { BrowserPreflight } from "./preflight";
/** Host supplies configured private storage, frozen-release policy and the disposable scheduler. */
export function startExportWorker(options: {
  db: Database;
  objects: ObjectStore;
  storage: StorageConfig;
  identity: RendererIdentity;
  policy: PolicyPort;
  queue: Queue;
  workerId: string;
  heartbeatSeconds: number;
  chromiumPath?: string;
  onTerminal?: TerminalCommit;
}) {
  if (
    !Number.isInteger(options.heartbeatSeconds) ||
    options.heartbeatSeconds < 1
  )
    throw Error("INVALID_HEARTBEAT");
  const jobs = new JobRepository(
    options.db,
    options.policy,
    async (tx, job, outcome) => {
      await exportTerminalHook(tx, job, outcome);
      await options.onTerminal?.(tx, job, outcome);
    },
  );
  const executor = new ExportWorker({
    ...options,
    jobs,
    renderer: new CliRenderer({
      objects: options.objects,
      chromiumPath: options.chromiumPath,
    }),
  });
  const active = new Set<AbortController>();
  const worker = new Worker(
    options.queue.name,
    async (message) => {
      const exportJob = await options.db.transaction(
        async (tx) =>
          (
            await tx.query(
              "SELECT id FROM jobs WHERE id=$1 AND kind='export'",
              [message.data.jobId],
            )
          ).rows[0],
      );
      if (!exportJob) return;
      let lease = await jobs.claimJob(
        message.data.jobId,
        options.workerId,
        new Date().toISOString(),
      );
      if (!lease) return;
      const controller = new AbortController();
      active.add(controller);
      let renewing = false;
      const heartbeat = setInterval(async () => {
        if (renewing) return;
        renewing = true;
        try {
          lease = await jobs.renewLease(lease!, new Date().toISOString());
          if (lease.job.cancelRequested)
            controller.abort(new Error("JOB_CANCELLED"));
        } catch {
          controller.abort(new Error("JOB_LEASE_LOST"));
        } finally {
          renewing = false;
        }
      }, options.heartbeatSeconds * 1000);
      heartbeat.unref();
      try {
        await executor.renderExportJob(lease, controller.signal);
      } finally {
        clearInterval(heartbeat);
        active.delete(controller);
      }
    },
    { connection: options.queue.opts.connection, concurrency: 1 },
  );
  let cleaning = false;
  const cleanupTimer = setInterval(async () => {
    if (cleaning) return;
    cleaning = true;
    try {
      await executor.recoverStagedArtifacts(100);
    } catch {
      /* Durable intents remain available. */
    } finally {
      cleaning = false;
    }
  }, 10000);
  cleanupTimer.unref();
  return {
    jobs,
    executor,
    close: async () => {
      clearInterval(cleanupTimer);
      for (const controller of active)
        controller.abort(new Error("WORKER_SHUTDOWN"));
      await worker.close();
    },
  };
}
// No default credentials or local simulation are silently activated in a standalone process.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.error(
    "EXPORT_WORKER_UNCONFIGURED: compose startExportWorker with server ports",
  );
  process.exitCode = 1;
}
