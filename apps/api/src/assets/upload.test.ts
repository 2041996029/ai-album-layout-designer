import { expect, it } from "vitest";
import { LocalObjectStore } from "./object-store";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
it("private local storage refuses production and detects corrupted object hashes", async () => {
  const root = await mkdtemp(tmpdir() + "/c3-objects-");
  try {
    expect(
      () =>
        new LocalObjectStore({
          root,
          secret: "x".repeat(32),
          environment: "prod",
          baseUrl: "http://localhost",
        }),
    ).toThrow("DEV_ONLY");
    const store = new LocalObjectStore({
      root,
      secret: "x".repeat(32),
      environment: "dev",
      baseUrl: "http://localhost",
    });
    const locator = {
      storageProfileId: "p",
      profileVersion: 1,
      bucket: "b",
      key: "a",
      objectVersionId: null,
      sha256: "0".repeat(64),
      variant: "original",
    };
    await expect(store.put(locator, new Uint8Array([1]))).rejects.toThrow(
      "HASH_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
import { beforeAll, afterAll, describe } from "vitest";
import { testDatabase } from "../../test/database";
import { storageFixture } from "../../test/asset-fixtures";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { UploadService } from "./upload";
import { digest } from "@album/server-core";
import sharp from "sharp";
import { MigrationService } from "./migration";
import { id } from "@album/server-core";
import { provisionDevelopmentStorage } from "./development";
import { FolderService } from "../folders/service";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "real upload quota and image validation",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      ws: WorkspaceService,
      actor: any,
      wid: string,
      store: LocalObjectStore,
      service: UploadService,
      root: string,
      config: any;
    let limit = 100000;
    beforeAll(async () => {
      db = await testDatabase();
      const auth = new AuthService(db.database, {
        secret: "x".repeat(40),
        environment: "dev",
      });
      actor = (
        await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "app",
              subject: "uploads",
              unionId: null,
              openPlatformId: null,
            }),
          },
          "uploads-code",
          "mini",
        )
      ).actor;
      ws = new WorkspaceService(db.database, auth);
      wid = (await ws.createWorkspace(actor, "personal", "w")).workspaceId;
      config = await storageFixture(db.database);
      root = await mkdtemp(tmpdir() + "/c3-upload-");
      store = new LocalObjectStore({
        root,
        secret: "x".repeat(40),
        environment: "dev",
        baseUrl: "http://localhost",
      });
      service = new UploadService(
        db.database,
        ws,
        store,
        {
          readQuota: async () => ({ limitBytes: limit, maxProjectPhotos: 500 }),
        },
        config,
      );
    }, 60000);
    afterAll(async () => {
      await db?.close();
      await rm(root, { recursive: true, force: true });
    });
    it("serializes concurrent reservations and binds idempotency payload", async () => {
      limit = 100;
      const input = {
        bytes: 100,
        sha256: digest("x"),
        mime: "image/png" as const,
        folderId: null,
        projectId: null,
      };
      const results = await Promise.allSettled([
        service.beginUpload(actor, wid, input, "concurrent-a"),
        service.beginUpload(actor, wid, input, "concurrent-b"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    });
    it("rejects fake JPEG bytes and decodes valid PNG into immutable variants", async () => {
      limit = 100000;
      const fake = Buffer.from("fake jpeg");
      const ticket = await service.beginUpload(
        actor,
        wid,
        {
          bytes: fake.length,
          sha256: digest(fake),
          mime: "image/jpeg",
          folderId: null,
          projectId: null,
        },
        "fake",
      );
      await store.put(
        store.verify(ticket.url.split("/").at(-1)!, "upload"),
        fake,
      );
      await expect(
        service.completeUpload(actor, wid, ticket.uploadId, "fake-complete"),
      ).rejects.toThrow("INVALID_IMAGE");
      const png = await sharp({
        create: { width: 2, height: 3, channels: 3, background: "#ff0000" },
      })
        .png()
        .toBuffer();
      const good = await service.beginUpload(
        actor,
        wid,
        {
          bytes: png.length,
          sha256: digest(png),
          mime: "image/png",
          folderId: null,
          projectId: null,
        },
        "png",
      );
      await store.put(store.verify(good.url.split("/").at(-1)!, "upload"), png);
      const record = await service.completeUpload(
        actor,
        wid,
        good.uploadId,
        "png-complete",
      );
      expect(record).toMatchObject({ width: 2, height: 3, status: "ready" });
      expect(
        (await service.getAsset(actor, wid, record.id)).editorResource,
      ).toEqual(record);
      expect(
        digest(
          await service
            .createResourcePort(actor, wid)
            .read(record.id, "normalized"),
        ),
      ).toBe(record.variants.normalized.sha256);
    });
    it("provisions only explicit development storage and retains source on migration verification failure", async () => {
      await expect(
        provisionDevelopmentStorage(db.database, "prod"),
      ).rejects.toThrow("DEV_ONLY");
      expect(
        (await provisionDevelopmentStorage(db.database, "dev")).bucket,
      ).toBe("private");
      const target = await storageFixture(db.database);
      const item = await db.database.transaction(async (tx) => {
        const object = (
          await tx.query(
            "SELECT * FROM storage_objects WHERE workspace_id=$1 AND kind='original' LIMIT 1",
            [wid],
          )
        ).rows[0];
        const migration = id(),
          item = id();
        await tx.query(
          "INSERT INTO storage_migrations(id,workspace_id,source_profile_version_id,target_profile_version_id,confirmed_by,estimated_bytes,estimated_cost_fen) VALUES($1,$2,$3,$4,$5,$6,0)",
          [
            migration,
            wid,
            config.profileVersionId,
            target.profileVersionId,
            actor.userId,
            object.byte_size,
          ],
        );
        await tx.query(
          "INSERT INTO storage_migration_items(id,workspace_id,migration_id,source_object_id,expected_locator_revision) VALUES($1,$2,$3,$4,1)",
          [item, wid, migration, object.id],
        );
        return { id: item, source: object.id };
      });
      const broken = {
        put: store.put.bind(store),
        read: store.read.bind(store),
        remove: store.remove.bind(store),
        sign: store.sign.bind(store),
        head: async () => ({ bytes: 0, sha256: "0".repeat(64) }),
      };
      expect(
        await new MigrationService(db.database).migrateObject(item.id, broken),
      ).toEqual({ state: "failed", oldLocatorRetained: true });
      expect(
        (
          await db.database.transaction((tx) =>
            tx.query(
              "SELECT original_object_id FROM assets WHERE workspace_id=$1 AND original_object_id=$2",
              [wid, item.source],
            ),
          )
        ).rowCount,
      ).toBe(1);
    });

    it("rejects referenced subtree deletion without changing object locators", async () => {
      const folders = new FolderService(db.database, ws),
        folder = await folders.createFolder(
          actor,
          wid,
          null,
          "referenced",
          "referenced",
        );
      const asset = await db.database.transaction(async (tx) => {
        const asset = (
          await tx.query(
            "SELECT * FROM assets WHERE workspace_id=$1 AND state='ready' LIMIT 1",
            [wid],
          )
        ).rows[0];
        await tx.query(
          "UPDATE assets SET folder_id=$3,revision=revision+1 WHERE workspace_id=$1 AND id=$2",
          [wid, asset.id, folder.id],
        );
        const project = id(),
          revision = id();
        await tx.query(
          "INSERT INTO projects(id,workspace_id,name,current_revision,created_by) VALUES($1,$2,'references',1,$3)",
          [project, wid, actor.userId],
        );
        await tx.query(
          "INSERT INTO project_revisions(id,workspace_id,project_id,number,schema_version,storage_object_id,document_hash,spread_count,photo_count,created_by,command_id,base_revision) VALUES($1,$2,$3,1,1,$4,$5,1,1,$6,$7,0)",
          [
            revision,
            wid,
            project,
            asset.original_object_id,
            asset.sha256,
            actor.userId,
            id(),
          ],
        );
        await tx.query(
          "INSERT INTO project_revision_assets(id,workspace_id,revision_id,asset_id) VALUES($1,$2,$3,$4)",
          [id(), wid, revision, asset.id],
        );
        return asset;
      });
      await expect(
        folders.trashFolder(actor, wid, folder.id, 1, "referenced-trash"),
      ).rejects.toThrow("ASSET_IN_USE");
      await folders.updateFolder(actor, wid, folder.id, 1, { name: "renamed" });
      const after = await service.getAsset(actor, wid, asset.id);
      expect(after.state).toBe("ready");
      expect(
        (
          await db.database.transaction((tx) =>
            tx.query("SELECT original_object_id FROM assets WHERE id=$1", [
              asset.id,
            ]),
          )
        ).rows[0].original_object_id,
      ).toBe(asset.original_object_id);
    });

    it("holds the original reservation on derived-byte quota rejection and consumes it only once on successful retry", async () => {
      const quotaWid = (
        await ws.createWorkspace(actor, "studio", "derived-quota-workspace")
      ).workspaceId;
      const pixels = Buffer.alloc(64 * 64 * 3);
      for (let i = 0; i < pixels.length; i++)
        pixels[i] = (i * 73 + ((i * i) >> 3)) % 256;
      const jpeg = await sharp(pixels, {
        raw: { width: 64, height: 64, channels: 3 },
      })
        .jpeg({ quality: 15 })
        .toBuffer();
      const normalized = await sharp(jpeg)
        .rotate()
        .toColourspace("srgb")
        .png()
        .toBuffer();
      expect(normalized.length).toBeGreaterThan(jpeg.length);
      limit = jpeg.length + 1;
      const ticket = await service.beginUpload(
        actor,
        quotaWid,
        {
          bytes: jpeg.length,
          sha256: digest(jpeg),
          mime: "image/jpeg",
          folderId: null,
          projectId: null,
        },
        "derived-input",
      );
      await store.put(
        store.verify(ticket.url.split("/").at(-1)!, "upload"),
        jpeg,
      );
      await expect(
        service.completeUpload(
          actor,
          quotaWid,
          ticket.uploadId,
          "derived-complete",
        ),
      ).rejects.toThrow("STORAGE_QUOTA_EXCEEDED");
      const rejected = await db.database.transaction((tx) =>
        tx.query(
          "SELECT used_bytes,reserved_bytes FROM storage_usage_accounts WHERE workspace_id=$1",
          [quotaWid],
        ),
      );
      expect(Number(rejected.rows[0].used_bytes)).toBe(0);
      expect(Number(rejected.rows[0].reserved_bytes)).toBe(jpeg.length);
      expect(
        (
          await db.database.transaction((tx) =>
            tx.query("SELECT id FROM storage_objects WHERE workspace_id=$1", [
              quotaWid,
            ]),
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (await service.getAsset(actor, quotaWid, ticket.assetId)).state,
      ).toBe("pending_upload");
      limit = 1000000;
      await service.completeUpload(
        actor,
        quotaWid,
        ticket.uploadId,
        "derived-complete",
      );
      await service.completeUpload(
        actor,
        quotaWid,
        ticket.uploadId,
        "derived-replay",
      );
      const used = await db.database.transaction((tx) =>
        tx.query(
          "SELECT used_bytes,reserved_bytes FROM storage_usage_accounts WHERE workspace_id=$1",
          [quotaWid],
        ),
      );
      expect(Number(used.rows[0].reserved_bytes)).toBe(0);
      const sum = await db.database.transaction((tx) =>
        tx.query(
          "SELECT sum(byte_size) AS total FROM storage_objects WHERE workspace_id=$1",
          [quotaWid],
        ),
      );
      expect(Number(used.rows[0].used_bytes)).toBe(Number(sum.rows[0].total));
    });
    it("rejects completion ticket mismatches before creating ready objects", async () => {
      limit = 1000000;
      const png = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "#00ff00" },
      })
        .png()
        .toBuffer();
      const ticket = await service.beginUpload(
        actor,
        wid,
        {
          bytes: png.length,
          sha256: digest(png),
          mime: "image/png",
          folderId: null,
          projectId: null,
        },
        "binding-ticket",
      );
      await store.put(
        store.verify(ticket.url.split("/").at(-1)!, "upload"),
        png,
      );
      await expect(
        service.completeUpload(
          actor,
          wid,
          ticket.uploadId,
          "binding-complete",
          {
            assetId: "wrong-asset",
            sha256: digest(png),
            sizeBytes: png.length,
          },
        ),
      ).rejects.toThrow("UPLOAD_TICKET_MISMATCH");
      expect((await service.getAsset(actor, wid, ticket.assetId)).state).toBe(
        "pending_upload",
      );
      await expect(
        service.completeUpload(
          actor,
          wid,
          ticket.uploadId,
          "binding-checksum",
          {
            assetId: ticket.assetId,
            sha256: "0".repeat(64),
            sizeBytes: png.length,
          },
        ),
      ).rejects.toThrow("UPLOAD_TICKET_MISMATCH");
    });

    it("pages and searches recycled assets by exact folder, name and creation order without losing timestamp precision", async () => {
      const folder = await new FolderService(db.database, ws).createFolder(
        actor,
        wid,
        null,
        "paging-assets",
        "paging-assets",
      );
      await db.database.transaction(async (tx) => {
        const source = (
          await tx.query(
            "SELECT * FROM assets WHERE workspace_id=$1 AND state='ready' LIMIT 1",
            [wid],
          )
        ).rows[0];
        for (const [index, name] of [
          "paging-photo-B",
          "paging-photo-A",
          "paging-photo-C",
        ].entries())
          await tx.query(
            "INSERT INTO assets(id,workspace_id,folder_id,original_object_id,original_filename,sha256,byte_size,width,height,mime_type,origin,state,deleted_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'upload','trashed',now(),$11)",
            [
              id(),
              wid,
              folder.id,
              source.original_object_id,
              name,
              source.sha256,
              source.byte_size,
              source.width,
              source.height,
              source.mime_type,
              "2026-10-21T00:00:00.000" + (index + 1) + "11Z",
            ],
          );
      });
      const query = {
        state: "trashed" as const,
        folderId: folder.id,
        q: "paging-photo",
        limit: 1,
        sort: "name_asc" as const,
      };
      const first = await service.listAssets(actor, wid, query);
      expect(first.items.map((a) => a.originalFilename)).toEqual([
        "paging-photo-A",
      ]);
      const second = await service.listAssets(actor, wid, {
        ...query,
        cursor: first.nextCursor,
      });
      expect(second.items.map((a) => a.originalFilename)).toEqual([
        "paging-photo-B",
      ]);
      await expect(
        service.listAssets(actor, wid, {
          ...query,
          state: "ready",
          cursor: first.nextCursor,
        }),
      ).rejects.toThrow("INVALID_CURSOR");
      const creationQuery = { ...query, sort: "created_desc" as const };
      const names: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await service.listAssets(actor, wid, {
          ...creationQuery,
          cursor,
        });
        names.push(...page.items.map((a) => a.originalFilename));
        cursor = page.nextCursor;
      } while (cursor);
      expect(names).toEqual([
        "paging-photo-C",
        "paging-photo-A",
        "paging-photo-B",
      ]);
    });

    it("previews references and recycles/restores verified bytes with CAS and measured usage", async () => {
      limit = 1000000;
      const folders = new FolderService(db.database, ws),
        parent = await folders.createFolder(
          actor,
          wid,
          null,
          "lifecycle-parent",
          "lifecycle-parent",
        ),
        child = await folders.createFolder(
          actor,
          wid,
          parent.id,
          "lifecycle-child",
          "lifecycle-child",
        );
      const png = await sharp({
          create: { width: 7, height: 5, channels: 3, background: "#783ac1" },
        })
          .png()
          .toBuffer(),
        ticket = await service.beginUpload(
          actor,
          wid,
          {
            bytes: png.length,
            sha256: digest(png),
            mime: "image/png",
            folderId: child.id,
            projectId: null,
            filename: "lifecycle.png",
          },
          "lifecycle-upload",
        );
      await store.put(
        store.verify(ticket.url.split("/").at(-1)!, "upload"),
        png,
      );
      const resource = await service.completeUpload(
          actor,
          wid,
          ticket.uploadId,
          "lifecycle-complete",
        ),
        before = await service.getAsset(actor, wid, resource.id);
      expect(await service.references(actor, wid, resource.id)).toEqual({
        projects: [],
        activeJobCount: 0,
        retentionBlocked: false,
      });
      expect(await folders.previewDelete(actor, wid, parent.id)).toMatchObject({
        folderId: parent.id,
        revision: 1,
        subfolderCount: 1,
        assetCount: 1,
        canDelete: true,
      });
      const usage = await service.usage(actor, wid);
      expect(usage).toMatchObject({
        storageLimitBytes: limit,
        seatCount: 1,
        seatLimit: 1,
        projectLimit: Number.MAX_SAFE_INTEGER,
      });
      await expect(
        service.trashAsset(actor, wid, resource.id, 0, "lifecycle-stale"),
      ).rejects.toThrow("REVISION_CONFLICT");
      const trashed = await service.trashAsset(
        actor,
        wid,
        resource.id,
        before.revision,
        "lifecycle-trash",
      );
      expect(trashed.state).toBe("trashed");
      expect((await service.usage(actor, wid)).storageBytes).toBe(
        usage.storageBytes,
      );
      expect((await service.usage(actor, wid)).recycleBinBytes).toBeGreaterThan(
        usage.recycleBinBytes,
      );
      await expect(
        service.createResourcePort(actor, wid).read(resource.id, "normalized"),
      ).rejects.toThrow("NOT_FOUND");
      await expect(
        service.restoreAsset(
          actor,
          wid,
          resource.id,
          child.id,
          0,
          "lifecycle-restore-stale",
        ),
      ).rejects.toThrow("REVISION_CONFLICT");
      const restored = await service.restoreAsset(
        actor,
        wid,
        resource.id,
        child.id,
        trashed.revision,
        "lifecycle-restore",
      );
      expect(restored.state).toBe("ready");
      expect(restored.editorResource).toEqual(resource);
      expect(
        digest(
          await service
            .createResourcePort(actor, wid)
            .read(resource.id, "normalized"),
        ),
      ).toBe(resource.variants.normalized.sha256);
      expect((await service.usage(actor, wid)).recycleBinBytes).toBe(
        usage.recycleBinBytes,
      );
      const referenced = (
        await db.database.transaction((tx) =>
          tx.query(
            "SELECT a.* FROM assets a JOIN project_revision_assets r ON r.workspace_id=a.workspace_id AND r.asset_id=a.id WHERE a.workspace_id=$1 LIMIT 1",
            [wid],
          ),
        )
      ).rows[0];
      const references = await service.references(actor, wid, referenced.id);
      expect(references.projects.length).toBeGreaterThan(0);
      await expect(
        service.trashAsset(
          actor,
          wid,
          referenced.id,
          Number(referenced.revision),
          "referenced-asset-trash",
        ),
      ).rejects.toThrow("ASSET_IN_USE");
      const preview = await folders.previewDelete(
        actor,
        wid,
        referenced.folder_id,
      );
      expect(preview.canDelete).toBe(false);
      expect(preview.references.projects).toEqual(references.projects);
    });

    it("counts exact object pins and retained revisions as blockers even when no assetId is on the pin", async () => {
      const pinned = await db.database.transaction(async (tx) => {
        const asset = (
            await tx.query(
              "SELECT * FROM assets WHERE workspace_id=$1 AND original_filename='lifecycle.png' AND state='ready'",
              [wid],
            )
          ).rows[0],
          object = (
            await tx.query(
              "SELECT storage_object_id FROM asset_variants WHERE workspace_id=$1 AND asset_id=$2 AND variant='normalized'",
              [wid, asset.id],
            )
          ).rows[0],
          release = id(),
          snapshot = id(),
          job = id(),
          pin = id();
        await tx.query(
          "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',1,1,$2,'{}',$3)",
          [release, digest("test-release"), actor.userId],
        );
        await tx.query(
          "INSERT INTO job_snapshots(id,workspace_id,kind,config_release_id,schema_version,normalized_spec_hash,manifest_hash,manifest,entitlement_snapshot,warnings_acknowledged) VALUES($1,$2,'asset_analysis',$3,1,$4,$4,'{}','{}','[]')",
          [snapshot, wid, release, digest("test-snapshot")],
        );
        await tx.query(
          "INSERT INTO jobs(id,workspace_id,kind,snapshot_id,created_by) VALUES($1,$2,'asset_analysis',$3,$4)",
          [job, wid, snapshot, actor.userId],
        );
        await tx.query(
          "INSERT INTO resource_pins(id,workspace_id,job_id,storage_workspace_id,storage_object_id) VALUES($1,$2,$3,$2,$4)",
          [pin, wid, job, object.storage_object_id],
        );
        return { asset, pin };
      });
      expect(await service.references(actor, wid, pinned.asset.id)).toEqual({
        projects: [],
        activeJobCount: 1,
        retentionBlocked: true,
      });
      await expect(
        service.trashAsset(
          actor,
          wid,
          pinned.asset.id,
          Number(pinned.asset.revision),
          "object-pinned-trash",
        ),
      ).rejects.toThrow("ASSET_IN_USE");
      await db.database.transaction((tx) =>
        tx.query("UPDATE resource_pins SET released_at=now() WHERE id=$1", [
          pinned.pin,
        ]),
      );
      expect(await service.references(actor, wid, pinned.asset.id)).toEqual({
        projects: [],
        activeJobCount: 0,
        retentionBlocked: false,
      });
      const referenced = await db.database.transaction(async (tx) => {
        const r = (
          await tx.query(
            "SELECT r.* FROM project_revisions r JOIN project_revision_assets a ON a.workspace_id=r.workspace_id AND a.revision_id=r.id WHERE r.workspace_id=$1 LIMIT 1",
            [wid],
          )
        ).rows[0];
        await tx.query(
          "INSERT INTO project_revisions(id,workspace_id,project_id,number,schema_version,storage_object_id,document_hash,spread_count,photo_count,created_by,command_id,base_revision) VALUES($1,$2,$3,2,1,$4,$5,1,0,$6,$7,1)",
          [
            id(),
            wid,
            r.project_id,
            r.storage_object_id,
            r.document_hash,
            actor.userId,
            id(),
          ],
        );
        await tx.query(
          "UPDATE projects SET current_revision=2 WHERE workspace_id=$1 AND id=$2",
          [wid, r.project_id],
        );
        return (
          await tx.query(
            "SELECT asset_id FROM project_revision_assets WHERE workspace_id=$1 AND revision_id=$2",
            [wid, r.id],
          )
        ).rows[0].asset_id;
      });
      expect(
        (await service.references(actor, wid, referenced)).retentionBlocked,
      ).toBe(true);
    });
    it("moves one asset with metadata CAS while preserving immutable content and locator identities", async () => {
      const asset = (
        await db.database.transaction((tx) =>
          tx.query(
            "SELECT * FROM assets WHERE workspace_id=$1 AND original_filename='lifecycle.png' AND state='ready'",
            [wid],
          ),
        )
      ).rows[0];
      const target = await new FolderService(db.database, ws).createFolder(
        actor,
        wid,
        null,
        "single-move",
        "single-move",
      );
      const before = await service.getAsset(actor, wid, asset.id);
      await expect(
        service.moveAsset(
          actor,
          wid,
          asset.id,
          Number(asset.revision) - 1,
          target.id,
          "single-move-stale",
        ),
      ).rejects.toThrow("REVISION_CONFLICT");
      expect((await service.getAsset(actor, wid, asset.id)).folderId).toBe(
        asset.folder_id,
      );
      const moved = await service.moveAsset(
        actor,
        wid,
        asset.id,
        Number(asset.revision),
        target.id,
        "single-move",
      );
      expect(moved.folderId).toBe(target.id);
      expect(moved.revision).toBe(Number(asset.revision) + 1);
      expect(moved.editorResource).toEqual(before.editorResource);
      expect(
        (
          await db.database.transaction((tx) =>
            tx.query(
              "SELECT original_object_id FROM assets WHERE workspace_id=$1 AND id=$2",
              [wid, asset.id],
            ),
          )
        ).rows[0].original_object_id,
      ).toBe(asset.original_object_id);
      expect(
        await service.moveAsset(
          actor,
          wid,
          asset.id,
          Number(asset.revision),
          target.id,
          "single-move",
        ),
      ).toEqual(moved);
      await expect(
        service.moveAsset(
          actor,
          wid,
          asset.id,
          moved.revision,
          "foreign-folder",
          "single-move-foreign",
        ),
      ).rejects.toThrow("NOT_FOUND");
    });

    it("completes a v1 upload after profile rotation using the frozen original locator", async () => {
      limit = 1000000;
      const png = await sharp({
        create: { width: 13, height: 11, channels: 3, background: "#e89328" },
      })
        .png()
        .toBuffer();
      const ticket = await service.beginUpload(
        actor,
        wid,
        {
          bytes: png.length,
          sha256: digest(png),
          mime: "image/png",
          folderId: null,
          projectId: null,
        },
        "profile-v1-upload",
      );
      const originalLocator = store.verify(
        ticket.url.split("/").at(-1)!,
        "upload",
      );
      await store.put(originalLocator, png);
      const versionId = id();
      await db.database.transaction((tx) =>
        tx.query(
          "INSERT INTO storage_profile_versions(id,profile_id,version,environment,provider,adapter_version,region,endpoint,bucket,base_prefix,secret_reference_id,encryption_mode) SELECT $1,profile_id,version+1,environment,provider,adapter_version,region,endpoint,'private-v2','objects-v2',secret_reference_id,encryption_mode FROM storage_profile_versions WHERE id=$2",
          [versionId, config.profileVersionId],
        ),
      );
      const rotated = new UploadService(
        db.database,
        ws,
        store,
        {
          readQuota: async () => ({ limitBytes: limit, maxProjectPhotos: 500 }),
        },
        {
          ...config,
          profileVersionId: versionId,
          profileVersion: 2,
          bucket: "private-v2",
          basePrefix: "objects-v2",
        },
      );
      const record = await rotated.completeUpload(
        actor,
        wid,
        ticket.uploadId,
        "profile-v2-complete",
      );
      expect(
        digest(
          await rotated
            .createResourcePort(actor, wid)
            .read(record.id, "original"),
        ),
      ).toBe(digest(png));
      const original = (
        await db.database.transaction((tx) =>
          tx.query(
            "SELECT o.* FROM assets a JOIN storage_objects o ON o.workspace_id=a.workspace_id AND o.id=a.original_object_id WHERE a.workspace_id=$1 AND a.id=$2",
            [wid, record.id],
          ),
        )
      ).rows[0];
      expect(original).toMatchObject({
        profile_version_id: config.profileVersionId,
        bucket: originalLocator.bucket,
        object_key: originalLocator.key,
      });
      expect(
        digest(
          await rotated
            .createResourcePort(actor, wid)
            .read(record.id, "normalized"),
        ),
      ).toBe(record.variants.normalized.sha256);
    });
    it("resolves trusted asset metadata inside an existing transaction without acquiring a second connection", async () => {
      const asset = (
        await db.database.transaction((tx) =>
          tx.query(
            "SELECT id FROM assets WHERE workspace_id=$1 AND state='ready' LIMIT 1",
            [wid],
          ),
        )
      ).rows[0];
      const noNestedTransactions = {
        transaction: async () => {
          throw Error("NESTED_TRANSACTION_FORBIDDEN");
        },
      };
      const resolver = new UploadService(
        noNestedTransactions,
        ws,
        store,
        {
          readQuota: async () => ({ limitBytes: limit, maxProjectPhotos: 500 }),
        },
        config,
      );
      const actual = await db.database.transaction((tx) =>
        resolver.getAssetInTx(tx, actor, wid, asset.id),
      );
      expect(actual.editorResource).toEqual(
        (await service.getAsset(actor, wid, asset.id)).editorResource,
      );
    });
  },
);
