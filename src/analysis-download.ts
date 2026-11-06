/** This POST download is a single authenticated company operation, not a
 * renderer-controlled general request or filesystem write facility. */
export function analysisDownloadBody(path: unknown, options: unknown): string | undefined {
  if (options === undefined) return undefined;
  if (typeof path !== "string" || !/^\/v1\/tenants\/[a-f0-9-]{36}\/projects\/[a-f0-9-]{36}\/analysis\/preview\/export$/i.test(path)) throw new Error("Unsupported POST download");
  if (!options || typeof options !== "object" || Object.keys(options).join() !== "body") throw new Error("Invalid download options");
  const b = (options as any).body;
  if (!b || typeof b !== "object" || !["html", "csv", "json"].includes(b.format) || !["zh-HK", "en-HK"].includes(b.locale) || !/^[a-f0-9]{64}$/.test(b.calculation_sha256) || !b.specification || Object.keys(b).some(k => !["format", "locale", "calculation_sha256", "specification"].includes(k))) throw new Error("Invalid review download");
  const text = JSON.stringify(b);
  if (Buffer.byteLength(text, "utf8") > 100000) throw new Error("Review request exceeds limit");
  return text;
}
