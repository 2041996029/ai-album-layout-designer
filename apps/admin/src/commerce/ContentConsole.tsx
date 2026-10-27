import { useEffect, useRef, useState } from "react";
import { api, id, type DTO, type Page } from "../../../web/src/cloud/api";
import {
  AdminShell,
  AdminEmpty,
  AdminBadge,
  type AdminView,
} from "./AdminShell";
import { PagedMore } from "../../../web/src/commerce/PagedMore";
export function ContentConsole({
  onView,
}: {
  onView: (view: AdminView) => void;
}) {
  const [licenses, setLicenses] = useState<DTO<"LicenseRecord">[]>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [name, setName] = useState(""),
    [source, setSource] = useState(""),
    [terms, setTerms] = useState(""),
    [territories, setTerritories] = useState("CN"),
    [commercial, setCommercial] = useState(false),
    [embedding, setEmbedding] = useState(false),
    [reference, setReference] = useState(false),
    [expiry, setExpiry] = useState(""),
    [reason, setReason] = useState("");
  const epoch = useRef(0),
    operation = useRef({ hash: "", key: "" });
  async function refresh() {
    const generation = ++epoch.current;
    setLoading(true);
    setError("");
    try {
      const page = await api<Page<DTO<"LicenseRecord">>>(
        "/admin/licenses?limit=20",
      );
      if (generation === epoch.current) {
        setLicenses(page.items);
        setNext(page.nextCursor);
      }
    } catch {
      if (generation === epoch.current)
        setError(
          "无法读取授权记录。请确认已登录，并拥有内容管理或平台运维权限。",
        );
    } finally {
      if (generation === epoch.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      epoch.current++;
    };
  }, []);
  async function register(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const input: DTO<"LicenseCreate"> = {
        name: name.trim(),
        source: source.trim(),
        termsVersion: terms.trim(),
        territories: territories.split(/[,，\s]+/).filter(Boolean),
        commercialAllowed: commercial,
        embeddingAllowed: embedding,
        referenceImageAllowed: reference,
        reason: reason.trim(),
        ...(expiry ? { expiresAt: new Date(expiry).toISOString() } : {}),
      };
      const hash = JSON.stringify(input);
      if (operation.current.hash !== hash)
        operation.current = { hash, key: crypto.randomUUID() };
      const record = await api<DTO<"LicenseRecord">>(
        "/admin/licenses",
        "POST",
        input,
        { "Idempotency-Key": operation.current.key },
      );
      setStatus(
        `已登记「${record.name}」授权版本 ${record.revision}。现有作品的历史授权保持不变。`,
      );
      operation.current = { hash: "", key: "" };
      setName("");
      setSource("");
      setTerms("");
      setReason("");
      setCommercial(false);
      setEmbedding(false);
      setReference(false);
      setExpiry("");
      await refresh();
    } catch {
      setError(
        "登记未完成。请确认内容管理权限、授权范围和有效期后重试；重复点击不会生成重复记录。",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <AdminShell
      view="content"
      onView={onView}
      loading={loading}
      onRefresh={() => void refresh()}
    >
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>授权资料库</h2>
            <p>
              先登记使用范围，再将授权关联到模型、模板与字体。每次修改保留独立版本。
            </p>
          </div>
          <span className="admin-count">{licenses.length} 条已加载</span>
        </div>
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
        {!licenses.length && !loading ? (
          <AdminEmpty
            title="暂无授权记录"
            detail="登记原创声明或服务商授权条款后，可在内容发布时选择。"
          />
        ) : (
          <div className="license-grid">
            {licenses.map((license) => (
              <article key={license.id} className="license-card">
                <div className="admin-panel-heading">
                  <h3>{license.name}</h3>
                  <AdminBadge
                    value={license.commercialAllowed ? "可商用" : "限制使用"}
                  />
                </div>
                <p>
                  条款 {license.termsVersion} · 版本 {license.revision}
                </p>
                <p className="license-source">{license.source}</p>
                <dl>
                  <div>
                    <dt>地域</dt>
                    <dd>{license.territories.join("、")}</dd>
                  </div>
                  <div>
                    <dt>参考图</dt>
                    <dd>{license.referenceImageAllowed ? "允许" : "未授权"}</dd>
                  </div>
                  <div>
                    <dt>字体嵌入</dt>
                    <dd>{license.embeddingAllowed ? "允许" : "未授权"}</dd>
                  </div>
                  <div>
                    <dt>有效期</dt>
                    <dd>
                      {license.expiresAt
                        ? new Date(license.expiresAt).toLocaleString("zh-CN")
                        : "未设置到期日"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
        <PagedMore
          label="加载更多授权"
          path="/admin/licenses?limit=20"
          cursor={next}
          onPage={(p: Page<DTO<"LicenseRecord">>) => {
            setLicenses((v) => [
              ...v,
              ...p.items.filter((i) => !v.some((a) => a.id === i.id)),
            ]);
            setNext(p.nextCursor);
          }}
        />
      </section>
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>登记授权</h2>
            <p>
              仅内容管理员可以登记。商业使用、参考图处理和字体嵌入须分别确认。
            </p>
          </div>
        </div>
        <form onSubmit={(event) => void register(event)}>
          <fieldset disabled={saving} className="license-form">
            <div className="form-grid">
              <label>
                授权名称
                <input
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                条款版本
                <input
                  required
                  maxLength={128}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="如 2026-01"
                />
              </label>
              <label>
                授权来源
                <input
                  required
                  maxLength={1000}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="授权链接或原创声明"
                />
              </label>
              <label>
                适用地域
                <input
                  required
                  value={territories}
                  onChange={(e) => setTerritories(e.target.value)}
                  placeholder="CN，多个地域用逗号分隔"
                />
              </label>
              <label>
                到期时间（可选）
                <input
                  type="datetime-local"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </label>
              <label>
                登记原因
                <textarea
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </div>
            <div className="license-rights">
              <label>
                <input
                  type="checkbox"
                  checked={commercial}
                  onChange={(e) => setCommercial(e.target.checked)}
                />
                明确允许商业使用
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={reference}
                  onChange={(e) => setReference(e.target.checked)}
                />
                明确允许参考图处理
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={embedding}
                  onChange={(e) => setEmbedding(e.target.checked)}
                />
                明确允许字体嵌入
              </label>
            </div>
            <button
              className="admin-primary"
              disabled={
                saving ||
                !name.trim() ||
                !terms.trim() ||
                !source.trim() ||
                !reason.trim()
              }
            >
              {saving ? "正在登记…" : "登记新授权版本"}
            </button>
          </fieldset>
        </form>
      </section>
    </AdminShell>
  );
}
