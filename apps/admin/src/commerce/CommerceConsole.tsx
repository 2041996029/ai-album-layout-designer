import { useEffect, useState } from "react";
import { api, id, type DTO, type Page } from "../../../web/src/cloud/api";
export function CommerceConsole(): React.JSX.Element {
  const [orders, setOrders] = useState<DTO<"Order">[]>([]),
    [skus, setSkus] = useState<DTO<"Sku">[]>([]),
    [batches, setBatches] = useState<DTO<"RedemptionBatch">[]>([]),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [reason, setReason] = useState(""),
    [ticket, setTicket] = useState(""),
    [proof, setProof] = useState(""),
    [workspace, setWorkspace] = useState(""),
    [source, setSource] = useState(""),
    [amount, setAmount] = useState(1),
    [kind, setKind] = useState<"credits" | "membership">("credits"),
    [sku, setSku] = useState(""),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  async function refresh() {
    try {
      const [o, b, s] = await Promise.all([
        api<Page<DTO<"Order">>>("/admin/orders"),
        api<Page<DTO<"RedemptionBatch">>>("/admin/redemption-batches"),
        api<Page<DTO<"Sku">>>("/skus?platform=web"),
      ]);
      setOrders(o.items);
      setBatches(b.items);
      setSkus(s.items);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const headers = { "X-Reauthentication-Proof": proof };
  async function act(fn: () => Promise<unknown>) {
    setError("");
    setStatus("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <main className="commerce-page admin-commerce">
      <div className="eyebrow">ALBUM / FINANCE OPERATIONS</div>
      <h1>商业运营</h1>
      <p className="commerce-lead">订单、兑换与财务复核。</p>
      <p className="muted">
        金额单位为人民币分 · 财务修改需当前角色、二次验证及工单依据
      </p>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      <section className="commerce-note">
        <h2>审核依据</h2>
        <div className="form-grid">
          <label>
            原因
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
          <label>
            工单号
            <input
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              required
            />
          </label>
          <label>
            二次验证凭证
            <input
              type="password"
              autoComplete="off"
              value={proof}
              onChange={(e) => setProof(e.target.value)}
            />
          </label>
        </div>
      </section>
      <section>
        <h2>已发布 SKU 版本</h2>
        {skus.length ? (
          skus.map((s) => (
            <p key={s.versionId}>
              {s.name} · ¥{(s.priceFen / 100).toFixed(2)} ·{" "}
              <code>{s.versionId}</code>
            </p>
          ))
        ) : (
          <p>暂无已发布商品</p>
        )}
      </section>
      <section>
        <h2>订单查询</h2>
        <button onClick={() => void refresh()}>刷新</button>
        {orders.map((o) => (
          <article className="order-row" key={o.id}>
            <code>{o.id}</code>
            <span>
              {o.state} / {o.fulfillmentState}
            </span>
            <strong>{o.amountFen} 分</strong>
            <small>{o.workspaceId}</small>
          </article>
        ))}
      </section>
      <section className="commerce-note">
        <h2>兑换批次</h2>
        <label>
          SKU 版本
          <select value={sku} onChange={(e) => setSku(e.target.value)}>
            <option value="">选择版本</option>
            {skus.map((s) => (
              <option key={s.versionId} value={s.versionId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!sku || !reason || !proof}
          onClick={() =>
            void act(async () => {
              const result = await api<DTO<"RedemptionBatchCreated">>(
                "/admin/redemption-batches",
                "POST",
                {
                  skuVersionId: sku,
                  count: 1,
                  maxUsesPerCode: 1,
                  expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
                  reason,
                },
                headers,
              );
              if (result.oneTimeCodes) {
                const url = URL.createObjectURL(
                  new Blob(["code\n" + result.oneTimeCodes.join("\n")], {
                    type: "text/csv",
                  }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = `redemption-${result.id}.csv`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                setStatus(
                  "首次生成的兑换码已下载。刷新或重放不会再次提供原始码。",
                );
              } else setStatus("该请求已处理；原始码不可恢复。");
            })
          }
        >
          生成并下载一次性 CSV
        </button>
        {batches.map((b) => (
          <p key={b.id}>
            <code>{b.id}</code> · {b.state}{" "}
            <button
              disabled={!reason || !proof || b.state !== "active"}
              onClick={() =>
                void act(() =>
                  api(
                    `/admin/redemption-batches/${id(b.id)}?reason=${encodeURIComponent(reason)}`,
                    "DELETE",
                    undefined,
                    { ...headers, "If-Match": `"${b.revision}"` },
                  ),
                )
              }
            >
              停用
            </button>
          </p>
        ))}
      </section>
      <section className="commerce-note">
        <h2>额度 / 会员调整</h2>
        <div className="form-grid">
          <label>
            工作区
            <input
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
            />
          </label>
          <label>
            来源授权 ID
            <input value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          <label>
            类型
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="credits">点数</option>
              <option value="membership">会员续期</option>
            </select>
          </label>
          <label>
            {kind === "credits" ? "点数增减" : "延长天数"}
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          disabled={
            !workspace || !source || !reason || !ticket || !proof || !amount
          }
          onClick={() =>
            void act(async () => {
              const result = await api<DTO<"FinancialAdjustment">>(
                `/admin/workspaces/${id(workspace)}/adjustments`,
                "POST",
                {
                  kind,
                  sourceGrantId: source,
                  ...(kind === "credits"
                    ? { creditDelta: amount }
                    : { durationDays: amount }),
                  reason,
                  ticketId: ticket,
                },
                headers,
              );
              setStatus(`已记录调整 ${result.id}`);
            })
          }
        >
          提交财务调整
        </button>
      </section>
      <section className="commerce-note">
        <h2>渠道差异复核</h2>
        <label>
          上海业务日期
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button
          disabled={!reason || !proof}
          onClick={() =>
            void act(async () => {
              const result = await api<{ id: string }>(
                "/admin/operations/reconciliations",
                "POST",
                {
                  scope: "payments",
                  from: date + "T00:00:00+08:00",
                  to: date + "T23:59:59+08:00",
                  reason,
                },
                headers,
              );
              setStatus(
                `对账记录 ${result.id}，差异需人工复核，不重复补发权益。`,
              );
            })
          }
        >
          启动对账
        </button>
      </section>
    </main>
  );
}
