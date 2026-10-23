import {
  digest,
  fail,
  id,
  runIdempotent,
  type Actor,
  type Database,
} from "@album/server-core";
import { caseFold } from "unicode-case-folding";
import { assetReferences, referencesBlock } from "../assets/references";
import type { PoolClient } from "pg";
import type { WorkspaceAuthorization } from "../assets/types";
import {
  pageLimit,
  validateSearch,
  pageCursor,
  readPageCursor,
} from "../assets/pagination";
export interface FolderListQuery {
  state?: "active" | "trashed";
  parentId?: string | null;
  q?: string;
  cursor?: string | null;
  limit?: number;
}
export interface AssetFolder {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  revision: number;
  createdAt: string;
  depth: number;
  state: "active" | "trashed";
}
export interface FolderMutation {
  parentId?: string | null;
  name?: string;
}
const folder = (r: any): AssetFolder => ({
  id: r.id,
  workspaceId: r.workspace_id,
  parentId: r.parent_id,
  name: r.name,
  revision: Number(r.revision),
  createdAt: r.created_at.toISOString(),
  depth: Number(r.depth ?? 1),
  state: r.deleted_at ? "trashed" : "active",
});
export function normalizeFolderName(value: string) {
  const name = value.normalize("NFC");
  if (
    name !== name.trim() ||
    [...name].length < 1 ||
    [...name].length > 80 ||
    /[\/\\\p{Cc}]/u.test(name) ||
    name === "." ||
    name === ".."
  )
    fail("INVALID_FOLDER_NAME");
  return { name, normalized: caseFold(name).normalize("NFC") };
}
export class FolderService {
  constructor(
    private db: Database,
    private workspaces: WorkspaceAuthorization,
  ) {}
  private async lock(
    tx: PoolClient,
    actor: Actor,
    wid: string,
    action: "manageAssets" | "deleteAssets" = "manageAssets",
  ) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      wid + ":assets",
    ]);
    await this.workspaces.authorize(actor, wid, action, tx);
  }
  private async rows(tx: PoolClient, wid: string) {
    return (
      await tx.query(
        "WITH RECURSIVE tree AS (SELECT f.*,1 AS depth FROM asset_folders f WHERE workspace_id=$1 AND parent_id IS NULL UNION ALL SELECT f.*,t.depth+1 FROM asset_folders f JOIN tree t ON f.parent_id=t.id WHERE f.workspace_id=$1) SELECT * FROM tree",
        [wid],
      )
    ).rows;
  }
  private async dto(tx: PoolClient, wid: string, row: any) {
    return folder(
      (await this.rows(tx, wid)).find((r) => r.id === row.id) ?? row,
    );
  }
  async getFolder(actor: Actor, wid: string, fid: string) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "read", tx);
      const row = (await this.rows(tx, wid)).find((r) => r.id === fid);
      if (!row) fail("NOT_FOUND", 404);
      return folder(row);
    });
  }
  private validateTree(rows: any[], fid: string, parent: string | null) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    let current = parent,
      depth = 1;
    const seen = new Set([fid]);
    while (current) {
      if (seen.has(current)) fail("FOLDER_CYCLE", 409);
      seen.add(current);
      const p = byId.get(current);
      if (!p || p.deleted_at) fail("NOT_FOUND", 404);
      current = p.parent_id;
      depth++;
    }
    const height = (node: string): number =>
      1 +
      Math.max(
        0,
        ...rows
          .filter((r) => !r.deleted_at && r.parent_id === node)
          .map((r) => height(r.id)),
      );
    if (depth + height(fid) - 1 > 10) fail("FOLDER_DEPTH_EXCEEDED", 409);
  }
  private conflict(
    rows: any[],
    fid: string,
    parent: string | null,
    normalized: string,
  ) {
    if (
      rows.some(
        (r) =>
          r.id !== fid &&
          !r.deleted_at &&
          r.parent_id === parent &&
          r.normalized_name === normalized,
      )
    )
      fail("FOLDER_NAME_CONFLICT", 409);
  }
  async listFolders(actor: Actor, wid: string, query: FolderListQuery = {}) {
    const limit = pageLimit(query.limit),
      q = validateSearch(query.q),
      state = query.state ?? "active";
    if (
      !["active", "trashed"].includes(state) ||
      (query.parentId !== undefined &&
        query.parentId !== null &&
        (typeof query.parentId !== "string" ||
          query.parentId.length < 1 ||
          query.parentId.length > 128))
    )
      fail("INVALID_REQUEST");
    const filters = {
      state,
      q,
      parentId: query.parentId ?? null,
      filterParent: query.parentId !== undefined,
    };
    const cursor = readPageCursor(query.cursor, "folders", wid, filters);
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "read", tx);
      const rows = (await this.rows(tx, wid))
        .filter(
          (r) =>
            (state === "trashed" ? Boolean(r.deleted_at) : !r.deleted_at) &&
            (query.parentId === undefined || r.parent_id === query.parentId) &&
            (!q ||
              r.name
                .normalize("NFC")
                .toLowerCase()
                .includes(q.toLowerCase())) &&
            (!cursor || r.id > cursor.id),
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return {
        items: rows.slice(0, limit).map(folder),
        nextCursor:
          rows.length > limit
            ? pageCursor("folders", wid, filters, { id: rows[limit - 1].id })
            : null,
        hasMore: rows.length > limit,
      };
    });
  }
  async createFolder(
    actor: Actor,
    wid: string,
    parentId: string | null,
    name: string,
    key: string,
  ) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, actor, wid);
      return runIdempotent(
        tx,
        wid + ":folder-create",
        key,
        digest(JSON.stringify({ parentId, name })),
        async () => {
          const n = normalizeFolderName(name),
            fid = id(),
            rows = await this.rows(tx, wid);
          this.validateTree(rows, fid, parentId);
          this.conflict(rows, fid, parentId, n.normalized);
          return this.dto(
            tx,
            wid,
            (
              await tx.query(
                "INSERT INTO asset_folders(id,workspace_id,parent_id,name,normalized_name,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
                [fid, wid, parentId, n.name, n.normalized, actor.userId],
              )
            ).rows[0],
          );
        },
      );
    });
  }
  async updateFolder(
    actor: Actor,
    wid: string,
    fid: string,
    expectedRevision: number,
    patch: FolderMutation,
  ) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, actor, wid);
      const rows = await this.rows(tx, wid),
        r = rows.find((r) => r.id === fid && !r.deleted_at);
      if (!r) fail("NOT_FOUND", 404);
      if (Number(r.revision) !== expectedRevision)
        fail("REVISION_CONFLICT", 409);
      const parent =
          patch.parentId === undefined ? r.parent_id : patch.parentId,
        n = normalizeFolderName(patch.name ?? r.name);
      this.validateTree(rows, fid, parent);
      this.conflict(rows, fid, parent, n.normalized);
      return this.dto(
        tx,
        wid,
        (
          await tx.query(
            "UPDATE asset_folders SET parent_id=$3,name=$4,normalized_name=$5,revision=revision+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
            [wid, fid, parent, n.name, n.normalized],
          )
        ).rows[0],
      );
    });
  }
  async batchMoveAssets(
    actor: Actor,
    wid: string,
    assetIds: string[],
    targetFolderId: string | null,
    key: string,
  ) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, actor, wid);
      return runIdempotent(
        tx,
        wid + ":asset-move",
        key,
        digest(JSON.stringify({ assetIds, targetFolderId })),
        async () => {
          if (
            targetFolderId &&
            !(await this.rows(tx, wid)).some(
              (r) => r.id === targetFolderId && !r.deleted_at,
            )
          )
            fail("NOT_FOUND", 404);
          const ids = [...new Set(assetIds)];
          const result = await tx.query(
            "SELECT id FROM assets WHERE workspace_id=$1 AND id=ANY($2::text[]) AND deleted_at IS NULL FOR UPDATE",
            [wid, ids],
          );
          if (result.rowCount !== ids.length) fail("NOT_FOUND", 404);
          await tx.query(
            "UPDATE assets SET folder_id=$3,revision=revision+1 WHERE workspace_id=$1 AND id=ANY($2::text[])",
            [wid, ids, targetFolderId],
          );
          return null;
        },
      );
    });
  }
  async previewDelete(actor: Actor, wid: string, fid: string) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "read", tx);
      const rows = await this.rows(tx, wid),
        root = rows.find((r) => r.id === fid && !r.deleted_at);
      if (!root) fail("NOT_FOUND", 404);
      const ids = [fid];
      for (let i = 0; i < ids.length; i++)
        ids.push(
          ...rows
            .filter((r) => !r.deleted_at && r.parent_id === ids[i])
            .map((r) => r.id),
        );
      const assets = (
        await tx.query(
          "SELECT id,state FROM assets WHERE workspace_id=$1 AND folder_id=ANY($2::text[]) AND deleted_at IS NULL",
          [wid, ids],
        )
      ).rows;
      const references = await assetReferences(
        tx,
        wid,
        assets.map((a) => a.id),
      );
      return {
        folderId: fid,
        revision: Number(root.revision),
        subfolderCount: ids.length - 1,
        assetCount: assets.length,
        references,
        canDelete:
          !referencesBlock(references) &&
          assets.every((a) => a.state === "ready"),
      };
    });
  }
  async trashFolder(
    actor: Actor,
    wid: string,
    fid: string,
    expectedRevision: number,
    key: string,
  ) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, actor, wid, "deleteAssets");
      return runIdempotent(
        tx,
        wid + ":folder-trash",
        key,
        digest(JSON.stringify({ fid, expectedRevision })),
        async () => {
          const rows = await this.rows(tx, wid),
            r = rows.find((r) => r.id === fid && !r.deleted_at);
          if (!r) fail("NOT_FOUND", 404);
          if (Number(r.revision) !== expectedRevision)
            fail("REVISION_CONFLICT", 409);
          const ids = [fid];
          for (let i = 0; i < ids.length; i++)
            ids.push(
              ...rows
                .filter((r) => !r.deleted_at && r.parent_id === ids[i])
                .map((r) => r.id),
            );
          const assets = (
            await tx.query(
              "SELECT id FROM assets WHERE workspace_id=$1 AND folder_id=ANY($2::text[]) AND deleted_at IS NULL FOR UPDATE",
              [wid, ids],
            )
          ).rows.map((r) => r.id);
          const references = await assetReferences(tx, wid, assets);
          if (referencesBlock(references))
            fail("ASSET_IN_USE", 409, references);
          if (
            (
              await tx.query(
                "SELECT 1 FROM assets WHERE workspace_id=$1 AND id=ANY($2::text[]) AND state<>'ready'",
                [wid, assets],
              )
            ).rowCount
          )
            fail("ASSET_NOT_READY", 409);
          const op = id();
          await tx.query(
            "INSERT INTO trash_operations(id,workspace_id,operation_id,created_by,restore_until) VALUES($1,$2,$3,$4,now()+interval '30 days')",
            [op, wid, id(), actor.userId],
          );
          for (const f of rows.filter((r) => ids.includes(r.id)))
            await tx.query(
              "INSERT INTO trash_items(id,workspace_id,trash_operation_id,folder_id,original_parent_id,original_name,expected_revision) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                id(),
                wid,
                op,
                f.id,
                f.parent_id,
                f.name,
                Number(f.revision) + 1,
              ],
            );
          for (const assetId of assets) {
            const a = (
              await tx.query(
                "SELECT * FROM assets WHERE workspace_id=$1 AND id=$2",
                [wid, assetId],
              )
            ).rows[0];
            await tx.query(
              "INSERT INTO trash_items(id,workspace_id,trash_operation_id,asset_id,original_parent_id,original_name,expected_revision) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                id(),
                wid,
                op,
                a.id,
                a.folder_id,
                a.original_filename,
                Number(a.revision) + 1,
              ],
            );
          }
          await tx.query(
            "UPDATE asset_folders SET deleted_at=now(),revision=revision+1 WHERE workspace_id=$1 AND id=ANY($2::text[])",
            [wid, ids],
          );
          await tx.query(
            "UPDATE assets SET deleted_at=now(),state='trashed',revision=revision+1 WHERE workspace_id=$1 AND id=ANY($2::text[])",
            [wid, assets],
          );
          return null;
        },
      );
    });
  }
  async restoreFolder(
    actor: Actor,
    wid: string,
    fid: string,
    targetParentId: string | null,
    name: string,
    key: string,
    expectedRevision?: number,
  ) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, actor, wid);
      return runIdempotent(
        tx,
        wid + ":folder-restore",
        key,
        digest(
          JSON.stringify({
            fid,
            targetParentId,
            name,
            expectedRevision: expectedRevision ?? null,
          }),
        ),
        async () => {
          const rows = await this.rows(tx, wid),
            r = rows.find((r) => r.id === fid && r.deleted_at);
          if (!r) fail("NOT_FOUND", 404);
          if (
            expectedRevision !== undefined &&
            Number(r.revision) !== expectedRevision
          )
            fail("REVISION_CONFLICT", 409);
          const n = normalizeFolderName(name);
          const operation = (
            await tx.query(
              "SELECT o.* FROM trash_operations o JOIN trash_items i ON i.workspace_id=o.workspace_id AND i.trash_operation_id=o.id WHERE i.workspace_id=$1 AND i.folder_id=$2 AND o.state='trashed' ORDER BY o.created_at DESC LIMIT 1",
              [wid, fid],
            )
          ).rows[0];
          if (!operation || operation.restore_until <= new Date())
            fail("RESTORE_EXPIRED", 409);
          const items = (
            await tx.query(
              "SELECT * FROM trash_items WHERE workspace_id=$1 AND trash_operation_id=$2",
              [wid, operation.id],
            )
          ).rows;
          const restoreIds = items
            .filter((i) => i.folder_id)
            .map((i) => i.folder_id);
          const restoredRows = rows.map((row) =>
            restoreIds.includes(row.id) ? { ...row, deleted_at: null } : row,
          );
          this.validateTree(restoredRows, fid, targetParentId);
          this.conflict(rows, fid, targetParentId, n.normalized);
          for (const row of restoredRows.filter(
            (r) => restoreIds.includes(r.id) && r.id !== fid,
          )) {
            this.conflict(
              restoredRows,
              row.id,
              row.parent_id,
              row.normalized_name,
            );
          }
          await tx.query(
            "UPDATE asset_folders SET deleted_at=NULL,revision=revision+1 WHERE workspace_id=$1 AND id=ANY($2::text[]) AND id<>$3",
            [wid, restoreIds, fid],
          );
          await tx.query(
            "UPDATE assets SET deleted_at=NULL,state='ready',revision=revision+1 WHERE workspace_id=$1 AND id=ANY($2::text[]) AND deleted_at IS NOT NULL",
            [wid, items.filter((i) => i.asset_id).map((i) => i.asset_id)],
          );
          await tx.query(
            "UPDATE trash_operations SET state='restored',revision=revision+1 WHERE workspace_id=$1 AND id=$2",
            [wid, operation.id],
          );
          return this.dto(
            tx,
            wid,
            (
              await tx.query(
                "UPDATE asset_folders SET parent_id=$3,name=$4,normalized_name=$5,deleted_at=NULL,revision=revision+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
                [wid, fid, targetParentId, n.name, n.normalized],
              )
            ).rows[0],
          );
        },
      );
    });
  }
}
