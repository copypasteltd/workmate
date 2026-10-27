import { useEffect, useState } from "react";
import { Radio, Pause, RefreshCw } from "lucide-react";
import { post } from "./api";
import {
  useData,
  useI18n,
  Badge,
  Money,
  DateText,
  Modal,
  Field,
  ErrorNotice,
} from "./ui";
import "./private-cloud-events.css";

export function AdminPrivateCloudEvents({ canPause }: { canPause: boolean }) {
  const { t } = useI18n(),
    [page, setPage] = useState(1),
    [state, setState] = useState(""),
    [refresh, setRefresh] = useState(0),
    [action, setAction] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [confirmed, setConfirmed] = useState<Record<string, number>>({});
  const {
    data,
    error: readError,
    loading,
  } = useData(
    `/v1/admin/private-cloud-events?page=${page}&page_size=20${state ? "&state=" + state : ""}`,
    refresh,
    15000,
  );
  useEffect(() => {
    if (readError) setAction(null);
  }, [readError]);
  useEffect(() => {
    setAction(null);
    setError(null);
  }, [state, page]);
  return (
    <section
      className="section-block admin-event-work"
      aria-label={t("私有事件工作管理", "Private event work administration")}
    >
      <div className="section-title">
        <div>
          <h2>
            <Radio size={20} />
            {t("事件工作", "Event work")}
          </h2>
          <p className="muted">
            {t(
              "依授權範圍查看運行資料，並可暫停未來事件。恢復和費用由客戶重新確認。",
              "Review execution metadata within your scope and pause future events. Customers reconfirm resumption and costs.",
            )}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label={t("重新整理事件管理", "Refresh event administration")}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <Field label={t("依狀態篩選", "Filter by state")}>
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t("全部狀態", "All states")}</option>
          {["active", "paused", "blocked", "ended", "retired"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <ErrorNotice error={readError} />
      <div className="admin-event-grid">
        {data?.items.map((r: any) => (
          <article
            className="card admin-event-card"
            key={r.id}
            data-admin-event={r.id}
          >
            <header>
              <code>{r.id.slice(0, 8)}</code>
              <Badge value={r.state} />
            </header>
            <dl>
              <div>
                <dt>{t("所屬企業／項目", "Tenant / project")}</dt>
                <dd>
                  {r.tenant_id}
                  <br />
                  {r.project_id}
                </dd>
              </div>
              <div>
                <dt>{t("用戶", "User")}</dt>
                <dd>{r.private_owner}</dd>
              </div>
              <div>
                <dt>{t("方法／密鑰版本", "Method / key version")}</dt>
                <dd>
                  v{r.revision} / {r.key_version}
                </dd>
              </div>
              <div>
                <dt>{t("每次／每日上限", "Per-run / daily limit")}</dt>
                <dd>
                  {r.max_budget_micros === null ? (
                    "—"
                  ) : (
                    <>
                      <Money value={r.max_budget_micros} /> /{" "}
                      <Money value={r.max_daily_budget_micros} />
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("待處理事件", "Pending events")}</dt>
                <dd>{r.pending_events}</dd>
              </div>
              <div>
                <dt>{t("建立於", "Created")}</dt>
                <dd>
                  <DateText value={r.created_at} />
                </dd>
              </div>
            </dl>
            {r.last_error && <p className="muted">{r.last_error}</p>}
            {canPause && r.state === "active" && (
              <button
                className="button secondary small"
                disabled={r.version < (confirmed[r.id] ?? 0)}
                onClick={() => {
                  setError(null);
                  setAction({ row: r, key: crypto.randomUUID() });
                }}
              >
                <Pause size={14} />
                {t("暫停未來事件", "Pause future events")}
              </button>
            )}
          </article>
        ))}
      </div>
      {!loading && data && !data.items.length && (
        <p className="muted">
          {t(
            "此範圍沒有符合條件的事件工作。",
            "No matching event work in this scope.",
          )}
        </p>
      )}
      <div className="pagination">
        <span>
          {data?.total ?? 0} {t("筆工作", "workflows")}
        </span>
        <div>
          <button
            className="button secondary small"
            disabled={loading || page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("上一頁", "Previous")}
          </button>
          <button
            className="button secondary small"
            disabled={loading || page * 20 >= (data?.total ?? 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("下一頁", "Next")}
          </button>
        </div>
      </div>
      {action && (
        <Modal
          title={t("暫停未來事件", "Pause future events")}
          onClose={() => {
            if (!busy) setAction(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const reason = String(
                new FormData(e.currentTarget).get("reason"),
              );
              setBusy(true);
              setError(null);
              try {
                const r: any = await post(
                  `/v1/admin/private-cloud-events/${action.row.id}/pause`,
                  { expected_version: action.row.version, reason },
                  action.key,
                );
                setConfirmed((v) => ({ ...v, [action.row.id]: r.version }));
                setAction(null);
                setRefresh((v) => v + 1);
              } catch (error) {
                setError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              {t(
                "目前工作保留。此操作需要近期 MFA 和範圍內的暫停權限，並留下原因及稽核紀錄。",
                "Current work is preserved. This action requires recent MFA and scoped pause permission and records your reason in the audit log.",
              )}
            </p>
            <Field label={t("原因", "Reason")}>
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={1000}
                rows={3}
                disabled={busy}
              />
            </Field>
            <ErrorNotice error={error} />
            <button
              className="button primary"
              type="submit"
              disabled={
                busy ||
                !canPause ||
                !data ||
                data.items.find((r: any) => r.id === action.row.id)?.version !==
                  action.row.version
              }
            >
              {t("確認暫停", "Confirm pause")}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
