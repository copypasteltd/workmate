/** Confirm company job delivery before reporting native tool completion.
 * These metadata checks grant no local permissions or extra budget. */
export function companyMediaDelivered(tool: string, value: unknown): boolean {
  if (!["audio_produce", "generated_video_create"].includes(tool)) return true;
  const v = value as any;
  if (!v || v.state !== "completed" || v.delivery_state !== "available"
    || v.usage_state !== (tool === "audio_produce" ? "confirmed_company_tariff" : "confirmed")
    || v.budget_violation === true || !Array.isArray(v.assets) || !v.assets.length) return false;
  return tool !== "audio_produce" || (v.kind === "speech"
    ? v.assets.some((a: any) => a.kind === "audio")
    : v.kind === "transcription" && ["transcript", "srt", "vtt"].every(kind => v.assets.some((a: any) => a.kind === kind)));
}
