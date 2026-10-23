import { useEffect, useState } from "react";
import {
  api,
  ifMatch,
  id,
  setSession,
  type DTO,
  type Page,
} from "../cloud/api";
export function AccountSettings({
  onLogout = () => location.reload(),
}: {
  onLogout?: () => void;
}) {
  const [prefs, setPrefs] = useState<DTO<"Preferences">>(),
    [sessions, setSessions] = useState<DTO<"Session">[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all([
      api<DTO<"Preferences">>("/me/preferences"),
      api<Page<DTO<"Session">>>("/auth/sessions"),
    ])
      .then(([p, s]) => {
        if (live) {
          setPrefs(p);
          setSessions(s.items);
        }
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, []);
  async function update(body: DTO<"PreferencesUpdate">) {
    if (!prefs) return;
    try {
      setPrefs(
        await api("/me/preferences", "PATCH", body, ifMatch(prefs.revision)),
      );
      setMessage("设置已保存");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section aria-label="账号设置">
      <h2>账号设置</h2>
      {prefs && (
        <>
          <label>
            语言
            <select
              value={prefs.language}
              onChange={(e) =>
                void update({ language: e.target.value as "zh-CN" | "en-US" })
              }
            >
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <label>
            展示时区
            <select
              value={prefs.timezone}
              onChange={(e) => void update({ timezone: e.target.value })}
            >
              <option value="Asia/Shanghai">北京时间</option>
              <option value="UTC">UTC</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={prefs.inAppNotifications}
              onChange={(e) =>
                void update({ inAppNotifications: e.target.checked })
              }
            />
            站内通知
          </label>
        </>
      )}
      <h3>编辑快捷键</h3>
      <p>
        Ctrl / ⌘ + Z 撤销，Ctrl / ⌘ + Shift + Z 重做，Delete
        删除选中图层。输入文字时保留正常文字编辑操作。
      </p>
      <h3>已登录设备</h3>
      <ul>
        {sessions.map((s) => (
          <li key={s.id}>
            {s.client.deviceLabel ?? s.client.platform}
            {s.current ? (
              " · 当前设备"
            ) : (
              <button
                onClick={async () => {
                  try {
                    await api(`/auth/sessions/${id(s.id)}`, "DELETE");
                    setSessions((v) => v.filter((x) => x.id !== s.id));
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                退出此设备
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        onClick={async () => {
          try {
            await api("/auth/logout", "POST");
            setSession(null);
            onLogout();
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        退出登录
      </button>
      <h3>注销账号</h3>
      <p>
        注销需要重新验证身份并确认已发布的数据删除政策。当前验证与政策入口尚未开通，暂不能提交注销。订单及审计数据按适用政策保留。
      </p>
      <button disabled>申请注销（暂未开通）</button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
