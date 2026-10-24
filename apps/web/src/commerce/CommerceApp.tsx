import { useEffect, useState } from "react";
import { api, setSession, type DTO } from "../cloud/api";
import { MembershipPage } from "./MembershipPage";
import { OrderPage } from "./OrderPage";
import { TaskCenter } from "../jobs/TaskCenter";
import { CommerceConsole } from "../../../admin/src/commerce/CommerceConsole";
import "./commerce.css";
export function CommerceApp() {
  const [route, setRoute] = useState(location.hash.slice(1) || "membership"),
    [error, setError] = useState("");
  const query = new URLSearchParams(location.search),
    workspaceId = query.get("workspace") ?? "";
  useEffect(() => {
    const change = () => setRoute(location.hash.slice(1) || "membership");
    window.addEventListener("hashchange", change);
    api<DTO<"WebSession">>("/auth/session")
      .then(setSession)
      .catch((e) => setError(String(e)));
    return () => window.removeEventListener("hashchange", change);
  }, []);
  if (query.has("admin")) return <CommerceConsole />;
  return (
    <div className="commerce-shell">
      <aside className="commerce-nav">
        <a className="commerce-brand" href="./index.html">
          拾光<span>创作空间</span>
        </a>
        <nav>
          {[
            ["membership", "会员与点数"],
            ["orders", "订单与兑换"],
            ["tasks", "任务中心"],
          ].map(([r, label]) => (
            <a
              key={r}
              href={"#" + r}
              aria-current={route.startsWith(r) ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        <a className="back-editor" href="./index.html">
          ← 返回编辑器
        </a>
      </aside>
      <main>
        {error && <p role="alert">请登录后使用工作区服务：{error}</p>}
        {workspaceId ? (
          route.startsWith("orders") ? (
            <OrderPage workspaceId={workspaceId} />
          ) : route === "tasks" ? (
            <TaskCenter workspaceId={workspaceId} />
          ) : (
            <MembershipPage workspaceId={workspaceId} />
          )
        ) : (
          <section className="commerce-page">
            <h1>选择工作区</h1>
            <p>请返回编辑器，登录并选择工作区后打开会员与任务。</p>
          </section>
        )}
      </main>
    </div>
  );
}
