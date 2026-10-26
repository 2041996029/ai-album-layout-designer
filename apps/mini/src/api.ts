import type { components } from "../../../packages/contracts/src/api";
export type Schema<K extends keyof components["schemas"]> =
  components["schemas"][K];
export interface Request {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}
export type Transport = (
  request: Request,
) => Promise<{ status: number; body: unknown }>;
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export interface MiniApiOptions {
  baseUrl: string;
  workspaceId: string;
  transport: Transport;
  key: () => string;
  loginCode: () => Promise<string>;
}
export class MiniApi {
  private session: { accessToken: string; refreshToken: string } | null = null;
  private authenticating: Promise<void> | null = null;
  constructor(readonly options: MiniApiOptions) {}
  get workspaceId() {
    return this.options.workspaceId;
  }
  key() {
    return this.options.key();
  }
  private async decode<T>(request: Request): Promise<T> {
    const result = await this.options.transport(request);
    const body = result.body as {
      data?: T;
      error?: { code: string; message: string; retryable: boolean };
    };
    if (result.status < 200 || result.status >= 300) {
      throw new ApiError(
        result.status,
        body?.error?.code ?? "HTTP_ERROR",
        body?.error?.message ?? "请求失败",
        body?.error?.retryable ?? false,
      );
    }
    if (!body || !Object.prototype.hasOwnProperty.call(body, "data"))
      throw new ApiError(502, "INVALID_RESPONSE", "服务返回格式不正确");
    return body.data as T;
  }
  private authenticate(refresh: boolean): Promise<void> {
    if (this.authenticating) return this.authenticating;
    this.authenticating = (async () => {
      try {
        this.session = await this.decode<Schema<"MiniSession">>({
          method: "POST",
          path: refresh ? "/auth/token/refresh" : "/auth/wechat/mini",
          headers: { "Idempotency-Key": this.key() },
          body: refresh
            ? {
                refreshToken: this.session?.refreshToken,
                client: { platform: "mini", appVersion: "0.1.0" },
              }
            : {
                code: await this.options.loginCode(),
                client: { platform: "mini", appVersion: "0.1.0" },
              },
        });
      } catch (error) {
        this.session = null;
        throw error;
      } finally {
        this.authenticating = null;
      }
    })();
    return this.authenticating;
  }
  async emailLinkChallenge(email: string): Promise<Schema<"EmailChallenge">> {
    return this.decode({
      method: "POST",
      path: "/auth/wechat/mini/email-challenges",
      headers: { "Idempotency-Key": this.key() },
      body: { email },
    });
  }
  async currentEmailChallenge(
    email: string,
  ): Promise<Schema<"EmailChallenge">> {
    return this.request("POST", "/auth/email/challenges", {
      email,
      purpose: "bind",
    });
  }
  async bindCurrentEmail(
    challengeId: string,
    verificationCode: string,
  ): Promise<void> {
    const purpose = "bind";
    const fresh = await this.post<Schema<"ReauthenticationResult">>(
      "/auth/reauthenticate",
      {
        purpose,
        proof: {
          provider: "wechat_mini",
          challengeId: this.key(),
          proof: await this.options.loginCode(),
          purpose,
        },
      },
    );
    await this.post("/auth/bindings", {
      reauthProof: fresh.reauthProof,
      proof: {
        provider: "email",
        challengeId,
        proof: JSON.stringify({ challengeId, code: verificationCode }),
        purpose,
      },
    });
  }
  async linkEmail(
    challengeId: string,
    verificationCode: string,
  ): Promise<void> {
    const session = await this.decode<Schema<"MiniSession">>({
      method: "POST",
      path: "/auth/wechat/mini/link-email",
      headers: { "Idempotency-Key": this.key() },
      body: {
        challengeId,
        verificationCode,
        wechatCode: await this.options.loginCode(),
      },
    });
    this.session = session;
  }
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    if (!this.session) await this.authenticate(false);
    const token = this.session!.accessToken;
    const call = () =>
      this.decode<T>({
        method,
        path,
        body,
        headers: {
          ...headers,
          Authorization: `Bearer ${this.session!.accessToken}`,
        },
      });
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (this.session?.accessToken === token) await this.authenticate(true);
      try {
        return await call();
      } catch (retryError) {
        if (retryError instanceof ApiError && retryError.status === 401)
          this.session = null;
        throw retryError;
      }
    }
  }
  get<T>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body: unknown, key = this.key()) {
    return this.request<T>("POST", path, body, { "Idempotency-Key": key });
  }
}
