import { useState } from "react";
import { CalendarDays, Pause, ChevronLeft, ChevronRight } from "lucide-react";
import { post } from "./api";
import "./private-cloud-schedules.css";
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

export function AdminPrivateCloudSchedules({
  canPause,
}: {
  canPause: boolean;
}) {
  const { t } = useI18n(),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [action, setAction] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const {
    data,
    error: readError,
    loading,
  } = useData(
    `/v1/admin/private-cloud-schedules?page=${page}&page_size=50`,
    refresh,
    15000,
  );
  return (
    <section
      className="section-block admin-cloud-plans"
      aria-label={t(
        "私有雲端計劃管理",
        "Private cloud schedule administration",
      )}
    >
      <div className="section-title">
        <div>
          <h2>
            <CalendarDays size={20} />{" "}
            {t("私有雲端計劃", "Private cloud schedules")}
          </h2>
          <p className="muted">
            {t(
              "依管理範圍查看運行資料並暫停未來觸發。計劃正文及對話保持私有；恢復費用授權由用戶重新確認。",
              "View execution metadata and pause future times within your scope. Plan text and conversations remain private; the customer confirms any resumption of paid work.",
            )}
          </p>
        </div>
      </div>
      <ErrorNotice error={readError} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("計劃／用戶", "Schedule / user")}</th>
              <th>{t("狀態", "State")}</th>
              <th>{t("時間與時區", "Time & zone")}</th>
              <th>{t("每次上限", "Per-run limit")}</th>
              <th>{t("下次觸發", "Next time")}</th>
              <th>{t("操作", "Action")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((s: any) => (
              <tr key={s.id} data-admin-cloud-schedule={s.id}>
                <td>
                  <code>{s.id.slice(0, 8)}</code>
                  <small className="muted">{s.private_owner}</small>
                </td>
                <td>
                  <Badge value={s.state} />
                  {s.last_error && (
                    <small className="muted">{s.last_error}</small>
                  )}
                </td>
                <td>
                  {s.calendar?.time}
                  <small className="muted">{s.calendar?.timezone}</small>
                </td>
                <td>
                  <Money value={s.max_budget_micros} />
                </td>
                <td>
                  {s.next_due_at
                    ? new Intl.DateTimeFormat(t("zh-HK", "en"), {
                        timeZone: s.calendar.timezone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(s.next_due_at))
                    : "—"}
                </td>
                <td>
                  {canPause && s.state === "active" && (
                    <button
                      className="button secondary small"
                      onClick={() => {
                        setError(null);
                        setAction({ row: s, key: crypto.randomUUID() });
                      }}
                    >
                      <Pause size={14} />
                      {t("暫停未來觸發", "Pause future times")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data?.items.length && (
        <p className="muted">
          {t("此範圍目前沒有私有計劃。", "No private schedules in this scope.")}
        </p>
      )}
      <div className="pagination">
        <span>
          {data?.total ?? 0} {t("筆計劃", "schedules")}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Previous private schedule page"
            disabled={loading || page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Next private schedule page"
            disabled={loading || page * 50 >= (data?.total ?? 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {action && (
        <Modal
          title={t(
            "暫停私有計劃的未來觸發",
            "Pause future times for private schedule",
          )}
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
                await post(
                  `/v1/admin/private-cloud-schedules/${action.row.id}/pause`,
                  { expected_version: action.row.version, reason },
                  action.key,
                );
                setAction(null);
                setRefresh((v) => v + 1);
              } catch (failure) {
                setError(failure);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              {t(
                "已開始的工作和已產生的費用會保留。管理員身分、理由及目標版本均會記錄。",
                "Current work and incurred costs remain. Your admin identity, reason and target version will be recorded.",
              )}
            </p>
            <Field label={t("操作原因", "Reason")}>
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={1000}
                disabled={busy}
              />
            </Field>
            <ErrorNotice error={error} />
            <button className="button primary" disabled={busy}>
              {t("確認暫停", "Confirm pause")}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
