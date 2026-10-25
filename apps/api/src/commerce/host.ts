import { Queue, Worker } from "bullmq";
import { BullMqScheduler, OutboxDispatcher } from "@album/jobs";
import type { ApiRuntime } from "../http/runtime";
import { startExportWorker } from "../../../export-worker/src/main";
/** SQL recovery survives an empty Redis queue and process restarts. Each cycle is bounded. */
export function startCommerceHost(runtime: ApiRuntime, redisUrl?: string) {
  const s = runtime.commerce!;
  const queue = redisUrl
    ? new Queue("album-c4", {
        connection: {
          host: new URL(redisUrl).hostname,
          port: Number(new URL(redisUrl).port || 6379),
          ...(new URL(redisUrl).password
            ? { password: decodeURIComponent(new URL(redisUrl).password) }
            : {}),
        },
      })
    : undefined;
  const dispatcher = queue
    ? new OutboxDispatcher(runtime.db, new BullMqScheduler(queue), s.jobs)
    : undefined;
  const runLayout = async (jobId: string) => {
    if (!runtime.cloudLayout) return;
    const exists = await runtime.db.transaction(
      async (tx) =>
        (
          await tx.query("SELECT id FROM jobs WHERE id=$1 AND kind='layout'", [
            jobId,
          ])
        ).rowCount,
    );
    if (!exists) return;
    let lease = await s.jobs.claimJob(
      jobId,
      `layout-${process.pid}`,
      new Date().toISOString(),
    );
    if (!lease) return;
    let renewing = false;
    const timer = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      try {
        lease = await s.jobs.renewLease(lease!, new Date().toISOString());
      } catch {
      } finally {
        renewing = false;
      }
    }, 5000);
    timer.unref();
    try {
      await runtime.cloudLayout.runCloudLayoutJob(lease);
    } catch {
      await s.jobs.failAttempt(lease, {
        code: "LAYOUT_FAILED",
        retryable: false,
        definite: true,
      });
    } finally {
      clearInterval(timer);
    }
  };
  const worker = queue
    ? s.options.exports
      ? startExportWorker({
          db: runtime.db,
          ...s.options.exports,
          identity: s.options.exports.renderer,
          policy: s.policy,
          queue,
          workerId: `export-${process.pid}`,
          heartbeatSeconds: 5,
          chromiumPath: process.env.CHROMIUM_PATH,
          onTerminal: s.credits.creditTerminalHook,
          runOtherJob: runLayout,
        })
      : new Worker(queue.name, (message) => runLayout(message.data.jobId), {
          connection: queue.opts.connection,
          concurrency: 1,
        })
    : undefined;
  let running: Promise<void> | undefined;
  const recover = async () => {
    await s.orders.reconcileDue(100);
    await s.refunds.recoverPending(100);
    await s.refunds.recoverVerifiedReceipts(100);
    await dispatcher?.dispatchOutbox(100);
    await s.exports?.expireArtifacts(100);
  };
  const tick = () => {
    if (!running)
      running = recover()
        .catch(() => {})
        .finally(() => {
          running = undefined;
        });
  };
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return {
    recover,
    queue,
    worker,
    close: async () => {
      clearInterval(timer);
      await running;
      await worker?.close();
      await queue?.close();
    },
  };
}
