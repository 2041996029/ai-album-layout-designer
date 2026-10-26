import { createDecipheriv, randomBytes, sign, verify } from "node:crypto";
import { fail } from "@album/server-core";
import { validatePaymentEvent } from "./adapters";
import type { PaymentRequest, PaymentEvent } from "./types";
import type {
  RefundAdapter,
  OriginalRefundRequest,
  VerifiedRefundEvent,
} from "../commerce/refunds";
const merchantOrder = (value: string) =>
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value.replaceAll("-", "")
    : value;
const localOrder = (value: string) =>
  /^[0-9a-f]{32}$/i.test(value)
    ? `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
    : value;
export type WechatPayOptions = {
  appId: string;
  merchantId: string;
  privateKey: string;
  certificateSerial: string;
  platformSerial: string;
  platformPublicKey: string;
  apiV3Key: string;
  notifyUrl: string;
  refundNotifyUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
};
export class WechatPayAdapter implements RefundAdapter {
  readonly channel = "wechat_pay" as const;
  readonly mode = "approved_channel" as const;
  constructor(private options: WechatPayOptions) {
    if (
      Buffer.byteLength(options.apiV3Key) !== 32 ||
      !options.appId ||
      !options.merchantId ||
      !options.certificateSerial ||
      !options.platformSerial ||
      !options.privateKey ||
      !options.platformPublicKey ||
      ![options.notifyUrl, options.refundNotifyUrl].every((u) =>
        u.startsWith("https://"),
      )
    )
      fail("WECHAT_PAY_CONFIGURATION_REQUIRED", 503);
  }
  private now() {
    return this.options.now?.() ?? new Date();
  }
  private verify(raw: Uint8Array, headers: Record<string, string>) {
    const timestamp = headers["wechatpay-timestamp"],
      nonce = headers["wechatpay-nonce"],
      signature = headers["wechatpay-signature"];
    if (
      !timestamp ||
      !/^\d+$/.test(timestamp) ||
      Math.abs(+this.now() / 1000 - Number(timestamp)) > 300 ||
      !nonce ||
      nonce.length > 256 ||
      !signature ||
      headers["wechatpay-serial"] !== this.options.platformSerial
    )
      fail("PAYMENT_BAD_SIGNATURE", 401);
    let valid = false;
    try {
      valid = verify(
        "RSA-SHA256",
        Buffer.from(
          `${timestamp}\n${nonce}\n${Buffer.from(raw).toString("utf8")}\n`,
        ),
        this.options.platformPublicKey,
        Buffer.from(signature, "base64"),
      );
    } catch {}
    if (!valid) fail("PAYMENT_BAD_SIGNATURE", 401);
  }
  private async request(path: string, method = "GET", body?: unknown) {
    const json = body === undefined ? "" : JSON.stringify(body),
      timestamp = String(Math.floor(+this.now() / 1000)),
      nonce = randomBytes(16).toString("hex");
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${json}\n`),
      this.options.privateKey,
    ).toString("base64");
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        "https://api.mch.weixin.qq.com" + path,
        {
          method,
          headers: {
            Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${this.options.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${this.options.certificateSerial}",signature="${signature}"`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          ...(json ? { body: json } : {}),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
    } catch {
      fail("PAYMENT_PROVIDER_UNAVAILABLE", 503);
    }
    const raw = Buffer.from(await response.arrayBuffer());
    // Official 204 close acknowledgements carry no business fact; query afterwards.
    if (response.status === 204 && raw.length === 0) return null;
    this.verify(raw, Object.fromEntries(response.headers.entries()));
    let value: any;
    try {
      value = JSON.parse(raw.toString());
    } catch {
      fail("PAYMENT_PROVIDER_INVALID", 503);
    }
    if (
      method === "GET" &&
      path.startsWith("/v3/pay/transactions/out-trade-no/") &&
      response.status === 404 &&
      value.code === "ORDER_NOT_EXIST"
    )
      return null;
    if (!response.ok) fail("PAYMENT_PROVIDER_REJECTED", 502);
    return value;
  }
  private assertRequest(orderId: string, r: PaymentRequest) {
    if (
      orderId !== r.orderId ||
      r.snapshot.payment.appId !== this.options.appId ||
      r.snapshot.payment.merchantId !== this.options.merchantId
    )
      fail("PAYMENT_MISMATCH", 409);
  }
  async createPayment(orderId: string, r: PaymentRequest) {
    this.assertRequest(orderId, r);
    const v = await this.request("/v3/pay/transactions/native", "POST", {
      appid: this.options.appId,
      mchid: this.options.merchantId,
      description: r.snapshot.sku.name.slice(0, 100),
      out_trade_no: merchantOrder(orderId),
      notify_url: this.options.notifyUrl,
      amount: { total: r.snapshot.sku.priceFen, currency: "CNY" },
    });
    if (typeof v?.code_url !== "string" || !v.code_url.startsWith("weixin://"))
      fail("PAYMENT_PROVIDER_INVALID", 503);
    return { clientPayload: { kind: "qr", qrPayload: v.code_url } };
  }
  private resource(raw: Uint8Array, headers: Record<string, string>) {
    this.verify(raw, headers);
    try {
      const envelope = JSON.parse(Buffer.from(raw).toString()),
        r = envelope.resource;
      if (r.algorithm !== "AEAD_AES_256_GCM") throw Error();
      const all = Buffer.from(r.ciphertext, "base64"),
        d = createDecipheriv(
          "aes-256-gcm",
          Buffer.from(this.options.apiV3Key),
          Buffer.from(r.nonce),
        );
      d.setAuthTag(all.subarray(-16));
      d.setAAD(Buffer.from(r.associated_data ?? ""));
      return {
        value: JSON.parse(
          Buffer.concat([d.update(all.subarray(0, -16)), d.final()]).toString(),
        ),
        eventId: envelope.id,
      };
    } catch {
      fail("PAYMENT_INVALID_EVENT", 422);
    }
  }
  normalizeStatus(raw: any): PaymentEvent {
    if (
      raw.appid !== this.options.appId ||
      raw.mchid !== this.options.merchantId
    )
      fail("PAYMENT_MISMATCH", 409);
    const state =
      raw.trade_state === "SUCCESS"
        ? "paid"
        : raw.trade_state === "CLOSED"
          ? "closed"
          : raw.trade_state === "REFUND"
            ? "refunded"
            : null;
    if (!state) fail("PAYMENT_STATUS_PENDING", 409);
    return validatePaymentEvent({
      channel: this.channel,
      eventId: raw.eventId ?? `${raw.out_trade_no}:${raw.trade_state}`,
      transactionId: raw.transaction_id || `closed:${raw.out_trade_no}`,
      orderId: localOrder(raw.out_trade_no),
      appId: raw.appid,
      merchantId: raw.mchid,
      amountFen: raw.amount?.total,
      currency: raw.amount?.currency,
      state,
      fulfillable: state === "paid",
    });
  }
  async verifyEvent(raw: Uint8Array, headers: Record<string, string>) {
    const r = this.resource(raw, headers);
    return this.normalizeStatus({ ...r.value, eventId: r.eventId });
  }
  async query(orderId: string, r: PaymentRequest) {
    this.assertRequest(orderId, r);
    const v = await this.request(
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrder(orderId))}?mchid=${encodeURIComponent(this.options.merchantId)}`,
    );
    if (!v || ["NOTPAY", "USERPAYING", "ACCEPT"].includes(v.trade_state))
      return null;
    return this.normalizeStatus(v);
  }
  async close(orderId: string, r: PaymentRequest) {
    this.assertRequest(orderId, r);
    await this.request(
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrder(orderId))}/close`,
      "POST",
      { mchid: this.options.merchantId },
    );
    return this.query(orderId, r);
  }
  async refund(
    orderId: string,
    refundId: string,
    amountFen: number,
    r?: PaymentRequest,
  ) {
    if (!r) fail("REFUND_SNAPSHOT_REQUIRED", 503);
    this.assertRequest(orderId, r);
    if (
      !Number.isSafeInteger(amountFen) ||
      amountFen <= 0 ||
      amountFen > r.snapshot.sku.priceFen
    )
      fail("INVALID_AMOUNT", 422);
    const v = await this.request("/v3/refund/domestic/refunds", "POST", {
      out_trade_no: merchantOrder(orderId),
      out_refund_no: refundId,
      notify_url: this.options.refundNotifyUrl,
      amount: {
        refund: amountFen,
        total: r.snapshot.sku.priceFen,
        currency: "CNY",
      },
    });
    if (
      v.out_refund_no !== refundId ||
      localOrder(v.out_trade_no) !== orderId ||
      typeof v.refund_id !== "string"
    )
      fail("REFUND_MISMATCH", 409);
    return { providerRefundId: v.refund_id, state: "submitted" as const };
  }
  private refundEvent(v: any, eventId?: string): VerifiedRefundEvent {
    if (v.mchid !== undefined && v.mchid !== this.options.merchantId)
      fail("REFUND_MISMATCH", 409);
    const status = v.refund_status ?? v.status;
    if (!["SUCCESS", "CLOSED", "ABNORMAL"].includes(status))
      fail("REFUND_STATUS_PENDING", 409);
    return {
      ...validatePaymentEvent({
        channel: this.channel,
        eventId: eventId ?? `refund:${v.refund_id}:${status}`,
        transactionId: v.transaction_id,
        orderId: localOrder(v.out_trade_no),
        appId: this.options.appId,
        merchantId: this.options.merchantId,
        amountFen: v.amount?.refund,
        currency: v.amount?.currency ?? "CNY",
        state: "refunded",
        fulfillable: false,
      }),
      refundId: v.out_refund_no,
      providerRefundId: v.refund_id,
      refundState: status === "SUCCESS" ? "succeeded" : "failed",
    };
  }
  async verifyRefundEvent(raw: Uint8Array, headers: Record<string, string>) {
    const r = this.resource(raw, headers);
    return this.refundEvent(r.value, r.eventId);
  }
  async queryOriginalRefund(r: OriginalRefundRequest) {
    this.assertRequest(r.orderId, r);
    const v = await this.request(
      `/v3/refund/domestic/refunds/${encodeURIComponent(r.refundId)}`,
    );
    if (v.status === "PROCESSING") return null;
    return this.refundEvent(v);
  }
}
