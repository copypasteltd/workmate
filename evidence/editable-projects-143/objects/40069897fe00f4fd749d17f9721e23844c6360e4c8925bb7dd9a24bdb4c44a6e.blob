import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Radio,
  KeyRound,
  History,
  Pause,
  Pencil,
  RefreshCw,
  LockKeyhole,
  Copy,
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
import "./cloud-events.css";

const announce = () =>
  window.dispatchEvent(new Event("copypaste:cloud-events"));
const local = (v: string) =>
  new Date(Date.parse(v) - new Date(v).getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const requestBody = (q: any, decision: string) => ({
  decision,
  specification_hash: q.specification_hash,
  max_budget_micros: q.body.max_budget_micros,
  max_daily_budget_micros: q.body.max_daily_budget_micros,
});

function EventFacts({ row }: { row: any }) {
  const { t } = useI18n(),
    b = row.body;
  return (
    <div className="event-facts">
      <div className="event-type">
        <Radio size={19} />
        <strong>{b.event_type}</strong>
      </div>
      <dl>
        <div>
          <dt>{t("每次 Agent 預算上限", "Agent budget per run")}</dt>
          <dd>
            <Money value={b.max_budget_micros} />
          </dd>
        </div>
        <div>
          <dt>{t("每日預算上限", "Daily budget limit")}</dt>
          <dd>
            <Money value={b.max_daily_budget_micros} /> · {b.max_runs_per_day}{" "}
            {t("次", "runs")}
          </dd>
        </div>
        <div>
          <dt>{t("每日額度時區", "Daily allowance time zone")}</dt>
          <dd>{b.timezone}</dd>
        </div>
        <div>
          <dt>{t("最短間隔／有效期", "Minimum interval / event age")}</dt>
          <dd>
            {b.min_interval_seconds}s / {b.max_event_age_seconds}s
          </dd>
        </div>
        <div>
          <dt>{t("繁忙時", "While busy")}</dt>
          <dd>
            {b.overlap_policy === "latest"
              ? t("只保留最新一個", "Keep latest only")
              : t("略過新事件", "Skip new events")}
          </dd>
        </div>
        <div>
          <dt>{t("生效期間", "Active interval")}</dt>
          <dd>
            <DateText value={b.starts_at} /> → <DateText value={b.ends_at} />
          </dd>
        </div>
      </dl>
      <p className="event-output">{b.expected_output}</p>
      <details>
        <summary>
          {t(
            "核對固定方法與資料版本",
            "Review fixed method and input versions",
          )}
        </summary>
        <p>
          v{b.workflow_version} ·{" "}
          {t("固定輸入不自動刷新", "Fixed inputs do not refresh automatically")}
        </p>
        <ol>
          {row.definition?.steps?.map((s: any, i: number) => (
            <li key={i}>
              {s.kind === "codex" ? (
                <>
                  {s.role_key} · {s.prompt} · <Money value={s.budget_micros} />
                </>
              ) : s.kind === "approval" ? (
                s.message
              ) : (
                t("計算已授權資料摘要", "Calculate authorized dataset summary")
              )}
            </li>
          ))}
        </ol>
        {Object.entries(b.source_refs ?? {}).map(([k, v]) => (
          <p className="event-digest" key={k}>
            {k} · {JSON.stringify(v)}
          </p>
        ))}
        <p className="event-digest">{b.workflow_definition_hash}</p>
        <p className="event-digest">{row.specification_hash}</p>
      </details>
      <p className="muted">
        {t(
          "顧問準備費用另計；啟用不預扣未來費用，每次按實際用量結算。事件資料不擴大權限，人工核對點每次保留。",
          "Consultant preparation is separate. Activation does not precharge future work; each run settles actual usage. Event data grants no permissions. Human review points remain in every run.",
        )}
      </p>
    </div>
  );
}

function IssuedKey({ result, onClose }: { result: any; onClose: () => void }) {
  const { t } = useI18n(),
    [shown, setShown] = useState(false),
    [copied, setCopied] = useState(false),
    [error, setError] = useState<unknown>(null);
  return (
    <Modal
      title={t("連接你的事件來源", "Connect your event source")}
      onClose={onClose}
    >
      <div className="event-issued" data-event-issued={result.trigger.id}>
        <span className="workflow-private-label">
          <KeyRound size={15} />
          {t("只顯示這一次", "Shown once")}
        </span>
        <h3>
          {t(
            "把密鑰放到你信任的發送端。",
            "Keep the key with your trusted sender.",
          )}
        </h3>
        <p>
          {t(
            "關閉後無法再次讀取。未收到或遺失時，請主動輪換；舊密鑰隨即失效。不要把密鑰交給對話中的 Agent。",
            "You cannot retrieve it after closing. Rotate explicitly if it is lost or the response was missed; the old key stops working immediately. Keep it out of Agent conversations.",
          )}
        </p>
        <Field label={t("接收位址", "Receiver endpoint")}>
          <textarea readOnly rows={2} value={result.trigger.endpoint} />
        </Field>
        {result.signing_secret ? (
          <>
            <Field label={t("簽名密鑰", "Signing key")}>
              <input
                readOnly
                autoComplete="off"
                type={shown ? "text" : "password"}
                value={result.signing_secret}
              />
            </Field>
            <div className="event-actions">
              <button
                className="button secondary"
                onClick={() => setShown(!shown)}
              >
                {shown
                  ? t("隱藏密鑰", "Hide key")
                  : t("顯示密鑰", "Reveal key")}
              </button>
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.signing_secret);
                    setCopied(true);
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                <Copy size={15} />
                {copied ? t("已複製", "Copied") : t("複製密鑰", "Copy key")}
              </button>
            </div>
          </>
        ) : (
          <p role="status">
            {t(
              "這是已完成操作的重試回應，沒有再次返回密鑰。需要新密鑰時請輪換。",
              "This retried operation has already completed. It does not return the key again. Rotate if you need a new key.",
            )}
          </p>
        )}
        <p>
          {t("密鑰版本", "Key version")}: {result.trigger.key_version}
        </p>
        <ErrorNotice error={error} />
        <button className="button primary" onClick={onClose}>
          {t("我已保存，關閉", "Saved, close")}
        </button>
      </div>
    </Modal>
  );
}

function EventDecision({
  request,
  onClose,
  onDone,
}: {
  request: any;
  onClose: () => void;
  onDone: (r: any) => void;
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
  async function decide(action: "activate" | "decline") {
    if (busy || (action === "activate" && (!consent || !request.origin_ready)))
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await post(
        w.base + `/cloud-workflow-events/requests/${request.id}/decision`,
        requestBody(request, action),
        keys.current[action],
      );
      announce();
      onDone(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("核對並啟用事件工作", "Review and activate event work")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div data-event-review={request.id}>
        <h3>{request.body.name}</h3>
        <EventFacts row={request} />
        {!request.origin_ready && (
          <p role="status">
            {t(
              "顧問完成後才能啟用。",
              "Activation waits for the consultant to finish.",
            )}
          </p>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            name="event_authorized"
            checked={consent}
            disabled={busy || !request.origin_ready}
            onChange={(e) => setConsent(e.target.checked)}
          />
          {t(
            "我已核對固定方法、資料、時區、規則及每次和每日費用上限，同意收到符合規則的事件後在雲端執行。",
            "I reviewed the fixed method, inputs, time zone, rules and per-run and daily limits, and authorize cloud execution for matching events.",
          )}
        </label>
        <ErrorNotice error={error} />
        <div className="event-actions">
          <button
            className="button primary"
            disabled={busy || !consent || !request.origin_ready}
            onClick={() => void decide("activate")}
          >
            {t("確認啟用", "Activate confirmed work")}
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void decide("decline")}
          >
            {t("拒絕提案", "Decline proposal")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EventEditor({
  run,
  row,
  onClose,
  onSaved,
}: {
  run?: any;
  row?: any;
  onClose: () => void;
  onSaved: (q: any) => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    old = row?.body;
  const intent = useRef({ body: "", key: crypto.randomUUID() });
  return (
    <Modal
      title={t("準備事件工作", "Prepare event work")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="event-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const f = new FormData(e.currentTarget);
          try {
            const start = String(f.get("starts_at") || ""),
              body = {
                name: String(f.get("name")),
                event_type: String(f.get("event_type")),
                timezone: String(f.get("timezone")),
                overlap_policy: String(f.get("overlap_policy")),
                min_interval_seconds: Number(f.get("min_interval_seconds")),
                max_runs_per_day: Number(f.get("max_runs_per_day")),
                max_event_age_seconds: Number(f.get("max_event_age_seconds")),
                ...(start ? { starts_at: new Date(start).toISOString() } : {}),
                ends_at: new Date(String(f.get("ends_at"))).toISOString(),
                expected_output: String(f.get("expected_output")),
                workflow_id: old?.workflow_id ?? run.workflow_id,
                workflow_version: old?.workflow_version ?? run.version,
                workflow_definition_hash:
                  old?.workflow_definition_hash ?? run.definition_hash,
                ...(row ? { expected_version: row.version } : {}),
              };
            const frozen = JSON.stringify(body);
            if (frozen !== intent.current.body)
              intent.current = { body: frozen, key: crypto.randomUUID() };
            setBusy(true);
            setError(null);
            const r: any = await post(
              w.base +
                `/cloud-workflow-events${row ? "/" + row.id : ""}/requests`,
              body,
              intent.current.key,
            );
            announce();
            onSaved(r.request);
          } catch (error) {
            setError(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <p className="muted">
            {t(
              "先準備提案，再核對方法及確切預算。事件來源需另行設定簽名發送。",
              "Prepare a proposal, then review the method and exact budget. Configure your event sender separately.",
            )}
          </p>
          <Field label={t("工作名稱", "Work name")}>
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              defaultValue={old?.name ?? ""}
            />
          </Field>
          <Field
            label={t("事件類型", "Event type")}
            hint={t(
              "與發送端完全一致，例如 campaign.ready。",
              "Must exactly match your sender, for example campaign.ready.",
            )}
          >
            <input
              name="event_type"
              required
              pattern="[a-z][a-z0-9_.\-]{2,79}"
              defaultValue={old?.event_type ?? ""}
            />
          </Field>
          <div className="event-form-grid">
            <Field label={t("每日額度時區", "Daily allowance time zone")}>
              <input
                name="timezone"
                required
                defaultValue={
                  old?.timezone ??
                  Intl.DateTimeFormat().resolvedOptions().timeZone
                }
              />
            </Field>
            <Field label={t("繁忙時", "While busy")}>
              <select
                name="overlap_policy"
                defaultValue={old?.overlap_policy ?? "skip"}
              >
                <option value="skip">
                  {t("略過新事件", "Skip new events")}
                </option>
                <option value="latest">
                  {t("只保留最新一個", "Keep latest only")}
                </option>
              </select>
            </Field>
            <Field label={t("最短間隔（秒）", "Minimum interval (seconds)")}>
              <input
                name="min_interval_seconds"
                type="number"
                min={10}
                max={86400}
                required
                defaultValue={old?.min_interval_seconds ?? 60}
              />
            </Field>
            <Field label={t("每日最多執行次數", "Maximum daily runs")}>
              <input
                name="max_runs_per_day"
                type="number"
                min={1}
                max={100}
                required
                defaultValue={old?.max_runs_per_day ?? 3}
              />
            </Field>
            <Field label={t("事件有效期（秒）", "Maximum event age (seconds)")}>
              <input
                name="max_event_age_seconds"
                type="number"
                min={60}
                max={86400}
                required
                defaultValue={old?.max_event_age_seconds ?? 3600}
              />
            </Field>
            <Field
              label={t(
                "開始（本機時間，可留空）",
                "Start (device time, optional)",
              )}
            >
              <input name="starts_at" type="datetime-local" />
            </Field>
          </div>
          <Field label={t("結束（本機時間）", "End (device time)")}>
            <input
              name="ends_at"
              type="datetime-local"
              required
              defaultValue={local(
                old?.ends_at && Date.parse(old.ends_at) > Date.now()
                  ? old.ends_at
                  : new Date(Date.now() + 7 * 86400_000).toISOString(),
              )}
            />
          </Field>
          <Field label={t("每次預期交付", "Expected each run")}>
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
            {t("保存待確認提案", "Save proposal for review")}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}

export function EventFromRun({ run }: { run: any }) {
  const { t } = useI18n(),
    [editing, setEditing] = useState(false),
    [review, setReview] = useState<any>(null),
    [issued, setIssued] = useState<any>(null);
  return (
    <>
      <button
        className="button secondary small"
        onClick={() => setEditing(true)}
      >
        <Radio size={15} />
        {t("由事件啟動", "Start from an event")}
      </button>
      {editing && (
        <EventEditor
          run={run}
          onClose={() => setEditing(false)}
          onSaved={(q) => {
            setEditing(false);
            setReview(q);
          }}
        />
      )}
      {review && (
        <EventDecision
          request={review}
          onClose={() => setReview(null)}
          onDone={(r) => {
            setReview(null);
            if (r.trigger) setIssued(r);
          }}
        />
      )}
      {issued && <IssuedKey result={issued} onClose={() => setIssued(null)} />}
    </>
  );
}

function EventConnection({ row }: { row: any }) {
  const { t } = useI18n();
  const example = `import { createHmac, randomUUID } from 'node:crypto';\nconst endpoint = process.env.WORKMATE_EVENT_ENDPOINT;\nconst key = process.env.WORKMATE_EVENT_KEY;\nconst triggerId = new URL(endpoint).pathname.split('/').pop();\nconst keyVersion = ${row.key_version};\n// Retain this exact body and event_id on retries.\nconst body = JSON.stringify({ event_id: randomUUID(), event_type: ${JSON.stringify(row.body.event_type)}, occurred_at: new Date().toISOString(), data: { brief: 'Campaign review' } });\nconst timestamp = String(Math.floor(Date.now() / 1000));\nconst signature = 'v1=' + createHmac('sha256', key)\n  .update('workmate.event.v1\\n' + triggerId + '\\n' + keyVersion + '\\n' + timestamp + '\\n')\n  .update(Buffer.from(body, 'utf8')).digest('hex');\nconst response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-workmate-key-version': String(keyVersion), 'x-workmate-timestamp': timestamp, 'x-workmate-signature': signature }, body });\nconsole.log(response.status, await response.json());`;
  return (
    <details className="event-connection">
      <summary>{t("連接與簽名範例", "Connection and signing example")}</summary>
      <p className="event-digest">{row.endpoint}</p>
      <p>
        {t(
          "Workmate 簽名格式，與第三方平台原生格式分開。由你控制的伺服器發送；時間誤差最多五分鐘。重試保留原事件 ID 及完整原始內容，可重新簽名。202 表示已保存回執，請於下方核對執行結果。",
          "Uses the Workmate signature format. Send from a server you control; timestamps allow five minutes of clock difference. Retries retain the exact original body and event ID and may be signed again. A 202 confirms a durable receipt; review the actual run outcome below.",
        )}
      </p>
      <pre>{example}</pre>
    </details>
  );
}

export function CloudEvents({ taskId }: { taskId?: string }) {
  const w = useWorkspace(),
    { t } = useI18n(),
    base = w.base + "/cloud-workflow-events";
  const [refresh, setRefresh] = useState(0),
    [review, setReview] = useState<any>(null),
    [edit, setEdit] = useState<any>(null),
    [action, setAction] = useState<any>(null),
    [issued, setIssued] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [pages, setPages] = useState<(string | null)[]>([null]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [confirmed, setConfirmed] = useState<Record<string, number>>({});
  const { data, error: readError } = useData(
    base + (taskId ? "?task_id=" + taskId : ""),
    refresh,
    5000,
    "",
    { retainOnRefresh: true },
  );
  const detail = useData(
    history
      ? base +
          "/" +
          history.id +
          "?limit=20" +
          (pages.at(-1) ? "&cursor=" + pages.at(-1) : "")
      : null,
    refresh,
  );
  useEffect(() => {
    const listen = () => setRefresh((v) => v + 1);
    window.addEventListener("copypaste:cloud-events", listen);
    return () => window.removeEventListener("copypaste:cloud-events", listen);
  }, []);
  useEffect(() => {
    setReview(null);
    setEdit(null);
    setAction(null);
    setIssued(null);
    setHistory(null);
    setConfirmed({});
    setError(null);
  }, [base, taskId]);
  useEffect(() => {
    setPages([null]);
  }, [history?.id]);
  useEffect(() => {
    if (readError) {
      setReview(null);
      setEdit(null);
      setAction(null);
      setIssued(null);
      setHistory(null);
      return;
    }
    if (!data) return;
    setReview((q: any) =>
      q ? (data.requests.find((r: any) => r.id === q.id) ?? null) : null,
    );
    setEdit((q: any) =>
      q && data.triggers.some((r: any) => r.id === q.id) ? q : null,
    );
    setAction((q: any) =>
      q && data.triggers.some((r: any) => r.id === q.row.id) ? q : null,
    );
    setHistory((q: any) =>
      q && data.triggers.some((r: any) => r.id === q.id) ? q : null,
    );
    setIssued((r: any) =>
      r &&
      (!confirmed[r.trigger.id] ||
        data.triggers.some((q: any) => q.id === r.trigger.id))
        ? r
        : null,
    );
  }, [data, readError]);
  function done(r: any) {
    setReview(null);
    setAction(null);
    if (r.trigger) {
      setConfirmed((v) => ({ ...v, [r.trigger.id]: r.trigger.version }));
      if (r.signing_secret || r.state === "active") setIssued(r);
    }
    announce();
  }
  const requests = data?.requests ?? [],
    triggers = data?.triggers ?? [];
  if (taskId && data && !requests.length && !triggers.length) return null;
  return (
    <section
      className="section-block cloud-events"
      aria-label={t("我的事件工作", "My event workflows")}
    >
      <div className="section-title">
        <div>
          <span className="workflow-private-label">
            <LockKeyhole size={14} />
            {t("私有雲端工作", "Private cloud work")}
          </span>
          <h2>
            <Radio size={22} />
            {t("事件到了，工作開始。", "An event arrives. Work begins.")}
          </h2>
          <p className="muted">
            {t(
              "在對話中準備，在這裡確認。只有你授權的事件與預算，才會啟動工作。",
              "Prepare in conversation and confirm here. Work starts within the event rules and budgets you authorize.",
            )}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label={t("重新整理事件", "Refresh events")}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <ErrorNotice error={readError} />
      {data && !requests.length && !triggers.length && (
        <div className="card event-empty">
          <Radio size={24} />
          <p>
            {t(
              "請流程顧問準備事件工作，或在下方已有流程選擇「由事件啟動」。",
              "Ask the workflow consultant to prepare event work, or choose “Start from an event” on an existing workflow below.",
            )}
          </p>
        </div>
      )}
      <div className="event-grid">
        {requests.map((q: any) => (
          <article
            className="card event-card event-pending"
            key={q.id}
            data-event-request={q.id}
          >
            <header>
              <Badge value="awaiting_approval" />
              <small>
                <DateText value={q.expires_at} />
              </small>
            </header>
            <h3>{q.body.name}</h3>
            <div className="event-type">
              <Radio size={18} />
              <strong>{q.body.event_type}</strong>
            </div>
            <p>{q.body.expected_output}</p>
            <p>
              <Money value={q.body.max_budget_micros} /> / {t("次", "run")} ·{" "}
              <Money value={q.body.max_daily_budget_micros} /> /{" "}
              {t("日", "day")}
            </p>
            <button
              className="button primary"
              onClick={() => {
                setError(null);
                setReview(q);
              }}
            >
              {t("核對事件與費用", "Review event and costs")}
            </button>
          </article>
        ))}
        {triggers.map((row: any) => {
          const stale = row.version < (confirmed[row.id] ?? 0);
          return (
            <article
              className="card event-card"
              key={row.id}
              data-event-trigger={row.id}
            >
              <header>
                <Badge value={row.state} />
                <small>
                  v{row.revision} · {t("密鑰", "key")} {row.key_version}
                </small>
              </header>
              <h3>{row.name}</h3>
              <div className="event-type">
                <Radio size={18} />
                <strong>{row.body.event_type}</strong>
              </div>
              <p>{row.body.expected_output}</p>
              <p>
                <Money value={row.body.max_budget_micros} /> / {t("次", "run")}{" "}
                · <Money value={row.body.max_daily_budget_micros} /> /{" "}
                {t("日", "day")}
              </p>
              {row.last_error && (
                <p role="status" className="muted">
                  {row.last_error} ·{" "}
                  {t(
                    "請核對最近工作後重新確認。",
                    "Review recent work before confirming again.",
                  )}
                </p>
              )}
              <footer className="event-actions">
                <button
                  className="button secondary small"
                  onClick={() => setHistory(row)}
                >
                  <History size={14} />
                  {t("事件與方法", "Events and method")}
                </button>
                {!["retired", "ended"].includes(row.state) && (
                  <>
                    <button
                      className="button secondary small"
                      disabled={stale}
                      onClick={() => setEdit(row)}
                    >
                      <Pencil size={14} />
                      {row.state === "active"
                        ? t("修訂", "Revise")
                        : t("核對後恢復", "Review to resume")}
                    </button>
                    {row.state === "active" && (
                      <button
                        className="button secondary small"
                        disabled={stale}
                        onClick={() => {
                          setError(null);
                          setAction({
                            row,
                            kind: "pause",
                            key: crypto.randomUUID(),
                          });
                        }}
                      >
                        <Pause size={14} />
                        {t("暫停", "Pause")}
                      </button>
                    )}
                    <button
                      className="button secondary small"
                      disabled={stale}
                      onClick={() => {
                        setError(null);
                        setAction({
                          row,
                          kind: "rotate-key",
                          key: crypto.randomUUID(),
                        });
                      }}
                    >
                      <KeyRound size={14} />
                      {t("輪換密鑰", "Rotate key")}
                    </button>
                    <button
                      className="button secondary small"
                      disabled={stale}
                      onClick={() => {
                        setError(null);
                        setAction({
                          row,
                          kind: "retire",
                          key: crypto.randomUUID(),
                        });
                      }}
                    >
                      {t("停止", "Stop")}
                    </button>
                  </>
                )}
              </footer>
            </article>
          );
        })}
      </div>
      {review && (
        <EventDecision
          key={review.id + review.specification_hash}
          request={review}
          onClose={() => setReview(null)}
          onDone={done}
        />
      )}
      {edit && (
        <EventEditor
          row={edit}
          onClose={() => setEdit(null)}
          onSaved={(q) => {
            setEdit(null);
            setReview(q);
          }}
        />
      )}
      {issued && <IssuedKey result={issued} onClose={() => setIssued(null)} />}
      {action && (
        <Modal
          title={
            action.kind === "rotate-key"
              ? t("輪換簽名密鑰", "Rotate signing key")
              : t("停止未來事件工作", "Stop future event work")
          }
          onClose={() => {
            if (!busy) setAction(null);
          }}
        >
          <p>
            {action.kind === "rotate-key"
              ? t(
                  "確認後舊密鑰立即失效。新密鑰只顯示一次，需要你更新發送端。",
                  "The old key stops working immediately. The new key appears once; update your sender yourself.",
                )
              : t(
                  "未來事件將不再啟動工作。已啟動的工作保留，如需取消請另行操作。",
                  "Future events will no longer start work. Current runs are preserved; cancel those separately if needed.",
                )}
          </p>
          <ErrorNotice error={error} />
          <button
            className="button primary"
            disabled={
              busy ||
              !data ||
              action.row.version !==
                triggers.find((q: any) => q.id === action.row.id)?.version
            }
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError(null);
              try {
                const r = await post(
                  base +
                    "/" +
                    action.row.id +
                    (action.kind === "rotate-key" ? "/rotate-key" : "/status"),
                  {
                    expected_version: action.row.version,
                    ...(action.kind === "rotate-key"
                      ? {}
                      : { action: action.kind }),
                  },
                  action.key,
                );
                done(r);
                if (action.kind === "rotate-key") setIssued(r);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("確認操作", "Confirm action")}
          </button>
        </Modal>
      )}
      {history && (
        <Modal
          title={t("事件與方法紀錄", "Events and method history")}
          onClose={() => setHistory(null)}
        >
          <ErrorNotice error={detail.error} />
          {detail.data && (
            <>
              <EventFacts
                row={{ ...detail.data.trigger, definition: history.definition }}
              />
              <EventConnection row={detail.data.trigger} />
              <div className="event-history">
                {detail.data.items.map((r: any) => (
                  <article key={r.id} data-event-receipt={r.id}>
                    <header>
                      <Badge value={r.state} />
                      <DateText value={r.received_at} />
                    </header>
                    <strong>{r.event_id}</strong>
                    <p>
                      {r.event_type} · v{r.revision} {r.code && "· " + r.code}
                    </p>
                    {r.run_id && (
                      <Link
                        className="button secondary small"
                        to={"../workflows#cloud-run-" + r.run_id}
                        onClick={() => setHistory(null)}
                      >
                        {t("查看流程與交付", "View workflows and delivery")}
                      </Link>
                    )}
                    <details>
                      <summary>{t("事件資料", "Event data")}</summary>
                      <pre>{JSON.stringify(r.data, null, 2)}</pre>
                    </details>
                  </article>
                ))}
              </div>
              {!detail.data.items.length && (
                <p className="muted">
                  {t("尚未收到事件。", "No events received yet.")}
                </p>
              )}
              <div className="event-actions">
                <button
                  className="button secondary"
                  disabled={pages.length === 1}
                  onClick={() => setPages((p) => p.slice(0, -1))}
                >
                  {t("上一頁", "Previous")}
                </button>
                <button
                  className="button secondary"
                  disabled={!detail.data.next_cursor}
                  onClick={() =>
                    setPages((p) => [...p, detail.data.next_cursor])
                  }
                >
                  {t("下一頁", "Next")}
                </button>
              </div>
              <details>
                <summary>
                  {t("已確認的方法版本", "Confirmed method versions")}
                </summary>
                {detail.data.versions.map((v: any) => (
                  <div key={v.revision}>
                    <p>
                      v{v.revision} · <DateText value={v.created_at} />
                    </p>
                    <p className="event-digest">{v.specification_hash}</p>
                    <p>
                      {v.body.expected_output} ·{" "}
                      <Money value={v.body.max_budget_micros} />
                    </p>
                  </div>
                ))}
              </details>
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
