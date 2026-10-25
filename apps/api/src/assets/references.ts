import type { PoolClient } from "pg";
export interface ResourceReferences {
  projects: string[];
  activeJobCount: number;
  retentionBlocked: boolean;
}
/** Includes retained revisions and exact object pins, not only the latest document. */
export async function assetReferences(
  tx: PoolClient,
  wid: string,
  assetIds: string[],
): Promise<ResourceReferences> {
  const projects = (
    await tx.query(
      "SELECT DISTINCT r.project_id FROM project_revision_assets a JOIN project_revisions r ON r.workspace_id=a.workspace_id AND r.id=a.revision_id WHERE a.workspace_id=$1 AND a.asset_id=ANY($2::text[]) ORDER BY r.project_id",
      [wid, assetIds],
    )
  ).rows.map((r) => r.project_id as string);
  const objects = (
    await tx.query(
      "SELECT original_object_id AS id FROM assets WHERE workspace_id=$1 AND id=ANY($2::text[]) AND original_object_id IS NOT NULL UNION SELECT storage_object_id AS id FROM asset_variants WHERE workspace_id=$1 AND asset_id=ANY($2::text[])",
      [wid, assetIds],
    )
  ).rows.map((r) => r.id);
  const jobs = (
    await tx.query(
      "SELECT count(DISTINCT p.job_id) FILTER(WHERE j.state NOT IN('succeeded','failed','cancelled')) AS active_count,count(*) AS pin_count FROM resource_pins p JOIN jobs j ON j.workspace_id=p.workspace_id AND j.id=p.job_id WHERE p.released_at IS NULL AND ((p.workspace_id=$1 AND p.asset_id=ANY($2::text[])) OR (p.storage_workspace_id=$1 AND p.storage_object_id=ANY($3::text[])))",
      [wid, assetIds, objects],
    )
  ).rows[0];
  const retained = (
    await tx.query(
      "SELECT EXISTS(SELECT 1 FROM project_revision_assets a JOIN project_revisions r ON r.workspace_id=a.workspace_id AND r.id=a.revision_id JOIN projects p ON p.workspace_id=r.workspace_id AND p.id=r.project_id WHERE a.workspace_id=$1 AND a.asset_id=ANY($2::text[]) AND (r.number<>p.current_revision OR p.deleted_at IS NOT NULL)) OR EXISTS(SELECT 1 FROM storage_migration_items WHERE workspace_id=$1 AND (source_object_id=ANY($3::text[]) OR target_object_id=ANY($3::text[])) AND retain_source_until>now()) AS blocked",
      [wid, assetIds, objects],
    )
  ).rows[0].blocked;
  return {
    projects: projects.slice(0, 500),
    activeJobCount: Number(jobs.active_count),
    retentionBlocked:
      Boolean(retained) || Number(jobs.pin_count) > 0 || projects.length > 500,
  };
}
export function referencesBlock(refs: ResourceReferences) {
  return (
    refs.projects.length > 0 || refs.activeJobCount > 0 || refs.retentionBlocked
  );
}
