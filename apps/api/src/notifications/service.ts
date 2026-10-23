import {
  type Actor,
  type Database,
  id,
  digest,
  fail,
} from "@album/server-core";
import type { PoolClient } from "pg";
export interface NotificationAuthorization {
  authorize(
    actor: Actor,
    wid: string,
    action: "read",
    tx?: PoolClient,
  ): Promise<unknown>;
}
/** Providers must persistently deduplicate idempotencyKey, including retries after uncertain delivery. */
export interface NotificationAdapter {
  send(input: {
    idempotencyKey: string;
    recipientId: string;
    templateVersion: string;
    fields: Record<string, string>;
  }): Promise<{ providerMessageId: string }>;
}
export type NotificationEvent = {
  workspaceId: string;
  recipientId: string;
  eventId: string;
  category: "job" | "billing" | "security" | "workspace" | "system";
  templateKey: string;
  templateVersion: number;
  kind:
    | "job_succeeded"
    | "job_failed"
    | "payment"
    | "refund"
    | "quota"
    | "security"
    | "system";
  title: string;
  body: string;
  resourceId?: string;
  channel: "in_app" | "wechat" | "sms";
};
export interface ConsentVerifier {
  verify(
    actor: Actor,
    templateKey: string,
    proof: string,
  ): Promise<{ templateVersion: number; destinationVerified: boolean }>;
}
export class NotificationsService {
  constructor(
    private db: Database,
    private auth: NotificationAuthorization,
    private verifier?: ConsentVerifier,
  ) {}
  async enqueue(event: NotificationEvent) {
    if (
      !event.title ||
      event.title.length > 120 ||
      !event.body ||
      event.body.length > 1000 ||
      !Number.isInteger(event.templateVersion) ||
      event.templateVersion < 1
    )
      fail("INVALID_NOTIFICATION", 422);
    return this.db.transaction(async (tx) => {
      const notificationId = id();
      const payload = {
        kind: event.kind,
        title: event.title,
        body: event.body,
        ...(event.resourceId ? { resourceId: event.resourceId } : {}),
      };
      const { rows } = await tx.query(
        `INSERT INTO notifications(id,workspace_id,recipient_user_id,event_key,category,template_key,template_version,redacted_payload,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '30 days') ON CONFLICT(workspace_id,recipient_user_id,event_key) DO UPDATE SET event_key=EXCLUDED.event_key RETURNING id`,
        [
          notificationId,
          event.workspaceId,
          event.recipientId,
          event.eventId,
          event.category,
          event.templateKey,
          event.templateVersion,
          payload,
        ],
      );
      const resultId = rows[0].id;
      await tx.query(
        `INSERT INTO outbox(id,workspace_id,event_key,aggregate_kind,aggregate_id,event_type,payload) VALUES($1,$2,$3,'notification',$4,'notification.requested',$5) ON CONFLICT(event_key) DO NOTHING`,
        [
          id(),
          event.workspaceId,
          digest(`${event.eventId}:${event.recipientId}:${event.channel}`),
          resultId,
          { channel: event.channel },
        ],
      );
      return resultId;
    });
  }
  async deliverNotification(
    eventId: string,
    adapter?: NotificationAdapter,
  ): Promise<"sent" | "skipped" | "retry"> {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "notification:" + eventId,
      ]);
      const { rows } = await tx.query(
        `SELECT o.*,n.recipient_user_id,n.category,n.template_key,n.template_version,n.redacted_payload,n.expires_at FROM outbox o JOIN notifications n ON n.workspace_id=o.workspace_id AND n.id=o.aggregate_id WHERE o.event_key=$1 AND o.event_type='notification.requested' FOR UPDATE OF o`,
        [eventId],
      );
      const row = rows[0];
      if (!row) return "skipped";
      if (row.sent_at)
        return row.last_error_code === "SUPPRESSED" ? "skipped" : "sent";
      const channel = row.payload.channel;
      const access = await tx.query(
        `SELECT 1 FROM users u JOIN workspace_members m ON m.user_id=u.id JOIN workspaces w ON w.id=m.workspace_id WHERE u.id=$1 AND m.workspace_id=$2 AND u.status='active' AND m.state='active' AND w.state='active'`,
        [row.recipient_user_id, row.workspace_id],
      );
      const prefs = await tx.query(
        "SELECT enabled FROM notification_preferences WHERE workspace_id=$1 AND user_id=$2 AND channel=$3 AND category=$4",
        [
          row.workspace_id,
          row.recipient_user_id,
          channel === "sms" ? "email_reserved" : channel,
          row.category,
        ],
      );
      let allowed =
        Boolean(access.rowCount) &&
        new Date(row.expires_at) > new Date() &&
        prefs.rows[0]?.enabled !== false;
      if (channel !== "in_app") {
        const consent = await tx.query(
          "SELECT 1 FROM notification_consents WHERE workspace_id=$1 AND user_id=$2 AND template_key=$3 AND template_version=$4 AND enabled AND destination_verified",
          [
            row.workspace_id,
            row.recipient_user_id,
            row.template_key,
            row.template_version,
          ],
        );
        allowed =
          allowed &&
          channel === "wechat" &&
          Boolean(adapter) &&
          Boolean(consent.rowCount);
      }
      if (!allowed) {
        await tx.query(
          "UPDATE outbox SET sent_at=now(),last_error_code='SUPPRESSED' WHERE id=$1",
          [row.id],
        );
        return "skipped";
      }
      try {
        const result =
          channel === "in_app"
            ? { providerMessageId: "in_app:" + row.aggregate_id }
            : await adapter!.send({
                idempotencyKey: row.event_key,
                recipientId: row.recipient_user_id,
                templateVersion: String(row.template_version),
                fields: {
                  title: row.redacted_payload.title,
                  body: row.redacted_payload.body,
                },
              });
        await tx.query(
          `INSERT INTO notification_deliveries(id,workspace_id,notification_id,channel,state,provider_message_id) VALUES($1,$2,$3,$4,'sent',$5) ON CONFLICT(workspace_id,notification_id,channel,attempt) DO NOTHING`,
          [
            id(),
            row.workspace_id,
            row.aggregate_id,
            channel,
            result.providerMessageId,
          ],
        );
        await tx.query(
          "UPDATE outbox SET sent_at=now(),delivery_attempts=delivery_attempts+1,last_error_code=NULL WHERE id=$1",
          [row.id],
        );
        return "sent";
      } catch {
        await tx.query(
          "UPDATE outbox SET delivery_attempts=delivery_attempts+1,last_error_code='DELIVERY_RETRY',available_at=now()+interval '1 minute' WHERE id=$1",
          [row.id],
        );
        return "retry";
      }
    });
  }
  async list(actor: Actor, wid: string) {
    return this.db.transaction(async (tx) => {
      await this.auth.authorize(actor, wid, "read", tx);
      const { rows } = await tx.query(
        "SELECT * FROM notifications WHERE workspace_id=$1 AND recipient_user_id=$2 AND expires_at>now() ORDER BY created_at DESC LIMIT 100",
        [wid, actor.userId],
      );
      return rows.map((r) => ({
        id: r.id,
        ...r.redacted_payload,
        read: Boolean(r.read_at),
        createdAt: new Date(r.created_at).toISOString(),
      }));
    });
  }
  async markRead(actor: Actor, wid: string, notificationId: string) {
    return this.db.transaction(async (tx) => {
      await this.auth.authorize(actor, wid, "read", tx);
      const result = await tx.query(
        "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE workspace_id=$1 AND recipient_user_id=$2 AND id=$3 RETURNING id",
        [wid, actor.userId, notificationId],
      );
      if (!result.rowCount) fail("NOT_FOUND", 404);
    });
  }
  async subscribe(
    actor: Actor,
    wid: string,
    input: {
      platform: "wechat_mini";
      templateKey: string;
      consentProof: string;
      enabled: boolean;
    },
  ) {
    if (!this.verifier) fail("NOTIFICATION_UNCONFIGURED", 503);
    const verified = await this.verifier.verify(
      actor,
      input.templateKey,
      input.consentProof,
    );
    return this.db.transaction(async (tx) => {
      await this.auth.authorize(actor, wid, "read", tx);
      await tx.query(
        `INSERT INTO notification_consents(workspace_id,user_id,template_key,template_version,enabled,destination_verified,proof_digest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,user_id,template_key) DO UPDATE SET template_version=EXCLUDED.template_version,enabled=EXCLUDED.enabled,destination_verified=EXCLUDED.destination_verified,proof_digest=EXCLUDED.proof_digest`,
        [
          wid,
          actor.userId,
          input.templateKey,
          verified.templateVersion,
          input.enabled,
          verified.destinationVerified,
          digest(input.consentProof),
        ],
      );
      return {
        platform: input.platform,
        templateKey: input.templateKey,
        enabled: input.enabled,
      };
    });
  }
}
