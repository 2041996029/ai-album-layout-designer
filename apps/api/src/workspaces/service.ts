import {
  type Database,
  type Actor,
  id,
  digest,
  runIdempotent,
  fail,
} from "@album/server-core";
import type { PoolClient } from "pg";
import type { AuthService } from "../auth/identity";
import type { WorkspaceAction, WorkspaceContext } from "./types";
export class WorkspaceService {
  constructor(
    public db: Database,
    public auth: AuthService,
  ) {}
  async authorize(
    actor: Actor,
    workspaceId: string,
    action: WorkspaceAction,
    tx?: PoolClient,
  ): Promise<WorkspaceContext> {
    if (!tx)
      return this.db.transaction((client) =>
        this.authorize(actor, workspaceId, action, client),
      );
    await this.auth.assertActor(tx, actor);
    const { rows } = await tx.query(
      `SELECT m.role,m.state,w.state AS workspace_state FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id=$2 FOR SHARE OF m,w`,
      [workspaceId, actor.userId],
    );
    const m = rows[0];
    if (!m) fail("NOT_FOUND", 404);
    if (m.state !== "active" || m.workspace_state !== "active")
      fail("FORBIDDEN", 403);
    const permitted =
      action === "read" ||
      (action === "purchase" && m.role === "owner") ||
      (["edit", "manageAssets", "deleteAssets"].includes(action) &&
        ["owner", "admin", "designer"].includes(m.role)) ||
      (["share", "manageSettings"].includes(action) &&
        ["owner", "admin"].includes(m.role));
    if (!permitted) fail("FORBIDDEN", 403);
    return { workspaceId, userId: actor.userId, role: m.role };
  }
  async createWorkspace(
    actor: Actor,
    kind: "personal" | "studio",
    key: string,
    name?: string,
  ) {
    if (!["personal", "studio"].includes(kind)) fail("INVALID_WORKSPACE");
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      return runIdempotent(
        tx,
        `workspace:create:${actor.userId}`,
        key,
        digest(JSON.stringify({ kind, name })),
        async () => {
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`personal:${actor.userId}`],
          );
          if (kind === "personal") {
            const { rows } = await tx.query(
              "SELECT id FROM workspaces WHERE owner_user_id=$1 AND kind='personal' AND state='active'",
              [actor.userId],
            );
            if (rows[0])
              return { workspaceId: rows[0].id as string, seatLimit: 1 };
          }
          const workspaceId = id();
          await tx.query(
            "INSERT INTO workspaces(id,owner_user_id,kind,name) VALUES($1,$2,$3,$4)",
            [
              workspaceId,
              actor.userId,
              kind,
              name ?? (kind === "personal" ? "我的相册" : "我的影楼"),
            ],
          );
          await tx.query(
            "INSERT INTO workspace_members(id,workspace_id,user_id,role) VALUES($1,$2,$3,'owner')",
            [id(), workspaceId, actor.userId],
          );
          await tx.query(
            "INSERT INTO workspace_settings(id,workspace_id,settings_json) VALUES($1,$2,$3)",
            [
              id(),
              workspaceId,
              { seatLimit: 1, defaultSpreadCount: 10, defaultTemplateId: null },
            ],
          );
          return { workspaceId, seatLimit: 1 };
        },
      );
    });
  }
  async list(actor: Actor) {
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      const { rows } = await tx.query(
        `SELECT w.*,m.role,s.default_width_mm,s.default_height_mm,s.notification_enabled FROM workspaces w JOIN workspace_settings s ON s.workspace_id=w.id JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 AND m.state='active' AND w.state='active' ORDER BY w.created_at,w.id`,
        [actor.userId],
      );
      return rows;
    });
  }
  async updateWorkspaceSettings(
    actor: Actor,
    wid: string,
    expectedRevision: number,
    settings: {
      defaultTemplateId: string | null;
      defaultSpreadCount: number;
      defaultWidthMm: number;
      defaultHeightMm: number;
    },
  ) {
    if (
      !Number.isInteger(settings.defaultSpreadCount) ||
      settings.defaultSpreadCount < 1 ||
      settings.defaultSpreadCount > 50 ||
      ![settings.defaultWidthMm, settings.defaultHeightMm].every(
        (v) => Number.isFinite(v) && v > 0 && v <= 2000,
      )
    )
      fail("INVALID_SETTINGS");
    return this.db.transaction(async (tx) => {
      await this.authorize(actor, wid, "manageSettings", tx);
      const { rows } = await tx.query(
        `UPDATE workspace_settings SET revision=revision+1,default_width_mm=$3,default_height_mm=$4,settings_json=settings_json||$5::jsonb WHERE workspace_id=$1 AND revision=$2 RETURNING revision`,
        [
          wid,
          expectedRevision,
          settings.defaultWidthMm,
          settings.defaultHeightMm,
          JSON.stringify({
            defaultSpreadCount: settings.defaultSpreadCount,
            defaultTemplateId: settings.defaultTemplateId,
          }),
        ],
      );
      if (!rows[0]) fail("REVISION_CONFLICT", 409);
      return { revision: Number(rows[0].revision) };
    });
  }
}
