import { useEffect, useRef, useState } from "react";
import { Download, FileAudio, Mic2, Play, RefreshCw, Save, Square, X } from "lucide-react";
import { api, download, post } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Money, useData, useI18n } from "./ui";
import "./audio-production.css";

interface AudioAsset { id: string; name: string; version: number; revision: number; kind: string; sha256: string }
interface AudioJob { id: string; task_id: string; kind: string; state: string; revision: number; subtitle_revision: number;
  quoted_micros: string; actual_micros: string | null; duration_ms: number | null; cancel_requested: boolean;
  delivery_state: string; assets: AudioAsset[] }
interface Cue { start_ms: number; end_ms: number; text: string }
interface Transcript { text: string; cues: Cue[]; timing_source: string; duration_ms: number; revision: number }
const states: Record<string, [string, string]> = { prepared: ["準備音訊", "Preparing audio"], dispatched: ["正在處理", "Processing"],
  completed: ["處理完成", "Completed"], cancelled: ["已停止", "Stopped"], unknown: ["結果與費用待核對", "Outcome and cost unconfirmed"] };

function AudioPreview({ base, job }: { base: string; job: AudioJob }) {
  const { t } = useI18n(), [url, setURL] = useState(""), [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const abort = new AbortController(); let owned: string | undefined; setURL(""); setError(null);
    void api<{ content_type: string; base64: string; bytes: number; sha256: string }>(`${base}/audio-jobs/${job.id}/preview?kind=audio`, { signal: abort.signal })
      .then(async result => {
        if (abort.signal.aborted) return;
        const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0));
        const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
        if (abort.signal.aborted) return;
        if (result.content_type !== "audio/wav" || bytes.length !== result.bytes || bytes.length > 25_000_000 || digest !== result.sha256
          || digest !== job.assets.find(a => a.kind === "audio")?.sha256) throw new Error("AUDIO_PREVIEW_UNAVAILABLE");
        owned = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })); setURL(owned);
      }).catch(failure => { if (!abort.signal.aborted) setError(failure); });
    return () => { abort.abort(); if (owned) URL.revokeObjectURL(owned); };
  }, [base, job.id, job.assets.find(a => a.kind === "audio")?.sha256]);
  return <div className="audio-preview"><ErrorNotice error={error} />{url
    ? <audio controls preload="metadata" src={url} aria-label={t("AI 配音預覽", "AI speech preview")} />
    : !error && <p role="status">{t("正在載入音訊…", "Loading audio…")}</p>}</div>;
}

function TranscriptEditor({ base, job, onSaved }: { base: string; job: AudioJob; onSaved: () => void }) {
  const { t } = useI18n(), [version, setVersion] = useState(job.subtitle_revision), [doc, setDoc] = useState<Transcript | null>(null);
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [text, setText] = useState(""), [reason, setReason] = useState(""), [cues, setCues] = useState<{ start: string; end: string; text: string }[]>([]);
  const [editRevision, setEditRevision] = useState(job.revision);
  const intent = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController(); setDoc(null); setEditing(false); setError(null);
    void api<{ document: Transcript }>(`${base}/audio-jobs/${job.id}/preview?kind=transcript&revision=${version}`, { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) { setDoc(result.document); setText(result.document.text);
        setCues(result.document.cues.map(c => ({ start: String(c.start_ms / 1000), end: String(c.end_ms / 1000), text: c.text }))); } })
      .catch(failure => { if (!abort.signal.aborted) setError(failure); });
    return () => abort.abort();
  }, [base, job.id, version]);
  const patch = (index: number, field: "start" | "end" | "text", value: string) => setCues(rows => rows.map((row, i) => i === index ? { ...row, [field]: value } : row));
  return <div className="audio-transcript">
    <label className="field">{t("字幕版本", "Transcript version")}<select value={version} disabled={editing || busy} onChange={e => setVersion(Number(e.target.value))}>
      {job.assets.filter(a => a.kind === "transcript").map(a => <option key={a.revision} value={a.revision}>v{a.revision}</option>)}
    </select></label>
    <ErrorNotice error={error} />
    {doc && !editing && <><p className="audio-transcript-text">{doc.text || t("這段音訊沒有辨識到文字。", "No speech text was recognized.")}</p>
      <p className="muted">{doc.timing_source === "none" ? t("只有文字，未產生時間軸。", "Text only; no subtitle timing was generated.")
        : doc.timing_source === "customer_manual_revision" ? t("時間由客戶手動修訂。", "Timing was manually revised by the customer.")
          : t("時間來自轉寫服務的實際分段。", "Timing comes from actual transcription service segments.")}</p>
      {version === job.subtitle_revision && <button className="button secondary" onClick={() => {
        setEditRevision(job.revision); setReason(""); intent.current = null;
        setText(doc.text); setCues(doc.cues.map(c => ({ start: String(c.start_ms / 1000), end: String(c.end_ms / 1000), text: c.text }))); setEditing(true);
      }}>{t("修訂字幕", "Revise subtitles")}</button>}</>}
    {doc && editing && <form className="audio-subtitle-form" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(null);
      try {
        const parsed = cues.map(c => ({ start_ms: Math.round(Number(c.start) * 1000), end_ms: Math.round(Number(c.end) * 1000), text: c.text }));
        const body = { expected_revision: editRevision, text: cues.length ? cues.map(c => c.text).join("\n") : text, cues: parsed, reason };
        const frozen = JSON.stringify(body);
        if (intent.current?.body !== frozen) intent.current = { body: frozen, key: crypto.randomUUID() };
        const saved = await post(`${base}/audio-jobs/${job.id}/subtitles`, body, intent.current.key) as AudioJob;
        intent.current = null; setEditing(false); setVersion(saved.subtitle_revision); onSaved();
      } catch (failure) { setError((failure as any)?.code === "AUDIO_REVISION_CONFLICT"
        ? new Error(t("已有較新的字幕版本。你的修訂仍在；取消後選取最新版本再修訂。", "A newer subtitle version exists. Your edits are retained; cancel, select the latest version and revise again.")) : failure); } finally { setBusy(false); }
    }}>
      <p className="muted">{t("原音軌與原始轉寫會保留。此次修訂不會呼叫 AI 或新增生成費用。", "Original audio and transcription are retained. This revision makes no AI request or new generation charge.")}</p>
      {!cues.length && <label className="field">{t("完整文字", "Full transcript")}<textarea disabled={busy} value={text} maxLength={200000} onChange={e => setText(e.target.value)} rows={5} /></label>}
      {cues.map((cue, i) => <fieldset className="audio-cue" key={i} disabled={busy}><legend>{t("字幕", "Caption")} {i + 1}</legend>
        <div className="audio-time-fields"><label className="field">{t("開始（秒）", "Start (seconds)")}<input type="number" min="0" max={doc.duration_ms / 1000} step="0.001" value={cue.start} required onChange={e => patch(i, "start", e.target.value)} /></label>
          <label className="field">{t("結束（秒）", "End (seconds)")}<input type="number" min="0.001" max={doc.duration_ms / 1000} step="0.001" value={cue.end} required onChange={e => patch(i, "end", e.target.value)} /></label></div>
        <label className="field">{t("文字", "Text")}<textarea value={cue.text} required maxLength={4000} rows={2} onChange={e => patch(i, "text", e.target.value)} /></label>
        <button type="button" className="text-button" disabled={busy} onClick={() => { if (cues.length === 1) setText(cues[0].text); setCues(rows => rows.filter((_, n) => n !== i)); }}>{t("移除此段", "Remove caption")}</button>
      </fieldset>)}
      <button type="button" className="button secondary" disabled={busy || cues.length >= 2000} onClick={() => setCues(rows => [...rows, { start: "", end: "", text: rows.length ? "" : text }])}>{t("手動新增時間段", "Add manual timing")}</button>
      <label className="field">{t("修訂原因", "Revision reason")}<textarea disabled={busy} value={reason} minLength={3} maxLength={1000} required rows={2} onChange={e => setReason(e.target.value)} /></label>
      <div className="audio-actions"><button className="button primary" disabled={busy}><Save size={16} />{busy ? t("正在儲存…", "Saving…") : t("儲存新版本", "Save new version")}</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => { setEditing(false); setError(null); }}>{t("取消修訂", "Cancel revision")}</button></div>
    </form>}
  </div>;
}

export function AudioProductions({ base, taskId }: { base: string; taskId: string }) {
  const w = useWorkspace(), { t } = useI18n(), [refresh, setRefresh] = useState(0), [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState<string | null>(null);
  const cancelIntent = useRef<{ job: string; revision: number; key: string } | null>(null);
  const query = new URLSearchParams({ task_id: taskId, limit: "20", ...(cursor ? { cursor } : {}) });
  const result = useData<{ items: AudioJob[]; next_cursor: string | null }>(`${base}/audio-jobs?${query}`, refresh, 5000);
  if (!result.data?.items.length && !result.error && !error) return null;
  return <section className="audio-productions" aria-label={t("配音與字幕", "Speech and subtitles")}>
    <header className="audio-heading"><span className="eyebrow">WORDS, WITH A VOICE.</span><h3>{t("配音與字幕", "Speech and subtitles")}</h3>
      <button className="text-button" aria-label={t("重新整理音訊", "Refresh audio")} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={16} /></button></header>
    <ErrorNotice error={result.error ?? error} />
    {result.data?.items.map(job => <article className="audio-card" key={job.id} data-audio-job={job.id}>
      <header><span className="audio-icon">{job.kind === "speech" ? <Mic2 size={20} /> : <FileAudio size={20} />}</span><div><strong>{job.kind === "speech" ? t("AI 配音", "AI speech") : t("音訊轉寫與字幕", "Transcription and subtitles")}</strong>
        <p>{job.duration_ms ? `${job.duration_ms / 1000} ${t("秒", "seconds")}` : t("尚無已確認音訊", "Audio not yet confirmed")}</p></div><span className="badge" role="status">{t(...(states[job.state] ?? [job.state, job.state]))}</span></header>
      <dl><div><dt>{t("公司收費上限", "Company tariff limit")}</dt><dd><Money value={job.quoted_micros} /></dd></div>
        <div><dt>{t("已確認公司費用", "Confirmed company charge")}</dt><dd>{job.actual_micros === null ? t("待確認", "Unconfirmed") : <Money value={job.actual_micros} />}</dd></div></dl>
      {job.actual_micros === null && <p className="muted">{t("原任務預留會保留，請勿重新提交未知的作業。", "The original task hold remains. Do not resubmit an unknown operation.")}</p>}
      {job.delivery_state === "blocked" && <p className="notice">{t("交付已停止，請核對原任務、來源與權限。", "Delivery stopped. Review the original task, source and permissions.")}</p>}
      <div className="audio-actions">
        {job.delivery_state === "available" && job.assets.length > 0 && <button className="button secondary" onClick={() => setOpen(open === job.id ? null : job.id)}>{open === job.id ? <X size={16} /> : <Play size={16} />}{open === job.id ? t("收起內容", "Close preview") : t("查看音訊與字幕", "Review audio and subtitles")}</button>}
        {!job.cancel_requested && !["completed", "cancelled"].includes(job.state) && <button className="button secondary" disabled={busy === job.id} onClick={async () => {
          setBusy(job.id); setError(null);
          if (cancelIntent.current?.job !== job.id || cancelIntent.current.revision !== job.revision) cancelIntent.current = { job: job.id, revision: job.revision, key: crypto.randomUUID() };
          try { await post(`${base}/audio-jobs/${job.id}/cancel`, { expected_revision: cancelIntent.current.revision }, cancelIntent.current.key); cancelIntent.current = null; }
          catch (failure) { setError(failure); } finally { setBusy(null); setRefresh(v => v + 1); }
        }}><Square size={14} />{t("要求停止", "Request stop")}</button>}
      </div>
      {open === job.id && job.delivery_state === "available" && job.assets.length > 0 && <div className="audio-review">{job.kind === "speech" ? <AudioPreview base={base} job={job} />
        : <TranscriptEditor key={job.id} base={base} job={job} onSaved={() => setRefresh(v => v + 1)} />}
        <div className="audio-downloads">{job.assets.map(asset => <button key={asset.id + ":" + asset.version} className="text-button" onClick={() => {
          void download(`${base}/assets/${asset.id}/download?version=${asset.version}`, asset.name, w.tenant).catch(setError);
        }}><Download size={14} />{asset.kind === "audio" ? t("AI 配音 WAV", "AI speech WAV") : `${asset.kind.toUpperCase()} · v${asset.revision}`}</button>)}</div>
      </div>}
    </article>)}
    {(cursor || result.data?.next_cursor) && <div className="audio-actions"><button className="button secondary" disabled={!cursor} onClick={() => setCursor(null)}>{t("回到最新", "Back to latest")}</button>
      <button className="button secondary" disabled={!result.data?.next_cursor} onClick={() => setCursor(result.data!.next_cursor)}>{t("載入更早作業", "Load older jobs")}</button></div>}
  </section>;
}
