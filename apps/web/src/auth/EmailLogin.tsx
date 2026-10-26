import { useEffect, useState } from "react";
import { api, setSession, type DTO } from "../cloud/api";
export function EmailLogin({
  onLogin,
}: {
  onLogin: (s: DTO<"WebSession">) => void;
}) {
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState<DTO<"EmailChallenge">>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!seconds) return;
    const t = setTimeout(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  async function send() {
    setBusy(true);
    setError("");
    try {
      const q = await api<DTO<"EmailChallenge">>(
        "/auth/email/challenges",
        "POST",
        { email, purpose: "login" },
      );
      setChallenge(q);
      setSeconds(q.retryAfterSeconds);
      setCode("");
    } catch {
      setError("验证码发送失败，请稍后重试或联系管理员。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="email-login"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!challenge) return;
        setBusy(true);
        setError("");
        try {
          const s = await api<DTO<"WebSession">>("/auth/email/login", "POST", {
            challengeId: challenge.id,
            verificationCode: code,
          });
          setSession(s);
          onLogin(s);
        } catch {
          setError("验证码无效或已过期，请检查后重试。");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        邮箱地址
        <input
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          disabled={busy}
          onChange={(e) => {
            setEmail(e.target.value);
            setChallenge(undefined);
            setCode("");
          }}
        />
      </label>
      <button
        type="button"
        disabled={busy || seconds > 0 || !email.includes("@")}
        onClick={() => void send()}
      >
        {seconds ? `${seconds} 秒后可重发` : "发送验证码"}
      </button>
      {challenge && (
        <>
          <p>验证码已发送至 {challenge.destinationHint}，5 分钟内有效。</p>
          <label>
            邮箱验证码
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button type="submit" disabled={busy || code.length !== 6}>
            {busy ? "正在验证…" : "登录 / 注册"}
          </button>
        </>
      )}
      <p>
        首次验证邮箱将创建账号。已有微信账号请先绑定同一邮箱，以共享相册与权益。
      </p>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
