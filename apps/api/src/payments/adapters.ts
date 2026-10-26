import { createHmac, timingSafeEqual } from "node:crypto";
import { fail } from "@album/server-core";
import { deepFreeze } from "../config/types";
import type {
  AdapterEnvironment,
  PaymentAdapter,
  PaymentEvent,
  PaymentRequest,
} from "./types";

export type LocalPaymentOptions = {
  environment: AdapterEnvironment;
  channel: PaymentEvent["channel"];
  secret: string;
  now?: () => Date;
  transport: {
    create(request: PaymentRequest): Promise<{ clientPayload: unknown }>;
    query(orderId: string, request: PaymentRequest): Promise<unknown | null>;
    close(orderId: string, request: PaymentRequest): Promise<unknown | null>;
    refund?(
      orderId: string,
      refundId: string,
      amountFen: number,
    ): ReturnType<PaymentAdapter["refund"]>;
  };
};
export function validatePaymentEvent(raw: unknown): PaymentEvent {
  if (!raw || typeof raw !== "object") fail("PAYMENT_INVALID_EVENT", 422);
  const e = raw as Record<string, unknown>;
  for (const field of [
    "eventId",
    "transactionId",
    "orderId",
    "appId",
    "merchantId",
  ])
    if (
      typeof e[field] !== "string" ||
      !(e[field] as string).length ||
      (e[field] as string).length > 128
    )
      fail("PAYMENT_INVALID_EVENT", 422);
  if (
    !["wechat_pay", "wechat_virtual", "alipay"].includes(String(e.channel)) ||
    !["paid", "closed", "refunded"].includes(String(e.state)) ||
    e.currency !== "CNY" ||
    !Number.isSafeInteger(e.amountFen) ||
    (e.amountFen as number) < 0 ||
    (e.amountFen as number) > 1e12 ||
    typeof e.fulfillable !== "boolean" ||
    (e.productId !== undefined &&
      (typeof e.productId !== "string" ||
        !e.productId.length ||
        e.productId.length > 128))
  )
    fail("PAYMENT_INVALID_EVENT", 422);
  return {
    channel: e.channel as PaymentEvent["channel"],
    eventId: e.eventId as string,
    transactionId: e.transactionId as string,
    orderId: e.orderId as string,
    appId: e.appId as string,
    merchantId: e.merchantId as string,
    amountFen: e.amountFen as number,
    currency: "CNY",
    state: e.state as PaymentEvent["state"],
    fulfillable: e.fulfillable as boolean,
    ...(e.productId === undefined ? {} : { productId: e.productId as string }),
  };
}
/** Local signed transport is never a real payment capability. */
export class LocalSignedPaymentAdapter implements PaymentAdapter {
  readonly mode = "local_simulator";
  get channel() {
    return this.options.channel;
  }
  constructor(public readonly options: LocalPaymentOptions) {
    if (options.environment !== "dev" || process.env.NODE_ENV === "production")
      fail("LOCAL_PAYMENT_DEV_ONLY", 503);
    if (Buffer.byteLength(options.secret) < 32)
      fail("PAYMENT_SIGNING_SECRET_REQUIRED", 503);
  }
  createPayment(_orderId: string, request: PaymentRequest) {
    return this.options.transport.create(request);
  }
  async verifyEvent(rawBody: Uint8Array, headers: Record<string, string>) {
    const timestamp = headers["x-payment-timestamp"] ?? "",
      signature = headers["x-payment-signature"] ?? "";
    if (
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(
        (this.options.now?.() ?? new Date()).getTime() - Number(timestamp),
      ) > 300000 ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      fail("PAYMENT_BAD_SIGNATURE", 401);
    const expected = createHmac("sha256", this.options.secret)
      .update(timestamp)
      .update(".")
      .update(rawBody)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
      fail("PAYMENT_BAD_SIGNATURE", 401);
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    } catch {
      fail("PAYMENT_INVALID_EVENT", 422);
    }
    return this.normalizeStatus(raw);
  }
  normalizeStatus(raw: unknown) {
    return validatePaymentEvent(raw);
  }
  async query(orderId: string, request: PaymentRequest) {
    const raw = await this.options.transport.query(orderId, request);
    return raw === null ? null : this.normalizeStatus(raw);
  }
  async close(orderId: string, request: PaymentRequest) {
    const raw = await this.options.transport.close(orderId, request);
    return raw === null ? null : this.normalizeStatus(raw);
  }
  async refund(orderId: string, refundId: string, amountFen: number) {
    if (!Number.isSafeInteger(amountFen) || amountFen < 0)
      fail("INVALID_AMOUNT", 422);
    if (!this.options.transport.refund) fail("PAYMENT_UNCONFIGURED", 503);
    return this.options.transport.refund(orderId, refundId, amountFen);
  }
}
/** Only trusted server composition can register approved real adapters. Default is closed. */
export class PaymentAdapters {
  private readonly entries = new Map<string, PaymentAdapter>();
  private readonly trusted = new WeakMap<object, string>();
  constructor(private readonly environment: AdapterEnvironment) {}
  register(
    bindingId: string,
    adapter: PaymentAdapter,
    approval: { approved: boolean },
  ) {
    if (!approval.approved) fail("PAYMENT_UNCONFIGURED", 503);
    if (
      adapter.mode === "local_simulator" &&
      (this.environment !== "dev" || process.env.NODE_ENV === "production")
    )
      fail("LOCAL_PAYMENT_DEV_ONLY", 503);
    if (this.entries.has(bindingId)) fail("PAYMENT_BINDING_IMMUTABLE", 409);
    this.entries.set(bindingId, adapter);
  }
  capability(bindingId: string): { state: "available" | "unconfigured" } {
    return {
      state: this.entries.has(bindingId) ? "available" : "unconfigured",
    };
  }
  get(bindingId: string) {
    const adapter = this.entries.get(bindingId);
    if (!adapter) fail("PAYMENT_UNCONFIGURED", 503);
    return adapter;
  }
  private trust(bindingId: string, event: PaymentEvent) {
    const normalized = deepFreeze(validatePaymentEvent(event));
    if (normalized.channel !== this.get(bindingId).channel)
      fail("PAYMENT_MISMATCH", 409);
    this.trusted.set(normalized, bindingId);
    return normalized;
  }
  bindingFor(event: PaymentEvent) {
    const binding = this.trusted.get(event);
    if (!binding) fail("PAYMENT_UNVERIFIED", 401);
    return binding;
  }
  async verify(
    bindingId: string,
    raw: Uint8Array,
    headers: Record<string, string>,
  ) {
    return this.trust(
      bindingId,
      await this.get(bindingId).verifyEvent(raw, headers),
    );
  }
  async query(request: PaymentRequest) {
    const binding = request.snapshot.bindingId,
      event = await this.get(binding).query(request.orderId, request);
    return event === null ? null : this.trust(binding, event);
  }
  async close(request: PaymentRequest) {
    const binding = request.snapshot.bindingId,
      event = await this.get(binding).close(request.orderId, request);
    return event === null ? null : this.trust(binding, event);
  }
}
