import {
  adminLabel as adminLabelForRefund,
  AdminShell,
  AdminIcon,
  AdminEmpty,
  AdminBadge,
  adminMoney,
  adminDate,
  adminViews,
  type AdminView,
} from "./AdminShell";
import "./admin.css";
import { useHumanVerification } from "../../../web/src/commerce/useHumanVerification";
import { PagedMore } from "../../../web/src/commerce/PagedMore";
import { useEffect, useRef, useState } from "react";
import { api, id, type DTO, type Page } from "../../../web/src/cloud/api";
export function CommerceConsole(): React.JSX.Element {
  const human = useHumanVerification();
  const [view, setView] = useState<AdminView>(() => {
    const hash = location.hash.slice(1);
    return adminViews.some((v) => v.id === hash)
      ? (hash as AdminView)
      : "overview";
  });
  const [loading, setLoading] = useState(false),
    [loaded, setLoaded] = useState(false),
    [query, setQuery] = useState(""),
    [orderState, setOrderState] = useState("");
  const requestVersion = useRef(0);
  const navigate = (next: AdminView) => {
    setView(next);
    history.replaceState(null, "", "#" + next);
  };
  const [orders, setOrders] = useState<DTO<"Order">[]>([]),
    [refunds, setRefunds] = useState<DTO<"Refund">[]>([]),
    [audits, setAudits] = useState<DTO<"AuditEvent">[]>([]),
    [report, setReport] = useState<DTO<"ReconcileResult">>(),
    [next, setNext] = useState<Record<string, string | null>>({}),
    [skus, setSkus] = useState<DTO<"Sku">[]>([]),
    [batches, setBatches] = useState<DTO<"RedemptionBatch">[]>([]),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [reason, setReason] = useState(""),
    [ticket, setTicket] = useState(""),
    [workspace, setWorkspace] = useState(""),
    [source, setSource] = useState(""),
    [sourceOptions, setSourceOptions] = useState<DTO<"OrderSourceGrants">>(),
    [amount, setAmount] = useState(1),
    [kind, setKind] = useState<"credits" | "membership">("credits"),
    [sku, setSku] = useState(""),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  async function refresh() {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const [o, b, s, r, a] = await Promise.all([
        api<Page<DTO<"Order">>>("/admin/orders"),
        api<Page<DTO<"RedemptionBatch">>>("/admin/redemption-batches"),
        api<Page<DTO<"Sku">>>("/skus?platform=web"),
        api<Page<DTO<"Refund">>>("/admin/refunds"),
        api<Page<DTO<"AuditEvent">>>("/admin/audit-events"),
      ]);
      if (version !== requestVersion.current) return;
      setLoaded(true);
      setNext({
        orders: o.nextCursor,
        batches: b.nextCursor,
        refunds: r.nextCursor,
        audits: a.nextCursor,
      });
      setError("");
      setRefunds(r.items);
      setAudits(a.items);
      setOrders(o.items);
      setBatches(b.items);
      setSkus(s.items);
    } catch (e) {
      if (version === requestVersion.current) setError(String(e));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function act(
    fn: (headers: Record<string, string>) => Promise<unknown>,
    verify = true,
  ) {
    setError("");
    setStatus("");
    try {
      const headers: Record<string, string> = verify
        ? { "X-Reauthentication-Proof": await human.verify("admin_operations") }
        : {};
      await fn(headers);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <AdminShell
      view={view}
      onView={navigate}
      loading={loading}
      onRefresh={() => void refresh()}
    >
      {error && (
        <div className="admin-connection" role="alert">
          <div className="admin-connection-icon">!</div>
          <div>
            <strong>
              {error.includes("FORBIDDEN")
                ? "当前账号没有商业运营权限"
                : error.includes("UNAUTHORIZED")
                  ? "请先登录管理账号"
                  : "服务尚未连接"}
            </strong>
            <p>
              {error.includes("FORBIDDEN")
                ? "请使用具有财务权限的账号访问。"
                : error.includes("UNAUTHORIZED")
                  ? "请返回编辑器完成登录，管理权限由服务器核验。"
                  : "连接服务器后即可读取真实记录。已有本地编辑功能仍可使用。"}
            </p>
            <code>{error.replace(/^Error: /, "")}</code>
          </div>
        </div>
      )}
      {status && (
        <p className="admin-success" role="status">
          <AdminIcon name="check" />
          {status}
        </p>
      )}
      {human.dialog}
      {view === "overview" && (
        <>
          <div className="admin-section-caption">
            <div>
              <h2>运营概况</h2>
              <p>当前已加载记录的摘要，非全站累计统计。</p>
            </div>
            <span className="admin-live-label">
              <i className={loaded && !error ? "connected" : ""} />
              {loading
                ? "读取中"
                : loaded && !error
                  ? "已连接数据源"
                  : "等待连接"}
            </span>
          </div>
          <div className="admin-metrics">
            {[
              {
                label: "已加载订单",
                value: orders.length,
                icon: "orders",
                hint: "查看订单与履约状态",
                target: "orders",
              },
              {
                label: "待复核退款",
                value: refunds.filter((r) => r.state === "manual_review")
                  .length,
                icon: "refunds",
                hint: "来自已加载退款记录",
                target: "refunds",
              },
              {
                label: "已加载兑换批次",
                value: batches.length,
                icon: "redemption",
                hint: "管理兑换码与有效状态",
                target: "redemption",
              },
              {
                label: "已发布商品",
                value: skus.length,
                icon: "adjustments",
                hint: "实际已发布的商品版本",
                target: "redemption",
              },
            ].map((m) => (
              <button
                className="admin-metric"
                key={m.label}
                onClick={() => navigate(m.target as AdminView)}
              >
                <span className="admin-metric-top">
                  {m.label}
                  <AdminIcon name={m.icon} />
                </span>
                <output aria-label={m.label}>
                  {loaded && !error ? m.value : "—"}
                </output>
                <span className="admin-metric-hint">
                  {m.hint}
                  <AdminIcon name="arrow" />
                </span>
              </button>
            ))}
          </div>
          <div className="admin-overview-grid">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>工作待办</h2>
                  <p>按事项进入对应模块，核对后再操作。</p>
                </div>
                <span className="admin-small-label">WORKFLOW</span>
              </div>
              {[
                {
                  title: "处理退款复核",
                  detail: "核对退款原因、订单与渠道状态",
                  target: "refunds",
                  icon: "refunds",
                },
                {
                  title: "调整会员与点数",
                  detail: "先选订单，再选择可调整的权益来源",
                  target: "orders",
                  icon: "adjustments",
                },
                {
                  title: "核对渠道差异",
                  detail: "按业务日期检查渠道与本地记录",
                  target: "reconciliation",
                  icon: "reconciliation",
                },
              ].map((t) => (
                <button
                  className="admin-shortcut"
                  key={t.title}
                  onClick={() => navigate(t.target as AdminView)}
                >
                  <span className="admin-shortcut-icon">
                    <AdminIcon name={t.icon} />
                  </span>
                  <span>
                    <strong>{t.title}</strong>
                    <small>{t.detail}</small>
                  </span>
                  <AdminIcon name="arrow" />
                </button>
              ))}
            </section>
            <section className="admin-panel admin-activity">
              <div className="admin-panel-heading">
                <div>
                  <h2>操作须知</h2>
                  <p>每一步都有据可查。</p>
                </div>
                <AdminIcon name="check" />
              </div>
              <ol>
                <li>
                  <span>01</span>
                  <div>
                    <strong>从真实来源开始</strong>
                    <p>权益调整关联已履约订单，不手填内部授权编号。</p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>先核对，再确认</strong>
                    <p>记录原因与工单，敏感操作需独立身份验证。</p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>保留财务事实</strong>
                    <p>退款与对账不自动补发权益，渠道未知时等待确认。</p>
                  </div>
                </li>
              </ol>
            </section>
          </div>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <h2>最近加载的订单</h2>
                <p>完整记录请进入订单管理继续加载。</p>
              </div>
              <button onClick={() => navigate("orders")}>
                查看订单 <AdminIcon name="arrow" />
              </button>
            </div>
            {orders.length ? (
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>订单</th>
                      <th>金额</th>
                      <th>支付状态</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.slice(0, 5).map((o) => (
                      <tr key={o.id}>
                        <td>
                          <code title={o.id}>{o.id}</code>
                        </td>
                        <td className="admin-amount">
                          {adminMoney(o.amountFen)}
                        </td>
                        <td>
                          <AdminBadge value={o.state} />
                        </td>
                        <td>{adminDate(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <AdminEmpty
                title={loaded ? "暂无订单记录" : "等待连接数据源"}
                detail={
                  loaded
                    ? "第一笔订单产生后，会显示在这里。"
                    : "连接服务器并登录后，显示真实订单。"
                }
              />
            )}
          </section>
        </>
      )}
      <section
        hidden={
          !(
            [
              "refunds",
              "redemption",
              "adjustments",
              "reconciliation",
            ] as string[]
          ).includes(view)
        }
        className="admin-panel admin-review-context"
      >
        <div>
          <h2>审核依据</h2>
          <p>填写本次操作的原因与工单编号。</p>
          {human.notice}
        </div>
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
        </div>
      </section>
      <section hidden={view !== "redemption"} className="admin-panel">
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
      <section hidden={view !== "orders"} className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>订单查询</h2>
            <p>支付与履约状态分别展示，渠道确认结果以服务器为准。</p>
          </div>
          <span className="admin-count">已加载 {orders.length} 条</span>
        </div>
        <div className="admin-filter-bar">
          <label className="admin-search">
            <AdminIcon name="search" />
            <span className="admin-sr-only">搜索已加载订单</span>
            <input
              aria-label="搜索已加载订单"
              placeholder="搜索订单号或工作区…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="admin-status-filter">
            支付状态
            <select
              value={orderState}
              onChange={(e) => setOrderState(e.target.value)}
            >
              <option value="">全部状态</option>
              <option value="paid">已支付</option>
              <option value="pending">待支付</option>
              <option value="closed">已关闭</option>
              <option value="refunded">已退款</option>
            </select>
          </label>
          <span>仅筛选已加载记录</span>
        </div>
        <div className="admin-table-wrap">
          <table aria-label="订单列表">
            <thead>
              <tr>
                <th>订单 / 工作区</th>
                <th>订单金额</th>
                <th>支付状态</th>
                <th>履约状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders
                .filter(
                  (o) =>
                    (!orderState || o.state === orderState) &&
                    (!query ||
                      `${o.id} ${o.workspaceId}`
                        .toLowerCase()
                        .includes(query.toLowerCase())),
                )
                .map((o) => (
                  <tr key={o.id}>
                    <td>
                      <code title={o.id}>{o.id}</code>
                      <small title={o.workspaceId}>{o.workspaceId}</small>
                    </td>
                    <td className="admin-amount">{adminMoney(o.amountFen)}</td>
                    <td>
                      <AdminBadge value={o.state} />
                    </td>
                    <td>
                      <AdminBadge value={o.fulfillmentState} />
                    </td>
                    <td>{adminDate(o.createdAt)}</td>
                    <td>
                      {o.fulfillmentState === "fulfilled" ? (
                        <button
                          className="admin-text-button"
                          onClick={async () => {
                            try {
                              const grants = await api<
                                DTO<"OrderSourceGrants">
                              >(`/admin/orders/${id(o.id)}/source-grants`);
                              setSourceOptions(grants);
                              setWorkspace(grants.workspaceId);
                              setSource("");
                              setStatus(`已加载订单 ${o.id} 的来源授权`);
                              navigate("adjustments");
                            } catch (e) {
                              setError(String(e));
                            }
                          }}
                        >
                          选择此订单的调整来源
                        </button>
                      ) : (
                        <span className="muted">待订单履约</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!orders.length && <AdminEmpty title="暂无订单记录" />}
        {orders.length > 0 &&
          !orders.some(
            (o) =>
              (!orderState || o.state === orderState) &&
              (!query ||
                `${o.id} ${o.workspaceId}`
                  .toLowerCase()
                  .includes(query.toLowerCase())),
          ) && (
            <AdminEmpty
              title="没有匹配的订单"
              detail="调整搜索条件，或继续加载更多记录。"
            />
          )}
        <div className="admin-pagination">
          <span>
            已加载 {orders.length} 条
            {next.orders ? " · 仍有更多记录" : " · 已到列表末尾"}
          </span>
          <PagedMore<DTO<"Order">>
            path="/admin/orders"
            cursor={next.orders}
            label="加载更多订单查询"
            onPage={(p) => {
              setOrders((v) => [...v, ...p.items]);
              setNext((v) => ({ ...v, orders: p.nextCursor }));
            }}
          />
        </div>
      </section>
      <section hidden={view !== "refunds"} className="admin-panel">
        <h2>退款复核</h2>
        <PagedMore<DTO<"Refund">>
          path="/admin/refunds"
          cursor={next.refunds}
          label="加载更多退款复核"
          onPage={(p) => {
            setRefunds((v) => [...v, ...p.items]);
            setNext((v) => ({ ...v, refunds: p.nextCursor }));
          }}
        />
        {!refunds.length && (
          <AdminEmpty
            title="暂无退款记录"
            detail="已申请的退款会显示在此处，需复核的记录可在此处理。"
          />
        )}
        {refunds.map((r) => (
          <article className="order-row" key={r.id}>
            <div>
              <code>{r.id}</code>
              <p>
                订单 {r.orderId} · {adminMoney(r.amountFen)} ·{" "}
                {adminLabelForRefund(r.state)}
              </p>
              <small>{r.reasonCode}</small>
            </div>
            {r.state === "manual_review" && (
              <div>
                {(["approve", "reject"] as const).map((decision) => (
                  <button
                    key={decision}
                    disabled={
                      !reason || !ticket || !human.available || human.busy
                    }
                    onClick={() =>
                      void act(async (headers) => {
                        const result = await api<DTO<"Refund">>(
                          `/admin/refunds/${id(r.id)}/decision`,
                          "POST",
                          {
                            decision,
                            expectedRevision: r.revision,
                            reason: `工单 ${ticket}：${reason}`.slice(0, 500),
                          },
                          headers,
                        );
                        setStatus(
                          `退款 ${result.id} · ${result.state}（渠道确认后完成）`,
                        );
                      })
                    }
                  >
                    {decision === "approve" ? "批准退款" : "拒绝退款"}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>
      <section hidden={view !== "redemption"} className="admin-panel">
        <h2>兑换批次</h2>
        <PagedMore<DTO<"RedemptionBatch">>
          path="/admin/redemption-batches"
          cursor={next.batches}
          label="加载更多兑换批次"
          onPage={(p) => {
            setBatches((v) => [...v, ...p.items]);
            setNext((v) => ({ ...v, batches: p.nextCursor }));
          }}
        />
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
          disabled={!sku || !reason || !human.available || human.busy}
          onClick={() =>
            void act(async (headers) => {
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
            <code>{b.id}</code> · <AdminBadge value={b.state} />{" "}
            <button
              disabled={
                !reason ||
                !human.available ||
                human.busy ||
                b.state !== "active"
              }
              onClick={() =>
                void act((headers) =>
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
      <section hidden={view !== "adjustments"} className="admin-panel">
        {!sourceOptions && (
          <div className="admin-inline-help">
            请先从已履约订单选择权益来源。
            <button onClick={() => navigate("orders")}>前往订单管理</button>
          </div>
        )}
        <h2>额度 / 会员调整</h2>
        <div className="form-grid">
          <label>
            工作区
            <input
              value={workspace}
              onChange={(e) => {
                setWorkspace(e.target.value);
                setSource("");
              }}
            />
          </label>
          <label>
            来源授权
            <select
              aria-label="来源授权"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                const grant = sourceOptions?.items.find(
                  (g) => g.id === e.target.value,
                );
                if (grant) setKind(grant.kind);
              }}
            >
              <option value="">先从订单查询选择来源</option>
              {sourceOptions?.workspaceId === workspace &&
                sourceOptions.items.map((g) => (
                  <option key={g.id} value={g.id} disabled={!g.eligible}>
                    {g.kind === "credits"
                      ? `点数 · 可用 ${g.availableCredits} · 预占 ${g.reservedCredits}`
                      : "会员"}{" "}
                    · {g.id} · {g.eligible ? "可调整" : "不可调整"} · 到期{" "}
                    {g.endsAt}
                  </option>
                ))}
            </select>
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
            !workspace ||
            !source ||
            !reason ||
            !ticket ||
            !human.available ||
            human.busy ||
            !amount
          }
          onClick={() =>
            void act(async (headers) => {
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
      <section hidden={view !== "reconciliation"} className="admin-panel">
        <h2>渠道差异复核</h2>
        <PagedMore<DTO<"AuditEvent">>
          path="/admin/audit-events"
          cursor={next.audits}
          label="加载更多渠道差异复核"
          onPage={(p) => {
            setAudits((v) => [...v, ...p.items]);
            setNext((v) => ({ ...v, audits: p.nextCursor }));
          }}
        />
        <label>
          上海业务日期
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button
          disabled={!reason || !human.available || human.busy}
          onClick={() =>
            void act(async (headers) => {
              const result = await api<DTO<"ReconcileResult">>(
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
              setReport(result);
              setStatus(
                `对账记录 ${result.id}，差异需人工复核，不重复补发权益。`,
              );
            })
          }
        >
          启动对账
        </button>
        {audits
          .filter((a) => a.action === "commerce.reconciliation")
          .map((a) => (
            <p key={a.id}>
              <code>{a.targetId}</code> · {a.reason}
              <button
                onClick={() =>
                  void act(
                    async (headers) =>
                      setReport(
                        await api<DTO<"ReconcileResult">>(
                          `/admin/operations/reconciliations/${id(a.targetId)}`,
                        ),
                      ),
                    false,
                  )
                }
              >
                查看对账差异
              </button>
            </p>
          ))}
        {report && (
          <div>
            <h3>
              已核对 {report.scannedCount} 笔 · 差异 {report.discrepancyCount}{" "}
              笔
            </h3>
            {report.reviews?.map((r) => (
              <article className="order-row" key={r.id}>
                <code>{r.id}</code>
                <p>
                  订单 {r.orderId} · 渠道实收 {r.paidFen} 分 / 已退{" "}
                  {r.refundedFen} 分
                </p>
                <p>
                  本地 {r.localState} / {r.localFulfillmentState}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}
