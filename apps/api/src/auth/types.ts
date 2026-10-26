export type { Actor } from "@album/server-core";
export type VerifiedIdentity = {
  provider: "wechat" | "sms" | "email";
  appId: string;
  subject: string;
  unionId: string | null;
  openPlatformId: string | null;
};
export type IdentityAdapter = {
  exchange(
    code: string,
    redirectUri: string | null,
    context?: { actor: import("@album/server-core").Actor; purpose: string },
  ): Promise<VerifiedIdentity>;
};
