import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Search, RefreshCw, Eye, X } from "lucide-react";
import { api, post } from "./api";
import { DateText, ErrorNotice, Field, Loading, useI18n } from "./ui";

type Session = {
  id: string;
  actor_id: string;
  user_id: string;
  tenant_id: string;
  state: string;
  expires_at: string;
};
export function AdminSupport({
  access,
}: {
  access: { me: any; has: (permission: string) => boolean };
}) {
  const { t } = useI18n(),
    [sessions, setSessions] = useState<Session[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [users, setUsers] = useState<any[]>([]),
    [userNext, setUserNext] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [detail, setDetail] = useState<any>(null),
    [tenant, setTenant] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [active, setActive] = useState(""),
    [view, setView] = useState<any>(null),
    [body, setBody] = useState<any>(null),
    [receipt, setReceipt] = useState<any>(null),
    [remaining, setRemaining] = useState(0);
  const revision = useRef(0),
    selection = useRef(0),
    viewRevision = useRef(0),
    deadline = useRef(0),
    pending = useRef(false),
    listRevision = useRef(0);
  const actor = access.me?.user?.id;
  const member = detail?.memberships?.find(
    (m: any) => m.tenant_id === tenant && m.state === "active",
  );
  const clearView = () => {
    ++viewRevision.current;
    deadline.current = 0;
    setView(null);
    setBody(null);
    setRemaining(0);
  };
  async function load(cursor?: string) {
    const r = ++listRevision.current;
    setLoading(true);
    try {
      const data = await api(
        "/v1/admin/support/sessions?limit=20" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      if (r !== listRevision.current) return;
      setSessions((old) => (cursor ? [...old, ...data.items] : data.items));
      setNext(data.next_cursor);
    } catch (e) {
      if (r === listRevision.current) {
        setSessions([]);
        setNext(null);
        setError(e as Error);
        setActive("");
        clearView();
      }
    } finally {
      if (r === listRevision.current) setLoading(false);
    }
  }
  async function search(cursor?: string) {
    const r = ++revision.current;
    setError(null);
    setBusy(true);
    try {
      const q = new URLSearchParams({ limit: "20", state: "active" });
      if (query.trim()) q.set("q", query.trim());
      if (cursor) q.set("cursor", cursor);
      const data = await api("/v1/admin/users?" + q);
      if (r === revision.current) {
        setUsers((old) => (cursor ? [...old, ...data.items] : data.items));
        setUserNext(data.next_cursor);
      }
    } catch (e) {
      if (r === revision.current) {
        setUsers([]);
        setUserNext(null);
        setError(e as Error);
      }
    } finally {
      if (r === revision.current) setBusy(false);
    }
  }
  async function choose(id: string) {
    const r = ++selection.current;
    setDetail(null);
    setTenant("");
    setSelected([]);
    setError(null);
    setReceipt(null);
    setActive("");
    clearView();
    setBusy(true);
    try {
      const data = await api("/v1/admin/users/" + id);
      if (r === selection.current) setDetail(data);
    } catch (e) {
      if (r === selection.current) setError(e as Error);
    } finally {
      if (r === selection.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      ++revision.current;
      ++selection.current;
      ++viewRevision.current;
      ++listRevision.current;
    };
  }, [actor]);
  useEffect(() => {
    clearView();
    if (!active) return;
    let live = true;
    const fetchView = async () => {
      if (pending.current || document.visibilityState !== "visible") return;
      const r = viewRevision.current,
        started = performance.now();
      pending.current = true;
      try {
        const data = await api(`/v1/admin/support/sessions/${active}/view`, {
          headers: { "X-CopyPaste-Support-Session": active },
        });
        if (!live || r !== viewRevision.current) return;
        const safeRemaining =
          Date.parse(data.session.expires_at) -
          Date.parse(data.as_of) -
          (performance.now() - started);
        if (safeRemaining <= 0) {
          clearView();
          setActive("");
          setError(
            new Error(t("支援會話已到期。", "Support access has expired.")),
          );
          return;
        }
        deadline.current = performance.now() + safeRemaining;
        setRemaining(Math.ceil(safeRemaining / 1000));
        setView(data);
        setBody((old: any) =>
          old &&
          data.tasks.some(
            (task: any) => task.id === old.task.id && task.body_available,
          )
            ? old
            : null,
        );
        setError(null);
      } catch (e) {
        if (live && r === viewRevision.current) {
          clearView();
          setActive("");
          setError(e as Error);
          void load();
        }
      } finally {
        pending.current = false;
      }
    };
    void fetchView();
    const poll = setInterval(() => void fetchView(), 2000),
      clock = setInterval(() => {
        if (!deadline.current) return;
        const seconds = Math.ceil(
          (deadline.current - performance.now()) / 1000,
        );
        setRemaining(Math.max(0, seconds));
        if (seconds <= 0) {
          clearView();
          setActive("");
          setError(
            new Error(
              t(
                "支援會話已到期，內容已清除。",
                "Support access expired. The view has been cleared.",
              ),
            ),
          );
          void load();
        }
      }, 200);
    const visibility = () => {
      clearView();
      if (document.visibilityState === "visible") void fetchView();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      live = false;
      ++viewRevision.current;
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, actor]);
  const state = (value: string) =>
    value === "active"
      ? t("有效", "Active")
      : value === "expired"
        ? t("已到期", "Expired")
        : t("已撤銷", "Revoked");
  return (
    <div className="support-workspace" data-testid="admin-support">
      <header className="page-header">
        <div>
          <p className="eyebrow">A13 · CUSTOMER CARE</p>
          <h1>{t("支援工作台", "Support workspace")}</h1>
          <p className="muted">
            {t(
              "以真實管理員身分提供限時、指定範圍的只讀協助。",
              "Provide time-limited, scoped, read-only help using your own administrator identity.",
            )}
          </p>
        </div>
      </header>
      <ErrorNotice error={error} />
      {view && (
        <section className="support-read-only" data-testid="support-view">
          <div className="support-context-banner" role="status">
            <ShieldCheck size={22} aria-hidden="true" />
            <div>
              <strong>{t("只讀客服視圖", "READ-ONLY SUPPORT VIEW")}</strong>
              <span>
                {t("管理員", "Administrator")}: {view.actor.name} ·{" "}
                {view.actor.id}
              </span>
              <span>
                {t("協助用戶", "Customer")}: {view.target.name} ·{" "}
                {view.target.id}
              </span>
              <span>
                {view.workspace.name} · {t("到期", "Expires")}:{" "}
                <DateText value={view.session.expires_at} /> · {remaining}s
              </span>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={t("關閉支援視圖", "Close support view")}
              onClick={() => {
                setActive("");
                clearView();
              }}
            >
              <X size={18} />
            </button>
          </div>
          <div className="card">
            <h2>{t("已確認的項目範圍", "Confirmed project scope")}</h2>
            <p>
              {view.projects.map((p: any) => p.name).join(" · ") ||
                t("僅企業與用戶元資料", "Workspace and customer metadata only")}
            </p>
            <p className="muted">
              {t(
                "此視圖不提供用戶登入憑證、寫入、費用或 VIP 操作。正文需要另行授權；私人會話不開放。",
                "This view provides no customer credentials, editing, billing or VIP actions. Shared content needs independent authorization; private conversations stay private.",
              )}
            </p>
            <h3>{t("最近任務診斷", "Recent task diagnostics")}</h3>
            {!view.tasks.length && (
              <p className="muted">
                {t(
                  "在目前授權範圍內沒有可顯示的任務。",
                  "No tasks are visible within the current scope.",
                )}
              </p>
            )}
            <div className="support-session-grid">
              {view.tasks.map((task: any) => (
                <article key={task.id} className="support-record">
                  <strong>
                    {task.private
                      ? t(
                          "私人任務（標題已隱藏）",
                          "Private task (title hidden)",
                        )
                      : task.title}
                  </strong>
                  <code>{task.id}</code>
                  <span>
                    {task.state} {task.error_code ? `· ${task.error_code}` : ""}
                  </span>
                  <DateText value={task.updated_at} />
                  {task.body_available && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={async () => {
                        const r = viewRevision.current,
                          id = active;
                        setBody(null);
                        try {
                          const d = await api(
                            `/v1/admin/support/sessions/${id}/view/tasks/${task.id}`,
                            { headers: { "X-CopyPaste-Support-Session": id } },
                          );
                          if (
                            r === viewRevision.current &&
                            deadline.current > performance.now()
                          )
                            setBody(d);
                        } catch (e) {
                          if (r === viewRevision.current) {
                            clearView();
                            setActive("");
                            setError(e as Error);
                          }
                        }
                      }}
                    >
                      {t("讀取已授權正文", "Read authorized content")}
                    </button>
                  )}
                </article>
              ))}
            </div>
            {view.tasks_truncated && (
              <p className="muted">
                {t(
                  "此診斷視圖僅顯示最近 20 個任務。",
                  "This diagnostic view shows the most recent 20 tasks.",
                )}
              </p>
            )}
            {body && (
              <div className="support-body">
                <h3>{t("已授權共享正文", "Authorized shared content")}</h3>
                <pre>{body.prompt}</pre>
                <pre>{body.output}</pre>
              </div>
            )}
          </div>
        </section>
      )}
      <div className="support-layout">
        <section className="card">
          <h2>{t("建立限時支援", "Start time-limited support")}</h2>
          {!access.has("admin.support.start") ||
          !access.has("admin.users.read") ? (
            <p className="muted">
              {t(
                "目前角色可查看支援記錄，無法建立新會話。",
                "Your role can view support records but cannot start a new session.",
              )}
            </p>
          ) : (
            <>
              <form
                className="support-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  setDetail(null);
                  setTenant("");
                  setSelected([]);
                  void search();
                }}
              >
                <Field label={t("搜尋實際用戶", "Search customers")}>
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      ++revision.current;
                      setUsers([]);
                      setUserNext(null);
                    }}
                    maxLength={160}
                    placeholder={t(
                      "姓名或已授權聯絡資料",
                      "Name or authorized contact",
                    )}
                  />
                </Field>
                <button
                  className="button secondary"
                  type="submit"
                  disabled={busy}
                >
                  <Search size={16} />
                  {t("搜尋", "Search")}
                </button>
              </form>
              <div className="support-user-results">
                {users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="support-user-choice"
                    disabled={busy}
                    onClick={() => void choose(user.id)}
                  >
                    <strong>{user.display_name}</strong>
                    <span>{user.masked_contact}</span>
                    <code>{user.id}</code>
                  </button>
                ))}
              </div>
              {userNext && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void search(userNext)}
                >
                  {t("更多用戶", "More customers")}
                </button>
              )}
              {detail && (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget),
                      r = selection.current;
                    setBusy(true);
                    setError(null);
                    setReceipt(null);
                    setActive("");
                    clearView();
                    try {
                      const grant = String(form.get("grant") ?? "").trim();
                      const op = await post("/v1/admin/support/sessions", {
                        user_id: detail.user.id,
                        tenant_id: tenant,
                        project_ids: selected,
                        mode: "read_only",
                        expires_at: new Date(
                          Date.now() + Number(form.get("minutes")) * 60000,
                        ).toISOString(),
                        reason: String(form.get("reason")).trim(),
                        ...(grant ? { support_grant_id: grant } : {}),
                      });
                      if (selection.current !== r) return;
                      setReceipt(op);
                      await load();
                      if (selection.current === r) setActive(op.result_ids[0]);
                    } catch (e) {
                      if (selection.current === r) setError(e as Error);
                    } finally {
                      if (selection.current === r) setBusy(false);
                    }
                  }}
                >
                  <fieldset disabled={busy}>
                    <legend>
                      {detail.user.display_name} · {detail.user.masked_contact}
                    </legend>
                    <Field label={t("目標企業", "Target workspace")}>
                      <select
                        value={tenant}
                        required
                        onChange={(e) => {
                          setTenant(e.target.value);
                          setSelected([]);
                          setReceipt(null);
                          setActive("");
                          clearView();
                        }}
                      >
                        <option value="">
                          {t("選擇企業", "Select workspace")}
                        </option>
                        {detail.memberships
                          .filter((m: any) => m.state === "active")
                          .map((m: any) => (
                            <option key={m.tenant_id} value={m.tenant_id}>
                              {m.tenant_id} ({m.role})
                            </option>
                          ))}
                      </select>
                    </Field>
                    <fieldset>
                      <legend>
                        {t("明確選擇項目", "Explicit project selection")}
                      </legend>
                      <p className="muted">
                        {t(
                          "空範圍僅限元資料。會逐次核對用戶與管理員權限。",
                          "An empty scope covers metadata only. Customer and administrator access are checked on every read.",
                        )}
                      </p>
                      <div className="support-project-options">
                        {member?.project_ids.map((id: string) => (
                          <label key={id}>
                            <input
                              type="checkbox"
                              checked={selected.includes(id)}
                              onChange={(e) =>
                                setSelected((old) =>
                                  e.target.checked
                                    ? [...old, id]
                                    : old.filter((v) => v !== id),
                                )
                              }
                            />
                            <code>{id}</code>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <Field
                      label={t(
                        "用戶提供的授權 ID（可選）",
                        "Customer grant ID (optional)",
                      )}
                    >
                      <input
                        name="grant"
                        placeholder={t(
                          "無授權時僅提供元資料",
                          "Metadata only without a grant",
                        )}
                        pattern="[a-fA-F0-9-]{36}"
                      />
                    </Field>
                    <Field label={t("支援原因", "Support reason")}>
                      <textarea
                        name="reason"
                        required
                        minLength={3}
                        maxLength={1000}
                        rows={3}
                      />
                    </Field>
                    <Field label={t("有效期限", "Access duration")}>
                      <select name="minutes" defaultValue="10">
                        <option value="5">{t("5 分鐘", "5 minutes")}</option>
                        <option value="10">{t("10 分鐘", "10 minutes")}</option>
                        <option value="30">{t("30 分鐘", "30 minutes")}</option>
                        <option value="60">{t("60 分鐘", "60 minutes")}</option>
                      </select>
                    </Field>
                    <p className="muted">
                      {t(
                        "期限不可超過用戶授權；敏感操作仍要求最近 10 分鐘內完成管理員 MFA。",
                        "The deadline cannot exceed the customer grant. A recent administrator MFA within 10 minutes is still required.",
                      )}
                    </p>
                    <button
                      className="button"
                      disabled={!tenant || busy}
                      type="submit"
                    >
                      <ShieldCheck size={16} />
                      {busy
                        ? t("處理中…", "Working…")
                        : t("建立只讀會話", "Start read-only session")}
                    </button>
                  </fieldset>
                </form>
              )}
            </>
          )}
          {receipt && (
            <p role="status" className="notice">
              {t("操作已確認", "Operation confirmed")}:{" "}
              <code>{receipt.id}</code> · {receipt.state}
            </p>
          )}
        </section>
        <section className="card">
          <div className="section-heading">
            <h2>{t("支援會話", "Support sessions")}</h2>
            <button
              type="button"
              className="icon-button"
              aria-label={t("更新支援會話", "Refresh support sessions")}
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          {loading && <Loading />}
          {!loading && !sessions.length && (
            <p className="muted">
              {t(
                "目前範圍內沒有支援會話。",
                "No support sessions in your current scope.",
              )}
            </p>
          )}
          <div className="support-session-grid">
            {sessions.map((session) => (
              <article className="support-record" key={session.id}>
                <strong>{state(session.state)}</strong>
                <code>{session.id}</code>
                <span>
                  {t("用戶", "Customer")}: <code>{session.user_id}</code>
                </span>
                <span>
                  {t("到期", "Expires")}:{" "}
                  <DateText value={session.expires_at} />
                </span>
                <div className="button-row">
                  {session.state === "active" && (
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => {
                        setError(null);
                        setActive(session.id);
                      }}
                    >
                      <Eye size={15} />
                      {t("只讀查看", "Open read-only view")}
                    </button>
                  )}
                  {session.state === "active" &&
                    access.has("admin.support.revoke") && (
                      <RevokeSession
                        id={session.id}
                        onRevoke={async (reason) => {
                          setBusy(true);
                          setError(null);
                          try {
                            const op = await post(
                              `/v1/admin/support/sessions/${session.id}/revocations`,
                              { reason },
                            );
                            setReceipt(op);
                            if (active === session.id) {
                              setActive("");
                              clearView();
                            }
                            await load();
                          } catch (e) {
                            setError(e as Error);
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy}
                      />
                    )}
                </div>
              </article>
            ))}
          </div>
          {next && (
            <button
              className="button secondary"
              type="button"
              disabled={loading}
              onClick={() => void load(next)}
            >
              {t("載入更多", "Load more")}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
function RevokeSession({
  id,
  disabled,
  onRevoke,
}: {
  id: string;
  disabled: boolean;
  onRevoke: (reason: string) => Promise<void>;
}) {
  const { t } = useI18n(),
    [open, setOpen] = useState(false);
  return (
    <div>
      {!open ? (
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {t("撤銷", "Revoke")}
        </button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason"));
            await onRevoke(reason);
            setOpen(false);
          }}
        >
          <Field label={t("撤銷原因", "Reason for revocation")}>
            <input
              name="reason"
              required
              minLength={3}
              maxLength={1000}
              aria-describedby={`revoke-${id}`}
            />
          </Field>
          <span id={`revoke-${id}`} className="sr-only">
            {id}
          </span>
          <button
            className="button secondary"
            type="submit"
            disabled={disabled}
          >
            {t("確認撤銷", "Confirm revocation")}
          </button>
        </form>
      )}
    </div>
  );
}
