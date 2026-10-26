import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { id, digest, fail, ServiceError, type Actor } from "@album/server-core";
import {
  parseDocument,
  templateVersions,
  instantiateTemplate,
  type DocumentModel,
} from "@album/document";
import { loadContracts } from "./contracts";
import type { ApiRuntime } from "./runtime";
const unsafe = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method);
const date = (v: any) => new Date(v).toISOString();
const accepted = () => ({
  operationId: id(),
  state: "completed",
  acceptedAt: new Date().toISOString(),
});
const page = (items: any[]) => ({ items, nextCursor: null, hasMore: false });
const workspace = (r: any) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  role: r.role,
  revision: Number(r.revision),
  createdAt: date(r.created_at),
  ...(r.default_width_mm
    ? {
        defaults: {
          pageWidthMm: Number(r.default_width_mm),
          pageHeightMm: Number(r.default_height_mm),
          notificationsEnabled: r.notification_enabled,
        },
      }
    : {}),
});
export async function bindContractHttp(
  app: NestFastifyApplication,
  runtime: ApiRuntime,
) {
  const fastify = app.getHttpAdapter().getInstance(),
    { contract, resolve, validate } = await loadContracts();
  await fastify.register(cookie);
  fastify.removeContentTypeParser("application/json");
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request: any, body: any, done: any) => {
      request.rawBody = body;
      if (/^\/v1\/(payment|refund)-callbacks\//.test(request.url))
        return done(null, body);
      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch {
        done(Object.assign(new Error("INVALID_JSON"), { statusCode: 400 }));
      }
    },
  );
  fastify.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "buffer" },
    (request: any, body: any, done: any) => {
      request.rawBody = body;
      if (!/^\/v1\/(payment|refund)-callbacks\//.test(request.url))
        return done(
          Object.assign(new Error("UNSUPPORTED_MEDIA_TYPE"), {
            statusCode: 415,
          }),
        );
      done(null, body);
    },
  );
  fastify.addHook("onRequest", async (r: any, reply: any) => {
    if (r.headers.origin === runtime.allowedOrigin)
      reply
        .header("Access-Control-Allow-Origin", runtime.allowedOrigin)
        .header("Access-Control-Allow-Credentials", "true")
        .header("Vary", "Origin");
  });
  fastify.options("/v1/*", async (r: any, reply: any) => {
    if (r.headers.origin !== runtime.allowedOrigin)
      return reply.code(403).send();
    return reply
      .header(
        "Access-Control-Allow-Methods",
        "GET,POST,PATCH,DELETE,PUT,OPTIONS",
      )
      .header(
        "Access-Control-Allow-Headers",
        "Content-Type,Authorization,X-CSRF-Token,X-Workspace-Id,X-QR-Poll-Token,X-Browser-Nonce,Idempotency-Key,If-Match,X-Share-Access-Token,X-Reauthentication-Proof",
      )
      .status(204)
      .send();
  });
  const publicOperations = new Set([
    "getCapabilities",
    "receivePaymentCallback",
    "receiveRefundCallback",
    "loginWechatMini",
    "createEmailChallenge",
    "loginEmailWeb",
    "createEmailWechatChallenge",
    "linkWechatEmail",
    "createSmsChallenge",
    "loginSmsWeb",
    "createQrSession",
    "pollQrSession",
    "consumeQrSession",
    "refreshMiniSession",
    "accessPublicShare",
    "createSharedDownloadToken",
    "receiveNotificationCallback",
  ]);
  const routedPublic = (op: string) => publicOperations.has(op);
  const header = (r: any, key: string) =>
    String(r.headers[key.toLowerCase()] ?? "");
  const expected = (r: any) => {
    const value = header(r, "if-match");
    if (!/^"(?:0|[1-9][0-9]*)"$/.test(value)) fail("REVISION_REQUIRED", 428);
    const n = Number(value.slice(1, -1));
    if (!Number.isSafeInteger(n)) fail("INVALID_REVISION", 422);
    return n;
  };
  const key = (r: any) => {
    const value = header(r, "idempotency-key");
    if (!value || value.length > 128) fail("IDEMPOTENCY_KEY_REQUIRED", 428);
    return value;
  };
  const requireService = <T>(value: T | undefined): T => {
    if (!value) fail("UNCONFIGURED", 503);
    return value;
  };
  const origin = (r: any) => {
    if (header(r, "origin") !== runtime.allowedOrigin)
      fail("ORIGIN_FORBIDDEN", 403);
  };
  const wid = (r: any) =>
    r.params.workspaceId ??
    r.resolvedWorkspaceId ??
    header(r, "x-workspace-id");
  const user = async (actor: Actor) =>
    runtime.db.transaction(async (tx) => {
      const { rows } = await tx.query("SELECT * FROM users WHERE id=$1", [
        actor.userId,
      ]);
      const u = rows[0];
      return {
        id: u.id,
        displayName: u.display_name,
        status: u.status,
        createdAt: date(u.created_at),
      };
    });
  const projectDto = async (
    actor: Actor,
    w: string,
    pid: string,
    revision?: number,
  ) => {
    const saved = await requireService(runtime.revisions).load(
      actor,
      w,
      pid,
      revision,
    );
    const row = await runtime.db.transaction(async (tx) => {
      await runtime.workspaces.authorize(actor, w, "read", tx);
      return (
        await tx.query(
          "SELECT p.*,r.created_at AS updated_at FROM projects p JOIN project_revisions r ON r.workspace_id=p.workspace_id AND r.project_id=p.id AND r.number=$3 WHERE p.workspace_id=$1 AND p.id=$2",
          [w, pid, saved.doc.revision],
        )
      ).rows[0];
    });
    return {
      project: {
        id: pid,
        workspaceId: w,
        name: row.name,
        revision: saved.doc.revision,
        mode: saved.doc.mode ?? "full_editor",
        createdAt: date(row.created_at),
        updatedAt: date(row.updated_at),
        archived: row.state === "archived",
      },
      document: saved.doc,
      documentSha256: saved.docHash,
      resources: saved.resources,
      manifest: [
        ...saved.resources.assets.map((a) => ({
          resourceId: a.id,
          kind: "asset",
          version: String(a.version),
          sha256: a.sha256,
          available: a.status === "ready",
          licensed: a.license.usable,
        })),
        ...saved.resources.fonts.map((f) => ({
          resourceId: f.id,
          kind: "font",
          version: String(f.version),
          sha256: f.sha256,
          available: f.status === "ready",
          licensed: f.license.usable,
        })),
      ],
    };
  };
  const handlers: Record<string, (r: any, reply: any) => Promise<any>> = {
    async getCapabilities() {
      return {
        configReleaseId: null,
        capabilities: [
          "wechatLogin",
          "smsLogin",
          "cloudStorage",
          "cloudSave",
          "miniLayout",
          "notifications",
          "app",
          "textSuggestion",
        ].map((k) => ({
          key: k,
          status: "unconfigured",
          reasonCode: "INTEGRATION_NOT_CONFIGURED",
          action: "contact_admin",
          platforms: ["web", "mini"],
        })),
        serverTime: new Date().toISOString(),
      };
    },
    async createEmailChallenge(r) {
      if (r.body.purpose === "login" || !header(r, "authorization")) origin(r);
      let actor: Actor | undefined;
      if (r.body.purpose !== "login") {
        const bearer = header(r, "authorization");
        if (bearer && r.cookies.album_session) fail("AMBIGUOUS_AUTH", 401);
        actor = await runtime.auth.authenticate(
          bearer.startsWith("Bearer ")
            ? bearer.slice(7)
            : (r.cookies.album_session ?? ""),
          bearer ? "mini" : "web",
        );
        if (actor.client === "web")
          await runtime.auth.verifyCsrf(actor, header(r, "x-csrf-token"));
      }
      return requireService(runtime.email).start(
        r.body.email,
        r.body.purpose,
        actor,
        r.ip,
      );
    },
    async createEmailWechatChallenge(r) {
      return requireService(runtime.email).start(
        r.body.email,
        "link_wechat",
        undefined,
        r.ip,
      );
    },
    async linkWechatEmail(r) {
      const email = requireService(runtime.email),
        wechat = requireService(runtime.wechatMini);
      const identity = await wechat.exchange(r.body.wechatCode, null);
      const session = await runtime.auth.login(
        email.adapter("link_wechat"),
        JSON.stringify({
          challengeId: r.body.challengeId,
          code: r.body.verificationCode,
        }),
        "mini",
      );
      try {
        await runtime.auth.bind(session.actor, identity);
      } catch (e) {
        await runtime.auth.logout(session.actor);
        throw e;
      }
      return {
        user: await user(session.actor),
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        tokenType: "Bearer",
        expiresIn: 900,
        refreshExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
    },
    async loginEmailWeb(r, reply) {
      origin(r);
      const s = await runtime.auth.login(
        requireService(runtime.email).adapter("login"),
        JSON.stringify({
          challengeId: r.body.challengeId,
          code: r.body.verificationCode,
        }),
        "web",
      );
      reply.setCookie("album_session", s.accessToken, {
        path: "/v1",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 7 * 86400,
      });
      return {
        user: await user(s.actor),
        csrfToken: s.csrfToken,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
    },
    async loginWechatMini(r) {
      const adapter = requireService(runtime.wechatMini);
      if (r.body.client.platform !== "mini") fail("INVALID_CLIENT", 422);
      const session = await runtime.auth.login(adapter, r.body.code, "mini");
      return {
        user: await user(session.actor),
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        tokenType: "Bearer",
        expiresIn: 900,
        refreshExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
    },
    async refreshMiniSession(r) {
      if (r.body.client.platform !== "mini") fail("INVALID_CLIENT", 422);
      const s = await runtime.auth.rotateRefresh(r.body.refreshToken);
      if (s.actor.client !== "mini") fail("UNAUTHORIZED", 401);
      return {
        user: await user(s.actor),
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        tokenType: "Bearer",
        expiresIn: 900,
        refreshExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
    },
    async createQrSession(r, reply) {
      origin(r);
      const payload = requireService(runtime.qrPayload),
        nonce = r.body.browserNonce;
      const q = await runtime.auth.beginWebLogin(nonce, key(r));
      reply.setCookie("album_login", runtime.auth.hash(nonce), {
        path: "/v1/auth/web/qr-sessions",
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 120,
      });
      return {
        id: q.loginId,
        qrPayload: await payload(q.loginId, q.confirmToken),
        pollToken: q.pollToken,
        expiresAt: q.expiresAt,
        pollAfterSeconds: 1,
      };
    },
    async pollQrSession(r) {
      const nonce = header(r, "x-browser-nonce");
      if (r.cookies.album_login !== runtime.auth.hash(nonce))
        fail("LOGIN_BROWSER_MISMATCH", 403);
      return runtime.auth.pollWebLogin(
        r.params.qrSessionId,
        header(r, "x-qr-poll-token"),
        nonce,
      );
    },
    async confirmQrSession(r) {
      await runtime.auth.confirmWebLogin(
        r.actor,
        r.params.qrSessionId,
        r.body.sceneToken,
      );
      return runtime.db.transaction(async (tx) => {
        const q = (
          await tx.query("SELECT * FROM auth_challenges WHERE id=$1", [
            r.params.qrSessionId,
          ])
        ).rows[0];
        return { id: q.id, state: q.state, expiresAt: date(q.expires_at) };
      });
    },
    async consumeQrSession(r, reply) {
      origin(r);
      const nonce = r.body.browserNonce;
      if (r.cookies.album_login !== runtime.auth.hash(nonce))
        fail("LOGIN_BROWSER_MISMATCH", 403);
      const s = await runtime.auth.consumeWebSession(
        r.params.qrSessionId,
        nonce,
        header(r, "x-qr-poll-token"),
        r.body.consumeProof,
        key(r),
      );
      reply.setCookie("album_session", s.accessToken, {
        path: "/v1",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 7 * 86400,
      });
      return {
        user: await user(s.actor),
        csrfToken: s.csrfToken,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
    },
    async getMe(r) {
      return user(r.actor);
    },
    async getWebSession(r) {
      if (r.actor.client !== "web") fail("UNAUTHORIZED", 401);
      return {
        user: await user(r.actor),
        csrfToken: runtime.auth.hash("csrf:" + r.actor.sessionId),
        expiresAt: (
          await runtime.db.transaction((tx) =>
            tx.query("SELECT expires_at FROM auth_sessions WHERE id=$1", [
              r.actor.sessionId,
            ]),
          )
        ).rows[0].expires_at.toISOString(),
      };
    },
    async logoutSession(r, reply) {
      await runtime.auth.logout(r.actor);
      reply.clearCookie("album_session", { path: "/v1" });
      return accepted();
    },
    async listSessions(r) {
      return runtime.db.transaction(async (tx) => {
        await runtime.auth.assertActor(tx, r.actor);
        return page(
          (
            await tx.query(
              "SELECT * FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC",
              [r.actor.userId],
            )
          ).rows.map((s) => ({
            id: s.id,
            client: { platform: s.client_kind, appVersion: "1" },
            createdAt: date(s.created_at),
            expiresAt: date(s.expires_at),
            current: s.id === r.actor.sessionId,
          })),
        );
      });
    },
    async revokeSession(r) {
      return runtime.db.transaction(async (tx) => {
        await runtime.auth.assertActor(tx, r.actor);
        const result = await tx.query(
          "UPDATE auth_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id",
          [r.params.sessionId, r.actor.userId],
        );
        if (!result.rowCount) fail("NOT_FOUND", 404);
        return accepted();
      });
    },
    async reauthenticate(r) {
      return requireService(runtime.proofAdapter).verify(
        r.actor,
        r.body.proof,
        r.body.purpose,
      );
    },
    async listBindings(r) {
      return page(await requireService(runtime.bindings).list(r.actor));
    },
    async createBinding(r) {
      return requireService(runtime.bindings).create(r.actor, r.body, key(r));
    },
    async deleteBinding(r) {
      await requireService(runtime.bindings).remove(
        r.actor,
        r.params.bindingId,
        r.body,
        key(r),
      );
      return accepted();
    },
    async getAccountDeletion(r) {
      return requireService(runtime.deletion).get(r.actor);
    },
    async requestAccountDeletion(r) {
      return requireService(runtime.deletion).requestAccountDeletion(
        r.actor,
        r.body,
      );
    },
    async cancelAccountDeletion(r) {
      return requireService(runtime.deletion).cancelAccountDeletion(r.actor);
    },
    async createPrivacyExport(r) {
      return requireService(runtime.privacy).createPrivacyExport(
        r.actor,
        r.body,
        key(r),
      );
    },
    async listWorkspaces(r) {
      return page((await runtime.workspaces.list(r.actor)).map(workspace));
    },
    async createWorkspace(r) {
      const created = await runtime.workspaces.createWorkspace(
        r.actor,
        r.body.kind,
        key(r),
        r.body.name,
      );
      if (runtime.provisionFonts)
        await runtime.provisionFonts(created.workspaceId);
      return workspace(
        (await runtime.workspaces.list(r.actor)).find(
          (w) => w.id === created.workspaceId,
        ),
      );
    },
    async getWorkspace(r) {
      await runtime.workspaces.authorize(r.actor, wid(r), "read");
      const list = await runtime.workspaces.list(r.actor);
      return workspace(list.find((w) => w.id === wid(r)));
    },
    async updateWorkspace(r) {
      const w = wid(r);
      await runtime.db.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "workspace:update:" + w,
        ]);
        await runtime.workspaces.authorize(r.actor, w, "manageSettings", tx);
        const changed = await tx.query(
          "UPDATE workspaces SET name=coalesce($3,name),revision=revision+1 WHERE id=$1 AND revision=$2 RETURNING id",
          [w, expected(r), r.body.name ?? null],
        );
        if (!changed.rowCount) fail("REVISION_CONFLICT", 409);
        await tx.query(
          "UPDATE workspace_settings SET revision=revision+1,default_width_mm=coalesce($2,default_width_mm),default_height_mm=coalesce($3,default_height_mm),notification_enabled=coalesce($4,notification_enabled),settings_json=settings_json||$5::jsonb WHERE workspace_id=$1",
          [
            w,
            r.body.defaultPageWidthMm ?? null,
            r.body.defaultPageHeightMm ?? null,
            r.body.notificationsEnabled ?? null,
            JSON.stringify(
              "defaultTemplateVersionId" in r.body
                ? { defaultTemplateId: r.body.defaultTemplateVersionId }
                : {},
            ),
          ],
        );
      });
      return handlers.getWorkspace(r, null);
    },
    async listMembers(r) {
      const w = wid(r);
      return runtime.db.transaction(async (tx) => {
        await runtime.workspaces.authorize(r.actor, w, "manageSettings", tx);
        const rows = (
          await tx.query(
            "SELECT m.*,u.display_name FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.state='active' ORDER BY m.created_at",
            [w],
          )
        ).rows;
        return page(
          rows.map((m) => ({
            id: m.id,
            userId: m.user_id,
            displayName: m.display_name,
            role: m.role,
            state: m.state,
            revision: Number(m.revision),
          })),
        );
      });
    },
    async getPreferences(r) {
      return runtime.db.transaction(async (tx) => {
        await runtime.auth.assertActor(tx, r.actor);
        await tx.query(
          "INSERT INTO user_preferences(id,user_id) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING",
          [id(), r.actor.userId],
        );
        const p = (
          await tx.query("SELECT * FROM user_preferences WHERE user_id=$1", [
            r.actor.userId,
          ])
        ).rows[0];
        return {
          revision: Number(p.revision),
          language: p.locale,
          timezone: p.display_timezone,
          emailNotifications: p.preferences_json.emailNotifications ?? false,
          inAppNotifications: p.preferences_json.inAppNotifications ?? true,
        };
      });
    },
    async updatePreferences(r) {
      try {
        new Intl.DateTimeFormat("zh-CN", {
          timeZone: r.body.timezone ?? "Asia/Shanghai",
        });
      } catch {
        fail("INVALID_TIMEZONE", 422);
      }
      await handlers.getPreferences(r, null);
      await runtime.db.transaction(async (tx) => {
        await runtime.auth.assertActor(tx, r.actor);
        const result = await tx.query(
          "UPDATE user_preferences SET revision=revision+1,locale=coalesce($3,locale),display_timezone=coalesce($4,display_timezone),preferences_json=preferences_json||$5::jsonb WHERE user_id=$1 AND revision=$2 RETURNING id",
          [
            r.actor.userId,
            expected(r),
            r.body.language ?? null,
            r.body.timezone ?? null,
            JSON.stringify({
              ...(r.body.emailNotifications === undefined
                ? {}
                : { emailNotifications: r.body.emailNotifications }),
              ...(r.body.inAppNotifications === undefined
                ? {}
                : { inAppNotifications: r.body.inAppNotifications }),
            }),
          ],
        );
        if (!result.rowCount) fail("REVISION_CONFLICT", 409);
      });
      return handlers.getPreferences(r, null);
    },
    async createUpload(r) {
      return requireService(runtime.uploads).beginUpload(
        r.actor,
        wid(r),
        {
          bytes: r.body.sizeBytes,
          sha256: r.body.sha256,
          mime: r.body.declaredMime,
          folderId: r.body.folderId ?? null,
          projectId: r.body.projectId ?? null,
          filename: r.body.filename,
        },
        key(r),
      );
    },
    async completeUpload(r) {
      const uploads = requireService(runtime.uploads);
      const a = await uploads.completeUpload(
        r.actor,
        wid(r),
        r.body.uploadId,
        key(r),
        {
          assetId: r.params.assetId,
          sha256: r.body.sha256,
          sizeBytes: r.body.sizeBytes,
        },
      );
      if (
        a.id !== r.params.assetId ||
        a.sha256 !== r.body.sha256 ||
        a.variants.original.byteLength !== r.body.sizeBytes
      )
        fail("UPLOAD_CHECKSUM_MISMATCH", 422);
      return uploads.getAsset(r.actor, wid(r), a.id);
    },
    async getAsset(r) {
      return requireService(runtime.uploads).getAsset(
        r.actor,
        wid(r),
        r.params.assetId,
      );
    },
    async listAssets(r) {
      return requireService(runtime.uploads).listAssets(r.actor, wid(r), {
        folderId: r.query.folderId ?? undefined,
        state: r.query.state,
        q: r.query.q,
        sort: r.query.sort,
        cursor: r.query.cursor,
        limit: r.query.limit ? Number(r.query.limit) : undefined,
      });
    },
    async moveAsset(r) {
      return requireService(runtime.uploads).moveAsset(
        r.actor,
        wid(r),
        r.params.assetId,
        expected(r),
        r.body.folderId,
        key(r),
      );
    },
    async createAssetDownloadToken(r) {
      const variant = r.body?.variant ?? r.query.variant ?? "original";
      if (!["original", "normalized", "preview"].includes(variant))
        fail("INVALID_VARIANT", 422);
      const uploads = requireService(runtime.uploads),
        a = await uploads.getAsset(r.actor, wid(r), r.params.assetId),
        v = a.editorResource?.variants[variant as "original"];
      if (!v) fail("NOT_FOUND", 404);
      const result = await uploads.download(
        r.actor,
        wid(r),
        r.params.assetId,
        variant,
      );
      return {
        ...result,
        filename: a.editorResource!.source.name,
        mime: v.mimeType,
        sizeBytes: v.byteLength,
        sha256: v.sha256,
      };
    },
    async getAssetReferences(r) {
      return requireService(runtime.uploads).references(
        r.actor,
        wid(r),
        r.params.assetId,
      );
    },
    async trashAsset(r) {
      await requireService(runtime.uploads).trashAsset(
        r.actor,
        wid(r),
        r.params.assetId,
        expected(r),
        key(r),
      );
      return accepted();
    },
    async restoreAsset(r) {
      return requireService(runtime.uploads).restoreAsset(
        r.actor,
        wid(r),
        r.params.assetId,
        r.body.folderId,
        expected(r),
        key(r),
      );
    },
    async getWorkspaceUsage(r) {
      return requireService(runtime.uploads).usage(r.actor, wid(r));
    },
    async previewFolderDelete(r) {
      return requireService(runtime.folders).previewDelete(
        r.actor,
        wid(r),
        r.params.folderId,
      );
    },
    async listFolders(r) {
      return requireService(runtime.folders).listFolders(r.actor, wid(r), {
        ...r.query,
        ...(r.query.limit === undefined
          ? {}
          : { limit: Number(r.query.limit) }),
      });
    },
    async getFolder(r) {
      return requireService(runtime.folders).getFolder(
        r.actor,
        wid(r),
        r.params.folderId,
      );
    },
    async createFolder(r) {
      return requireService(runtime.folders).createFolder(
        r.actor,
        wid(r),
        r.body.parentId ?? null,
        r.body.name,
        key(r),
      );
    },
    async updateFolder(r) {
      return requireService(runtime.folders).updateFolder(
        r.actor,
        wid(r),
        r.params.folderId,
        expected(r),
        r.body,
      );
    },
    async trashFolder(r) {
      await requireService(runtime.folders).trashFolder(
        r.actor,
        wid(r),
        r.params.folderId,
        expected(r),
        key(r),
      );
      return accepted();
    },
    async restoreFolder(r) {
      const service = requireService(runtime.folders),
        old = await service.getFolder(r.actor, wid(r), r.params.folderId);
      return service.restoreFolder(
        r.actor,
        wid(r),
        r.params.folderId,
        r.body.parentId,
        r.body.name ?? old.name,
        key(r),
        expected(r),
      );
    },
    async batchMoveAssets(r) {
      await requireService(runtime.folders).batchMoveAssets(
        r.actor,
        wid(r),
        r.body.assetIds,
        r.body.folderId,
        key(r),
      );
      return accepted();
    },
    async createProject(r) {
      const w = wid(r),
        requestKey = key(r),
        projectId =
          "prj_" +
          digest(r.actor.userId + ":" + w + ":" + requestKey).slice(0, 40),
        b = r.body;
      const document: DocumentModel = {
        schemaVersion: 1,
        projectId,
        revision: 1,
        unit: "px96",
        colorSpace: "srgb",
        mode: b.mode,
        pageSize: {
          width: (b.pageWidthMm * 96) / 25.4,
          height: (b.pageHeightMm * 96) / 25.4,
        },
        printProfile: { bleedMm: 3, safeMm: 5 },
        cover: { front: [], back: [] },
        spreads: Array.from({ length: b.spreadCount }, (_, i) => ({
          id: "spread_" + i,
          background: "#ffffff",
          layers: [],
        })),
      };
      const publishedFonts = await runtime.db.transaction(async (tx) => {
        await runtime.workspaces.authorize(r.actor, w, "read", tx);
        return (
          await tx.query(
            "SELECT b.record FROM editor_font_bundles b JOIN license_versions l ON l.id=b.license_version_id WHERE b.workspace_id=$1 AND b.state='published' AND l.embedding_allowed AND l.valid_from<=now() AND (l.valid_until IS NULL OR l.valid_until>now()) ORDER BY b.id,b.version",
            [w],
          )
        ).rows.map((row) => row.record);
      });
      let resources: any = { assets: [], fonts: publishedFonts };
      if (b.templateVersionId) {
        const t = templateVersions.find((t) => t.id === b.templateVersionId);
        if (!t) fail("TEMPLATE_UNAVAILABLE", 422);
        if (t.category !== b.scene && !(b.scene === "other"))
          fail("TEMPLATE_SCENE_MISMATCH", 422);
        const bindings = Object.fromEntries(
          (b.templateBindings ?? []).map((v: any) => [v.slotId, v.assetId]),
        );
        if (Object.keys(bindings).length !== (b.templateBindings ?? []).length)
          fail("DUPLICATE_TEMPLATE_BINDING", 422);
        const assets = await Promise.all(
          Object.values(bindings).map(
            async (asset: any) =>
              (
                await requireService(runtime.uploads).getAsset(
                  r.actor,
                  w,
                  asset,
                )
              ).editorResource,
          ),
        );
        if (assets.some((v) => !v)) fail("RESOURCE_NOT_FOUND", 404);
        const fonts = await runtime.db.transaction(async (tx) => {
          await runtime.workspaces.authorize(r.actor, w, "read", tx);
          return (
            await tx.query(
              "SELECT record FROM editor_font_bundles WHERE workspace_id=$1 AND state='published' ORDER BY id,version",
              [w],
            )
          ).rows.map((row) => row.record);
        });
        resources = { assets, fonts };
        const scale = document.pageSize.width / t.pageSize.width;
        if (
          Math.abs(scale - document.pageSize.height / t.pageSize.height) > 1e-6
        )
          fail("PAGE_ASPECT_MISMATCH", 422);
        document.spreads = document.spreads.map((spread, index) => {
          let n = 0;
          return {
            ...spread,
            templateRef: { id: t.id, version: t.version, sha256: t.sha256 },
            background: t.background,
            layers: instantiateTemplate(
              t,
              bindings,
              () => `layer_${index}_${n++}`,
            ).map((l) => ({
              ...l,
              x: Number(l.x) * scale,
              y: Number(l.y) * scale,
              width: Number(l.width) * scale,
              height: Number(l.height) * scale,
              ...(l.type === "text"
                ? {
                    fontSize: Number(l.fontSize) * scale,
                    letterSpacing: Number(l.letterSpacing) * scale,
                  }
                : {}),
              ...(l.type === "shape"
                ? {
                    strokeWidth: Number(l.strokeWidth) * scale,
                    ...(l.radius === undefined
                      ? {}
                      : { radius: Number(l.radius) * scale }),
                  }
                : {}),
            })),
          };
        });
      } else if (b.templateBindings?.length)
        fail("UNKNOWN_TEMPLATE_BINDING", 422);
      await requireService(runtime.revisions).createInitialProject(
        r.actor,
        w,
        document,
        resources,
        requestKey,
        b.name,
      );
      return projectDto(r.actor, w, projectId);
    },
    async createLayoutJob(r) {
      const accepted = await requireService(
        runtime.cloudLayout,
      ).createCloudLayoutJob(
        r.actor,
        wid(r),
        r.params.projectId,
        r.body,
        key(r),
      );
      return (
        requireService(runtime.commerce).jobs &&
        runtime.operationHandlers!.getJob(
          { ...r, params: { ...r.params, jobId: accepted.jobId } },
          null,
        )
      );
    },
    async listLayoutCandidates(r) {
      return {
        items: await requireService(runtime.cloudLayout).listCandidates(
          r.actor,
          wid(r),
          r.params.jobId,
        ),
        nextCursor: null,
        hasMore: false,
      };
    },
    async applyLayout(r) {
      if (expected(r) !== r.body.baseRevision) fail("REVISION_CONFLICT", 409);
      const saved = await requireService(runtime.cloudLayout).applyCloudLayout(
        r.actor,
        wid(r),
        r.params.projectId,
        r.body.candidateId,
        r.body.baseRevision,
        key(r),
      );
      return projectDto(
        r.actor,
        wid(r),
        r.params.projectId,
        saved.doc.revision,
      );
    },
    async getProject(r) {
      return projectDto(
        r.actor,
        wid(r),
        r.params.projectId,
        r.query.revision ? Number(r.query.revision) : undefined,
      );
    },
    async patchProject(r) {
      const service = requireService(runtime.revisions),
        pid = r.params.projectId,
        w = wid(r);
      if (r.body.clientPlatform !== r.actor.client)
        fail("CLIENT_PLATFORM_MISMATCH", 403);
      if (
        r.actor.client === "web" &&
        r.body.commands.length === 1 &&
        r.body.commands[0].type === "replaceDocument"
      ) {
        const doc = parseDocument(r.body.commands[0].document);
        if (doc.projectId !== pid) fail("PROJECT_MISMATCH", 422);
        if (!r.body.resources) fail("RESOURCE_MANIFEST_REQUIRED", 422);
        await service.saveCloudRevision(
          r.actor,
          w,
          doc,
          expected(r),
          r.body.resources,
          key(r),
        );
      } else {
        if (r.body.resources) fail("MINI_PATCH_FORBIDDEN", 403);
        await service.applyMiniPatch(
          r.actor,
          w,
          pid,
          expected(r),
          r.body.commands,
          key(r),
        );
      }
      return projectDto(r.actor, w, pid);
    },
    async listProjectRevisions(r) {
      const limit = Number(r.query.limit ?? 20);
      const cursor = r.query.cursor == null ? null : Number(r.query.cursor);
      if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1))
        fail("INVALID_CURSOR", 422);
      const rows = await requireService(runtime.revisions).list(
        r.actor,
        wid(r),
        r.params.projectId,
        cursor,
        limit + 1,
      );
      return {
        items: rows.slice(0, limit),
        hasMore: rows.length > limit,
        nextCursor:
          rows.length > limit ? String(rows[limit - 1].revision) : null,
      };
    },
    async restoreProjectRevision(r) {
      await requireService(runtime.revisions).restore(
        r.actor,
        wid(r),
        r.params.projectId,
        r.body.sourceRevision,
        expected(r),
        key(r),
      );
      return projectDto(r.actor, wid(r), r.params.projectId);
    },
    async listProjects(r) {
      const w = wid(r);
      return runtime.db.transaction(async (tx) => {
        await runtime.workspaces.authorize(r.actor, w, "read", tx);
        const rows = (
          await tx.query(
            "SELECT p.*,v.created_at AS updated_at FROM projects p JOIN project_revisions v ON v.workspace_id=p.workspace_id AND v.project_id=p.id AND v.number=p.current_revision WHERE p.workspace_id=$1 AND p.state=$2 ORDER BY p.created_at DESC LIMIT 100",
            [w, r.query.state === "trashed" ? "trashed" : "active"],
          )
        ).rows;
        return page(
          rows.map((p) => ({
            id: p.id,
            workspaceId: w,
            name: p.name,
            revision: Number(p.current_revision),
            mode: "full_editor",
            createdAt: date(p.created_at),
            updatedAt: date(p.updated_at),
            archived: false,
          })),
        );
      });
    },
    async createShare(r) {
      return requireService(runtime.sharing).create(
        r.actor,
        wid(r),
        r.body,
        key(r),
      );
    },
    async listShares(r) {
      return page(await requireService(runtime.sharing).list(r.actor, wid(r)));
    },
    async getShare(r) {
      return requireService(runtime.sharing).get(
        r.actor,
        wid(r),
        r.params.shareId,
      );
    },
    async revokeShare(r) {
      return requireService(runtime.sharing).revokeShare(
        r.actor,
        wid(r),
        r.params.shareId,
        expected(r),
      );
    },
    async accessPublicShare(r) {
      return requireService(runtime.sharing).access(
        r.params.shareToken,
        r.body?.passcode,
      );
    },
    async createSharedDownloadToken(r) {
      return requireService(runtime.sharing).download(
        header(r, "x-share-access-token"),
        r.params.outputId,
      );
    },
    async listNotifications(r) {
      return runtime.db.transaction(async (tx) => {
        await runtime.auth.assertActor(tx, r.actor);
        const limit = Number(r.query.limit ?? 20),
          rows = (
            await tx.query(
              `SELECT n.* FROM notifications n JOIN workspace_members m ON m.workspace_id=n.workspace_id AND m.user_id=$1 AND m.state='active' WHERE n.recipient_user_id=$1 AND n.expires_at>now() AND ($2::text IS NULL OR n.id>$2) ORDER BY n.id LIMIT $3`,
              [r.actor.userId, r.query.cursor ?? null, limit + 1],
            )
          ).rows;
        return {
          items: rows.slice(0, limit).map((n) => ({
            id: n.id,
            ...n.redacted_payload,
            read: Boolean(n.read_at),
            createdAt: date(n.created_at),
          })),
          nextCursor: rows.length > limit ? rows[limit - 1].id : null,
          hasMore: rows.length > limit,
        };
      });
    },
    async markNotificationRead(r) {
      await requireService(runtime.notifications).markRead(
        r.actor,
        wid(r),
        r.params.notificationId,
      );
      return runtime.db.transaction(async (tx) => {
        await runtime.workspaces.authorize(r.actor, wid(r), "read", tx);
        const n = (
          await tx.query(
            "SELECT * FROM notifications WHERE workspace_id=$1 AND id=$2 AND recipient_user_id=$3",
            [wid(r), r.params.notificationId, r.actor.userId],
          )
        ).rows[0];
        if (!n) fail("NOT_FOUND", 404);
        return {
          id: n.id,
          ...n.redacted_payload,
          read: Boolean(n.read_at),
          createdAt: date(n.created_at),
        };
      });
    },
    async setNotificationSubscription(r) {
      let w = wid(r);
      if (!w) {
        const list = await runtime.workspaces.list(r.actor);
        w = list.find((v) => v.kind === "personal")?.id;
        if (!w) fail("PERSONAL_WORKSPACE_REQUIRED", 409);
      }
      await requireService(runtime.notifications).subscribe(r.actor, w, r.body);
      return accepted();
    },
  };
  Object.assign(handlers, runtime.operationHandlers ?? {});
  for (const [path, item] of Object.entries(contract.paths) as any) {
    for (const [method, operation] of Object.entries(item) as any) {
      if (
        operation["x-module"] !== "C3" &&
        operation["x-module"] !== "C4" &&
        !handlers[operation.operationId]
      )
        continue;
      const op = operation.operationId,
        status = Number(
          Object.keys(operation.responses).find((v) => v.startsWith("2")),
        );
      fastify.route({
        method: method.toUpperCase(),
        url: "/v1" + path.replace(/\{([^}]+)\}/g, ":$1"),
        handler: async (request: any, reply: any) => {
          const requestId = id();
          reply
            .header("X-Request-Id", requestId)
            .header("Cache-Control", "no-store");
          try {
            if (
              header(request, "origin") &&
              header(request, "origin") !== runtime.allowedOrigin
            )
              fail("ORIGIN_FORBIDDEN", 403);
            for (const parameter of operation.parameters ?? []) {
              const p = resolve(parameter),
                value =
                  p.in === "path"
                    ? request.params[p.name]
                    : p.in === "query"
                      ? request.query[p.name]
                      : request.headers[p.name.toLowerCase()];
              if (p.required && (value === undefined || value === ""))
                fail(
                  p.name === "Idempotency-Key"
                    ? "IDEMPOTENCY_KEY_REQUIRED"
                    : "PARAMETER_REQUIRED",
                  p.name === "Idempotency-Key" ? 428 : 422,
                );
              if (value !== undefined) {
                let typed: any = value;
                if (p.schema?.type === "integer") {
                  typed = Number(value);
                  if (!Number.isInteger(typed)) fail("VALIDATION_FAILED", 422);
                }
                validate(p.schema, typed);
              }
            }
            const body =
              operation.requestBody && resolve(operation.requestBody);
            if (body?.required && request.body === undefined)
              fail("BODY_REQUIRED", 422);
            if (
              request.body !== undefined &&
              body &&
              !["receivePaymentCallback", "receiveRefundCallback"].includes(op)
            )
              validate(
                body.content?.["application/json"]?.schema,
                request.body,
              );
            if (!publicOperations.has(op)) {
              const bearer = header(request, "authorization"),
                session = request.cookies?.album_session;
              if (bearer && session) fail("AMBIGUOUS_AUTH", 401);
              if (bearer) {
                if (!bearer.startsWith("Bearer ")) fail("UNAUTHORIZED", 401);
                try {
                  request.actor = await runtime.auth.authenticate(
                    bearer.slice(7),
                    "mini",
                  );
                } catch (e) {
                  if (
                    !(e instanceof ServiceError) ||
                    e.status !== 401 ||
                    ![
                      "getAccountDeletion",
                      "cancelAccountDeletion",
                      "confirmQrSession",
                    ].includes(op)
                  )
                    throw e;
                  request.actor = await runtime.auth.authenticateRecovery(
                    bearer.slice(7),
                    "mini",
                  );
                }
              } else {
                if (!session) fail("UNAUTHORIZED", 401);
                try {
                  request.actor = await runtime.auth.authenticate(
                    session,
                    "web",
                  );
                } catch (e) {
                  if (
                    !(e instanceof ServiceError) ||
                    e.status !== 401 ||
                    ![
                      "getAccountDeletion",
                      "cancelAccountDeletion",
                      "getWebSession",
                      "getMe",
                    ].includes(op)
                  )
                    throw e;
                  request.actor = await runtime.auth.authenticateRecovery(
                    session,
                    "web",
                  );
                }
                if (unsafe(method.toUpperCase())) {
                  origin(request);
                  await runtime.auth.verifyCsrf(
                    request.actor,
                    header(request, "x-csrf-token"),
                  );
                }
              }
            }
            if (
              request.actor &&
              operation.security?.length &&
              !operation.security.some((rule: any) =>
                Object.keys(rule).includes(
                  request.actor.client === "mini" ? "MiniBearer" : "WebCookie",
                ),
              )
            )
              fail("CLIENT_NOT_ALLOWED", 403);
            if (request.actor && !routedPublic(op)) {
              const targets: Record<string, string> = {
                assetId: "assets",
                folderId: "asset_folders",
                projectId: "projects",
                shareId: "share_links",
                notificationId: "notifications",
                jobId: "jobs",
                orderId: "orders",
                refundId: "refunds",
                outputId: "job_outputs",
              };
              const target = Object.entries(targets).find(
                ([name]) => request.params[name],
              );
              if (
                target &&
                !request.params.workspaceId &&
                !path.startsWith("/admin/")
              ) {
                const [name, table] = target;
                const found = await runtime.db.transaction(async (tx) => {
                  await runtime.auth.assertActor(tx, request.actor);
                  return (
                    await tx.query(
                      `SELECT r.workspace_id FROM ${table} r JOIN workspace_members m ON m.workspace_id=r.workspace_id WHERE r.id=$1 AND m.user_id=$2 AND m.state='active'`,
                      [request.params[name], request.actor.userId],
                    )
                  ).rows[0];
                });
                if (
                  !found ||
                  (header(request, "x-workspace-id") &&
                    header(request, "x-workspace-id") !== found.workspace_id)
                )
                  fail("NOT_FOUND", 404);
                request.resolvedWorkspaceId = found.workspace_id;
              }
            }
            const handler = handlers[op];
            if (!handler) fail("UNCONFIGURED", 503);
            const data = await handler(request, reply);
            if (
              ["receivePaymentCallback", "receiveRefundCallback"].includes(op)
            )
              return reply.status(status).send(data);
            const envelope = { data, requestId };
            const response = resolve(operation.responses[String(status)]);
            try {
              validate(
                response?.content?.["application/json"]?.schema,
                envelope,
              );
            } catch (error) {
              if (runtime.environment === "dev")
                console.error(
                  "Contract response rejected",
                  op,
                  (error as ServiceError).details,
                );
              fail("RESPONSE_CONTRACT_VIOLATION", 500);
            }
            return reply.status(status).send(envelope);
          } catch (error) {
            const e =
              error instanceof ServiceError
                ? error
                : new ServiceError("INTERNAL_ERROR", 500);
            return reply.status(e.status).send({
              error: {
                code: e.code,
                message: e.code,
                retryable: e.status >= 500,
                details: e.status === 500 ? {} : e.details,
              },
              requestId,
            });
          }
        },
      });
    }
  }
  if (runtime.localObjects) {
    const store = runtime.localObjects;
    fastify.addContentTypeParser(
      ["application/octet-stream", "image/png", "image/jpeg"],
      { parseAs: "buffer", bodyLimit: 25000000 },
      (_request: any, body: any, done: any) => done(null, body),
    );
    fastify.route({
      method: "PUT",
      url: "/v1/dev-objects/:token",
      bodyLimit: 25000000,
      handler: async (r: any, reply: any) => {
        try {
          const locator = store.verify(r.params.token, "upload");
          if (!Buffer.isBuffer(r.body)) fail("INVALID_UPLOAD", 422);
          await store.put(locator, new Uint8Array(r.body));
          reply.header("Cache-Control", "no-store").status(204).send();
        } catch (e) {
          reply
            .status(e instanceof ServiceError ? e.status : 400)
            .send({ error: "UPLOAD_REJECTED" });
        }
      },
    });
    fastify.route({
      method: "GET",
      url: "/v1/dev-objects/:token",
      handler: async (r: any, reply: any) => {
        try {
          const locator = store.verify(r.params.token, "download");
          reply
            .header("Cache-Control", "private,no-store")
            .type("application/octet-stream")
            .send(Buffer.from(await store.read(locator)));
        } catch (e) {
          reply
            .status(e instanceof ServiceError ? e.status : 404)
            .send({ error: "DOWNLOAD_REJECTED" });
        }
      },
    });
  }
}
