import { readFile, mkdir, chown } from "node:fs/promises";
import { spawn } from "node:child_process";
const secret = async (name) => {
  const value = (await readFile("/run/secrets/" + name, "utf8")).trim();
  if (value.length < 32)
    throw Error("Required server secret is missing or too short: " + name);
  return value;
};
const password = await secret("postgres_password");
process.env.C3_DATABASE_URL = `postgresql://album:${encodeURIComponent(password)}@postgres:5432/album_dev`;
process.env.C3_AUTH_SECRET = await secret("auth_signing");
process.env.C3_LOCAL_OBJECT_SECRET = await secret("object_signing");
process.env.C4_REDEMPTION_PEPPER = await secret("redemption_pepper");
const storage = process.env.C3_LOCAL_STORAGE_ROOT;
await mkdir(storage, { recursive: true });
if (process.getuid?.() === 0) {
  await chown(storage, 1000, 1000);
  process.setgid(1000);
  process.setuid(1000);
}
const child = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "apps/api/src/main.ts"],
  { stdio: "inherit", env: process.env },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code, signal) =>
  process.exit(code ?? (signal === "SIGTERM" ? 0 : 1)),
);
