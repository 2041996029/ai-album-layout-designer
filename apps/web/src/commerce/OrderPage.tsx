import { useHumanVerification } from "./useHumanVerification";
import { PagedMore } from "./PagedMore";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { api, id, ifMatch, type DTO, type Page } from "../cloud/api";
export const orderLabel = (o: DTO<"Order">) =>
  o.state === "pending"
    ? "待确认"
    : o.fulfillmentState === "manual_review"
      ? "待人工复核"
      : o.state === "paid" && o.fulfillmentState === "fulfilled"
        ? "已支付 · 权益已发放"
        : o.state === "paid"
          ? "已支付 · 待履约"
          : ((
              {
                closed: "已关闭",
                refund_pending: "退款处理中",
                partially_refunded: "部分退款",
                refunded: "已退款",
              } as Record<string, string>
            )[o.state] ?? "待确认");
export function OrderPage({
  workspaceId,
}: {
  workspaceId: string;
}): React.JSX.Element {
  const human = useHumanVerification();
  const [orders, setOrders] = useState<DTO<"Order">[]>([]),
    [nextOrders, setNextOrders] = useState<string | null>(null),
    [nextRedemptions, setNextRedemptions] = useState<string | null>(null),
    [redemptions, setRedemptions] = useState<DTO<"Redemption">[]>([]),
    [error, setError] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [refunds, setRefunds] = useState<DTO<"Refund">[]>([]),
    [nextRefunds, setNextRefunds] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [qr, setQr] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [o, r, f] = await Promise.all([
        api<Page<DTO<"Order">>>(`/workspaces/${id(workspaceId)}/orders`),
        api<Page<DTO<"Redemption">>>(
          `/workspaces/${id(workspaceId)}/redemptions`,
        ),
        api<Page<DTO<"Refund">>>(`/workspaces/${id(workspaceId)}/refunds`),
      ]);
      setRefunds(f.items);
      setNextRefunds(f.nextCursor);
      setNextOrders(o.nextCursor);
      setNextRedemptions(r.nextCursor);
      setOrders(o.items);
      setRedemptions(r.items);
    } catch (e) {
      setError(String(e));
    }
  }, [workspaceId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="commerce-page">
      <div className="eyebrow">PURCHASE HISTORY</div>
      <h1>订单与兑换</h1>
      <p className="commerce-lead">每一笔购买，都有明确的服务端记录。</p>
      <p className="muted">
        工作区 <code>{workspaceId}</code> · 浏览器支付完成后仍需等待确认
      </p>
      <button onClick={() => void refresh()}>刷新记录</button>
      {error && <p role="alert">{error}</p>}
      <div className="commerce-table">
        {!orders.length && (
          <p className="empty-state">
            还没有订单。发布商品后，可从会员页购买。
          </p>
        )}
        {orders.map((o) => (
          <article className="order-row" key={o.id}>
            <div>
              <code>{o.id}</code>
              <h3>{orderLabel(o)}</h3>
              <small>
                {new Date(o.createdAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </small>
            </div>
            <strong>¥{(o.amountFen / 100).toFixed(2)}</strong>
            <div>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const next = await api<DTO<"Order">>(`/orders/${id(o.id)}`);
                    setOrders((v) =>
                      v.map((x) => (x.id === next.id ? next : x)),
                    );
                  })
                }
              >
                查询服务端
              </button>
              {o.state === "pending" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const launch = await api<DTO<"PaymentLaunch">>(
                        `/orders/${id(o.id)}/payment-attempts`,
                        "POST",
                        { clientPlatform: "web" },
                      );
                      if (launch.launch.kind !== "qr")
                        throw new Error("该渠道不支持网页扫码支付");
                      setQr(await QRCode.toDataURL(launch.launch.qrPayload));
                    })
                  }
                >
                  前往支付
                </button>
              )}
              {o.state === "pending" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      api(
                        `/orders/${id(o.id)}/close`,
                        "POST",
                        undefined,
                        ifMatch(o.revision),
                      ),
                    )
                  }
                >
                  关闭订单
                </button>
              )}
              {o.state === "paid" && (
                <button
                  disabled={
                    busy || !reason.trim() || !human.available || human.busy
                  }
                  onClick={() =>
                    void action(async () => {
                      const proof = await human.verify("billing_refund");
                      await api<DTO<"Refund">>(
                        `/orders/${id(o.id)}/refunds`,
                        "POST",
                        {
                          amountFen: o.amountFen,
                          reason,
                          expectedOrderRevision: o.revision,
                        },
                        {
                          ...ifMatch(o.revision),
                          "X-Reauthentication-Proof": proof,
                        },
                      );
                    })
                  }
                >
                  申请退款
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {qr && (
        <aside className="commerce-note">
          <h2>微信扫码支付</h2>
          <img src={qr} width={220} height={220} alt="微信支付二维码" />
          <p>扫码后请查询服务端确认结果，权益发放以服务端记录为准。</p>
        </aside>
      )}
      <PagedMore<DTO<"Order">>
        path={`/workspaces/${id(workspaceId)}/orders`}
        cursor={nextOrders}
        label="加载更多订单"
        onPage={(p) => {
          setOrders((v) => [...v, ...p.items]);
          setNextOrders(p.nextCursor);
        }}
      />
      <label>
        退款原因
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="填写退款申请原因"
          maxLength={500}
        />
      </label>
      {human.notice}
      {human.dialog}
      <section className="commerce-note">
        <h2>退款记录</h2>
        {!refunds.length && <p>暂无退款记录。</p>}
        {refunds.map((r) => (
          <article className="order-row" key={r.id}>
            <div>
              <code>{r.id}</code>
              <p>
                订单 {r.orderId} · ¥{(r.amountFen / 100).toFixed(2)}
              </p>
              <p>
                {
                  (
                    {
                      requested: "待退款审核",
                      submitted: "渠道处理中",
                      unknown: "确认中",
                      succeeded: "退款成功",
                      failed: "退款失败",
                      manual_review: "待人工复核",
                    } as Record<string, string>
                  )[r.state]
                }
              </p>
              <small>{r.reasonCode ?? r.reason}</small>
            </div>
            <button
              onClick={async () => {
                try {
                  const latest = await api<DTO<"Refund">>(
                    `/refunds/${id(r.id)}`,
                  );
                  setRefunds((v) =>
                    v.map((x) => (x.id === latest.id ? latest : x)),
                  );
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              刷新退款
            </button>
          </article>
        ))}
        <PagedMore<DTO<"Refund">>
          path={`/workspaces/${id(workspaceId)}/refunds`}
          cursor={nextRefunds}
          label="加载更多退款"
          onPage={(p) => {
            setRefunds((v) => [...v, ...p.items]);
            setNextRefunds(p.nextCursor);
          }}
        />
      </section>
      <div className="commerce-note">
        <h2>兑换权益</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await api("/redemptions", "POST", { workspaceId, code });
              setCode("");
            });
          }}
        >
          <label>
            兑换码
            <input
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          <button disabled={busy || !code.trim()}>兑换</button>
        </form>
        <PagedMore<DTO<"Redemption">>
          path={`/workspaces/${id(workspaceId)}/redemptions`}
          cursor={nextRedemptions}
          label="加载更多兑换"
          onPage={(p) => {
            setRedemptions((v) => [...v, ...p.items]);
            setNextRedemptions(p.nextCursor);
          }}
        />
        {redemptions.map((r) => (
          <p key={r.id}>
            <code>{r.id}</code> · 已兑换 {r.creditGrant} 点
          </p>
        ))}
      </div>
    </section>
  );
}
