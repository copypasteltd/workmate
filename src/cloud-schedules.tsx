import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  Clock3,
  Pause,
  Play,
  Pencil,
  Square,
  RefreshCw,
  LockKeyhole,
  ArrowUpRight,
} from "lucide-react";
import { post } from "./api";
import { useWorkspace } from "./context";
import {
  useData,
  useI18n,
  Modal,
  ErrorNotice,
  Badge,
  Money,
  DateText,
  Field,
} from "./ui";
import "./cloud-schedules.css";

const announce = () =>
  window.dispatchEvent(new Event("copypaste:cloud-schedules"));
const days = [
  ["週一", "Mon"],
  ["週二", "Tue"],
  ["週三", "Wed"],
  ["週四", "Thu"],
  ["週五", "Fri"],
  ["週六", "Sat"],
  ["週日", "Sun"],
] as const;
const localDate = (v?: string) =>
  v
    ? new Date(Date.parse(v) - new Date(v).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";

export function ScheduleFacts({ row }: { row: any }) {
  const { t } = useI18n(),
    b = row.body;
  const sources = Object.entries(b.source_refs ?? {}).flatMap(([kind, refs]) =>
    Array.isArray(refs) ? refs.map((ref: any) => ({ kind, ref })) : [],
  );
  return (
    <div className="cloud-plan-facts">
      <div className="cloud-plan-time">
        <Clock3 size={20} />
        <strong>{b.calendar.time}</strong>
        <div>
          <span>
            {b.calendar.frequency === "daily"
              ? t("每日", "Every day")
              : b.calendar.weekdays
                  .map((d: number) => t(days[d - 1][0], days[d - 1][1]))
                  .join(" · ")}
          </span>
          <small>{b.calendar.timezone}</small>
        </div>
      </div>
      <dl>
        <div>
          <dt>{t("每次 Agent 步驟預算上限", "Agent step budget per run")}</dt>
          <dd>
            <Money value={b.max_budget_micros} />
          </dd>
        </div>
        <div>
          <dt>{t("固定流程版本", "Fixed workflow version")}</dt>
          <dd>v{b.workflow_version}</dd>
        </div>
        <div>
          <dt>{t("漏跑處理", "Missed times")}</dt>
          <dd>
            {b.catch_up === "latest"
              ? t("只補最近一次", "Latest only")
              : t("略過漏跑", "Skip missed work")}
          </dd>
        </div>
        <div>
          <dt>{t("生效期間", "Active interval")}</dt>
          <dd>
            <DateText value={b.starts_at} /> →{" "}
            {b.ends_at ? (
              <DateText value={b.ends_at} />
            ) : (
              t("持續至你暫停或停止", "Until you pause or stop")
            )}
          </dd>
        </div>
      </dl>
      <div className="cloud-plan-output">
        <span>{t("每次預期交付", "Expected each run")}</span>
        <p>{b.expected_output}</p>
      </div>
      <details>
        <summary>
          {t("核對固定方法與輸入", "Review fixed method & inputs")}
        </summary>
        <ol>
          {row.definition?.steps?.map((step: any, i: number) => (
            <li key={i}>
              {step.kind === "approval" ? (
                t("人工核對：", "Human review: ") + step.message
              ) : step.kind === "codex" ? (
                <>
                  {step.role_key} · {step.prompt} ·{" "}
                  <Money value={step.budget_micros} />
                </>
              ) : (
                t(
                  "計算已授權的固定資料摘要",
                  "Calculate the authorized fixed dataset summary",
                )
              )}
            </li>
          ))}
        </ol>
        <p className="muted">
          {t(
            "固定輸入不會自動刷新；後續資料變更需要另行核對方法。",
            "Fixed inputs do not refresh automatically. Review the method again for changed data.",
          )}
        </p>
        {sources.map(({ kind, ref }, i) => (
          <p className="cloud-plan-source" key={i}>
            {kind} ·{" "}
            {ref.id ??
              ref.resource_id ??
              ref.workflow_id ??
              ref.asset_version_id ??
              "—"}
            {ref.version != null ? ` · v${ref.version}` : ""}
          </p>
        ))}
        <small className="cloud-plan-source">
          {t("方法校驗值", "Method digest")}: {b.workflow_definition_hash}
        </small>
      </details>
      {row.next?.length > 0 && (
        <details>
          <summary>{t("接下來的五次時刻", "Next five times")}</summary>
          <ol>
            {row.next.map((n: any) => (
              <li key={n.local}>
                {n.local.replace("T", " ")} ·{" "}
                {n.daylight_gap ? (
                  t(
                    "夏令時不存在，此次略過",
                    "Nonexistent daylight wall time; skipped",
                  )
                ) : (
                  <DateText value={n.scheduled_at} />
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="muted cloud-plan-note">
        {t(
          "顧問準備費用另計。啟用不預扣全部未來費用；每次執行依實際用量結算。人工核對點每次保留。",
          "Consultant preparation is billed separately. Activation does not precharge future work; each run settles actual usage and keeps its human review points.",
        )}
      </p>
    </div>
  );
}

function ScheduleDecision({
  request,
  onClose,
  onDone,
}: {
  request: any;
  onClose: () => void;
  onDone: (result: any) => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const keys = useRef({
    activate: crypto.randomUUID(),
    decline: crypto.randomUUID(),
  });
  async function decide(decision: "activate" | "decline") {
    if (busy || (decision === "activate" && !consent)) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await post(
        w.base + `/cloud-workflow-schedules/requests/${request.id}/decision`,
        {
          decision,
          specification_hash: request.specification_hash,
          max_budget_micros: request.body.max_budget_micros,
        },
        keys.current[decision],
      );
      announce();
      onDone(saved);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("核對並啟用雲端計劃", "Review & activate cloud schedule")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="cloud-plan-review" data-schedule-review={request.id}>
        <span className="workflow-private-label">
          <LockKeyhole size={14} />
          {t("你的私有雲端計劃", "Your private cloud schedule")}
        </span>
        <h3>{request.body.name}</h3>
        <ScheduleFacts row={request} />
        {!request.origin_ready && (
          <p role="status">
            {t(
              "顧問完成後才能啟用；目前沒有建立未來工作。",
              "Activation waits for the consultant to finish. No future work has been created.",
            )}
          </p>
        )}
        {request.expired && (
          <p role="status">
            {t(
              "此提案已逾時，請重新準備。",
              "This request expired. Prepare a new one.",
            )}
          </p>
        )}
        <ErrorNotice error={error} />
        <label className="check-label">
          <input
            name="schedule_authorized"
            type="checkbox"
            checked={consent}
            disabled={busy || request.expired || !request.origin_ready}
            onChange={(e) => setConsent(e.target.checked)}
          />
          {t(
            "我已核對方法、固定輸入、時區、交付及每次預算，同意關閉頁面後仍在雲端執行。",
            "I reviewed the method, fixed inputs, time zone, outputs and per-run budget, and authorize cloud execution after I close the page.",
          )}
        </label>
        <div className="cloud-plan-actions">
          <button
            className="button primary"
            disabled={
              busy || !consent || request.expired || !request.origin_ready
            }
            onClick={() => void decide("activate")}
          >
            <Play size={15} />
            {t("確認並啟用計劃", "Confirm & activate schedule")}
          </button>
          <button
            className="button secondary"
            disabled={busy || request.expired}
            onClick={() => void decide("decline")}
          >
            {t("拒絕此提案", "Decline this request")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ScheduleEditor({
  run,
  schedule,
  onClose,
  onSaved,
}: {
  run?: any;
  schedule?: any;
  onClose: () => void;
  onSaved: (row: any) => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const old = schedule?.body,
    [frequency, setFrequency] = useState(old?.calendar.frequency ?? "weekly"),
    intent = useRef({ body: "", key: "" });
  return (
    <Modal
      title={
        schedule
          ? t("修改未來計劃", "Revise future schedule")
          : t("把這個方法保存為計劃", "Repeat this method on a schedule")
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="cloud-plan-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const f = new FormData(e.currentTarget),
            start = String(f.get("starts_at") ?? ""),
            end = String(f.get("ends_at") ?? "");
          const body = {
            name: String(f.get("name")),
            calendar: {
              timezone: String(f.get("timezone")),
              frequency,
              time: String(f.get("time")),
              weekdays:
                frequency === "weekly" ? f.getAll("weekdays").map(Number) : [],
            },
            catch_up: String(f.get("catch_up")),
            ...(start ? { starts_at: new Date(start).toISOString() } : {}),
            ends_at: end ? new Date(end).toISOString() : null,
            expected_output: String(f.get("expected_output")),
            ...(schedule
              ? { expected_version: schedule.version }
              : { source_run_id: run.id }),
          };
          const encoded = JSON.stringify(body);
          if (intent.current.body !== encoded)
            intent.current = { body: encoded, key: crypto.randomUUID() };
          setBusy(true);
          setError(null);
          try {
            const saved = await post(
              w.base +
                `/cloud-workflow-schedules${schedule ? "/" + schedule.id : ""}/requests`,
              body,
              intent.current.key,
            );
            announce();
            onSaved(saved);
          } catch (failure) {
            setError(failure);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <p className="muted">
            {t(
              "先保存待確認提案。核對下一頁的方法、資料及每次預算後，再明確啟用。",
              "Save a request first. Review the exact method, inputs and per-run budget on the next screen before activation.",
            )}
          </p>
          <Field label={t("計劃名稱", "Schedule name")}>
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              defaultValue={old?.name ?? ""}
            />
          </Field>
          <div className="cloud-plan-form-grid">
            <Field label={t("頻率", "Frequency")}>
              <select
                name="frequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="daily">{t("每日", "Daily")}</option>
                <option value="weekly">
                  {t("每週指定日", "Selected weekdays")}
                </option>
              </select>
            </Field>
            <Field label={t("當地時刻", "Local time")}>
              <input
                name="time"
                type="time"
                required
                defaultValue={old?.calendar.time ?? "09:00"}
              />
            </Field>
          </div>
          {frequency === "weekly" && (
            <fieldset className="cloud-plan-weekdays">
              <legend>{t("每週哪些日子", "Weekdays")}</legend>
              {days.map((label, i) => (
                <label key={i}>
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={i + 1}
                    defaultChecked={
                      old?.calendar.weekdays.includes(i + 1) ?? i === 0
                    }
                  />
                  {t(label[0], label[1])}
                </label>
              ))}
            </fieldset>
          )}
          <Field
            label={t("時區", "Time zone")}
            hint={t(
              "依此時區執行；夏令時不存在的時刻略過，重複時刻只執行一次。",
              "Uses this time zone. Nonexistent daylight wall times are skipped; repeated times run once.",
            )}
          >
            <input
              name="timezone"
              list="private-plan-zones"
              required
              defaultValue={
                old?.calendar.timezone ??
                Intl.DateTimeFormat().resolvedOptions().timeZone
              }
            />
          </Field>
          <datalist id="private-plan-zones">
            {[
              "Asia/Hong_Kong",
              "Asia/Taipei",
              "UTC",
              "Europe/London",
              "America/New_York",
            ].map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <Field label={t("漏跑時如何處理", "When a time was missed")}>
            <select name="catch_up" defaultValue={old?.catch_up ?? "skip"}>
              <option value="skip">
                {t(
                  "略過漏跑，等待下次",
                  "Skip missed work; wait for next time",
                )}
              </option>
              <option value="latest">
                {t("只補最近一次，不逐次補跑", "Catch up latest only")}
              </option>
            </select>
          </Field>
          <div className="cloud-plan-form-grid">
            <Field
              label={t(
                "開始時間（本機時區，可留空）",
                "Start (device time zone, optional)",
              )}
            >
              <input name="starts_at" type="datetime-local" />
            </Field>
            <Field
              label={t(
                "截止時間（本機時區，可留空）",
                "End (device time zone, optional)",
              )}
            >
              <input
                name="ends_at"
                type="datetime-local"
                defaultValue={localDate(old?.ends_at)}
              />
            </Field>
          </div>
          <Field label={t("每次需要交付什麼", "Expected output each run")}>
            <textarea
              name="expected_output"
              required
              minLength={3}
              maxLength={1000}
              rows={3}
              defaultValue={old?.expected_output ?? ""}
            />
          </Field>
          <ErrorNotice error={error} />
          <button className="button primary" type="submit" disabled={busy}>
            {t("保存並核對提案", "Save & review request")}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}

export function ScheduleFromRun({ run }: { run: any }) {
  const { t } = useI18n(),
    [editing, setEditing] = useState(false),
    [request, setRequest] = useState<any>(null);
  return (
    <>
      <button
        className="button secondary small"
        onClick={() => setEditing(true)}
      >
        <CalendarDays size={15} />
        {t("保存為雲端計劃", "Save as cloud schedule")}
      </button>
      {editing && (
        <ScheduleEditor
          run={run}
          onClose={() => setEditing(false)}
          onSaved={(r) => {
            setEditing(false);
            setRequest(r);
          }}
        />
      )}
      {request && (
        <ScheduleDecision
          request={request}
          onClose={() => setRequest(null)}
          onDone={() => setRequest(null)}
        />
      )}
    </>
  );
}

export function CloudSchedules({ taskId }: { taskId?: string }) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [refresh, setRefresh] = useState(0),
    [review, setReview] = useState<any>(null),
    [edit, setEdit] = useState<any>(null),
    [action, setAction] = useState<any>(null),
    [confirmedVersions, setConfirmedVersions] = useState<
      Record<string, number>
    >({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [history, setHistory] = useState<any>(null),
    [historyPages, setHistoryPages] = useState<(string | null)[]>([null]);
  const base = w.base + "/cloud-workflow-schedules",
    { data, error: readError } = useData(
      base + (taskId ? "?task_id=" + taskId : ""),
      refresh,
      5000,
      "",
      { retainOnRefresh: true },
    );
  const historyBefore = historyPages.at(-1);
  const detail = useData(
    history
      ? base +
          "/" +
          history.id +
          (historyBefore ? "?before=" + historyBefore : "")
      : null,
    refresh,
  );
  useEffect(() => {
    setHistoryPages([null]);
  }, [history?.id]);
  useEffect(() => {
    const listener = () => setRefresh((v) => v + 1);
    window.addEventListener("copypaste:cloud-schedules", listener);
    return () =>
      window.removeEventListener("copypaste:cloud-schedules", listener);
  }, []);
  useEffect(() => {
    setReview(null);
    setAction(null);
    setEdit(null);
    setHistory(null);
    setError(null);
    setConfirmedVersions({});
  }, [base, taskId]);
  useEffect(() => {
    // A completed read is authoritative for open views as well as cards. Keep
    // drafts mounted during polling, and clear private snapshots on lost access.
    if (readError) {
      setReview(null);
      setEdit(null);
      setAction(null);
      setHistory(null);
      setError(null);
      return;
    }
    if (!data) return;
    const requests = new Map<string, any>(
      data.requests
        .filter((row: any) => row.state === "pending")
        .map((row: any) => [row.id, row]),
    );
    const schedules = new Set(data.schedules.map((row: any) => row.id));
    setReview((current: any) =>
      current ? (requests.get(current.id) ?? null) : null,
    );
    setEdit((current: any) =>
      current && schedules.has(current.id) ? current : null,
    );
    setAction((current: any) =>
      current && schedules.has(current.row.id) ? current : null,
    );
    setHistory((current: any) =>
      current && schedules.has(current.id) ? current : null,
    );
  }, [data, readError]);
  function rememberVersion(result: any) {
    if (result?.schedule)
      setConfirmedVersions((versions) => ({
        ...versions,
        [result.schedule.id]: result.schedule.version,
      }));
  }
  const pending =
    data?.requests.filter((r: any) => r.state === "pending") ?? [];
  if (taskId && data && !pending.length && !data.schedules.length) return null;
  return (
    <section
      className="section-block cloud-plans"
      aria-label={t("我的私有雲端計劃", "My private cloud schedules")}
    >
      <div className="section-title">
        <div>
          <span className="workflow-private-label">
            <LockKeyhole size={14} />
            {t(
              "只對你可見 · 關閉頁面後繼續",
              "Only visible to you · works after you close the page",
            )}
          </span>
          <h2>
            <CalendarDays size={22} />
            {t("讓好方法，按時發生。", "Good work, at the right time.")}
          </h2>
          <p className="muted">
            {t(
              "在對話裡準備，在這裡核對。每次觸發、交付和費用都留有紀錄。",
              "Prepare it in conversation, review it here. Every trigger, result and charge stays traceable.",
            )}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label={t("重新整理計劃", "Refresh schedules")}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <ErrorNotice error={readError ?? (!action ? error : null)} />
      {!taskId && data && !pending.length && !data.schedules.length && (
        <div className="card cloud-plan-empty">
          <Clock3 size={25} />
          <div>
            <h3>
              {t(
                "把一次好成果，變成固定安排。",
                "Turn a useful result into a routine.",
              )}
            </h3>
            <p className="muted">
              {t(
                "請流程顧問準備每天或每週的工作，或在下方既有流程選擇「保存為雲端計劃」。啟用前由你確認。",
                "Ask your workflow consultant for daily or weekly work, or choose “Save as cloud schedule” on an existing workflow below. You confirm before it starts.",
              )}
            </p>
          </div>
        </div>
      )}
      <div className="cloud-plan-grid">
        {pending.map((q: any) => (
          <article
            className="card cloud-plan-card cloud-plan-pending"
            key={q.id}
            data-schedule-request={q.id}
          >
            <header>
              <Badge value="awaiting_approval" />
              <small>
                <DateText value={q.expires_at} />
              </small>
            </header>
            <h3>{q.body.name}</h3>
            <div className="cloud-plan-time">
              <Clock3 size={19} />
              <strong>{q.body.calendar.time}</strong>
              <small>{q.body.calendar.timezone}</small>
            </div>
            <p>{q.body.expected_output}</p>
            <p>
              {t("每次預算上限", "Per-run limit")}{" "}
              <Money value={q.body.max_budget_micros} />
            </p>
            <p className="muted">
              {q.expired
                ? t(
                    "提案已逾時，請重新準備。",
                    "Request expired; prepare a new one.",
                  )
                : !q.origin_ready
                  ? t(
                      "等待顧問成功完成，尚未啟用。",
                      "Waiting for the consultant to finish. Not active.",
                    )
                  : t(
                      "尚未啟用，也未預留未來步驟費用。",
                      "Not active. No future step fees reserved.",
                    )}
            </p>
            <button
              className="button primary small"
              onClick={() => setReview(q)}
            >
              {t("核對計劃與預算", "Review schedule & budget")}
            </button>
          </article>
        ))}
        {data?.schedules.map((s: any) => (
          <article
            className="card cloud-plan-card"
            key={s.id}
            data-cloud-schedule={s.id}
          >
            <header>
              <Badge value={s.state} />
              <small>
                {t("計劃版本", "Schedule version")} {s.revision}
              </small>
            </header>
            <h3>{s.name}</h3>
            <ScheduleFacts row={s} />
            {s.state === "active" && (
              <p className="cloud-plan-next">
                {t("下次觸發", "Next time")}{" "}
                <strong>
                  <time dateTime={s.next_due_at}>
                    {new Intl.DateTimeFormat(t("zh-HK", "en"), {
                      timeZone: s.body.calendar.timezone,
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(s.next_due_at))}{" "}
                    · {s.body.calendar.timezone}
                  </time>
                </strong>
              </p>
            )}
            {s.last_error && (
              <p role="status" className="notice">
                {t(
                  "未來觸發已停止。請核對來源、權限及當前工作的結果或費用，再重新確認。",
                  "Future triggers stopped. Review source access and the current run's outcome or charges before confirming again.",
                )}
                <small className="cloud-plan-source">{s.last_error}</small>
              </p>
            )}
            <footer>
              <button
                className="button secondary small"
                onClick={() => setHistory(s)}
              >
                {t("每次結果與版本", "Runs & versions")}
              </button>
              {!["retired", "ended"].includes(s.state) && (
                <>
                  <button
                    className="icon-button"
                    disabled={
                      busy || s.version < (confirmedVersions[s.id] ?? 0)
                    }
                    aria-label={t("修改計劃", "Edit schedule")}
                    onClick={() => setEdit(s)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="button secondary small"
                    disabled={
                      busy || s.version < (confirmedVersions[s.id] ?? 0)
                    }
                    onClick={() => {
                      setError(null);
                      setAction({
                        row: s,
                        action: s.state === "active" ? "pause" : "resume",
                        key: crypto.randomUUID(),
                      });
                    }}
                  >
                    {s.state === "active" ? (
                      <Pause size={15} />
                    ) : (
                      <Play size={15} />
                    )}
                    {s.state === "active"
                      ? t("暫停未來觸發", "Pause future times")
                      : t("核對並恢復", "Review & resume")}
                  </button>
                  <button
                    className="icon-button"
                    disabled={
                      busy || s.version < (confirmedVersions[s.id] ?? 0)
                    }
                    aria-label={t("停止此計劃", "Retire schedule")}
                    onClick={() => {
                      setError(null);
                      setAction({
                        row: s,
                        action: "retire",
                        key: crypto.randomUUID(),
                      });
                    }}
                  >
                    <Square size={15} />
                  </button>
                </>
              )}
            </footer>
            {s.version < (confirmedVersions[s.id] ?? 0) && (
              <p className="muted" role="status">
                {t(
                  "正在同步計劃的最新版本…",
                  "Updating to the confirmed schedule version…",
                )}
              </p>
            )}
          </article>
        ))}
      </div>
      {review && (
        <ScheduleDecision
          request={review}
          onClose={() => setReview(null)}
          onDone={(result) => {
            rememberVersion(result);
            setReview(null);
          }}
        />
      )}
      {edit && (
        <ScheduleEditor
          schedule={edit}
          onClose={() => setEdit(null)}
          onSaved={(r) => {
            setEdit(null);
            setReview(r);
          }}
        />
      )}
      {action && (
        <Modal
          title={
            action.action === "resume"
              ? t("核對並恢復未來觸發", "Review & resume future times")
              : action.action === "pause"
                ? t("暫停未來觸發", "Pause future times")
                : t("停止此計劃", "Retire this schedule")
          }
          onClose={() => {
            if (!busy) setAction(null);
          }}
        >
          <form
            className="cloud-plan-review"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError(null);
              try {
                const saved = await post(
                  base + `/${action.row.id}/status`,
                  {
                    action: action.action,
                    expected_version: action.row.version,
                    specification_hash: action.row.specification_hash,
                    max_budget_micros: action.row.body.max_budget_micros,
                  },
                  action.key,
                );
                rememberVersion(saved);
                setAction(null);
                announce();
              } catch (failure) {
                setError(failure);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>{action.row.name}</h3>
            <p>
              {t(
                "當前工作會保留。如需取消這次執行，請在流程運行紀錄另行停止。",
                "Current work is preserved. Stop a current run separately in workflow history.",
              )}
            </p>
            {action.action === "resume" && (
              <>
                <ScheduleFacts row={action.row} />
                <p>
                  {t(
                    "從現在起恢復，略過暫停期間；正在執行或費用待核對的工作需要先處理。",
                    "Resumes from now and skips paused times. Resolve current work or uncertain charges first.",
                  )}
                </p>
                <label className="check-label">
                  <input name="resume_authorized" type="checkbox" required />
                  {t(
                    "我核對並同意上述方法、資料、時間及每次預算。",
                    "I reviewed and authorize this method, inputs, times and per-run budget.",
                  )}
                </label>
              </>
            )}
            <ErrorNotice error={error} />
            <button className="button primary" disabled={busy}>
              {t("確認操作", "Confirm action")}
            </button>
          </form>
        </Modal>
      )}
      {history && (
        <Modal
          title={t("每次結果與版本", "Runs & versions")}
          onClose={() => setHistory(null)}
        >
          <div className="cloud-plan-history">
            <ErrorNotice error={detail.error} />
            <h3>{history.name}</h3>
            {detail.data?.occurrences.length === 0 && (
              <p className="muted">{t("尚未觸發。", "No triggers yet.")}</p>
            )}
            {detail.data?.occurrences.map((o: any) => (
              <article key={o.id}>
                <div>
                  <strong>{o.scheduled_local.replace("T", " ")}</strong>
                  <small>
                    v{o.revision} · {o.calendar?.timezone}
                  </small>
                </div>
                <Badge value={o.run_state ?? o.state} />
                <p>
                  {t("已結算費用", "Settled charges")}:{" "}
                  <Money value={o.charged_micros} />
                </p>
                {o.missed_count > 0 && (
                  <p>
                    {t("合併略過", "Missed times coalesced")}: {o.missed_count}
                  </p>
                )}
                {o.run_id && (
                  <Link
                    to={"../workflows#cloud-run-" + o.run_id}
                    onClick={() => setHistory(null)}
                  >
                    {t(
                      "在流程紀錄查看交付或停止當前執行",
                      "View delivery or stop this run in workflow history",
                    )}{" "}
                    <ArrowUpRight size={13} />
                  </Link>
                )}
                {o.active_task && (
                  <Link to={"../tasks/" + o.active_task}>
                    {t("查看當前工作", "View current work")}
                  </Link>
                )}
              </article>
            ))}
            {detail.data?.versions.map((v: any) => (
              <p key={v.revision}>
                v{v.revision} · {v.body.calendar.time} ·{" "}
                {v.body.calendar.timezone} · <DateText value={v.created_at} />
              </p>
            ))}
            <div className="cloud-plan-actions">
              <button
                className="button secondary small"
                disabled={detail.loading || historyPages.length === 1}
                onClick={() => setHistoryPages((p) => p.slice(0, -1))}
              >
                {t("較新紀錄", "Newer results")}
              </button>
              <span>
                {t("第", "Page")} {historyPages.length}
              </span>
              <button
                className="button secondary small"
                disabled={detail.loading || !detail.data?.next_cursor}
                onClick={() =>
                  setHistoryPages((p) => [...p, detail.data.next_cursor])
                }
              >
                {t("較早紀錄", "Older results")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
