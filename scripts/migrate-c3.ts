import { Pool } from "pg";
import { readFile } from "node:fs/promises";
if (process.env.C3_ENV !== "dev" || !process.env.C3_DATABASE_URL)
  throw Error("EXPLICIT_DEVELOPMENT_DATABASE_REQUIRED");
const url = new URL(process.env.C3_DATABASE_URL);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !/(?:dev|test)/i.test(url.pathname)
)
  throw Error("DISPOSABLE_LOCAL_DATABASE_REQUIRED");
const pool = new Pool({ connectionString: url.toString() });
try {
  const existing = await pool.query(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name='ai_album'",
  );
  if (existing.rowCount) throw Error("DATABASE_ALREADY_INITIALIZED");
  await pool.query(
    await readFile(
      new URL(
        "../docs/release-v1.0/database/001_initial.up.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pool.query(
    await readFile(
      new URL("../apps/api/src/c3-runtime.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const migration of [
    "002_order_snapshots",
    "003_redemption_batch_policy",
    "004_financial_adjustments",
    "005_identity_payments",
    "006_ai_runtime",
  ]) {
    await pool.query(
      await readFile(
        new URL(
          `../docs/release-v1.0/database/${migration}.up.sql`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  }
  console.info("C3/C4 development migrations completed");
} finally {
  await pool.end();
}
