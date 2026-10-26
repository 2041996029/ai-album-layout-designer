import { getMiniRuntime, type MiniRuntime } from "./runtime";
/** Linking starts before automatic mini login so an unused WeChat identity can join a Web account. */
export function createAccountPage(
  resolve: () => Promise<MiniRuntime> = getMiniRuntime,
) {
  let runtime: MiniRuntime,
    challengeId = "",
    retryAt = 0;
  return {
    data: {
      currentAccount: false,
      email: "",
      code: "",
      busy: false,
      sent: false,
      message: "",
    },
    setData(value: object) {
      Object.assign(this.data, value);
    },
    async onLoad() {
      try {
        runtime = await resolve();
      } catch {
        this.setData({ message: "小程序服务未配置，请联系管理员。" });
      }
    },
    changeMode(e: { detail: { value: boolean } }) {
      challengeId = "";
      this.setData({
        currentAccount: e.detail.value,
        sent: false,
        code: "",
        message: "",
      });
    },
    changeEmail(e: { detail: { value: string } }) {
      challengeId = "";
      this.setData({ email: e.detail.value, sent: false, code: "" });
    },
    changeCode(e: { detail: { value: string } }) {
      this.setData({ code: e.detail.value.replace(/\D/g, "").slice(0, 6) });
    },
    async send() {
      if (this.data.busy || !runtime) return;
      if (Date.now() < retryAt) {
        this.setData({ message: "请等待一分钟后重发。" });
        return;
      }
      this.setData({ busy: true, message: "" });
      try {
        const q = await (this.data.currentAccount
          ? runtime.api.currentEmailChallenge(this.data.email)
          : runtime.api.emailLinkChallenge(this.data.email));
        challengeId = q.id;
        retryAt = Date.now() + q.retryAfterSeconds * 1000;
        this.setData({
          sent: true,
          message: `验证码已发送至 ${q.destinationHint}，五分钟内有效。`,
        });
      } catch {
        this.setData({ message: "发送失败，请检查邮箱或稍后重试。" });
      } finally {
        this.setData({ busy: false });
      }
    },
    async bind() {
      if (
        this.data.busy ||
        !runtime ||
        !challengeId ||
        this.data.code.length !== 6
      )
        return;
      this.setData({ busy: true, message: "" });
      try {
        await (this.data.currentAccount
          ? runtime.api.bindCurrentEmail(challengeId, this.data.code)
          : runtime.api.linkEmail(challengeId, this.data.code));
        this.setData({
          message: "已绑定同一账号，可进入相册。",
          sent: false,
          code: "",
        });
        challengeId = "";
      } catch {
        this.setData({
          message:
            "绑定未成功：验证码可能已过期，或微信已属于另一账号。已有账号不会自动合并，请联系管理员。",
        });
      } finally {
        this.setData({ busy: false });
      }
    },
  };
}
