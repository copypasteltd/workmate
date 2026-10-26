import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Download,
  Files,
  ListChecks,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, download } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import {
  DateText,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  PageHeader,
  useData,
  useI18n,
} from "./ui";
import "./data-jobs.css";
type Access = {
  me: { user: { id: string } };
  has: (permission: string) => boolean;
};
type Source = "users" | "usage" | "billing" | "audit";
type Preview = {
  id: string;
  definition_hash: string;
  expires_at: string;
  command: any;
  manifest: {
    total: number;
    columns: string[];
    targets: { id: string; version: number | null; fingerprint: string }[];
  };
  sample: Record<string, unknown>[];
};
type Job = {
  id: string;
  kind: string;
  source: Source;
  state: string;
  revision: number;
  total: number;
  reason: string;
  created_at: string;
  expires_at: string;
  retry_of: string | null;
  error_code: string | null;
  counts: Record<string, number>;
  items?: any[];
  events?: any[];
  manifest: Preview["manifest"];
};
const root = "/v1/admin/data-jobs";
const sourceNames: Record<Source, [string, string]> = {
  users: ["用戶目錄", "User directory"],
  usage: ["任務用量明細", "Task usage records"],
  billing: ["費用流水", "Billing ledger"],
  audit: ["審計紀錄", "Audit records"],
};
const states: Record<string, [string, string]> = {
  queued: ["已排隊", "Queued"],
  running: ["處理中", "Running"],
  needs_authorization: ["需要重新授權", "Authorization needed"],
  succeeded: ["全部成功", "Succeeded"],
  partially_succeeded: ["部分成功", "Partially succeeded"],
  failed: ["失敗", "Failed"],
  cancelled: ["已取消", "Cancelled"],
  expired: ["已過期", "Expired"],
  pending: ["待執行", "Pending"],
};
function State({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <span className={"data-state data-state-" + value}>
      {states[value] ? t(...states[value]) : value}
    </span>
  );
}
const request = (path: string, body: unknown, idem?: string) =>
  api(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: idem ? { "Idempotency-Key": idem } : undefined,
  });

function UserSelection({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useI18n(),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const list = useData<{ items: any[] }>(
    "/v1/admin/users?limit=20" +
      (query ? "&q=" + encodeURIComponent(query) : ""),
  );
  return (
    <div className="data-selection">
      <Field label={t("搜尋並選擇用戶", "Find and select accounts")}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(
            "姓名或已授權的聯絡資料",
            "Name or authorized contact",
          )}
        />
      </Field>
      <div className="data-selected">
        <strong>
          {value.length} / 100 {t("已選", "selected")}
        </strong>
        <button
          type="button"
          className="text-button"
          onClick={() => onChange([])}
          disabled={!value.length}
        >
          {t("清除", "Clear")}
        </button>
      </div>
      <ErrorNotice error={list.error} />
      <div
        className="data-user-options"
        aria-label={t("用戶選項", "Account options")}
      >
        {list.loading && !list.data ? (
          <Loading />
        ) : (
          list.data?.items.map((u) => (
            <label key={u.id} className="data-user-option">
              <input
                type="checkbox"
                checked={value.includes(u.id)}
                disabled={!value.includes(u.id) && value.length >= 100}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, u.id]
                      : value.filter((id) => id !== u.id),
                  )
                }
              />
              <span>
                <strong>{u.display_name}</strong>
                <small>
                  {u.masked_contact} · {u.id}
                </small>
              </span>
              <State value={u.state} />
            </label>
          ))
        )}
        {list.data && !list.data.items.length && (
          <p className="muted">
            {t("沒有符合條件的用戶。", "No matching accounts.")}
          </p>
        )}
      </div>
      <details>
        <summary>
          {t("已選用戶 ID／直接輸入", "Selected IDs / enter IDs")}
        </summary>
        <textarea
          aria-label={t("已選用戶 ID", "Selected account IDs")}
          key={value.join(",")}
          defaultValue={value.join("\n")}
          rows={3}
          onBlur={(e) =>
            onChange([
              ...new Set(e.target.value.split(/[\s,]+/).filter(Boolean)),
            ])
          }
        />
      </details>
    </div>
  );
}
function PreviewFacts({ preview }: { preview: Preview }) {
  const { t } = useI18n();
  return (
    <div className="data-preview">
      <div className="data-review-banner">
        <ShieldCheck size={22} />
        <div>
          <strong>{t("核對後才會排程執行", "Review before scheduling")}</strong>
          <p>
            {preview.manifest.total}{" "}
            {t("筆已凍結的記錄與版本", "frozen records and versions")} ·{" "}
            {t("預覽到期", "Preview expires")}{" "}
            <DateText value={preview.expires_at} />
          </p>
        </div>
      </div>
      <dl className="data-facts">
        <div>
          <dt>{t("工作類型", "Operation")}</dt>
          <dd>
            {preview.command.kind === "export"
              ? t(...sourceNames[preview.command.source as Source])
              : t("用戶狀態 → ", "Account state → ") + preview.command.state}
          </dd>
        </div>
        <div>
          <dt>{t("操作原因", "Reason")}</dt>
          <dd>{preview.command.reason}</dd>
        </div>
        <div>
          <dt>{t("資料範圍", "Filters")}</dt>
          <dd>
            <code>
              {JSON.stringify(
                preview.command.filters ?? { ids: preview.command.ids },
              )}
            </code>
          </dd>
        </div>
      </dl>
      <h3>{t("前 5 筆預覽", "First 5 records")}</h3>
      <div className="data-samples">
        {preview.sample.map((r, i) => (
          <dl key={i}>
            {Object.entries(r).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>
                  {v === null
                    ? "—"
                    : typeof v === "object"
                      ? JSON.stringify(v)
                      : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
      <details>
        <summary>
          {t("完整對象、版本與欄位", "Exact targets, versions and fields")} (
          {preview.manifest.total})
        </summary>
        <p className="muted">{preview.manifest.columns.join(" · ")}</p>
        <ol className="data-targets">
          {preview.manifest.targets.map((v) => (
            <li key={v.id}>
              <code>{v.id}</code>
              <span>v{v.version ?? "—"}</span>
            </li>
          ))}
        </ol>
      </details>
      <small className="data-hash">SHA-256 · {preview.definition_hash}</small>
    </div>
  );
}
export function AdminDataComposer({
  access,
  kind = "export",
  initialSource = "users",
  initialPreview,
  onClose,
  onCreated,
}: {
  access: Access;
  kind?: "export" | "users.status";
  initialSource?: Source;
  initialPreview?: Preview;
  onClose: () => void;
  onCreated: (job: Job) => void;
}) {
  const { t } = useI18n(),
    [preview, setPreview] = useState<Preview | null>(initialPreview ?? null),
    [source, setSource] = useState<Source>(initialSource),
    [ids, setIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [confirmed, setConfirmed] = useState(false);
  async function submit(form: HTMLFormElement) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (preview) {
        if (!confirmed)
          throw new Error(
            t(
              "請先確認已核對對象、欄位與版本。",
              "Confirm that you reviewed the targets, fields and versions.",
            ),
          );
        const body = {
            preview_id: preview.id,
            definition_hash: preview.definition_hash,
          },
          key = await operationKey(access.me.user.id, "admin-data-job", body);
        const job = await request(root, body, key);
        await completeOperation(access.me.user.id, "admin-data-job", body);
        onCreated(job);
      } else {
        const f = new FormData(form),
          reason = String(f.get("reason") ?? "").trim();
        let command: any;
        if (kind === "users.status")
          command = { kind, ids, state: String(f.get("state")), reason };
        else {
          const filters: Record<string, string> = {};
          for (const key of [
            "q",
            "tenant_id",
            "project_id",
            "user_id",
            "state",
            "created_from",
            "created_to",
          ]) {
            const value = String(f.get(key) ?? "").trim();
            if (value)
              filters[key] = key.startsWith("created_")
                ? new Date(value).toISOString()
                : value;
          }
          command = { kind, source, filters, reason };
        }
        setPreview(await request(root + "/previews", command));
        setConfirmed(false);
      }
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        kind === "export"
          ? t("建立資料匯出", "Create a data export")
          : t("批次變更用戶狀態", "Change account states")
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="data-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(e.currentTarget);
        }}
      >
        <ErrorNotice error={error} />
        {preview ? (
          <>
            <PreviewFacts preview={preview} />
            <p className="data-explanation">
              {preview.command.kind === "export"
                ? t(
                    "CSV 只包含已授權的欄位。下載前會再次驗證權限及記錄版本；檔案 15 分鐘後過期。",
                    "CSV contains authorized fields. Permissions and frozen versions are checked again at download; files expire after 15 minutes.",
                  )
                : t(
                    "逐項執行並撤銷受影響帳戶的會話。版本有變的對象會列為失敗；已成功的項目不會重複處理。",
                    "Each account is processed separately and its sessions are revoked. Changed versions fail individually; successful items are never replayed.",
                  )}
            </p>
            <label className="data-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {t(
                "我已核對以上對象、欄位與版本",
                "I reviewed these targets, fields and versions",
              )}
            </label>
          </>
        ) : (
          <>
            <p className="data-explanation">
              {kind === "export"
                ? t(
                    "在這裡獨立設定匯出條件，最多 10,000 筆。時間條件指記錄建立時間；用戶目錄指註冊時間。",
                    "Set export criteria here, up to 10,000 records. Dates filter record creation; directory dates filter registration.",
                  )
                : t(
                    "選擇最多 100 位用戶，預覽後再確認排程。關閉帳戶請使用獨立審批流程。",
                    "Select up to 100 accounts, then preview and confirm. Closed accounts use the separate approval workflow.",
                  )}
            </p>
            {kind === "users.status" ? (
              <>
                <UserSelection value={ids} onChange={setIds} />
                <Field label={t("目標狀態", "Target state")}>
                  <select name="state">
                    <option value="frozen">
                      {t("凍結並撤銷會話", "Freeze and revoke sessions")}
                    </option>
                    <option value="active">{t("恢復啟用", "Activate")}</option>
                  </select>
                </Field>
              </>
            ) : (
              <>
                <Field label={t("資料來源", "Data source")}>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as Source)}
                  >
                    {(Object.keys(sourceNames) as Source[])
                      .filter((k) => access.has(`admin.${k}.read`))
                      .map((k) => (
                        <option key={k} value={k}>
                          {t(...sourceNames[k])}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field
                  label={t("關鍵字", "Search records")}
                  hint={t(
                    "用戶按姓名或已授權聯絡資料搜尋；其餘來源按記錄 ID、狀態或動作搜尋。",
                    "Directory search uses name or authorized contact; other sources use record ID, state or action.",
                  )}
                >
                  <input name="q" maxLength={160} />
                </Field>
                <div className="data-form-grid">
                  {[
                    "tenant_id",
                    ...(source !== "audit" ? ["project_id", "user_id"] : []),
                  ].map((name) => (
                    <Field
                      key={name}
                      label={
                        name === "tenant_id"
                          ? t("企業 ID（可選）", "Workspace ID (optional)")
                          : name === "project_id"
                            ? t("專案 ID（可選）", "Project ID (optional)")
                            : t("用戶 ID（可選）", "Account ID (optional)")
                      }
                    >
                      <input
                        name={name}
                        pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                        title="UUID"
                      />
                    </Field>
                  ))}
                  {source === "users" && (
                    <Field label={t("帳戶狀態", "Account state")}>
                      <select name="state">
                        <option value="">{t("全部狀態", "All states")}</option>
                        <option value="active">{t("有效", "Active")}</option>
                        <option value="frozen">{t("已凍結", "Frozen")}</option>
                        <option value="closed">{t("已關閉", "Closed")}</option>
                      </select>
                    </Field>
                  )}
                  <Field
                    label={
                      source === "users"
                        ? t("註冊時間：從", "Registered from")
                        : t("記錄時間：從", "Created from")
                    }
                  >
                    <input name="created_from" type="datetime-local" />
                  </Field>
                  <Field label={t("至（不包括）", "Until (exclusive)")}>
                    <input name="created_to" type="datetime-local" />
                  </Field>
                </div>
              </>
            )}
            <Field label={t("操作原因", "Reason")}>
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                rows={2}
              />
            </Field>
          </>
        )}
        <div className="data-modal-actions">
          {preview && !initialPreview && (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setConfirmed(false);
                setError(null);
              }}
            >
              {t("重新設定條件", "Edit selection")}
            </button>
          )}
          <button
            className="button primary"
            type="submit"
            disabled={
              busy ||
              (preview ? !confirmed : kind === "users.status" && !ids.length)
            }
          >
            {busy
              ? t("處理中…", "Working…")
              : preview
                ? t("確認並加入隊列", "Confirm and queue")
                : t("預覽記錄與版本", "Preview records & versions")}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminDataJobs({ access }: { access: Access }) {
  const { t } = useI18n(),
    [params, setParams] = useSearchParams(),
    selected = params.get("job"),
    [refresh, setRefresh] = useState(0),
    [modal, setModal] = useState<"export" | "users.status" | null>(null),
    [retry, setRetry] = useState<Preview | null>(null),
    [control, setControl] = useState<
      "cancel" | "reauthorize" | "retry-previews" | null
    >(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [partial, setPartial] = useState(false),
    [offset, setOffset] = useState(0),
    [before, setBefore] = useState<{ before: string; before_id: string }[]>([]);
  const list = useData<{
    items: Job[];
    has_more: boolean;
    next_cursor: { before: string; before_id: string } | null;
  }>(
    root +
      "?limit=30" +
      (before.length
        ? "&" + new URLSearchParams(before.at(-1)!).toString()
        : ""),
    refresh,
    4000,
  );
  const detail = useData<Job>(
      selected
        ? root + "/" + selected + "?offset=" + offset + "&limit=30"
        : null,
      refresh,
      selected ? 2000 : 0,
    ),
    job = detail.data;
  useEffect(() => {
    setPartial(false);
    setOffset(0);
    setControl(null);
    setError(null);
  }, [selected]);
  function created(j: Job) {
    setModal(null);
    setRetry(null);
    setBefore([]);
    setRefresh((v) => v + 1);
    setParams({ job: j.id });
  }
  async function perform(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  const open = (id: string) => setParams({ job: id });
  return (
    <div className="data-jobs-page">
      <PageHeader
        eyebrow="EVERY CHANGE, ACCOUNTED FOR."
        title={t("批次任務與資料匯出", "Data jobs & exports")}
        description={t(
          "先核對範圍，再逐項執行。隨時查看結果、處理失敗對象或下載已授權記錄。",
          "Review the scope, then follow each result. Resolve failed targets or download authorized records.",
        )}
        action={
          <div className="row-actions">
            {access.has("admin.jobs.create") &&
              access.has("admin.exports.create") && (
                <button
                  className="button secondary"
                  onClick={() => setModal("export")}
                >
                  <Download size={16} />
                  {t("建立匯出", "New export")}
                </button>
              )}
            {access.has("admin.jobs.create") &&
              access.has("admin.users.status.write") && (
                <button
                  className="button primary"
                  onClick={() => setModal("users.status")}
                >
                  <Plus size={16} />
                  {t("批次用戶操作", "Batch user action")}
                </button>
              )}
          </div>
        }
      />
      <ErrorNotice error={error ?? list.error ?? detail.error} />
      <div className="data-jobs-layout">
        <section
          className="card data-job-list"
          aria-label={t("我的任務", "My jobs")}
        >
          <header>
            <h2>{t("我的任務", "My jobs")}</h2>
            <button
              className="icon-button"
              title={t("重新整理", "Refresh")}
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw size={16} />
            </button>
          </header>
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <div className="data-empty">
              <Files size={28} />
              <h3>{t("從一份清楚的預覽開始", "Start with a clear preview")}</h3>
              <p>
                {t(
                  "完成預覽後，任務與每一項結果會保留在這裡。",
                  "After confirmation, the job and its individual results appear here.",
                )}
              </p>
            </div>
          ) : (
            list.data.items.map((j) => (
              <button
                key={j.id}
                className={
                  "data-job-row" + (selected === j.id ? " selected" : "")
                }
                onClick={() => open(j.id)}
                aria-pressed={selected === j.id}
              >
                <span className="data-job-mark">
                  {j.kind === "export" ? (
                    <Download size={17} />
                  ) : (
                    <ListChecks size={17} />
                  )}
                </span>
                <span>
                  <strong>
                    {j.kind === "export"
                      ? t(...sourceNames[j.source])
                      : t("用戶狀態變更", "Account state change")}
                  </strong>
                  <small>
                    <DateText value={j.created_at} /> · {j.total}{" "}
                    {t("筆", "records")}
                  </small>
                  <State value={j.state} />
                </span>
                <ArrowRight size={15} />
              </button>
            ))
          )}
          <footer className="data-list-pagination">
            <button
              className="text-button"
              disabled={!before.length}
              onClick={() => setBefore((v) => v.slice(0, -1))}
            >
              {t("較新", "Newer")}
            </button>
            <button
              className="text-button"
              disabled={!list.data?.has_more}
              onClick={() => {
                const next = list.data?.next_cursor;
                if (next) setBefore((v) => [...v, next]);
              }}
            >
              {t("較早", "Older")}
            </button>
          </footer>
        </section>
        <section
          className="card data-job-detail"
          aria-label={t("任務詳情", "Job details")}
        >
          {!selected ? (
            <div className="data-empty">
              <ShieldCheck size={32} />
              <h2>{t("每一個變更都有依據", "A record behind every change")}</h2>
              <p>
                {t(
                  "選擇任務，查看凍結範圍、執行結果與授權紀錄。",
                  "Select a job to see its frozen scope, item results and authorization history.",
                )}
              </p>
            </div>
          ) : !job ? (
            detail.loading ? (
              <Loading />
            ) : null
          ) : (
            <>
              <header>
                <div>
                  <p className="eyebrow">
                    {job.kind === "export"
                      ? t(...sourceNames[job.source])
                      : t("用戶狀態變更", "Account state change")}
                  </p>
                  <h2>{t("任務詳情", "Job details")}</h2>
                </div>
                <State value={job.state} />
              </header>
              <div
                className="data-result-counts"
                role="status"
                aria-live="polite"
              >
                {(["succeeded", "failed", "pending", "cancelled"] as const).map(
                  (k) => (
                    <div key={k}>
                      <strong>{job.counts[k]}</strong>
                      <span>{states[k] ? t(...states[k]) : k}</span>
                    </div>
                  ),
                )}
              </div>
              <progress
                value={job.total - job.counts.pending}
                max={job.total}
                aria-label={t("已處理項目", "Processed items")}
              />
              <p className="data-job-reason">{job.reason}</p>
              <dl className="data-facts">
                <div>
                  <dt>{t("任務 ID", "Job ID")}</dt>
                  <dd>
                    <code>{job.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>{t("到期時間", "Expires")}</dt>
                  <dd>
                    <DateText value={job.expires_at} />
                  </dd>
                </div>
                {job.retry_of && (
                  <div>
                    <dt>{t("重試來源", "Retry of")}</dt>
                    <dd>
                      <button
                        className="text-button"
                        onClick={() => open(job.retry_of!)}
                      >
                        {job.retry_of}
                      </button>
                    </dd>
                  </div>
                )}
              </dl>
              {job.error_code && (
                <div className="notice">
                  <span>{job.error_code}</span>
                  <p>
                    {t(
                      "請重新登入驗證身份；權限或政策已變更時，需要建立新的預覽。",
                      "Sign in again to verify your identity. Changed permissions or policies require a new preview.",
                    )}
                  </p>
                </div>
              )}
              <div className="row-actions data-job-actions">
                {["queued", "running", "needs_authorization"].includes(
                  job.state,
                ) && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setControl("cancel")}
                  >
                    {t("取消待執行項目", "Cancel pending items")}
                  </button>
                )}
                {job.state === "needs_authorization" &&
                  access.has("admin.jobs.create") && (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => setControl("reauthorize")}
                    >
                      {t("重新授權", "Reauthorize")}
                    </button>
                  )}
                {["failed", "partially_succeeded"].includes(job.state) &&
                  access.has("admin.jobs.create") && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setControl("retry-previews")}
                    >
                      {t("預覽失敗項目的重試", "Preview failed items only")}
                    </button>
                  )}
              </div>
              {job.kind === "export" &&
                ["succeeded", "partially_succeeded"].includes(job.state) &&
                access.has("admin.exports.download") && (
                  <div className="data-download">
                    <div>
                      <Download size={20} />
                      <strong>
                        {t("下載凍結記錄", "Download frozen records")}
                      </strong>
                    </div>
                    <p>
                      {t(
                        "下載時會重新核對存取範圍、欄位及每筆記錄的版本。",
                        "Access, fields and each frozen record are checked again at download.",
                      )}
                    </p>
                    {job.state === "partially_succeeded" && (
                      <label className="data-confirm">
                        <input
                          type="checkbox"
                          checked={partial}
                          onChange={(e) => setPartial(e.target.checked)}
                        />
                        {t(
                          "接受部分匯出；失敗記錄不在檔案內",
                          "Accept a partial export; failed records are excluded",
                        )}
                      </label>
                    )}
                    <div className="row-actions">
                      {(["csv", "manifest"] as const).map((format) => (
                        <button
                          key={format}
                          className={
                            "button " +
                            (format === "csv" ? "primary" : "secondary")
                          }
                          disabled={
                            busy ||
                            (job.state === "partially_succeeded" && !partial)
                          }
                          onClick={() =>
                            void perform(() =>
                              download(
                                `${root}/${job.id}/download?format=${format}${partial ? "&accept_partial=true" : ""}`,
                                `workmate-${job.id}.${format === "csv" ? "csv" : "json"}`,
                              ),
                            )
                          }
                        >
                          {format === "csv"
                            ? t("下載 CSV", "Download CSV")
                            : t("下載對象清單", "Download manifest")}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              <h3>{t("逐項結果", "Item results")}</h3>
              <div className="data-item-list">
                {job.items?.map((i) => (
                  <div className="data-item" key={i.ordinal}>
                    <span>
                      <code>{i.target_id}</code>
                      <small>
                        v{i.target_version ?? "—"} · {t("嘗試", "Attempts")}{" "}
                        {i.attempts}
                        {i.error_code ? " · " + i.error_code : ""}
                      </small>
                    </span>
                    <State value={i.state} />
                  </div>
                ))}
              </div>
              <div className="data-list-pagination">
                <button
                  className="text-button"
                  disabled={!offset}
                  onClick={() => setOffset((v) => Math.max(0, v - 30))}
                >
                  {t("上一頁", "Previous")}
                </button>
                <span>
                  {offset + 1}–{Math.min(offset + 30, job.total)} / {job.total}
                </span>
                <button
                  className="text-button"
                  disabled={offset + 30 >= job.total}
                  onClick={() => setOffset((v) => v + 30)}
                >
                  {t("下一頁", "Next")}
                </button>
              </div>
              <details className="data-audit">
                <summary>
                  {t(
                    "範圍、欄位與執行紀錄",
                    "Scope, fields & execution history",
                  )}
                </summary>
                <p>{job.manifest.columns.join(" · ")}</p>
                <ol>
                  {job.events?.map((e) => (
                    <li key={e.id}>
                      <strong>{e.action}</strong>
                      <DateText value={e.created_at} />
                      <code>{JSON.stringify(e.detail)}</code>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
        </section>
      </div>
      {(modal || retry) && (
        <AdminDataComposer
          key={retry?.id ?? modal}
          access={access}
          kind={retry?.command.kind ?? modal ?? "export"}
          initialPreview={retry ?? undefined}
          onClose={() => {
            setModal(null);
            setRetry(null);
          }}
          onCreated={created}
        />
      )}
      {control && job && (
        <Modal
          title={
            control === "cancel"
              ? t("取消待執行項目", "Cancel pending items")
              : control === "reauthorize"
                ? t("重新授權此任務", "Reauthorize this job")
                : t("只重新處理失敗項目", "Retry failed items only")
          }
          onClose={() => {
            if (!busy) setControl(null);
          }}
        >
          <form
            className="data-compose"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void perform(async () => {
                const result = await request(`${root}/${job.id}/${control}`, {
                  expected_revision: job.revision,
                  reason: String(f.get("reason")),
                });
                if (control === "retry-previews") setRetry(result);
                setControl(null);
              });
            }}
          >
            <p className="muted">
              {control === "cancel"
                ? t(
                    "已完成的變更會保留，尚未執行的項目會停止。",
                    "Committed changes are preserved; pending items stop.",
                  )
                : control === "reauthorize"
                  ? t(
                      "僅在原有權限與政策仍然有效時恢復待執行項目。",
                      "Pending work resumes only if the original permissions and policy remain valid.",
                    )
                  : t(
                      "下一步會載入失敗對象的最新版本供核對，再建立獨立子任務；已成功對象不會加入。",
                      "Review current versions of failed targets before creating a separate child job. Successful targets are excluded.",
                    )}
            </p>
            <ErrorNotice error={error} />
            <Field label={t("操作原因", "Reason")}>
              <textarea name="reason" required minLength={3} maxLength={1000} />
            </Field>
            <button className="button primary" disabled={busy}>
              {busy ? t("處理中…", "Working…") : t("繼續", "Continue")}
              <ArrowRight size={16} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
