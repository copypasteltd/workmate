import { useState } from "react";
import { Field, useData, useI18n } from "./ui";

export function videoGenerationBrief(prompt: string, form: FormData) {
  if (form.get("video_mode") !== "generated") return prompt;
  if (prompt.trim().length > 12000) throw new Error("Generated video prompts support up to 12,000 characters / 生成影片提示最多 12,000 字");
  const seconds = Number(form.get("video_seconds")), size = String(form.get("video_size"));
  if (![4, 8, 12, 16, 20].includes(seconds) || !["1280x720", "720x1280", "1024x1024"].includes(size)) throw new Error("VIDEO_BRIEF_INVALID");
  return "The customer explicitly requests a generated video using the company generation service. Use generated_video_create with this exact duration, size and customer prompt, within this task's shared budget. Preserve the original job if status or cost is unknown; query it rather than creating a replacement. Deliver only the actual validated video.\n"
    + JSON.stringify({ prompt, seconds, size });
}

export function VideoBriefFields({ compact = false, disabled = false }: { compact?: boolean; disabled?: boolean }) {
  const { t } = useI18n(), config = useData<{ services: { video: boolean } }>("/v1/public/config");
  const [method, setMethod] = useState("composition");
  const fields = <fieldset className="video-brief-fields" disabled={disabled}><legend>{t("影片製作方式", "Video production")}</legend>
    <Field label={t("交付方式", "Production method")}><select name="video_mode" value={method} onChange={e => setMethod(e.target.value)}>
      <option value="composition">{t("剪輯與模板製作", "Editing and template composition")}</option>
      <option value="generated" disabled={!config.data?.services.video}>{t("生成式影片", "Generated video")}</option>
    </select></Field>
    {!config.data?.services.video && <p className="muted">{t("生成式影片服務尚未啟用；你仍可進行剪輯及模板製作。", "Video generation is not enabled yet. Editing and template composition remain available.")}</p>}
    {method === "generated" && <><div className="video-brief-grid"><Field label={t("生成片段長度", "Generated clip duration")}><select name="video_seconds" defaultValue="4">
      {[4, 8, 12, 16, 20].map(seconds => <option key={seconds} value={seconds}>{seconds} {t("秒", "seconds")}</option>)}
    </select></Field><Field label={t("生成影片比例", "Generated video format")}><select name="video_size" defaultValue="1280x720">
      <option value="1280x720">{t("橫向 · 1280 × 720", "Landscape · 1280 × 720")}</option>
      <option value="720x1280">{t("直向 · 720 × 1280", "Portrait · 720 × 1280")}</option>
      <option value="1024x1024">{t("方形 · 1024 × 1024", "Square · 1024 × 1024")}</option>
    </select></Field></div>
    <p className="muted">{t("生成片段與對話共用本次工作預算。", "Generation and reasoning share this task's budget.")}</p></>}
  </fieldset>;
  return compact ? <details className="video-brief-options"><summary>{t("影片設定", "Video settings")}<span>{method === "generated" ? t("生成式影片", "Generated video") : t("剪輯與模板", "Editing & templates")}</span></summary>{fields}</details> : fields;
}
