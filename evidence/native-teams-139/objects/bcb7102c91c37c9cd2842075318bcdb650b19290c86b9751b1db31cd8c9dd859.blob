import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, RotateCcw, Monitor } from "lucide-react";
import { useWorkspace } from "./context";
import { post } from "./api";
import { ErrorNotice, useI18n } from "./ui";
import { operationKey, completeOperation } from "./operation-key";

type LocalSample = { id: string; geo: { questionKey: string; runId?: string }; phase: string; retryable: boolean;
  busy: boolean; uncertain: boolean; revoked: boolean; error?: string; task?: { status: string; state: string };
  messages: { role: string; text: string }[] };
async function local(action: string, payload: unknown) {
  const r = await window.copyPasteBridge!.localAgent(action, payload);
  if (!r.ok) throw new Error(r.code ?? "LOCAL_COMPANY_API_UNAVAILABLE");
  return r.value;
}

export function NativeGeoControls({ runId, onChanged }: { runId: string; onChanged: () => void }) {
  const w = useWorkspace(), { t } = useI18n(), [rows, setRows] = useState<LocalSample[]>([]), [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false), stop = useRef(false), alive = useRef(true), changing = useRef(false), changed = useRef(onChanged);
  changed.current = onChanged;
  const load = useCallback(async () => {
    const result = await local("geo.list", { tenant: w.tenant, project: w.project });
    if (alive.current) setRows(result.sessions);
    return result.sessions as LocalSample[];
  }, [w.tenant, w.project]);
  useEffect(() => {
    alive.current = true; let timer: ReturnType<typeof setTimeout> | undefined;
    void load().catch(e => { if (alive.current) setError(e); });
    const off = window.copyPasteBridge!.onLocalAgentChanged(() => {
      if (!timer) timer = setTimeout(() => { timer = undefined; void load().catch(e => { if (alive.current) setError(e); }); }, 250);
    });
    return () => { alive.current = false; stop.current = true; off(); if (timer) clearTimeout(timer); };
  }, [load]);
  useEffect(() => { stop.current = true; }, [runId]);
  const shown = rows.filter(r => r.geo.runId === runId || (!r.geo.runId && r.retryable));
  const runRows = rows.filter(r => r.geo.runId === runId);
  if (!shown.length && !error) return null;
  async function capture(id: string) {
    const path = w.base + "/geo/runs/" + id + "/capture", body = {}, key = await operationKey(w.me.user.id, path, body);
    await post(path, body, key); await completeOperation(w.me.user.id, path, body);
  }
  async function execute(selected: LocalSample[]) {
    if (changing.current) return;
    changing.current = true; stop.current = false; setBusy(true); setError(null);
    try {
      for (const item of selected) {
        if (stop.current || !alive.current) break;
        const current = (await load()).find(r => r.id === item.id);
        if (stop.current || !alive.current) break;
        if (!current || !current.retryable || current.busy || (current.phase !== "settling" && (current.revoked || current.uncertain))) break;
        const receipt = await local("retry", { id: item.id });
        if (receipt.uncertain || receipt.error || receipt.task?.status !== "succeeded") break;
        if (receipt.geo?.runId) await capture(receipt.geo.runId);
        changed.current();
      }
    } catch (e) { if (alive.current) setError(e as Error); }
    finally { changing.current = false; if (alive.current) { setBusy(false); void load().catch(e => setError(e)); changed.current(); } }
  }
  async function cancel(selected: LocalSample[]) {
    stop.current = true;
    try { await Promise.all(selected.map(r => local("stop", { id: r.id }))); await load(); changed.current(); }
    catch (e) { if (alive.current) setError(e as Error); }
  }
  return <section className="geo-section native-geo" aria-label={t("本機觀測執行", "Local observation execution")}>
    <div className="geo-run-heading"><div><span className="eyebrow"><Monitor size={14} /> CODEX ON THIS COMPUTER</span><h2>{t("逐題本機執行", "Run questions locally")}</h2>
      <p className="muted">{t("每題使用獨立空白會話。已接受的未知結果只核對回執；重新觀測請建立新紀錄。", "Every question uses a fresh empty session. Unknown accepted outcomes require receipt recovery; repeat observations create new runs.")}</p></div>
      <div className="row-actions"><button className="button primary" disabled={busy || !runRows.some(r => r.retryable && r.phase === "starting" && !r.busy && !r.revoked && !r.uncertain)} onClick={() => void execute(runRows.filter(r => r.phase === "starting"))}><Play size={15} />{t("依次執行未開始問句", "Run remaining questions")}</button>
        <button className="button secondary" disabled={!runRows.some(r => r.busy || r.retryable)} onClick={() => void cancel(runRows.filter(r => r.busy || r.retryable))}><Square size={15} />{t("停止本次觀測", "Stop this run")}</button></div></div>
    <ErrorNotice error={error} />
    <div className="native-geo-progress" role="status" aria-live="polite">{runRows.filter(r => r.task?.status === "succeeded").length} / {runRows.length} {t("本機問句已完成", "local questions completed")}{busy ? " · " + t("執行中", "Running") : ""}</div>
    <div className="native-geo-list">{shown.map(r => <article className="native-geo-question" key={r.id}><div><span className="eyebrow">{r.geo.questionKey}</span><h3>{r.messages.find(m => m.role === "user")?.text}</h3><p role="status">{r.busy ? t("本機執行中", "Running locally") : r.uncertain ? t("結果未知，等待費用核對", "Unknown outcome; reconciliation required") : r.task?.status === "succeeded" ? t("已完成", "Completed") : r.phase === "starting" ? t("已預留，尚未開始", "Reserved; not started") : r.task?.status ?? r.phase}</p>{r.error ? <p className="muted">{r.error}</p> : null}{r.task?.status === "failed" ? <p className="notice" role="alert">{t("本次未取得回答。請查看任務費用，檢查預算及模型設定，再建立新觀測。", "No answer was captured. Review the task receipt, budget and model settings, then create a new observation.")}</p> : null}</div><div className="row-actions">
      {r.retryable && (!r.uncertain || r.phase === "settling") ? <button className="button secondary" disabled={busy || r.busy || (r.revoked && r.phase !== "settling")} onClick={() => void execute([r])}>{r.phase === "settling" || r.phase === "accepting" ? <RotateCcw size={14} /> : <Play size={14} />}{r.phase === "settling" ? t("核對原回執", "Recover receipt") : r.phase === "accepting" ? t("核對預留並執行", "Recover reservation and run") : t("執行此題", "Run question")}</button> : null}
      {r.busy || r.retryable ? <button className="button secondary" onClick={() => void cancel([r])}>{t("停止", "Stop")}</button> : null}</div></article>)}</div>
  </section>;
}
