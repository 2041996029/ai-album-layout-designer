import { id, type Database, fail } from "@album/server-core";
import type { StorageConfig } from "./types";
/** Explicit local-only bootstrap; never called in staging or production. */
export async function provisionDevelopmentStorage(
  db: Database,
  environment: string,
): Promise<StorageConfig> {
  if (environment !== "dev") fail("DEV_ONLY");
  return db.transaction(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('dev-local-storage',0))",
    );
    const existing = (
      await tx.query(
        "SELECT v.* FROM storage_profile_versions v JOIN storage_profiles p ON p.id=v.profile_id WHERE p.environment='dev' AND p.name='development-local-private' AND v.provider='local' ORDER BY v.version DESC LIMIT 1",
      )
    ).rows[0];
    if (existing)
      return {
        profileVersionId: existing.id,
        storageProfileId: existing.profile_id,
        profileVersion: existing.version,
        bucket: existing.bucket,
        basePrefix: existing.base_prefix,
      };
    const secret = id(),
      profile = id(),
      version = id();
    await tx.query(
      "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'dev','env:C3_LOCAL_OBJECT_SECRET','1','development-local-storage')",
      [secret],
    );
    await tx.query(
      "INSERT INTO storage_profiles(id,environment,name,state) VALUES($1,'dev','development-local-private','active')",
      [profile],
    );
    await tx.query(
      "INSERT INTO storage_profile_versions(id,profile_id,version,environment,provider,adapter_version,region,endpoint,bucket,base_prefix,secret_reference_id,encryption_mode) VALUES($1,$2,1,'dev','local','local-v1','local','https://local.invalid','private','objects',$3,'providerManaged')",
      [version, profile, secret],
    );
    return {
      profileVersionId: version,
      storageProfileId: profile,
      profileVersion: 1,
      bucket: "private",
      basePrefix: "objects",
    };
  });
}
