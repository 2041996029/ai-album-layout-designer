import { fail, id } from "@album/server-core";
import type { PoolClient } from "pg";
export async function reserveGenerationStorage(
  tx: PoolClient,
  wid: string,
  jobId: string,
  limit: number,
) {
  const bytes = 100000000;
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "storage-quota:" + wid,
  ]);
  await tx.query(
    "INSERT INTO storage_usage_accounts(id,workspace_id,category,limit_bytes) VALUES($1,$2,'generated',$3) ON CONFLICT(workspace_id,category) DO NOTHING",
    [id(), wid, limit],
  );
  const accounts = (
    await tx.query(
      "SELECT * FROM storage_usage_accounts WHERE workspace_id=$1 ORDER BY id FOR UPDATE",
      [wid],
    )
  ).rows;
  const used = accounts.reduce(
    (n, a) => n + Number(a.used_bytes) + Number(a.reserved_bytes),
    0,
  );
  if (used + bytes > limit) fail("STORAGE_QUOTA", 413);
  const a = accounts.find((a) => a.category === "generated");
  await tx.query(
    "UPDATE storage_usage_accounts SET reserved_bytes=reserved_bytes+$2,limit_bytes=$3,revision=revision+1 WHERE id=$1",
    [a.id, bytes, limit],
  );
  await tx.query(
    "INSERT INTO storage_quota_reservations(id,workspace_id,usage_account_id,operation_id,bytes,state,expires_at) VALUES($1,$2,$3,$4,$5,'held',clock_timestamp()+interval '31 minutes')",
    [id(), wid, a.id, jobId, bytes],
  );
}
export async function closeGenerationStorage(
  tx: PoolClient,
  wid: string,
  jobId: string,
  bytes: number,
  succeeded: boolean,
) {
  const r = (
    await tx.query(
      "SELECT * FROM storage_quota_reservations WHERE workspace_id=$1 AND operation_id=$2 FOR UPDATE",
      [wid, jobId],
    )
  ).rows[0];
  if (!r || r.state !== "held") return;
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > Number(r.bytes))
    fail("STORAGE_QUOTA", 413);
  await tx.query(
    "UPDATE storage_usage_accounts SET reserved_bytes=reserved_bytes-$2,used_bytes=used_bytes+$3,revision=revision+1 WHERE id=$1",
    [r.usage_account_id, r.bytes, succeeded ? bytes : 0],
  );
  await tx.query("UPDATE storage_quota_reservations SET state=$2 WHERE id=$1", [
    r.id,
    succeeded ? "consumed" : "released",
  ]);
}
