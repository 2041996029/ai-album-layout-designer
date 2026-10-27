import { AiCatalog } from "./catalog";
import { aiFixture } from "../../test/ai-fixture";
import { it, expect } from "vitest";
import {
  validateLicense,
  renderPresetPrompt,
  originalPresets,
} from "./catalog";
const license: any = {
  id: "license",
  version: 1,
  source: "original",
  author: "creator",
  termsVersion: "v1",
  commercialAllowed: true,
  allowReference: true,
  allowModification: true,
  allowRedistribution: true,
  attribution: null,
  expiresAt: null,
  territories: ["CN"],
};
it("commercial, expiry and reference rights are verified independently", () => {
  expect(() =>
    validateLicense(
      { ...license, commercialAllowed: false },
      new Date(),
      "CN",
      false,
    ),
  ).toThrow("LICENSE_NOT_COMMERCIAL");
  expect(() =>
    validateLicense(
      { ...license, expiresAt: "2000-01-01T00:00:00Z" },
      new Date(),
      "CN",
      false,
    ),
  ).toThrow("LICENSE_EXPIRED");
  expect(() =>
    validateLicense(
      { ...license, allowReference: false },
      new Date(),
      "CN",
      true,
    ),
  ).toThrow("REFERENCE_NOT_LICENSED");
});
it("only literal description interpolation is permitted in original prompts", () => {
  expect(originalPresets.map((p) => p.name)).toEqual([
    "山水水墨",
    "人像淡彩",
    "花鸟写意",
  ]);
  expect(renderPresetPrompt("墨色：{{description}}", "竹林")).toBe(
    "墨色：竹林",
  );
  expect(() => renderPresetPrompt("{{process.env.SECRET}}", "x")).toThrow(
    "PRESET_VARIABLE_UNSUPPORTED",
  );
});
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "real catalog publication enforces roles and refuses unverified models and noncommercial presets",
  async () => {
    const { aiFixture } = await import("../../test/ai-fixture");
    const { AiCatalog } = await import("./catalog");
    const { id } = await import("@album/server-core");
    const f = await aiFixture();
    try {
      const c = new AiCatalog(f.database, f.auth, f.registry, "dev");
      const noncommercial = id();
      await f.pool.query(
        "INSERT INTO ai_album.license_versions(id,license_key,version,source_uri,terms_hash,commercial_allowed,valid_from,territories) VALUES($1,$2,1,'original:test',$3,false,now()-interval '1 day',ARRAY['CN'])",
        [noncommercial, noncommercial, "b".repeat(64)],
      );
      const preset: any = {
        id: id(),
        version: 1,
        name: "Test",
        category: "ink",
        modelVersionIds: [f.ids.model],
        parameterTemplate: { prompt: "{{description}}" },
        editableParameters: ["description"],
        licenseRef: { id: noncommercial, version: 1 },
        exampleAssetIds: [],
        pricingVersionId: f.ids.cost,
        moderationPolicyVersion: "moderation@1",
        labelPolicyVersion: "label@1",
        state: "published",
      };
      await expect(c.publishPreset(f.actor, preset)).rejects.toThrow(
        "LICENSE_NOT_COMMERCIAL",
      );
      await expect(
        c.publishModel(f.actor, {
          id: id(),
          version: 2,
          connectionVersionId: f.ids.provider,
          providerModelId: "contract",
          providerModelVersion: "v2",
          capabilities: ["textToImage"],
          parameterSchema: {},
          licenseRef: { id: f.ids.license, version: 1 },
          testReportId: "missing",
          state: "ready",
          moderationPolicyVersion: "moderation@1",
          labelPolicyVersion: "label@1",
        }),
      ).rejects.toThrow("MODEL_UNVERIFIED");
      const stranger = (
        await f.auth.login(
          {
            exchange: async () => ({
              provider: "email",
              appId: "email",
              subject: "no-role@example.com",
              unionId: null,
              openPlatformId: null,
            }),
          },
          id(),
          "web",
        )
      ).actor;
      await expect(c.publishPreset(stranger, preset)).rejects.toThrow(
        "FORBIDDEN",
      );
    } finally {
      await f.close();
    }
  },
  60000,
);

it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "preset cannot override policies attached to its verified model",
  async () => {
    const f = await aiFixture();
    try {
      const catalog = new AiCatalog(f.database, f.auth, f.registry, "dev");
      await expect(
        catalog.publishPreset(f.actor, {
          id: "mismatched-preset",
          version: 1,
          name: "Mismatch",
          category: "ink",
          modelVersionIds: [f.ids.model],
          parameterTemplate: { prompt: "{{description}}" },
          editableParameters: ["description"],
          licenseRef: { id: f.ids.license, version: 1 },
          exampleAssetIds: [],
          pricingVersionId: f.ids.cost,
          moderationPolicyVersion: "weaker-policy@1",
          labelPolicyVersion: "label@1",
          state: "published",
        }),
      ).rejects.toThrow("GENERATION_POLICY_MISMATCH");
    } finally {
      await f.close();
    }
  },
  60000,
);
