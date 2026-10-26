#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
const { values } = parseArgs({
  options: { root: { type: "string" }, output: { type: "string" } },
});
const root = resolve(values.root ?? ".");
const output = resolve(values.output ?? "artifacts/HuaNian_SheJi-source.zip");
const files = execFileSync("git", ["-C", root, "ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .filter((name) => {
    if (
      name
        .split("/")
        .some((p) =>
          [
            ".git",
            "node_modules",
            "dist",
            ".secrets",
            "backups",
            ".backups",
            "attachments",
            ".superpowers",
            "test-results",
            "playwright-report",
          ].includes(p),
        )
    )
      return false;
    if (
      /(^|\/)\.env(?:\..*)?$/.test(name) &&
      !name.endsWith("/.env.example") &&
      name !== ".env.example"
    )
      return false;
    if (/(?:\.pem|\.key|\.p12|\.pfx|\.log)$/.test(name)) return false;
    if (
      name.startsWith("docs/") &&
      !name.startsWith("docs/export-samples/") &&
      /\.(zip|pdf|docx)$/.test(name)
    )
      return false;
    return (
      /^(?:apps|packages|scripts|deploy|tests|tools|\.github|docs)\//.test(
        name,
      ) ||
      /^(?:package(?:-lock)?\.json|README\.md|tsconfig\.json|[^/]+\.config\.ts|\.gitignore|\.dockerignore|\.nvmrc|\.gitattributes)$/.test(
        name,
      )
    );
  });
if (!files.includes("package.json"))
  throw Error("Source package requires a tracked package.json");
const content = {};
const records = [];
for (const name of files) {
  const data = await readFile(resolve(root, name));
  content["HuaNian_SheJi/" + name] = new Uint8Array(data);
  records.push({
    path: name,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
const manifest = { format: 1, sourceFiles: records.length, files: records };
content["HuaNian_SheJi/DEPLOYMENT-MANIFEST.json"] = strToU8(
  JSON.stringify(manifest, null, 2) + "\n",
);
const archive = zipSync(content, { level: 6 });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, archive);
const hash = createHash("sha256").update(archive).digest("hex");
await writeFile(output + ".sha256", `${hash}  ${basename(output)}\n`);
console.log(
  `Source package: ${output}\nFiles: ${records.length}\nBytes: ${archive.length}\nSHA256: ${hash}`,
);
