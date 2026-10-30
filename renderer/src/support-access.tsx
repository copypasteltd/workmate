import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Copy, RefreshCw } from "lucide-react";
import { api } from "./api";
import { useWorkspace } from "./context";
import { DateText, ErrorNotice, Field, Loading, useI18n } from "./ui";

type Grant = {
  id: string;
  state: string;
  reason: string;
  expires_at: string;
  project_ids: string[];
  granted_by: string;
};
export function SupportAccess() {
  const w = useWorkspace();
  const role = w.me?.memberships?.find((m: any) => m.id === w.tenant)?.role;
  return <SupportGrantForm key={`${w.me?.user?.id}:${w.tenant}:${role}`} />;
}
function SupportGrantForm() {
  const w = useWorkspace(),
    { t } = useI18n();
  const [rows, setRows] = useState<Grant[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<string[]>([]),
    [notice, setNotice] = useState("");
  const revision = useRef(0),
    identity = `${w.me?.user?.id}:${w.tenant}`;
  const current = useRef(identity);
  const pending = useRef<AbortController | null>(null), working = useRef(busy);
  current.current = identity;
  working.current = busy;
  const can = w.me?.memberships?.some(
    (m: any) => m.id === w.tenant && ["owner", "admin"].includes(m.role),
  );
  const request = (path: string, body?: unknown, signal?: AbortSignal) =>
    api(path, {
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
      headers: { "X-Tenant-ID": w.tenant },
      signal,
    });
  async function load(cursor?: string) {
    const r = ++revision.current,
      scope = identity, controller = new AbortController();
    pending.current?.abort(); pending.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await request(
        "/v1/support-grants?limit=20" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), undefined, controller.signal,
      );
      if (revision.current !== r || current.current !== scope) return;
      setRows((old) => (cursor ? [...old, ...result.items] : result.items));
      setNext(result.next_cursor);
      return true;
    } catch (e) {
      if (revision.current === r && current.current === scope) {
        setRows([]);
        setNext(null);
        setError(e as Error);
      }
      return false;
    } finally {
      if (revision.current === r && current.current === scope)
        setLoading(false);
      if (pending.current === controller) pending.current = null;
    }
  }
  useEffect(() => {
    current.current = identity;
    ++revision.current;
    setRows([]);
    setNext(null);
    setSelected([]);
    setNotice("");
    setError(null);
    setBusy(false);
    if (!can || !w.tenant) {
      setLoading(false);
      return;
    }
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible" && !working.current) void load();
    };
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      current.current = "";
      ++revision.current;
      pending.current?.abort(); pending.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [identity, can]);
  if (!can || !w.tenant) return null;
  return (
    <section className="card support-access" data-testid="support-access">
      <div className="section-heading">
        <h2>
          <ShieldCheck size={19} aria-hidden="true" />{" "}
          {t("客服限時協助", "Time-limited support")}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t("更新支持授權", "Refresh support grants")}
          onClick={() => void load()}
          disabled={loading || busy}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="muted">
        {t(
          "由你選擇範圍及期限，隨時撤銷。客服使用自己的管理員身分，只讀查看；私人會話不開放。",
          "Choose the scope and deadline, and revoke at any time. Support uses its own administrator identity in a read-only view. Private conversations stay private.",
        )}
      </p>
      <ErrorNotice error={error} />
      <p role="status" className="muted">
        {notice}
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget,
            data = new FormData(form),
            scope = identity;
          setBusy(true);
          setError(null);
          setNotice("");
          try {
            await request("/v1/support-grants", {
              reason: String(data.get("reason")).trim(),
              project_ids: selected,
              expires_at: new Date(
                Date.now() + Number(data.get("minutes")) * 60000,
              ).toISOString(),
            });
            if (current.current !== scope) return;
            form.reset();
            setSelected([]);
            const refreshed = await load();
            if (current.current === scope && refreshed) setNotice(
              t(
                "授權已建立。將授權 ID 提供給客服；可隨時撤銷。",
                "Grant created. Share its ID with support; you can revoke it at any time.",
              ),
            );
          } catch (e) {
            if (current.current === scope) setError(e as Error);
          } finally {
            if (current.current === scope) setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <legend>{t("明確授權範圍", "Explicit authorization scope")}</legend>
          <p className="muted">
            {t(
              "不選項目時僅包含企業與用戶資料，不會自動授權所有項目。",
              "An empty selection covers workspace and user metadata only. It never includes all projects.",
            )}
          </p>
          <div className="support-project-options">
            {w.projects.map((p: any) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, p.id]
                        : old.filter((id) => id !== p.id),
                    )
                  }
                />{" "}
                <span>{p.name}</span>
              </label>
            ))}
          </div>
          <Field label={t("協助原因", "Reason for assistance")}>
            <textarea
              name="reason"
              required
              minLength={1}
              maxLength={1000}
              rows={2}
            />
          </Field>
          <Field label={t("有效期限", "Access duration")}>
            <select name="minutes" defaultValue="15">
              <option value="15">{t("15 分鐘", "15 minutes")}</option>
              <option value="30">{t("30 分鐘", "30 minutes")}</option>
              <option value="60">{t("60 分鐘", "60 minutes")}</option>
            </select>
          </Field>
          <button className="button" type="submit">
            {busy
              ? t("處理中…", "Working…")
              : t("建立限時授權", "Create a time-limited grant")}
          </button>
        </fieldset>
      </form>
      {loading && <Loading />}
      {!loading && !rows.length && !error && (
        <p className="muted">
          {t("目前沒有客服授權。", "No support grants yet.")}
        </p>
      )}
      <div className="support-grant-list">
        {rows.map((row) => (
          <article key={row.id} className="support-grant-row" data-grant-id={row.id}>
            <strong>{row.reason}</strong>
            <span>
              {t("狀態", "State")}:{" "}
              {row.state === "active"
                ? t("有效", "Active")
                : row.state === "expired"
                  ? t("已到期", "Expired")
                  : t("已撤銷", "Revoked")}
            </span>
            <span>
              {t("到期", "Expires")}: <DateText value={row.expires_at} />
            </span>
            <span>
              {t("已選項目", "Selected projects")}:{" "}
              {row.project_ids
                .map(
                  (id) => w.projects.find((p: any) => p.id === id)?.name ?? id,
                )
                .join(", ") || t("僅元資料", "Metadata only")}
            </span>
            <code>{row.id}</code>
            <div className="button-row">
              <button
                type="button"
                className="button secondary"
                onClick={async () => {
                  const scope = identity;
                  try {
                    await navigator.clipboard.writeText(row.id);
                    if (current.current === scope) setNotice(t("已複製授權 ID。", "Grant ID copied."));
                  } catch {
                    if (current.current === scope) setError(
                      new Error(
                        t(
                          "請選取並複製上方的授權 ID。",
                          "Select and copy the grant ID above.",
                        ),
                      ),
                    );
                  }
                }}
              >
                <Copy size={15} />
                {t("複製 ID", "Copy ID")}
              </button>
              {row.state === "active" && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    const scope = identity;
                    setBusy(true);
                    setError(null);
                    try {
                      await request(`/v1/support-grants/${row.id}/revoke`, {
                        reason: t(
                          "用戶在設定頁結束客服協助",
                          "Customer ended support in account settings",
                        ),
                      });
                      if (current.current === scope) {
                        const refreshed = await load();
                        if (current.current === scope && refreshed) setNotice(
                          t(
                            "授權已撤銷，支援視圖將停止存取。",
                            "Grant revoked. Support can no longer access the view.",
                          ),
                        );
                      }
                    } catch (e) {
                      if (current.current === scope) setError(e as Error);
                    } finally {
                      if (current.current === scope) setBusy(false);
                    }
                  }}
                >
                  {t("撤銷授權", "Revoke grant")}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {next && (
        <button
          type="button"
          className="button secondary"
          disabled={loading || busy}
          onClick={() => void load(next)}
        >
          {t("載入更多", "Load more")}
        </button>
      )}
    </section>
  );
}
