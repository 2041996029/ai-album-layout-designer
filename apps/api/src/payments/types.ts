import type { Actor, Database } from "@album/server-core";
import type { PoolClient } from "pg";
import type {
  ConfigPayload,
  ConfigRelease,
  Environment,
} from "../config/types";
import type { WorkspaceService } from "../workspaces/service";

export type PaymentEvent = {
  channel: "wechat_pay" | "wechat_virtual";
  eventId: string;
  transactionId: string;
  orderId: string;
  appId: string;
  merchantId: string;
  amountFen: number;
  currency: "CNY";
  state: "paid" | "closed" | "refunded";
  fulfillable: boolean;
  productId?: string;
};
export type PublishedSku = Extract<ConfigPayload, { kind: "sku" }>;
export type PaymentConfig = Extract<ConfigPayload, { kind: "payment" }>;
/** Task5/8 implements this at config publication, using immutable published facts. */
export type PublishedSkuMaterializationPort = {
  materialize(
    tx: PoolClient,
    input: {
      releaseId: string;
      skuConfigVersionId: string;
      sku: PublishedSku;
      refundPolicy: Record<string, unknown>;
    },
  ): Promise<{ skuVersionId: string }>;
};
/** Contains versioned secret references only. Never a public response DTO. */
export type OrderSnapshot = {
  releaseId: string;
  skuVersionId: string;
  bindingId: string;
  sku: PublishedSku;
  payment: PaymentConfig;
  productId?: string;
  refundPolicy: Record<string, unknown>;
};
export type PaymentRequest = {
  orderId: string;
  providerRequestId: string;
  snapshot: Readonly<OrderSnapshot>;
};
/** null is an authenticated pending/unknown query, never a fabricated terminal fact. */
export interface PaymentAdapter {
  readonly channel: PaymentEvent["channel"];
  readonly mode: "local_simulator" | "approved_channel";
  createPayment(
    orderId: string,
    request: PaymentRequest,
  ): Promise<{ clientPayload: unknown }>;
  verifyEvent(
    rawBody: Uint8Array,
    headers: Record<string, string>,
  ): Promise<PaymentEvent>;
  query(orderId: string, request: PaymentRequest): Promise<PaymentEvent | null>;
  close(orderId: string, request: PaymentRequest): Promise<PaymentEvent | null>;
  refund(
    orderId: string,
    refundId: string,
    amountFen: number,
  ): Promise<{
    providerRefundId: string;
    state: "submitted" | "succeeded" | "unknown";
  }>;
  normalizeStatus(raw: unknown): PaymentEvent;
}
/** Implemented by Task5. Must use this exact transaction; must not open/commit another. */
export type FulfillmentPort = (
  tx: PoolClient,
  orderId: string,
) => Promise<void>;
export type OrderCatalog = {
  resolve(
    tx: PoolClient,
    skuVersionId: string,
    channel: PaymentEvent["channel"],
    client: Actor["client"],
  ): Promise<OrderSnapshot>;
};
export type PaymentAdmissionPort = {
  /** Server-approved independent channel/OS/version policy; absence disables purchase. */
  admit(input: {
    sku: PublishedSku;
    payment: PaymentConfig;
    client: Actor["client"];
    release: Readonly<ConfigRelease>;
  }): Promise<{ productId?: string; refundPolicy: Record<string, unknown> }>;
};
export type OrderOptions = {
  db: Database;
  workspaces: Pick<WorkspaceService, "authorize">;
  adapters: import("./adapters").PaymentAdapters;
  catalog: OrderCatalog;
  now?: () => Date;
  confirmation?: Pick<
    import("./confirm").PaymentConfirmation,
    "confirmPayment"
  >;
};
export type CreateOrderResult = {
  orderId: string;
  amountFen: number;
  clientPayload: unknown;
};
export type AdapterEnvironment = Environment;
