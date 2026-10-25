import { readFile } from "node:fs/promises";
import YAML from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { fail } from "@album/server-core";
export async function loadContracts() {
  const contract = YAML.parse(
    await readFile(
      new URL(
        "../../../../docs/release-v1.0/contracts/openapi.yaml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    coerceTypes: false,
  });
  addFormats(ajv);
  const base = "https://album.local/openapi";
  for (const file of ["document", "layout", "config", "export", "provider"]) {
    const schema = JSON.parse(
      await readFile(
        new URL(
          `../../../../docs/release-v1.0/contracts/schemas/${file}.schema.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    ajv.addSchema(schema, `https://album.local/schemas/${file}.schema.json`);
  }
  ajv.addSchema({ ...contract, $id: base }, base);
  const cache = new Map<string, any>();
  const validate = (schema: any, value: any) => {
    if (!schema) return;
    const key = JSON.stringify(schema);
    let checker = cache.get(key);
    if (!checker) {
      checker = ajv.compile({
        $id: `https://album.local/check-${cache.size}`,
        ...schema,
      });
      cache.set(key, checker);
    }
    if (!checker(value))
      fail(
        "VALIDATION_FAILED",
        422,
        checker.errors?.map((e: any) => ({
          path: e.instancePath,
          keyword: e.keyword,
        })),
      );
  };
  const resolve = (value: any): any =>
    value?.$ref?.startsWith("#/")
      ? value.$ref
          .slice(2)
          .split("/")
          .reduce((v: any, k: string) => v[k], contract)
      : value;
  // Keep all refs rooted in the canonical contract, not the per-operation validator.
  const rooted = (schema: any): any => {
    if (Array.isArray(schema)) return schema.map(rooted);
    if (schema && typeof schema === "object")
      return Object.fromEntries(
        Object.entries(schema).map(([k, v]) => [
          k,
          k === "$ref" && typeof v === "string"
            ? v.startsWith("#")
              ? base + v
              : new URL(v, base).href
            : rooted(v),
        ]),
      );
    return schema;
  };
  return {
    contract,
    resolve,
    validate: (schema: any, value: any) => validate(rooted(schema), value),
  };
}
