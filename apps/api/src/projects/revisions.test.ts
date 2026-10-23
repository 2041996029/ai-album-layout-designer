import sharp from "sharp";
import { describe, it, expect } from "vitest";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
import { patchDocument } from "./mini-patch";
import { hashDocument, type DocumentModel } from "@album/document";
import { CloudRevisionStore } from "@album/storage";
const doc = () => structuredClone(fixture) as DocumentModel;
describe("mini command whitelist", () => {
  it("edits only policy-approved fields and preserves opaque layers", () => {
    const d = doc();
    const unknown = { id: "opaque", type: "shader", settings: { blend: 17 } };
    d.spreads[0].layers = [{ id: "text", type: "text", text: "old" }, unknown];
    const result = patchDocument(
      d,
      [
        {
          type: "setText",
          spreadId: "spread_1",
          layerId: "text",
          text: "新标题",
        },
      ],
      () => ({ editableFields: ["text"] }),
    );
    expect(result.spreads[0].layers[0].text).toBe("新标题");
    expect(result.spreads[0].layers[1]).toEqual(unknown);
    expect(d.spreads[0].layers[0].text).toBe("old");
  });
  it("rejects extra properties, invalid crops and unauthorized replacement", () => {
    const d = doc();
    d.spreads[0].layers = [{ id: "photo", type: "image" }];
    for (const p of [
      {
        type: "setText",
        spreadId: "spread_1",
        layerId: "photo",
        text: "x",
        fontSize: 10,
      },
      {
        type: "setCrop",
        spreadId: "spread_1",
        layerId: "photo",
        crop: { x: 0.8, y: 0, width: 0.8, height: 1 },
      },
      {
        type: "replaceAsset",
        spreadId: "spread_1",
        layerId: "photo",
        assetId: "foreign",
      },
    ])
      expect(() =>
        patchDocument(d, [p as never], () => ({
          editableFields: ["crop", "assetId"],
          allowedAssetIds: [],
        })),
      ).toThrow("MINI_PATCH_FORBIDDEN");
  });
});
it("rejects a target nested inside a locked ancestor", () => {
  const d = doc();
  d.spreads[0].layers = [
    {
      id: "group",
      type: "group",
      locked: true,
      children: [{ id: "text", type: "text", text: "original", locked: false }],
    },
  ];
  expect(() =>
    patchDocument(
      d,
      [
        {
          type: "setText",
          spreadId: "spread_1",
          layerId: "text",
          text: "changed",
        },
      ],
      () => ({ editableFields: ["text"] }),
    ),
  ).toThrow("MINI_PATCH_FORBIDDEN");
});
it("enforces cover crop aspect ratio using trusted asset dimensions", () => {
  const d = doc();
  d.spreads[0].layers = [
    { id: "photo", type: "image", width: 200, height: 100, fitMode: "cover" },
  ];
  const policy = () => ({
    editableFields: ["crop"],
    assetDimensions: { width: 400, height: 200 },
  });
  expect(() =>
    patchDocument(
      d,
      [
        {
          type: "setCrop",
          spreadId: "spread_1",
          layerId: "photo",
          crop: { x: 0, y: 0, width: 0.5, height: 1 },
        },
      ],
      policy,
    ),
  ).toThrow("MINI_PATCH_FORBIDDEN");
  expect(
    patchDocument(
      d,
      [
        {
          type: "setCrop",
          spreadId: "spread_1",
          layerId: "photo",
          crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
        },
      ],
      policy,
    ).spreads[0].layers[0].crop,
  ).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
});
describe("cloud revision adapter", () => {
  it("loads canonical contract envelopes and retains a network-failed draft", async () => {
    const d = doc(),
      resources = { assets: [], fonts: [] },
      hash = await hashDocument(d),
      savedAt = "2026-10-23T00:00:00.000Z";
    const store = new CloudRevisionStore(
      "https://album.test",
      "wid",
      (async () =>
        new Response(
          JSON.stringify({
            data: {
              document: d,
              documentSha256: hash,
              resources,
              project: { updatedAt: savedAt },
            },
            requestId: "test",
          }),
          { status: 200 },
        )) as typeof fetch,
    );
    expect(await store.load(d.projectId, 1)).toEqual({
      doc: d,
      resources,
      docHash: hash,
      savedAt,
    });
    const offline = new CloudRevisionStore(
      "https://album.test",
      "wid",
      (async () => {
        throw Error("offline");
      }) as typeof fetch,
    );
    expect(await offline.save(d, 1, resources)).toEqual({
      ok: false,
      code: "STORAGE_FAILED",
      recoveryDraft: d,
    });
  });
  it("rejects a successful response that silently drops draft changes", async () => {
    const d = doc(),
      remote = { ...d, revision: 2 },
      resources = { assets: [], fonts: [] };
    d.customField = "unsaved edit";
    const hash = await hashDocument(remote);
    const store = new CloudRevisionStore(
      "https://album.test",
      "wid",
      (async () =>
        new Response(
          JSON.stringify({
            data: {
              document: remote,
              documentSha256: hash,
              resources,
              project: { updatedAt: "2026-10-23T00:00:00.000Z" },
            },
          }),
          { status: 200 },
        )) as typeof fetch,
    );
    expect(await store.save(d, 1, resources)).toEqual({
      ok: false,
      code: "STORAGE_FAILED",
      recoveryDraft: d,
    });
  });

  it("returns recovery draft on conflict without silently overwriting", async () => {
    let request: RequestInit | undefined;
    const fetcher = async (_: unknown, init?: RequestInit) => {
      request = init;
      return new Response("{}", { status: 409 });
    };
    const d = doc(),
      store = new CloudRevisionStore(
        "https://album.test",
        "wid",
        fetcher as typeof fetch,
      );
    expect(await store.save(d, 1, { assets: [], fonts: [] })).toEqual({
      ok: false,
      code: "REVISION_CONFLICT",
      recoveryDraft: d,
    });
    expect(new Headers(request?.headers).get("If-Match")).toBe('"1"');
  });
});

import { beforeAll, afterAll } from "vitest";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { RevisionService } from "./revisions";
import { provisionBundledFonts } from "../assets/bundled-fonts";
import { fontRecordHash, type FontRecord } from "@album/assets";
import { id, digest, type Actor, type Database } from "@album/server-core";
import type { ObjectStore, StorageConfig } from "../assets/types";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "PostgreSQL revision CAS",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      service: RevisionService,
      actor: Actor,
      wid: string;
    let miniActor: Actor, miniWid: string;
    let storageConfig: StorageConfig;
    let objectStore: ObjectStore;
    const connections = new Set<number>();
    beforeAll(async () => {
      db = await testDatabase();
      const auth = new AuthService(db.database, {
        secret: "local-test-signing-secret-at-least-32-characters",
        environment: "dev",
      });
      actor = (
        await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "revision-app",
              subject: "owner",
              unionId: null,
              openPlatformId: null,
            }),
          },
          id(),
          "web",
        )
      ).actor;
      const workspaces = new WorkspaceService(db.database, auth);
      wid = (await workspaces.createWorkspace(actor, "studio", id()))
        .workspaceId;
      miniActor = (
        await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "revision-mini-app",
              subject: "mini-owner",
              unionId: null,
              openPlatformId: null,
            }),
          },
          id(),
          "mini",
        )
      ).actor;
      miniWid = (await workspaces.createWorkspace(miniActor, "studio", id()))
        .workspaceId;
      const config: StorageConfig = (storageConfig = {
        profileVersionId: id(),
        storageProfileId: id(),
        profileVersion: 1,
        bucket: "private",
        basePrefix: "test",
      });
      await db.database.transaction(async (tx) => {
        const secret = id();
        await tx.query(
          "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose,state) VALUES($1,'dev','local-test','1','storage','available')",
          [secret],
        );
        await tx.query(
          "INSERT INTO storage_profiles(id,environment,name,state) VALUES($1,'dev','test','active')",
          [config.storageProfileId],
        );
        await tx.query(
          "INSERT INTO storage_profile_versions(id,profile_id,version,environment,provider,adapter_version,region,endpoint,bucket,base_prefix,secret_reference_id,encryption_mode) VALUES($1,$2,1,'dev','local','test','local','https://storage.test','private','test',$3,'providerManaged')",
          [config.profileVersionId, config.storageProfileId, secret],
        );
      });
      const bytes = new Map<string, Uint8Array>();
      const objects: ObjectStore = (objectStore = {
        async put(l, b) {
          bytes.set(l.key, b);
        },
        async head(l) {
          const b = bytes.get(l.key)!;
          return { bytes: b.length, sha256: digest(b) };
        },
        async read(l) {
          return bytes.get(l.key)!;
        },
        async remove(l) {
          bytes.delete(l.key);
        },
        async sign() {
          throw Error("UNCONFIGURED");
        },
      });
      const observed: Database = {
        transaction: (work) =>
          db.database.transaction(async (tx) => {
            connections.add(
              (await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
            );
            return work(tx);
          }),
      };
      service = new RevisionService(observed, workspaces, objects, config);
    }, 60000);
    afterAll(async () => {
      await db?.close();
    });
    it("creates the project and first revision atomically and rolls back invalid resources", async () => {
      const d = doc();
      d.projectId = id();
      const key = id();
      const first = await service.createInitialProject(
        actor,
        wid,
        d,
        { assets: [], fonts: [] },
        key,
        "Atomic initial",
      );
      expect(first.doc.revision).toBe(1);
      expect(
        await service.createInitialProject(
          actor,
          wid,
          d,
          { assets: [], fonts: [] },
          key,
          "Atomic initial",
        ),
      ).toEqual(first);
      const miniDoc = doc();
      miniDoc.projectId = id();
      expect(
        (
          await service.createInitialProject(
            miniActor,
            miniWid,
            miniDoc,
            { assets: [], fonts: [] },
            id(),
            "Trusted mini initial",
          )
        ).doc.revision,
      ).toBe(1);
      const invalid = doc();
      invalid.projectId = id();
      invalid.spreads[0].layers = [
        {
          id: "photo",
          type: "image",
          assetId: "missing",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          crop: { x: 0, y: 0, width: 1, height: 1 },
        },
      ];
      await expect(
        service.createInitialProject(
          actor,
          wid,
          invalid,
          { assets: [], fonts: [] },
          id(),
          "Invalid initial",
        ),
      ).rejects.toThrow("RESOURCE_MANIFEST_INCOMPLETE");
      const row = await db.database.transaction((tx) =>
        tx.query("SELECT id FROM projects WHERE workspace_id=$1 AND id=$2", [
          wid,
          invalid.projectId,
        ]),
      );
      expect(row.rowCount).toBe(0);
    });
    it("uses distinct DB connections; one concurrent writer wins and history remains recoverable", async () => {
      const d = doc();
      d.projectId = id();
      await service.createProject(actor, wid, d.projectId, "Album");
      await service.saveCloudRevision(
        actor,
        wid,
        d,
        0,
        { assets: [], fonts: [] },
        id(),
      );
      connections.clear();
      const results = await Promise.allSettled([
        service.saveCloudRevision(
          actor,
          wid,
          d,
          1,
          { assets: [], fonts: [] },
          id(),
        ),
        service.saveCloudRevision(
          actor,
          wid,
          d,
          1,
          { assets: [], fonts: [] },
          id(),
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const conflict = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      expect(conflict.reason.status).toBe(409);
      expect(connections.size).toBeGreaterThanOrEqual(2);
      for (let revision = 2; revision < 23; revision++)
        await service.saveCloudRevision(
          actor,
          wid,
          d,
          revision,
          { assets: [], fonts: [] },
          id(),
        );
      expect(
        (await service.list(actor, wid, d.projectId)).length,
      ).toBeGreaterThanOrEqual(20);
      expect(
        (await service.load(actor, wid, d.projectId, 1)).doc.revision,
      ).toBe(1);
    });
    it("binds exact immutable object references and rejects stale resource versions", async () => {
      const d = doc();
      d.projectId = id();
      await service.createProject(actor, wid, d.projectId, "Resources");
      const aId = id(),
        photoBytes = await sharp({
          create: { width: 1, height: 1, channels: 3, background: "#ffffff" },
        })
          .png()
          .toBuffer(),
        hash = digest(photoBytes),
        objects = [id(), id(), id()];
      await db.database.transaction(async (tx) => {
        for (let index = 0; index < objects.length; index++)
          await tx.query(
            "INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state,verified_at) VALUES($1,$2,$3,'private',$4,$5,$6,$7,'image/png','verified',now())",
            [
              objects[index],
              wid,
              storageConfig.profileVersionId,
              `test/${objects[index]}`,
              ["original", "normalized", "preview"][index],
              hash,
              photoBytes.length,
            ],
          );
        await tx.query(
          "INSERT INTO assets(id,workspace_id,original_object_id,original_filename,sha256,byte_size,width,height,mime_type,origin,state) VALUES($1,$2,$3,'photo.png',$4,$5,1,1,'image/png','upload','ready')",
          [aId, wid, objects[0], hash, photoBytes.length],
        );
        for (let index = 1; index < 3; index++)
          await tx.query(
            "INSERT INTO asset_variants(id,workspace_id,asset_id,variant,storage_object_id,pipeline_version,width,height) VALUES($1,$2,$3,$4,$5,'v1',1,1)",
            [
              id(),
              wid,
              aId,
              ["original", "normalized", "preview"][index],
              objects[index],
            ],
          );
      });
      await objectStore.put(
        {
          storageProfileId: storageConfig.storageProfileId,
          profileVersion: storageConfig.profileVersion,
          bucket: "private",
          key: `test/${objects[0]}`,
          objectVersionId: null,
          sha256: hash,
          variant: "original",
        },
        photoBytes,
      );
      const variant = {
        sha256: hash,
        byteLength: photoBytes.length,
        mimeType: "image/png" as const,
        width: 1,
        height: 1,
      };
      const asset = {
        id: aId,
        version: 1,
        sha256: hash,
        width: 1,
        height: 1,
        mimeType: "image/png" as const,
        source: { kind: "import" as const, name: "photo" },
        license: { id: "license", usable: true },
        status: "ready" as const,
        variants: { original: variant, normalized: variant, preview: variant },
      };
      await service.saveCloudRevision(
        actor,
        wid,
        d,
        0,
        { assets: [asset], fonts: [] },
        id(),
      );
      const refs = await db.database.transaction((tx) =>
        tx.query(
          "SELECT r.storage_object_id FROM project_revision_resources r JOIN project_revisions p ON p.id=r.revision_id WHERE p.project_id=$1",
          [d.projectId],
        ),
      );
      expect(refs.rows).toHaveLength(4);
      for (const objectId of objects)
        expect(refs.rows).toContainEqual({ storage_object_id: objectId });
      await expect(
        service.saveCloudRevision(
          actor,
          wid,
          d,
          1,
          { assets: [{ ...asset, version: 2 }], fonts: [] },
          id(),
        ),
      ).rejects.toThrow("RESOURCE_VERSION_MISMATCH");
      const bad = {
        ...asset,
        variants: {
          ...asset.variants,
          normalized: { ...variant, sha256: "c".repeat(64) },
        },
      };
      await expect(
        service.saveCloudRevision(
          actor,
          wid,
          d,
          1,
          { assets: [bad], fonts: [] },
          id(),
        ),
      ).rejects.toThrow("RESOURCE_HASH_MISMATCH");
      expect((await service.load(actor, wid, d.projectId)).doc.revision).toBe(
        1,
      );
    });
    it("saves every trusted bundled font face and rejects altered client provenance", async () => {
      const d = doc();
      d.projectId = id();
      await service.createProject(actor, wid, d.projectId, "Font bundle");
      const license = id(),
        faceObjects = [id(), id()];
      const font: FontRecord = {
        id: "bundled-test-font",
        version: 1,
        sha256: "0".repeat(64),
        family: "Trusted Font",
        source: { kind: "bundled", name: "Trusted OFL catalog" },
        license: { id: "OFL-1.1", usable: true },
        status: "ready",
        faces: [
          {
            id: "face-normal",
            sha256: "d".repeat(64),
            byteLength: 20,
            file: "normal.woff2",
            weight: 400,
            style: "normal",
            codePoints: [65],
          },
          {
            id: "face-bold",
            sha256: "e".repeat(64),
            byteLength: 30,
            file: "bold.woff2",
            weight: 700,
            style: "normal",
            codePoints: [65],
          },
        ],
      };
      const record = { ...font, sha256: await fontRecordHash(font) };
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO license_versions(id,license_key,version,source_uri,terms_hash,commercial_allowed,embedding_allowed,valid_from,territories) VALUES($1,'test-ofl',1,'https://license.test',$2,true,true,now()-interval '1 day',ARRAY['world'])",
          [license, "f".repeat(64)],
        );
        await tx.query(
          "INSERT INTO editor_font_bundles(workspace_id,id,version,sha256,record,license_version_id,state) VALUES($1,$2,1,$3,$4,$5,'published')",
          [wid, record.id, record.sha256, JSON.stringify(record), license],
        );
        for (let index = 0; index < record.faces.length; index++) {
          const face = record.faces[index];
          await tx.query(
            "INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state,verified_at) VALUES($1,$2,$3,'private',$4,'font',$5,$6,'font/woff2','verified',now())",
            [
              faceObjects[index],
              wid,
              storageConfig.profileVersionId,
              `test/fonts/${faceObjects[index]}`,
              face.sha256,
              face.byteLength,
            ],
          );
          await tx.query(
            "INSERT INTO editor_font_faces(workspace_id,bundle_id,bundle_version,face_id,storage_object_id,record) VALUES($1,$2,1,$3,$4,$5)",
            [wid, record.id, face.id, faceObjects[index], JSON.stringify(face)],
          );
        }
      });
      await service.saveCloudRevision(
        actor,
        wid,
        d,
        0,
        { assets: [], fonts: [record] },
        id(),
      );
      const refs = await db.database.transaction((tx) =>
        tx.query(
          "SELECT r.storage_object_id FROM project_revision_resources r JOIN project_revisions p ON p.id=r.revision_id WHERE p.project_id=$1",
          [d.projectId],
        ),
      );
      expect(refs.rows).toHaveLength(3);
      for (const objectId of faceObjects)
        expect(refs.rows).toContainEqual({ storage_object_id: objectId });
      const forged = {
        ...record,
        source: { kind: "bundled" as const, name: "forged" },
      };
      const bad = { ...forged, sha256: await fontRecordHash(forged) };
      await expect(
        service.saveCloudRevision(
          actor,
          wid,
          d,
          1,
          { assets: [], fonts: [bad] },
          id(),
        ),
      ).rejects.toThrow("FONT_HASH_MISMATCH");
    });
    it("saves actual C1 bundled OFL font subsets and retains every immutable face object", async () => {
      const fonts = await provisionBundledFonts(
          db.database,
          objectStore,
          storageConfig,
          wid,
        ),
        d = doc();
      d.projectId = id();
      await service.createProject(
        actor,
        wid,
        d.projectId,
        "Actual bundled fonts",
      );
      const saved = await service.saveCloudRevision(
        actor,
        wid,
        d,
        0,
        { assets: [], fonts },
        id(),
      );
      expect(saved.resources.fonts).toEqual(fonts);
      const refs = await db.database.transaction((tx) =>
        tx.query(
          "SELECT count(*) AS count FROM project_revision_resources r JOIN project_revisions p ON p.id=r.revision_id WHERE p.project_id=$1",
          [d.projectId],
        ),
      );
      expect(Number(refs.rows[0].count)).toBe(
        1 + fonts.reduce((count, f) => count + f.faces.length, 0),
      );
      expect(
        (await service.load(actor, wid, d.projectId)).resources.fonts,
      ).toEqual(fonts);
    }, 30000);
    it("rejects forged cross-workspace manifests and rolls back the revision", async () => {
      const d = doc();
      d.projectId = id();
      await service.createProject(actor, wid, d.projectId, "Album");
      const variant = {
        sha256: "a".repeat(64),
        byteLength: 20,
        mimeType: "image/png" as const,
        width: 1,
        height: 1,
      };
      const a = {
        id: "foreign",
        version: 1,
        sha256: variant.sha256,
        width: 1,
        height: 1,
        mimeType: "image/png" as const,
        source: { kind: "import" as const, name: "photo" },
        license: { id: "license", usable: true },
        status: "ready" as const,
        variants: { original: variant, normalized: variant, preview: variant },
      };
      await expect(
        service.saveCloudRevision(
          actor,
          wid,
          d,
          0,
          { assets: [a], fonts: [] },
          id(),
        ),
      ).rejects.toThrow("RESOURCE_NOT_FOUND");
      expect(await service.list(actor, wid, d.projectId)).toHaveLength(0);
    });
  },
);
