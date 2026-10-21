import { connectorLimit } from "./connector-labels";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Download,
  Plug,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, download } from "./api";
import { useWorkspace } from "./context";
import {
  Badge,
  ErrorNotice,
  Field,
  Modal,
  PageHeader,
  useData,
  useI18n,
} from "./ui";
import "./connections.css";

type Connection = {
  id: string;
  project_id: string;
  provider: string;
  state: string;
  auth_version: number;
  version: number;
  account_ids: string[];
  data_as_of: string | null;
  authorization_url?: string;
};
type Account = {
  account_id: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  kind: string;
  readable: boolean;
  reporting_identity: string | null;
  reporting_identity_source: string;
  permission_level: string | null;
};
type Job = {
  id: string;
  status: string;
  kind: string;
  segment: number;
  page_count: number;
  row_count: number;
  attempts: number;
  error_code: string | null;
  limitations: string[];
  next_attempt_at: string;
  created_at: string;
  retry_of: string | null;
};
type Snapshot = {
  id: string;
  project_id: string;
  state: string;
  row_count: number;
  captured_at: string;
  data_as_of: string | null;
  asset_id: string;
  dataset_ids: string[];
  limitations: string[];
};
type Detail = {
  connection: Connection;
  name: string;
  source_mode: string;
  api_version: string;
  project_ids: string[];
  scopes: string[];
  catalog_state: string;
  limitations: string[];
  accounts: Account[];
  last_sync_at: string | null;
  jobs: Job[];
  snapshots: Snapshot[];
  next_history_cursor: string | null;
};
type History = Pick<Detail, "jobs" | "snapshots" | "next_history_cursor">;
type Fact = {
  key: string;
  account_id: string;
  date: string;
  profile: string;
  dimensions: Record<string, string>;
  metrics: Record<string, string | null>;
  currency: string | null;
  timezone: string | null;
};
type Facts = {
  id: string;
  row_count: number;
  source_mode: string;
  captured_at: string;
  data_as_of: null;
  facts: Fact[];
  next_offset: number | null;
  limitations: string[];
  dataset_ids: string[];
  spec_hash: string;
};
async function request<T>(
  tenant: string,
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) {
  return api<T>(path, {
    method,
    headers: { "X-Tenant-ID": tenant },
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function useScoped<T>(
  tenant: string,
  path: string | null,
  refresh = 0,
  interval = 0,
) {
  const key = tenant + ":" + path,
    [result, setResult] = useState<{
      key: string;
      data: T | null;
      error: Error | null;
    }>({ key: "", data: null, error: null });
  useEffect(() => {
    if (!path || !tenant) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const data = await request<T>(
          tenant,
          path,
          "GET",
          undefined,
          ctrl.signal,
        );
        if (live) setResult({ key, data, error: null });
      } catch (e) {
        if (live && !ctrl.signal.aborted)
          setResult({ key, data: null, error: e as Error });
      } finally {
        if (live && interval) timer = setTimeout(run, interval);
      }
    };
    void run();
    return () => {
      live = false;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [key, refresh, interval]);
  return result.key === key ? result : { key, data: null, error: null };
}
async function authorize(c: Connection) {
  if (!c.authorization_url)
    throw new Error("重新建立授權 / Restart authorization");
  const state = new URL(c.authorization_url).searchParams.get("state");
  if (window.copyPasteBridge) {
    if (!state) throw new Error("Invalid authorization state");
    await window.copyPasteBridge.authorizeConnector(state);
  } else window.location.assign(c.authorization_url);
}
export function ConnectorLaunch() {
  const { t } = useI18n(),
    [q] = useSearchParams(),
    state = q.get("state"),
    valid = !!state && /^[\w-]{43}$/.test(state),
    r = useData<{ authorization_url: string; source_mode: string }>(
      valid ? `/v1/connections/launch/${state}` : null,
    );
  useEffect(() => {
    if (r.data) window.location.replace(r.data.authorization_url);
  }, [r.data]);
  return (
    <main className="connector-launch card">
      <p className="eyebrow">COPYPASTE · CONNECTIONS</p>
      <h1>{t("開啟帳戶授權", "Opening account authorization")}</h1>
      <p>
        {t(
          "正在前往供應商的只讀授權頁。完成後，請返回原來的 CopyPaste 工作台。",
          "Opening the provider’s read-only consent page. Return to your original CopyPaste workspace after authorization.",
        )}
      </p>
      <ErrorNotice
        error={
          r.error ??
          (!valid
            ? new Error(t("授權連結無效", "Invalid authorization link"))
            : null)
        }
      />
    </main>
  );
}
const selectedToggle = (values: string[], id: string) =>
  values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
export function Connections() {
  const w = useWorkspace();
  return <ConnectionWorkspace key={w.tenant + ":" + w.project} />;
}
function ConnectionWorkspace() {
  const { t } = useI18n(),
    w = useWorkspace(),
    [q] = useSearchParams(),
    [refresh, setRefresh] = useState(0),
    [selected, setSelected] = useState<string | null>(q.get("connected")),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    busyRef = useRef(false),
    [revoke, setRevoke] = useState(false),
    [snapshot, setSnapshot] = useState<string | null>(null);
  const [directoryPages, setDirectoryPages] = useState<string[]>([]),
    [historyPages, setHistoryPages] = useState<string[]>([]);
  const directoryCursor = directoryPages.at(-1),
    historyCursor = historyPages.at(-1);
  const providers = useData<{
    items: {
      provider: string;
      name: string;
      configured: boolean;
      source_mode: string;
      api_version: string | null;
    }[];
  }>("/v1/connector-providers");
  const list = useScoped<{ items: Connection[]; next_cursor: string | null }>(
      w.tenant,
      `/v1/connections?project_id=${w.project}&limit=20${directoryCursor ? `&cursor=${directoryCursor}` : ""}`,
      refresh,
      4000,
    ),
    rows = list.data?.items ?? [];
  const id =
    selected ??
    rows.find((c) => c.state !== "revoked")?.id ??
    rows[0]?.id ??
    null;
  const detail = useScoped<Detail>(
      w.tenant,
      id ? `/v1/connections/${id}/detail` : null,
      refresh,
      2000,
    ),
    d = detail.data;
  const historyPage = useScoped<History>(
    w.tenant,
    id && historyCursor
      ? `/v1/connections/${id}/history?cursor=${historyCursor}`
      : null,
    refresh,
  );
  const visibleHistory = historyCursor ? historyPage.data : d;
  const jobs = visibleHistory?.jobs ?? [],
    snapshots = visibleHistory?.snapshots ?? [];
  useEffect(() => {
    setHistoryPages([]);
  }, [id]);
  const [accounts, setAccounts] = useState<string[]>([]),
    [projects, setProjects] = useState<string[]>([]),
    [from, setFrom] = useState(
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(
      new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    );
  useEffect(() => {
    if (d) {
      setAccounts(d.connection.account_ids);
      setProjects(d.project_ids.length ? d.project_ids : [w.project]);
    }
  }, [id, d?.connection.version]);
  const run = async (fn: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };
  const active = d?.jobs.find((j) => ["queued", "running"].includes(j.status));
  const changed =
    !!d &&
    (JSON.stringify([...accounts].sort()) !==
      JSON.stringify([...d.connection.account_ids].sort()) ||
      JSON.stringify([...projects].sort()) !==
        JSON.stringify([...d.project_ids].sort()));
  return (
    <>
      <PageHeader
        eyebrow="BRING YOUR WORK TOGETHER."
        title={t("連接應用", "Connections")}
        description={t(
          "授權帳戶，確認項目範圍，再建立可追溯的營銷數據快照。",
          "Authorize accounts, confirm project access and build traceable marketing snapshots.",
        )}
      />
      <ErrorNotice
        error={
          error ??
          list.error ??
          detail.error ??
          historyPage.error ??
          providers.error
        }
      />
      <div className="connection-grid connector-providers">
        {providers.data?.items.map((p) => (
          <article className="card connection-card" key={p.provider}>
            <div className="connection-brand">
              <span>
                <Plug size={20} />
              </span>
              <Badge
                value={
                  p.source_mode === "simulated"
                    ? "simulated"
                    : p.configured
                      ? "ready"
                      : "pending"
                }
              />
            </div>
            <h2>{p.name}</h2>
            <p className="muted">
              {p.provider === "ga4"
                ? t(
                    "網站流量、著陸頁與事件，分開保留報告粒度。",
                    "Website traffic, landing pages and events with separate report grains.",
                  )
                : p.provider === "search_console"
                  ? t(
                      "已授權站點的搜尋查詢、頁面及曝光。",
                      "Search queries, pages and impressions for verified sites.",
                    )
                  : t(
                      "廣告活動、費用及平台轉換口徑。",
                      "Campaigns, spend and provider conversion definitions.",
                    )}
            </p>
            <button
              className="button secondary small"
              disabled={!p.configured || busy}
              onClick={() =>
                void run(async () => {
                  const c = await request<Connection>(
                    w.tenant,
                    "/v1/connections",
                    "POST",
                    { project_id: w.project, provider: p.provider },
                  );
                  setSelected(c.id);
                  await authorize(c);
                })
              }
            >
              {t("連接新帳戶", "Connect account")}
              <ArrowUpRight size={16} />
            </button>
            <small>
              {p.source_mode === "simulated"
                ? t(
                    "模擬資料 · 本機授權演示",
                    "Synthetic data · local consent demo",
                  )
                : p.configured
                  ? t(
                      "由帳戶擁有人授權只讀存取",
                      "Read access granted by the account owner",
                    )
                  : t("待企業設定 OAuth", "Company OAuth setup required")}
            </small>
          </article>
        ))}
      </div>
      {(rows.length > 0 || id) && (
        <section className="connector-workspace">
          <aside
            className="card connector-directory"
            aria-label={t("連接列表", "Connections list")}
          >
            <h2>{t("我的連接", "Your connections")}</h2>
            {rows.map((c) => (
              <button
                key={c.id}
                className={
                  "connector-directory-item " + (id === c.id ? "selected" : "")
                }
                aria-pressed={id === c.id}
                onClick={() => {
                  setSelected(c.id);
                  setError(null);
                }}
              >
                <strong>
                  {providers.data?.items.find((p) => p.provider === c.provider)
                    ?.name ?? c.provider}
                </strong>
                <Badge value={c.state} />
                <small>
                  {c.id.slice(0, 8)} · {c.account_ids.length}{" "}
                  {t("帳戶", "accounts")}
                </small>
              </button>
            ))}
            <div className="row-actions">
              <button
                className="text-button"
                disabled={!directoryPages.length}
                onClick={() => {
                  setDirectoryPages((v) => v.slice(0, -1));
                  setSelected(null);
                }}
              >
                {t("上一頁", "Previous")}
              </button>
              <button
                className="text-button"
                disabled={!list.data?.next_cursor}
                onClick={() => {
                  if (list.data?.next_cursor)
                    setDirectoryPages((v) => [...v, list.data!.next_cursor!]);
                  setSelected(null);
                }}
              >
                {t("下一頁", "Next")}
              </button>
            </div>
          </aside>
          <div className="connector-panels">
            {d && (
              <>
                <section className="card connector-scope">
                  <div className="section-title">
                    <div>
                      <p className="eyebrow">01 · AUTHORIZE & SELECT</p>
                      <h2>{d.name}</h2>
                    </div>
                    <Badge value={d.connection.state} />
                  </div>
                  {d.source_mode === "simulated" && (
                    <p className="notice">
                      {t(
                        "本連接只使用合成數據，不會讀取真實客戶帳戶。",
                        "This connection uses synthetic data and does not access real customer accounts.",
                      )}
                    </p>
                  )}
                  <p className="muted">
                    {t("目錄狀態", "Account discovery")}:{" "}
                    <Badge value={d.catalog_state} />
                  </p>
                  {d.connection.state === "pending" && (
                    <button
                      className="button"
                      disabled={busy || !d.connection.authorization_url}
                      onClick={() => void run(() => authorize(d.connection))}
                    >
                      {t("繼續授權", "Continue authorization")}
                      <ArrowUpRight size={16} />
                    </button>
                  )}
                  {d.connection.state === "reauth_required" && (
                    <p className="notice">
                      {t(
                        "授權已失效。請透過上方的「連接新帳戶」重新授權。現有快照會按保留設定繼續管理。",
                        "Authorization expired. Connect the provider again above. Existing snapshots retain their original retention policy.",
                      )}
                    </p>
                  )}
                  <fieldset
                    disabled={
                      busy ||
                      !["active", "degraded"].includes(d.connection.state) ||
                      d.catalog_state !== "complete"
                    }
                  >
                    <legend>
                      {t(
                        "選擇獲准的帳戶 / 屬性 / 站點",
                        "Choose authorized accounts / properties / sites",
                      )}
                    </legend>
                    <div className="connector-account-list">
                      {d.accounts.map((a) => (
                        <label
                          key={a.account_id}
                          className={
                            "connector-account " +
                            (!a.readable || a.kind === "manager"
                              ? "unavailable"
                              : "")
                          }
                        >
                          <input
                            type="checkbox"
                            checked={accounts.includes(a.account_id)}
                            disabled={!a.readable || a.kind === "manager"}
                            onChange={() =>
                              setAccounts((v) =>
                                selectedToggle(v, a.account_id),
                              )
                            }
                          />
                          <span>
                            <strong>{a.name}</strong>
                            <small>
                              {a.account_id} ·{" "}
                              {a.currency ?? t("幣種不適用", "No currency")} ·{" "}
                              {a.timezone ?? t("時區未知", "Unknown timezone")}
                            </small>
                            <small>
                              {a.reporting_identity
                                ? t("報告身份", "Reporting identity") +
                                  ": " +
                                  a.reporting_identity
                                : a.kind === "manager"
                                  ? t(
                                      "經理帳戶 · 請選子帳戶",
                                      "Manager · select a reporting account",
                                    )
                                  : !a.readable
                                    ? t(
                                        "沒有報表讀取權限",
                                        "Reporting access unavailable",
                                      )
                                    : a.permission_level}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                    {!d.accounts.length && (
                      <p className="muted">
                        {t("尚未發現可用帳戶。", "No accounts discovered yet.")}
                      </p>
                    )}
                    <h3 className="connector-scope-label">
                      {t(
                        "允許使用快照的項目",
                        "Projects allowed to use these snapshots",
                      )}
                    </h3>
                    <div className="connector-project-list">
                      {w.projects.map((p) => (
                        <label key={p.id}>
                          <input
                            type="checkbox"
                            checked={projects.includes(p.id)}
                            disabled={p.id === w.project}
                            onChange={() =>
                              setProjects((v) => selectedToggle(v, p.id))
                            }
                          />
                          {p.name}
                          {p.id === w.project && (
                            <small>{t("歸屬項目", "Home project")}</small>
                          )}
                        </label>
                      ))}
                    </div>
                    <button
                      className="button secondary"
                      disabled={!changed || !!active}
                      onClick={() =>
                        void run(() =>
                          request(w.tenant, `/v1/connections/${id}`, "PATCH", {
                            expected_version: d.connection.version,
                            account_ids: accounts,
                            project_ids: projects,
                          }),
                        )
                      }
                    >
                      <ShieldCheck size={16} />
                      {t("確認帳戶與項目範圍", "Confirm accounts & projects")}
                    </button>
                  </fieldset>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      disabled={
                        busy ||
                        !!active ||
                        !["active", "degraded"].includes(d.connection.state)
                      }
                      onClick={() =>
                        void run(() =>
                          request(
                            w.tenant,
                            `/v1/connections/${id}/discovery`,
                            "POST",
                            {},
                          ),
                        )
                      }
                    >
                      <RefreshCw size={14} />
                      {t(
                        "重新發現帳戶並清除舊選擇",
                        "Rediscover accounts & clear selection",
                      )}
                    </button>
                    <button
                      className="text-button danger"
                      disabled={busy || d.connection.state === "revoked"}
                      onClick={() => setRevoke(true)}
                    >
                      {t("撤銷連接", "Revoke connection")}
                    </button>
                  </div>
                </section>
                <section className="card">
                  <p className="eyebrow">02 · SYNC A SNAPSHOT</p>
                  <h2>{t("同步數據", "Sync data")}</h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(() =>
                        request(
                          w.tenant,
                          `/v1/connections/${id}/syncs`,
                          "POST",
                          { date_from: from, date_to: to },
                        ),
                      );
                    }}
                  >
                    <div className="form-grid">
                      <Field label={t("開始日期", "From")}>
                        <input
                          required
                          type="date"
                          value={from}
                          max={to}
                          onChange={(e) => setFrom(e.target.value)}
                        />
                      </Field>
                      <Field label={t("結束日期", "To")}>
                        <input
                          required
                          type="date"
                          value={to}
                          min={from}
                          onChange={(e) => setTo(e.target.value)}
                        />
                      </Field>
                    </div>
                    <p className="muted">
                      {t(
                        "每次同步會建立新快照。請先確認上方的帳戶與項目，日期按各來源帳戶的時區解讀。",
                        "Each sync creates a new snapshot. Confirm account and project scope above; dates follow each source account’s timezone.",
                      )}
                    </p>
                    <button
                      className="button"
                      disabled={
                        busy ||
                        !!active ||
                        changed ||
                        !d.connection.account_ids.length ||
                        d.catalog_state !== "complete" ||
                        d.connection.state !== "active"
                      }
                    >
                      <RefreshCw size={16} />
                      {active
                        ? t("同步進行中", "Sync in progress")
                        : t("建立同步快照", "Create snapshot")}
                    </button>
                  </form>
                  <div className="connector-freshness">
                    <div>
                      <span>{t("最近同步", "Last sync")}</span>
                      <strong>
                        {d.last_sync_at
                          ? new Date(d.last_sync_at).toLocaleString()
                          : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>
                        {t("供應商數據截止時間", "Provider data cutoff")}
                      </span>
                      <strong>{t("供應商未提供", "Not supplied")}</strong>
                    </div>
                  </div>
                  <div className="connector-job-list">
                    {jobs.map((j) => (
                      <article key={j.id} className="connector-job">
                        <div>
                          <strong>
                            {j.kind === "discover"
                              ? t("帳戶發現", "Account discovery")
                              : t("數據同步", "Data sync")}
                          </strong>
                          <Badge value={j.status} />
                          <small>
                            {new Date(j.created_at).toLocaleString()}
                          </small>
                        </div>
                        <p>
                          {j.page_count} {t("頁", "pages")} · {j.row_count}{" "}
                          {t("行", "rows")} · {j.attempts}{" "}
                          {t("次當頁重試", "page retries")}
                        </p>
                        {j.error_code && (
                          <p className="notice">
                            {connectorLimit(j.error_code, t)}
                            {j.status === "queued" &&
                              " · " +
                                t("下次嘗試", "Next attempt") +
                                ": " +
                                new Date(j.next_attempt_at).toLocaleString()}
                          </p>
                        )}
                        <div className="row-actions">
                          {["queued", "running"].includes(j.status) && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  request(
                                    w.tenant,
                                    `/v1/syncs/${j.id}/cancel`,
                                    "POST",
                                    {},
                                  ),
                                )
                              }
                            >
                              <X size={14} />
                              {t("取消後續讀取", "Cancel remaining reads")}
                            </button>
                          )}
                          {["partial", "failed", "cancelled"].includes(
                            j.status,
                          ) && (
                            <button
                              className="text-button"
                              disabled={
                                busy ||
                                !!active ||
                                d.connection.state === "reauth_required" ||
                                d.connection.state === "revoked"
                              }
                              onClick={() =>
                                void run(() =>
                                  request(
                                    w.tenant,
                                    `/v1/syncs/${j.id}/retry`,
                                    "POST",
                                    {},
                                  ),
                                )
                              }
                            >
                              {t("建立新重試", "Retry as a new sync")}
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
                <section className="card">
                  <p className="eyebrow">03 · REVIEW & USE</p>
                  <h2>{t("快照與分析", "Snapshots & analysis")}</h2>
                  {!snapshots.length ? (
                    <p className="muted">
                      {t(
                        "同步完成或部分完成後，快照會出現在這裡。",
                        "Completed and partial snapshots appear here.",
                      )}
                    </p>
                  ) : (
                    snapshots.map((snap) => (
                      <article className="connector-snapshot" key={snap.id}>
                        <div>
                          <Badge value={snap.state} />
                          <strong>
                            {snap.row_count} {t("行來源事實", "source facts")}
                          </strong>
                          <small>
                            {new Date(snap.captured_at).toLocaleString()}
                          </small>
                        </div>
                        <p className="muted">
                          {t(
                            "抓取時間與供應商數據截止時間不同；已完成 API 分頁不代表來源覆蓋完整。",
                            "Capture time differs from the provider’s data cutoff. Completed API pagination does not prove full source coverage.",
                          )}
                        </p>
                        <div className="row-actions">
                          <button
                            className="button secondary small"
                            onClick={() => setSnapshot(snap.id)}
                          >
                            {t("檢查數據與限制", "Inspect facts & limits")}
                          </button>
                          {["json", "csv"].map((format) => (
                            <button
                              key={format}
                              className="text-button"
                              onClick={() =>
                                void run(() =>
                                  download(
                                    `${w.base}/connector-snapshots/${snap.id}?format=${format}`,
                                    `marketing-${snap.id}.${format}`,
                                  ),
                                )
                              }
                            >
                              <Download size={14} />
                              {format.toUpperCase()}
                            </button>
                          ))}
                          {!!snap.dataset_ids.length && (
                            <Link className="text-button" to="/app/analytics">
                              <Check size={14} />
                              {t("前往廣告分析", "Open campaign analysis")}
                            </Link>
                          )}
                        </div>
                      </article>
                    ))
                  )}
                  <nav
                    className="row-actions"
                    aria-label={t("同步記錄分頁", "Sync history pages")}
                  >
                    <button
                      className="text-button"
                      disabled={!historyPages.length}
                      onClick={() => setHistoryPages((v) => v.slice(0, -1))}
                    >
                      {t("較新記錄", "Newer history")}
                    </button>
                    <span className="muted">
                      {t(
                        "每頁最多 20 次同步及其快照",
                        "Up to 20 syncs and their snapshots per page",
                      )}
                    </span>
                    <button
                      className="text-button"
                      disabled={!visibleHistory?.next_history_cursor}
                      onClick={() => {
                        if (visibleHistory?.next_history_cursor)
                          setHistoryPages((v) => [
                            ...v,
                            visibleHistory.next_history_cursor!,
                          ]);
                      }}
                    >
                      {t("較舊記錄", "Older history")}
                    </button>
                  </nav>
                </section>
              </>
            )}
          </div>
        </section>
      )}
      {revoke && d && (
        <Modal
          title={t("撤銷這個連接", "Revoke this connection")}
          onClose={() => setRevoke(false)}
        >
          <p>
            {t(
              "停止後續外部讀取並清除授權憑證。既有快照將依照項目的內容權限與保留政策管理。",
              "Stop future external reads and clear credentials. Existing snapshots remain subject to project content access and retention policies.",
            )}
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await request(w.tenant, `/v1/connections/${id}`, "DELETE");
                setRevoke(false);
              })
            }
          >
            {t("確認撤銷", "Confirm revoke")}
          </button>
        </Modal>
      )}
      {snapshot && (
        <SnapshotFacts id={snapshot} close={() => setSnapshot(null)} />
      )}
    </>
  );
}
function SnapshotFacts({ id, close }: { id: string; close: () => void }) {
  const { t } = useI18n(),
    w = useWorkspace(),
    [offset, setOffset] = useState(0),
    r = useScoped<Facts>(
      w.tenant,
      `/v1/connector-snapshots/${id}?offset=${offset}&limit=25`,
    ),
    d = r.data;
  return (
    <Modal title={t("來源快照", "Source snapshot")} onClose={close}>
      <ErrorNotice error={r.error} />
      {d && (
        <div className="connector-facts">
          <p className="muted">
            {d.source_mode === "simulated"
              ? t("合成數據", "Synthetic data")
              : t("供應商數據", "Provider data")}{" "}
            · {d.row_count} {t("行", "rows")}
          </p>
          <p>
            {t("抓取時間", "Captured")}:{" "}
            {new Date(d.captured_at).toLocaleString()}
            <br />
            {t(
              "數據截止時間：供應商未提供",
              "Data cutoff: not supplied by provider",
            )}
          </p>
          <details open>
            <summary>
              {t("來源限制與指標口徑", "Coverage & metric limitations")}
            </summary>
            <ul>
              {d.limitations.map((v) => (
                <li key={v}>{connectorLimit(v, t)}</li>
              ))}
            </ul>
          </details>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("日期 / 帳戶", "Date / account")}</th>
                  <th>{t("報告粒度與維度", "Grain & dimensions")}</th>
                  <th>{t("原始指標", "Source metrics")}</th>
                </tr>
              </thead>
              <tbody>
                {d.facts.map((f) => (
                  <tr key={f.key}>
                    <td>
                      {f.date}
                      <small>
                        {f.account_id} · {f.currency ?? "—"}
                        <br />
                        {f.timezone}
                      </small>
                    </td>
                    <td>
                      {f.profile}
                      <dl>
                        {Object.entries(f.dimensions).map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                    <td>
                      <dl>
                        {Object.entries(f.metrics).map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>{v ?? t("未知", "Unknown")}</dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-actions">
            <button
              className="button secondary small"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 25))}
            >
              {t("上一頁", "Previous")}
            </button>
            <span>
              {d.row_count ? offset + 1 : 0}–
              {Math.min(offset + 25, d.row_count)} / {d.row_count}
            </span>
            <button
              className="button secondary small"
              disabled={d.next_offset === null}
              onClick={() => setOffset(d.next_offset!)}
            >
              {t("下一頁", "Next")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
