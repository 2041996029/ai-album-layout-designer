import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { createDatabase, id } from "@album/server-core";
export async function testDatabase() {
  const source = new URL(process.env.C3_TEST_DATABASE_URL!);
  if (
    !["127.0.0.1", "localhost"].includes(source.hostname) ||
    !source.pathname.includes("test")
  )
    throw Error("DISPOSABLE_LOCAL_DATABASE_REQUIRED");
  const name = "c3_test_" + id().replaceAll("-", "");
  const admin = new Pool({ connectionString: source.toString() });
  await admin.query(`CREATE DATABASE "${name}"`);
  source.pathname = "/" + name;
  const db = createDatabase({ connectionString: source.toString() });
  try {
    await db.pool.query(
      await readFile(
        new URL(
          "../../../docs/release-v1.0/database/001_initial.up.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const extra = await readFile(
      new URL("../src/c3-runtime.sql", import.meta.url),
      "utf8",
    );
    await db.pool.query(extra);
    await db.pool.query(
      await readFile(
        new URL(
          "../../../docs/release-v1.0/database/002_order_snapshots.up.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.pool.query(
      await readFile(
        new URL(
          "../../../docs/release-v1.0/database/003_redemption_batch_policy.up.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.pool.query(await readFile(new URL("../../../docs/release-v1.0/database/004_financial_adjustments.up.sql", import.meta.url), "utf8"));
  } catch (e) {
    await db.close();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    throw e;
  }
  return {
    ...db,
    close: async () => {
      await db.close();
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    },
  };
}
