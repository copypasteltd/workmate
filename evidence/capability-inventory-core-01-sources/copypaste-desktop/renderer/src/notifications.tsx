import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Bell, Check, RefreshCw } from "lucide-react";
import { patch } from "./api";
import { useWorkspace } from "./context";
import {
  Badge,
  DateText,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  useData,
  useI18n,
} from "./ui";
interface WorkNotification {
  id: string;
  project_id: string;
  conversation_id?: string;
  task_id: string;
  task_title?: string;
  kind: string;
  read: boolean;
  created_at: string;
}
interface Inbox {
  items: WorkNotification[];
  next_cursor: string | null;
}
export function UnreadNotifications() {
  const w = useWorkspace(),
    { t } = useI18n(),
    [refresh, setRefresh] = useState(0);
  const data = useData<Inbox>(
    w.tenant
      ? `/v1/tenants/${w.tenant}/notifications?unread=true&limit=1`
      : null,
    refresh,
    15000,
  );
  useEffect(() => {
    const update = () => setRefresh((v) => v + 1);
    document.addEventListener("cp:notifications", update);
    return () => document.removeEventListener("cp:notifications", update);
  }, []);
  return !data.error && data.data?.items.length ? (
    <span
      className="notification-dot"
      role="status"
      aria-label={t("有未讀通知", "Unread notifications")}
    />
  ) : null;
}
export function Notifications() {
  const w = useWorkspace(),
    { t } = useI18n(),
    nav = useNavigate();
  const [refresh, setRefresh] = useState(0),
    [unread, setUnread] = useState(false),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [scope, setScope] = useState(w.tenant),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState("");
  useEffect(() => {
    setCursors([null]);
    setScope(w.tenant);
    setError(null);
  }, [w.tenant]);
  const cursor = scope === w.tenant ? cursors[cursors.length - 1] : null;
  const base = `/v1/tenants/${w.tenant}/notifications`,
    url =
      base +
      "?limit=50" +
      (unread ? "&unread=true" : "") +
      (cursor ? "&cursor=" + cursor : "");
  const data = useData<Inbox>(url, refresh, 15000),
    inbox = data.error ? null : data.data;
  async function change(n: WorkNotification, read: boolean, open = false) {
    setBusy(n.id);
    setError(null);
    try {
      await patch(base + "/" + n.id, { read });
      setRefresh((v) => v + 1);
      document.dispatchEvent(new Event("cp:notifications"));
      if (open) {
        w.setProject(n.project_id);
        nav("/app/tasks/" + n.task_id);
      }
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="KEEP YOUR WORK IN SIGHT."
        title={t("工作通知", "Work notifications")}
        description={t(
          "執行進度、完成結果和待處理事項。點擊後直接查看對應工作。",
          "Progress, results and work that needs attention. Open a notification to go straight to its task.",
        )}
        action={
          <button
            className="button"
            onClick={() => {
              setCursors([null]);
              setRefresh((v) => v + 1);
            }}
          >
            <RefreshCw size={16} />
            {t("重新整理", "Refresh")}
          </button>
        }
      />
      <p className="muted small-text">
        {t(
          "只顯示你目前有權限查看的工作；通知保留 30 天。",
          "Only work you can currently access appears here. Notifications are retained for 30 days.",
        )}
      </p>
      <div className="tabs section-block">
        {[false, true].map((value) => (
          <button
            key={String(value)}
            className={unread === value ? "active" : ""}
            onClick={() => {
              setUnread(value);
              setCursors([null]);
            }}
          >
            {value ? t("未讀", "Unread") : t("全部", "All")}
          </button>
        ))}
      </div>
      <ErrorNotice error={data.error ?? error} />
      {data.loading && !inbox ? (
        <Loading />
      ) : inbox?.items.length ? (
        <div className="notification-list">
          {inbox.items.map((n) => (
            <article
              className={"card notification-card" + (!n.read ? " unread" : "")}
              key={n.id}
              data-notification={n.id}
            >
              <Bell size={21} />
              <div className="notification-copy">
                {n.task_title && (
                  <strong className="notification-title">{n.task_title}</strong>
                )}
                <Badge value={n.kind} />
                <p className="muted small-text">
                  {w.projects.find((p) => p.id === n.project_id)?.name ??
                    t("專案工作", "Project task")}{" "}
                  · <DateText value={n.created_at} />
                </p>
              </div>
              <div className="row-actions">
                <button
                  className="text-button"
                  disabled={busy === n.id}
                  onClick={() => void change(n, !n.read)}
                >
                  <Check size={15} />
                  {n.read
                    ? t("標為未讀", "Mark unread")
                    : t("標為已讀", "Mark read")}
                </button>
                <button
                  className="button"
                  disabled={busy === n.id}
                  onClick={() => void change(n, true, true)}
                >
                  {t("查看工作", "Open task")}
                  <ArrowRight size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        !data.error && (
          <Empty
            icon={Bell}
            title={t("暫時沒有通知", "No notifications yet")}
            body={t(
              "工作執行、完成或需要處理時，通知會出現在這裡。",
              "Updates appear here as work runs, finishes or needs attention.",
            )}
          />
        )
      )}
      <div className="row-actions section-block">
        <button
          className="button"
          disabled={cursors.length < 2 || data.loading}
          onClick={() => setCursors((v) => v.slice(0, -1))}
        >
          {t("上一頁", "Previous page")}
        </button>
        <button
          className="button"
          disabled={!inbox?.next_cursor || data.loading}
          onClick={() => {
            if (inbox?.next_cursor)
              setCursors((v) => [...v, inbox.next_cursor]);
          }}
        >
          {t("下一頁", "Next page")}
        </button>
      </div>
    </>
  );
}
