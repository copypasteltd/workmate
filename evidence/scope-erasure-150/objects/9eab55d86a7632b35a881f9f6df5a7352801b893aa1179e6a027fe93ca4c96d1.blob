import { ScopeErasureDialog, type ErasureTarget } from "./scope-erasure-dialog";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { post } from "./api";
import {
  AsyncForm,
  Badge,
  DateText,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  useData,
  useI18n,
} from "./ui";

const types: Record<string, [string, string]> = {
  projects: ["完整專案", "Entire project"], tenants: ["企業工作空間", "Company workspace"], cloud_runtime_sessions: ["雲端電腦執行", "Cloud computer sessions"],
  assets: ["素材", "Assets"],
  tasks: ["任務", "Tasks"],
  agents: ["助手", "Assistants"],
  conversations: ["會話", "Conversations"],
  memories: ["記憶", "Memories"],
  brand_profiles: ["品牌資料", "Brand profiles"],
  analytics_datasets: ["分析資料", "Analytics datasets"],
  creative_mappings: ["創意身份映射", "Creative identity mappings"],
  creative_feedback_reports: ["創意反饋", "Creative feedback"],
  geo_experiments: ["GEO 配置版本", "GEO configuration versions"],
  geo_runs: ["GEO 觀測紀錄", "GEO observation runs"],
  geo_samples: ["GEO 回答樣本", "GEO answer samples"],
  workflows: ["工作流", "Workflows"],
  workflow_runs: ["工作流執行", "Workflow runs"],
  agent_groups: ["專業團隊", "Specialist teams"],
  agent_group_runs: ["私有團隊執行", "Private team runs"],
  workflow_schedules: ["雲端定時", "Cloud schedules"],
  creative_projects: ["創意專案", "Creative projects"],
  workspace_nodes: ["雲端檔案條目", "Cloud file entries"],
};
const states: Record<string, [string, string]> = {
  queued: ["等待清理", "Queued"],
  cleaning: ["正在清理", "Cleaning"],
  completed: ["已完成", "Completed"],
  completed_with_exceptions: ["完成但有例外", "Completed with exceptions"],
  failed: ["清理失敗", "Failed"],
};

export function AdminDeletions({
  canRetry,
  refresh: externalRefresh,
  account,
}: {
  canRetry: boolean;
  account: string;
  refresh: number;
}) {
  const { t } = useI18n(),
    [params, setParams] = useSearchParams(),
    [refresh, setRefresh] = useState(0),
    [retry, setRetry] = useState<any>(null),
    [scopeKind, setScopeKind] = useState<"projects"|"tenants">("projects"),
    [scopeId, setScopeId] = useState(""), [erasure, setErasure] = useState<ErasureTarget|null>(null);
  const rawPage = Number(params.get("cleanup_page") ?? 1),
    page =
      Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10000
        ? rawPage
        : 1,
    rawSize = Number(params.get("cleanup_size") ?? 50),
    size = [25, 50, 100].includes(rawSize) ? rawSize : 50,
    state = params.get("cleanup_state") ?? "",
    type = params.get("cleanup_type") ?? "",
    search = params.get("cleanup_search") ?? "";
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(size),
    search,
  });
  if (state) query.set("state", state);
  if (type) query.set("target_type", type);
  const jobs = useData(
    "/v1/admin/deletions?" + query,
    externalRefresh + refresh,
    5000,
  );
  const update = (key: string, value: string) => {
    setRetry(null);
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "cleanup_page") next.delete("cleanup_page");
        return next;
      },
      { replace: true },
    );
  };
  const retryVisible =
    retry &&
    canRetry &&
    !jobs.error &&
    jobs.data?.items.some(
      (item: any) =>
        item.id === retry.id && ["queued", "failed"].includes(item.state),
    );
  useEffect(() => {
    if (jobs.error || !canRetry || (retry && jobs.data && !retryVisible))
      setRetry(null);
  }, [jobs.error, jobs.data, canRetry, retry, retryVisible]);
  useEffect(() => {
    if (!jobs.data || jobs.data.page !== page) return;
    const last = Math.max(1, Math.ceil(jobs.data.total / size));
    if (page > last) update("cleanup_page", String(last));
  }, [jobs.data, page, size]);

  return (
    <section
      className="card deletion-journal"
      aria-label={t("永久刪除與清理進度", "Permanent deletion and cleanup")}
    >
      <div className="section-title">
        <h2>{t("永久刪除與清理進度", "Permanent deletion and cleanup")}</h2>
        <button
          className="icon-button"
          aria-label={t("重新整理清理記錄", "Refresh cleanup records")}
          disabled={jobs.loading}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <p className="muted">
        {t(
          "檢視授權範圍內的清理狀態。永久刪除無法恢復；帳務與審計資料獨立保留。",
          "Review cleanup within your authorized scope. Permanent deletion is irreversible. Billing and audit data are retained separately.",
        )}
      </p>
      {canRetry && <form className="deletion-filters" onSubmit={e => {e.preventDefault();setErasure({kind:scopeKind,id:scopeId,endpoint:`/v1/admin/scopes/${scopeKind}/${scopeId}/erasure`});}}>
        <Field label={t("永久清理範圍", "Permanent cleanup scope")}><select value={scopeKind} onChange={e=>setScopeKind(e.target.value as any)}><option value="projects">{t("完整專案", "Entire project")}</option><option value="tenants">{t("企業工作空間", "Company workspace")}</option></select></Field>
        <Field label={t("目標 ID", "Target ID")}><input required value={scopeId} onChange={e=>setScopeId(e.target.value)} pattern="[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}" /></Field>
        <button className="button secondary" type="submit">{t("預覽永久清理", "Preview permanent cleanup")}</button>
      </form>}
      {erasure && canRetry && <ScopeErasureDialog key={erasure.endpoint} account={account} target={erasure} onClose={()=>setErasure(null)} onAccepted={()=>{setErasure(null);setRefresh(v=>v+1);}} />}
      <div className="deletion-filters">
        <Field label={t("搜尋清理 ID", "Search cleanup IDs")}>
          <input
            value={search}
            maxLength={160}
            placeholder={t("記錄或目標 ID", "Record or target ID")}
            onChange={(e) => update("cleanup_search", e.target.value)}
          />
        </Field>
        <Field label={t("清理狀態", "Cleanup state")}>
          <select
            value={state}
            onChange={(e) => update("cleanup_state", e.target.value)}
          >
            <option value="">{t("全部狀態", "All states")}</option>
            {Object.entries(states).map(([value, label]) => (
              <option key={value} value={value}>
                {t(...label)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("內容類別", "Content type")}>
          <select
            value={type}
            onChange={(e) => update("cleanup_type", e.target.value)}
          >
            <option value="">{t("全部類別", "All types")}</option>
            {Object.entries(types).map(([value, label]) => (
              <option key={value} value={value}>
                {t(...label)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("每頁清理記錄", "Cleanup records per page")}>
          <select
            value={size}
            onChange={(e) => update("cleanup_size", e.target.value)}
          >
            {[25, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorNotice error={jobs.error} />
      {jobs.loading && !jobs.data && <Loading />}
      {jobs.data && (
        <>
          {jobs.data.items.length ? (
            <div
              className="table-wrap admin-table deletion-table"
              role="region"
              tabIndex={0}
              aria-label={t("可捲動的清理記錄", "Scrollable cleanup records")}
            >
              <table>
                <thead>
                  <tr>
                    <th>{t("狀態", "State")}</th>
                    <th>{t("類別與目標", "Type and target")}</th>
                    <th>{t("範圍", "Scope")}</th>
                    <th>{t("清理進度", "Cleanup progress")}</th>
                    <th>{t("建立時間", "Created")}</th>
                    <th>{t("動作", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.data.items.map((j: any) => (
                    <tr key={j.id} data-cleanup-id={j.id}>
                      <td>
                        <Badge value={j.state} />
                      </td>
                      <td>
                        <strong>
                          {types[j.target_type]
                            ? t(...types[j.target_type])
                            : j.target_type}
                        </strong>
                        <small className="mono cleanup-id" title={j.target_id}>
                          {j.target_id}
                        </small>
                      </td>
                      <td>
                        <small className="mono cleanup-id" title={j.tenant_id}>
                          {j.tenant_id}
                        </small>
                        <small className="mono cleanup-id" title={j.project_id}>
                          {j.project_id ?? "—"}
                        </small>
                      </td>
                      <td>
                        {j.progress.completed}/{j.progress.total}
                        {!!j.retained?.length && <p className="small-text">{t("必要帳務、審計及保留政策適用；客戶本機副本由客戶自行管理。", "Required billing, audit and retention policies apply. Customer-local copies remain customer-managed.")}</p>}
                        {(j.exceptions.length > 0 || j.failures.length > 0) && (
                          <details>
                            <summary>
                              {t("檢視待處理原因", "Review pending reasons")}
                            </summary>
                            {j.exceptions.map((reason: string) => (
                              <p key={reason} className="small-text">
                                {reason}
                              </p>
                            ))}
                            {j.failures.map((f: any) => (
                              <p key={f.id} className="small-text">
                                {f.kind} · {f.error_code} ·{" "}
                                {t("重試次數", "Attempts")}: {f.attempts}
                              </p>
                            ))}
                          </details>
                        )}
                      </td>
                      <td>
                        <DateText value={j.created_at} />
                      </td>
                      <td>
                        {canRetry && ["queued", "failed"].includes(j.state) && (
                          <button
                            className="button secondary small"
                            onClick={() => setRetry(j)}
                          >
                            {t("重試清理", "Retry cleanup")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              {t("目前沒有符合的清理記錄。", "No matching cleanup records.")}
            </p>
          )}
          <div
            className="pagination"
            aria-label={t("清理記錄分頁", "Cleanup pagination")}
          >
            <span>
              {t("篩選後可見", "Visible after filtering")}: {jobs.data.total} ·{" "}
              {t("目前第", "Page")} {page} /{" "}
              {Math.max(1, Math.ceil(jobs.data.total / size))}
            </span>
            <div>
              <button
                className="icon-button"
                aria-label={t("上一頁清理記錄", "Previous cleanup page")}
                disabled={jobs.loading || page === 1}
                onClick={() => update("cleanup_page", String(page - 1))}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={t("下一頁清理記錄", "Next cleanup page")}
                disabled={jobs.loading || page * size >= jobs.data.total}
                onClick={() => update("cleanup_page", String(page + 1))}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </>
      )}
      {retryVisible && (
        <Modal
          title={t("重試永久清理", "Retry permanent cleanup")}
          onClose={() => setRetry(null)}
        >
          <AsyncForm
            submitLabel={t("確認重試", "Confirm retry")}
            onSubmit={async (f) => {
              await post(`/v1/admin/deletions/${retry.id}/retry`, {
                reason: String(f.get("reason")),
              });
              setRetry(null);
              setRefresh((v) => v + 1);
            }}
          >
            <p className="mono small-text">{retry.target_id}</p>
            <Field label={t("原因", "Reason")}>
              <textarea name="reason" required minLength={3} maxLength={2000} />
            </Field>
          </AsyncForm>
        </Modal>
      )}
    </section>
  );
}
