import { useState } from "react";
import {
  CalendarDays,
  Clock,
  Pause,
  Play,
  Pencil,
  History,
  Trash2,
} from "lucide-react";
import { post } from "./api";
import { useWorkspace } from "./context";
import {
  useI18n,
  useData,
  ErrorNotice,
  Modal,
  AsyncForm,
  Field,
  Badge,
  Money,
  DateText,
} from "./ui";

const weekdays: [string, string][] = [
  ["週一", "Mon"],
  ["週二", "Tue"],
  ["週三", "Wed"],
  ["週四", "Thu"],
  ["週五", "Fri"],
  ["週六", "Sat"],
  ["週日", "Sun"],
];
const deviceTime = (value: string | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function Schedules({ workflows }: { workflows: any[] }) {
  const { t } = useI18n(),
    w = useWorkspace();
  const [refresh, setRefresh] = useState(0),
    [editor, setEditor] = useState<any>(null),
    [action, setAction] = useState<any>(null),
    [detail, setDetail] = useState<string | null>(null);
  const base = w.base + "/workflow-schedules",
    { data, error } = useData(base, refresh, 5000);
  const versions = useData(detail ? base + "/" + detail : null, refresh);
  const manage = ["owner", "admin"].includes(
    w.me?.memberships?.find((m: any) => m.id === w.tenant)?.role,
  );
  const published = workflows.filter((r) => r.state === "published");
  const bump = () => setRefresh((v) => v + 1);
  return (
    <section className="section-block schedule-section">
      <div className="section-title">
        <div>
          <h2>
            <CalendarDays size={22} /> {t("雲端定時執行", "Cloud schedules")}
          </h2>
          <p className="muted">
            {t(
              "關閉頁面後仍會執行；暫停只停止未來觸發，不取消進行中的工作。",
              "Work continues after you close the page. Pausing stops future triggers and keeps current work intact.",
            )}
          </p>
        </div>
        {manage && (
          <button
            className="button secondary"
            disabled={!published.length}
            onClick={() => setEditor({})}
          >
            <Clock size={16} />
            {t("新增定時", "Add schedule")}
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      {!data?.items?.length && (
        <p className="muted">
          {t(
            "發佈一個工作流程後，可安排每日或每週執行。",
            "Publish a workflow to schedule it daily or weekly.",
          )}
        </p>
      )}
      <div className="project-grid">
        {data?.items?.map((s: any) => (
          <article className="card schedule-card" key={s.id}>
            <header>
              <Clock size={21} />
              <Badge value={s.state} />
            </header>
            <h3>{s.name}</h3>
            <p>
              {s.body.calendar?.frequency === "daily"
                ? t("每日", "Daily")
                : s.body.calendar?.weekdays
                    .map((d: number) => t(...weekdays[d - 1]))
                    .join(", ")}{" "}
              · {s.body.calendar?.time} · {s.body.calendar?.timezone}
            </p>
            <dl className="schedule-facts">
              <div>
                <dt>{t("下一次觸發", "Next trigger")}</dt>
                <dd>
                  <DateText value={s.next_due_at} />
                </dd>
              </div>
              <div>
                <dt>{t("每次 Agent 預算上限", "Agent budget per run")}</dt>
                <dd>
                  <Money value={s.body.max_budget_micros} />
                </dd>
              </div>
              <div>
                <dt>{t("設定版本", "Configuration")}</dt>
                <dd>
                  v{s.revision} · {t("工作流程", "workflow")} v
                  {s.body.workflow_version}
                </dd>
              </div>
            </dl>
            {s.last_error && (
              <p className="notice error">
                {t(
                  "執行已停止，請檢查帳號權限、工作流程或服務設定後再確認恢復。",
                  "Execution is blocked. Review account access, the workflow and service settings before resuming.",
                )}{" "}
                <small>{s.last_error}</small>
              </p>
            )}
            <footer>
              <button
                className="button secondary small"
                onClick={() => setDetail(s.id)}
              >
                <History size={15} />
                {t("版本與紀錄", "Versions & history")}
              </button>
              {manage && s.state !== "retired" && (
                <>
                  <button
                    className="icon-button"
                    title={t("修改定時", "Edit schedule")}
                    onClick={() => setEditor(s)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title={
                      s.state === "active"
                        ? t("暫停定時", "Pause schedule")
                        : t("恢復定時", "Resume schedule")
                    }
                    onClick={() =>
                      setAction({
                        row: s,
                        action: s.state === "active" ? "pause" : "resume",
                      })
                    }
                  >
                    {s.state === "active" ? (
                      <Pause size={16} />
                    ) : (
                      <Play size={16} />
                    )}
                  </button>
                  <button
                    className="icon-button"
                    title={t("停止此定時", "Retire schedule")}
                    onClick={() => setAction({ row: s, action: "retire" })}
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </footer>
          </article>
        ))}
      </div>
      {data?.occurrences?.length > 0 && (
        <div className="schedule-history">
          <h3>{t("最近觸發", "Recent triggers")}</h3>
          {data.occurrences.slice(0, 20).map((o: any) => (
            <div className="schedule-history-row" key={o.id}>
              <div>
                <strong>
                  {data.items.find((s: any) => s.id === o.schedule_id)?.name ??
                    t("已停止的定時", "Retired schedule")}
                </strong>
                <small>
                  {o.scheduled_local.replace("T", " ")} · v{o.revision}
                  {o.missed_count > 0
                    ? ` · ${t("合併略過", "coalesced")} ${o.missed_count}`
                    : ""}
                </small>
              </div>
              <Badge value={o.state} />
              {o.run_state && <Badge value={o.run_state} />}
            </div>
          ))}
        </div>
      )}
      {editor && (
        <ScheduleEditor
          row={editor}
          workflows={published}
          base={base}
          onClose={() => setEditor(null)}
          onDone={() => {
            setEditor(null);
            bump();
          }}
        />
      )}
      {action && (
        <Modal
          title={
            action.action === "resume"
              ? t("確認恢復定時", "Confirm schedule resumption")
              : action.action === "pause"
                ? t("暫停未來觸發", "Pause future triggers")
                : t("停止此定時", "Retire this schedule")
          }
          onClose={() => setAction(null)}
        >
          <AsyncForm
            submitLabel={t("確認", "Confirm")}
            onSubmit={async () => {
              await post(base + "/" + action.row.id + "/status", {
                expected_version: action.row.version,
                action: action.action,
              });
              setAction(null);
              bump();
            }}
          >
            <p>{action.row.name}</p>
            <p className="muted">
              {action.action === "resume"
                ? t(
                    "從現在起使用你的帳號授權執行，不補跑暫停期間的工作。設定與每次預算會保留。",
                    "Future work will run under your authorization from now, with the saved settings and per-run budget. The paused interval is skipped.",
                  )
                : t(
                    "進行中的工作會保留；如需取消，請在執行紀錄中另外取消。",
                    "Current work is preserved. Cancel a current run separately in workflow history.",
                  )}
            </p>
            {action.action === "resume" && (
              <label className="check-label">
                <input type="checkbox" required />
                {t(
                  "我確認未來執行及每次預算。",
                  "I authorize future runs and the per-run budget.",
                )}
              </label>
            )}
          </AsyncForm>
        </Modal>
      )}
      {detail && (
        <Modal
          title={t("定時版本與觸發紀錄", "Schedule versions & triggers")}
          onClose={() => setDetail(null)}
        >
          <ErrorNotice error={versions.error} />
          <p className="muted">
            {t(
              "每次設定會保留當時的時區、工作流程和執行身分。較舊的漏跑時間會合併顯示，不逐次收費執行。",
              "Each version preserves its time zone, workflow and execution identity. Older missed times are coalesced instead of launching a separate paid run for each.",
            )}
          </p>
          {versions.data?.versions?.map((v: any) => (
            <div className="card schedule-version" key={v.revision}>
              <strong>
                v{v.revision} · {v.body.calendar.time} ·{" "}
                {v.body.calendar.timezone}
              </strong>
              <p>
                {t("工作流程", "Workflow")} v{v.body.workflow_version} ·{" "}
                <DateText value={v.created_at} />
              </p>
              <p>
                {v.body.catch_up === "latest"
                  ? t("漏跑只補最近一次", "Catch up latest only")
                  : t("略過漏跑", "Skip missed times")}
              </p>
            </div>
          ))}
          {data?.occurrences
            ?.filter((o: any) => o.schedule_id === detail)
            .map((o: any) => (
              <div className="schedule-history-row" key={o.id}>
                <div>
                  {o.scheduled_local.replace("T", " ")}
                  <small>
                    {o.scheduled_at
                      ? new Date(o.scheduled_at).toISOString()
                      : t("此本地時刻不存在", "This wall time does not exist")}
                    {o.through_local &&
                      ` → ${o.through_local.replace("T", " ")}`}
                  </small>
                </div>
                <Badge value={o.state} />
              </div>
            ))}
        </Modal>
      )}
    </section>
  );
}

function ScheduleEditor({
  row,
  workflows,
  base,
  onClose,
  onDone,
}: {
  row: any;
  workflows: any[];
  base: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [preview, setPreview] = useState<any>(null),
    [frequency, setFrequency] = useState(
      row.body?.calendar.frequency ?? "daily",
    );
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Modal
      title={
        row.id
          ? t("修改定時設定", "Edit schedule")
          : t("安排雲端定時", "Schedule cloud work")
      }
      onClose={onClose}
    >
      {preview ? (
        <AsyncForm
          key="confirm"
          submitLabel={t("確認並啟用定時", "Confirm & enable schedule")}
          onSubmit={async () => {
            const body = {
              ...preview.input,
              expected_workflow_version: preview.workflow_version,
              expected_definition_hash: preview.definition_hash,
            };
            await post(
              row.id ? base + "/" + row.id + "/versions" : base,
              row.id ? { ...body, expected_version: row.version } : body,
            );
            onDone();
          }}
        >
          <h3>{preview.input.name}</h3>
          <p>
            {preview.input.calendar.timezone} ·{" "}
            {t("工作流程版本", "Workflow version")} {preview.workflow_version}
          </p>
          <p>
            {t("每次 Agent 預算上限", "Maximum Agent budget per run")}:{" "}
            <strong>
              <Money value={preview.max_budget_micros} />
            </strong>
          </p>
          <p className="muted">
            {t(
              "這是 Agent 步驟的預算上限，不是報價或預先扣費；實際費用依完成的步驟結算。",
              "This caps Agent steps; it is neither a quote nor an upfront charge. Actual usage is settled for completed steps.",
            )}
          </p>
          <h4>{t("接下來的時刻", "Upcoming times")}</h4>
          {preview.next.map((n: any) => (
            <div className="schedule-time" key={n.local}>
              <strong>{n.local.replace("T", " ")}</strong>
              <small>
                {n.daylight_gap
                  ? t(
                      "夏令時不存在的時刻，會略過",
                      "Nonexistent wall time; will skip",
                    )
                  : new Date(n.scheduled_at)
                      .toISOString()
                      .replace("T", " ")
                      .replace(".000Z", " UTC")
                      .replace("Z", " UTC")}
              </small>
            </div>
          ))}
          <p className="muted">
            {t(
              "夏令時重複時刻只執行第一次；已有工作未結束時會略過新觸發。",
              "Repeated wall times run at their first instant once. A current unfinished run prevents overlap.",
            )}
          </p>
          <label className="check-label">
            <input type="checkbox" name="authorize" required />
            {t(
              "我確認以我的帳號執行未來工作並使用上述每次預算。",
              "I authorize future work under my account using the per-run budget shown above.",
            )}
          </label>
          <button
            type="button"
            className="button secondary"
            onClick={() => setPreview(null)}
          >
            {t("返回修改", "Back to edit")}
          </button>
        </AsyncForm>
      ) : (
        <AsyncForm
          key="edit"
          submitLabel={t("預覽執行時間", "Preview schedule")}
          onSubmit={async (f) => {
            const start = String(f.get("starts_at") ?? ""),
              end = String(f.get("ends_at") ?? "");
            setPreview(
              await post(base + "/preview", {
                name: String(f.get("name")),
                workflow_id: row.workflow_id ?? String(f.get("workflow")),
                calendar: {
                  timezone: String(f.get("timezone")),
                  frequency,
                  time: String(f.get("time")),
                  weekdays:
                    frequency === "weekly"
                      ? f.getAll("weekdays").map(Number)
                      : [],
                },
                catch_up: String(f.get("catch_up")),
                ...(start ? { starts_at: new Date(start).toISOString() } : {}),
                ends_at: end ? new Date(end).toISOString() : null,
              }),
            );
          }}
        >
          <Field label={t("定時名稱", "Schedule name")}>
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={
                row.name ?? t("行銷報表定時", "Scheduled campaign report")
              }
            />
          </Field>
          <Field label={t("已發佈工作流程", "Published workflow")}>
            <select
              name="workflow"
              required
              disabled={!!row.id}
              defaultValue={row.workflow_id ?? ""}
            >
              <option value="">{t("選擇工作流程", "Choose a workflow")}</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · v{w.version}
                </option>
              ))}
            </select>
          </Field>
          <div className="schedule-form-grid">
            <Field label={t("頻率", "Frequency")}>
              <select
                name="frequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="daily">{t("每日", "Daily")}</option>
                <option value="weekly">{t("每週", "Weekly")}</option>
              </select>
            </Field>
            <Field label={t("執行時刻", "Wall time")}>
              <input
                name="time"
                type="time"
                required
                defaultValue={row.body?.calendar.time ?? "09:00"}
              />
            </Field>
          </div>
          {frequency === "weekly" && (
            <fieldset className="schedule-weekdays">
              <legend>{t("星期", "Weekdays")}</legend>
              {weekdays.map((d, i) => (
                <label key={i}>
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={i + 1}
                    defaultChecked={(
                      row.body?.calendar.weekdays ?? [1]
                    ).includes(i + 1)}
                  />
                  {t(...d)}
                </label>
              ))}
            </fieldset>
          )}
          <Field label={t("執行時區（IANA）", "Schedule time zone (IANA)")}>
            <input
              name="timezone"
              required
              list="schedule-timezones"
              defaultValue={row.body?.calendar.timezone ?? "Asia/Hong_Kong"}
            />
            <datalist id="schedule-timezones">
              {[
                "Asia/Hong_Kong",
                "Asia/Taipei",
                "Asia/Singapore",
                "Asia/Tokyo",
                "Europe/London",
                "America/New_York",
                "America/Los_Angeles",
                "UTC",
              ].map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Field>
          <Field label={t("服務漏跑時", "Missed runs")}>
            <select
              name="catch_up"
              defaultValue={row.body?.catch_up ?? "latest"}
            >
              <option value="latest">
                {t("只補最近一次", "Catch up latest only")}
              </option>
              <option value="skip">
                {t(
                  "略過逾時超過一分鐘的觸發",
                  "Skip triggers over a minute late",
                )}
              </option>
            </select>
          </Field>
          <div className="schedule-form-grid">
            <Field
              label={t(
                "開始時間（選填，本機時區）",
                "Start (optional, device time)",
              )}
            >
              <input name="starts_at" type="datetime-local" />
            </Field>
            <Field
              label={t(
                "結束時間（選填，本機時區）",
                "End (optional, device time)",
              )}
            >
              <input
                name="ends_at"
                type="datetime-local"
                defaultValue={deviceTime(row.body?.ends_at)}
              />
            </Field>
          </div>
          <p className="muted small-text">
            {t("日期欄位使用本機時區", "Date fields use your device time zone")}
            : {zone}.{" "}
            {t(
              "留空即從現在開始。設定修改後只影響未來觸發。",
              "Leave start blank to begin now. Changes affect future triggers.",
            )}
          </p>
        </AsyncForm>
      )}
    </Modal>
  );
}
