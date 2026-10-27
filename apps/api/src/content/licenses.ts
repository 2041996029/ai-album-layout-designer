import {
  digest,
  fail,
  id,
  runIdempotent,
  type Actor,
  type Database,
} from "@album/server-core";
import type { components } from "@album/contracts";
import type { AuthService } from "../auth/identity";
import { audit, requireReason, requireRoles } from "../config/secrets";
import { sqlPage } from "../commerce/pagination";
type License = components["schemas"]["LicenseRecord"];
type Input = components["schemas"]["LicenseCreate"];
export const licenseDto = (r: any): License => ({
  id: r.id,
  name: r.restrictions.name ?? r.license_key,
  source: r.source_uri,
  termsVersion: r.restrictions.termsVersion ?? r.terms_hash,
  commercialAllowed: r.commercial_allowed,
  embeddingAllowed: r.embedding_allowed,
  referenceImageAllowed: r.reference_input_allowed,
  territories: r.territories,
  ...(r.valid_until
    ? { expiresAt: new Date(r.valid_until).toISOString() }
    : {}),
  revision: r.version,
});
export class LicenseService {
  constructor(
    private db: Database,
    private auth: AuthService,
  ) {}
  async create(actor: Actor, input: Input, key: string): Promise<License> {
    requireReason(input.reason);
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["content"]);
      return runIdempotent(
        tx,
        "license-register:" + actor.userId,
        key,
        digest(JSON.stringify(input)),
        async () => {
          const at = new Date();
          if (
            input.expiresAt &&
            (!Number.isFinite(Date.parse(input.expiresAt)) ||
              new Date(input.expiresAt) <= at)
          )
            fail("LICENSE_EXPIRED", 422);
          if (input.evidenceStagedObjectId) {
            const evidence = (
              await tx.query(
                "SELECT o.id FROM storage_objects o JOIN workspaces w ON w.id=o.workspace_id WHERE o.id=$1 AND w.kind='platform' AND o.state='verified' AND o.deleted_at IS NULL FOR SHARE OF o",
                [input.evidenceStagedObjectId],
              )
            ).rows[0];
            if (!evidence) fail("EVIDENCE_UNAVAILABLE", 422);
          }
          const licenseKey = digest(input.name + ":" + input.source);
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["license:" + licenseKey],
          );
          const version = Number(
            (
              await tx.query(
                "SELECT COALESCE(max(version),0)+1 AS n FROM license_versions WHERE license_key=$1",
                [licenseKey],
              )
            ).rows[0].n,
          );
          const licenseId = id();
          const row = (
            await tx.query(
              "INSERT INTO license_versions(id,license_key,version,source_uri,terms_hash,commercial_allowed,embedding_allowed,reference_input_allowed,valid_from,valid_until,territories,restrictions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
              [
                licenseId,
                licenseKey,
                version,
                input.source,
                digest(input.termsVersion),
                input.commercialAllowed,
                input.embeddingAllowed,
                input.referenceImageAllowed,
                at,
                input.expiresAt ?? null,
                input.territories,
                {
                  name: input.name,
                  termsVersion: input.termsVersion,
                  registeredBy: actor.userId,
                  ...(input.evidenceStagedObjectId
                    ? { evidenceStagedObjectId: input.evidenceStagedObjectId }
                    : {}),
                },
              ],
            )
          ).rows[0];
          await audit(
            tx,
            actor,
            {},
            "license.registered",
            "license_version",
            licenseId,
            input.reason,
            { version, commercialAllowed: input.commercialAllowed },
          );
          return licenseDto(row);
        },
      );
    });
  }
  async list(actor: Actor, query: { limit?: number; cursor?: string } = {}) {
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["content", "platform_ops"]);
      const page = await sqlPage(
        tx,
        { actor, query },
        "licenses",
        "SELECT * FROM license_versions",
      );
      return { ...page, items: page.items.map(licenseDto) };
    });
  }
}
