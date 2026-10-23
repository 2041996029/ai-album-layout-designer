import type { ConfigRelease } from "./types";
export type CapabilityState =
  "available" | "disabled" | "unconfigured" | "degraded";
export type CapabilityName =
  | "cloudUpload"
  | "generation"
  | "purchase"
  | "cloudExport"
  | "sharing"
  | "notification"
  | "login";
export type PublicCapability = {
  state: CapabilityState;
  reason:
    "ready" | "disabled" | "configuration_required" | "temporarily_unavailable";
  action: "continue" | "configure" | "retry_later";
};
export type PublicCapabilities = Record<CapabilityName, PublicCapability>;
export type Readiness = Partial<Record<CapabilityName, CapabilityState>>;
/** Construct public responses from a strict whitelist. No internal payload is spread. */
export function publicCapabilities(
  release: Readonly<ConfigRelease> | null,
  readiness: Readiness = {},
  emergency: Partial<Record<CapabilityName, boolean>> = {},
): PublicCapabilities {
  const payloads = Object.values(release?.versions ?? {}).map((v) => v.payload);
  const get = (kind: string) => payloads.find((p) => p.kind === kind);
  const site = get("site"),
    share = get("share");
  const configured: Record<CapabilityName, boolean> = {
    cloudUpload: !!get("storage") && !!get("upload"),
    generation:
      !!get("aiConnection") &&
      !!get("aiRoute") &&
      !!get("aiPricing") &&
      !!get("content"),
    purchase: !!get("payment") && !!get("sku"),
    cloudExport: !!get("export") && !!get("queue"),
    sharing: !!get("share"),
    notification: !!get("notification"),
    login: !!get("auth"),
  };
  const disabled: Partial<Record<CapabilityName, boolean>> = {
    sharing: share?.kind === "share" && !share.sharingEnabled,
    generation:
      payloads.some(
        (p) =>
          ["aiConnection", "aiRoute", "aiPricing"].includes(p.kind) &&
          "enabled" in p &&
          !p.enabled,
      ) ||
      payloads.some((p) => p.kind === "aiConnection" && p.dailyBudgetFen === 0),
    purchase: payloads.some(
      (p) =>
        ["payment", "sku"].includes(p.kind) && "enabled" in p && !p.enabled,
    ),
  };
  return Object.fromEntries(
    (Object.keys(configured) as CapabilityName[]).map((name) => {
      // A schema-valid configuration alone never proves a real integration is configured.
      let state: CapabilityState = configured[name]
        ? (readiness[name] ??
          (name === "sharing" ? "available" : "unconfigured"))
        : "unconfigured";
      if (
        disabled[name] ||
        emergency[name] ||
        (site?.kind === "site" && site.maintenanceMode)
      )
        state = "disabled";
      const reason =
        state === "available"
          ? "ready"
          : state === "disabled"
            ? "disabled"
            : state === "degraded"
              ? "temporarily_unavailable"
              : "configuration_required";
      return [
        name,
        {
          state,
          reason,
          action:
            state === "available"
              ? "continue"
              : state === "unconfigured"
                ? "configure"
                : "retry_later",
        },
      ];
    }),
  ) as PublicCapabilities;
}
