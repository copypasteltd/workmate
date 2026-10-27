import { useState } from "react";
import { NativeGeoControls } from "./native-geo";
import { ArrowLeft, Download, Plus, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useWorkspace } from "./context";
import { download, post } from "./api";
import { completeOperation, operationKey } from "./operation-key";
import { AsyncForm, DateText, ErrorNotice, Field, Loading, Modal, Money, PageHeader, useData, useI18n } from "./ui";
import "./geo-observations.css";

type Spec = { name: string; agent_id: string; region: string; language: string; questions: { key: string; text: string }[]; brands: { name: string; aliases: string[] }[] };
type Experiment = { id: string; name: string; version: number; sha256: string; moderation_version: number; body: { spec: Spec; harness: { requested_model_alias: string; runtime_version: string; protocol: string; agent_definition_sha256: string } } };
type Run = { id: string; name: string; surface: string; config_hash: string; created_at: string };
type Sample = { id: string; question: string; question_key: string; task_id: string | null; state: string; error_code: string | null;
  answer_sha256: string | null; observed_at: string | null; asset_id: string | null; asset_version_id: string | null; asset_version: number | null;
  confirmed_cost_micros: string | null; cost_state: string;
  analysis: { mentions: { brand: string; matched: boolean; matches: { start: number; end: number }[] }[]; links: { url: string }[] } | null };
type Detail = Run & { experiment_version: number; effective_config: any; questions: Spec["questions"]; samples: Sample[]; progress: { captured: number; total: number } };
type Quota = { active: number; available: number; max_active_tasks: number; max_question_budget_micros: string };
type Page<T> = { items: T[]; next_cursor: string | null; can_write?: boolean; quota?: Quota };
function useOperation() {
  const w = useWorkspace();
  return async (path: string, body: unknown) => {
    const key = await operationKey(w.me.user.id, path, body);
    const result = await post(path, body, key);
    await completeOperation(w.me.user.id, path, body);
    return result;
  };
}
function budgetMicros(amount: string) {
  if (!/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/.test(amount)) throw new Error("Enter a positive HKD budget with at most six decimal places.");
  const [whole, fraction = ""] = amount.split(".");
  const value = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  if (value < 10000n || value > 10000000000n) throw new Error("Budget must be between HKD 0.01 and HKD 10,000 per question.");
  return value.toString();
}
export function GeoObservations({ onBack }: { onBack: () => void }) {
  const { t } = useI18n(), w = useWorkspace(), root = w.base + "/geo", operation = useOperation();
  const [revision, setRevision] = useState(0), [expId, setExpId] = useState(""), [runId, setRunId] = useState("");
  const [expCursors, setExpCursors] = useState<string[]>([]), [runCursors, setRunCursors] = useState<string[]>([]);
  const [form, setForm] = useState<"new" | "version" | "api" | "manual" | "delete" | null>(null);
  const [left, setLeft] = useState<Run | null>(null), [right, setRight] = useState<Run | null>(null), [error, setError] = useState<Error | null>(null), [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ run: string; question: string } | null>(null);
  const experiments = useData<Page<Experiment>>(root + "/experiments?limit=30" + (expCursors.length ? "&cursor=" + expCursors.at(-1) : ""), revision, 0);
  const selectedId = expId || experiments.data?.items[0]?.id || "", e = experiments.data?.items.find(e => e.id === selectedId);
  const runs = useData<Page<Run>>(e ? root + "/experiments/" + e.id + "/runs?limit=30" + (runCursors.length ? "&cursor=" + runCursors.at(-1) : "") : null, revision, 10000);
  const selectedRun = runId || runs.data?.items[0]?.id || "";
  const detail = useData<Detail>(selectedRun ? root + "/runs/" + selectedRun : null, revision, 7000);
  const comparison = useData<any>(left && right ? root + "/compare?left=" + left.id + "&right=" + right.id : null, revision, 0);
  const writable = experiments.data?.can_write === true;
  const refresh = () => setRevision(v => v + 1);
  async function action(path: string, body: unknown) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await operation(path, body); refresh(); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  async function exportFile(path: string, name: string) {
    setError(null); try { await download(path, name, w.tenant); } catch (e) { setError(e as Error); }
  }
  return <div className="geo-workspace">
    <PageHeader eyebrow="OBSERVE. KEEP THE EVIDENCE." title={t("本機 GEO 觀測", "Local GEO observations")}
      description={t("固定問句、保留回答、比較變化。每個樣本都有自己的配置與來源。", "Fixed questions, retained answers and comparable observations. Every sample keeps its configuration and origin.")}
      action={<div className="row-actions"><button className="button secondary" onClick={onBack}><ArrowLeft size={15} />{t("行銷分析", "Marketing insights")}</button><button className="button primary" disabled={!writable} onClick={() => setForm("new")}><Plus size={15} />{t("新建問句集", "New question set")}</button></div>} />
    <div className="notice">{t("本機樣本由此電腦的 Codex 經公司內部接口產生，每題使用獨立空白會話，工具及檢索停用。消費產品人工樣本獨立保存；這些觀察不代表全網排名或因果結論。", "Local samples run with Codex on this computer through the company gateway, using fresh isolated sessions without tools or retrieval. Consumer manual samples are recorded separately. Observations do not establish global rankings or causation.")}</div>
    <ErrorNotice error={error ?? experiments.error ?? runs.error ?? detail.error ?? comparison.error} />
    {experiments.loading && !experiments.data ? <Loading /> : null}
    {!experiments.data?.items.length && !experiments.loading ? <div className="empty-state"><h2>{t("先定義要觀察的問題", "Start with the questions")}</h2><p>{t("建立固定問句與品牌別名，之後可在相同配置下重複觀察。", "Save fixed questions and brand aliases, then repeat observations with the same configuration.")}</p></div> : null}
    {experiments.data?.items.length ? <section className="geo-section">
      <div className="geo-toolbar"><Field label={t("觀測配置版本", "Observation configuration version")}><select value={selectedId} onChange={v => { setExpId(v.target.value); setRunId(""); setRunCursors([]); }}>
        {experiments.data.items.map(v => <option key={v.id} value={v.id}>{v.name} · v{v.version}</option>)}</select></Field>
        <button className="button secondary" disabled={!writable || !e} onClick={() => setForm("version")}>{t("另存新版本", "Save new version")}</button>
        <button className="icon-button" aria-label={t("重新整理觀測", "Refresh observations")} onClick={refresh}><RefreshCw size={16} /></button></div>
      <div className="row-actions"><button disabled={!expCursors.length} onClick={() => { setExpCursors(v => v.slice(0, -1)); setExpId(""); setRunId(""); }}>{t("上一頁配置", "Previous configurations")}</button><button disabled={!experiments.data.next_cursor} onClick={() => { setExpCursors(v => [...v, experiments.data!.next_cursor!]); setExpId(""); setRunId(""); }}>{t("下一頁配置", "More configurations")}</button></div>
      {e ? <><dl className="geo-facts"><div><dt>{t("模型別名 / 核心", "Model alias / runtime")}</dt><dd>{e.body.harness.requested_model_alias}<small>Codex {e.body.harness.runtime_version}</small></dd></div><div><dt>{t("地區 / 語言", "Region / language")}</dt><dd>{e.body.spec.region} · {e.body.spec.language}<small>{t("請求上下文；處理地區未知", "Requested context; processing location unknown")}</small></dd></div><div><dt>{t("配置 SHA-256", "Configuration SHA-256")}</dt><dd><code>{e.sha256}</code></dd></div></dl>
      <details><summary>{t("固定問句與別名", "Fixed questions and aliases")}</summary><ol>{e.body.spec.questions.map(q => <li key={q.key}>{q.text}</li>)}</ol><p>{e.body.spec.brands.map(b => b.name + ": " + b.aliases.join(" / ")).join(" · ")}</p></details>
      <div className="row-actions"><button className="button primary" disabled={!writable} onClick={() => setForm("api")}>{t("準備本機觀測", "Prepare local observation")}</button><button className="button secondary" disabled={!writable} onClick={() => setForm("manual")}>{t("錄入消費產品樣本", "Record consumer sample")}</button><button className="button secondary" disabled={!writable} onClick={() => setForm("delete")}>{t("刪除此配置及觀測", "Delete configuration and observations")}</button></div></> : null}
    </section> : null}
    <NativeGeoControls key={w.base} runId={selectedRun} onChanged={refresh} />
    {runs.data ? <section className="geo-section"><h2>{t("觀測紀錄", "Observation runs")}</h2>
      {!runs.data.items.length ? <p>{t("尚未觀測。每次執行都會新增紀錄。", "No observations yet. Each run creates a new record.")}</p> : <Field label={t("選擇觀測紀錄", "Choose an observation run")}><select value={selectedRun} onChange={v => setRunId(v.target.value)}>{runs.data.items.map(r => <option key={r.id} value={r.id}>{r.name} · {r.surface === "internal_api" ? "API" : t("人工樣本", "Manual sample")}</option>)}</select></Field>}
      <div className="row-actions"><button disabled={!runCursors.length} onClick={() => { setRunCursors(v => v.slice(0, -1)); setRunId(""); }}>{t("上一頁紀錄", "Previous runs")}</button><button disabled={!runs.data.next_cursor} onClick={() => { setRunCursors(v => [...v, runs.data!.next_cursor!]); setRunId(""); }}>{t("下一頁紀錄", "More runs")}</button></div>
      {detail.data ? <><div className="geo-run-heading"><div><span className="eyebrow">{detail.data.surface === "internal_api" ? (detail.data.effective_config?.execution_location === "desktop" ? "LOCAL CODEX · COMPANY API" : "CLOUD CODEX · COMPANY API") : "CONSUMER · USER SUPPLIED"}</span><h3>{detail.data.name}</h3><p><DateText value={detail.data.created_at} /> · {detail.data.progress.captured} / {detail.data.progress.total} {t("已保存回答", "answers captured")}</p></div>
      <div className="row-actions"><button className="button secondary" onClick={() => exportFile(root + "/runs/" + detail.data!.id + "/export", "geo-observation.json")}><Download size={15} />{t("下載原始觀測", "Download observation")}</button>{detail.data.surface === "internal_api" ? <><button className="button primary" disabled={busy || !writable} onClick={() => action(root + "/runs/" + detail.data!.id + "/capture", {})}>{t("保存已完成回答", "Capture completed answers")}</button><button className="button secondary" disabled={busy || !writable} onClick={() => action(root + "/runs/" + detail.data!.id + "/cancel", {})}>{t("取消未完成任務", "Cancel unfinished tasks")}</button></> : null}</div></div>
      <details><summary>{t("本次有效配置與來源", "Effective configuration and provenance")}</summary><pre>{JSON.stringify(detail.data.effective_config, null, 2)}</pre></details>
      <div className="geo-samples">{detail.data.questions.map(q => { const s = detail.data!.samples.find(s => s.question_key === q.key); return <article className="geo-sample" key={q.key}><div className="geo-sample-heading"><span className="eyebrow">{q.key}</span><span>{s?.state ?? t("未提供回答", "Answer not provided")}</span></div><h3>{q.text}</h3>
        <p className="muted">{s?.observed_at ? <DateText value={s.observed_at} /> : t("觀測時間尚未確定", "Observation time not yet known")}{s?.task_id ? <> · <Link to={"/app/tasks/" + s.task_id}>{t("查看任務與費用", "Task and cost receipt")}</Link></> : null}</p>
        {s?.analysis ? <><div className="geo-mentions">{s.analysis.mentions.map(m => <div key={m.brand}><strong>{m.brand}</strong><span>{m.matched ? t("回答中出現別名", "Alias present in answer") : t("此回答未出現別名", "No alias in this answer")}</span></div>)}</div><p className="muted">{t("僅為字面匹配，不等同推薦或排名。", "Literal matches do not establish recommendation or ranking.")}</p><code>{s.answer_sha256}</code><p>{s.analysis.links.length} {t("個回答內連結（未核實）", "answer links (unverified)")}</p>
        {s.asset_id && s.asset_version ? <div className="row-actions"><button className="button secondary" onClick={() => setAnswer({ run: detail.data!.id, question: q.key })}>{t("檢視原始回答", "View original answer")}</button><button className="button secondary" onClick={() => exportFile(w.base + "/assets/" + s.asset_id + "/download?version=" + s.asset_version, "geo-answer.txt")}>{t("下載完整回答", "Download full answer")}</button></div> : null}</> : <p>{t("未保存回答，出現次數及引用狀態未知。", "No captured answer; alias occurrence and links are unknown.")}</p>}
        {s?.confirmed_cost_micros !== null && s?.confirmed_cost_micros !== undefined ? <p>{t("已確認費用", "Confirmed charge")}: <Money value={s.confirmed_cost_micros} /></p> : s?.task_id ? <p>{s.cost_state === "requires_reconciliation" ? t("費用待核實，請查看任務賬單。", "Cost requires reconciliation. Review the task receipt.") : t("費用尚未結算。", "Cost is not yet settled.")}</p> : null}<ErrorNotice error={s?.error_code ? new Error(s.error_code) : null} /></article>; })}</div>
      <div className="row-actions"><button className="button secondary" onClick={() => setLeft(detail.data!)}>{t("設為比較 A", "Use as comparison A")}</button><button className="button secondary" onClick={() => setRight(detail.data!)}>{t("設為比較 B", "Use as comparison B")}</button></div></> : null}
    </section> : null}
    {left || right ? <section className="geo-section"><h2>{t("樣本比較", "Compare observations")}</h2><p>A: {left?.name ?? "—"} · B: {right?.name ?? "—"}</p><p className="muted">{t("可切換配置版本再選擇另一筆紀錄。API 與人工樣本不合併計算。", "Switch configuration versions to select another record. API and manual samples are not aggregated together.")}</p>
      {comparison.data ? <><h3>{comparison.data.comparison.same_configuration ? t("同配置的重複觀察", "Repeat observation with the same configuration") : t("配置不同，請分開解讀", "Different configurations; interpret separately")}</h3>
      {comparison.data.comparison.questions.map((q: any, i: number) => <div className="geo-comparison-question" key={i}><strong>{q.text}</strong><span>{q.answer_changed === null ? t("回答不完整，變化未知", "Incomplete answers; change unknown") : q.answer_changed ? t("原始回答有變化", "Original answer changed") : t("原始回答相同", "Original answers are identical")}</span></div>)}<button className="button secondary" onClick={() => exportFile(root + "/compare?left=" + left!.id + "&right=" + right!.id + "&download=json", "geo-observation-comparison.json")}><Download size={15} />{t("下載比較與原始回答", "Download comparison and original answers")}</button></> : null}
    </section> : null}
    {form === "new" || form === "version" ? <ExperimentForm key={form + (e?.id ?? "")} previous={form === "version" ? e : undefined} root={root} onClose={() => setForm(null)} onDone={id => { setExpCursors([]); setExpId(id); setRunId(""); setRunCursors([]); setForm(null); refresh(); }} /> : null}
    {form === "api" && e ? <ApiRunForm experiment={e} quota={experiments.data?.quota} root={root} onClose={() => setForm(null)} onDone={id => { setRunId(id); setRunCursors([]); setForm(null); refresh(); }} /> : null}
    {form === "manual" && e ? <ManualForm experiment={e} root={root} onClose={() => setForm(null)} onDone={id => { setRunId(id); setRunCursors([]); setForm(null); refresh(); }} /> : null}
    {form === "delete" && e ? <Modal title={t("永久刪除這個配置版本？", "Permanently delete this configuration version?")} onClose={() => setForm(null)}><p>{t("此版本下的觀測、任務回答與私有檔案將進入刪除流程，無法恢復。其他配置版本不受影響。", "Runs, task answers and private files under this version enter irreversible erasure. Other configuration versions are separate.")}</p><AsyncForm submitLabel={t("確認永久刪除", "Confirm permanent deletion")} onSubmit={async () => { await operation(root + "/content/" + e.id + "/delete", { kind: "experiment", expected_version: e.moderation_version }); setForm(null); setExpId(""); setRunId(""); refresh(); }}><label className="checkbox-row"><input type="checkbox" required />{t("我明白此操作無法恢復", "I understand this cannot be restored")}</label></AsyncForm></Modal> : null}
    {answer ? <AnswerView root={root} run={answer.run} question={answer.question} onClose={() => setAnswer(null)} /> : null}
  </div>;
}

function AnswerView({ root, run, question, onClose }: { root: string; run: string; question: string; onClose: () => void }) {
  const { t } = useI18n(), source = useData<any>(root + "/runs/" + run + "/export", 0, 10000);
  const sample = source.data?.samples.find((s: any) => s.question_key === question);
  return <Modal title={t("原始回答與來源", "Original answer and provenance")} onClose={onClose}>
    <ErrorNotice error={source.error} />{source.loading && !source.data ? <Loading /> : null}
    {sample ? <div className="geo-answer-preview"><p>{sample.question}</p><p className="muted">{source.data.surface === "internal_api" ? t("內部 API 樣本，檢索停用", "Internal API sample; retrieval disabled") : t("消費產品樣本，用戶提供，未經平台核實", "Consumer sample supplied by the user; not platform verified")}</p><code>{sample.answer_sha256}</code><pre>{sample.answer}</pre></div> : null}
  </Modal>;
}

function ExperimentForm({ previous, root, onClose, onDone }: { previous?: Experiment; root: string; onClose: () => void; onDone: (id: string) => void }) {
  const { t } = useI18n(), w = useWorkspace(), operation = useOperation(), agents = useData<any>(w.base + "/agents");
  const spec = previous?.body.spec;
  const [agentId, setAgentId] = useState(spec?.agent_id ?? "");
  return <Modal title={previous ? t("建立新配置版本", "Create configuration version") : t("建立固定問句集", "Create fixed question set")} onClose={onClose}><p>{t("所選 Agent 的指令和 skills 會固定保存；不載入歷史對話或專案記憶，業務工具及檢索停用。", "The selected Agent instructions and skills are pinned. No chat history or project memories are loaded; business tools and retrieval are disabled.")}</p><ErrorNotice error={agents.error} />
  <AsyncForm submitLabel={t("保存不可改寫的配置", "Save immutable configuration")} submitDisabled={!agents.data?.items.some((a: any) => !a.body.brand && a.enabled)} onSubmit={async f => {
    const questions = String(f.get("questions")).split(/\r?\n/).map(v => v.trim()).filter(Boolean).map((text, i) => ({ key: "q" + (i + 1), text }));
    const brands = String(f.get("brands")).split(/\r?\n/).map(v => v.trim()).filter(Boolean).map(line => { const [name, ...aliases] = line.split("|").map(v => v.trim()); return { name, aliases: aliases.filter(Boolean) }; });
    const r = await operation(root + "/experiments", { spec: { name: f.get("name"), agent_id: f.get("agent"), region: f.get("region"), language: f.get("language"), questions, brands }, ...(previous ? { previous_id: previous.id, expected_sha256: previous.sha256 } : {}) }); onDone(r.id);
  }}>
    <Field label={t("問句集名稱", "Question set name")}><input name="name" defaultValue={spec?.name} required maxLength={120} /></Field>
    <Field label={t("固定 Agent", "Pinned Agent")} hint={t("先在專業角色中建立未綁定品牌的 Agent。", "Create an Agent without an attached brand in Specialists first.")}><select name="agent" required value={agentId} onChange={event => setAgentId(event.target.value)}><option value="">{t("選擇 Agent", "Choose Agent")}</option>{agents.data?.items.filter((a: any) => !a.body.brand && a.enabled).map((a: any) => <option key={a.id} value={a.id}>{a.name} · v{a.version}</option>)}</select></Field>
    <div className="geo-form-pair"><Field label={t("請求地區", "Requested region")}><input name="region" required maxLength={120} defaultValue={spec?.region ?? "Hong Kong"} /></Field><Field label={t("回答語言", "Answer language")}><input name="language" required maxLength={120} defaultValue={spec?.language ?? "繁體中文"} /></Field></div>
    <Field label={t("固定問句（每行一題，最多 20 題）", "Fixed questions (one per line, up to 20)")}><textarea name="questions" rows={6} required maxLength={40020} defaultValue={spec?.questions.map(q => q.text).join("\n")} /></Field>
    <Field label={t("品牌與別名（品牌 | 別名 | 別名）", "Brands and aliases (Brand | alias | alias)")} hint={t("每行一個品牌，最多 10 個品牌、每品牌 5 個別名。別名不會加入提問。", "One brand per line; up to 10 brands and 5 aliases each. Aliases are not inserted into the question.")}><textarea name="brands" rows={4} required maxLength={8000} placeholder="CopyPaste | CopyPaste | copypaste.hk" defaultValue={spec?.brands.map(b => [b.name, ...b.aliases].join(" | ")).join("\n")} /></Field>
  </AsyncForm></Modal>;
}
function ApiRunForm({ experiment: e, quota, root, onClose, onDone }: { experiment: Experiment; quota?: Quota; root: string; onClose: () => void; onDone: (id: string) => void }) {
  const { t } = useI18n(), w = useWorkspace(), [amount, setAmount] = useState("0.10");
  let total: string | null = null; try { total = (BigInt(budgetMicros(amount)) * BigInt(e.body.spec.questions.length)).toString(); } catch { /* Form validation reports the precise error on submit. */ }
  return <Modal title={t("確認本機觀測與預算", "Review local observation and budget")} onClose={onClose}><p>{e.name} · v{e.version} · {e.body.harness.requested_model_alias}</p><p>{e.body.spec.questions.length} {t("個獨立本機 Codex 任務；準備後可逐題執行或停止。", "independent local Codex tasks; run or stop individual questions after preparation.")}</p><p>{t("每題佔用一個進行中任務名額。可用名額", "Each question uses one active task slot. Available slots")}: {quota?.available ?? "—"} / {quota?.max_active_tasks ?? "—"}</p>{quota && quota.available < e.body.spec.questions.length ? <p role="status">{t("名額不足。請先完成現有工作、另建較小問句集，或檢查目前方案。", "Insufficient slots. Finish existing work, save a smaller question set or review your current plan.")}</p> : null}<AsyncForm submitLabel={t("確認並準備本機觀測", "Confirm and prepare local observation")} submitDisabled={!quota || quota.available < e.body.spec.questions.length} onSubmit={async f => {
    const r = await window.copyPasteBridge!.localAgent("geo.prepare", { tenant: w.tenant, project: w.project, experiment: e.id, expected_sha256: e.sha256, name: f.get("name"), budget: budgetMicros(amount) });
    if (!r.ok) throw new Error(r.code ?? "GEO_LOCAL_RESERVATION_UNKNOWN");
    if (r.value) onDone(r.value.id);
  }}><Field label={t("本次觀測名稱", "Run name")}><input name="name" required maxLength={160} /></Field><Field label={t("每題預算（HKD）", "Per-question budget (HKD)")}><input inputMode="decimal" value={amount} onChange={v => setAmount(v.target.value)} required /></Field><p role="status">{t("總預留上限", "Total reservation limit")}: {total === null ? "—" : <Money value={total} />}</p><label className="checkbox-row"><input type="checkbox" required />{t("確認配置、題目及費用上限", "I reviewed the configuration, questions and cost limit")}</label></AsyncForm></Modal>;
}
function ManualForm({ experiment: e, root, onClose, onDone }: { experiment: Experiment; root: string; onClose: () => void; onDone: (id: string) => void }) {
  const { t } = useI18n(), operation = useOperation();
  return <Modal title={t("錄入消費產品原始樣本", "Record an original consumer sample")} onClose={onClose}><p>{t("請粘貼實際回答。產品、模型、地區、檢索狀態與時間均標為用戶提供；不調用 AI，不產生模型費用。", "Paste the actual answer. Product, model, region, retrieval status and time are user supplied. This does not call AI or incur model usage.")}</p><AsyncForm submitLabel={t("保存人工樣本", "Save manual sample")} onSubmit={async f => {
    const r = await operation(root + "/experiments/" + e.id + "/manual", { name: f.get("name"), product: f.get("product"), reported_model: String(f.get("model") ?? "").trim() || null,
      region: f.get("region"), language: f.get("language"), retrieval: f.get("retrieval"), observed_at: new Date(String(f.get("observed"))).toISOString(), attested: true,
      samples: [{ question_key: f.get("question"), answer: f.get("answer") }] }); onDone(r.id);
  }}><Field label={t("樣本名稱", "Sample name")}><input name="name" required maxLength={120} /></Field><div className="geo-form-pair"><Field label={t("消費產品", "Consumer product")}><input name="product" required maxLength={120} placeholder="ChatGPT / Grok / …" /></Field><Field label={t("顯示的模型（不確定可留空）", "Displayed model (blank if unknown)")}><input name="model" maxLength={120} /></Field></div>
  <div className="geo-form-pair"><Field label={t("實際使用地區", "Observed region")}><input name="region" required maxLength={120} defaultValue={e.body.spec.region} /></Field><Field label={t("回答語言", "Answer language")}><input name="language" required maxLength={120} defaultValue={e.body.spec.language} /></Field></div>
  <Field label={t("檢索狀態", "Retrieval status")}><select name="retrieval" defaultValue="unknown"><option value="unknown">{t("未知", "Unknown")}</option><option value="enabled">{t("已啟用", "Enabled")}</option><option value="disabled">{t("已停用", "Disabled")}</option></select></Field><Field label={t("觀察時間（本機時區）", "Observation time (local timezone)")}><input name="observed" type="datetime-local" required /></Field>
  <Field label={t("對應固定問句", "Fixed question")}><select name="question">{e.body.spec.questions.map(q => <option key={q.key} value={q.key}>{q.text}</option>)}</select></Field><Field label={t("完整原始回答", "Complete original answer")}><textarea name="answer" rows={8} required maxLength={100000} /></Field><label className="checkbox-row"><input type="checkbox" required />{t("確認這是我實際觀察到的原始回答與配置", "I confirm this is the original answer and configuration I observed")}</label></AsyncForm></Modal>;
}
