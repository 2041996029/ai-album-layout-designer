import { writeFile, readFile } from "node:fs/promises";
const { default: openapiTS, astToString } = await import(
  new URL(
    "../tools/api-codegen/node_modules/openapi-typescript/dist/index.mjs",
    import.meta.url,
  ).href
);
const ast = await openapiTS(
  new URL("../docs/release-v1.0/contracts/openapi.yaml", import.meta.url),
);
const output =
  "// Generated from release-v1.0/contracts/openapi.yaml. Do not edit.\n" +
  astToString(ast);
const target = new URL("../packages/contracts/src/api.ts", import.meta.url);
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== output)
    throw Error("API_TYPES_STALE");
} else await writeFile(target, output);
