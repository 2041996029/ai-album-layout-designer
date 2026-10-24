import { useEffect, useState } from "react";
import { api, id, type DTO, type Page } from "../cloud/api";
export function MembershipPage({
  workspaceId,
}: {
  workspaceId: string;
}): React.JSX.Element {
  const [skus, setSkus] = useState<DTO<"Sku">[]>([]),
    [ent, setEnt] = useState<DTO<"Entitlements">>(),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState("");
  useEffect(() => {
    let live = true;
    setSkus([]);
    setError("");
    Promise.all([
      api<Page<DTO<"Sku">>>("/skus?platform=web"),
      api<DTO<"Capabilities">>("/capabilities?platform=web"),
    ])
      .then(([p, c]) => {
        if (live) {
          setSkus(p.items.filter((s) => s.state === "published"));
          setReady(
            c.capabilities.some(
              (c) => c.key === "purchase" && c.status === "available",
            ),
          );
        }
      })
      .catch((e) => live && setError(e.message));
    api<DTO<"Entitlements">>(`/workspaces/${id(workspaceId)}/entitlements`)
      .then((v) => live && setEnt(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [workspaceId]);
  async function buy(sku: DTO<"Sku">) {
    setBusy(sku.versionId);
    setError("");
    try {
      const order = await api<DTO<"Order">>("/orders", "POST", {
        workspaceId,
        skuVersionId: sku.versionId,
        channel: "wechat_pay",
        clientPlatform: "web",
      });
      location.hash = `orders/${id(order.id)}`;
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="commerce-page">
      <div className="eyebrow">YOUR WORKSPACE · MEMBERSHIP</div>
      <h1>会员与点数</h1>
      <p className="commerce-lead">为每一本相册，选择合适的创作空间。</p>
      <p className="muted">
        当前工作区 <code>{workspaceId}</code> · 权益仅适用于此工作区
      </p>
      {error && <p role="alert">{error}</p>}
      <article className="balance-card">
        <div>
          <span>当前权益</span>
          <h2>
            {ent?.watermarkRequired
              ? "免费空间"
              : ent
                ? "会员空间"
                : "权益待查询"}
          </h2>
          <p>
            {ent
              ? `最高 ${ent.maxDpi} DPI · ${ent.watermarkRequired ? "含品牌水印" : "无品牌水印"}`
              : "以服务端查询结果为准"}
          </p>
        </div>
        <div>
          <strong>{ent?.availableCredits ?? "—"}</strong>
          <span>可用点数</span>
          <small>预占 {ent?.reservedCredits ?? "—"} 点</small>
        </div>
      </article>
      <div className="price-grid">
        {skus.length
          ? skus.map((s) => (
              <article className="price-card" key={s.versionId}>
                <span className="pill">已发布商品</span>
                <h2>{s.name}</h2>
                <div className="price">
                  ¥{(s.priceFen / 100).toFixed(2)}{" "}
                  <small>
                    / {s.durationDays ? s.durationDays + "天" : "点数包"}
                  </small>
                </div>
                <p>{s.creditGrant} 点 · 固定期限，无自动续费</p>
                <ul>
                  {s.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <button
                  className="primary"
                  disabled={
                    !ready ||
                    !s.platforms.includes("web") ||
                    !s.channels.includes("wechat_pay") ||
                    !!busy
                  }
                  onClick={() => void buy(s)}
                >
                  {busy === s.versionId
                    ? "创建订单…"
                    : ready
                      ? "购买"
                      : "支付尚未开通"}
                </button>
                <small>版本 {s.versionId}</small>
              </article>
            ))
          : ["个人会员", "影楼会员", "AI 点数包"].map((name) => (
              <article className="price-card" key={name}>
                <span className="pill">未上架</span>
                <h2>{name}</h2>
                <p>经营者发布价格与规则后开放购买。</p>
              </article>
            ))}
      </div>
      <aside className="commerce-note">
        <h3>购买与退款说明</h3>
        <p>
          价格和权益以已发布商品版本为准。点数按各发放批次的有效期使用，退款冻结额度不可消费。已生效会员需财务复核；退款申请不代表退款成功。支付结果以服务端确认和履约记录为准。
        </p>
      </aside>
    </section>
  );
}
