import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { api, id, setSession, type DTO } from "../cloud/api";
export function LoginPanel({
  capabilities,
  onLogin,
}: {
  capabilities: DTO<"Capabilities">;
  onLogin: (session: DTO<"WebSession">) => void;
}) {
  const [qr, setQr] = useState<DTO<"QrSession">>(),
    [state, setState] = useState(""),
    [error, setError] = useState("");
  const nonce = useRef(""),
    generation = useRef(0);
  const [qrImage, setQrImage] = useState("");
  useEffect(() => {
    let live = true;
    if (qr)
      void QRCode.toDataURL(qr.qrPayload, { width: 240, margin: 2 })
        .then((url) => {
          if (live) setQrImage(url);
        })
        .catch(() => setError("登录码暂时无法显示，请刷新"));
    return () => {
      live = false;
    };
  }, [qr]);
  const enabled = capabilities.capabilities.some(
    (c) =>
      /wechat.*(web|qr)|web.*wechat/i.test(c.key) && c.status === "available",
  );
  async function begin() {
    generation.current++;
    nonce.current = crypto.randomUUID() + crypto.randomUUID();
    setError("");
    try {
      setQr(
        await api<DTO<"QrSession">>("/auth/web/qr-sessions", "POST", {
          browserNonce: nonce.current,
        }),
      );
      setState("waiting");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (!qr) return;
    let live = true;
    const gen = generation.current;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (Date.now() >= Date.parse(qr!.expiresAt)) {
          if (live) setState("expired");
          return;
        }
        const status = await api<DTO<"QrStatus">>(
          `/auth/web/qr-sessions/${id(qr!.id)}`,
          "GET",
          undefined,
          {
            "X-QR-Poll-Token": qr!.pollToken,
            "X-Browser-Nonce": nonce.current,
          },
        );
        if (!live || gen !== generation.current) return;
        setState(status.state);
        if (status.state === "confirmed" && status.consumeProof) {
          const session = await api<DTO<"WebSession">>(
            `/auth/web/qr-sessions/${id(qr!.id)}/consume`,
            "POST",
            { consumeProof: status.consumeProof, browserNonce: nonce.current },
            {
              "X-QR-Poll-Token": qr!.pollToken,
              "X-Browser-Nonce": nonce.current,
            },
          );
          if (live && gen === generation.current) {
            setSession(session);
            onLogin(session);
          }
          return;
        }
        if (status.state === "expired" || status.state === "consumed") return;
        timer = setTimeout(poll, Math.max(1000, qr!.pollAfterSeconds * 1000));
      } catch (e) {
        if (live) setError(String(e));
      }
    }
    timer = setTimeout(poll, Math.max(1000, qr.pollAfterSeconds * 1000));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [qr, onLogin]);
  return (
    <section aria-label="登录">
      <h2>连接云工作区</h2>
      {enabled ? (
        <button onClick={() => void begin()}>
          {qr ? "刷新微信登录" : "微信登录"}
        </button>
      ) : (
        <p>微信登录暂未开通，本地创作可继续使用</p>
      )}
      {qr && (
        <>
          {qrImage && (
            <img src={qrImage} alt="微信登录二维码" width={240} height={240} />
          )}
          <p>
            {state === "expired"
              ? "登录已过期，请刷新"
              : state === "scanned"
                ? "请在微信确认"
                : "请在微信打开登录链接并确认"}
          </p>
          {/^https:\/\//.test(qr.qrPayload) && (
            <a href={qr.qrPayload} target="_blank" rel="noreferrer">
              打开微信登录
            </a>
          )}
        </>
      )}
      {!capabilities.capabilities.some(
        (c) => /sms/i.test(c.key) && c.status === "available",
      ) && <p>短信登录未开通</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
