import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, RefreshCw, ArrowUpRight } from "lucide-react";
import { post, download } from "./api";
import { useI18n, useData, ErrorNotice, Loading, PageHeader, Field, Empty, Modal, DateText, Badge } from "./ui";
import { formatHKD } from "./financial-money";
import { userResourceReturn } from "./user-resources";
import "./usage-reports.css";

const root = "/v1/admin/usage-reports";
const keys = ["user_id", "tenant_id", "project_id", "billing_account_id", "task_id", "capability_version_id", "payer_kind", "source", "role_key", "model_alias"] as const;
const groups = { user: ["發起人", "Initiator"], payer: ["付款帳戶", "Payer account"], tenant: ["企業", "Enterprise"], project: ["項目", "Project"], role: ["角色", "Role"], source: ["來源", "Source"], day: ["香港日期", "Hong Kong day"], capability: ["能力版本", "Capability version"] } as const;
const day = (ms: number) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const local = (iso: string) => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 16);
function period(kind = "week") {
  const today = day(Date.now()), end = day(Date.now() + 86400000);
  return { period_from: (kind === "today" ? today : kind === "month" ? today.slice(0, 7) + "-01" : day(Date.now() - 6 * 86400000)) + "T00:00", period_to: end + "T00:00" };
}
function read(search: string): Record<string, string> {
  const q = new URLSearchParams(search), f: Record<string, string> = period();
  for (const k of keys) f[k] = q.get(k) ?? "";
  for (const k of ["period_from", "period_to"]) if (q.get(k)) { try { f[k] = local(q.get(k)!); } catch { f[k] = ""; } }
  return f;
}
function filters(f: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const k of keys) if (f[k]?.trim()) out[k] = f[k].trim();
  const a = new Date(f.period_from + ":00+08:00"), b = new Date(f.period_to + ":00+08:00");
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || a >= b) throw new Error("結束時間必須在開始時間之後 / The end must follow the start.");
  out.period_from = a.toISOString(); out.period_to = b.toISOString(); return out;
}
const sameFilters = (a: any, b: any) => [...keys, "period_from", "period_to"].every(k => (a[k] ?? "") === (b[k] ?? ""));
function FinancialSummary({ value }: { value: any }) {
  const { t } = useI18n();
  return <section className="usage-totals" aria-label={t("消耗概覽", "Consumption summary")}>
    {([["confirmed_micros", "確認扣費", "Confirmed charges"], ["refunded_micros", "退回消耗", "Consumption refunds"], ["net_micros", "淨消耗", "Net consumption"], ["reserved_micros", "預留", "Reserved"], ["reconciliation_hold_micros", "對賬預留", "Reconciliation hold"]] as const).map(([key, zh, en]) => <div key={key}><span>{t(zh, en)}</span><strong>{formatHKD(value[key])}</strong></div>)}
    <div><span>{t("待對賬工作", "Unresolved works")}</span><strong>{value.unresolved_works} / {value.works}</strong></div>
    {value.internal_cost && <div><span>{t("內部實際成本", "Actual internal cost")}</span><strong>{t("未知", "Unknown")}</strong><small>{t("未接入供應商實際帳單", "Actual supplier bills are not connected")}</small></div>}
  </section>;
}
export function AdminUsageReports({ access }: { access: { has: (key: string) => boolean } }) {
  const { t } = useI18n(), location = useLocation(), navigate = useNavigate();
  const q = new URLSearchParams(location.search), id = q.get("report_id"), view = (Object.hasOwn(groups, q.get("view") ?? "") ? q.get("view") : "user") as keyof typeof groups;
  const page = Math.max(1, Number(q.get("page")) || 1), groupBy = q.get("group_by"), groupKey = q.get("group_key");
  const [draft, setDraft] = useState(() => read(location.search)), [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null), [work, setWork] = useState<any>(null);
  const epoch = useRef(0), request = useRef({ signature: "", key: "" });
  useEffect(() => { epoch.current++; setDraft(read(location.search)); setWork(null); setBusy(false); setError(null); return () => { epoch.current++; }; }, [location.search]);
  const detailQuery = new URLSearchParams({ page: String(page), page_size: "20" });
  if (groupBy && groupKey) { detailQuery.set("group_by", groupBy); detailQuery.set("group_key", groupKey); }
  const { data, loading, error: loadError } = useData(id ? root + "/" + encodeURIComponent(id) + "?" + detailQuery : null);
  let mismatch = false;
  if (data) { try { mismatch = !sameFilters(data.filters, filters(read(location.search))); } catch { mismatch = true; } }
  const report = !mismatch ? data : null;
  function move(values: Record<string, string | null>) { const next = new URLSearchParams(location.search); for (const [k, v] of Object.entries(values)) v === null ? next.delete(k) : next.set(k, v); navigate("/usage?" + next); }
  async function create() {
    const current = epoch.current; setError(null);
    try {
      const f = filters(draft), signature = JSON.stringify(f);
      if (signature !== request.current.signature) request.current = { signature, key: crypto.randomUUID() };
      setBusy(true); const saved: any = await post(root, f, request.current.key);
      if (current !== epoch.current) return;
      request.current = { signature: "", key: "" }; const next = new URLSearchParams(f); next.set("report_id", saved.id);
      if (q.has("users_return")) next.set("users_return", q.get("users_return")!);
      navigate("/usage?" + next);
    } catch (e) { if (current === epoch.current) setError(e as Error); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  const field = (key: string, zh: string, en: string) => <Field key={key} label={t(zh, en)}><input name={key} value={draft[key] ?? ""} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></Field>;
  return <div className="usage-report">
    <PageHeader eyebrow="OPERATIONS / CONSUMPTION" title={t("用戶消耗", "User consumption")} description={t("由付款帳戶追溯每項工作及費用來源。", "Trace each work and its charges to the paying account.")} />
    {q.get("user_id") && <Link className="button secondary" to={userResourceReturn(q.get("user_id")!, location.search)}><ArrowLeft size={16} />{t("返回用戶", "Back to user")}</Link>}
    <form className="usage-filters" onSubmit={e => { e.preventDefault(); void create(); }}>
      <div className="usage-period"><strong>{t("工作建立期間 · 香港時間", "Work creation period · Hong Kong time")}</strong><div>{["today", "week", "month"].map((k, i) => <button type="button" className="secondary" key={k} onClick={() => setDraft({ ...draft, ...period(k) })}>{[t("今日", "Today"), t("近七日", "Last 7 days"), t("本月", "This month")][i]}</button>)}</div></div>
      <div className="usage-filter-grid">
        <Field label={t("開始（含）", "From (inclusive)")}><input required name="period_from" type="datetime-local" value={draft.period_from} onChange={e => setDraft({ ...draft, period_from: e.target.value })} /></Field>
        <Field label={t("結束（不含）", "To (exclusive)")}><input required name="period_to" type="datetime-local" value={draft.period_to} onChange={e => setDraft({ ...draft, period_to: e.target.value })} /></Field>
        {field("user_id", "發起人 ID", "Initiator ID")}{field("billing_account_id", "付款帳戶 ID", "Payer account ID")}
      </div>
      <details><summary>{t("更多篩選", "More filters")}</summary><div className="usage-filter-grid">
        {field("tenant_id", "企業 ID", "Enterprise ID")}{field("project_id", "項目 ID", "Project ID")}{field("task_id", "任務 ID", "Task ID")}{field("role_key", "角色", "Role key")}{field("capability_version_id", "能力版本 ID", "Capability version ID")}{field("model_alias", "模型別名", "Model alias")}
        <Field label={t("付款主體", "Payer type")}><select name="payer_kind" value={draft.payer_kind} onChange={e => setDraft({ ...draft, payer_kind: e.target.value })}><option value="">{t("全部", "All")}</option><option value="user">{t("個人", "Personal")}</option><option value="tenant">{t("企業", "Enterprise")}</option></select></Field>
        <Field label={t("執行來源", "Execution source")}><select name="source" value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })}><option value="">{t("全部", "All")}</option><option value="cloud_agent">Cloud Agent</option><option value="desktop_agent">Desktop Agent</option><option value="cloud_resource">{t("雲端資源", "Cloud resource")}</option></select></Field>
      </div></details>
      <div className="usage-form-actions"><p>{t("金額為所選工作截至快照的累計帳務。期間按工作建立時間篩選，並非入帳期間。", "Amounts are cumulative accounting for the selected works as of the snapshot. The period filters work creation, not posting dates.")}</p><button disabled={busy} type="submit"><RefreshCw size={16} />{busy ? t("正在建立…", "Creating…") : t("建立最新報表", "Create fresh report")}</button></div>
    </form>
    <ErrorNotice error={error ?? loadError ?? (mismatch ? new Error("報表與網址條件不同，請重新建立 / Report filters differ from this URL. Create a fresh report.") : null)} />
    {loading && <Loading />}
    {report && <>
      <div className="usage-snapshot"><div><span className="eyebrow">{t("固定快照", "FIXED SNAPSHOT")}</span><p><DateText value={report.as_of} /> · {t("到期", "Expires")} <DateText value={report.expires_at} /></p></div><code title={report.watermark}>{report.watermark.slice(0, 16)}</code>{access.has("admin.exports.create") && access.has("admin.exports.download") && <button className="secondary" onClick={async () => { try { await download(root + "/" + report.id + "/export?" + detailQuery, "workmate-usage-" + report.id + ".csv"); } catch (e) { setError(e as Error); } }}><Download size={16} />{t("匯出此選擇", "Export selection")}</button>}</div>
      <FinancialSummary value={report.summary} />
      <div className="usage-analysis"><section className="usage-breakdown"><Field label={t("分組檢視", "Group by")}><select name="usage_group" value={view} onChange={e => move({ view: e.target.value })}>{Object.entries(groups).map(([k, label]) => <option key={k} value={k}>{t(label[0], label[1])}</option>)}</select></Field>
        {view === "capability" && <p className="muted">{t("能力分組只計工作與操作次數，不重複歸屬整筆工作費用。", "Capability groups count works and operations; whole-work charges are not allocated again.")}</p>}
        <button className="usage-group" onClick={() => move({ group_by: null, group_key: null, page: null })}><strong>{t("所有工作", "All works")}</strong><ArrowUpRight size={17} /></button>
        {report.groups[view].map((g: any) => <button key={g.key} className={"usage-group" + (groupBy === view && groupKey === g.key ? " selected" : "")} onClick={() => move({ group_by: view, group_key: g.key, page: null })}><span><strong>{g.label ?? g.key}</strong><small>{g.works} {t("項工作", "works")}</small></span><span>{g.confirmed_micros === null ? `${g.operation_count} ops` : formatHKD(g.confirmed_micros)}</span></button>)}
      </section><section className="usage-works"><h2>{t("工作明細", "Work details")} <small>{report.total}</small></h2>
        {!report.items.length && <Empty title={t("沒有符合條件的工作", "No matching works")} body={t("請調整篩選後重新建立報表。", "Adjust the filters and create a fresh report.")} />}
        {report.items.map((w: any) => <article className="usage-work" key={w.kind + w.id}><div><Badge value={w.state} /><strong>{w.role_key ?? t("雲端資源", "Cloud resource")}</strong><small>{w.id}</small><span>{w.project_name} · {w.source}</span><small>{w.payer_kind} · {w.billing_account_id}</small></div><div><strong>{formatHKD(w.confirmed_micros)}</strong><small>{w.operation_count} {t("項操作", "operations")}</small><button className="secondary" onClick={() => setWork({ id: w.id, kind: w.kind, report: report.id })}>{t("查看明細", "View details")}</button></div></article>)}
        <div className="usage-pagination"><button className="secondary" disabled={page <= 1} onClick={() => move({ page: String(page - 1) })}>{t("上一頁", "Previous")}</button><span>{page} / {Math.max(1, Math.ceil(report.total / 20))}</span><button className="secondary" disabled={page * 20 >= report.total} onClick={() => move({ page: String(page + 1) })}>{t("下一頁", "Next")}</button></div>
      </section></div>
      <section className="usage-units"><h2>{t("用量單位", "Usage units")}</h2>{Object.entries(report.summary.units).map(([unit, raw]) => { const v = raw as any; return <span key={unit}><strong>{v.known}</strong> {unit} · {v.unknown_operations} {t("項未知", "unknown")}</span>; })}{!Object.keys(report.summary.units).length && <p>{t("未記錄模型用量；不能視為零用量。", "No model usage recorded; this does not establish zero usage.")}</p>}</section>
    </>}
    {work && report?.id === work.report && <WorkDetail work={work} onClose={() => setWork(null)} />}
  </div>;
}
function WorkDetail({ work, onClose }: { work: any; onClose: () => void }) {
  const { t } = useI18n(), { data, loading, error } = useData(root + "/" + work.report + "/works/" + work.kind + "/" + work.id);
  return <Modal title={t("工作帳務明細", "Work accounting details")} onClose={onClose}><ErrorNotice error={error} />{loading && <Loading />}{data && <div className="usage-detail"><p>{data.work.id}</p><FinancialSummary value={{ ...data.work, works: 1, net_micros: (BigInt(data.work.confirmed_micros)-BigInt(data.work.refunded_micros)).toString(), unresolved_works: Number(data.work.unresolved) }} />
    <h3>{t("固定執行設定", "Pinned execution")}</h3><dl>{["user_id", "billing_account_id", "template_hash", "runtime_profile_id", "attempt"].map(k => <div key={k}><dt>{k}</dt><dd>{data.work[k] ?? t("未記錄", "Not recorded")}</dd></div>)}</dl>
    <h3>{t("操作及模型用量", "Operations and model usage")}</h3>{data.work.operations.map((o: any) => <article key={o.channel + o.id}><strong>{o.action} · {o.model_alias ?? o.channel}</strong><Badge value={o.state} /><p>{o.id} · {o.operation_id}</p><p>{t("能力版本", "Capability")} {o.capability_version_id ?? "—"} · {t("嘗試", "Attempt")} {o.attempt ?? t("未記錄", "Not recorded")}</p>{Object.entries(o.units).map(([k, v]) => <p key={k}>{k}: {v === null ? t("未知", "Unknown") : String(v)}</p>)}</article>)}
    <h3>{t("扣費與退回來源", "Charge and refund sources")}</h3>{[...data.work.ledger, ...data.work.refunds.map((r: any) => ({ ...r, kind: "refund" }))].map((r: any) => <article key={r.id}><strong>{r.kind} · {formatHKD(r.amount_micros)}</strong><p>{r.id}</p><p>{r.source_entry_id ?? r.operation_id}</p><DateText value={r.created_at} /></article>)}
  </div>}</Modal>;
}
