import type { Database } from "@album/server-core";
import type { AuthService } from "../auth/identity";
import type { WorkspaceService } from "../workspaces/service";
import type { IdentityAdapter } from "../auth/types";
import type { UploadService } from "../assets/upload";
import type { FolderService } from "../folders/service";
import type { RevisionService } from "../projects/revisions";
import type { SharingService } from "../sharing/service";
import type { NotificationsService } from "../notifications/service";
import type { AccountDeletionService } from "../auth/account-deletion";
import type { PrivacyExportService } from "../auth/privacy-export";
import type { LocalObjectStore } from "../assets/object-store";
import type { BindingService } from "../auth/bindings";
export interface ApiRuntime {
  ai?: {
    cleanupStaged?: () => Promise<void>;
    service: import("../ai/quotes").GenerationService;
    output: import("../ai/output").GenerationOutputService;
    worker: import("../../../ai-worker/src/generate-job").GenerationWorker;
  };
  cloudLayout?: import("../projects/layout-service").CloudLayoutService;
  commerce?: import("../commerce/runtime").CommerceRuntime;
  operationHandlers?: Record<
    string,
    (request: any, reply: any) => Promise<unknown>
  >;
  db: Database;
  auth: AuthService;
  workspaces: WorkspaceService;
  environment: "dev" | "staging" | "prod";
  allowedOrigin: string;
  wechatMini?: IdentityAdapter;
  email?: import("../auth/email").EmailIdentityService;
  qrPayload?: (id: string, token: string) => Promise<string>;
  bindings?: BindingService;
  uploads?: UploadService;
  folders?: FolderService;
  revisions?: RevisionService;
  sharing?: SharingService;
  notifications?: NotificationsService;
  deletion?: AccountDeletionService;
  privacy?: PrivacyExportService;
  localObjects?: LocalObjectStore;
  objects?: import("../assets/types").ObjectStore;
  storage?: import("../assets/types").StorageConfig;
  provisionFonts?: (workspaceId: string) => Promise<void>;
  proofAdapter?: {
    verify(
      actor: import("@album/server-core").Actor,
      proof: unknown,
      purpose: string,
    ): Promise<{ reauthProof: string; purpose: string; expiresAt: string }>;
  };
}
