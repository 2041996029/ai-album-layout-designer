import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { join } from "node:path";
import type { ObjectStore } from "../../api/src/assets/types";
import type { FrozenExport } from "../../api/src/exports/service";
import { LocalCliRenderer } from "./render-job";
const { values } = parseArgs({ options: { input: { type: "string" } } });
if (!values.input || !process.send)
  throw Error("ATTEMPT_CONFIGURATION_REQUIRED");
const { frozen, ack, dir } = JSON.parse(
  await readFile(values.input, "utf8"),
) as { frozen: FrozenExport; ack: string[]; dir: string };
const pending = new Map<
    number,
    {
      bytes: Uint8Array;
      offset: number;
      resolve: (bytes: Uint8Array) => void;
      reject: (error: Error) => void;
    }
  >(),
  artifacts = new Map<number, () => void>();
let requestId = 0;
const send = (message: unknown) =>
  new Promise<void>((resolve, reject) =>
    process.send!(message as any, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
process.on("message", (message: any) => {
  if (message.type === "chunk") {
    const request = pending.get(message.id);
    if (!request) return;
    const chunk = message.bytes as Uint8Array;
    if (
      message.offset !== request.offset ||
      request.offset + chunk.length > request.bytes.length
    ) {
      request.reject(Error("INVALID_ATTEMPT_PROTOCOL"));
      return;
    }
    request.bytes.set(chunk, request.offset);
    request.offset += chunk.length;
    if (message.final) {
      pending.delete(message.id);
      if (request.offset !== request.bytes.length)
        request.reject(Error("INVALID_ATTEMPT_PROTOCOL"));
      else request.resolve(request.bytes);
    }
  } else if (message.type === "artifact-done") {
    artifacts.get(message.index)?.();
    artifacts.delete(message.index);
  }
});
const objects = {
  read: async (locator) => {
    const index = frozen.pins.findIndex(
      (p) =>
        p.locator.sha256 === locator.sha256 &&
        p.locator.key === locator.key &&
        p.locator.bucket === locator.bucket,
    );
    const pin = frozen.pins[index];
    if (!pin || pin.bytes > 64 * 1024 ** 2) throw Error("RESOURCE_EXHAUSTED");
    const id = requestId++;
    return new Promise<Uint8Array>((resolve, reject) => {
      pending.set(id, {
        bytes: new Uint8Array(pin.bytes),
        offset: 0,
        resolve,
        reject,
      });
      void send({ type: "read", id, index }).catch(reject);
    });
  },
} as ObjectStore;
try {
  const renderer = new LocalCliRenderer({
    objects,
    chromiumPath: process.env.CHROMIUM_PATH,
  });
  const rendered = await renderer.render(
    frozen,
    ack,
    new AbortController().signal,
  );
  await mkdir(join(dir, "transfer"), { mode: 0o700 });
  for (const [index, artifact] of rendered.entries()) {
    const { bytes, ...metadata } = artifact;
    await writeFile(join(dir, "transfer", artifact.filename), bytes, {
      mode: 0o600,
    });
    const consumed = new Promise<void>((resolve) =>
      artifacts.set(index, resolve),
    );
    await send({
      type: "artifact",
      index,
      ...metadata,
      byteLength: bytes.length,
    });
    await consumed;
  }
} catch (error) {
  await send({
    type: "failure",
    code: error instanceof Error ? error.message : "RENDER_FAILED",
  });
  process.exitCode = 1;
} finally {
  process.disconnect();
}
