import { it, expect } from "vitest";
import { availablePaymentChannels } from "./payment-availability";
const payment: any = {
  kind: "payment",
  channel: "wechat_pay",
  enabled: true,
  additionalChannels: [{ kind: "payment", channel: "alipay", enabled: true }],
};
const release: any = {
  versions: {
    payment: { id: "published-v2", payload: payment },
    sku: { payload: { kind: "sku", enabled: true } },
  },
};
it("hides published channels without their admitted registered binding and leaves historical bindings usable", async () => {
  const registered = new Set(["historical-v1"]);
  const s: any = {
    payments: {
      get: (id: string) => {
        if (!registered.has(id)) throw Error("unconfigured");
        return { channel: id.endsWith(":alipay") ? "alipay" : "wechat_pay" };
      },
    },
    options: { admission: { admit: async () => ({ refundPolicy: {} }) } },
  };
  expect(await availablePaymentChannels(s, release, "web")).toEqual([]);
  registered.add("published-v2");
  expect(await availablePaymentChannels(s, release, "web")).toEqual([
    "wechat_pay",
  ]);
  registered.add("published-v2:alipay");
  expect(await availablePaymentChannels(s, release, "web")).toEqual([
    "wechat_pay",
    "alipay",
  ]);
  s.options.admission.admit = async () => {
    throw Error("credentials-mismatch");
  };
  expect(await availablePaymentChannels(s, release, "web")).toEqual([]);
});
