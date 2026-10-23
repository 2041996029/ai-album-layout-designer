import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
const input = new URL("../docs/ai-album-v0.1/filters.csv", import.meta.url);
const bytes = await readFile(input);
function columns(line: string): string[] {
  const cells: string[] = [];
  let cell = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (line[i] === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += line[i];
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  cells.push(cell);
  return cells;
}
const rows = bytes
  .toString("utf8")
  .replace(/^\uFEFF/, "")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map(columns);
const items = rows.map(
  ([
    id,
    name,
    category,
    recipeVersion,
    operationsInOrder,
    defaultStrength,
    seed,
  ]) => ({
    id,
    name,
    category,
    recipeVersion: Number(recipeVersion),
    operationsInOrder,
    defaultStrength: Number(defaultStrength),
    seed: Number(seed),
    visualReview: "required",
  }),
);
if (items.length !== 33) throw new Error("Expected 33 recipes");
const args = process.argv.slice(2),
  outIndex = args.indexOf("--output");
if (
  args.some(
    (a) =>
      !["--check", "--output"].includes(a) &&
      !(outIndex >= 0 && a === args[outIndex + 1]),
  )
)
  throw new Error("Unsupported argument");
if (outIndex >= 0 && !args[outIndex + 1])
  throw new Error("Missing --output filename");
const output =
  outIndex >= 0
    ? resolve(args[outIndex + 1])
    : new URL("../packages/render/manifests/filters-v1.json", import.meta.url);
const content =
  JSON.stringify(
    {
      kernelVersion: "cpu-srgb-v1",
      operationVersion: 1,
      sourceCsvSha256: createHash("sha256").update(bytes).digest("hex"),
      items,
    },
    null,
    2,
  ) + "\n";
if (args.includes("--check")) {
  let actual: string;
  try {
    actual = await readFile(output, "utf8");
  } catch {
    throw new Error("Filter manifest missing; run npm run build:filters");
  }
  if (actual !== content)
    throw new Error("Filter manifest stale; run npm run build:filters");
} else {
  await mkdir(
    typeof output === "string" ? dirname(output) : new URL(".", output),
    { recursive: true },
  );
  await writeFile(output, content);
}
