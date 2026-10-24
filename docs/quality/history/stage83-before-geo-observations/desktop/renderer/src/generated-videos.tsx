import { useEffect, useRef, useState } from "react";
import { Download, Film, Play, RefreshCw, Square, X } from "lucide-react";
import { api, download, post } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Money, useData, useI18n } from "./ui";
import "./generated-videos.css";

interface VideoJob {
  id: string; task_id: string; revision: number; state: string; progress: number | null;
  size: string; seconds: number; usage_state: string; quoted_micros: string; actual_micros: string | null;
  cancel_requested: boolean; delivery_state: string; budget_violation: boolean;
  assets: { id: string; name: string; version: number; sha256: string }[];
}
const names: Record<string, [string, string]> = {
  prepared: ["準備生成", "Preparing"], submitting: ["正在提交", "Submitting"], queued: ["等候生成", "Queued"],
  in_progress: ["影片生成中", "Generating video"], completed: ["生成已完成", "Generation completed"],
  failed: ["未能生成", "Generation failed"], cancelled: ["已取消", "Cancelled"], unknown: ["正在核對狀態", "Checking outcome"],
};

function VideoPreview({ base, job }: { base: string; job: VideoJob }) {
  const { t } = useI18n(), [url, setURL] = useState(""), [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const abort = new AbortController(); let ownedURL: string | undefined;
    setURL(""); setError(null);
    void (async () => {
      const result = await api<{ content_type: string; base64: string; sha256: string; bytes: number }>(`${base}/generated-video-jobs/${job.id}/preview`, { signal: abort.signal });
      if (abort.signal.aborted) return;
      if (result.content_type !== "video/mp4" || result.bytes > 20_000_000 || result.sha256 !== job.assets[0]?.sha256) throw new Error("VIDEO_PREVIEW_UNAVAILABLE");
      const raw = atob(result.base64), bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
      if (abort.signal.aborted) return;
      if (bytes.length !== result.bytes || digest !== result.sha256) throw new Error("VIDEO_PREVIEW_UNAVAILABLE");
      ownedURL = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" })); setURL(ownedURL);
    })().catch(failure => { if (!abort.signal.aborted) setError(failure); });
    return () => { abort.abort(); if (ownedURL) URL.revokeObjectURL(ownedURL); };
  }, [base, job.id, job.assets[0]?.sha256]);
  return <div className="generated-video-preview"><ErrorNotice error={error} />
    {url ? <video src={url} controls playsInline preload="metadata" aria-label={t("生成式影片預覽", "Generated video preview")} />
      : !error && <p role="status">{t("正在載入影片…", "Loading video…")}</p>}</div>;
}

export function GeneratedVideos({ base, taskId }: { base: string; taskId: string }) {
  const w = useWorkspace(), { t } = useI18n(), [revision, setRevision] = useState(0), [cursor, setCursor] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<unknown>(null);
  const cancelIntent = useRef<{ job: string; revision: number; key: string } | null>(null);
  const query = new URLSearchParams({ task_id: taskId, limit: "20", ...(cursor ? { cursor } : {}) });
  const result = useData<{ items: VideoJob[]; next_cursor: string | null }>(`${base}/generated-video-jobs?${query}`, revision, 5000);
  const items = result.data?.items ?? [];
  const cancel = async (job: VideoJob) => {
    setBusy(job.id); setError(null);
    if (cancelIntent.current?.job !== job.id || cancelIntent.current.revision !== job.revision)
      cancelIntent.current = { job: job.id, revision: job.revision, key: crypto.randomUUID() };
    try {
      await post(`${base}/generated-video-jobs/${job.id}/cancel`, { expected_revision: cancelIntent.current.revision }, cancelIntent.current.key);
      cancelIntent.current = null;
    } catch (failure) { setError(failure); }
    finally { setBusy(null); setRevision(value => value + 1); }
  };
  if (!items.length && !result.error && !error) return null;
  return <section className="generated-videos" aria-label={t("生成式影片", "Generated videos")}>
    <div className="generated-videos-heading"><span className="eyebrow">MOTION, MADE.</span><h3>{t("你的生成式影片", "Your generated videos")}</h3>
      <button className="text-button" aria-label={t("重新整理生成式影片", "Refresh generated videos")} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /></button></div>
    <ErrorNotice error={result.error ?? error} />
    {items.map(job => <article className="generated-video-card" key={job.id} data-generated-video-job={job.id}>
      <header><span className="generated-video-icon"><Film size={20} /></span><div><strong>{t("生成式影片", "Generated video")}</strong><p>{job.seconds} {t("秒", "seconds")} · {job.size.replace("x", " × ")}</p></div>
        <span className="badge" role="status">{t(...(names[job.state] ?? [job.state, job.state]))}</span></header>
      {job.progress !== null && <div className="generated-video-progress"><progress max={100} value={job.progress} aria-label={t("服務回報的生成進度", "Service-reported generation progress")} /><span>{job.progress}%</span></div>}
      <dl><div><dt>{t("估算上限", "Quote limit")}</dt><dd><Money value={job.quoted_micros} /></dd></div>
        <div><dt>{t("已確認費用", "Confirmed cost")}</dt><dd>{job.actual_micros === null ? t("待確認", "Awaiting confirmation") : <Money value={job.actual_micros} />}</dd></div></dl>
      {job.actual_micros === null && <p className="muted">{t("費用尚未確認，原工作預留會保留。", "The original task hold remains while cost is unconfirmed.")}</p>}
      {job.delivery_state === "pending" && job.state === "completed" && <p role="status">{t("正在檢查實際影片，檢查完成後即可預覽及下載。", "Checking the actual video. Preview and download will be available when checks finish.")}</p>}
      {["blocked", "invalid", "unavailable"].includes(job.delivery_state) && <p className="notice">{job.budget_violation
        ? t("費用超過原估算，交付已停止並等待核對。", "Cost exceeded the quote. Delivery has stopped pending review.")
        : t("這次作業目前無法交付影片。請檢查原工作、素材及權限。", "This job cannot currently deliver a video. Check the original task, sources and permissions.")}</p>}
      {job.cancel_requested && <p className="muted">{t("已要求停止；取消不代表沒有產生費用。", "Stop requested. Cancellation does not confirm zero cost.")}</p>}
      <div className="generated-video-actions">
        {!job.cancel_requested && !["completed", "failed", "cancelled"].includes(job.state) && <button className="button" disabled={busy !== null} onClick={() => void cancel(job)}><Square size={14} />{t("停止這次生成", "Stop this generation")}</button>}
        {job.delivery_state === "available" && job.assets.length > 0 && <>
          <button className="button" onClick={() => setPreview(value => value === job.id ? null : job.id)}>{preview === job.id ? <X size={14} /> : <Play size={14} />}{preview === job.id ? t("關閉預覽", "Close preview") : t("播放影片", "Play video")}</button>
          {job.assets.map(asset => <button className="button primary" key={asset.id} disabled={busy !== null} onClick={() => {
            setBusy(job.id); void download(`${base}/assets/${asset.id}/download?version=${asset.version}`, asset.name, w.tenant).catch(setError).finally(() => setBusy(null));
          }}><Download size={14} />{t("下載影片", "Download video")}</button>)}
        </>}
      </div>
      {preview === job.id && job.delivery_state === "available" && <VideoPreview base={base} job={job} />}
    </article>)}
    {(cursor || result.data?.next_cursor) && <div className="generated-video-actions">
      {cursor && <button className="button" onClick={() => { setCursor(null); setPreview(null); }}>{t("回到最新作業", "Back to latest jobs")}</button>}
      {result.data?.next_cursor && <button className="button" onClick={() => { setCursor(result.data!.next_cursor); setPreview(null); }}>{t("較早作業", "Earlier jobs")}</button>}
    </div>}
  </section>;
}
