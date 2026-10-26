import { fail } from "@album/server-core";
import type { IdentityAdapter, VerifiedIdentity } from "./types";
export class WechatMiniAdapter implements IdentityAdapter {
  constructor(
    private options: {
      appId: string;
      appSecret: string;
      openPlatformId?: string;
      fetch?: typeof fetch;
    },
  ) {
    if (!options.appId || !options.appSecret)
      fail("WECHAT_CONFIGURATION_REQUIRED", 503);
  }
  async exchange(
    code: string,
    _redirect: string | null,
  ): Promise<VerifiedIdentity> {
    if (!code || code.length > 1024) fail("INVALID_LOGIN_CODE", 422);
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    for (const [k, v] of Object.entries({
      appid: this.options.appId,
      secret: this.options.appSecret,
      js_code: code,
      grant_type: "authorization_code",
    }))
      url.searchParams.set(k, v);
    let value: any;
    try {
      const r = await (this.options.fetch ?? fetch)(url, {
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!r.ok) throw Error();
      value = await r.json();
    } catch {
      fail("WECHAT_LOGIN_UNAVAILABLE", 503);
    }
    if (value.errcode || typeof value.openid !== "string" || !value.openid)
      fail("WECHAT_LOGIN_FAILED", 401);
    return {
      provider: "wechat",
      appId: this.options.appId,
      subject: value.openid,
      unionId: typeof value.unionid === "string" ? value.unionid : null,
      openPlatformId: this.options.openPlatformId ?? null,
    };
  }
}
