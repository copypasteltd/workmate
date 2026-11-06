export const reviewMetrics = ["spend", "impressions", "clicks", "conversions", "conversion_value", "ctr", "cpc", "cpm", "cvr", "cpa", "roas"];
const names: Record<string, [string, string]> = { spend: ["花費", "Spend"], impressions: ["曝光", "Impressions"], clicks: ["點擊", "Clicks"], conversions: ["轉化", "Conversions"], conversion_value: ["轉化價值", "Conversion value"], ctr: ["點擊率", "CTR"], cpc: ["每次點擊成本", "CPC"], cpm: ["千次曝光成本", "CPM"], cvr: ["轉化率", "CVR"], cpa: ["每次轉化成本", "CPA"], roas: ["廣告回報", "ROAS"] };
export const metricLabel = (metric: string, en: boolean) => names[metric]?.[en ? 1 : 0] ?? metric;
export function exactScaled(value: string): bigint {
  if (!/^-?\d+(?:\.\d{1,8})?$/.test(value)) throw new Error("Invalid exact decimal");
  const negative = value.startsWith("-"), [a, b = ""] = value.replace(/^-/, "").split(".");
  return (negative ? -1n : 1n) * (BigInt(a) * 100000000n + BigInt(b.padEnd(8, "0")));
}
export function displayExact(value: string | null | undefined, metric: string, currency: string, change = false): string {
  if (value == null) return "—";
  let amount: bigint;
  try { amount = exactScaled(value); } catch { return "—"; }
  const percentage = change || ["ctr", "cvr"].includes(metric);
  if (percentage) amount *= 100n;
  const negative = amount < 0n; if (negative) amount = -amount;
  // Round for display only. Original eight-decimal values remain in evidence.
  const cents = (amount + 500000n) / 1000000n, integer = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), fraction = (cents % 100n).toString().padStart(2, "0");
  return (negative && cents ? "−" : change && cents ? "+" : "") + (percentage ? "" : ["spend", "conversion_value", "cpc", "cpm", "cpa"].includes(metric) ? currency + " " : "") + integer + "." + fraction + (percentage ? "%" : metric === "roas" ? "×" : "");
}
export function barWidths(current: string | null | undefined, previous: string | null | undefined): [number, number] {
  const read = (s: typeof current) => { try { const n = exactScaled(s ?? "0"); return n < 0n ? 0n : n; } catch { return 0n; } };
  const a = read(current), b = read(previous), top = a > b ? a : b;
  return top ? [Number(a * 10000n / top) / 100, Number(b * 10000n / top) / 100] : [0, 0];
}
export function comparisonNotes(spec: any): string[] {
  if (!spec?.comparison) return [];
  const a = Date.parse(spec.date_from), b = Date.parse(spec.date_to), c = Date.parse(spec.comparison.date_from), d = Date.parse(spec.comparison.date_to), notes: string[] = [];
  if ([a, b, c, d].some(n => !Number.isFinite(n))) return [];
  if (Math.max(a, c) <= Math.min(b, d)) notes.push("overlapping_periods");
  if (b - a !== d - c) notes.push("unequal_periods");
  return notes;
}
export function reviewGroups(groups: any[], query: string, metric: string, order: string, missingOnly: boolean) {
  const q = query.trim().toLocaleLowerCase();
  const result = groups.map((group, index) => ({ group, index })).filter(({ group }) => (!q || JSON.stringify(group.scope).toLocaleLowerCase().includes(q)) && (!missingOnly || group.periods.current.summary.exact[metric] == null || (group.periods.comparison && group.periods.comparison.summary.exact[metric] == null)));
  if (order !== "source") result.sort((a, b) => {
    const av = a.group.periods.current.summary.exact[metric], bv = b.group.periods.current.summary.exact[metric];
    if (av == null || bv == null) return av == null ? bv == null ? a.index - b.index : 1 : -1;
    const x = exactScaled(av), y = exactScaled(bv); return (x === y ? a.index - b.index : x < y ? -1 : 1) * (order === "high" ? -1 : 1);
  });
  return result;
}
