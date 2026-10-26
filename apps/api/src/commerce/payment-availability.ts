import type { ConfigRelease } from "../config/types";
import type { CommerceRuntime } from "./runtime";
import type { PaymentEvent } from "../payments/types";
/** Availability belongs to the active immutable release, not to any historical registered adapter. */
export async function availablePaymentChannels(
  s: Pick<CommerceRuntime, "payments" | "options">,
  release: Readonly<ConfigRelease> | null,
  platform: string,
): Promise<PaymentEvent["channel"][]> {
  const root = release?.versions.payment,
    sku = release?.versions.sku?.payload;
  if (
    !release ||
    !root ||
    root.payload.kind !== "payment" ||
    !root.payload.enabled ||
    sku?.kind !== "sku" ||
    !sku.enabled ||
    !["web", "mini"].includes(platform) ||
    !s.options.admission
  )
    return [];
  const result: PaymentEvent["channel"][] = [];
  for (const payment of [
    root.payload,
    ...(root.payload.additionalChannels ?? []),
  ]) {
    if (
      !payment.enabled ||
      (platform === "mini"
        ? payment.channel !== "wechat_virtual"
        : payment.channel === "wechat_virtual")
    )
      continue;
    const binding =
      payment.channel === root.payload.channel
        ? root.id
        : `${root.id}:${payment.channel}`;
    try {
      if (s.payments.get(binding).channel !== payment.channel) continue;
      await s.options.admission.admit({
        sku,
        payment,
        release,
        client: platform as "web" | "mini",
      });
      result.push(payment.channel);
    } catch {
      /* Keep unavailable channels closed; historical adapters remain available to recovery. */
    }
  }
  return result;
}
