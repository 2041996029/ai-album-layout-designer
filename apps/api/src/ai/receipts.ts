import type { Database } from "@album/server-core";
import type { ProviderReceiptStore, QueryResult } from "@album/providers";
export class SqlProviderReceipts implements ProviderReceiptStore {
  constructor(private db: Database) {}
  async claim(operationId: string) {
    return this.db.transaction(
      async (tx) =>
        !!(
          await tx.query(
            "INSERT INTO generation_provider_receipts(operation_id,result) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING operation_id",
            [
              operationId,
              {
                state: "unknown",
                providerRequestId: operationId,
                retryAfterSeconds: 15,
              },
            ],
          )
        ).rowCount,
    );
  }
  async read(operationId: string): Promise<QueryResult | null> {
    return this.db.transaction(
      async (tx) =>
        (
          await tx.query(
            "SELECT result FROM generation_provider_receipts WHERE operation_id=$1",
            [operationId],
          )
        ).rows[0]?.result ?? null,
    );
  }
  async write(operationId: string, result: QueryResult) {
    await this.db.transaction((tx) =>
      tx.query(
        "UPDATE generation_provider_receipts SET result=$2,updated_at=clock_timestamp() WHERE operation_id=$1",
        [operationId, result],
      ),
    );
  }
}
