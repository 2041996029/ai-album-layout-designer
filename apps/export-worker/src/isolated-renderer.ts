import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, fail } from "@album/server-core";
import { MAX_ENCODED_BYTES } from "@album/export";
import type { ObjectStore } from "../../api/src/assets/types";
import type { FrozenExport } from "../../api/src/exports/service";
import {
  runBoundedNode,
  type RenderPort,
  type RenderedArtifact,
} from "./render-job";
type ArtifactMessage = {
  type: "artifact";
  index: number;
  filename: string;
  mime: string;
  sha256: string;
  width?: number;
  height?: number;
  byteLength: number;
};
/** Only metadata and one bounded object cross the consumer boundary. All assembly/decoding/postprocessing lives in the child. */
export class CliRenderer implements RenderPort {
  constructor(
    private options: { objects: ObjectStore; chromiumPath?: string },
  ) {}
  async *render(
    frozen: FrozenExport,
    ack: string[],
    signal: AbortSignal,
  ): AsyncGenerator<RenderedArtifact> {
    const dir = await mkdtemp(join(tmpdir(), "album-attempt-")),
      controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const budget = Math.min(2048, frozen.policy.workerBudgetMiB) * 1024 ** 2;
    const maximumTransfer = Math.min(MAX_ENCODED_BYTES, Math.floor(budget / 4));
    const messages: ArtifactMessage[] = [];
    let wake: (() => void) | undefined,
      done = false,
      failure: unknown,
      sender: ((m: unknown) => Promise<void>) | undefined;
    const notify = () => {
      wake?.();
      wake = undefined;
    };
    let task: Promise<void> | undefined;
    try {
      const input = join(dir, "request.json");
      await writeFile(input, JSON.stringify({ frozen, ack, dir }), {
        mode: 0o600,
      });
      task = runBoundedNode(
        "apps/export-worker/src/attempt-cli.ts",
        ["--input", input],
        controller.signal,
        { memoryBytes: budget, timeoutMs: 300000 },
        {
          ALBUM_SUPERVISED_ATTEMPT: "1",
          TMPDIR: dir,
          CHROMIUM_PATH: this.options.chromiumPath ?? process.env.CHROMIUM_PATH,
        },
        async (message, send) => {
          sender = send;
          if (message.type === "read") {
            const pin = frozen.pins[message.index];
            if (
              !pin ||
              !Number.isSafeInteger(pin.bytes) ||
              pin.bytes > Math.min(64 * 1024 ** 2, maximumTransfer)
            )
              fail("RESOURCE_EXHAUSTED");
            const bytes = await this.options.objects.read(pin.locator);
            controller.signal.throwIfAborted();
            if (
              bytes.length !== pin.bytes ||
              digest(bytes) !== pin.locator.sha256
            )
              fail("RESOURCE_HASH_MISMATCH");
            for (let offset = 0; offset < bytes.length; offset += 65536) {
              controller.signal.throwIfAborted();
              const chunk = bytes.subarray(offset, offset + 65536);
              await send({
                type: "chunk",
                id: message.id,
                offset,
                bytes: chunk,
                final: offset + chunk.length === bytes.length,
              });
            }
          } else if (message.type === "artifact") {
            if (
              !/^[A-Za-z0-9_.-]+$/.test(message.filename) ||
              !Number.isSafeInteger(message.byteLength) ||
              message.byteLength < 1 ||
              message.byteLength > maximumTransfer
            )
              fail("RESOURCE_EXHAUSTED");
            messages.push(message);
            notify();
          } else if (message.type === "failure")
            throw Error(
              message.code === "RESOURCE_EXHAUSTED"
                ? "RESOURCE_EXHAUSTED"
                : "RENDER_FAILED",
            );
          else throw Error("INVALID_ATTEMPT_PROTOCOL");
        },
      )
        .catch((error) => {
          failure = error;
        })
        .finally(() => {
          done = true;
          notify();
        });
      let total = 0,
        index = 0;
      while (!done || messages.length) {
        if (!messages.length) {
          await new Promise<void>((resolve) => (wake = resolve));
          continue;
        }
        const message = messages.shift()!;
        if (message.index !== index++) fail("INVALID_ATTEMPT_PROTOCOL");
        const path = join(dir, "transfer", message.filename),
          size = (await stat(path)).size;
        total += size;
        if (
          size !== message.byteLength ||
          total > MAX_ENCODED_BYTES ||
          total > frozen.reservedBytes
        )
          fail("RESOURCE_EXHAUSTED");
        const bytes = await readFile(path);
        if (digest(bytes) !== message.sha256) fail("ARTIFACT_HASH_MISMATCH");
        const { type: _, index: __, byteLength: ___, ...metadata } = message;
        yield { ...metadata, bytes };
        await rm(path);
        await sender!({ type: "artifact-done", index: message.index });
      }
      await task;
      if (failure) throw failure;
    } finally {
      controller.abort(new Error("ATTEMPT_FINISHED"));
      await task;
      signal.removeEventListener("abort", abort);
      await rm(dir, { recursive: true, force: true });
    }
  }
}
