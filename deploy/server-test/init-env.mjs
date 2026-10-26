#!/usr/bin/env node
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    directory: { type: "string" },
    origin: { type: "string" },
    port: { type: "string" },
  },
});
const directory = resolve(
  values.directory ?? dirname(fileURLToPath(import.meta.url)),
);
const port = Number(values.port ?? 8080);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("ALBUM_PORT must be an integer from 1024 to 65535");
const origin = new URL(values.origin ?? `http://127.0.0.1:${port}`);
if (
  !["http:", "https:"].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== "/"
)
  throw Error(
    "Origin must be an http(s) origin without a path, query or credentials",
  );
await mkdir(directory, { recursive: true });
await mkdir(resolve(directory, ".secrets"), { recursive: true, mode: 0o700 });
for (const name of [
  "postgres_password",
  "auth_signing",
  "object_signing",
  "redemption_pepper",
]) {
  const path = resolve(directory, ".secrets", name);
  try {
    await writeFile(path, randomBytes(32).toString("hex") + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const value = (await readFile(path, "utf8")).trim();
    if (value.length < 32)
      throw Error(`Existing ${name} is too short; it was not overwritten`);
  }
  if (((await stat(path)).mode & 0o077) !== 0)
    throw Error(
      `${name} has broad permissions; restrict it to its owner before continuing`,
    );
}
const envPath = resolve(directory, ".env");
const env = `# Server test only. Keep this file and .secrets private.\nALBUM_ORIGIN=${origin.origin}\nALBUM_BIND=127.0.0.1\nALBUM_PORT=${port}\n`;
try {
  await writeFile(envPath, env, { flag: "wx", mode: 0o600 });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const current = await readFile(envPath, "utf8");
  if (
    values.origin &&
    !current.split("\n").includes(`ALBUM_ORIGIN=${origin.origin}`)
  )
    throw Error(
      "Existing origin differs. Existing .env and all secrets were preserved; edit the origin deliberately.",
    );
}
console.log(
  "Server test configuration ready. Existing configuration and secrets preserved; no secret values printed.",
);
