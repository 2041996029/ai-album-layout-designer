import {
  digest,
  fail,
  id,
  type Actor,
  type Database,
} from "@album/server-core";
import type { ObjectStore } from "./types";
import { rowToLocator } from "./upload";
/** Never deletes source objects; existing snapshot pins keep their exact locator. */
export class MigrationService {
  constructor(private db: Database) {}
  async migrateObject(
    itemId: string,
    store: ObjectStore,
  ): Promise<{
    state: "copied" | "verified" | "switched" | "failed";
    oldLocatorRetained: boolean;
  }> {
    try {
      return await this.db.transaction(async (tx) => {
        const item = (
          await tx.query(
            "SELECT i.*,m.state AS migration_state,m.target_profile_version_id FROM storage_migration_items i JOIN storage_migrations m ON m.workspace_id=i.workspace_id AND m.id=i.migration_id WHERE i.id=$1 FOR UPDATE OF i",
            [itemId],
          )
        ).rows[0];
        if (!item) fail("NOT_FOUND", 404);
        if (item.state === "switched")
          return { state: "switched", oldLocatorRetained: true };
        if (item.migration_state === "cancelled")
          return { state: "failed", oldLocatorRetained: true };
        const source = (
          await tx.query(
            "SELECT * FROM storage_objects WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
            [item.workspace_id, item.source_object_id],
          )
        ).rows[0];
        if (
          Number(source.locator_revision) !==
          Number(item.expected_locator_revision)
        )
          fail("LOCATOR_CONFLICT", 409);
        const targetProfile = (
          await tx.query("SELECT * FROM storage_profile_versions WHERE id=$1", [
            item.target_profile_version_id,
          ])
        ).rows[0];
        const targetId =
            item.target_object_id ?? digest("migration-target:" + item.id),
          key = `${targetProfile.base_prefix}/${item.workspace_id}/migration/${targetId}`,
          target = {
            ...source,
            id: targetId,
            profile_version_id: targetProfile.id,
            bucket: targetProfile.bucket,
            object_key: key,
          };
        const bytes = await store.read(await rowToLocator(tx, source));
        await store.put(await rowToLocator(tx, target), bytes);
        const check = await store.head(await rowToLocator(tx, target));
        if (
          check.sha256 !== source.sha256 ||
          check.bytes !== Number(source.byte_size) ||
          digest(await store.read(await rowToLocator(tx, target))) !==
            source.sha256
        )
          fail("MIGRATION_VERIFICATION_FAILED");
        await tx.query(
          "INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',now()) ON CONFLICT(id) DO NOTHING",
          [
            targetId,
            item.workspace_id,
            targetProfile.id,
            target.bucket,
            key,
            source.kind,
            source.sha256,
            source.byte_size,
            source.mime_type,
          ],
        );
        await tx.query(
          "UPDATE assets SET original_object_id=$3,revision=revision+1 WHERE workspace_id=$1 AND original_object_id=$2",
          [item.workspace_id, source.id, targetId],
        );
        await tx.query(
          "UPDATE asset_variants SET storage_object_id=$3 WHERE workspace_id=$1 AND storage_object_id=$2",
          [item.workspace_id, source.id, targetId],
        );
        await tx.query(
          "UPDATE storage_objects SET locator_revision=locator_revision+1 WHERE workspace_id=$1 AND id=$2",
          [item.workspace_id, source.id],
        );
        await tx.query(
          "UPDATE storage_migration_items SET target_object_id=$2,state='switched',verified_hash=$3,retain_source_until=now()+interval '30 days',error_code=NULL WHERE id=$1",
          [itemId, targetId, source.sha256],
        );
        return { state: "switched", oldLocatorRetained: true };
      });
    } catch (error) {
      await this.db.transaction(async (tx) => {
        await tx.query(
          "UPDATE storage_migration_items SET state='failed',error_code=$2 WHERE id=$1",
          [itemId, error instanceof Error ? error.message : "MIGRATION_FAILED"],
        );
      });
      return { state: "failed", oldLocatorRetained: true };
    }
  }
}
