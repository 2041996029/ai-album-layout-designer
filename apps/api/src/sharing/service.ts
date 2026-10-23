import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  type Actor,
  type Database,
  id,
  digest,
  fail,
  runIdempotent,
} from "@album/server-core";
import type { PoolClient } from "pg";
export interface ShareAuthorization {
  authorize(
    actor: Actor,
    wid: string,
    action: "read" | "manageSettings",
    tx?: PoolClient,
  ): Promise<unknown>;
}
export type ShareCreate = {
  outputIds: string[];
  expiresInHours: number;
  allowDownload: boolean;
  accessMode: "link" | "passcode";
  passcode?: string;
};
export interface ShareSigner {
  signOutput(
    workspaceId: string,
    outputId: string,
    ttlSeconds: 300,
  ): Promise<string>;
}
const token = () => randomBytes(32).toString("base64url");
const outputSql = `SELECT o.*,s.project_id,s.revision_id,so.mime_type FROM job_outputs o JOIN jobs j ON (j.workspace_id,j.id)=(o.workspace_id,o.job_id) JOIN job_snapshots s ON (s.workspace_id,s.id)=(j.workspace_id,j.snapshot_id) JOIN storage_objects so ON (so.workspace_id,so.id)=(o.workspace_id,o.storage_object_id) JOIN projects p ON (p.workspace_id,p.id)=(s.workspace_id,s.project_id) WHERE o.workspace_id=$1 AND o.id=ANY($2::text[]) AND o.expires_at>now() AND j.state='succeeded' AND j.kind='export' AND so.kind='preview' AND so.state='verified' AND p.state='active' AND o.format IN ('jpeg','png')`;
export class SharingService {
  constructor(
    private db: Database,
    private auth: ShareAuthorization,
    private signer?: ShareSigner,
  ) {}
  private async shape(tx: PoolClient, row: any) {
    const { rows } = await tx.query(
      "SELECT output_id FROM share_outputs WHERE workspace_id=$1 AND share_id=$2 ORDER BY output_id",
      [row.workspace_id, row.id],
    );
    return {
      id: row.id,
      outputIds: rows.map((x) => x.output_id),
      expiresAt: new Date(row.expires_at).toISOString(),
      allowDownload: row.scope === "preview_download",
      accessMode: row.password_hash ? "passcode" : "link",
      revision: Number(row.revision),
      state:
        row.state === "active" && new Date(row.expires_at) <= new Date()
          ? "expired"
          : row.state,
    };
  }
  async create(actor: Actor, wid: string, input: ShareCreate, key: string) {
    return this.db.transaction(async (tx) => {
      await this.auth.authorize(actor, wid, "manageSettings", tx);
      let issuedToken: string | undefined;
      const response = await runIdempotent(
        tx,
        `share:${wid}:${actor.userId}`,
        key,
        digest(JSON.stringify(input)),
        async () => {
          if (
            !input.outputIds.length ||
            input.outputIds.length > 200 ||
            new Set(input.outputIds).size !== input.outputIds.length ||
            !Number.isInteger(input.expiresInHours) ||
            input.expiresInHours < 1 ||
            input.expiresInHours > 720
          )
            fail("INVALID_SHARE", 422);
          if (
            input.accessMode === "passcode" &&
            (!input.passcode ||
              input.passcode.length < 6 ||
              input.passcode.length > 32)
          )
            fail("INVALID_PASSCODE", 422);
          const { rows } = await tx.query(outputSql, [wid, input.outputIds]);
          if (rows.length !== input.outputIds.length)
            fail("PREVIEW_NOT_READY", 409);
          if (
            rows.some(
              (r) =>
                r.project_id !== rows[0].project_id ||
                r.revision_id !== rows[0].revision_id,
            )
          )
            fail("SHARE_SCOPE_INVALID", 422);
          const raw = token(),
            salt = token(),
            password =
              input.accessMode === "passcode"
                ? salt +
                  ":" +
                  scryptSync(input.passcode!, salt, 32).toString("hex")
                : null;
          const result = await tx.query(
            `INSERT INTO share_links(id,workspace_id,project_id,revision_id,created_by,token_hash,password_hash,scope,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+$9*interval '1 hour') RETURNING *`,
            [
              id(),
              wid,
              rows[0].project_id,
              rows[0].revision_id,
              actor.userId,
              digest(raw),
              password,
              input.allowDownload ? "preview_download" : "preview",
              input.expiresInHours,
            ],
          );
          for (const output of rows)
            await tx.query(
              "INSERT INTO share_outputs(workspace_id,share_id,output_id) VALUES($1,$2,$3)",
              [wid, result.rows[0].id, output.id],
            );
          issuedToken = raw;
          return await this.shape(tx, result.rows[0]);
        },
      );
      return { ...response, ...(issuedToken ? { token: issuedToken } : {}) };
    });
  }
  async list(actor: Actor, wid: string) {
    return this.db.transaction(async (tx) => {
      await this.auth.authorize(actor, wid, "manageSettings", tx);
      const { rows } = await tx.query(
        "SELECT * FROM share_links WHERE workspace_id=$1 ORDER BY created_at DESC",
        [wid],
      );
      return Promise.all(rows.map((r) => this.shape(tx, r)));
    });
  }
  async get(actor: Actor, wid: string, shareId: string) {
    return this.db.transaction(async (tx) => {
      await this.auth.authorize(actor, wid, "manageSettings", tx);
      const { rows } = await tx.query(
        "SELECT * FROM share_links WHERE workspace_id=$1 AND id=$2",
        [wid, shareId],
      );
      if (!rows[0]) fail("NOT_FOUND", 404);
      return this.shape(tx, rows[0]);
    });
  }
  async revokeShare(
    actor: Actor,
    wid: string,
    shareId: string,
    revision?: number,
  ) {
    return this.db.transaction(async (tx) => {
      await this.auth.authorize(actor, wid, "manageSettings", tx);
      const { rows } = await tx.query(
        "SELECT * FROM share_links WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [wid, shareId],
      );
      if (!rows[0]) fail("NOT_FOUND", 404);
      if (revision !== undefined && Number(rows[0].revision) !== revision)
        fail("REVISION_CONFLICT", 409);
      const result = await tx.query(
        "UPDATE share_links SET state='revoked',revoked_at=now(),revision=revision+1 WHERE id=$1 RETURNING *",
        [shareId],
      );
      return this.shape(tx, result.rows[0]);
    });
  }
  private async live(tx: PoolClient, raw: string, session = false) {
    const { rows } = await tx.query(
      `SELECT l.* FROM share_links l ${session ? "JOIN share_sessions ss ON ss.share_id=l.id AND ss.workspace_id=l.workspace_id" : ""} JOIN users u ON u.id=l.created_by JOIN workspaces w ON w.id=l.workspace_id JOIN users owner ON owner.id=w.owner_user_id JOIN projects p ON p.workspace_id=l.workspace_id AND p.id=l.project_id WHERE ${session ? "ss.token_hash=$1 AND ss.expires_at>now()" : "l.token_hash=$1"} AND u.status='active' AND owner.status='active' AND w.state='active' AND p.state='active' FOR SHARE OF l,u,w,owner,p`,
      [digest(raw)],
    );
    const row = rows[0];
    if (!row) fail("SHARE_UNAVAILABLE", 404);
    if (row.state !== "active") fail("SHARE_REVOKED", 410);
    if (new Date(row.expires_at) <= new Date()) fail("SHARE_EXPIRED", 410);
    return row;
  }
  async authorizeShare(raw: string, resourceId: string) {
    return this.db.transaction(async (tx) => {
      const row = await this.live(tx, raw, true);
      const { rows } = await tx.query(outputSql, [
        row.workspace_id,
        [resourceId],
      ]);
      const selected = await tx.query(
        "SELECT 1 FROM share_outputs WHERE share_id=$1 AND output_id=$2",
        [row.id, resourceId],
      );
      if (!rows[0] || !selected.rowCount) fail("NOT_FOUND", 404);
      return { workspaceId: row.workspace_id, resourceId };
    });
  }
  async access(raw: string, passcode?: string) {
    return this.db.transaction(async (tx) => {
      const row = await this.live(tx, raw);
      if (row.password_hash) {
        const [salt, hash] = row.password_hash.split(":");
        if (
          !passcode ||
          !timingSafeEqual(
            scryptSync(passcode, salt, 32),
            Buffer.from(hash, "hex"),
          )
        )
          fail("SHARE_PASSCODE_INVALID", 403);
      }
      const shape = await this.shape(tx, row),
        { rows } = await tx.query(outputSql, [
          row.workspace_id,
          shape.outputIds,
        ]);
      if (rows.length !== shape.outputIds.length)
        fail("SHARE_UNAVAILABLE", 410);
      const accessToken = token(),
        expiry = new Date(
          Math.min(Date.now() + 300000, new Date(row.expires_at).getTime()),
        );
      await tx.query(
        "INSERT INTO share_sessions(token_hash,workspace_id,share_id,expires_at) VALUES($1,$2,$3,$4)",
        [digest(accessToken), row.workspace_id, row.id, expiry],
      );
      return {
        shareId: row.id,
        shareAccessToken: accessToken,
        expiresAt: expiry.toISOString(),
        allowDownload: shape.allowDownload,
        outputs: rows.map((o) => ({
          id: o.id,
          jobId: o.job_id,
          format: o.format,
          filename: `preview.${o.format}`,
          mime: o.mime_type,
          sizeBytes: Number(o.byte_size),
          sha256: o.sha256,
          createdAt: new Date(o.created_at).toISOString(),
          expiresAt: new Date(o.expires_at).toISOString(),
          state: "ready",
          ...(o.width ? { width: o.width, height: o.height } : {}),
        })),
      };
    });
  }
  async download(raw: string, outputId: string) {
    return this.db.transaction(async (tx) => {
      const row = await this.live(tx, raw, true);
      if (row.scope !== "preview_download") fail("DOWNLOAD_FORBIDDEN", 403);
      const selected = await tx.query(
        "SELECT 1 FROM share_outputs WHERE share_id=$1 AND output_id=$2",
        [row.id, outputId],
      );
      const outputs = await tx.query(outputSql, [row.workspace_id, [outputId]]);
      if (!selected.rowCount || !outputs.rowCount) fail("NOT_FOUND", 404);
      if (!this.signer) fail("STORAGE_UNCONFIGURED", 503);
      return {
        url: await this.signer.signOutput(row.workspace_id, outputId, 300),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        filename: `preview.${outputs.rows[0].format}`,
        mime: outputs.rows[0].mime_type,
        sizeBytes: Number(outputs.rows[0].byte_size),
        sha256: outputs.rows[0].sha256,
      };
    });
  }
}
