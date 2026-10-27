import { fail } from "@album/server-core";
import type { DependencyPort } from "../config/types";
import { readLicense, validateLicense } from "./catalog";
/** Model/preset references are resolved from their authoritative catalog, never a static approval list. */
export function aiCatalogDependencies(
  fallback?: DependencyPort,
): DependencyPort {
  return {
    async assertAvailable(target, ref, environment, tx) {
      // A disabled connection must remain a valid immutable reference so a candidate
      // release can re-enable it or replace a revoked credential. Admission separately
      // checks the selected execution connection and secret; C4 validates candidate keys.
      if (target === "aiModel") {
        const row = (
          await tx.query(
            "SELECT v.license_version_id,v.capabilities FROM ai_model_versions v JOIN ai_models m ON m.id=v.model_id JOIN ai_provider_versions p ON p.id=v.provider_version_id JOIN ai_provider_connections c ON c.id=p.connection_id JOIN secret_references s ON s.id=p.secret_reference_id WHERE v.id=$1 AND v.version=$2 AND p.environment=$3 AND m.state='ready'",
            [ref.id, ref.version, environment],
          )
        ).rows[0];
        if (!row) fail("CONFIG_DEPENDENCY_UNAVAILABLE", 409);
        validateLicense(
          await readLicense(tx, { id: row.license_version_id }),
          new Date(),
          "CN",
          false,
        );
        return;
      }
      if (target === "aiPreset") {
        const row = (
          await tx.query(
            "SELECT v.license_version_id FROM ai_preset_versions v JOIN ai_presets p ON p.id=v.preset_id WHERE v.id=$1 AND v.version=$2 AND p.state='published' AND EXISTS(SELECT 1 FROM ai_preset_models pm JOIN ai_model_versions m ON m.id=pm.model_version_id JOIN ai_models b ON b.id=m.model_id JOIN ai_provider_versions c ON c.id=m.provider_version_id WHERE pm.preset_version_id=v.id AND b.state='ready' AND c.environment=$3)",
            [ref.id, ref.version, environment],
          )
        ).rows[0];
        if (!row) fail("CONFIG_DEPENDENCY_UNAVAILABLE", 409);
        validateLicense(
          await readLicense(tx, { id: row.license_version_id }),
          new Date(),
          "CN",
          false,
        );
        return;
      }
      if (!fallback) fail("CONFIG_DEPENDENCY_UNAVAILABLE", 409);
      await fallback.assertAvailable(target, ref, environment, tx);
    },
  };
}
