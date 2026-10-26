import { useEffect, useRef, useState } from "react";
import { api, type DTO } from "../cloud/api";
type Purpose = DTO<"IdentityProof">["purpose"];
type Pending = {
  purpose: Purpose;
  resolve: (proof: string) => void;
  reject: (error: Error) => void;
};
/** Operation proofs remain internal and are freshly obtained for every mutation. */
export function useHumanVerification() {
  const [state, setState] = useState<
      DTO<"ReauthAvailability">["state"] | "loading"
    >("loading"),
    [challenge, setChallenge] = useState<DTO<"HumanReauthChallenge">>(),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<Pending | null>(null);
  useEffect(() => {
    let live = true;
    api<DTO<"ReauthAvailability">>("/auth/reauthentication")
      .then((v) => {
        if (live) setState(v.state);
      })
      .catch(() => {
        if (live) setState("unconfigured");
      });
    return () => {
      live = false;
      pending.current?.reject(new Error("验证已取消"));
      pending.current = null;
    };
  }, []);
  const verify = (purpose: Purpose): Promise<string> => {
    if (state !== "available")
      return Promise.reject(new Error("身份验证尚未开通，请联系管理员。"));
    if (pending.current)
      return Promise.reject(new Error("请先完成当前身份验证。"));
    setBusy(true);
    setError("");
    setCode("");
    return new Promise((resolve, reject) => {
      pending.current = { purpose, resolve, reject };
      void api<DTO<"HumanReauthChallenge">>(
        "/auth/reauthentication/challenges",
        "POST",
        { purpose },
      )
        .then((c) => {
          if (pending.current) setChallenge(c);
        })
        .catch((e) => {
          pending.current?.reject(e);
          pending.current = null;
          setChallenge(undefined);
        })
        .finally(() => setBusy(false));
    });
  };
  const notice =
    state === "loading" ? (
      <p>正在检查身份验证…</p>
    ) : state === "available" ? (
      <p className="muted">
        敏感操作前将向已绑定的验证方式发送验证码，每次操作需重新验证。
      </p>
    ) : (
      <p className="commerce-note">
        {state === "unavailable"
          ? "此账号尚未绑定可用验证方式，请先绑定邮箱或联系管理员。"
          : "身份验证尚未开通，请联系管理员。"}
      </p>
    );
  const dialog = challenge ? (
    <div className="verification-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="身份验证"
        className="commerce-note verification-dialog"
      >
        <h2>身份验证</h2>
        <p>验证码已发送至{challenge.destinationHint}。</p>
        <p>
          本次验证用于
          {challenge.purpose === "billing_refund" ? "退款申请" : "当前财务操作"}
          ，五分钟内有效。
        </p>
        {error && <p role="alert">{error}</p>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!pending.current) return;
            setBusy(true);
            setError("");
            try {
              const result = await api<DTO<"ReauthenticationResult">>(
                "/auth/reauthenticate",
                "POST",
                {
                  purpose: pending.current.purpose,
                  proof: {
                    provider: challenge.method === "email" ? "email" : "phone",
                    challengeId: challenge.id,
                    proof: code,
                    purpose: pending.current.purpose,
                  },
                },
              );
              const current = pending.current;
              pending.current = null;
              setChallenge(undefined);
              setCode("");
              current.resolve(result.reauthProof);
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            验证码
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
          </label>
          <button type="submit" disabled={busy || code.length !== 6}>
            验证并继续
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              pending.current?.reject(new Error("验证已取消"));
              pending.current = null;
              setChallenge(undefined);
              setCode("");
            }}
          >
            取消验证
          </button>
        </form>
      </section>
    </div>
  ) : null;
  return { available: state === "available", busy, verify, notice, dialog };
}
