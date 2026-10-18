import { useState } from "react";
import {
  CalendarDays,
  Pause,
  Play,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { post } from "./api";
import {
  useData,
  useI18n,
  ErrorNotice,
  Modal,
  AsyncForm,
  Field,
  Badge,
  DateText,
} from "./ui";

export function AdminSchedules({
  canPause,
  canResume,
}: {
  canPause: boolean;
  canResume: boolean;
}) {
  const { t } = useI18n(),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [refresh, setRefresh] = useState(0),
    [action, setAction] = useState<any>(null);
  const { data, error } = useData(
    "/v1/admin/workflow-schedules?page=" +
      page +
      "&page_size=25&search=" +
      encodeURIComponent(search),
    refresh,
    15000,
  );
  return (
    <section className="section-block">
      <div className="section-title">
        <div>
          <h2>
            <CalendarDays size={20} />{" "}
            {t("雲端定時控制", "Cloud schedule controls")}
          </h2>
          <p className="muted">
            {t(
              "按授權範圍檢視和暫停未來觸發。恢復保留原使用者授權；被撤銷的授權需由項目管理員重新確認。",
              "Inspect and pause future triggers within your scope. Resumption retains the original user authorization; revoked authorization requires a project administrator to confirm again.",
            )}
          </p>
        </div>
      </div>
      <label className="search-field">
        <input
          aria-label={t("搜尋定時", "Search schedules")}
          placeholder={t("搜尋定時名稱", "Search schedule names")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <ErrorNotice error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("名稱", "Name")}</th>
              <th>{t("狀態", "State")}</th>
              <th>{t("時刻與時區", "Time & zone")}</th>
              <th>{t("下次觸發", "Next trigger")}</th>
              <th>{t("版本", "Version")}</th>
              <th>{t("動作", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items?.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  <small className="muted">{r.last_error ?? ""}</small>
                </td>
                <td>
                  <Badge value={r.state} />
                </td>
                <td>
                  {r.calendar?.time}
                  <small className="muted">{r.calendar?.timezone}</small>
                </td>
                <td>
                  <DateText value={r.next_due_at} />
                </td>
                <td>
                  {r.revision} / {r.version}
                </td>
                <td>
                  {r.content_state === "active" &&
                    r.state !== "retired" &&
                    (r.state === "active" ? canPause : canResume) && (
                      <button
                        className="button secondary small"
                        onClick={() =>
                          setAction({
                            row: r,
                            kind: r.state === "active" ? "pause" : "resume",
                          })
                        }
                      >
                        {r.state === "active" ? (
                          <Pause size={15} />
                        ) : (
                          <Play size={15} />
                        )}{" "}
                        {r.state === "active"
                          ? t("暫停定時", "Pause schedule")
                          : t("恢復定時", "Resume schedule")}
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data?.items?.length && (
        <p className="muted">
          {t("此範圍目前沒有定時。", "There are no schedules in this scope.")}
        </p>
      )}
      <div className="pagination">
        <span>
          {data?.total ?? 0} {t("筆定時", "schedules")} · {t("目前第", "Page")}{" "}
          {page}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Previous schedule page"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Next schedule page"
            disabled={page * 25 >= (data?.total ?? 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {action && (
        <Modal
          title={
            action.kind === "pause"
              ? t("暫停未來定時", "Pause future schedule")
              : t("恢復未來定時", "Resume future schedule")
          }
          onClose={() => setAction(null)}
        >
          <AsyncForm
            submitLabel={t("確認操作", "Confirm action")}
            onSubmit={async (f) => {
              await post(
                "/v1/admin/workflow-schedules/" +
                  action.row.id +
                  "/" +
                  action.kind,
                {
                  expected_version: action.row.version,
                  reason: String(f.get("reason")),
                },
              );
              setAction(null);
              setRefresh((v) => v + 1);
            }}
          >
            <p>{action.row.name}</p>
            <p className="muted">
              {t(
                "不取消已開始的工作；不補跑暫停期間的觸發。此操作會記錄你的管理員身分。",
                "Current work is preserved and paused times are skipped. Your administrator identity is recorded.",
              )}
            </p>
            <Field label={t("操作原因", "Reason")}>
              <textarea name="reason" required minLength={5} maxLength={1000} />
            </Field>
          </AsyncForm>
        </Modal>
      )}
    </section>
  );
}
