import { exactHKD } from "./financial-notice.js";

type IO = { base: string; taskId: string; live: () => boolean; tr: (zh: string, en: string) => string;
  request: (path: string, method?: string, body?: unknown, key?: string) => Promise<any> };

/** Authorized cloud task review. The extension never runs or requires a local Agent. */
export function mountAudioProductions(container: HTMLElement, io: IO) {
  let disposed = false, loading = false, pending = false, editing = false, signature = "", cursor: string | null = null;
  const owned = new Set<string>(), attempts = new Map<string, { body: string; key: string }>();
  const active = () => !disposed && io.live();
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el;
  };
  const button = (text: string) => { const el = make("button", text); el.type = "button"; el.className = "secondary"; return el; };
  const clear = () => { for (const url of owned) URL.revokeObjectURL(url); owned.clear(); container.replaceChildren(); };
  const alert = (area: HTMLElement, error: unknown) => { const el = make("p", (error as Error).message); el.setAttribute("role", "alert"); area.append(el); };
  const url = (bytes: Uint8Array<ArrayBuffer>, mime: string) => { const value = URL.createObjectURL(new Blob([bytes], { type: mime })); owned.add(value); return value; };
  const content = async (job: any, asset: any) => {
    const result = await io.request(`${io.base}/audio-jobs/${job.id}/preview?kind=${asset.kind}&revision=${asset.revision}`);
    if (!active()) return null;
    const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
    if (!active()) return null;
    if (bytes.length > 25_000_000 || bytes.length !== result.bytes || bytes.length !== Number(asset.bytes)
      || digest !== result.sha256 || digest !== asset.sha256 || result.content_type !== asset.mime_type) throw new Error("AUDIO_OUTPUT_INTEGRITY_FAILED");
    return { result, bytes };
  };
  const write = async (path: string, body: unknown, id: string) => {
    const frozen = JSON.stringify(body);
    if (attempts.get(id)?.body !== frozen) attempts.set(id, { body: frozen, key: crypto.randomUUID() });
    const result = await io.request(path, "POST", body, attempts.get(id)!.key); attempts.delete(id); return result;
  };
  const load = async () => {
    if (!active() || loading || pending || editing) return; loading = true;
    try {
      const data = await io.request(io.base + "/audio-jobs?" + new URLSearchParams({ task_id: io.taskId, limit: "10", ...(cursor ? { cursor } : {}) }));
      if (!active() || pending || editing) return;
      const next = JSON.stringify(data); if (next === signature) return; signature = next; clear();
      if (!data.items.length && !cursor) return;
      container.append(make("h3", io.tr("配音與字幕", "Speech and subtitles")));
      for (const job of data.items) {
        const card = make("article"); card.className = "audio-card"; card.dataset.audioJob = job.id;
        card.append(make("strong", job.kind === "speech" ? io.tr("AI 配音", "AI speech") : io.tr("音訊轉寫與字幕", "Transcription and subtitles")),
          make("p", job.state === "completed" ? io.tr("處理完成", "Completed") : job.state === "unknown" ? io.tr("結果與費用待核對", "Outcome and cost unconfirmed")
            : job.state === "cancelled" ? io.tr("已停止", "Stopped") : io.tr("正在處理", "Processing")),
          make("p", io.tr("公司收費上限：", "Company tariff limit: ") + exactHKD(job.quoted_micros)),
          make("p", io.tr("已確認公司費用：", "Confirmed company charge: ") + (job.actual_micros === null ? io.tr("待確認；保留原預留", "Unconfirmed; original hold retained") : exactHKD(job.actual_micros))));
        if (!job.usage_known && job.actual_micros === null) card.append(make("small", io.tr("不自動重新提交未知請求。", "Unknown requests are not automatically resubmitted.")));
        if (job.delivery_state === "blocked") card.append(make("p", io.tr("交付已停止，請核對原工作、來源與權限。", "Delivery stopped. Review the original task, sources and permissions.")));
        if (!job.cancel_requested && !["completed", "cancelled"].includes(job.state)) {
          const stop = button(io.tr("要求停止", "Request stop")); stop.onclick = () => {
            if (pending || !active()) return; pending = true; stop.disabled = true;
            void write(`${io.base}/audio-jobs/${job.id}/cancel`, { expected_revision: job.revision }, "cancel:" + job.id)
              .then(() => { signature = ""; }).catch(error => { if (active() && card.isConnected) alert(card, error); })
              .finally(() => { pending = false; if (active()) { stop.disabled = false; void load(); } });
          }; card.append(stop);
        }
        if (job.delivery_state === "available") {
          for (const asset of job.assets) {
            const area = make("div"), review = button(asset.kind === "audio" ? io.tr("播放及儲存 AI 配音", "Play and save AI speech")
              : `${asset.kind.toUpperCase()} · v${asset.revision}`);
            review.onclick = () => {
              if (review.disabled || !active()) return; review.disabled = true;
              void content(job, asset).then(data => {
                if (!data || !active() || !card.isConnected) return;
                const value = url(data.bytes, data.result.content_type), save = make("a", io.tr("儲存檔案", "Save file")); save.href = value; save.download = asset.name;
                area.replaceChildren();
                if (asset.kind === "audio") { const audio = make("audio"); audio.controls = true; audio.preload = "metadata"; audio.src = value; audio.ariaLabel = io.tr("AI 配音預覽", "AI speech preview"); area.append(audio); }
                else if (asset.kind === "transcript") {
                  const doc = data.result.document; area.append(make("p", doc.text || io.tr("沒有辨識到文字。", "No speech text recognized.")),
                    make("small", doc.timing_source === "none" ? io.tr("只有文字，未產生時間軸。", "Text only; no subtitle timing generated.")
                      : doc.timing_source === "customer_manual_revision" ? io.tr("客戶手動修訂時間。", "Timing manually revised by customer.") : io.tr("時間來自實際轉寫分段。", "Timing comes from actual service segments.")));
                  if (asset.revision === job.subtitle_revision) {
                    const revise = button(io.tr("修訂字幕", "Revise subtitles")); revise.onclick = () => {
                      if (editing || pending || !active()) return; editing = true; revise.disabled = true;
                      const form = make("form"), fields = make("fieldset"); fields.className = "audio-edit-fields";
                      fields.append(make("p", io.tr("保留原音軌與轉寫。修訂不呼叫 AI，不新增生成費用。", "Original audio and transcription remain. Revisions make no AI call or generation charge.")));
                      const label = (title: string, field: HTMLElement) => { const el = make("label", title); el.append(field); fields.append(el); };
                      const rows: { start: HTMLInputElement; end: HTMLInputElement; text: HTMLTextAreaElement; group: HTMLFieldSetElement; legend: HTMLLegendElement }[] = [];
                      const full = make("textarea"); full.value = doc.text; full.maxLength = 200000; full.rows = 5;
                      const fullLabel = make("label", io.tr("完整文字", "Full transcript")); fullLabel.append(full); fullLabel.hidden = doc.cues.length > 0; fields.append(fullLabel);
                      const add = (cue?: any) => {
                        const group = make("fieldset"), legend = make("legend", io.tr("字幕", "Caption") + " " + (rows.length + 1)); group.append(legend);
                        const start = make("input"), end = make("input"), text = make("textarea");
                        for (const [field, title] of [[start, io.tr("開始（秒）", "Start (seconds)")], [end, io.tr("結束（秒）", "End (seconds)")]] as const) {
                          field.type = "number"; field.min = "0"; field.max = String(doc.duration_ms / 1000); field.step = "0.001"; field.required = true;
                          const el = make("label", title); el.append(field); group.append(el);
                        }
                        start.value = cue ? String(cue.start_ms / 1000) : ""; end.value = cue ? String(cue.end_ms / 1000) : "";
                        text.value = cue?.text ?? (rows.length ? "" : full.value); text.required = true; text.maxLength = 4000; text.rows = 3;
                        const el = make("label", io.tr("文字", "Text")); el.append(text); group.append(el);
                        const remove = button(io.tr("移除此段", "Remove caption")); remove.onclick = () => {
                          const index = rows.findIndex(row => row.group === group); if (index < 0 || pending) return;
                          if (rows.length === 1) full.value = text.value;
                          rows.splice(index, 1); group.remove(); fullLabel.hidden = rows.length > 0;
                          rows.forEach((row, i) => { row.legend.textContent = io.tr("字幕", "Caption") + " " + (i + 1); }); addTiming.disabled = false;
                        }; group.append(remove); fields.insertBefore(group, fields.querySelector(".audio-add-timing")); rows.push({ start, end, text, group, legend }); fullLabel.hidden = true;
                      };
                      for (const cue of doc.cues) add(cue);
                      const addTiming = button(io.tr("手動新增時間段", "Add manual timing")); addTiming.classList.add("audio-add-timing"); addTiming.onclick = () => { if (rows.length < 2000) add(); addTiming.disabled = rows.length >= 2000; }; fields.append(addTiming);
                      const reason = make("textarea"); reason.required = true; reason.minLength = 3; reason.maxLength = 1000; reason.rows = 2; label(io.tr("修訂原因", "Revision reason"), reason);
                      const submit = make("button", io.tr("儲存新版本", "Save new version")); submit.type = "submit"; fields.append(submit);
                      const cancel = button(io.tr("取消修訂", "Cancel revision")); cancel.onclick = () => { if (!pending) { editing = false; form.remove(); revise.disabled = false; void load(); } }; fields.append(cancel);
                      form.append(fields); area.append(form);
                      form.onsubmit = event => {
                        event.preventDefault(); if (pending || !active()) return; pending = true; fields.disabled = true;
                        const body = { expected_revision: job.revision, text: rows.length ? rows.map(row => row.text.value).join("\n") : full.value,
                          cues: rows.map(row => ({ start_ms: Math.round(Number(row.start.value) * 1000), end_ms: Math.round(Number(row.end.value) * 1000), text: row.text.value })), reason: reason.value };
                        void write(`${io.base}/audio-jobs/${job.id}/subtitles`, body, "edit:" + job.id)
                          .then(() => { editing = false; signature = ""; })
                          .catch(error => { if (active() && form.isConnected) alert(form, (error as any)?.code === "AUDIO_REVISION_CONFLICT"
                            ? new Error(io.tr("已有較新的字幕版本。你的修訂仍在；取消後選取最新版本再修訂。", "A newer subtitle version exists. Your edits are retained; cancel, select the latest version and revise again.")) : error); })
                          .finally(() => { pending = false; if (active()) { fields.disabled = false; void load(); } });
                      };
                    }; area.append(revise);
                  }
                }
                area.append(save);
              }).catch(error => { if (active() && card.isConnected) { alert(area, error); review.disabled = false; } });
            }; card.append(review, area);
          }
        }
        container.append(card);
      }
      if (cursor) { const latest = button(io.tr("回到最新", "Back to latest")); latest.onclick = () => { cursor = null; signature = ""; void load(); }; container.append(latest); }
      if (data.next_cursor) { const earlier = button(io.tr("較早作業", "Earlier jobs")); earlier.onclick = () => { cursor = data.next_cursor; signature = ""; void load(); }; container.append(earlier); }
    } catch (error) { if (active() && !editing) { clear(); signature = ""; alert(container, error); } }
    finally { loading = false; }
  };
  const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000); void load();
  return () => { disposed = true; clearInterval(timer); clear(); attempts.clear(); };
}
