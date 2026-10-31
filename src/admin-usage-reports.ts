import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import { readScope, ReadScope } from "./admin-directory.js";
import { key, replay } from "./access.js";
import { canonical, hash, seal, unseal, Problem, uuid } from "./lib.js";
import { dataCsvCell } from "./admin-data-model.js";
import { captureUsageReport } from "./admin-usage-report-query.js";
import { usageReportFilters, usageReportPage, usageReportSelection, usageReportLimit, usageAccessHash, groupUsage, summarizeUsage, selectUsageWorks } from "./admin-usage-report-model.js";
import { z } from "zod";

const root = "/v1/admin/usage-reports";
async function readable(tx: Tx, db: Database, p: Principal, id: string) {
  const s = await readScope(tx, p, "admin.usage.read");
  const row = (await tx.query("SELECT * FROM admin_data_previews WHERE id=$1 AND principal_id=$2 AND session_id=$3 AND command->>'kind'='usage_report'", [id, p.id, p.sessionId])).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Usage report not found in this Admin session");
  if (row.auth_version !== p.authVersion || row.access_hash !== usageAccessHash(s)) throw new Problem(409, "USAGE_REPORT_ACCESS_CHANGED", "Your access changed; create a fresh usage report");
  if (!row.payload_ciphertext || new Date(row.expires_at).getTime() <= Date.now()) throw new Problem(410, "USAGE_REPORT_EXPIRED", "The usage report expired; create a fresh report");
  const raw = unseal(db.config.MASTER_KEY!, row.payload_ciphertext);
  if (hash(raw) !== row.payload_hash) throw new Problem(409, "SNAPSHOT_INTEGRITY", "Usage report integrity check failed");
  const report = JSON.parse(raw);
  if (report.data_mode !== (db.config.DEMO_MODE ? "simulated" : "configured_services")) throw new Problem(409, "USAGE_REPORT_MODE_CHANGED", "Create a usage report for the current environment");
  return { row, report, s };
}
function selected(report: any, q: z.infer<typeof usageReportSelection>) {
  return selectUsageWorks(report.works, q, report.time_basis);
}
export function registerAdminUsageReports(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireAdmin(db) };
  app.post(root, auth, async req => {
    const filters = usageReportFilters.parse(req.body), idempotency = key(req);
    return db.tx(async tx => {
      const s = await readScope(tx, req.principal, "admin.usage.read");
      if (filters.user_id) {
        if (!s.has("admin.users.read")) throw new Problem(403, "ADMIN_FORBIDDEN", "User drilldown requires user-directory access");
        if (!(await tx.query(`SELECT u.id FROM users u WHERE u.id=${s.arg(filters.user_id)}::uuid AND ${s.user("admin.users.read")}`, s.values)).rowCount) throw new Problem(404, "NOT_FOUND", "User not found");
      }
      return replay(tx, req.principal.id, "admin.usage-report.create", idempotency, { filters, session: req.principal.sessionId }, async () => {
        const capture = await captureUsageReport(tx, new ReadScope(s.bs), filters, db.config.DEMO_MODE ? "simulated" : "configured_services");
        const report = { ...capture, filters, data_mode: db.config.DEMO_MODE ? "simulated" : "configured_services", timezone: "Asia/Hong_Kong", time_basis: filters.time_basis ?? "work_created_at", units_time_basis: "selected_work_lifetime", currency: "HKD", estimated: false };
        const raw = canonical(report); if (Buffer.byteLength(raw) > usageReportLimit.bytes) throw new Problem(413, "USAGE_REPORT_TOO_LARGE", "Narrow the period or project; the full report exceeds its bounded size");
        const saved = (await tx.query(`INSERT INTO admin_data_previews(principal_id,session_id,auth_version,access_hash,command,definition_hash,manifest,payload_ciphertext,payload_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,expires_at`, [req.principal.id, req.principal.sessionId, req.principal.authVersion, usageAccessHash(s), { kind: "usage_report", filters }, hash(canonical(filters)), { work_count: report.works.length, as_of: report.as_of }, seal(db.config.MASTER_KEY!, raw), hash(raw)])).rows[0];
        await audit(tx, req.principal, "admin.usage.read", saved.id, "succeeded", { operation: "report_snapshot", work_count: report.works.length, filters_hash: hash(canonical(filters)) });
        return { id: saved.id, expires_at: new Date(saved.expires_at).toISOString() };
      });
    }, undefined, true);
  });
  app.get(root + "/:id", auth, async req => {
    const id = uuid.parse((req.params as any).id), q = usageReportPage.parse(req.query);
    return db.tx(async tx => {
      const { row, report } = await readable(tx, db, req.principal, id), works = selected(report, q);
      await audit(tx, req.principal, "admin.usage.read", id, "succeeded", { operation: "report_page", page: q.page, group_by: q.group_by });
      return { id, expires_at: new Date(row.expires_at).toISOString(), as_of: report.as_of, watermark: row.payload_hash, filters: report.filters, data_mode: report.data_mode, timezone: report.timezone, time_basis: report.time_basis, units_time_basis: report.units_time_basis ?? "selected_work_lifetime", currency: "HKD", estimated: false,
        summary: summarizeUsage(works, report.time_basis), groups: groupUsage(report.works, report.time_basis), total: works.length, page: q.page, page_size: q.page_size,
        items: works.slice((q.page - 1) * q.page_size, q.page * q.page_size).map(({ operations, ledger, refunds, exportable, ...w }: any) => ({ ...w, operation_count: operations.length })),
      };
    }, undefined, true);
  });
  app.get(root + "/:id/works/:kind/:work", auth, async req => {
    const selection = usageReportSelection.parse(req.query);
    const p = z.object({ id: uuid, kind: z.enum(["task", "resource"]), work: uuid }).parse(req.params);
    return db.tx(async tx => {
      const { row, report } = await readable(tx, db, req.principal, p.id);
      const work = selected(report, selection).find((w: any) => w.id === p.work && w.kind === p.kind);
      if (!work) throw new Problem(404, "NOT_FOUND", "Work is outside this report");
      await audit(tx, req.principal, "admin.usage.read", p.id, "succeeded", { operation: "report_work", work_id: p.work, kind: p.kind });
      const { exportable, ...safe } = work; return { id: p.id, as_of: report.as_of, watermark: row.payload_hash, time_basis: report.time_basis, units_time_basis: report.units_time_basis ?? "selected_work_lifetime", selection, work: safe };
    }, undefined, true);
  });
  app.get(root + "/:id/export", auth, async (req, reply) => {
    const id = uuid.parse((req.params as any).id), q = usageReportPage.parse(req.query);
    const csv = await db.tx(async tx => {
      const { row, report, s } = await readable(tx, db, req.principal, id), works = selected(report, q);
      if (!s.has("admin.exports.create") || !s.has("admin.exports.download") || works.some((w: any) => !w.exportable)) throw new Problem(403, "ADMIN_FORBIDDEN", "Export authority must cover every selected work; narrow the selection or request access");
      const columns = ["kind", "id", "source", "user_id", "tenant_id", "project_id", "billing_account_id", "payer_kind", "payer_id", "role_key", "created_at", "confirmed_micros", "refunded_micros", "net_micros", "reserved_micros", "reconciliation_hold_micros", "unresolved", "as_of", "watermark", "currency", "time_basis"];
      if (report.time_basis === "ledger_posted_at") columns.push("period_from", "period_to", "group_by", "group_key", "holds_state", "units_time_basis");
      const table = [columns, ...works.map((w: any) => columns.map(c => ({ ...w, net_micros: (BigInt(w.confirmed_micros)-BigInt(w.refunded_micros)).toString(), as_of: report.as_of, watermark: row.payload_hash, currency: "HKD", time_basis: report.time_basis,
        period_from: report.filters.period_from, period_to: report.filters.period_to, group_by: q.group_by, group_key: q.group_key, units_time_basis: "selected_work_lifetime" } as any)[c]))].map(r => r.map(dataCsvCell).join(","));
      await audit(tx, req.principal, "admin.usage.read", id, "succeeded", { operation: "report_export", work_count: works.length, watermark: row.payload_hash });
      await audit(tx, req.principal, "admin.exports.download", id, "succeeded", { source: "usage_report", work_count: works.length });
      return "\uFEFF" + table.join("\r\n") + "\r\n";
    }, undefined, true);
    return reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="workmate-usage-${id}.csv"`).send(csv);
  });
}
