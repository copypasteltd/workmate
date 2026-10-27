import { exactHKD } from "./financial-notice.js";

type IO = {
  base: string; taskId: string; live: () => boolean; tr: (zh: string, en: string) => string;
  request: (path: string, method?: string, body?: unknown, key?: string) => Promise<any>;
};
/** Cloud job review only. This module never executes a local Agent or submits generation. */
export function mountGeneratedVideos(container: HTMLElement, io: IO) {
  let disposed = false, loading = false, pending = false, signature = "", cursor: string | null = null;
  const previews = new Map<string, string>(), attempts = new Map<string, { revision: number; key: string }>();
  const active = () => !disposed && io.live();
  const make = (tag: string, text?: string) => { const e = document.createElement(tag); if (text) e.textContent = text; return e; };
  const clearPreviews = () => { for (const url of previews.values()) URL.revokeObjectURL(url); previews.clear(); };
  const states: Record<string, [string, string]> = { prepared: ["準備生成", "Preparing"], submitting: ["正在提交", "Submitting"], queued: ["等候生成", "Queued"], in_progress: ["影片生成中", "Generating video"], completed: ["生成已完成", "Generation completed"], failed: ["未能生成", "Generation failed"], cancelled: ["已取消", "Cancelled"], unknown: ["正在核對狀態", "Checking outcome"] };
  const load = async () => {
    if (loading || pending || !active()) return; loading = true;
    try {
      const query = new URLSearchParams({ task_id: io.taskId, limit: "10", ...(cursor ? { cursor } : {}) });
      const data = await io.request(io.base + "/generated-video-jobs?" + query);
      if (!active()) return;
      const nextSignature = JSON.stringify(data);
      if (nextSignature === signature) return; signature = nextSignature;
      clearPreviews(); container.replaceChildren();
      if (!data.items.length && !cursor) return;
      container.append(make("h3", io.tr("生成式影片", "Generated videos")));
      for (const job of data.items) {
        const card = make("article"); card.className = "generated-video-card"; card.dataset.generatedVideoJob = job.id;
        card.append(make("strong", states[job.state] ? io.tr(...states[job.state]) : job.state),
          make("p", `${job.seconds} ${io.tr("秒", "seconds")} · ${job.size.replace("x", " × ")}`));
        if (job.progress !== null) { const progress = document.createElement("progress"); progress.max = 100; progress.value = job.progress; progress.ariaLabel = io.tr("服務回報的生成進度", "Service-reported generation progress"); card.append(progress, make("small", job.progress + "%")); }
        card.append(make("p", io.tr("估算上限：", "Quote limit: ") + exactHKD(job.quoted_micros)),
          make("p", io.tr("已確認費用：", "Confirmed cost: ") + (job.actual_micros === null ? io.tr("待確認；原預留保留", "Pending; original hold retained") : exactHKD(job.actual_micros))));
        if (job.cancel_requested) card.append(make("p", io.tr("已要求停止；取消不代表沒有產生費用。", "Stop requested. Cancellation does not confirm zero cost.")));
        if (!job.cancel_requested && !["completed", "failed", "cancelled"].includes(job.state)) {
          const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "secondary"; cancel.textContent = io.tr("停止這次生成", "Stop this generation");
          cancel.addEventListener("click", () => { if (pending || !active()) return; pending = true; cancel.disabled = true;
            if (attempts.get(job.id)?.revision !== job.revision) attempts.set(job.id, { revision: job.revision, key: crypto.randomUUID() });
            const attempt = attempts.get(job.id)!;
            void io.request(io.base + "/generated-video-jobs/" + job.id + "/cancel", "POST", { expected_revision: attempt.revision }, attempt.key)
              .then(() => { attempts.delete(job.id); signature = ""; }).catch(error => { if (active()) { const alert = make("p", (error as Error).message); alert.setAttribute("role", "alert"); card.append(alert); } })
              .finally(() => { pending = false; if (active()) { cancel.disabled = false; void load(); } });
          }); card.append(cancel);
        }
        if (["blocked", "invalid", "unavailable"].includes(job.delivery_state)) card.append(make("p", job.budget_violation
          ? io.tr("費用超過原估算，交付已停止並等待核對。", "Cost exceeded the quote. Delivery stopped pending review.")
          : io.tr("目前無法交付。請檢查原工作、素材及權限。", "Delivery is unavailable. Check the original task, sources and permissions.")));
        if (job.state === "completed" && job.delivery_state === "pending") card.append(make("p", io.tr("正在檢查實際影片。", "Checking the actual video.")));
        if (job.delivery_state === "available" && job.assets.length) {
          const asset = job.assets[0], preview = document.createElement("button"), area = make("div"); preview.type = "button"; preview.className = "secondary";
          preview.textContent = io.tr("播放及儲存影片", "Play and save video");
          preview.addEventListener("click", () => { if (previews.has(job.id) || preview.disabled) return; preview.disabled = true;
            void (async () => {
              const content = await io.request(io.base + "/generated-video-jobs/" + job.id + "/preview");
              if (!active() || !card.isConnected) return;
              if (content.content_type !== "video/mp4" || content.bytes > 20_000_000 || content.sha256 !== asset.sha256) throw new Error("VIDEO_PREVIEW_UNAVAILABLE");
              const bytes = Uint8Array.from(atob(content.base64), char => char.charCodeAt(0));
              const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
              if (!active() || !card.isConnected) return;
              if (bytes.length !== content.bytes || digest !== content.sha256) throw new Error("VIDEO_PREVIEW_UNAVAILABLE");
              const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" })); previews.set(job.id, url);
              const video = document.createElement("video"); video.controls = true; video.playsInline = true; video.preload = "metadata"; video.src = url;
              video.ariaLabel = io.tr("生成式影片預覽", "Generated video preview");
              const save = document.createElement("a"); save.href = url; save.download = asset.name; save.textContent = io.tr("儲存影片", "Save video");
              area.replaceChildren(video, save);
            })().catch(error => { if (active() && card.isConnected) { area.textContent = (error as Error).message; area.setAttribute("role", "alert"); preview.disabled = false; } });
          }); card.append(preview, area);
        }
        container.append(card);
      }
      if (cursor) { const latest = document.createElement("button"); latest.type = "button"; latest.className = "secondary"; latest.textContent = io.tr("回到最新作業", "Back to latest jobs"); latest.onclick = () => { cursor = null; signature = ""; void load(); }; container.append(latest); }
      if (data.next_cursor) { const earlier = document.createElement("button"); earlier.type = "button"; earlier.className = "secondary"; earlier.textContent = io.tr("較早作業", "Earlier jobs"); earlier.onclick = () => { cursor = data.next_cursor; signature = ""; void load(); }; container.append(earlier); }
    } catch (error) { if (active()) { clearPreviews(); signature = ""; container.replaceChildren(make("p", (error as Error).message)); container.setAttribute("role", "status"); } }
    finally { loading = false; }
  };
  const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000); void load();
  return () => { disposed = true; clearInterval(timer); clearPreviews(); container.replaceChildren(); };
}
