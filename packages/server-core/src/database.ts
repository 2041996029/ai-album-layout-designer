import { Pool, type PoolClient, type PoolConfig } from "pg";
export interface Database {
  transaction<T>(work: (tx: PoolClient) => Promise<T>): Promise<T>;
}
export function createDatabase(config: PoolConfig) {
  const pool = new Pool(config);
  const database: Database = {
    async transaction(work) {
      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        await tx.query("SET LOCAL search_path TO ai_album, pg_catalog");
        const value = await work(tx);
        await tx.query("COMMIT");
        return value;
      } catch (error) {
        await tx.query("ROLLBACK");
        throw error;
      } finally {
        tx.release();
      }
    },
  };
  return { database, pool, close: () => pool.end() };
}
