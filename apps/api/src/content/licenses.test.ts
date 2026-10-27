import { it, expect } from "vitest";
import { aiFixture } from "../../test/ai-fixture";
import { LicenseService } from "./licenses";
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "license registration is immutable, idempotent, paginated and role checked before replay",
  async () => {
    const f = await aiFixture();
    try {
      const s = new LicenseService(f.database, f.auth);
      const input = {
        name: "原创插画授权",
        source: "original:studio",
        termsVersion: "2026-v1",
        commercialAllowed: true,
        embeddingAllowed: false,
        referenceImageAllowed: true,
        territories: ["CN"],
        reason: "登记原创授权",
      };
      const first = await s.create(f.actor, input, "license-once"),
        replay = await s.create(f.actor, input, "license-once");
      expect(replay).toEqual(first);
      const next = await s.create(
        f.actor,
        { ...input, termsVersion: "2026-v2" },
        "license-next",
      );
      expect(next.id).not.toBe(first.id);
      await expect(
        s.create(f.actor, { ...input, source: "changed" }, "license-once"),
      ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
      const page = await s.list(f.actor, { limit: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.hasMore).toBe(true);
      const second = await s.list(f.actor, {
        limit: 1,
        cursor: page.nextCursor!,
      });
      expect(second.items[0].id).not.toBe(page.items[0].id);
      await f.pool.query(
        "UPDATE ai_album.admin_role_assignments SET revoked_at=clock_timestamp() WHERE role='content'",
      );
      await expect(s.create(f.actor, input, "license-once")).rejects.toThrow(
        "FORBIDDEN",
      );
    } finally {
      await f.close();
    }
  },
  60000,
);
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "license evidence must be a verified platform object and expiry must be valid",
  async () => {
    const f = await aiFixture();
    try {
      const s = new LicenseService(f.database, f.auth);
      const input = {
        name: "External",
        source: "https://licenses.example.com/terms",
        termsVersion: "1",
        commercialAllowed: false,
        embeddingAllowed: false,
        referenceImageAllowed: false,
        territories: ["CN"],
        reason: "Record terms",
      };
      await expect(
        s.create(
          f.actor,
          { ...input, evidenceStagedObjectId: "another-tenant-object" },
          "bad-evidence",
        ),
      ).rejects.toThrow("EVIDENCE_UNAVAILABLE");
      await expect(
        s.create(
          f.actor,
          { ...input, expiresAt: "2020-01-01T00:00:00Z" },
          "bad-expiry",
        ),
      ).rejects.toThrow("LICENSE_EXPIRED");
      expect(
        (
          await f.pool.query(
            "SELECT count(*) FROM ai_album.license_versions WHERE source_uri=$1",
            [input.source],
          )
        ).rows[0].count,
      ).toBe("0");
    } finally {
      await f.close();
    }
  },
  60000,
);
