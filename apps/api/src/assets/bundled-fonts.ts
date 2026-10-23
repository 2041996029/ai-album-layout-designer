import { readFile } from "node:fs/promises";
import { create } from "fontkit";
import {
  fontRecordHash,
  type FontRecord,
  type ResourceManifest,
} from "@album/assets";
import { canonicalJson } from "@album/document";
import { digest, fail, id, type Database } from "@album/server-core";
import type { ObjectStore, StorageConfig } from "./types";
const publicRoot = new URL("../../../web/public/", import.meta.url);
/** Publishes repository-owned OFL fonts for the explicit local development backend only. */
export async function provisionBundledFonts(
  db: Database,
  objects: ObjectStore,
  config: StorageConfig,
  wid: string,
): Promise<FontRecord[]> {
  const manifest = JSON.parse(
    await readFile(new URL("fonts/manifest.json", publicRoot), "utf8"),
  ) as ResourceManifest;
  const licenseText = await readFile(
    new URL("fonts/OFL.txt", publicRoot),
    "utf8",
  );
  return db.transaction(async (tx) => {
    const profile = (
      await tx.query("SELECT * FROM storage_profile_versions WHERE id=$1", [
        config.profileVersionId,
      ])
    ).rows[0];
    if (
      !profile ||
      profile.environment !== "dev" ||
      profile.provider !== "local" ||
      profile.profile_id !== config.storageProfileId ||
      profile.bucket !== config.bucket
    )
      fail("DEV_ONLY");
    if (
      !(await tx.query("SELECT id FROM workspaces WHERE id=$1", [wid])).rowCount
    )
      fail("NOT_FOUND", 404);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      wid + ":bundled-fonts",
    ]);
    const termsHash = digest(licenseText),
      licenseKey = "bundled-font-OFL-1.1:" + termsHash;
    let license = (
      await tx.query(
        "SELECT * FROM license_versions WHERE license_key=$1 AND version=1",
        [licenseKey],
      )
    ).rows[0];
    if (!license)
      license = (
        await tx.query(
          "INSERT INTO license_versions(id,license_key,version,source_uri,terms_hash,commercial_allowed,embedding_allowed,valid_from,territories,restrictions) VALUES($1,$2,1,'https://openfontlicense.org/', $3,true,true,'2007-02-26T00:00:00Z',ARRAY['worldwide'],'{}') RETURNING *",
          [id(), licenseKey, termsHash],
        )
      ).rows[0];
    for (const font of manifest.fonts) {
      if (
        font.source.kind !== "bundled" ||
        font.license.id !== "OFL-1.1" ||
        !font.license.text ||
        !licenseText.includes(font.license.text) ||
        !font.license.usable ||
        (await fontRecordHash(font)) !== font.sha256
      )
        fail("BUNDLED_FONT_MANIFEST_INVALID");
      const existing = (
        await tx.query(
          "SELECT * FROM editor_font_bundles WHERE workspace_id=$1 AND id=$2 AND version=$3",
          [wid, font.id, font.version],
        )
      ).rows[0];
      if (existing) {
        if (
          canonicalJson(existing.record) !== canonicalJson(font) ||
          existing.sha256 !== font.sha256 ||
          existing.license_version_id !== license.id
        )
          fail("BUNDLED_FONT_IDENTITY_CONFLICT", 409);
        continue;
      }
      await tx.query(
        "INSERT INTO editor_font_bundles(workspace_id,id,version,sha256,record,license_version_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          wid,
          font.id,
          font.version,
          font.sha256,
          JSON.stringify(font),
          license.id,
        ],
      );
      for (const face of font.faces) {
        if (!/^\/fonts\/[a-z0-9-]+\.woff2$/.test(face.file))
          fail("BUNDLED_FONT_FILE_INVALID");
        const bytes = new Uint8Array(
          await readFile(new URL(face.file.slice(1), publicRoot)),
        );
        if (bytes.length !== face.byteLength || digest(bytes) !== face.sha256)
          fail("BUNDLED_FONT_HASH_MISMATCH");
        const parsed = create(Buffer.from(bytes));
        if (!("characterSet" in parsed)) fail("BUNDLED_FONT_INVALID");
        if (
          canonicalJson([...parsed.characterSet].sort((a, b) => a - b)) !==
            canonicalJson(face.codePoints) ||
          (parsed as unknown as { "OS/2": { usWeightClass: number } })["OS/2"]
            .usWeightClass !== face.weight
        )
          fail("BUNDLED_FONT_FACE_MISMATCH");
        const objectId = id(),
          key = `${config.basePrefix}/${wid}/bundled-fonts/${font.sha256}/${face.sha256}.woff2`;
        await objects.put(
          {
            storageProfileId: config.storageProfileId,
            profileVersion: config.profileVersion,
            bucket: config.bucket,
            key,
            objectVersionId: null,
            sha256: face.sha256,
            variant: "font",
          },
          bytes,
        );
        await tx.query(
          "INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state,verified_at) VALUES($1,$2,$3,$4,$5,'font',$6,$7,'font/woff2','verified',now())",
          [
            objectId,
            wid,
            config.profileVersionId,
            config.bucket,
            key,
            face.sha256,
            bytes.length,
          ],
        );
        await tx.query(
          "INSERT INTO editor_font_faces(workspace_id,bundle_id,bundle_version,face_id,storage_object_id,record) VALUES($1,$2,$3,$4,$5,$6)",
          [wid, font.id, font.version, face.id, objectId, JSON.stringify(face)],
        );
      }
    }
    return [...manifest.fonts];
  });
}
