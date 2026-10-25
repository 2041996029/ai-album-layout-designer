import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { fail } from "./errors";
export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const id = () => randomUUID();
export async function runIdempotent<T>(
  tx: PoolClient,
  scope: string,
  key: string,
  payloadHash: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!key || key.length > 128) fail("IDEMPOTENCY_KEY_REQUIRED", 428);
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    scope + ":" + key,
  ]);
  const { rows } = await tx.query(
    "SELECT * FROM idempotency_keys WHERE principal_scope=$1 AND idempotency_key=$2 AND expires_at>now()",
    [scope, key],
  );
  if (rows[0]) {
    if (rows[0].request_hash !== payloadHash) fail("IDEMPOTENCY_CONFLICT", 409);
    return rows[0].response_json as T;
  }
  await tx.query(
    "DELETE FROM idempotency_keys WHERE principal_scope=$1 AND idempotency_key=$2 AND expires_at<=now()",
    [scope, key],
  );
  const result = await work();
  await tx.query(
    `INSERT INTO idempotency_keys(id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,expires_at) VALUES($1,$2,$3,$4,$2,'completed',200,$5,now()+interval '7 days')`,
    [id(), scope, key, payloadHash, JSON.stringify(result ?? null)],
  );
  return result;
}
