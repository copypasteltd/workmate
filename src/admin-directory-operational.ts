import { z } from "zod";

// Aggregated charges can exceed one ledger entry's int64 amount. Keep filter
// arithmetic decimal/integer throughout, including beyond JavaScript's limit.
const amount = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const time = z.string().datetime({ offset: true }).optional();
export const operationalDirectoryFields = {
  view: z.literal("operations").optional(),
  registered_from: time,
  registered_to: time,
  active_from: time,
  active_to: time,
  activity: z.enum(["known", "unknown"]).optional(),
  registration_source: z.enum(["email_otp", "unknown"]).optional(),
  vip_plan: z.string().trim().min(1).max(160).optional(),
  vip_status: z.enum(["effective", "scheduled", "expired", "suspended", "revoked"]).optional(),
  vip_expiry_from: time,
  vip_expiry_to: time,
  charge_min_micros: amount.optional(),
  charge_max_micros: amount.optional(),
  balance_state: z.enum(["insufficient", "sufficient"]).optional(),
  balance_required_micros: amount.refine(v => /^(0|[1-9][0-9]{0,29})$/.test(v) && BigInt(v) > 0n).optional(),
  billing_subject: z.enum(["personal", "tenant"]).optional(),
  cost_exception: z.enum(["pending_reconciliation", "none"]).optional(),
  role_key: z.string().trim().min(1).max(80).optional(),
  role_usage: z.enum(["created", "started"]).optional(),
};

export function validateOperationalDirectory(q: Record<string, any>, ctx: z.RefinementCtx) {
  for (const [from, to] of [["period_from", "period_to"], ["registered_from", "registered_to"], ["active_from", "active_to"], ["vip_expiry_from", "vip_expiry_to"]]) {
    if (q[from] && q[to] && Date.parse(q[from]) >= Date.parse(q[to]))
      ctx.addIssue({ code: "custom", path: [to], message: from + " must precede " + to });
  }
  if (/^(0|[1-9][0-9]{0,29})$/.test(q.charge_min_micros ?? "") && /^(0|[1-9][0-9]{0,29})$/.test(q.charge_max_micros ?? "") && BigInt(q.charge_min_micros) > BigInt(q.charge_max_micros))
    ctx.addIssue({ code: "custom", path: ["charge_max_micros"], message: "Maximum charges must not be below minimum charges" });
  if (q.activity === "unknown" && (q.active_from || q.active_to))
    ctx.addIssue({ code: "custom", path: ["activity"], message: "Unknown activity cannot have a recorded activity range" });
  if ((q.balance_required_micros || q.billing_subject) && !q.balance_state)
    ctx.addIssue({ code: "custom", path: ["balance_state"], message: "Select a balance state for the account condition" });
  if (q.role_usage && !q.role_key)
    ctx.addIssue({ code: "custom", path: ["role_key"], message: "Role usage requires a role key" });
}
