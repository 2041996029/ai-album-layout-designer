import type { ReactNode } from "react";
export const adminViews = [
  {
    id: "aiFinance",
    label: "AI 预算与定价",
    icon: "reconciliation",
    description: "管理供应商采购额度与不可变的点数测算规则。",
  },
  {
    id: "content",
    label: "内容与授权",
    icon: "orders",
    description: "登记授权范围，保留不可变的历史版本。",
  },
  {
    id: "overview",
    label: "运营总览",
    icon: "overview",
    description: "从这里开始，处理今天的运营事项。",
  },
  {
    id: "orders",
    label: "订单管理",
    icon: "orders",
    description: "查询订单状态，并从已履约订单进入权益调整。",
  },
  {
    id: "refunds",
    label: "退款复核",
    icon: "refunds",
    description: "核对退款依据，完成必要的身份验证后处理。",
  },
  {
    id: "redemption",
    label: "兑换管理",
    icon: "redemption",
    description: "管理兑换批次，原始兑换码仅在首次创建时提供。",
  },
  {
    id: "adjustments",
    label: "权益调整",
    icon: "adjustments",
    description: "每一次调整都关联原始授权、原因与工单。",
  },
  {
    id: "reconciliation",
    label: "渠道对账",
    icon: "reconciliation",
    description: "核对渠道与本地记录，保留每一笔差异的处理依据。",
  },
] as const;
export type AdminView = (typeof adminViews)[number]["id"];
export function AdminIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    orders: "M7 3h10v4H7z M5 5H3v16h18V5h-2 M7 12h10 M7 16h6",
    refunds: "M3 10a9 9 0 1 1 2 8 M3 3v7h7 M12 7v5l3 2",
    redemption: "M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4z M9 5v14",
    adjustments: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
    reconciliation: "M4 3h12l4 4v14H4z M8 11h8 M8 15h5 M14 3v5h6",
    arrow: "M5 12h14 M13 6l6 6-6 6",
    refresh: "M20 7V3l-4 4 M20 7a8 8 0 1 0 0 10",
    check: "M5 12l4 4L19 6",
    empty: "M4 8l3-5h10l3 5v12H4z M4 9h5l1 3h4l1-3h5",
    search: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M15 15l6 6",
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.overview} />
    </svg>
  );
}
export function AdminShell({
  view,
  onView,
  loading,
  onRefresh,
  children,
}: {
  view: AdminView;
  onView: (v: AdminView) => void;
  loading: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const current = adminViews.find((v) => v.id === view)!;
  return (
    <div className="admin-shell admin-console">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="../">
          <span className="admin-brand-mark">拾</span>
          <span>
            拾光<span className="admin-brand-caption">相册运营工作台</span>
          </span>
        </a>
        <div className="admin-nav-label">
          工作空间 <span>WORKSPACE</span>
        </div>
        <nav aria-label="运营模块">
          {adminViews.map((item) => (
            <button
              key={item.id}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => onView(item.id)}
            >
              <AdminIcon name={item.icon} />
              <span>{item.label}</span>
              {view === item.id && <i />}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <span className="admin-team-avatar">S</span>
          <div>
            商业运营<span>受权限保护的管理空间</span>
          </div>
        </div>
        <a className="admin-back" href="../">
          返回相册编辑器 <AdminIcon name="arrow" />
        </a>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <div>
            <span className="admin-breadcrumb">运营工作台</span>
            <span className="admin-slash">/</span>
            <span>{current.label}</span>
          </div>
          <div className="admin-topbar-right">
            <span className="admin-role-tag">ADMIN CONSOLE</span>
            <span className="admin-avatar" aria-label="管理空间">
              管
            </span>
          </div>
        </header>
        <main className="commerce-page admin-main">
          <div className="admin-page-heading">
            <div>
              <div className="eyebrow">SHIGUANG · OPERATIONS</div>
              <h1>商业运营</h1>
              <p>{current.description}</p>
            </div>
            <button
              className="admin-refresh"
              disabled={loading}
              onClick={onRefresh}
            >
              <AdminIcon name="refresh" />
              {loading ? "正在读取…" : "刷新数据"}
            </button>
          </div>
          {children}
          <footer className="admin-page-footer">
            <span>拾光 · 让每一次创作，都被妥善珍藏。</span>
            <span>财务操作留痕 · 权限实时校验</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
export function AdminEmpty({
  title,
  detail = "记录会在产生后显示在这里。",
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="admin-empty">
      <span>
        <AdminIcon name="empty" />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
const labels: Record<string, string> = {
  paid: "已支付",
  pending: "待支付",
  closed: "已关闭",
  expired: "已过期",
  refunded: "已退款",
  partially_refunded: "部分退款",
  fulfilled: "已履约",
  unfulfilled: "未履约",
  manual_review: "待人工复核",
  active: "使用中",
  disabled: "已停用",
  requested: "已申请",
  submitted: "已提交",
  unknown: "待渠道确认",
  succeeded: "已完成",
  failed: "处理失败",
  rejected: "已拒绝",
  approved: "已批准",
  wechat_pay: "微信支付",
  alipay: "支付宝",
  mini_virtual: "小程序虚拟支付",
};
export function adminLabel(value: string) {
  return labels[value] ?? value;
}
export function AdminBadge({ value }: { value: string }) {
  return (
    <span
      className={`admin-badge ${["paid", "fulfilled", "active", "succeeded"].includes(value) ? "positive" : ["failed", "rejected", "disabled"].includes(value) ? "negative" : "neutral"}`}
    >
      {adminLabel(value)}
    </span>
  );
}
export function adminMoney(fen: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(fen / 100);
}
export function adminDate(date: string) {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(value);
}
