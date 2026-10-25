import type { PoolClient } from "pg";
import { fail } from "@album/server-core";
/** Retained financial snapshots keep original credentials; live jobs keep manifests/releases.
 * Storage objects still requiring access/cleanup also retain their profile credentials. */
export async function assertSecretNotInUse(
  referenceId: string,
  tx: PoolClient,
) {
  const secret = (
    await tx.query("SELECT * FROM secret_references WHERE id=$1", [referenceId])
  ).rows[0];
  if (!secret) fail("SECRET_UNAVAILABLE", 404);
  const vars = {
    id: referenceId,
    ref: secret.secret_ref,
    version: secret.secret_version,
  };
  const match =
    "(jsonb_path_exists(v,'$.** ? (@.secretRef == $ref && @.secretVersion == $version)',$2::jsonb) OR jsonb_path_exists(v,'$.** ? (@ == $id)',$2::jsonb))";
  const used = await tx.query(
    `SELECT 1 FROM (
 SELECT snapshot AS v FROM order_snapshots
 UNION ALL SELECT s.manifest FROM job_snapshots s JOIN jobs j ON j.workspace_id=s.workspace_id AND j.snapshot_id=s.id WHERE j.state NOT IN ('succeeded','failed','cancelled')
 UNION ALL SELECT i.body FROM config_release_items i JOIN job_snapshots s ON s.config_release_id=i.release_id JOIN jobs j ON j.workspace_id=s.workspace_id AND j.snapshot_id=s.id WHERE j.state NOT IN ('succeeded','failed','cancelled')
 ) obligations WHERE $1::text IS NOT NULL AND ${match} LIMIT 1`,
    [referenceId, JSON.stringify(vars)],
  );
  if (used.rowCount) fail("SECRET_IN_USE", 409);
  const storage = await tx.query(
    "SELECT 1 FROM storage_profile_versions p JOIN storage_objects o ON o.profile_version_id=p.id WHERE p.secret_reference_id=$1 AND o.state<>'deleted' LIMIT 1",
    [referenceId],
  );
  if (storage.rowCount) fail("SECRET_IN_USE", 409);
}
