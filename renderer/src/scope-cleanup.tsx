import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useWorkspace } from "./context";
import { DateText, ErrorNotice, Loading, PageHeader, useData, useI18n } from "./ui";
import "./scope-erasure.css";
const labels: Record<string, [string,string]> = {
  RETAINED_FINANCIAL_AUDIT_FACTS: ["保留必要帳務與審計記錄", "Required billing and audit records retained"],
  GLOBAL_USER_ACCOUNTS_OUTSIDE_SCOPE: ["共用帳戶不在刪除範圍", "Shared accounts are outside this scope"],
  DIRECTORY_EXPORT_METADATA_UNTIL_SHORT_EXPIRY: ["既有目錄匯出按短期有效期失效", "Existing directory exports expire under their short retention period"],
  BACKUPS_REQUIRE_ERASURE_REPLAY: ["舊備份恢復必須重播刪除記錄", "Old backup restores require erasure replay"],
  CUSTOMER_LOCAL_FILES_OUTSIDE_SCOPE: ["本機副本由客戶自行管理", "Customer-local copies remain customer-managed"],
};
export function ScopeCleanupPage() {
  const { t } = useI18n(), w = useWorkspace(), [page, setPage] = useState(1);
  const jobs = useData<any>(w.me ? `/v1/scope-deletions?page=${page}&page_size=25` : null, 0, 4000);
  if (w.loading) return <Loading />;
  if (!w.me) return <Navigate to="/login" replace />;
  const state = (s: string) => ({queued:t("等待清理", "Queued"),cleaning:t("正在清理", "Cleaning"),completed:t("已完成", "Completed"),completed_with_exceptions:t("已清理 · 保留政策適用", "Cleaned · retention policy applies"),failed:t("需要處理", "Needs attention")})[s] ?? s;
  return <main className="scope-cleanup-page"><PageHeader eyebrow="SPACE FOR THE WORK." title={t("清理記錄", "Cleanup records")} description={t("永久刪除狀態與保留範圍；刪除最後一個工作空間後仍可在此查看。", "Permanent deletion status and retained records, accessible even after deleting your last workspace.")} action={<Link className="button secondary" to={w.me.memberships.length ? "/app/projects" : "/welcome"}>{t("返回工作台", "Back to workspace")}</Link>} />
    <ErrorNotice error={jobs.error} />{jobs.loading && !jobs.data && <Loading />}
    {jobs.data?.items.length === 0 && <p>{t("目前沒有清理記錄。", "No cleanup records yet.")}</p>}
    {jobs.data?.items.map((j:any) => <article className="card scope-cleanup-card" key={j.id} data-cleanup-id={j.id}>
      <h2>{j.target_type === "tenants" ? t("企業工作空間", "Company workspace") : t("專案", "Project")}</h2><p role="status">{state(j.state)}</p>
      <p className="mono small-text">{j.target_id}</p><DateText value={j.created_at} />
      {j.progress.total > 0 && <p>{t("檔案清理", "File cleanup")}: {j.progress.completed}/{j.progress.total}</p>}
      {j.exceptions.length > 0 && <p>{t("仍有工作、費用核對或檔案清理待結束，請稍後查看。", "Execution, reconciliation or file cleanup is still pending. Check back shortly.")}</p>}
      {!!j.retained?.length && <details><summary>{t("查看保留範圍", "Review retention")}</summary>{j.retained.map((r:string) => <p key={r}>{labels[r] ? t(...labels[r]) : t("仍被其他範圍引用的檔案或必要記錄", "Files referenced by another scope or required records")}</p>)}</details>}
    </article>)}
    <div className="project-management-pagination"><button className="button secondary" disabled={page === 1} onClick={() => setPage(v=>v-1)}>{t("上一頁", "Previous")}</button><span>{page}</span><button className="button secondary" disabled={!jobs.data || page*25 >= jobs.data.total} onClick={() => setPage(v=>v+1)}>{t("下一頁", "Next")}</button></div>
  </main>;
}
