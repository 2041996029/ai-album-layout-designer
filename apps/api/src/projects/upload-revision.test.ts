import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
import { testDatabase } from "../../test/database";
import { storageFixture } from "../../test/asset-fixtures";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { UploadService } from "../assets/upload";
import { LocalObjectStore } from "../assets/object-store";
import { FolderService } from "../folders/service";
import { RevisionService } from "./revisions";
import { digest, id } from "@album/server-core";
import type { DocumentModel } from "@album/document";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "uploaded content identity is independent of folder metadata CAS",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>, root: string;
    beforeAll(async () => {
      db = await testDatabase();
      root = await mkdtemp(tmpdir() + "/c3-upload-revisions-");
    }, 60000);
    afterAll(async () => {
      await db?.close();
      if (root) await rm(root, { recursive: true, force: true });
    });
    it.each([0, 1, 6])(
      "saves uploaded PNG or JPEG orientation %s with immutable identity after metadata changes",
      async (orientation) => {
        const auth = new AuthService(db.database, {
            secret: "x".repeat(40),
            environment: "dev",
          }),
          actor = (
            await auth.login(
              {
                exchange: async () => ({
                  provider: "wechat",
                  appId: "revision-upload",
                  subject: "owner",
                  unionId: null,
                  openPlatformId: null,
                }),
              },
              id(),
              "web",
            )
          ).actor;
        const workspaces = new WorkspaceService(db.database, auth),
          wid = (await workspaces.createWorkspace(actor, "personal", id()))
            .workspaceId,
          config = await storageFixture(db.database),
          objects = new LocalObjectStore({
            root,
            secret: "x".repeat(40),
            environment: "dev",
            baseUrl: "http://localhost",
          });
        const uploads = new UploadService(
            db.database,
            workspaces,
            objects,
            {
              readQuota: async () => ({
                limitBytes: 1000000,
                maxProjectPhotos: 500,
              }),
            },
            config,
          ),
          folders = new FolderService(db.database, workspaces),
          revisions = new RevisionService(
            db.database,
            workspaces,
            objects,
            config,
          );
        const bytes = await sharp({
            create: { width: 8, height: 4, channels: 4, background: "#f00" },
          })
            .withMetadata({ orientation: orientation || 1 })
            .toFormat(orientation ? "jpeg" : "png")
            .toBuffer(),
          hash = digest(bytes);
        const pending = await uploads.beginUpload(
          actor,
          wid,
          {
            bytes: bytes.length,
            sha256: hash,
            mime: orientation ? "image/jpeg" : "image/png",
            folderId: null,
            projectId: null,
            filename: "photo.png",
          },
          id(),
        );
        const key = await db.database.transaction(
          async (tx) =>
            (
              await tx.query(
                "SELECT object_key FROM upload_sessions WHERE id=$1",
                [pending.uploadId],
              )
            ).rows[0].object_key,
        );
        await objects.put(
          {
            storageProfileId: config.storageProfileId,
            profileVersion: 1,
            bucket: config.bucket,
            key,
            objectVersionId: null,
            sha256: hash,
            variant: "original",
          },
          bytes,
        );
        const asset = await uploads.completeUpload(
          actor,
          wid,
          pending.uploadId,
          id(),
        );
        expect(asset.version).toBe(1);
        expect((await uploads.getAsset(actor, wid, asset.id)).revision).toBe(2);
        const doc = structuredClone(fixture) as DocumentModel;
        doc.projectId = id();
        await revisions.createInitialProject(
          actor,
          wid,
          doc,
          { assets: [asset], fonts: [] },
          id(),
          "Uploaded album",
        );
        const folder = await folders.createFolder(
          actor,
          wid,
          null,
          `Photos ${orientation}`,
          id(),
        );
        await folders.batchMoveAssets(actor, wid, [asset.id], folder.id, id());
        await folders.updateFolder(actor, wid, folder.id, 1, {
          name: `Renamed photos ${orientation}`,
        });
        expect((await uploads.getAsset(actor, wid, asset.id)).revision).toBe(3);
        expect(
          (
            await revisions.saveCloudRevision(
              actor,
              wid,
              doc,
              1,
              { assets: [asset], fonts: [] },
              id(),
            )
          ).doc.revision,
        ).toBe(2);
        await expect(
          revisions.saveCloudRevision(
            actor,
            wid,
            doc,
            2,
            { assets: [{ ...asset, version: 2 }], fonts: [] },
            id(),
          ),
        ).rejects.toThrow("RESOURCE_VERSION_MISMATCH");
      },
    );
  },
);
