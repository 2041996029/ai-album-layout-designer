import { useEffect, useRef, useState } from "react";
import {
  api,
  id,
  ifMatch,
  type DTO,
  type Page,
} from "../../../web/src/cloud/api";
import { useHumanVerification } from "../../../web/src/commerce/useHumanVerification";
import { PagedMore } from "../../../web/src/commerce/PagedMore";
import { AdminShell, AdminEmpty, type AdminView } from "./AdminShell";
import { parseYuan, formatYuan } from "./ai-money";
export function AiFinanceConsole({
  onView,
}: {
  onView: (view: AdminView) => void;
}) {
  const human = useHumanVerification(),
    epoch = useRef(0),
    operation = useRef({ hash: "", key: "", proof: "" });
  const [budgets, setBudgets] = useState<DTO<"AiBudget">[]>([]),
    [rules, setRules] = useState<DTO<"AiCostRule">[]>([]),
    [budgetNext, setBudgetNext] = useState<string | null>(null),
    [ruleNext, setRuleNext] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [selected, setSelected] = useState<DTO<"AiBudget"> | null>(null),
    [daily, setDaily] = useState(""),
    [accountState, setAccountState] = useState<"active" | "stopped">("active"),
    [budgetReason, setBudgetReason] = useState("");
  const [name, setName] = useState(""),
    [points, setPoints] = useState(""),
    [estimated, setEstimated] = useState(""),
    [maximum, setMaximum] = useState(""),
    [priceReason, setPriceReason] = useState("");
  async function refresh() {
    const current = ++epoch.current;
    setLoading(true);
    setError("");
    try {
      const [b, p] = await Promise.all([
        api<Page<DTO<"AiBudget">>>("/admin/ai/budgets?limit=20"),
        api<Page<DTO<"AiCostRule">>>("/admin/ai/cost-rules?limit=20"),
      ]);
      if (current === epoch.current) {
        setBudgets(b.items);
        setBudgetNext(b.nextCursor);
        setRules(p.items);
        setRuleNext(p.nextCursor);
      }
    } catch {
      if (current === epoch.current)
        setError("无法读取 AI 财务配置。请确认已登录并拥有财务权限。");
    } finally {
      if (current === epoch.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      epoch.current++;
    };
  }, []);
  async function verified<T>(
    hash: string,
    request: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    if (operation.current.hash !== hash)
      operation.current = { hash, key: crypto.randomUUID(), proof: "" };
    if (!operation.current.proof)
      operation.current.proof = await human.verify("admin_operations");
    try {
      return await request({
        "Idempotency-Key": operation.current.key,
        "X-Reauthentication-Proof": operation.current.proof,
      });
    } catch (e) {
      if (String(e).includes("REAUTH_")) operation.current.proof = "";
      throw e;
    }
  }
  async function saveBudget(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const input: DTO<"AiBudgetUpdate"> = {
        dailyBudgetFen: parseYuan(daily),
        state: accountState,
        reason: budgetReason.trim(),
      };
      const result = await verified(
        JSON.stringify({ id: selected.id, input, revision: selected.revision }),
        (headers) =>
          api<DTO<"AiBudget">>(
            `/admin/ai/budgets/${id(selected.id)}`,
            "PUT",
            input,
            { ...headers, ...ifMatch(selected.revision) },
          ),
      );
      setStatus(
        `已更新 ${result.providerName} 的每日预算。已有预占与历史支出保持不变。`,
      );
      setSelected(null);
      operation.current = { hash: "", key: "", proof: "" };
      await refresh();
    } catch (e) {
      setError(
        String(e).includes("REVISION_CONFLICT")
          ? "预算已被其他管理员修改，请刷新后重新确认。"
          : String(e).includes("金额")
            ? String(e)
            : "保存未确认，可重试同一操作；如需重新验证，系统会提示。",
      );
    } finally {
      setSaving(false);
    }
  }
  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      if (!/^[0-9]+$/.test(points) || !Number.isSafeInteger(Number(points)))
        throw Error("点数须为非负整数。");
      const input: DTO<"AiCostRuleCreate"> = {
        name: name.trim(),
        creditsPerImage: Number(points),
        estimatedProviderCostFen: parseYuan(estimated),
        maxCostFen: parseYuan(maximum),
        reason: priceReason.trim(),
      };
      if (input.maxCostFen < input.estimatedProviderCostFen)
        throw Error("成本上限不能低于预估成本。");
      const result = await verified(
        JSON.stringify({ kind: "pricing", input }),
        (headers) =>
          api<DTO<"AiCostRule">>(
            "/admin/ai/cost-rules",
            "POST",
            input,
            headers,
          ),
      );
      setStatus(
        `已登记「${result.name}」定价版本 ${result.version}。发布新的报价配置后生效。`,
      );
      operation.current = { hash: "", key: "", proof: "" };
      setName("");
      setPoints("");
      setEstimated("");
      setMaximum("");
      setPriceReason("");
      await refresh();
    } catch (e) {
      setError(
        /金额|点数|成本/.test(String(e))
          ? String(e)
          : "登记未确认，可重试同一操作；现有报价不会自动改变。",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <AdminShell
      view="aiFinance"
      onView={onView}
      loading={loading}
      onRefresh={() => void refresh()}
    >
      {error && (
        <p role="alert" className="admin-notice">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="admin-notice">
          {status}
        </p>
      )}
      {human.dialog}
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>AI 采购预算</h2>
            <p>
              按供应商结算账户归集，预算日为北京时间。同一账户的多条连接共享总额度。
            </p>
          </div>
        </div>
        {human.notice}
        {!budgets.length && !loading ? (
          <AdminEmpty
            title="暂无供应商采购账户"
            detail="平台管理员发布供应商连接后，账户会显示在这里。新账户默认零额度。"
          />
        ) : (
          <div className="license-grid">
            {budgets.map((b) => {
              const total = b.reservedFen + b.spentFen,
                percentage = b.dailyBudgetFen
                  ? Math.min(100, (total / b.dailyBudgetFen) * 100)
                  : total
                    ? 100
                    : 0;
              return (
                <article key={b.id} className="license-card">
                  <h3>{b.providerName}</h3>
                  <p className="license-source">
                    结算账户 {b.accountBillingId}
                  </p>
                  <strong>¥{formatYuan(b.dailyBudgetFen)} / 日</strong>
                  <progress
                    aria-label={`${b.providerName} 预算使用比例`}
                    max={100}
                    value={percentage}
                  />
                  <dl>
                    <div>
                      <dt>已预占</dt>
                      <dd>¥{formatYuan(b.reservedFen)}</dd>
                    </div>
                    <div>
                      <dt>已记账成本</dt>
                      <dd>¥{formatYuan(b.spentFen)}</dd>
                    </div>
                    <div>
                      <dt>预算日</dt>
                      <dd>{b.budgetDate}</dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>
                        {b.state === "active"
                          ? b.dailyBudgetFen
                            ? "允许新任务"
                            : "零额度"
                          : b.state === "stopped"
                            ? "已暂停"
                            : "已退役"}
                      </dd>
                    </div>
                  </dl>
                  <button
                    disabled={
                      saving || b.state === "retired" || !human.available
                    }
                    onClick={() => {
                      setSelected(b);
                      setDaily(formatYuan(b.dailyBudgetFen));
                      setAccountState(
                        b.state === "stopped" ? "stopped" : "active",
                      );
                      setBudgetReason("");
                    }}
                    aria-expanded={selected?.id === b.id}
                  >
                    调整 {b.providerName} 预算
                  </button>
                </article>
              );
            })}
          </div>
        )}
        <PagedMore
          path="/admin/ai/budgets?limit=20"
          cursor={budgetNext}
          label="加载更多预算账户"
          onPage={(p: Page<DTO<"AiBudget">>) => {
            setBudgets((v) => [
              ...v,
              ...p.items.filter((i) => !v.some((b) => b.id === i.id)),
            ]);
            setBudgetNext(p.nextCursor);
          }}
        />
        {selected && (
          <form onSubmit={(e) => void saveBudget(e)} className="ai-budget-edit">
            <h3>调整 {selected.providerName} 的预算</h3>
            <fieldset disabled={saving} className="license-form">
              <div className="form-grid">
                <label>
                  每日额度（元）
                  <input
                    inputMode="decimal"
                    required
                    value={daily}
                    onChange={(e) => setDaily(e.target.value)}
                  />
                </label>
                <label>
                  账户状态
                  <select
                    value={accountState}
                    onChange={(e) =>
                      setAccountState(e.target.value as typeof accountState)
                    }
                  >
                    <option value="active">启用</option>
                    <option value="stopped">暂停新任务</option>
                  </select>
                </label>
                <label>
                  预算调整原因
                  <textarea
                    required
                    maxLength={500}
                    value={budgetReason}
                    onChange={(e) => setBudgetReason(e.target.value)}
                  />
                </label>
              </div>
              <p>
                调低额度会限制新任务，不会清空预占或改写历史费用。已受理结果仍可查询。
              </p>
              <button
                className="admin-primary"
                disabled={!human.available || !budgetReason.trim() || saving}
              >
                {saving ? "正在保存…" : "验证并保存预算"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setSelected(null)}
              >
                取消调整
              </button>
            </fieldset>
          </form>
        )}
      </section>
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>点数与成本规则</h2>
            <p>
              登记不可变版本，供风格与报价配置选择。供应商费用须以真实账单对账，测算值不等同于结算金额。
            </p>
          </div>
        </div>
        {!rules.length && !loading ? (
          <AdminEmpty
            title="暂无定价规则"
            detail="先完成成本测算，再登记每张作品的点数。"
          />
        ) : (
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>版本</th>
                  <th>用户点数 / 张</th>
                  <th>预估成本</th>
                  <th>报价记录的成本上限</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.version}</td>
                    <td>{r.creditsPerImage} 点</td>
                    <td>¥{formatYuan(r.estimatedProviderCostFen)}</td>
                    <td>¥{formatYuan(r.maxCostFen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PagedMore
          path="/admin/ai/cost-rules?limit=20"
          cursor={ruleNext}
          label="加载更多定价版本"
          onPage={(p: Page<DTO<"AiCostRule">>) => {
            setRules((v) => [
              ...v,
              ...p.items.filter((i) => !v.some((r) => r.id === i.id)),
            ]);
            setRuleNext(p.nextCursor);
          }}
        />
        <form onSubmit={(e) => void saveRule(e)}>
          <h3>登记新定价版本</h3>
          <fieldset disabled={saving} className="license-form">
            <div className="form-grid">
              <label>
                规则名称
                <input
                  required
                  maxLength={128}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                每张点数
                <input
                  required
                  inputMode="numeric"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                />
              </label>
              <label>
                预估采购成本（元）
                <input
                  required
                  inputMode="decimal"
                  value={estimated}
                  onChange={(e) => setEstimated(e.target.value)}
                />
              </label>
              <label>
                报价成本上限（元）
                <input
                  required
                  inputMode="decimal"
                  value={maximum}
                  onChange={(e) => setMaximum(e.target.value)}
                />
              </label>
              <label>
                定价登记原因
                <textarea
                  required
                  maxLength={500}
                  value={priceReason}
                  onChange={(e) => setPriceReason(e.target.value)}
                />
              </label>
            </div>
            <button
              className="admin-primary"
              disabled={
                saving ||
                !human.available ||
                !name.trim() ||
                !points ||
                !estimated ||
                !maximum ||
                !priceReason.trim()
              }
            >
              {saving ? "正在登记…" : "验证并登记定价"}
            </button>
          </fieldset>
        </form>
      </section>
    </AdminShell>
  );
}
