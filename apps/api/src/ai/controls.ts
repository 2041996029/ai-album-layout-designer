import type { PoolClient } from "pg";
/** Candidate quotes freeze their controls; current controls may only tighten admission. */
export async function readActiveProviderLimits(
  tx: PoolClient,
  connectionId: string,
  environment: string,
) {
  const row = (
    await tx.query(
      "SELECT p.daily_budget_fen,p.max_concurrent,p.requests_per_minute FROM config_active_releases a JOIN config_releases r ON r.id=a.release_id AND r.environment=a.environment JOIN ai_provider_versions p ON p.id::text=r.manifest->'versions'->'aiConnection'->>'id' WHERE a.environment=$1 AND p.connection_id=$2",
      [environment, connectionId],
    )
  ).rows[0];
  return row
    ? {
        dailyBudgetFen: Number(row.daily_budget_fen),
        maxConcurrent: Number(row.max_concurrent),
        requestsPerMinute: Number(row.requests_per_minute),
      }
    : null;
}
