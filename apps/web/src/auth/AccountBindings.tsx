import { useEffect, useState } from "react";
import { api, type DTO, type Page } from "../cloud/api";
import { useHumanVerification } from "../commerce/useHumanVerification";
export function AccountBindings() {
  const [bindings, setBindings] = useState<DTO<"Binding">[]>([]),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const human = useHumanVerification();
  async function load() {
    try {
      const p = await api<Page<DTO<"Binding">>>("/auth/bindings");
      setBindings(p.items);
      setReady(true);
    } catch {
      setError("绑定方式暂时无法读取，请登录后重试。");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="commerce-page">
      <div className="eyebrow">YOUR ACCOUNT</div>
      <h1>账号与绑定</h1>
      <p>
        Web
        使用邮箱登录，小程序使用微信登录。绑定后，同一账号可访问已有工作区及其相册、订单和权益。
      </p>
      {error && <p role="alert">{error}</p>}
      {ready &&
        bindings.map((b) => (
          <article className="balance-card" key={b.id}>
            <div>
              <strong>
                {b.provider === "email"
                  ? "邮箱"
                  : b.provider.startsWith("wechat")
                    ? "微信"
                    : "手机"}
              </strong>
              <p>{b.displayHint}</p>
            </div>
            <button
              disabled={busy || bindings.length <= 1 || !human.available}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const proof = await human.verify("unbind");
                  await api(
                    `/auth/bindings/${encodeURIComponent(b.id)}`,
                    "DELETE",
                    {
                      reauthProof: proof,
                      remainingLoginMethodAcknowledged: true,
                    },
                  );
                  await load();
                } catch {
                  setError("解绑未成功，请重新验证后重试。");
                } finally {
                  setBusy(false);
                }
              }}
            >
              解绑
            </button>
          </article>
        ))}
      <aside className="commerce-note">
        <h2>绑定微信</h2>
        <p>
          在小程序首页选择“验证邮箱并绑定当前微信”，填写此账号的邮箱并完成验证码验证。成功后两端使用同一账号。
        </p>
        <p>
          如果微信已经属于另一账号，系统会提示冲突，不会自动合并或转移已有资产。最后一种登录方式不能解绑。
        </p>
      </aside>
      {human.notice}
      {human.dialog}
    </section>
  );
}
