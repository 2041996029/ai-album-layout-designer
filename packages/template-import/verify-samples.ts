import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseMjtpl, convertMjtpl } from "./src/index";
const dir =
  process.argv[process.argv.indexOf("--dir") + 1] ??
  process.env.MJTPL_SAMPLE_DIR;
if (!dir) {
  console.log(
    JSON.stringify({
      skipped: true,
      reason: "Use --dir <private sample directory>",
    }),
  );
} else {
  async function* paths(d: string): AsyncGenerator<string> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) yield* paths(p);
      else if (e.name.endsWith(".mjtpl")) yield p;
    }
  }
  for await (const p of paths(dir)) {
    try {
      const parsed = await parseMjtpl(
          new Uint8Array(await readFile(p)),
          new AbortController().signal,
        ),
        result = await convertMjtpl(parsed, new AbortController().signal);
      console.log(
        JSON.stringify({
          file: p.split("/").at(-1),
          bytes: (await readFile(p)).length,
          sourceHash: parsed.sourceHash,
          pages: result.theme.pages.length,
          slots: result.theme.pages.reduce(
            (n, p) => n + p.photoSlots.length,
            0,
          ),
          warnings: result.theme.issues.filter((i) => i.severity === "warning")
            .length,
          blockers: result.theme.issues.filter((i) => i.severity === "blocker"),
          comparison:
            "Structural verification only; rendered visual comparison pending",
        }),
      );
    } catch (e) {
      console.log(JSON.stringify({ file: p, error: String(e) }));
      process.exitCode = 1;
    }
  }
}
