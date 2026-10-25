import { id } from "@album/server-core";
import type { Database } from "@album/server-core";
export async function storageFixture(db: Database) {
  return db.transaction(async (tx) => {
    const secret = id(),
      profile = id(),
      version = id();
    await tx.query(
      "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'dev',$2,'1','storage')",
      [secret, "test/" + secret],
    );
    await tx.query(
      "INSERT INTO storage_profiles(id,environment,name,state) VALUES($1,'dev',$2,'active')",
      [profile, "test-" + profile],
    );
    await tx.query(
      "INSERT INTO storage_profile_versions(id,profile_id,version,environment,provider,adapter_version,region,endpoint,bucket,base_prefix,secret_reference_id,encryption_mode) VALUES($1,$2,1,'dev','local','local-test','local','https://local.invalid','private','objects',$3,'providerManaged')",
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
