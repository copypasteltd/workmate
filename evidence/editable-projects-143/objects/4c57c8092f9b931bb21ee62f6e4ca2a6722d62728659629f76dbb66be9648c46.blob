import { useState } from "react";
import { Link } from "react-router-dom";
import { Upload, RefreshCw, Paperclip } from "lucide-react";
import { post } from "./api";
import { useWorkspace } from "./context";
import {
  Badge,
  ErrorNotice,
  Field,
  Loading,
  Money,
  Modal,
  useData,
  useI18n,
} from "./ui";
import { ResumableUpload } from "./resumable-upload";

export function TaskInputRequests({
  task,
  onChange,
}: {
  task: any;
  onChange?: () => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [refresh, setRefresh] = useState(0);
  const data = useData(
    task.status === "needs_input"
      ? `${w.base}/tasks/${task.id}/dependencies`
      : null,
    refresh,
    5000,
  );
  if (task.status !== "needs_input") return null;
  return (
    <section
      className="card task-inputs"
      aria-label={t("補齊工作資料", "Provide task inputs")}
    >
      <div className="section-title">
        <h2>
          <Paperclip size={18} />
          {Number(task.attempt) > 0
            ? t("補齊資料，繼續工作", "Provide inputs to continue")
            : t("準備好資料，再開始", "Ready the inputs, then begin")}
        </h2>
        <button
          className="text-button"
          onClick={() => setRefresh((v) => v + 1)}
          aria-label={t("重新整理資料需求", "Refresh input requests")}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="muted small-text">
        {Number(task.attempt) > 0
          ? t(
              "上一輪處理已完成，原預算保持預留。補齊資料後，會沿用原工作和會話繼續處理；已記錄的用量會納入最後結算。",
              "The previous turn is complete and the original budget remains reserved. Providing all inputs continues this same task and conversation. Recorded usage is included in the final settlement.",
            )
          : t(
              "這項工作尚未呼叫模型，原預算保持預留。補齊所有所需資料後，會繼續同一項工作。",
              "This task has not called the model. Its original budget remains reserved. Once all requested inputs are ready, the same task continues.",
            )}
      </p>
      {Number(task.attempt) > 0 && (
        <p className="small-text">
          {t("目前已記錄用量：", "Recorded usage so far: ")}
          <Money value={task.accrued_micros ?? 0} />
        </p>
      )}
      <ErrorNotice error={data.error} />
      {!data.data && !data.error && <Loading />}
      {!data.error &&
        data.data?.items.map((d: any) => (
          <InputRequest
            key={`${d.id}:${d.version}`}
            revision={refresh}
            task={task}
            dependency={d}
            onChange={() => {
              setRefresh((v) => v + 1);
              onChange?.();
            }}
          />
        ))}
    </section>
  );
}
function InputRequest({
  task,
  dependency: d,
  onChange,
  revision,
}: {
  task: any;
  dependency: any;
  onChange: () => void;
  revision: number;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [cursor, setCursor] = useState(""),
    [history, setHistory] = useState<string[]>([]),
    [selected, setSelected] = useState(""),
    [refresh, setRefresh] = useState(0),
    [upload, setUpload] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const root = `/v1/tenants/${w.tenant}/task-dependencies/${d.id}`;
  const candidates = useData(
    d.state === "pending" && d.kind !== "question"
      ? root +
          "/resources?" +
          new URLSearchParams({
            q: query,
            ...(cursor ? { cursor } : {}),
            limit: "50",
          })
      : null,
    refresh + revision + d.version,
  );
  const available = candidates.error ? undefined : candidates.data;
  if (d.kind === "question") return <QuestionRequest dependency={d} onChange={onChange} />;
  return (
    <article className="input-request" data-dependency={d.id}>
      <div className="section-title">
        <strong>{d.description}</strong>
        <Badge value={d.state === "resolved" ? "ready" : d.state} />
      </div>
      {d.state === "pending" && (
        <>
          <form
            className="dependency-search"
            onSubmit={(e) => {
              e.preventDefault();
              setCursor("");
              setHistory([]);
              setSelected("");
              setQuery(q);
              setRefresh((v) => v + 1);
            }}
          >
            <Field label={t("搜尋可用資料", "Search available inputs")}>
              <input
                value={q}
                maxLength={160}
                onChange={(e) => setQ(e.target.value)}
              />
            </Field>
            <button className="button secondary" type="submit">
              {t("搜尋", "Search")}
            </button>
          </form>
          <ErrorNotice error={candidates.error} />
          <ErrorNotice error={error} />
          <Field
            label={
              d.kind === "file"
                ? t("選擇目前檔案版本", "Choose a current file version")
                : t("選擇已授權連接", "Choose an authorized connection")
            }
          >
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!available || busy}
            >
              <option value="">
                {t("請明確選擇一項資料", "Select an input explicitly")}
              </option>
              {available?.items.map((r: any) => (
                <option value={r.id} key={r.id}>
                  {r.name}
                  {r.version ? ` · v${r.version}` : ""}
                </option>
              ))}
            </select>
          </Field>
          {!available && !candidates.error && <Loading />}
          {available?.items.length === 0 && (
            <p className="muted small-text">
              {t(
                "沒有符合條件的資料。可上傳檔案，或到連接頁完成授權後重新搜尋。",
                "No matching inputs. Upload a file, or authorize a connection and search again.",
              )}
            </p>
          )}
          <div className="input-request-actions">
            {d.kind === "file" ? (
              <button
                className="button secondary"
                onClick={() => setUpload(true)}
              >
                <Upload size={15} />
                {t("上傳所需檔案", "Upload required file")}
              </button>
            ) : (
              <Link to="/app/connections" className="button secondary">
                {t("管理連接", "Manage connections")}
              </Link>
            )}
            <button
              className="button primary"
              disabled={
                !selected ||
                busy ||
                !available?.items.some((r: any) => r.id === selected)
              }
              onClick={() => {
                setBusy(true);
                setError(null);
                void post(root + "/resolutions", {
                  expected_version: d.version,
                  resource_ids: [selected],
                })
                  .then(() => {
                    setSelected("");
                    onChange();
                  })
                  .catch(setError)
                  .finally(() => setBusy(false));
              }}
            >
              {busy
                ? t("正在確認…", "Confirming…")
                : t("確認使用此資料", "Confirm this input")}
            </button>
          </div>
          <div className="input-request-actions">
            <button
              className="text-button"
              disabled={!history.length}
              onClick={() => {
                const old = [...history];
                setCursor(old.pop() ?? "");
                setHistory(old);
                setSelected("");
              }}
            >
              {t("上一頁", "Previous page")}
            </button>
            <button
              className="text-button"
              disabled={!available?.next_cursor}
              onClick={() => {
                setHistory([...history, cursor]);
                setCursor(available.next_cursor);
                setSelected("");
              }}
            >
              {t("下一頁", "Next page")}
            </button>
          </div>
          {d.kind === "file" ? (
            <p className="muted small-text">
              {t(
                "此處使用所選的目前版本；若來源更新或撤銷，須重新選擇。歷史版本仍可透過雲檔案引用。",
                "This checkpoint uses the selected current version. Updated or revoked sources require a fresh choice. Use cloud file references for historical versions.",
              )}
            </p>
          ) : (
            <p className="muted small-text">
              {t(
                "連接不會自動同步報表或授權未選取的廣告帳戶。",
                "Selecting a connection does not synchronize reports or authorize unselected ad accounts.",
              )}
            </p>
          )}
        </>
      )}
      {upload && (
        <Modal
          title={t("上傳所需檔案", "Upload required file")}
          onClose={() => setUpload(false)}
        >
          <ResumableUpload
            conversationId={task.conversation_id}
            onDone={() => {
              setUpload(false);
              setCursor("");
              setHistory([]);
              setSelected("");
              setRefresh((v) => v + 1);
            }}
          />
        </Modal>
      )}
    </article>
  );
}

function QuestionRequest({ dependency: d, onChange }: { dependency: any; onChange: () => void }) {
  const w = useWorkspace(), { t } = useI18n();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  return <article className="input-request" data-dependency={d.id}>
    <div className="section-title"><strong>{d.description}</strong><Badge value={d.state === "resolved" ? "ready" : d.state} /></div>
    {d.state === "resolved" ? <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{d.answer}</p> : d.state === "pending" &&
      <form onSubmit={e => {
        e.preventDefault();
        if (busy || !answer.trim()) return;
        setBusy(true); setError(null);
        void post(`/v1/tenants/${w.tenant}/task-dependencies/${d.id}/resolutions`, {
          expected_version: d.version, answer: answer.trim(),
        }).then(() => { setAnswer(""); onChange(); }).catch(setError).finally(() => setBusy(false));
      }}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {!!d.question_options?.length && <div className="input-request-actions" role="group" aria-label={t("建議答案", "Suggested answers")}>
            {d.question_options.map((choice: string) => <button className="button secondary" type="button" key={choice} aria-pressed={answer === choice}
              style={{ whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: "100%" }} onClick={() => setAnswer(choice)}>{choice}</button>)}
          </div>}
          <Field label={t("你的回答", "Your answer")}><textarea rows={3} maxLength={4000} value={answer} onChange={e => setAnswer(e.target.value)} /></Field>
          <p className="muted small-text">{t("可選用建議或自行回答。請勿填寫密碼或 API 密鑰。", "Choose a suggestion or write your own answer. Do not include passwords or API keys.")}</p>
          <ErrorNotice error={error} />
          <button className="button primary" type="submit" disabled={busy || !answer.trim()}>{busy ? t("正在確認…", "Confirming…") : t("確認回答", "Confirm answer")}</button>
        </fieldset>
      </form>}
  </article>;
}
