import { deploymentAi } from "./ai/deployment";
import { bindAiRuntime } from "./ai/runtime";
import { CosObjectStore } from "./assets/cos";
import { provisionCosStorage } from "./assets/cos-config";
import { RoutingObjectStore } from "./assets/routing-store";
import { deploymentPayments } from "./payments/deployment";
import { EmailIdentityService } from "./auth/email";
import { smtpSender } from "./auth/smtp";
import { emailHumanAdapter } from "./auth/email-human";
import { WechatMiniAdapter } from "./auth/wechat";
import { BrowserPreflight } from "../../export-worker/src/preflight";
import { bindCommerceRuntime, type CommerceOptions } from "./commerce/runtime";
import { startCommerceHost } from "./commerce/host";
import { RedisRedemptionRateLimiter } from "./commerce/redemption";
import Redis from "ioredis";
import { createDatabase, fail } from "@album/server-core";
import { AuthService } from "./auth/identity";
import { BindingService } from "./auth/bindings";
import { ReauthService } from "./auth/reauthentication";
import { WorkspaceService } from "./workspaces/service";
import { UploadService } from "./assets/upload";
import { LocalObjectStore } from "./assets/object-store";
import { provisionDevelopmentStorage } from "./assets/development";
import { provisionBundledFonts } from "./assets/bundled-fonts";
import { FolderService } from "./folders/service";
import { RevisionService } from "./projects/revisions";
import { SharingService } from "./sharing/service";
import { NotificationsService } from "./notifications/service";
import { AccountDeletionService } from "./auth/account-deletion";
import { PrivacyExportService } from "./auth/privacy-export";
import type { ApiRuntime } from "./http/runtime";
/** Deployment-owned configuration only; no request can select an environment or storage provider. */
export async function createRuntime(
  env: NodeJS.ProcessEnv = process.env,
  commerceOptions: CommerceOptions = {},
) {
  const deployedPayments = await deploymentPayments(env);
  commerceOptions = {
    ...deployedPayments,
    ...commerceOptions,
    paymentBindings: [
      ...(deployedPayments.paymentBindings ?? []),
      ...(commerceOptions.paymentBindings ?? []),
    ],
    config: {
      ...deployedPayments.config,
      ...commerceOptions.config,
      readiness: {
        ...deployedPayments.config?.readiness,
        ...commerceOptions.config?.readiness,
      },
    },
  };
  const environment = env.C3_ENV ?? "dev";
  if (!["dev", "staging", "prod"].includes(environment))
    fail("INVALID_ENVIRONMENT", 503);
  if (!env.C3_DATABASE_URL || !env.C3_AUTH_SECRET || !env.C3_ALLOWED_ORIGIN)
    fail("SERVER_CONFIGURATION_REQUIRED", 503);
  const origin = new URL(env.C3_ALLOWED_ORIGIN);
  if (environment !== "dev" && origin.protocol !== "https:")
    fail("HTTPS_REQUIRED", 503);
  const database = createDatabase({
    connectionString: env.C3_DATABASE_URL,
    max: 10,
  });
  const auth = new AuthService(database.database, {
      secret: env.C3_AUTH_SECRET,
      environment: environment as "dev" | "staging" | "prod",
    }),
    workspaces = new WorkspaceService(database.database, auth);
  const runtime: ApiRuntime = {
    db: database.database,
    auth,
    workspaces,
    environment: environment as "dev" | "staging" | "prod",
    allowedOrigin: origin.origin,
  };
  if (env.EMAIL_SMTP_HOST) {
    if (!env.EMAIL_ENCRYPTION_SECRET) fail("EMAIL_SECRET_REQUIRED", 503);
    runtime.email = new EmailIdentityService(runtime.db, auth, {
      secret: env.EMAIL_ENCRYPTION_SECRET,
      sender: smtpSender({
        host: env.EMAIL_SMTP_HOST,
        port: Number(env.EMAIL_SMTP_PORT ?? 465),
        secure: env.EMAIL_SMTP_SECURE !== "false",
        user: env.EMAIL_SMTP_USER ?? "",
        password: env.EMAIL_SMTP_PASSWORD ?? "",
        from: env.EMAIL_FROM ?? "",
      }),
    });
    commerceOptions = {
      ...commerceOptions,
      reauthentication: {
        ...commerceOptions.reauthentication,
        identities: {
          ...commerceOptions.reauthentication?.identities,
          email: runtime.email.adapter("bind"),
        },
        human:
          commerceOptions.reauthentication?.human ??
          emailHumanAdapter(runtime.email),
      },
    };
  }
  if (env.WECHAT_MINI_APP_ID) {
    runtime.wechatMini = new WechatMiniAdapter({
      appId: env.WECHAT_MINI_APP_ID,
      appSecret: env.WECHAT_MINI_APP_SECRET ?? "",
      openPlatformId: env.WECHAT_OPEN_PLATFORM_ID,
    });
    commerceOptions = {
      ...commerceOptions,
      reauthentication: {
        ...commerceOptions.reauthentication,
        identities: {
          ...commerceOptions.reauthentication?.identities,
          wechat_mini: runtime.wechatMini,
        },
      },
    };
  }
  runtime.sharing = new SharingService(runtime.db, workspaces);
  runtime.notifications = new NotificationsService(runtime.db, workspaces);
  const reauth = new ReauthService(
    runtime.db,
    auth,
    commerceOptions.reauthentication?.identities ?? {},
    commerceOptions.reauthentication?.human,
  );
  runtime.proofAdapter = reauth;
  runtime.bindings = new BindingService(
    runtime.db,
    auth,
    reauth,
    commerceOptions.reauthentication?.identities ?? {},
  );
  runtime.deletion = new AccountDeletionService(
    runtime.db,
    auth,
    reauth.freshProofVerifier,
    { assertActor: (tx, actor) => auth.assertRecoveryActor(tx, actor) },
  );
  runtime.privacy = new PrivacyExportService(
    runtime.db,
    auth,
    reauth.freshProofVerifier,
  );
  if (env.C3_LOCAL_STORAGE_ROOT || env.COS_BUCKET) {
    const limit = Number(
      env.C3_DEV_STORAGE_LIMIT_BYTES ?? env.ALBUM_STORAGE_LIMIT_BYTES,
    );
    if (!Number.isSafeInteger(limit) || limit < 1)
      fail("STORAGE_LIMIT_REQUIRED", 503);
    let local: LocalObjectStore | undefined;
    if (env.C3_LOCAL_STORAGE_ROOT) {
      if (environment !== "dev" || !env.C3_LOCAL_OBJECT_SECRET)
        fail("DEV_LOCAL_STORAGE_CONFIGURATION_REQUIRED", 503);
      local = new LocalObjectStore({
        root: env.C3_LOCAL_STORAGE_ROOT,
        secret: env.C3_LOCAL_OBJECT_SECRET,
        environment,
        baseUrl: env.C3_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3001",
      });
    }
    const config = env.COS_BUCKET
      ? await provisionCosStorage(runtime.db, environment, {
          bucket: env.COS_BUCKET,
          region: env.COS_REGION ?? "",
          basePrefix: env.COS_BASE_PREFIX ?? "album",
        })
      : await provisionDevelopmentStorage(runtime.db, environment);
    const objects = new RoutingObjectStore();
    const profiles = await runtime.db.transaction(
      async (tx) =>
        (
          await tx.query(
            "SELECT * FROM storage_profile_versions WHERE environment=$1",
            [environment],
          )
        ).rows,
    );
    for (const profile of profiles) {
      if (profile.provider === "local" && local)
        objects.register(profile.profile_id, profile.version, local);
      if (profile.provider === "cos")
        objects.register(
          profile.profile_id,
          profile.version,
          new CosObjectStore({
            bucket: profile.bucket,
            region: profile.region,
            secretId: env.COS_SECRET_ID ?? "",
            secretKey: env.COS_SECRET_KEY ?? "",
          }),
        );
    }
    runtime.objects = objects;
    runtime.storage = config;
    if (
      env.C4_EXPORT_TOKEN_SECRET &&
      env.C4_RENDERER_VERSION &&
      env.C4_RENDERER_IMAGE_DIGEST &&
      !commerceOptions.exports
    )
      commerceOptions = {
        ...commerceOptions,
        exports: {
          objects,
          storage: config,
          preflight: new BrowserPreflight({
            objects,
            chromiumPath: env.CHROMIUM_PATH,
          }),
          renderer: {
            version: env.C4_RENDERER_VERSION,
            imageDigest: env.C4_RENDERER_IMAGE_DIGEST,
          },
          tokenSecret: env.C4_EXPORT_TOKEN_SECRET,
        },
      };
    runtime.localObjects = local;
    runtime.uploads = new UploadService(
      runtime.db,
      workspaces,
      objects,
      { readQuota: async () => ({ limitBytes: limit, maxProjectPhotos: 500 }) },
      config,
    );
    runtime.folders = new FolderService(runtime.db, workspaces);
    runtime.revisions = new RevisionService(
      runtime.db,
      workspaces,
      objects,
      config,
      undefined,
      async (tx, actor, wid, assetId) => {
        const asset = await runtime.uploads!.getAssetInTx(
          tx,
          actor,
          wid,
          assetId,
        );
        if (!asset.editorResource) fail("RESOURCE_UNAVAILABLE", 422);
        return asset.editorResource;
      },
    );
    runtime.provisionFonts = async (wid) => {
      await provisionBundledFonts(runtime.db, objects, config, wid);
    };
  }
  const redis = env.C4_REDIS_URL
    ? new Redis(env.C4_REDIS_URL, { maxRetriesPerRequest: 1 })
    : undefined;
  if (redis && env.C4_REDEMPTION_PEPPER)
    commerceOptions = {
      ...commerceOptions,
      redemption: {
        pepper: env.C4_REDEMPTION_PEPPER,
        rateLimiter: new RedisRedemptionRateLimiter(
          redis,
          env.C4_REDEMPTION_PEPPER,
        ),
      },
    };
  await bindCommerceRuntime(runtime, reauth, commerceOptions);
  const aiOptions = deploymentAi(runtime, env, commerceOptions.secrets);
  if (aiOptions) bindAiRuntime(runtime, aiOptions);
  const host = startCommerceHost(runtime, env.C4_REDIS_URL);
  return {
    runtime,
    close: async () => {
      await host.close();
      await redis?.quit();
      await database.close();
    },
  };
}
