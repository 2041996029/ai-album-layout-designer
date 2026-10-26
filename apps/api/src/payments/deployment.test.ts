import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { deploymentPayments } from "./deployment";
it("deployment leaves purchase closed without explicit server bindings and independently enables encrypted vault", async () => {
  expect(await deploymentPayments({})).toEqual({});
  const dir = await mkdtemp(join(tmpdir(), "deploy-pay-"));
  try {
    const result = await deploymentPayments({
      ALBUM_CONFIG_VAULT_ROOT: dir,
      ALBUM_CONFIG_VAULT_SECRET:
        "independent-runtime-vault-key-at-least-thirty-two",
    });
    expect(result.paymentBindings).toBeUndefined();
    expect(result.secrets).toBeDefined();
    const q = await result.secrets!.write("credential", Buffer.from("private"));
    expect(
      Buffer.from(
        await result.secrets!.read(q.secretRef, q.secretVersion),
      ).toString(),
    ).toBe("private");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("rejects malformed private config without printing contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "deploy-pay-"));
  try {
    const path = join(dir, "bindings.json");
    await writeFile(path, "private-key-is-not-json");
    await expect(
      deploymentPayments({ ALBUM_PAYMENT_BINDINGS_FILE: path }),
    ).rejects.toThrow("PAYMENT_CONFIGURATION_INVALID");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("merchant admission requires the exact published binding, credential and callback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "deploy-pay-"));
  try {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 }),
      privateKey = keys.privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
      platformPublicKey = keys.publicKey
        .export({ format: "pem", type: "spki" })
        .toString();
    const path = join(dir, "bindings.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          bindingId: "version:alipay",
          channel: "alipay",
          appId: "app",
          merchantId: "seller",
          privateKey,
          platformPublicKey,
          notifyUrl: "https://album.test/v1/payment-callbacks/alipay",
          credentialRef: "ref",
          credentialVersion: "v1",
          verificationKeyRef: "verify",
        },
      ]),
    );
    const d = await deploymentPayments({ ALBUM_PAYMENT_BINDINGS_FILE: path });
    const payment: any = {
      kind: "payment",
      channel: "alipay",
      enabled: true,
      appId: "app",
      merchantId: "seller",
      credential: { secretRef: "ref", secretVersion: "v1" },
      verificationKeyRef: "verify",
      callbackUrl: "https://album.test/v1/payment-callbacks/alipay",
    };
    const input: any = {
      payment,
      sku: {},
      client: "web",
      release: {
        versions: {
          payment: {
            id: "version",
            payload: { kind: "payment", channel: "wechat_pay" },
          },
        },
      },
    };
    expect(await d.admission!.admit(input)).toMatchObject({
      refundPolicy: { automatic: "unused_only" },
    });
    await expect(
      d.admission!.admit({
        ...input,
        payment: { ...payment, merchantId: "other" },
      }),
    ).rejects.toThrow("PAYMENT_UNCONFIGURED");
    await expect(
      d.admission!.admit({
        ...input,
        release: {
          versions: {
            payment: {
              id: "wrong",
              payload: { kind: "payment", channel: "wechat_pay" },
            },
          },
        },
      }),
    ).rejects.toThrow("PAYMENT_UNCONFIGURED");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
