import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Download,
  FileSearch,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  ShieldCheck,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api, download, post } from "./api";
import { useWorkspace } from "./context";
import {
  Badge,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  PageHeader,
  useData,
  useI18n,
} from "./ui";
import "./seo-audits.css";
import { SeoChanges } from "./seo-changes";

export type Audit = {
  id: string;
  project_id: string;
  task_id: string;
  state: string;
  revision: number;
  spec_hash: string;
  input: {
    prompt: string;
    start_urls: string[];
    allowed_hosts: string[];
    allowed_path_prefixes: string[];
    max_pages: number;
    cache_policy: string;
  };
  data_mode: string;
  created_at: string;
  previous_run_id: string | null;
  task_status: string;
  result_asset_version_id: string | null;
  report_asset_version_id: string | null;
  progress: {
    page_requests: number;
    robots_requests: number;
    max_pages: number;
    byte_budget_used: number;
    remaining_urls: number;
    next_attempt_at: string;
    limitations: string[];
    error_code: string | null;
  };
  budget: { amount_micros: string };
  confirmed_cost: { amount_micros: string };
};
export type Finding = {
  id: string;
  key: string;
  code: string;
  severity: string;
  url: string;
  target_url?: string;
  detail: string;
  source_id: string;
  related_source_ids: string[];
  location: { start: number; end: number; unit: string; quote: string } | null;
};
type Findings = {
  coverage: { states: Record<string, number>; data_mode: string };
  items: Finding[];
  total: number;
  next_offset: number | null;
  comparison: {
    changes: {
      key: string;
      code?: string;
      url?: string;
      state: string;
      previous_finding_id: string;
    }[];
    new_finding_ids: string[];
  } | null;
};
const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
const money = (value: string) => (Number(value) / 1e6).toFixed(4);
const names: Record<string, [string, string]> = {
  broken_link: ["連結目標不存在", "Broken link"],
  duplicate_title: ["頁面標題重複", "Duplicate title"],
  title_missing: ["缺少頁面標題", "Missing title"],
  title_multiple: ["多個頁面標題", "Multiple titles"],
  title_length_review: ["檢視標題長度", "Review title length"],
  description_missing: ["缺少頁面描述", "Missing description"],
  description_multiple: ["多個頁面描述", "Multiple descriptions"],
  h1_missing: ["檢視主要標題", "Review the main heading"],
  h1_multiple: ["檢視標題層級", "Review heading hierarchy"],
  canonical_missing: ["檢視 canonical 設定", "Review canonical URL"],
  canonical_multiple: ["多個 canonical", "Multiple canonical URLs"],
  canonical_invalid: ["canonical 網址無效", "Invalid canonical URL"],
  canonical_cross_host: [
    "canonical 指向其他主機",
    "Canonical names another host",
  ],
  json_ld_invalid: ["JSON-LD 語法無效", "Invalid JSON-LD syntax"],
  indexing_disabled: ["頁面明確停用索引", "Indexing explicitly disabled"],
  login_form: ["頁面需要登入", "Login form observed"],
  base_invalid: ["相對網址基準無效", "Invalid base URL"],
};
export const seoFindingLabel = (
  code: string,
  t: (zh: string, en: string) => string,
) => (names[code] ? t(...names[code]) : code);
export function seoLimitLabel(
  code: string,
  t: (zh: string, en: string) => string,
) {
  const labels: Record<string, [string, string]> = {
    SEO_ROBOTS_DISALLOWED: ["robots 明確禁止抓取", "Blocked by robots"],
    SEO_ROBOTS_UNAVAILABLE: [
      "無法取得 robots，已停止該範圍",
      "Robots unavailable; this origin was stopped",
    ],
    SEO_PAGE_BUDGET_LIMIT: [
      "已達頁面請求預算，其餘網址未檢查",
      "Page request budget reached; remaining URLs were not checked",
    ],
    SEO_BYTE_BUDGET_LIMIT: ["已達資料讀取上限", "Response byte budget reached"],
    SEO_LIFETIME_LIMIT: ["已達作業時間上限", "Crawl time limit reached"],
    SEO_LOGIN_CONTENT_UNAVAILABLE: [
      "只讀取了登入頁，未取得登入後內容",
      "Login page only; authenticated content was not inspected",
    ],
    SEO_REQUEST_OUTCOME_UNKNOWN: [
      "中斷的請求結果未知，預算已保留",
      "Interrupted request outcome unknown; its budget remains consumed",
    ],
    SEO_HOST_DENIED: [
      "重定向超出已確認主機",
      "Redirect left the confirmed hosts",
    ],
    SEO_PATH_DENIED: ["網址超出已確認路徑", "URL left the confirmed paths"],
    SEO_IP_DENIED: [
      "目的地址不符合公開網站範圍",
      "Destination address is outside public website scope",
    ],
    SEO_RESPONSE_LIMIT: [
      "回應超出大小上限",
      "Response exceeded its size limit",
    ],
    SEO_CANCELLED: ["抓取已取消", "Collection cancelled"],
    SEO_FRONTIER_LIMIT: ["已達發現網址上限", "Discovered URL limit reached"],
  };
  if (labels[code]) return t(...labels[code]);
  if (code.startsWith("SEO_")) return code;
  if (code.startsWith("The confirmed page budget"))
    return t(
      "頁面、重定向和重試都計入頁面請求預算；robots 另計。",
      "Pages, redirects and retries consume page requests; robots requests are counted separately.",
    );
  if (code.startsWith("Only discovered"))
    return t(
      "僅檢查已發現且獲准的伺服器 HTML，不代表全站覆蓋或搜尋排名。",
      "Only discovered, allowed server HTML was inspected. This does not establish full-site coverage or ranking.",
    );
  if (code.startsWith("The crawler currently"))
    return t(
      "目前逐一讀取頁面；設定的並行數為上限。",
      "Pages currently run sequentially; configured concurrency is an upper limit.",
    );
  if (code.startsWith("Server HTML only"))
    return t(
      "未執行腳本、表單或登入，也未驗證 rich-result 資格。",
      "Scripts, forms, login and rich-result eligibility were not executed or validated.",
    );
  return code;
}
const stateBadge = (state: string) =>
  state === "complete"
    ? "succeeded"
    : state === "partial"
      ? "partially_succeeded"
      : state;

export function SeoAudits({ onBack }: { onBack: () => void }) {
  const [params, setParams] = useSearchParams();
  const setSelected = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("audit", id);
    setParams(next);
  };
  const w = useWorkspace(),
    { t } = useI18n(),
    [refresh, setRefresh] = useState(0),
    [createOpen, setCreateOpen] = useState(false),
    [recheck, setRecheck] = useState<Audit | null>(null),
    [source, setSource] = useState<any>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [pageOffset, setPageOffset] = useState(0);
  const [selectedFindings, setSelectedFindings] = useState<
    Record<string, Finding>
  >({});
  const saving = useRef(false),
    evidenceRevision = useRef(0);
  const directory = useData<{ items: Audit[] }>(
      `/v1/seo/audits?project_id=${w.project}`,
      refresh,
      4000,
      w.tenant,
    ),
    id = params.get("audit") ?? directory.data?.items[0]?.id ?? null,
    detail = useData<Audit>(
      id ? "/v1/seo/audits/" + id : null,
      refresh,
      2500,
      w.tenant,
    ),
    d = detail.data,
    report = useData<Findings>(
      d?.result_asset_version_id
        ? `/v1/seo/audits/${d.id}/findings?offset=${offset}`
        : null,
      refresh,
      0,
      w.tenant,
    ),
    pages = useData<{
      items: any[];
      total: number;
      next_offset: number | null;
    }>(
      d ? `/v1/seo/audits/${d.id}/pages?offset=${pageOffset}` : null,
      refresh,
      ["queued", "running"].includes(d?.state ?? "") ? 2500 : 0,
      w.tenant,
    );
  useEffect(() => {
    setOffset(0);
    setPageOffset(0);
    setSource(null);
    setSelectedFindings({});
    evidenceRevision.current++;
  }, [id, w.base]);
  useEffect(() => {
    if (detail.error || directory.error || report.error) {
      evidenceRevision.current++;
      setSource(null);
      setSelectedFindings({});
    }
  }, [detail.error, directory.error, report.error]);
  useEffect(
    () => () => {
      evidenceRevision.current++;
    },
    [],
  );
  const run = async (action: () => Promise<unknown>) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const control = async (action: "pause" | "resume" | "cancel") => {
    if (!d) return;
    const task = await api(`${w.base}/tasks/${d.task_id}`);
    await post(
      `${w.base}/tasks/${d.task_id}/${action === "cancel" ? "cancel" : "controls"}`,
      action === "cancel" ? {} : { action, expected_version: task.version },
    );
  };
  const showSource = async (
    document: string,
    finding: Finding | null = null,
  ) => {
    const revision = ++evidenceRevision.current;
    setSource(null);
    setError(null);
    try {
      const value = await api(`/v1/seo/audits/${id}/documents/${document}`, {
        headers: { "X-Tenant-ID": w.tenant },
      });
      if (revision === evidenceRevision.current)
        setSource({ ...value, finding });
    } catch (e) {
      if (revision === evidenceRevision.current) setError(e);
    }
  };
  return (
    <div className="seo-workbench">
      <button className="text-button seo-back" onClick={onBack}>
        <ArrowLeft size={16} />
        {t("返回行銷分析", "Back to marketing insights")}
      </button>
      <PageHeader
        eyebrow="CHECK THE PAGE. KEEP THE EVIDENCE."
        title={t("網站診斷與復查", "Website audits & rechecks")}
        description={t(
          "先確認網站範圍，逐頁保留問題與原文。修復後再以相同範圍復查。",
          "Confirm the website scope. Keep URL findings and original evidence, then recheck after repairs.",
        )}
        action={
          <button
            className="button primary"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={17} />
            {t("建立診斷", "New audit")}
          </button>
        }
      />
      <ErrorNotice
        error={
          directory.error ??
          detail.error ??
          report.error ??
          pages.error ??
          error
        }
      />
      {!directory.data && directory.loading ? (
        <Loading />
      ) : !directory.data?.items.length ? (
        <section className="card seo-empty">
          <FileSearch size={30} />
          <h2>{t("從一個明確範圍開始", "Start with a defined scope")}</h2>
          <p>
            {t(
              "設定起始頁、精確主機和請求預算；診斷會保留未檢查、受限與失敗的頁面。",
              "Set start URLs, exact hosts and a request budget. Unvisited, restricted and failed pages stay visible.",
            )}
          </p>
          <button
            className="button secondary"
            onClick={() => setCreateOpen(true)}
          >
            {t("設定網站範圍", "Set website scope")}
          </button>
        </section>
      ) : (
        <div className="seo-layout">
          <aside
            className="card seo-directory"
            aria-label={t("已保存網站診斷", "Saved website audits")}
          >
            <h2>{t("診斷記錄", "Audit history")}</h2>
            {directory.data?.items.map((audit) => (
              <button
                key={audit.id}
                onClick={() => {
                  setSelected(audit.id);
                  setSource(null);
                  setError(null);
                }}
                className={
                  "seo-directory-item " + (audit.id === id ? "selected" : "")
                }
              >
                <strong>{audit.input.start_urls[0]}</strong>
                <span>{new Date(audit.created_at).toLocaleString()}</span>
                <Badge value={stateBadge(audit.state)} />
              </button>
            ))}
          </aside>
          <div className="seo-panels">
            {!d ? (
              detail.loading ? (
                <Loading />
              ) : (
                <section className="card">
                  <p>
                    {t(
                      "此診斷不可使用。請重新整理或選擇其他記錄。",
                      "This audit is unavailable. Refresh or choose another record.",
                    )}
                  </p>
                </section>
              )
            ) : (
              <>
                <section className="card seo-scope">
                  <div className="section-title">
                    <div>
                      <p className="eyebrow">CONFIRMED SCOPE</p>
                      <h2>{t("已確認的範圍", "Confirmed scope")}</h2>
                    </div>
                    <Badge value={stateBadge(d.state)} />
                  </div>
                  <p>{d.input.prompt}</p>
                  <div className="seo-scope-grid">
                    <div>
                      <small>{t("精確主機", "Exact hosts")}</small>
                      {d.input.allowed_hosts.map((host) => (
                        <code key={host}>{host}</code>
                      ))}
                    </div>
                    <div>
                      <small>{t("路徑前綴", "Path prefixes")}</small>
                      {(d.input.allowed_path_prefixes.length
                        ? d.input.allowed_path_prefixes
                        : ["/"]
                      ).map((path) => (
                        <code key={path}>{path}</code>
                      ))}
                    </div>
                  </div>
                  <details>
                    <summary>
                      {t("起始頁與規格版本", "Start pages and specification")}
                    </summary>
                    <ul>
                      {d.input.start_urls.map((url) => (
                        <li key={url}>
                          <code>{url}</code>
                        </li>
                      ))}
                    </ul>
                    <p className="seo-hash">SHA-256 {d.spec_hash}</p>
                  </details>
                  {d.data_mode === "simulated" && (
                    <p className="notice">
                      <ShieldCheck size={17} />
                      {t(
                        "模擬網站：本次讀取合成頁面，不會抓取真實客戶網站。",
                        "Synthetic website: this audit reads fixture pages and does not fetch the real customer website.",
                      )}
                    </p>
                  )}
                  <div className="seo-stats" aria-live="polite">
                    <div>
                      <strong>
                        {d.progress.page_requests}
                        <small> / {d.progress.max_pages}</small>
                      </strong>
                      <span>{t("頁面請求", "Page requests")}</span>
                    </div>
                    <div>
                      <strong>{d.progress.remaining_urls}</strong>
                      <span>{t("待檢查網址", "URLs remaining")}</span>
                    </div>
                    <div>
                      <strong>{d.progress.robots_requests}</strong>
                      <span>robots</span>
                    </div>
                    <div>
                      <strong>
                        HK${money(d.confirmed_cost.amount_micros)}
                      </strong>
                      <span>{t("已確認 AI 費用", "Confirmed AI cost")}</span>
                    </div>
                  </div>
                  <div className="seo-task-row">
                    <div>
                      <small>{t("分析任務", "Analysis task")}</small>
                      <Badge value={d.task_status} />
                      <span className="muted">
                        {t("AI 預算上限", "AI budget")} HK$
                        {money(d.budget.amount_micros)}
                      </span>
                    </div>
                    <div className="row-actions">
                      <Link
                        className="text-button"
                        to={`/app/tasks/${d.task_id}`}
                      >
                        {t("查看任務", "View task")}
                        <ArrowUpRight size={15} />
                      </Link>
                      {["queued", "paused"].includes(d.task_status) && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              control(
                                d.task_status === "paused" ? "resume" : "pause",
                              ),
                            )
                          }
                        >
                          {d.task_status === "paused" ? (
                            <Play size={15} />
                          ) : (
                            <Pause size={15} />
                          )}
                          {d.task_status === "paused"
                            ? t("繼續", "Resume")
                            : t("暫停", "Pause")}
                        </button>
                      )}
                      {["queued", "paused", "running"].includes(
                        d.task_status,
                      ) && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void run(() => control("cancel"))}
                        >
                          <Square size={14} />
                          {t("取消任務", "Cancel task")}
                        </button>
                      )}
                    </div>
                  </div>
                  <details className="seo-limitations" open>
                    <summary>
                      {t("覆蓋與限制", "Coverage and limitations")}
                    </summary>
                    <ul>
                      {d.progress.limitations.map((code) => (
                        <li key={code}>{seoLimitLabel(code, t)}</li>
                      ))}
                    </ul>
                    {d.progress.error_code && (
                      <p>{seoLimitLabel(d.progress.error_code, t)}</p>
                    )}
                  </details>
                  <div className="row-actions seo-downloads">
                    {d.result_asset_version_id && (
                      <>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => setRecheck(d)}
                        >
                          <RefreshCw size={16} />
                          {t("以相同範圍復查", "Recheck the same scope")}
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              download(
                                `/v1/seo/audits/${d.id}/download?format=json`,
                                `seo-evidence-${d.id}.json`,
                                w.tenant,
                              ),
                            )
                          }
                        >
                          <Download size={16} />
                          {t("下載證據 JSON", "Download evidence JSON")}
                        </button>
                      </>
                    )}
                    {d.report_asset_version_id && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            download(
                              `/v1/seo/audits/${d.id}/download?format=html`,
                              `seo-report-${d.id}.html`,
                              w.tenant,
                            ),
                          )
                        }
                      >
                        <Download size={16} />
                        {t("下載報告", "Download report")}
                      </button>
                    )}
                  </div>
                </section>
                {report.data && (
                  <section className="card seo-findings">
                    <div className="section-title">
                      <div>
                        <p className="eyebrow">A URL. A SOURCE. A NEXT STEP.</p>
                        <h2>
                          {t("逐頁問題", "URL findings")}{" "}
                          <small>{report.data.total}</small>
                        </h2>
                      </div>
                    </div>
                    {!report.data.items.length ? (
                      <p>
                        {t(
                          "已檢查頁面未觸發目前規則；未檢查的頁面仍保持未知。",
                          "Inspected pages triggered no current rules. Unvisited pages remain unknown.",
                        )}
                      </p>
                    ) : (
                      report.data.items.map((finding) => (
                        <article
                          key={finding.id}
                          className={"seo-finding " + finding.severity}
                        >
                          <div>
                            <div className="seo-finding-choice">
                              <input
                                type="checkbox"
                                id={`seo-finding-${finding.id}`}
                                checked={!!selectedFindings[finding.id]}
                                disabled={
                                  !selectedFindings[finding.id] &&
                                  Object.keys(selectedFindings).length >= 20
                                }
                                onChange={(e) =>
                                  setSelectedFindings((previous) => {
                                    const next = { ...previous };
                                    if (e.target.checked)
                                      next[finding.id] = finding;
                                    else delete next[finding.id];
                                    return next;
                                  })
                                }
                                aria-label={`${t("選取修改問題", "Select finding")}: ${seoFindingLabel(finding.code, t)} ${finding.url}`}
                              />
                              <h3>
                                <label htmlFor={`seo-finding-${finding.id}`}>
                                  {seoFindingLabel(finding.code, t)}
                                </label>
                              </h3>
                            </div>
                            <span className="seo-severity">
                              {finding.severity === "error"
                                ? t("需修復", "Repair")
                                : finding.severity === "warning"
                                  ? t("需檢視", "Review")
                                  : t("觀察", "Observation")}
                            </span>
                          </div>
                          <code>{finding.url}</code>
                          {finding.target_url && (
                            <code>→ {finding.target_url}</code>
                          )}
                          <p>{finding.detail}</p>
                          {finding.location && (
                            <pre>{finding.location.quote}</pre>
                          )}
                          <button
                            className="text-button"
                            onClick={() =>
                              void showSource(finding.source_id, finding)
                            }
                          >
                            <Search size={15} />
                            {t("查看原始證據", "Inspect source evidence")}
                          </button>
                          {finding.related_source_ids.map((sourceId) => (
                            <button
                              key={sourceId}
                              className="text-button"
                              onClick={() => void showSource(sourceId)}
                            >
                              {t("查看關聯來源", "Inspect related source")}
                            </button>
                          ))}
                        </article>
                      ))
                    )}
                    <Pager
                      offset={offset}
                      next={report.data.next_offset}
                      change={setOffset}
                      size={25}
                    />
                  </section>
                )}
                {report.data &&
                  d.project_id === w.project &&
                  !detail.error &&
                  !report.error &&
                  !directory.error && (
                    <SeoChanges
                      key={`${w.base}:${d.id}:${d.result_asset_version_id}`}
                      audit={d}
                      selected={Object.values(selectedFindings)}
                      clearSelection={() => setSelectedFindings({})}
                      onRecheck={() => setRecheck(d)}
                      onSource={(id, finding) => void showSource(id, finding)}
                    />
                  )}
                {report.data?.comparison && (
                  <section className="card seo-comparison">
                    <h2>
                      {t("與上一版本比較", "Changes since the previous audit")}
                    </h2>
                    <p className="muted">
                      {t(
                        "只有實際復查的網址才判定修復；其餘保持未復查。",
                        "A repair is confirmed only when the affected URLs were actually rechecked.",
                      )}
                    </p>
                    {report.data.comparison.changes.map((change) => (
                      <div key={change.key}>
                        <span>
                          {change.code
                            ? seoFindingLabel(change.code, t)
                            : change.previous_finding_id}
                          <code>{change.url}</code>
                        </span>
                        <strong className={change.state}>
                          {change.state === "resolved"
                            ? t("已修復", "Resolved")
                            : change.state === "persistent"
                              ? t("仍需處理", "Persistent")
                              : t("未復查", "Not rechecked")}
                        </strong>
                      </div>
                    ))}
                    <p>
                      {t("新增問題", "New findings")}:{" "}
                      {report.data.comparison.new_finding_ids.length}
                    </p>
                  </section>
                )}
                {pages.data && (
                  <section className="card seo-pages">
                    <h2>{t("頁面覆蓋", "Page coverage")}</h2>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>URL</th>
                            <th>{t("結果", "Result")}</th>
                            <th>HTTP</th>
                            <th>{t("證據", "Evidence")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pages.data.items.map((page) => (
                            <tr key={page.url}>
                              <td>
                                <code>{page.url}</code>
                                {page.reason && (
                                  <small>{seoLimitLabel(page.reason, t)}</small>
                                )}
                              </td>
                              <td>
                                {page.state === "success"
                                  ? t("已讀取", "Read")
                                  : page.state === "http_error"
                                    ? t("HTTP 回應", "HTTP response")
                                    : page.state === "redirect"
                                      ? t("重定向", "Redirect")
                                      : page.state === "blocked"
                                        ? t("受限", "Restricted")
                                        : page.state === "unvisited"
                                          ? t("未檢查", "Unvisited")
                                          : page.state === "queued"
                                            ? t("待檢查", "Queued")
                                            : t("讀取失敗", "Read failed")}
                              </td>
                              <td>{page.status ?? "—"}</td>
                              <td>
                                {page.source_id ? (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      void showSource(page.source_id)
                                    }
                                  >
                                    {t("來源", "Source")}
                                  </button>
                                ) : page.robots_source_id ? (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      void showSource(page.robots_source_id)
                                    }
                                  >
                                    robots
                                  </button>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pager
                      offset={pageOffset}
                      next={pages.data.next_offset}
                      change={setPageOffset}
                      size={25}
                    />
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {(createOpen || recheck) && (
        <CreateAudit
          original={recheck}
          onClose={() => {
            setCreateOpen(false);
            setRecheck(null);
          }}
          onCreated={(audit) => {
            setSelected(audit.id);
            setCreateOpen(false);
            setRecheck(null);
            setRefresh((v) => v + 1);
          }}
        />
      )}
      {source && d && (
        <Modal
          title={t("來源證據", "Source evidence")}
          onClose={() => {
            evidenceRevision.current++;
            setSource(null);
          }}
        >
          <div className="seo-source">
            <Badge
              value={source.data_mode === "simulated" ? "simulated" : "active"}
            />
            <p>
              <code>{source.url}</code>
            </p>
            <dl>
              <dt>{t("實際 HTTP", "Actual HTTP")}</dt>
              <dd>
                {source.http_status}
                {source.http_status !== source.effective_status
                  ? ` · ${t("沿用內容", "Retained content")} ${source.effective_status}`
                  : ""}
              </dd>
              <dt>{t("取回時間", "Response captured")}</dt>
              <dd>{source.captured_at}</dd>
              <dt>{t("內容原取回時間", "Content originally captured")}</dt>
              <dd>{source.content_captured_at}</dd>
              <dt>{t("來源字元編碼", "Source charset")}</dt>
              <dd>{source.charset ?? "—"}</dd>
            </dl>
            {source.finding?.location && (
              <>
                <pre>{source.finding.location.quote}</pre>
                <p>
                  UTF-16 [{source.finding.location.start},{" "}
                  {source.finding.location.end})
                </p>
              </>
            )}
            <p className="seo-hash">
              Response SHA-256
              <br />
              {source.response_sha256}
            </p>
            <p className="seo-hash">
              Raw content SHA-256
              <br />
              {source.raw_sha256}
            </p>
            <p className="seo-hash">
              Decoded UTF-8 SHA-256
              <br />
              {source.source_sha256 ?? "—"}
            </p>
            <button
              className="button secondary"
              onClick={() =>
                void run(() =>
                  download(
                    `${w.base}/assets/${source.asset_id}/download?version=${source.asset_version}`,
                    `seo-source-${source.id}.json`,
                  ),
                )
              }
            >
              <Download size={16} />
              {t("下載不可變來源", "Download immutable source")}
            </button>
            <p className="muted">
              {t(
                "HTML 以文字保存，不在此執行。",
                "HTML is retained as text and is not executed here.",
              )}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Pager({
  offset,
  next,
  change,
  size,
}: {
  offset: number;
  next: number | null;
  change: (n: number) => void;
  size: number;
}) {
  const { t } = useI18n();
  if (offset === 0 && next === null) return null;
  return (
    <div className="seo-pager">
      <button
        className="text-button"
        disabled={offset === 0}
        onClick={() => change(Math.max(0, offset - size))}
      >
        {t("上一頁", "Previous")}
      </button>
      <span>{offset + 1}</span>
      <button
        className="text-button"
        disabled={next === null}
        onClick={() => next !== null && change(next)}
      >
        {t("下一頁", "Next")}
      </button>
    </div>
  );
}
function CreateAudit({
  original,
  onClose,
  onCreated,
}: {
  original: Audit | null;
  onClose: () => void;
  onCreated: (audit: Audit) => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n(),
    membership = w.me?.memberships?.find((m: any) => m.id === w.tenant),
    simulated = membership?.data_mode === "simulated";
  const [starts, setStarts] = useState(
      original?.input.start_urls.join("\n") ??
        (simulated ? "https://marketing.example.invalid/" : ""),
    ),
    [hosts, setHosts] = useState(
      original?.input.allowed_hosts.join("\n") ??
        (simulated ? "marketing.example.invalid" : ""),
    ),
    [prefixes, setPrefixes] = useState(
      original?.input.allowed_path_prefixes.join("\n") ?? "",
    ),
    [maxPages, setMaxPages] = useState(original?.input.max_pages ?? 20),
    [prompt, setPrompt] = useState(
      original?.input.prompt ??
        t(
          "診斷網站的頁面、連結和技術問題，保留逐 URL 證據與建議。",
          "Diagnose page, link and technical issues with URL evidence and recommendations.",
        ),
    ),
    [budget, setBudget] = useState("1.00"),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const live = useRef(true),
    saving = useRef(false),
    requestKey = useRef(crypto.randomUUID());
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    requestKey.current = crypto.randomUUID();
    setConfirmed(false);
  }, [starts, hosts, prefixes, maxPages, prompt, budget]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current || !confirmed) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!/^\d+(\.\d{1,6})?$/.test(budget))
        throw new Error(
          t("請輸入有效 HKD 預算。", "Enter a valid HKD budget."),
        );
      const [major, minor = ""] = budget.split("."),
        amount = BigInt(major) * 1000000n + BigInt(minor.padEnd(6, "0"));
      if (amount <= 0n || amount > 1000000000000n)
        throw new Error(
          t("預算超出支援範圍。", "Budget is outside the supported range."),
        );
      const agent = await post(w.base + "/analysis/assistant", {});
      const body = original
        ? {
            agent_id: agent.id,
            expected_revision: original.revision,
            budget: { currency: "HKD", amount_micros: amount.toString() },
          }
        : {
            project_id: w.project,
            agent_id: agent.id,
            input: {
              prompt,
              start_urls: lines(starts),
              allowed_hosts: lines(hosts),
              allowed_path_prefixes: lines(prefixes),
              max_pages: maxPages,
              cache_policy: "refresh",
            },
            budget: { currency: "HKD", amount_micros: amount.toString() },
          };
      const audit = await api<Audit>(
        original ? `/v1/seo/audits/${original.id}/recheck` : "/v1/seo/audits",
        {
          method: "POST",
          headers: {
            "X-Tenant-ID": w.tenant,
            "Idempotency-Key": requestKey.current,
          },
          body: JSON.stringify(body),
        },
      );
      if (live.current) onCreated(audit);
    } catch (e) {
      if (live.current) setError(e);
    } finally {
      saving.current = false;
      if (live.current) setBusy(false);
    }
  };
  return (
    <Modal
      title={
        original
          ? t("確認相同範圍復查", "Confirm a recheck of the same scope")
          : t("設定網站診斷", "Set up a website audit")
      }
      onClose={() => {
        if (!saving.current) onClose();
      }}
    >
      <form onSubmit={(e) => void submit(e)} className="form-stack seo-create">
        <ErrorNotice error={error} />
        <Field label={t("起始 URL（每行一個）", "Start URLs (one per line)")}>
          <textarea
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
            required
            rows={3}
            disabled={!!original || busy}
            maxLength={82000}
          />
        </Field>
        <Field
          label={t(
            "獲准的精確主機（每行一個）",
            "Allowed exact hosts (one per line)",
          )}
          hint={t(
            "例如 example.hk；不接受萬用字元或自動授權子網域。",
            "For example, example.hk. Wildcards and automatic subdomain access are not supported.",
          )}
        >
          <textarea
            value={hosts}
            onChange={(e) => setHosts(e.target.value)}
            required
            rows={2}
            disabled={!!original || busy}
          />
        </Field>
        <Field
          label={t(
            "獲准的路徑前綴（選填）",
            "Allowed path prefixes (optional)",
          )}
          hint={t(
            "例如 /campaign；留空代表獲准主機內的所有公開路徑。",
            "For example, /campaign. Empty permits public paths within the confirmed hosts.",
          )}
        >
          <textarea
            value={prefixes}
            onChange={(e) => setPrefixes(e.target.value)}
            rows={2}
            disabled={!!original || busy}
          />
        </Field>
        <div className="seo-scope-grid">
          <Field
            label={t("頁面請求上限", "Page request limit")}
            hint={t(
              "包含重定向與重試；robots 另計。",
              "Includes redirects and retries; robots counted separately.",
            )}
          >
            <input
              type="number"
              min={1}
              max={1000}
              required
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              disabled={!!original || busy}
            />
          </Field>
          <Field label={t("AI 預算上限（HKD）", "AI budget limit (HKD)")}>
            <input
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              required
              disabled={busy}
            />
          </Field>
        </div>
        <Field label={t("檢查目的", "Audit objective")}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            required
            maxLength={30000}
            rows={3}
            disabled={!!original || busy}
          />
        </Field>
        <p className="notice">
          {simulated
            ? t(
                "將讀取本機合成網站；AI 解讀與消耗也使用模擬資料。",
                "This reads a local synthetic website. AI explanations and usage also use simulated data.",
              )
            : t(
                "只讀取已確認範圍內的公開頁面；不會登入、提交表單或寫回網站。",
                "Only public pages within the confirmed scope are read. No login, form submissions or website writes occur.",
              )}
        </p>
        {original && (
          <p>
            {t(
              "本次新增一個獨立任務，保留原有報告。未實際重新檢查的項目不會標記修復。",
              "A separate task retains the original report. Unchecked items will not be marked repaired.",
            )}
          </p>
        )}
        <label className="seo-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy}
            required
          />
          <span>
            {t(
              "我確認有權診斷上述網站範圍，並同意在此預算內執行檢查與 AI 解讀。",
              "I am authorized to audit this website scope and approve collection and AI interpretation within this budget.",
            )}
          </span>
        </label>
        <button
          className="button primary"
          type="submit"
          disabled={busy || !confirmed}
        >
          {busy
            ? t("正在建立…", "Creating…")
            : original
              ? t("開始復查", "Start recheck")
              : t("開始診斷", "Start audit")}
        </button>
      </form>
    </Modal>
  );
}
