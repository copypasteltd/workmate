import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { api } from "./api";
import { DateText, ErrorNotice, Loading, Modal, useI18n } from "./ui";
import type { CapabilityAccess } from "./capability-model";
import "./conversation-history.css";

export const adminHistoryKinds = ["conversations", "agents", "memories", "brand_profiles", "agent_groups", "project_configurations", "workflow_schedules", "creative_projects", "workflows", "workflow_runs"] as const;
type HistoryKind = typeof adminHistoryKinds[number];
export const hasAdminHistory = (kind: string): kind is HistoryKind => (adminHistoryKinds as readonly string[]).includes(kind);
type Message = { id?: string; role?: "user" | "assistant"; intent?: string; body: string | Record<string, any> | null;
  task_id?: string | null; created_at: string; source_unavailable?: boolean;
  version?: number; origin?: "administrator" | "customer" | "retained_current" | "system_snapshot";
  definition?: Record<string, any> | null; series_id?: string; name?: string; sha256?: string };
type Page = { id: string; name: string; history_revision: string; version: number;
  moderation_version: number; page_size: number; items: Message[];
  previous_cursor: string | null; next_cursor: string | null; history_scope?: "retained_versions" | "current_snapshot"; content_kind?: string };
type Position = { edge: "first" | "last" } | { cursor: string };
const allowed = (access: CapabilityAccess) =>
  ["admin.content.read", "admin.content.body.read"].every(p => access.has(p));
const identity = (page: Page) => JSON.stringify([page.history_revision, page.version, page.moderation_version, page.items]);

/** One bounded page in memory. No message bodies, cursors or operator state are persisted. */
export function AdminConversationHistory({ id, kind, access, onClose }: {
  id: string; kind: HistoryKind; access: CapabilityAccess; onClose: () => void;
}) {
  const { t } = useI18n(), [storedPage, setPage] = useState<Page | null>(null),
    [error, setError] = useState<Error | null>(null), [busy, setBusy] = useState(false),
    sequence = useRef(0), live = useRef(true), pending = useRef<number | null>(null),
    current = useRef<{page: Page; position: Position; scope: string} | null>(null), heading = useRef<HTMLHeadingElement>(null),
    controller = useRef<AbortController | null>(null),
    actor = access.me.user.id, actorRef = useRef(actor);
  const canRead = allowed(access), permitted = useRef(canRead);
  const messages = kind === "conversations", runSnapshot = kind === "workflow_runs", scope = `${actor}:${kind}:${id}`, scopeRef = useRef(scope);
  // Update synchronously during a render so late results cannot cross accounts.
  actorRef.current = actor;
  scopeRef.current = scope;
  permitted.current = canRead;
  const page = canRead && current.current?.scope === scope ? storedPage : null;
  function clear(reason: Error | null) {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    pending.current = null;
    current.current = null;
    setPage(null);
    setError(reason);
    setBusy(false);
  }
  const path = (position: Position) => `/v1/admin/content/${kind}/${id}/history?` + new URLSearchParams(position);
  async function load(position: Position, poll = false) {
    if (pending.current || !permitted.current) return;
    const request = ++sequence.current, account = actorRef.current, requestScope = scopeRef.current, before = current.current;
    const abort = new AbortController();
    controller.current = abort;
    pending.current = request;
    if (!poll) { setBusy(true); setError(null); setPage(null); current.current = null; }
    try {
      const result = await api<Page>(path(position), {signal: abort.signal});
      if (!live.current || request !== sequence.current || requestScope !== scopeRef.current || account !== actorRef.current || !permitted.current) return;
      if (poll && before && identity(before.page) !== identity(result)) {
        clear(new Error(t("內容或可讀範圍已變更。請重新載入，再繼續閱讀。",
          "This content or its readable sources changed. Refresh before continuing.")));
        return;
      }
      current.current = { page: result, position, scope: requestScope };
      setPage(result);
      if (!poll) requestAnimationFrame(() => heading.current?.focus({preventScroll: true}));
    } catch (e) {
      if (live.current && request === sequence.current && requestScope === scopeRef.current && account === actorRef.current) clear(e as Error);
    } finally {
      if (pending.current === request) pending.current = null;
      if (controller.current === abort) controller.current = null;
      if (live.current && request === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    live.current = true;
    clear(null);
    void load({ edge: "first" });
    return () => { live.current = false; sequence.current++; controller.current?.abort(); current.current = null; };
  }, [id, kind, actor]);
  useEffect(() => {
    if (!canRead) clear(new Error(t("目前權限不允許閱讀此內容。", "Your current permissions do not allow reading this content.")));
  }, [canRead]);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "hidden" && current.current && !pending.current)
        void load(current.current.position, true);
    };
    const interval = window.setInterval(check, 15000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check); };
  }, [id, kind, actor]);
  const disabled = busy || !canRead;
  return <Modal title={runSnapshot ? t("工作流執行資料", "Workflow execution details") : messages ? t("完整對話記錄", "Full conversation history") : t("完整版本記錄", "Full version history")} onClose={onClose}>
    <div className="conversation-history">
      <p className="muted">{runSnapshot ? t("閱讀目前執行快照。來源與權限會持續復查；此頁不代表歷次執行狀態的版本歷史。",
        "Read the current execution snapshot. Sources and permissions are rechecked; this page is not a version history of execution states.") : messages ? t("按原始順序分頁閱讀。每頁最多 50 則，保留訊息來源與時間。",
        "Read the original message order, up to 50 messages per page, with their source and time.")
        : t("從最新版本開始分頁閱讀。每頁最多 50 版，保留原始內容、來源與時間。",
          "Read from the newest version, up to 50 versions per page, with original content, provenance and time.")}</p>
      <ErrorNotice error={error}/>
      {page?.history_scope === "retained_versions" && <p className="conversation-history-coverage" role="note">{t(
        "此處顯示實際已保存的版本。早期未保存的內容不會重建；批量設計按作品分組，再按版本排列。",
        "Only saved versions are shown. Earlier unsaved content is not reconstructed. Batch designs are grouped by work, then by version.")}</p>}
      <nav className="conversation-history-navigation" aria-label={messages ? t("對話翻頁", "Conversation pages") : t("版本翻頁", "Version pages")}>
        {!runSnapshot && <>
          <button className="button secondary" disabled={disabled} onClick={() => void load({edge: "first"})}>{messages ? t("最早訊息", "Earliest") : t("最新版本", "Newest")}</button>
          <button className="button secondary" disabled={disabled || !page?.previous_cursor} onClick={() => page?.previous_cursor && void load({cursor: page.previous_cursor})}><ArrowLeft size={15}/>{t("上一頁", "Previous")}</button>
          <button className="button secondary" disabled={disabled || !page?.next_cursor} onClick={() => page?.next_cursor && void load({cursor: page.next_cursor})}>{t("下一頁", "Next")}<ArrowRight size={15}/></button>
          <button className="button secondary" disabled={disabled} onClick={() => void load({edge: "last"})}>{messages ? t("最新訊息", "Latest") : t("最早版本", "Oldest")}</button>
        </>}
        <button className="button secondary" disabled={disabled} onClick={() => void load({edge: "first"})}><RefreshCw size={15}/>{t("重新載入", "Refresh")}</button>
      </nav>
      {busy && <Loading/>}
      {page && <section aria-live="polite" aria-busy={busy}>
        <h3 ref={heading} tabIndex={-1}>{runSnapshot ? t("工作流執行", "Workflow run") : page.name}</h3>
        <p className="muted" role="status">{runSnapshot ? t("目前可讀執行快照", "Current readable execution snapshot") : messages ? t(`本頁 ${page.items.length} 則訊息`, `${page.items.length} messages on this page`)
          : t(`本頁 ${page.items.length} 個版本`, `${page.items.length} versions on this page`)}</p>
        {page.items.length === 0 && <p>{t("目前沒有記錄。", "No records yet.")}</p>}
        <ol className="conversation-history-messages">
          {page.items.map(item => <li key={item.id ?? `${item.series_id ?? ""}:${item.version}`} data-message-id={item.id} data-version={item.version} data-series-id={item.series_id}>
            <header><strong>{runSnapshot ? t("執行快照", "Execution snapshot") : messages ? (item.role === "user" ? t("客戶", "Customer") : t("AI 助手", "AI assistant")) : `v${item.version}`}</strong>
              <span>{messages ? (item.intent === "note" ? t("補充資料", "Note") : item.intent === "delegate" ? t("工作要求", "Work request") : t("工作結果", "Result"))
                : item.origin === "administrator" ? t("管理員修訂", "Administrator revision")
                : item.origin === "retained_current" ? t("遷移時保留的現有版本", "Existing version retained at migration")
                : item.origin === "system_snapshot" ? t("系統保存的版本", "System snapshot") : t("客戶版本", "Customer version")}</span>
              <DateText value={item.created_at}/></header>
            {item.name && <p className="conversation-history-version-name">{item.name}</p>}
            <div className="conversation-history-text">{item.source_unavailable
              ? t("原始來源已不可用，此版本正文暫不提供。", "The original sources are unavailable; this version body is not available.")
              : typeof item.body === "object" && item.body !== null ? (item.body.instructions ?? item.body.title ?? item.body.name
                ?? t("展開下方資料，閱讀此版本的完整內容。", "Expand the record below to read this saved version.")) : item.body}</div>
            {item.sha256 && <p className="conversation-history-digest" title={item.sha256}>SHA-256 · {item.sha256}</p>}
            {!messages && (typeof item.body === "object" && item.body !== null || item.definition) && <details>
              <summary>{t("完整版本資料", "Complete version record")}</summary>
              <pre className="conversation-history-text">{JSON.stringify(item.definition ?? item.body, null, 2)}</pre>
            </details>}
          </li>)}
        </ol>
      </section>}
    </div>
  </Modal>;
}
