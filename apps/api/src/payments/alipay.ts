import { sign, verify } from "node:crypto";
import { fail } from "@album/server-core";
import { validatePaymentEvent } from "./adapters";
import type { PaymentRequest, PaymentEvent } from "./types";
import type {
  RefundAdapter,
  OriginalRefundRequest,
  VerifiedRefundEvent,
} from "../commerce/refunds";
export function decimalFen(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value))
    fail("PAYMENT_INVALID_AMOUNT", 422);
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 1e12)
    fail("PAYMENT_INVALID_AMOUNT", 422);
  return result;
}
const amount = (fen: number) => {
  if (!Number.isSafeInteger(fen) || fen < 0 || fen > 1e12)
    fail("INVALID_AMOUNT", 422);
  return `${Math.floor(fen / 100)}.${String(fen % 100).padStart(2, "0")}`;
};
const canonical = (v: Record<string, string>, callback = false) =>
  Object.keys(v)
    .filter(
      (k) => k !== "sign" && (!callback || k !== "sign_type") && v[k] !== "",
    )
    .sort()
    .map((k) => `${k}=${v[k]}`)
    .join("&");
/** Extract exact top-level JSON value slices; duplicate keys cannot override verified bytes. */
function fields(raw: string) {
  const map = new Map<string, string>();
  let i = 0;
  const space = () => {
    while (/\s/.test(raw[i] ?? "") && i < raw.length) i++;
  };
  const stringEnd = () => {
    i++;
    while (i < raw.length) {
      if (raw[i] === "\\") {
        i += 2;
        continue;
      }
      if (raw[i++] === '"') return;
    }
    throw Error();
  };
  space();
  if (raw[i++] !== "{") throw Error();
  while (i < raw.length) {
    space();
    if (raw[i] === "}") {
      i++;
      break;
    }
    const k = i;
    if (raw[i] !== '"') throw Error();
    stringEnd();
    const key = JSON.parse(raw.slice(k, i));
    space();
    if (raw[i++] !== ":") throw Error();
    space();
    const start = i;
    let depth = 0;
    while (i < raw.length) {
      if (raw[i] === '"') {
        stringEnd();
        continue;
      }
      if (raw[i] === "{" || raw[i] === "[") depth++;
      if (raw[i] === "}" || raw[i] === "]") {
        if (depth === 0) break;
        depth--;
      }
      if (depth === 0 && raw[i] === ",") break;
      i++;
    }
    if (map.has(key)) throw Error();
    map.set(key, raw.slice(start, i).trim());
    space();
    if (raw[i] === ",") {
      i++;
      continue;
    }
    if (raw[i] === "}") {
      i++;
      break;
    }
    throw Error();
  }
  space();
  if (i !== raw.length) throw Error();
  return map;
}
export type AlipayOptions = {
  appId: string;
  merchantId: string;
  privateKey: string;
  platformPublicKey: string;
  notifyUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
  sandbox?: boolean;
};
export class AlipayAdapter implements RefundAdapter {
  readonly channel = "alipay" as const;
  readonly mode = "approved_channel" as const;
  constructor(private options: AlipayOptions) {
    if (
      !options.appId ||
      !options.merchantId ||
      !options.privateKey ||
      !options.platformPublicKey ||
      !options.notifyUrl.startsWith("https://")
    )
      fail("ALIPAY_CONFIGURATION_REQUIRED", 503);
  }
  private verify(value: string, signature: string) {
    let valid = false;
    try {
      valid = verify(
        "RSA-SHA256",
        Buffer.from(value),
        this.options.platformPublicKey,
        Buffer.from(signature, "base64"),
      );
    } catch {}
    if (!valid) fail("PAYMENT_BAD_SIGNATURE", 401);
  }
  private async request(method: string, biz: unknown) {
    const now = this.options.now?.() ?? new Date();
    const timestamp = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now);
    const p: Record<string, string> = {
      app_id: this.options.appId,
      method,
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp,
      version: "1.0",
      notify_url: this.options.notifyUrl,
      biz_content: JSON.stringify(biz),
    };
    p.sign = sign(
      "RSA-SHA256",
      Buffer.from(canonical(p)),
      this.options.privateKey,
    ).toString("base64");
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        this.options.sandbox
          ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
          : "https://openapi.alipay.com/gateway.do",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
          },
          body: new URLSearchParams(p).toString(),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
    } catch {
      fail("PAYMENT_PROVIDER_UNAVAILABLE", 503);
    }
    if (!response.ok) fail("PAYMENT_PROVIDER_UNAVAILABLE", 503);
    const raw = await response.text();
    let body: string, signature: string;
    try {
      const f = fields(raw);
      body = f.get(method.replaceAll(".", "_") + "_response")!;
      signature = JSON.parse(f.get("sign")!);
      if (!body || typeof signature !== "string") throw Error();
    } catch {
      fail("PAYMENT_PROVIDER_INVALID", 503);
    }
    this.verify(body, signature);
    let v: any;
    try {
      v = JSON.parse(body);
    } catch {
      fail("PAYMENT_PROVIDER_INVALID", 503);
    }
    if (v.code === "40004" && v.sub_code === "ACQ.TRADE_NOT_EXIST") return null;
    if (v.code !== "10000") fail("PAYMENT_PROVIDER_REJECTED", 502);
    return v;
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
    const v = await this.request("alipay.trade.precreate", {
      out_trade_no: orderId,
      total_amount: amount(r.snapshot.sku.priceFen),
      subject: r.snapshot.sku.name.slice(0, 128),
      seller_id: this.options.merchantId,
      timeout_express: "15m",
    });
    if (
      v?.out_trade_no !== orderId ||
      typeof v.qr_code !== "string" ||
      !v.qr_code.startsWith("https://qr.alipay.com/")
    )
      fail("PAYMENT_PROVIDER_INVALID", 503);
    return { clientPayload: { kind: "qr", qrPayload: v.qr_code } };
  }
  normalizeStatus(v: any): PaymentEvent {
    if (
      v.app_id !== this.options.appId ||
      v.seller_id !== this.options.merchantId
    )
      fail("PAYMENT_MISMATCH", 409);
    const state = ["TRADE_SUCCESS", "TRADE_FINISHED"].includes(v.trade_status)
      ? "paid"
      : v.trade_status === "TRADE_CLOSED"
        ? "closed"
        : null;
    if (!state) fail("PAYMENT_STATUS_PENDING", 409);
    return validatePaymentEvent({
      channel: this.channel,
      eventId: v.notify_id ?? `${v.out_trade_no}:${v.trade_status}`,
      transactionId: v.trade_no || `closed:${v.out_trade_no}`,
      orderId: v.out_trade_no,
      appId: v.app_id,
      merchantId: v.seller_id,
      amountFen: decimalFen(v.total_amount),
      currency: "CNY",
      state,
      fulfillable: state === "paid",
    });
  }
  async verifyEvent(raw: Uint8Array, _headers: Record<string, string>) {
    const p: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(Buffer.from(raw).toString())) {
      if (k in p) fail("PAYMENT_INVALID_EVENT", 422);
      p[k] = v;
    }
    if (p.sign_type !== "RSA2" || !p.sign) fail("PAYMENT_BAD_SIGNATURE", 401);
    this.verify(canonical(p, true), p.sign);
    return this.normalizeStatus(p);
  }
  async query(orderId: string, r: PaymentRequest) {
    this.assertRequest(orderId, r);
    const v = await this.request("alipay.trade.query", {
      out_trade_no: orderId,
    });
    if (!v || v.trade_status === "WAIT_BUYER_PAY") return null;
    if (
      v.out_trade_no !== orderId ||
      (v.app_id !== undefined && v.app_id !== this.options.appId) ||
      (v.seller_id !== undefined && v.seller_id !== this.options.merchantId)
    )
      fail("PAYMENT_MISMATCH", 409);
    return this.normalizeStatus({
      ...v,
      app_id: this.options.appId,
      seller_id: this.options.merchantId,
    });
  }
  async close(orderId: string, r: PaymentRequest) {
    this.assertRequest(orderId, r);
    await this.request("alipay.trade.close", { out_trade_no: orderId });
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
    if (amountFen <= 0 || amountFen > r.snapshot.sku.priceFen)
      fail("INVALID_AMOUNT", 422);
    const v = await this.request("alipay.trade.refund", {
      out_trade_no: orderId,
      out_request_no: refundId,
      refund_amount: amount(amountFen),
    });
    if (
      !v ||
      v.out_trade_no !== orderId ||
      typeof v.trade_no !== "string" ||
      decimalFen(v.refund_fee) !== amountFen
    )
      fail("REFUND_MISMATCH", 409);
    return { providerRefundId: refundId, state: "submitted" as const };
  }
  async verifyRefundEvent(
    _raw: Uint8Array,
    _headers: Record<string, string>,
  ): Promise<VerifiedRefundEvent> {
    // Alipay refund identity is confirmed by authenticated original-refund query.
    fail("REFUND_CALLBACK_UNSUPPORTED", 422);
  }
  async queryOriginalRefund(
    r: OriginalRefundRequest,
  ): Promise<VerifiedRefundEvent | null> {
    this.assertRequest(r.orderId, r);
    const v = await this.request("alipay.trade.fastpay.refund.query", {
      out_trade_no: r.orderId,
      out_request_no: r.refundId,
    });
    if (!v || v.refund_status !== "REFUND_SUCCESS") return null;
    if (v.out_trade_no !== r.orderId || v.out_request_no !== r.refundId)
      fail("REFUND_MISMATCH", 409);
    return {
      ...validatePaymentEvent({
        channel: this.channel,
        eventId: `refund:${r.refundId}:success`,
        transactionId: v.trade_no,
        orderId: v.out_trade_no,
        appId: this.options.appId,
        merchantId: this.options.merchantId,
        amountFen: decimalFen(v.refund_amount),
        currency: "CNY",
        state: "refunded",
        fulfillable: false,
      }),
      refundId: r.refundId,
      providerRefundId: r.refundId,
      refundState: "succeeded",
    };
  }
}
