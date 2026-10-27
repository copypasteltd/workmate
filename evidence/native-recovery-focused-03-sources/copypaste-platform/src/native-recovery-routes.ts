import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { requireAdmin, audit } from "./auth.js";
import { lockAdminAccess, permit, requireSensitiveAdmin, bindings } from "./admin-access.js";
import { Problem } from "./lib.js";

const permission = "admin.recovery.read";
const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  kind: z.enum(["backup", "ledger", "restore"]).optional(),
}).strict();
export const recoveryReceiptDTO = z.object({
  id: z.string().uuid(), source_id: z.string().uuid(), kind: z.enum(["backup", "ledger", "restore"]),
  outcome: z.enum(["verified", "failed", "quarantined", "incomplete"]),
  started_at: z.string().datetime(), finished_at: z.string().datetime(), snapshot_at: z.string().datetime().nullable(),
  ledger_at: z.string().datetime().nullable(), incident_at: z.string().datetime().nullable(),
  file_count: z.number().int().nonnegative(), plaintext_bytes: z.string().regex(/^\d+$/),
  manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  detail: z.object({ authenticated_full_read: z.boolean().optional(), has_tool_warnings: z.boolean().optional(),
    object_count: z.number().int().nonnegative().optional(), receipt_count: z.number().int().nonnegative().optional(),
    target_count: z.number().int().nonnegative().optional(), erasure_jobs_remaining: z.number().int().nonnegative().optional(),
    tasks_inflight: z.number().int().nonnegative().optional(), snapshot_gap_ms: z.number().nonnegative().optional(), ledger_gap_ms: z.number().nonnegative().optional(),
    native_restore_ms: z.number().nonnegative().optional(), execution_quarantined: z.boolean().optional(), production_release: z.boolean().optional(),
    error_code: z.literal("RECOVERY_BACKUP_FAILED").optional(), partial_preserved: z.boolean().optional(),
  }).strip(),
}).strict();
function dto(row: any) {
  const v = { ...row, plaintext_bytes: String(row.plaintext_bytes) };
  for (const field of ["started_at", "finished_at", "snapshot_at", "ledger_at", "incident_at"]) v[field] = row[field]?.toISOString() ?? null;
  return recoveryReceiptDTO.parse(v);
}
async function guard(tx: Tx, p: Principal) {
  await lockAdminAccess(tx); await requireSensitiveAdmin(tx, p); await permit(tx, p, permission);
  // Infrastructure totals cover every tenant; any explicit scoped deny withdraws the whole view.
  if ((await bindings(tx, p)).some(b => b.effect === "deny" && b.permissions.includes(permission)))
    throw new Problem(403, "ADMIN_FORBIDDEN", "Recovery visibility overlaps an explicit restriction");
}
export function registerNativeRecovery(app: FastifyInstance, db: Database) {
  app.get("/v1/admin/recovery", { preHandler: requireAdmin(db) }, async req => {
    const q = query.parse(req.query);
    return db.tx(async tx => {
      await guard(tx, req.principal);
      const environment = (await tx.query("SELECT source_id,state FROM recovery_environment WHERE singleton")).rows[0];
      const latest = {} as Record<string, any>;
      for (const kind of ["backup", "ledger", "restore"]) {
        const row = (await tx.query("SELECT * FROM recovery_runs WHERE kind=$1 ORDER BY finished_at DESC,id DESC LIMIT 1", [kind])).rows[0]; latest[kind] = row ? dto(row) : null;
      }
      const verified = (await tx.query("SELECT * FROM recovery_runs WHERE kind='backup' AND outcome='verified' ORDER BY snapshot_at DESC,id DESC LIMIT 1")).rows[0];
      if (q.cursor && !(await tx.query("SELECT 1 FROM recovery_runs WHERE id=$1", [q.cursor])).rowCount) throw new Problem(400, "RECOVERY_CURSOR_INVALID", "Recovery cursor is unavailable");
      const rows = (await tx.query("SELECT * FROM recovery_runs WHERE ($1::uuid IS NULL OR (finished_at,id)<(SELECT finished_at,id FROM recovery_runs WHERE id=$1)) AND ($2::text IS NULL OR kind=$2) ORDER BY finished_at DESC,id DESC LIMIT $3", [q.cursor ?? null, q.kind ?? null, q.limit + 1])).rows;
      const now = (await tx.query("SELECT clock_timestamp() AS at")).rows[0].at;
      await guard(tx, req.principal);
      await audit(tx, req.principal, "admin.recovery.read", undefined, "succeeded", { count: Math.min(rows.length, q.limit), kind: q.kind ?? null });
      const items = rows.slice(0, q.limit).map(dto);
      return { environment, checked_at: now.toISOString(), target_rpo_ms: 15 * 60_000, target_rto_ms: 4 * 3600_000,
        backup_age_ms: verified?.snapshot_at ? Math.max(0, +now - +verified.snapshot_at) : null,
        ledger_age_ms: latest.ledger?.ledger_at ? Math.max(0, +now - Date.parse(latest.ledger.ledger_at)) : null,
        production_recovery_qualified: false, latest, last_verified_backup: verified ? dto(verified) : null, items, next_cursor: rows.length > q.limit ? items.at(-1)!.id : null };
    }, undefined, true, req.principal.id);
  });
}
