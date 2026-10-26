import { readFile } from "node:fs/promises";
import { fail } from "@album/server-core";
import type { CommerceOptions } from "../commerce/runtime";
import { FileSecretVault } from "../config/file-vault";
import { randomBytes, createHash } from "node:crypto";
import { WechatPayAdapter } from "./wechat";
import { AlipayAdapter } from "./alipay";
/** This file is server-owned, never selected by an HTTP request or included in source bundles. */
export async function deploymentPayments(
  env: NodeJS.ProcessEnv,
): Promise<Partial<CommerceOptions>> {
  const secrets = env.ALBUM_CONFIG_VAULT_ROOT
    ? new FileSecretVault(
        env.ALBUM_CONFIG_VAULT_ROOT,
        env.ALBUM_CONFIG_VAULT_SECRET ?? "",
      )
    : undefined;
  if (!env.ALBUM_PAYMENT_BINDINGS_FILE) return secrets ? { secrets } : {};
  let entries: any;
  try {
    entries = JSON.parse(
      await readFile(env.ALBUM_PAYMENT_BINDINGS_FILE, "utf8"),
    );
  } catch {
    fail("PAYMENT_CONFIGURATION_INVALID", 503);
  }
  if (!Array.isArray(entries) || !entries.length || entries.length > 20)
    fail("PAYMENT_CONFIGURATION_INVALID", 503);
  let dependencies: any[] = [];
  if (env.ALBUM_CONFIG_DEPENDENCIES_FILE) {
    try {
      dependencies = JSON.parse(
        await readFile(env.ALBUM_CONFIG_DEPENDENCIES_FILE, "utf8"),
      );
      if (!Array.isArray(dependencies)) throw Error();
    } catch {
      fail("CONFIG_DEPENDENCIES_INVALID", 503);
    }
  }
  const match = (payment: any) =>
    entries.find(
      (e: any) =>
        e.channel === payment.channel &&
        e.appId === payment.appId &&
        e.merchantId === payment.merchantId &&
        e.credentialRef === payment.credential.secretRef &&
        e.credentialVersion === payment.credential.secretVersion &&
        e.notifyUrl === payment.callbackUrl &&
        e.verificationKeyRef === payment.verificationKeyRef,
    );
  const bindings: NonNullable<CommerceOptions["paymentBindings"]> = [];
  const ids = new Set<string>(),
    callbacks = new Set<string>();
  for (const entry of entries) {
    if (
      typeof entry.bindingId !== "string" ||
      !entry.bindingId ||
      ids.has(entry.bindingId) ||
      !["wechat_pay", "alipay"].includes(entry.channel)
    )
      fail("PAYMENT_CONFIGURATION_INVALID", 503);
    ids.add(entry.bindingId);
    const callbackChannel = entry.callbackChannel ?? entry.channel;
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(callbackChannel) ||
      callbacks.has(callbackChannel)
    )
      fail("PAYMENT_CONFIGURATION_INVALID", 503);
    callbacks.add(callbackChannel);
    const adapter =
      entry.channel === "alipay"
        ? new AlipayAdapter(entry)
        : new WechatPayAdapter(entry);
    bindings.push({
      id: entry.bindingId,
      adapter,
      refundAdapter: adapter,
      callbackChannel,
      ack:
        entry.channel === "alipay"
          ? "success"
          : { code: "SUCCESS", message: "成功" },
    });
  }

  return {
    paymentBindings: bindings,
    ...(secrets ? { secrets } : {}),
    admission: {
      async admit({ payment, release }) {
        const b = match(payment),
          root = release.versions.payment;
        if (
          !b ||
          !payment.enabled ||
          !root ||
          b.bindingId !==
            (root.payload.kind === "payment" &&
            root.payload.channel === payment.channel
              ? root.id
              : `${root.id}:${payment.channel}`)
        )
          fail("PAYMENT_UNCONFIGURED", 503);
        return { refundPolicy: { automatic: "unused_only" } };
      },
    },
    config: {
      readiness: { purchase: "available" },
      allowedHosts: entries.map((e: any) => new URL(e.notifyUrl).hostname),
      dependencies: {
        async assertAvailable(target, ref, environment) {
          if (
            !dependencies.some(
              (d) =>
                d.target === target &&
                d.id === ref.id &&
                d.version === ref.version &&
                d.environment === environment &&
                d.approved === true,
            )
          )
            fail("CONFIG_DEPENDENCY_UNAVAILABLE", 409);
        },
      },
      integrations: {
        payment: {
          supports(payload) {
            return (
              payload.kind === "payment" &&
              [payload, ...(payload.additionalChannels ?? [])].every(
                (p) => !!match(p),
              )
            );
          },
          async test(payload, level, readSecret) {
            if (
              payload.kind !== "payment" ||
              !["connection", "capability"].includes(level)
            )
              fail("CONFIG_TEST_UNSUPPORTED", 422);
            for (const p of [payload, ...(payload.additionalChannels ?? [])]) {
              const e = match(p);
              if (!e) fail("PAYMENT_UNCONFIGURED", 503);
              if (
                level === "capability" &&
                !dependencies.some(
                  (d) =>
                    d.target === "paymentCapability" &&
                    d.id === p.platformCapabilityRef.id &&
                    d.version === p.platformCapabilityRef.version &&
                    d.environment === (env.C3_ENV ?? "dev") &&
                    d.approved === true,
                )
              )
                fail("CONFIG_DEPENDENCY_UNAVAILABLE", 409);
              const actual = Buffer.from(await readSecret(p.credential))
                .toString()
                .trim();
              if (
                createHash("sha256").update(actual).digest("hex") !==
                createHash("sha256").update(e.privateKey.trim()).digest("hex")
              )
                fail("PAYMENT_CREDENTIAL_MISMATCH", 409);
              const binding = bindings.find((b) => b.id === e.bindingId)!;
              const orderId = "probe" + randomBytes(10).toString("hex");
              await binding.adapter.query(orderId, {
                orderId,
                providerRequestId: orderId,
                snapshot: { bindingId: e.bindingId, payment: p } as any,
              });
            }
            return {
              state: "passed",
              verifiedChecks: [
                "dns",
                "authentication",
                "contract",
                ...(level === "capability" ? ["capability"] : []),
              ],
            };
          },
        },
      },
    },
  };
}
