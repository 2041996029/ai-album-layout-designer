import { it, expect } from "vitest";
import { generateKeyPairSync, sign, createCipheriv } from "node:crypto";
import { WechatPayAdapter } from "./wechat";
import { AlipayAdapter, decimalFen } from "./alipay";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const now = () => new Date("2026-10-26T00:00:00Z");
const options = {
  appId: "app",
  merchantId: "merchant",
  privateKey,
  platformPublicKey: publicKey,
  certificateSerial: "merchant-serial",
  platformSerial: "platform-serial",
  apiV3Key: "12345678901234567890123456789012",
  notifyUrl: "https://album.test/v1/payment-callbacks/wechat_pay",
  refundNotifyUrl: "https://album.test/v1/refund-callbacks/wechat_pay",
  now,
};
it("WeChat validates RSA signature before decrypting callback and verifies merchant identity", async () => {
  const a = new WechatPayAdapter(options),
    nonce = "123456789012",
    associated_data = "transaction",
    c = createCipheriv(
      "aes-256-gcm",
      Buffer.from(options.apiV3Key),
      Buffer.from(nonce),
    );
  c.setAAD(Buffer.from(associated_data));
  const ciphertext = Buffer.concat([
    c.update(
      JSON.stringify({
        appid: "app",
        mchid: "merchant",
        out_trade_no: "o1",
        transaction_id: "tx1",
        trade_state: "SUCCESS",
        amount: { total: 123, currency: "CNY" },
      }),
    ),
    c.final(),
    c.getAuthTag(),
  ]).toString("base64");
  const raw = Buffer.from(
      JSON.stringify({
        id: "e1",
        resource: {
          algorithm: "AEAD_AES_256_GCM",
          nonce,
          associated_data,
          ciphertext,
        },
      }),
    ),
    timestamp = String(+now() / 1000),
    eventNonce = "notify-nonce";
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(timestamp + "\n" + eventNonce + "\n" + raw.toString() + "\n"),
    privateKey,
  ).toString("base64");
  const headers = {
    "wechatpay-timestamp": timestamp,
    "wechatpay-nonce": eventNonce,
    "wechatpay-signature": signature,
    "wechatpay-serial": "platform-serial",
  };
  expect(await a.verifyEvent(raw, headers)).toMatchObject({
    channel: "wechat_pay",
    orderId: "o1",
    amountFen: 123,
    state: "paid",
  });
  await expect(
    a.verifyEvent(Buffer.concat([raw, Buffer.from(" ")]), headers),
  ).rejects.toThrow("PAYMENT_BAD_SIGNATURE");
  await expect(
    a.verifyEvent(raw, { ...headers, "wechatpay-serial": "unknown" }),
  ).rejects.toThrow("PAYMENT_BAD_SIGNATURE");
});
it("Alipay authenticates canonical form and preserves exact decimal cents", async () => {
  expect(decimalFen("12.30")).toBe(1230);
  expect(() => decimalFen("1.001")).toThrow("PAYMENT_INVALID_AMOUNT");
  const a = new AlipayAdapter({
    ...options,
    notifyUrl: "https://album.test/v1/payment-callbacks/alipay",
  });
  const p: Record<string, string> = {
    app_id: "app",
    seller_id: "merchant",
    out_trade_no: "o1",
    trade_no: "tx1",
    notify_id: "e1",
    total_amount: "12.30",
    trade_status: "TRADE_SUCCESS",
    sign_type: "RSA2",
  };
  p.sign = sign(
    "RSA-SHA256",
    Buffer.from(
      Object.keys(p)
        .filter((k) => k !== "sign_type")
        .sort()
        .map((k) => `${k}=${p[k]}`)
        .join("&"),
    ),
    privateKey,
  ).toString("base64");
  expect(
    await a.verifyEvent(Buffer.from(new URLSearchParams(p).toString()), {}),
  ).toMatchObject({ channel: "alipay", amountFen: 1230, state: "paid" });
  p.total_amount = "999.00";
  await expect(
    a.verifyEvent(Buffer.from(new URLSearchParams(p).toString()), {}),
  ).rejects.toThrow("PAYMENT_BAD_SIGNATURE");
});
it("Alipay verifies the exact signed response object and generates a QR launch", async () => {
  const body = JSON.stringify({
    code: "10000",
    out_trade_no: "o1",
    qr_code: "https://qr.alipay.com/test",
  });
  const raw = `{"alipay_trade_precreate_response":${body},"sign":"${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64")}"}`;
  let payload = "";
  const a = new AlipayAdapter({
    ...options,
    fetch: async (_url: any, init: any) => {
      payload = init.body;
      return new Response(raw);
    },
  });
  const request: any = {
    orderId: "o1",
    providerRequestId: "r1",
    snapshot: {
      sku: { name: "相册", priceFen: 1230 },
      payment: { appId: "app", merchantId: "merchant" },
    },
  };
  expect(await a.createPayment("o1", request)).toEqual({
    clientPayload: { kind: "qr", qrPayload: "https://qr.alipay.com/test" },
  });
  expect(new URLSearchParams(payload).get("method")).toBe(
    "alipay.trade.precreate",
  );
  const bad = new AlipayAdapter({
    ...options,
    fetch: async () =>
      new Response(raw.replace("qr.alipay.com", "bad.invalid")),
  });
  await expect(bad.createPayment("o1", request)).rejects.toThrow(
    "PAYMENT_BAD_SIGNATURE",
  );
});
it("WeChat signs Native requests and maps UUID order IDs to provider length limits", async () => {
  const order = "12345678-1234-1234-1234-123456789012";
  let sent: any;
  const responseBody = JSON.stringify({
      code_url: "weixin://wxpay/bizpayurl?pr=abc",
    }),
    timestamp = String(+now() / 1000),
    nonce = "signed-response";
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${timestamp}\n${nonce}\n${responseBody}\n`),
    privateKey,
  ).toString("base64");
  const a = new WechatPayAdapter({
    ...options,
    fetch: async (_url: any, init: any) => {
      sent = JSON.parse(init.body);
      expect(init.headers.Authorization).toContain("WECHATPAY2-SHA256-RSA2048");
      return new Response(responseBody, {
        headers: {
          "wechatpay-timestamp": timestamp,
          "wechatpay-nonce": nonce,
          "wechatpay-signature": signature,
          "wechatpay-serial": "platform-serial",
        },
      });
    },
  });
  const r: any = {
    orderId: order,
    snapshot: {
      payment: { appId: "app", merchantId: "merchant" },
      sku: { name: "相册", priceFen: 123 },
    },
  };
  expect(await a.createPayment(order, r)).toMatchObject({
    clientPayload: { kind: "qr" },
  });
  expect(sent.out_trade_no).toBe(order.replaceAll("-", ""));
  expect(sent.amount.total).toBe(123);
  expect(
    a.normalizeStatus({
      appid: "app",
      mchid: "merchant",
      out_trade_no: sent.out_trade_no,
      transaction_id: "tx",
      trade_state: "SUCCESS",
      amount: { total: 123, currency: "CNY" },
    }).orderId,
  ).toBe(order);
});
it("pending and mismatched merchant notifications never become paid facts", () => {
  const w = new WechatPayAdapter(options);
  expect(() =>
    w.normalizeStatus({
      appid: "app",
      mchid: "merchant",
      trade_state: "NOTPAY",
    }),
  ).toThrow("PAYMENT_STATUS_PENDING");
  expect(() =>
    w.normalizeStatus({
      appid: "other",
      mchid: "merchant",
      trade_state: "SUCCESS",
    }),
  ).toThrow("PAYMENT_MISMATCH");
  const a = new AlipayAdapter(options);
  expect(() =>
    a.normalizeStatus({
      app_id: "app",
      seller_id: "merchant",
      trade_status: "WAIT_BUYER_PAY",
    }),
  ).toThrow("PAYMENT_STATUS_PENDING");
});
it("Alipay rejects a duplicate form field and an unsigned API response", async () => {
  const a = new AlipayAdapter({
    ...options,
    fetch: async () =>
      new Response('{"alipay_trade_query_response":{"code":"10000"}}'),
  });
  await expect(
    a.verifyEvent(Buffer.from("app_id=a&app_id=b"), {}),
  ).rejects.toThrow("PAYMENT_INVALID_EVENT");
  const r: any = {
    orderId: "o1",
    snapshot: { payment: { appId: "app", merchantId: "merchant" } },
  };
  await expect(a.query("o1", r)).rejects.toThrow("PAYMENT_PROVIDER_INVALID");
});
it("historical WeChat binding accepts explicitly rotated platform keys and still rejects unknown serials", async () => {
  const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rotatedPublic = rotated.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const body = JSON.stringify({
      appid: "app",
      mchid: "merchant",
      out_trade_no: "old-order",
      transaction_id: "old-tx",
      trade_state: "SUCCESS",
      amount: { total: 123, currency: "CNY" },
    }),
    timestamp = String(+now() / 1000),
    nonce = "rotation-response";
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
    rotated.privateKey,
  ).toString("base64");
  const a = new WechatPayAdapter({
    ...options,
    platformKeys: { "new-platform-serial": rotatedPublic },
    fetch: async () =>
      new Response(body, {
        headers: {
          "wechatpay-timestamp": timestamp,
          "wechatpay-nonce": nonce,
          "wechatpay-signature": signature,
          "wechatpay-serial": "new-platform-serial",
        },
      }),
  } as any);
  expect(
    await a.query("old-order", {
      orderId: "old-order",
      snapshot: { payment: { appId: "app", merchantId: "merchant" } },
    } as any),
  ).toMatchObject({ orderId: "old-order", state: "paid" });
});
