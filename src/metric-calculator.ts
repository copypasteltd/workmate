import { z } from "zod";
import { Problem } from "./lib.js";

export const FORMULA_VERSION = "1.0";
const SCALE = 100000000n;
const conversion = z
  .union([
    z
      .number()
      .finite()
      .nonnegative()
      .max(1e9)
      .refine(
        (v) => Number(v.toFixed(8)) === v,
        "At most eight decimal places",
      ),
    z
      .string()
      .regex(/^\d+(\.\d{1,8})?$/)
      .refine(
        (v) => scaled(v) <= 1000000000n * SCALE,
        "Conversions exceed the limit",
      ),
  ])
  .nullable();
export const metricRow = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (s) =>
          !Number.isNaN(Date.parse(s)) &&
          new Date(s).toISOString().startsWith(s),
      ),
    channel: z.string().min(1).max(80),
    campaign: z.string().max(200).default(""),
    entity_id: z.string().max(200).optional(),
    impressions: z.number().int().nonnegative().max(1e12),
    clicks: z.number().int().nonnegative().max(1e12),
    spend_micros: z.number().int().nonnegative().max(1e12),
    conversions: conversion,
    revenue_micros: z.number().int().nonnegative().max(1e12).nullable(),
  })
  .strict();
export type MetricRow = z.infer<typeof metricRow>;

function scaled(v: string | number): bigint {
  const [a, b = ""] = (typeof v === "number" ? v.toFixed(8) : v).split(".");
  return BigInt(a) * SCALE + BigInt(b.padEnd(8, "0"));
}
function fixed(v: bigint): string {
  return `${v / SCALE}.${(v % SCALE).toString().padStart(8, "0")}`;
}
/** Non-negative rational division, eight decimal places, ROUND_HALF_UP.
 * BigInt keeps base totals and every intermediate exact; numeric fields below
 * exist only for backwards-compatible display, never for stored evidence. */
function ratio(a: bigint, b: bigint): string {
  return fixed((a * SCALE + b / 2n) / b);
}
export function decimalMicros(s: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(s.trim()))
    throw new Problem(
      400,
      "INVALID_AMOUNT",
      "Use a non-negative amount with at most six decimal places",
    );
  const [whole, fraction = ""] = s.trim().split(".");
  const n = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  if (n > 1000000000000n)
    throw new Problem(400, "INVALID_AMOUNT", "Amount is too large");
  return Number(n);
}
export function metrics(input: MetricRow[]) {
  let impressions = 0n,
    clicks = 0n,
    spend = 0n,
    conversions = 0n,
    revenue = 0n;
  let unknownConversions = 0,
    unknownRevenue = 0;
  for (const value of input) {
    const r = metricRow.parse(value);
    impressions += BigInt(r.impressions);
    clicks += BigInt(r.clicks);
    spend += BigInt(r.spend_micros);
    if (r.conversions === null) unknownConversions++;
    else conversions += scaled(r.conversions);
    if (r.revenue_micros === null) unknownRevenue++;
    else revenue += BigInt(r.revenue_micros);
  }
  if (
    [impressions, clicks, spend, revenue].some(
      (n) => n > BigInt(Number.MAX_SAFE_INTEGER),
    )
  )
    throw new Problem(
      400,
      "DATASET_TOO_LARGE",
      "Totals exceed exact integer limits",
    );
  const reasons: Record<string, string> = {};
  const exact: Record<string, string | null> = {
    impressions: impressions.toString(),
    clicks: clicks.toString(),
    spend: fixed(spend * 100n),
    conversions: unknownConversions ? null : fixed(conversions),
    conversion_value: unknownRevenue ? null : fixed(revenue * 100n),
  };
  if (unknownConversions) reasons.conversions = "missing_conversions";
  if (unknownRevenue) reasons.conversion_value = "missing_conversion_value";
  const calculate = (key: string, a: bigint, b: bigint, missing?: string) => {
    if (!input.length || missing || !b) {
      exact[key] = null;
      reasons[key] = !input.length ? "no_rows" : missing || "zero_denominator";
    } else exact[key] = ratio(a, b);
  };
  calculate("ctr", clicks, impressions);
  calculate("cpc", spend, clicks * 1000000n);
  calculate("cpm", spend * 1000n, impressions * 1000000n);
  calculate(
    "cvr",
    conversions,
    clicks * SCALE,
    unknownConversions ? "missing_conversions" : undefined,
  );
  calculate(
    "cpa",
    spend * SCALE,
    conversions * 1000000n,
    unknownConversions ? "missing_conversions" : undefined,
  );
  calculate(
    "roas",
    revenue,
    spend,
    unknownRevenue ? "missing_conversion_value" : undefined,
  );
  const cv = unknownConversions ? null : Number(conversions) / Number(SCALE);
  return {
    impressions: Number(impressions),
    clicks: Number(clicks),
    spend_micros: Number(spend),
    conversions: cv,
    revenue_micros: unknownRevenue ? null : Number(revenue),
    ctr: impressions ? Number(clicks) / Number(impressions) : null,
    cpc_micros: clicks ? Number(spend) / Number(clicks) : null,
    cpm_micros: impressions
      ? (Number(spend) * 1000) / Number(impressions)
      : null,
    cpa_micros: cv ? Number(spend) / cv : null,
    roas: exact.roas === null ? null : Number(revenue) / Number(spend),
    conversion_rate: cv !== null && clicks ? cv / Number(clicks) : null,
    exact,
    null_reasons: reasons,
    coverage: {
      rows: input.length,
      unknown_conversion_rows: unknownConversions,
      unknown_value_rows: unknownRevenue,
    },
    calculation: {
      formula_version: FORMULA_VERSION,
      precision: 8,
      rounding: "ROUND_HALF_UP",
      aggregation: "sum_then_divide",
    },
  };
}
