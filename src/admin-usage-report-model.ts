import { z } from "zod";
import { uuid, canonical, hash } from "./lib.js";
import type { ReadScope } from "./admin-directory.js";

export const usageReportFilters = z.object({
  user_id: uuid.optional(), tenant_id: uuid.optional(), project_id: uuid.optional(),
  billing_account_id: uuid.optional(), task_id: uuid.optional(), capability_version_id: uuid.optional(),
  payer_kind: z.enum(["user", "tenant"]).optional(),
  source: z.enum(["cloud_agent", "desktop_agent", "cloud_resource"]).optional(),
  role_key: z.string().trim().min(1).max(80).optional(),
  model_alias: z.string().trim().min(1).max(200).optional(),
  // Leave omitted input omitted so existing idempotency fingerprints stay valid.
  time_basis: z.enum(["work_created_at", "ledger_posted_at"]).optional(),
  period_from: z.string().datetime({ offset: true }), period_to: z.string().datetime({ offset: true }),
}).strict().refine(v => Date.parse(v.period_from) < Date.parse(v.period_to), "The end must follow the start");
export type UsageReportFilters = z.infer<typeof usageReportFilters>;
export type UsageTimeBasis = "work_created_at" | "ledger_posted_at";
export const usageGroups = ["user", "payer", "tenant", "project", "role", "source", "day", "capability"] as const;
export const usageReportSelection = z.object({
  group_by: z.enum(usageGroups).optional(), group_key: z.string().min(1).max(240).optional(),
}).strict().refine(v => !!v.group_by === !!v.group_key, "Group type and key must be supplied together");
export const usageReportPage = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1), page_size: z.coerce.number().int().min(1).max(100).default(50),
  group_by: z.enum(usageGroups).optional(), group_key: z.string().min(1).max(240).optional(),
}).strict().refine(v => !!v.group_by === !!v.group_key, "Group type and key must be supplied together");
export const usageReportLimit = { works: 5000, operations: 20000, bytes: 16 * 1024 * 1024 };
export function usageAccessHash(s: ReadScope) {
  return hash(canonical(s.bs.map(b => ({ id: b.id, role: b.role_key, scope: b.scope_kind, target: b.scope_id, effect: b.effect, limits: b.limits, expires: b.expires_at ? new Date(b.expires_at).toISOString() : null, permissions: [...b.permissions].sort() })).sort((a, b) => a.id.localeCompare(b.id))));
}
export const hkDay = (date: string) => new Date(Date.parse(date) + 8 * 3600000).toISOString().slice(0, 10);
export function workGroups(row: any, by: typeof usageGroups[number], basis: UsageTimeBasis = "work_created_at"): string[] {
  if (by === "capability") return [...new Set<string>(row.operations.map((o: any) => o.capability_version_id).filter(Boolean))];
  if (by === "day" && basis === "ledger_posted_at") return [...new Set<string>([...row.ledger, ...row.refunds].map(r => hkDay(r.created_at)))].sort();
  return [String(({ user: row.user_id, payer: row.billing_account_id, tenant: row.tenant_id, project: row.project_id, role: row.role_key ?? "unrecorded", source: row.source, day: hkDay(row.created_at) } as any)[by])];
}
const sum = (rows: any[], key: string) => rows.reduce((n, r) => n + BigInt(r[key]), 0n).toString();
/** A work can post on several days. Project its actual entries before summing;
 * never repeat its entire lifetime charge on every posting day. */
export function postingDayWork(row: any, date: string) {
  const ledger = row.ledger.filter((r: any) => hkDay(r.created_at) === date);
  const refunds = row.refunds.filter((r: any) => hkDay(r.created_at) === date);
  return { ...row, ledger, refunds,
    confirmed_micros: (-ledger.reduce((n: bigint, r: any) => n + BigInt(r.amount_micros), 0n)).toString(),
    refunded_micros: sum(refunds, "amount_micros"),
  };
}
export function selectUsageWorks(rows: any[], selection: z.infer<typeof usageReportSelection>, basis: UsageTimeBasis = "work_created_at") {
  if (!selection.group_by) return rows;
  const selected = rows.filter(row => workGroups(row, selection.group_by!, basis).includes(selection.group_key!));
  return selection.group_by === "day" && basis === "ledger_posted_at" ? selected.map(row => postingDayWork(row, selection.group_key!)) : selected;
}
export function summarizeUsage(rows: any[], basis: UsageTimeBasis = "work_created_at") {
  const gross = sum(rows, "confirmed_micros"), refunded = sum(rows, "refunded_micros");
  const units: Record<string, { known: string; unknown_operations: number }> = {};
  for (const row of rows) for (const o of row.operations) for (const [unit, raw] of Object.entries(o.units ?? {})) {
    const entry = units[unit] ??= { known: "0", unknown_operations: 0 };
    if (raw === null) entry.unknown_operations++; else entry.known = (BigInt(entry.known) + BigInt(String(raw))).toString();
  }
  return { works: rows.length, confirmed_micros: gross, refunded_micros: refunded, net_micros: (BigInt(gross) - BigInt(refunded)).toString(), reserved_micros: basis === "ledger_posted_at" ? null : sum(rows, "reserved_micros"), reconciliation_hold_micros: basis === "ledger_posted_at" ? null : sum(rows, "reconciliation_hold_micros"), unresolved_works: rows.filter(r => r.unresolved).length, units,
    ...(basis === "ledger_posted_at" ? { holds_state: "outside_posted_activity", units_time_basis: "selected_work_lifetime" } : {}),
    ...(rows.some(r => r.internal_cost !== undefined) ? { internal_cost: { amount_micros: null, state: "not_recorded", readable_works: rows.filter(r => r.internal_cost !== undefined).length, total_works: rows.length } } : {}) };
}
export function groupUsage(rows: any[], basis: UsageTimeBasis = "work_created_at") {
  return Object.fromEntries(usageGroups.map(by => {
    const groups = new Map<string, any[]>();
    for (const row of rows) for (const key of workGroups(row, by, basis)) { const list = groups.get(key) ?? []; list.push(by === "day" && basis === "ledger_posted_at" ? postingDayWork(row, key) : row); groups.set(key, list); }
    return [by, [...groups.entries()].map(([key, works]) => ({ key, label: by === "tenant" ? works[0].tenant_name : by === "project" ? works[0].project_name : by === "user" ? works[0].user_name : key,
      ...(by === "capability" ? { works: works.length, operation_count: works.flatMap(w => w.operations).filter(o => o.capability_version_id === key).length, confirmed_micros: null } : summarizeUsage(works, basis)) })).sort((a, b) => String(a.key).localeCompare(String(b.key)))];
  }));
}
