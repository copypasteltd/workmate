import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, Link2, Plus, RefreshCw } from "lucide-react";
import { useWorkspace } from "./context";
import { post, download } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import { AsyncForm, DateText, ErrorNotice, Field, Loading, Modal, PageHeader, useData, useI18n } from "./ui";
import "./creative-feedback.css";

type Mapping = {
  id: string; name: string; state: "candidate" | "confirmed" | "withdrawn"; version: number; sha256: string;
  confirmed_by: string | null; confirmed_at: string | null; withdrawn_at: string | null; withdrawal_reason: string | null;
  body: { asset: { id: string; asset_id: string; name: string; version: number; sha256: string };
    dataset: { id: string; source: string; account_id: string; currency: string; timezone: string;
      attribution_definition: string; conversion_definition: string; source_sha256: string };
    input: { ad_id: string; creative_id: string; channel: string; campaign: string; date_from: string; date_to: string; match_source: string; match_note: string } };
};
type Options = { can_write: boolean; limit: number; datasets: { id: string; name: string; source: string; currency: string; import_spec: { account_id: string } }[];
  assets: { id: string; name: string }[] };
type Identity = { channel: string; campaign: string; ad_id: string; date_from: string; date_to: string };
type Feedback = { id: string; name: string; sha256: string; created_at: string; asset_id: string; asset_version: number;
  body: { period: { date_from: string; date_to: string }; input_rows: number; deduplicated_rows: number;
    mapping_versions: { id: string; version: number; sha256: string }[];
    groups: { id: string; scope: Mapping["body"]["dataset"] & { asset_version_id: string; asset_sha256: string; creative_id: string };
      ad_ids: string[]; observed_days: string[]; metrics: { exact: Record<string, string | null>; null_reasons: Record<string, string> } }[] } };
type Page<T> = { items: T[]; next_cursor: string | null };
const exact = (v: string | null | undefined) => v == null ? null : v.includes(".") ? v.replace(/\.?0+$/, "") : v;

function useOperation() {
  const w = useWorkspace();
  return async (path: string, body: unknown) => {
    const account = w.me.user.id;
    const result = await post(path, body, await operationKey(account, path, body));
    await completeOperation(account, path, body);
    return result;
  };
}
function MappingFacts({ item }: { item: Mapping }) {
  const { t } = useI18n(), b = item.body;
  return <dl className="feedback-facts">
    <div><dt>{t("素材版本", "Asset version")}</dt><dd>{b.asset.name} · v{b.asset.version}<small>{b.asset.sha256}</small></dd></div>
    <div><dt>{t("廣告身份", "Ad identity")}</dt><dd>{b.dataset.source} / {b.dataset.account_id}<small>ad: {b.input.ad_id} · creative: {b.input.creative_id}</small></dd></div>
    <div><dt>{t("資料口徑", "Measurement scope")}</dt><dd>{b.dataset.currency} · {b.dataset.timezone}<small>{b.dataset.attribution_definition} · {b.dataset.conversion_definition}</small></dd></div>
    <div><dt>{t("有效日期", "Effective dates")}</dt><dd>{b.input.date_from} → {b.input.date_to}<small>{b.input.channel} · {b.input.campaign}</small></dd></div>
  </dl>;
}

export function CreativeFeedback({ onBack }: { onBack: () => void }) {
  const { t } = useI18n(), w = useWorkspace(), root = w.base + "/creative-feedback";
  const [revision, setRevision] = useState(0), [candidate, setCandidate] = useState(false), [reportOpen, setReportOpen] = useState(false);
  const [decision, setDecision] = useState<{ item: Mapping; action: "confirm" | "withdraw" } | null>(null);
  const [selected, setSelected] = useState<Mapping[]>([]), [error, setError] = useState<Error | null>(null);
  const [mappingCursors, setMappingCursors] = useState<string[]>([]), [reportCursors, setReportCursors] = useState<string[]>([]);
  const options = useData<Options>(root + "/options", revision, 15000);
  const mappings = useData<Page<Mapping>>(root + "/mappings?limit=40" + (mappingCursors.length ? "&cursor=" + mappingCursors.at(-1) : ""), revision, 15000);
  const reports = useData<Page<Feedback>>(root + "/reports?limit=20" + (reportCursors.length ? "&cursor=" + reportCursors.at(-1) : ""), revision, 15000);
  const writable = options.data?.can_write === true;
  const refresh = () => { setSelected([]); setRevision(v => v + 1); };
  const done = () => { setCandidate(false); setDecision(null); setReportOpen(false); refresh(); };
  const stateLabel = (state: Mapping["state"]) => state === "confirmed" ? t("已確認", "Confirmed") : state === "withdrawn" ? t("已撤銷", "Withdrawn") : t("待確認候選", "Candidate — review required");
  return <div className="creative-feedback">
    <button className="text-button" onClick={onBack}><ArrowLeft size={16} />{t("返回行銷分析", "Back to marketing insights")}</button>
    <PageHeader eyebrow="A CLEAR LINK. A BETTER NEXT MOVE." title={t("創意反饋", "Creative feedback")}
      description={t("把具體素材版本與已確認的廣告身份連起來，為下一輪創作保留可信依據。", "Connect an exact asset version to a confirmed ad identity. Keep the evidence for your next creative decision.")}
      action={<button className="button secondary" onClick={refresh}><RefreshCw size={16} />{t("重新整理", "Refresh")}</button>} />
    <ol className="feedback-path" aria-label={t("反饋流程", "Feedback process")}>
      <li><span>01</span><strong>{t("固定素材版本", "Pin the asset version")}</strong><small>{t("每次迭代，各有版本與摘要", "Each iteration keeps its own version and digest")}</small></li>
      <li><span>02</span><strong>{t("親自確認廣告身份", "Confirm the ad identity")}</strong><small>{t("同名只作候選，確認後才計算", "A similar name is only a candidate until you confirm")}</small></li>
      <li><span>03</span><strong>{t("保留獨立口徑", "Keep measurement scopes separate")}</strong><small>{t("不同帳戶、幣種與歸因分別呈現", "Separate accounts, currencies and attribution definitions")}</small></li>
    </ol>
    <p className="feedback-boundary">{t("這是經用戶確認的廣告級分配，並非平台已驗證的 creative 級測量。活動級同步不能分配給單一素材；請先匯入具備帳戶、廣告 ID 及歸因定義的廣告級資料。", "This is a user-confirmed allocation of ad-level data, not platform-verified creative measurement. Campaign-level sync cannot be assigned to one asset. First import ad-level data with its account, ad ID and attribution definitions.")}</p>
    <ErrorNotice error={error ?? options.error ?? mappings.error ?? reports.error} />
    {options.data && !writable && <p className="notice">{t("目前為唯讀權限，可以檢視已獲授權的身份及反饋。", "Your current access is read-only. You can review authorized identities and feedback.")}</p>}
    <section aria-labelledby="feedback-mapping-heading">
      <div className="feedback-section-heading"><div><p className="eyebrow">IDENTITY BEFORE INSIGHT.</p><h2 id="feedback-mapping-heading">{t("素材與廣告", "Assets & ads")}</h2></div>
        {writable && <div className="row-actions"><button className="button secondary" onClick={() => setCandidate(true)}><Plus size={16} />{t("建立候選", "New candidate")}</button>
          <button className="button primary" disabled={!selected.length} onClick={() => setReportOpen(true)}><ArrowRight size={16} />{t("建立反饋", "Create feedback")} {selected.length ? `(${selected.length})` : ""}</button></div>}</div>
      {mappings.loading && !mappings.data ? <Loading /> : mappings.data?.items.length === 0 ? <div className="feedback-empty"><Link2 size={28} /><h3>{t("先建立一個清楚的連結", "Start with one clear connection")}</h3><p>{t("選擇共享素材的具體版本與廣告級資料，再親自確認。未確認的候選不會產生表現指標。", "Choose a shared asset version and ad-level source, then review the identity. Unconfirmed candidates produce no performance metrics.")}</p></div> : null}
      <div className="feedback-mapping-list">{mappings.data?.items.map(m => <article key={m.id} className={"feedback-mapping " + m.state} data-mapping-id={m.id}>
        <header><div className="feedback-mapping-title">{writable && m.state === "confirmed" && <input type="checkbox" aria-label={t("選擇反饋映射", "Select feedback mapping") + ": " + m.name}
          checked={selected.some(s => s.id === m.id)} disabled={selected.length >= 40 && !selected.some(s => s.id === m.id)} onChange={e => setSelected(v => e.target.checked ? [...v.filter(s => s.id !== m.id), m] : v.filter(s => s.id !== m.id))} />}
          <h3>{m.name}</h3></div><span className="feedback-status">{m.state === "confirmed" && <Check size={14} />}{stateLabel(m.state)}</span></header>
        <MappingFacts item={m} />
        <details><summary>{t("身份依據與確認紀錄", "Identity evidence & confirmation history")}</summary><p>{m.body.input.match_note}</p>
          <p>{t("候選來源（用戶聲明）", "Candidate origin (user declared)")}: {m.body.input.match_source}</p><p>{t("來源摘要", "Source digest")}: <code>{m.body.dataset.source_sha256}</code></p>
          <p>{t("確認人", "Confirmed by")}: {m.confirmed_by ?? "—"} · <DateText value={m.confirmed_at} /></p>
          {m.withdrawn_at && <p>{t("已撤銷", "Withdrawn")}: <DateText value={m.withdrawn_at} /> · {m.withdrawal_reason}</p>}
          <p>{t("映射版本", "Mapping version")}: {m.version} · <code>{m.sha256}</code></p></details>
        {writable && m.state !== "withdrawn" && <footer>{m.state === "candidate" && <button className="button primary" onClick={() => setDecision({ item: m, action: "confirm" })}>{t("檢查並確認", "Review & confirm")}</button>}
          <button className="text-button" onClick={() => setDecision({ item: m, action: "withdraw" })}>{t("撤銷映射", "Withdraw mapping")}</button></footer>}
      </article>)}</div>
      <div className="row-actions feedback-pagination"><button className="button secondary" disabled={!mappingCursors.length || mappings.loading} onClick={() => setMappingCursors(v => v.slice(0, -1))}>{t("上一頁", "Previous page")}</button>
        <button className="button secondary" disabled={!mappings.data?.next_cursor || mappings.loading} onClick={() => setMappingCursors(v => [...v, mappings.data!.next_cursor!])}>{t("下一頁", "Next page")}</button></div>
    </section>
    <section aria-labelledby="feedback-reports-heading"><div className="feedback-section-heading"><div><p className="eyebrow">EVIDENCE YOU CAN RETURN TO.</p><h2 id="feedback-reports-heading">{t("已保存反饋", "Saved feedback")}</h2></div></div>
      {reports.loading && !reports.data ? <Loading /> : reports.data?.items.length === 0 ? <p className="feedback-empty">{t("確認身份後，選取映射建立有明確日期的反饋。", "After confirming identities, select mappings and create feedback for an explicit date range.")}</p> : null}
      {reports.data?.items.map(r => <article className="feedback-report" key={r.id} data-feedback-id={r.id}><header><div><h3>{r.name}</h3><p>{r.body.period.date_from} → {r.body.period.date_to} · <DateText value={r.created_at} /></p></div>
        <button className="button secondary" onClick={() => { setError(null); void download(`${w.base}/assets/${r.asset_id}/download?version=${r.asset_version}`, r.name + ".json", w.tenant).catch(setError); }}><Download size={16} />{t("下載證據 JSON", "Download evidence JSON")}</button></header>
        {r.body.groups.map(g => <section className="feedback-scope" key={g.id} aria-label={g.scope.account_id + " / " + g.scope.creative_id}>
          <div className="feedback-scope-label"><strong>{g.scope.creative_id}</strong><span>{g.scope.source} / {g.scope.account_id}</span></div>
          <p className="muted">{g.scope.currency} · {g.scope.timezone} · {g.scope.attribution_definition} · {g.scope.conversion_definition}</p>
          <dl className="feedback-metrics">{[["spend", t("花費", "Spend")], ["impressions", t("曝光", "Impressions")], ["clicks", t("點擊", "Clicks")], ["conversions", t("轉化", "Conversions")]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{exact(g.metrics.exact[key]) ?? t("未知", "Unknown")}{key === "spend" && <small>{g.scope.currency}</small>}</dd></div>)}</dl>
          {g.metrics.exact.conversions == null && <p className="feedback-note">{t("部分日期沒有轉化資料，總轉化保持未知。", "Some dates have no conversion data; total conversions remain unknown.")}</p>}
          <details><summary>{t("查看版本與觀測日期", "View version & observed dates")}</summary><p>{t("素材版本 ID", "Asset version ID")}: <code>{g.scope.asset_version_id}</code></p><p>SHA-256: <code>{g.scope.asset_sha256}</code></p><p>ad: {g.ad_ids.join(", ")}</p><p>{g.observed_days.join(", ")}</p></details>
        </section>)}
        <p className="feedback-note">{t("重疊的相同廣告日已去重", "Identical overlapping ad-days deduplicated")}: {r.body.deduplicated_rows}. {t("沒有觀測的日期不當作零。此反饋不代表因果提升，也不提供跨口徑總計。", "Unobserved days are not zero. This feedback makes no causal uplift claim and no total across measurement scopes.")}</p>
        <details><summary>{t("下一輪創作的依據", "Evidence for the next creative iteration")}</summary><p>{t("下載 JSON，或在共享檔案選用這份報告作為下一輪工作的明確附件。管理範圍內的重新讀取會檢查來源；已下載至外部的副本需自行管理。", "Download the JSON, or select this report in shared files as an explicit input to your next work. Managed reads recheck the sources; exported copies remain under your control.")}</p><p>{t("檔案 ID", "File ID")}: <code>{r.asset_id}</code> · v{r.asset_version}</p><p>SHA-256: <code>{r.sha256}</code></p></details>
      </article>)}
      <div className="row-actions feedback-pagination"><button className="button secondary" disabled={!reportCursors.length || reports.loading} onClick={() => setReportCursors(v => v.slice(0, -1))}>{t("上一頁", "Previous page")}</button><button className="button secondary" disabled={!reports.data?.next_cursor || reports.loading} onClick={() => setReportCursors(v => [...v, reports.data!.next_cursor!])}>{t("下一頁", "Next page")}</button></div>
    </section>
    {candidate && options.data && writable && <Candidate root={root} options={options.data} onClose={() => setCandidate(false)} onDone={done} />}
    {decision && writable && <Decision root={root} {...decision} onClose={() => setDecision(null)} onDone={done} />}
    {reportOpen && writable && <ReportForm root={root} mappings={selected} onClose={() => setReportOpen(false)} onDone={done} />}
  </div>;
}

function Candidate({ root, options, onClose, onDone }: { root: string; options: Options; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(), run = useOperation();
  const [dataset, setDataset] = useState(""), [asset, setAsset] = useState(""), [identity, setIdentity] = useState("");
  const [dates, setDates] = useState({ from: "", to: "" });
  const identities = useData<{ items: Identity[] }>(dataset ? root + "/options?dataset_id=" + dataset : null);
  const versions = useData<{ items: { id: string; version: number; sha256: string }[] }>(asset ? root + "/options?asset_id=" + asset : null);
  const chosen = identity === "" ? undefined : identities.data?.items[Number(identity)];
  return <Modal title={t("建立身份候選", "Create an identity candidate")} onClose={onClose}><div className="creative-feedback">
    <p>{t("候選不會自動確認。只選擇確定由單一 creative 覆蓋整段日期的廣告。", "Candidates are never confirmed automatically. Choose an ad only when one creative covers the entire selected date range.")}</p>
    <p className="muted">{t("顯示最近最多 100 份合資格來源及素材。沒有可選資料時，先回到行銷分析匯入廣告級快照，並上傳共享素材。", "Shows up to 100 recent eligible sources and assets. If none are available, import an ad-level snapshot in marketing insights and upload a shared asset first.")}</p>
    <ErrorNotice error={identities.error ?? versions.error} />
    <AsyncForm submitLabel={t("保存候選，稍後確認", "Save candidate for review")} submitDisabled={!chosen || !versions.data?.items.length || identities.loading || versions.loading} onSubmit={async f => {
      if (!chosen) return;
      await run(root + "/mappings", { name: f.get("name"), dataset_id: dataset, asset_version_id: f.get("asset_version"), ...chosen,
        creative_id: f.get("creative_id"), date_from: dates.from, date_to: dates.to, match_source: f.get("match_source"), match_note: f.get("match_note"), allocation: "single_creative_entire_ad" }); onDone();
    }}>
      <Field label={t("候選名稱", "Candidate name")}><input name="name" required maxLength={160} /></Field>
      <Field label={t("廣告級資料來源", "Ad-level data source")}><select required value={dataset} onChange={e => { setDataset(e.target.value); setIdentity(""); setDates({ from: "", to: "" }); }}><option value="">{t("請選擇", "Choose a source")}</option>{options.datasets.map(d => <option key={d.id} value={d.id}>{d.name} · {d.source} / {d.import_spec.account_id} · {d.currency}</option>)}</select></Field>
      <Field label={t("具體廣告", "Exact ad")}><select required value={identity} disabled={!identities.data} onChange={e => { setIdentity(e.target.value); const x = identities.data?.items[Number(e.target.value)]; setDates({ from: x?.date_from ?? "", to: x?.date_to ?? "" }); }}><option value="">{t("請選擇廣告 ID", "Choose an ad ID")}</option>{identities.data?.items.map((d, i) => <option key={i} value={i}>{d.ad_id} · {d.channel} · {d.campaign}</option>)}</select></Field>
      <Field label={t("共享素材", "Shared creative asset")}><select required value={asset} onChange={e => setAsset(e.target.value)}><option value="">{t("請選擇素材", "Choose an asset")}</option>{options.assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label={t("固定素材版本", "Pinned asset version")}><select key={asset} name="asset_version" required defaultValue="" disabled={!versions.data}><option value="">{t("請檢查版本", "Review the version")}</option>{versions.data?.items.map(v => <option key={v.id} value={v.id}>v{v.version} · {v.sha256.slice(0, 16)}</option>)}</select></Field>
      <Field label="Creative ID" hint={t("填入平台上的 creative ID。這是用戶聲明，系統未向平台自動核實。", "Enter the platform creative ID. This is a user declaration, not an automatic platform verification.")}><input name="creative_id" required maxLength={200} /></Field>
      <div className="feedback-form-dates"><Field label={t("開始日期", "From date")}><input type="date" required value={dates.from} max={dates.to || undefined} onChange={e => setDates(d => ({ ...d, from: e.target.value }))} /></Field><Field label={t("結束日期", "To date")}><input type="date" required value={dates.to} min={dates.from || undefined} onChange={e => setDates(d => ({ ...d, to: e.target.value }))} /></Field></div>
      <Field label={t("候選依據", "Candidate basis")}><select name="match_source"><option value="manual">{t("人工核對", "Manual review")}</option><option value="name_candidate">{t("相似名稱（仍需確認）", "Similar name (confirmation required)")}</option><option value="provider_metadata">{t("平台資料（用戶提供）", "Platform metadata (user supplied)")}</option></select></Field>
      <Field label={t("身份核對備註", "Identity review note")}><textarea name="match_note" required minLength={5} maxLength={2000} /></Field>
    </AsyncForm></div></Modal>;
}
function Decision({ root, item, action, onClose, onDone }: { root: string; item: Mapping; action: "confirm" | "withdraw"; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(), run = useOperation();
  return <Modal title={action === "confirm" ? t("確認具體廣告身份", "Confirm the exact ad identity") : t("撤銷身份映射", "Withdraw identity mapping")} onClose={onClose}><div className="creative-feedback"><MappingFacts item={item} />
    <p>{action === "confirm" ? t("請核對素材、帳戶、廣告與日期。確認後原身份正文不能修改；更正須先撤銷再建立新候選。", "Review the asset, account, ad and dates. The confirmed identity is immutable; withdraw it and create a new candidate for corrections.") : t("撤銷保留原確認歷史，並停止以此映射建立或讀取反饋。先前已匯出的外部副本需自行管理。", "Withdrawal retains confirmation history and stops managed feedback creation and reads for this mapping. Manage previously exported copies separately.")}</p>
    <AsyncForm submitLabel={action === "confirm" ? t("確認身份", "Confirm identity") : t("撤銷映射", "Withdraw mapping")} onSubmit={async f => {
      await run(`${root}/mappings/${item.id}/${action}`, { expected_version: item.version, expected_sha256: item.sha256, reason: f.get("reason"), ...(action === "confirm" ? { confirm_single_creative_allocation: true } : {}) }); onDone();
    }}>{action === "confirm" && <label className="feedback-attestation"><input type="checkbox" required /><span>{t("我已核對：此廣告在整段所選日期僅對應這一個 creative 及素材版本。", "I checked that this ad used only this creative and asset version throughout the selected date range.")}</span></label>}
      <Field label={t("操作原因", "Decision reason")}><textarea name="reason" required minLength={5} maxLength={2000} /></Field></AsyncForm></div></Modal>;
}
function ReportForm({ root, mappings, onClose, onDone }: { root: string; mappings: Mapping[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(), run = useOperation();
  return <Modal title={t("建立有明確口徑的反饋", "Create feedback with explicit scopes")} onClose={onClose}><div className="creative-feedback"><p>{t("只納入目前仍有效的已確認映射。相同廣告日去重，衝突資料拒絕，不會合併不同帳戶或歸因。", "Only currently available confirmed mappings contribute. Identical ad-days are deduplicated, conflicts reject, and different accounts or attribution definitions stay separate.")}</p><ul>{mappings.map(m => <li key={m.id}>{m.name} · {m.body.dataset.account_id} · v{m.version}</li>)}</ul>
    <AsyncForm submitLabel={t("計算並保存反饋", "Calculate & save feedback")} submitDisabled={!mappings.length || mappings.length > 40} onSubmit={async f => {
      await run(root + "/reports", { name: f.get("name"), mapping_ids: mappings.map(m => m.id).sort(), date_from: f.get("date_from"), date_to: f.get("date_to") }); onDone();
    }}><Field label={t("反饋名稱", "Feedback name")}><input name="name" required maxLength={160} /></Field>
      <div className="feedback-form-dates"><Field label={t("開始日期", "From date")}><input type="date" name="date_from" required defaultValue={mappings.map(m => m.body.input.date_from).sort()[0]} /></Field><Field label={t("結束日期", "To date")}><input type="date" name="date_to" required defaultValue={mappings.map(m => m.body.input.date_to).sort().at(-1)} /></Field></div>
    </AsyncForm></div></Modal>;
}
