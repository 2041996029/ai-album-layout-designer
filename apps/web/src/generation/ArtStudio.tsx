import { useEffect, useRef, useState } from "react";
import { api, id, type DTO, type Page } from "../cloud/api";
import "./generation.css";
type Result = {
  jobId: string;
  state: DTO<"Job">["state"];
  asset?: DTO<"Asset">;
  reasonCode?: string;
};
/** Quotes are invalidated whenever inputs change; accepting a quote keeps one stable request key. */
export function ArtStudio({
  workspaceId,
  onInsert,
}: {
  workspaceId: string;
  onInsert?: (asset: DTO<"Asset">) => void;
}) {
  const [presets, setPresets] = useState<DTO<"GenerationPreset">[]>([]),
    [presetId, setPresetId] = useState(""),
    [description, setDescription] = useState(""),
    [ratio, setRatio] = useState("1:1"),
    [capability, setCapability] = useState<"textToImage" | "imageToImage">(
      "textToImage",
    ),
    [assets, setAssets] = useState<DTO<"Asset">[]>([]),
    [reference, setReference] = useState(""),
    [consent, setConsent] = useState(false),
    [quote, setQuote] = useState<DTO<"GenerationQuote"> | null>(null),
    [job, setJob] = useState<DTO<"Job"> | null>(null),
    [result, setResult] = useState<Result | null>(null),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const epoch = useRef(0),
    acceptKey = useRef(""),
    preset = presets.find((p) => p.id === presetId),
    active = job && !["succeeded", "failed", "cancelled"].includes(job.state);
  useEffect(() => {
    let live = true;
    epoch.current++;
    setQuote(null);
    setJob(null);
    setResult(null);
    setPreview("");
    setError("");
    setPresets([]);
    setAssets([]);
    setReference("");
    setConsent(false);
    setCapability("textToImage");
    setDescription("");
    api<Page<DTO<"GenerationPreset">>>(
      `/generation-presets?workspaceId=${id(workspaceId)}`,
    )
      .then((p) => {
        if (live) {
          setPresets(p.items);
          setPresetId(p.items[0]?.id ?? "");
          setRatio(p.items[0]?.ratios[0] ?? "1:1");
        }
      })
      .catch(() => {
        if (live) setError("AI 创作尚未开通，请稍后再试。");
      });
    api<Page<DTO<"Asset">>>(
      `/assets?workspaceId=${id(workspaceId)}&state=ready&limit=100`,
    )
      .then((p) => {
        if (live) setAssets(p.items);
      })
      .catch(() => {});
    return () => {
      live = false;
      epoch.current++;
    };
  }, [workspaceId]);
  useEffect(() => {
    epoch.current++;
    setQuote(null);
    acceptKey.current = "";
  }, [presetId, description, ratio, capability, reference, consent]);
  useEffect(() => {
    if (!job || result?.jobId === job.id) return;
    let live = true,
      polling = false;
    const poll = async () => {
      if (polling || !live) return;
      polling = true;
      try {
        const next = await api<DTO<"Job">>(`/jobs/${id(job.id)}`);
        if (!live) return;
        if (["succeeded", "failed", "cancelled"].includes(next.state)) {
          const r = await api<Result>(`/generation-jobs/${id(job.id)}/result`);
          if (!live) return;
          if (r.asset) {
            const token = await api<DTO<"DownloadToken">>(
              `/assets/${id(r.asset.id)}/download-token?variant=preview`,
              "POST",
            );
            if (live) setPreview(token.url);
          }
          if (live) setResult(r);
        }
        if (live) setJob(next);
      } catch {
        if (live) setError("暂时无法获取任务状态，可在任务中心继续查看。");
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job?.id, result?.jobId]);
  async function requestQuote() {
    const current = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      const input: DTO<"GenerationInput"> = {
        workspaceId,
        presetVersionId: presetId,
        description,
        capability,
        ratio,
        imageCount: 1,
        ...(capability === "imageToImage"
          ? {
              referenceConsent: {
                assetId: reference,
                authorized: true,
                transferAccepted: true,
                purpose: "imageToImage",
                policyVersion: preset!.policyVersion,
              },
            }
          : {}),
      };
      const q = await api<DTO<"GenerationQuote">>(
        "/generation-quotes",
        "POST",
        input,
      );
      if (current === epoch.current) {
        setQuote(q);
        acceptKey.current = crypto.randomUUID();
      }
    } catch {
      if (current === epoch.current)
        setError("暂时无法报价，请检查可用风格、参考照片授权与点数。");
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (!quote || busy) return;
    const current = epoch.current;
    setBusy(true);
    setError("");
    try {
      const j = await api<DTO<"Job">>(
        "/generation-jobs",
        "POST",
        {
          quoteId: quote.id,
          inputHash: quote.inputHash,
          policyConsentVersion: quote.policyVersion,
        },
        { "Idempotency-Key": acceptKey.current },
      );
      if (current !== epoch.current) return;
      setJob(j);
      setQuote(null);
      setResult(null);
      setPreview("");
    } catch {
      if (current === epoch.current)
        setError(
          "提交未确认。可重试同一报价，系统会避免重复扣点；报价过期请重新获取。",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="commerce-page art-studio">
      <div className="eyebrow">AI ART STUDIO</div>
      <h1>把灵感，留在相册里</h1>
      <p className="commerce-lead">
        选择风格，描述画面。确认点数后生成，作品审核通过后自动保存到素材库。
      </p>
      {error && <p role="alert">{error}</p>}
      {!presets.length ? (
        <div className="empty-state">
          暂无已开通的创作风格。相册排版、标题编辑与本地导出可继续使用。
        </div>
      ) : (
        <div className="art-workbench">
          <div className="art-controls">
            <fieldset disabled={busy || Boolean(active)}>
              <legend>创作画面</legend>
              <label>
                风格
                <select
                  value={presetId}
                  onChange={(e) => {
                    const p = presets.find((p) => p.id === e.target.value)!;
                    setPresetId(p.id);
                    setRatio(p.ratios[0]);
                    setCapability("textToImage");
                    setConsent(false);
                  }}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                创作方式
                <select
                  value={capability}
                  onChange={(e) => {
                    setCapability(e.target.value as typeof capability);
                    setConsent(false);
                  }}
                >
                  <option value="textToImage">文字生成</option>
                  {preset?.referenceAllowed && (
                    <option value="imageToImage">参考照片创作</option>
                  )}
                </select>
              </label>
              <label>
                画面描述
                <textarea
                  rows={5}
                  maxLength={preset?.maxPromptCharacters ?? 4000}
                  placeholder="例如：晨光中的群山，淡墨、远山与大片留白"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label>
                比例
                <select
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                >
                  {preset?.ratios.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              {capability === "imageToImage" && (
                <>
                  <label>
                    参考照片
                    <select
                      value={reference}
                      onChange={(e) => {
                        setReference(e.target.value);
                        setConsent(false);
                      }}
                    >
                      <option value="">选择一张照片</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.originalFilename}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="art-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    我拥有此照片的使用授权，并同意将它传给 AI 服务用于本次创作。
                  </label>
                </>
              )}
              <button
                disabled={
                  !description.trim() ||
                  !preset ||
                  (capability === "imageToImage" && (!reference || !consent))
                }
                onClick={() => void requestQuote()}
              >
                获取本次报价
              </button>
            </fieldset>
            {quote && (
              <div className="art-quote" role="status">
                <strong>本次 1 张 · {quote.credits} 点</strong>
                <p>
                  报价有效至{" "}
                  {new Date(quote.expiresAt).toLocaleTimeString("zh-CN")}
                  。失败或审核未通过会释放点数。
                </p>
                <button
                  disabled={busy || Date.now() >= Date.parse(quote.expiresAt)}
                  onClick={() => void generate()}
                >
                  {busy ? "正在提交…" : `确认使用 ${quote.credits} 点生成`}
                </button>
              </div>
            )}
          </div>
          <div className="art-output" aria-live="polite">
            {active ? (
              <>
                <h2>
                  {job.providerSubmissionState === "unknown"
                    ? "正在确认生成结果"
                    : "正在创作"}
                </h2>
                <p>可以离开页面，任务会继续。请在任务中心查看进度。</p>
                <a href="#tasks">查看任务</a>
              </>
            ) : result?.asset ? (
              <>
                <img src={preview || undefined} alt="审核通过的 AI 创作预览" />
                <h2>作品已保存到素材库</h2>
                <p>包含 AI 来源标识，可在相册中使用。</p>
                {onInsert ? (
                  <button onClick={() => onInsert(result.asset!)}>
                    添加到当前跨页
                  </button>
                ) : (
                  <a href="./index.html">返回编辑器使用素材</a>
                )}
              </>
            ) : result ? (
              <>
                <h2>本次未生成可用作品</h2>
                <p>预占点数已释放。请调整描述后重新报价。</p>
              </>
            ) : (
              <>
                <span className="art-placeholder" aria-hidden="true">
                  山 · 水 · 光
                </span>
                <h2>等待你的灵感</h2>
                <p>生成结果会显示在这里。</p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
