import { fail, id, type Database } from "@album/server-core";
import type { StorageConfig } from "./types";
/** Deployment-owned COS metadata only. Credentials remain in the server environment. */
export async function provisionCosStorage(
  db: Database,
  environment: string,
  options: { bucket: string; region: string; basePrefix: string },
): Promise<StorageConfig> {
  if (
    !["dev", "staging", "prod"].includes(environment) ||
    !/^[-a-zA-Z0-9_/]+$/.test(options.basePrefix) ||
    options.basePrefix.split("/").some((v) => !v || v === ".." || v === ".") ||
    options.basePrefix.length > 240
  )
    fail("COS_CONFIGURATION_REQUIRED", 503);
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "cos-default:" + environment,
    ]);
    let profile = (
      await tx.query(
        "SELECT id FROM storage_profiles WHERE environment=$1 AND name='deployment-cos-private'",
        [environment],
      )
    ).rows[0]?.id;
    if (!profile) {
      profile = id();
      await tx.query(
        "INSERT INTO storage_profiles(id,environment,name,state) VALUES($1,$2,'deployment-cos-private','active')",
        [profile, environment],
      );
    }
    const existing = (
      await tx.query(
        "SELECT * FROM storage_profile_versions WHERE profile_id=$1 ORDER BY version DESC LIMIT 1",
        [profile],
      )
    ).rows[0];
    if (
      existing &&
      existing.bucket === options.bucket &&
      existing.region === options.region &&
      existing.base_prefix === options.basePrefix
    )
      return {
        profileVersionId: existing.id,
        storageProfileId: profile,
        profileVersion: existing.version,
        bucket: existing.bucket,
        basePrefix: existing.base_prefix,
      };
    const secret = id(),
      version = id(),
      number = Number(existing?.version ?? 0) + 1;
    await tx.query(
      "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,$2,'env:COS_SECRET_KEY','1','storage_write')",
      [secret, environment],
    );
    await tx.query(
      "INSERT INTO storage_profile_versions(id,profile_id,version,environment,provider,adapter_version,region,endpoint,bucket,base_prefix,secret_reference_id,encryption_mode) VALUES($1,$2,$3,$4,'cos','cos-v1',$5,$6,$7,$8,$9,'providerManaged')",
      [
        version,
        profile,
        number,
        environment,
        options.region,
        `https://${options.bucket}.cos.${options.region}.myqcloud.com`,
        options.bucket,
        options.basePrefix,
        secret,
      ],
    );
    return {
      profileVersionId: version,
      storageProfileId: profile,
      profileVersion: number,
      bucket: options.bucket,
      basePrefix: options.basePrefix,
    };
  });
}
