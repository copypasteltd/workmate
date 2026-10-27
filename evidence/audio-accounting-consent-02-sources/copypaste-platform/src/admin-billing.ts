import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { requireAdmin, requireUser, audit } from "./auth.js";
import { billingAccount } from "./billing.js";
import {
  readScope,
  pageBounds,
  pageCursor,
  type ReadScope,
} from "./admin-directory.js";
import { currentUserAuthority, lockUserAuthorities } from "./user-authority.js";
import { Problem, uuid } from "./lib.js";

const pageQuery = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const accountsQuery = pageQuery.extend({ subject_id: uuid.optional() });
const money = (amount: string) => ({ currency: "HKD", amount_micros: amount });
const mode = (db: Database) =>
  db.config.DEMO_MODE ? "simulated" : "configured_services";
const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// Account locking, expiry, debt and funding buckets share the execution engine.
// A list never manufactures a paid balance by subtracting arbitrary totals.
export async function billingAccountDTO(tx: Tx, id: string) {
  const w = await billingAccount(tx, id);
  const funds = (
    await tx.query(
      "SELECT coalesce(sum(remaining_micros) FILTER(WHERE kind='paid'),0)::text AS paid,coalesce(sum(remaining_micros) FILTER(WHERE kind='gift'),0)::text AS promotional FROM funding_lots WHERE billing_account_id=$1",
      [id],
    )
  ).rows[0];
  const asof = (await tx.query("SELECT clock_timestamp() AS at")).rows[0].at;
  return {
    id: w.id,
    subject: {
      kind: w.user_id ? "user" : "tenant",
      id: w.user_id ?? w.tenant_id,
    },
    version: w.version,
    paid_balance: money(funds.paid),
    promotional_balance: money(funds.promotional),
    reserved: money(w.reserved_micros),
    credit_limit: money(w.credit_limit_micros),
    debt: money(w.debt_micros),
    as_of: asof.toISOString(),
  };
}
async function visibleAccount(tx: Tx, db: Database, s: ReadScope, id: string) {
  const row = (
    await tx.query(
      `SELECT w.id FROM wallets w WHERE w.id=${s.arg(id)} AND w.data_mode=${s.arg(mode(db))} AND ${s.account("admin.billing.read")}`,
      s.values,
    )
  ).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Billing account not found");
  return row.id as string;
}
export function registerAdminBilling(app: FastifyInstance, db: Database) {
  app.get(
    "/v1/admin/billing/accounts",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const q = accountsQuery.parse(req.query);
      return db.tx(
        async (tx) => {
          const s = await readScope(tx, req.principal, "admin.billing.read");
          const bounds = await pageBounds(
            tx,
            db,
            req.principal,
            s,
            { ...q, data_mode: mode(db) },
            "billing_accounts",
          );
          let where = `w.data_mode=${s.arg(mode(db))} AND ${s.account("admin.billing.read")} AND w.registered_at<=${s.arg(bounds.asof)}::timestamptz`;
          if (q.subject_id)
            where += ` AND coalesce(w.user_id,w.tenant_id)=${s.arg(q.subject_id)}::uuid`;
          if (bounds.after)
            where += ` AND (w.registered_at,w.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
          const rows = (
            await tx.query(
              `SELECT w.id,${stamp("w.registered_at")} AS cursor_at FROM wallets w WHERE ${where} ORDER BY w.registered_at DESC,w.id DESC LIMIT ${s.arg(q.limit + 1)}`,
              s.values,
            )
          ).rows;
          const selected = rows.slice(0, q.limit);
          const items = [];
          // Deterministic account lock order prevents a list from deadlocking with
          // another list whose page order differs after a registration.
          const dtos = new Map();
          for (const row of [...selected].sort((a, b) =>
            a.id.localeCompare(b.id),
          ))
            dtos.set(row.id, await billingAccountDTO(tx, row.id));
          for (const row of selected) items.push(dtos.get(row.id));
          await audit(tx, req.principal, "admin.billing.read", "accounts");
          return {
            items,
            next_cursor:
              rows.length > q.limit
                ? pageCursor(db, bounds, selected.at(-1))
                : null,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.get(
    "/v1/admin/billing/accounts/:account",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).account);
      z.object({}).strict().parse(req.query);
      return db.tx(
        async (tx) => {
          const s = await readScope(tx, req.principal, "admin.billing.read");
          await visibleAccount(tx, db, s, id);
          const dto = await billingAccountDTO(tx, id);
          await audit(tx, req.principal, "admin.billing.read", id);
          return dto;
        },
        undefined,
        true,
      );
    },
  );
  app.get(
    "/v1/admin/billing/accounts/:account/ledger",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).account),
        q = pageQuery.parse(req.query);
      return db.tx(
        async (tx) => {
          const s = await readScope(tx, req.principal, "admin.billing.read");
          await visibleAccount(tx, db, s, id);
          // Missing recorded history must be reconciled, never filled with invented
          // principals, funding buckets or operation identifiers in an API response.
          if (
            (
              await tx.query(
                "SELECT 1 FROM billing_provenance_gaps WHERE billing_account_id=$1 LIMIT 1",
                [id],
              )
            ).rowCount
          )
            throw new Problem(
              409,
              "BILLING_PROVENANCE_UNRECORDED",
              "Historical financial provenance needs controlled reconciliation",
            );
          const bounds = await pageBounds(
            tx,
            db,
            req.principal,
            s,
            { ...q, account_id: id, data_mode: mode(db) },
            "billing_ledger",
          );
          const values: unknown[] = [id, bounds.asof];
          let after = "";
          if (bounds.after) {
            values.push(bounds.after.at, bounds.after.id);
            after = " AND (j.created_at,j.id)<($3::timestamptz,$4::uuid)";
          }
          values.push(q.limit + 1);
          const rows = (
            await tx.query(
              `SELECT j.*,${stamp("j.created_at")} AS cursor_at FROM billing_journal j WHERE j.billing_account_id=$1 AND j.registered_at<=$2::timestamptz${after} ORDER BY j.created_at DESC,j.id DESC LIMIT $${values.length}`,
              values,
            )
          ).rows;
          const selected = rows.slice(0, q.limit);
          await audit(tx, req.principal, "admin.billing.read", id);
          return {
            items: selected.map((j) => ({
              id: j.id,
              billing_account_id: j.billing_account_id,
              operation_id: j.operation_id,
              actor_id: j.actor_id,
              kind: j.kind,
              direction: j.direction,
              amount: money(j.amount_micros),
              bucket: j.bucket,
              created_at: j.created_at.toISOString(),
              reason: j.reason,
              ...(j.source_entry_id
                ? { source_entry_id: j.source_entry_id }
                : {}),
              ...(j.payment_record_id
                ? { payment_record_id: j.payment_record_id }
                : {}),
            })),
            next_cursor:
              rows.length > q.limit
                ? pageCursor(db, bounds, selected.at(-1))
                : null,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.get(
    "/v1/me/billing-accounts",
    { preHandler: requireUser(db) },
    async (req) => {
      z.object({}).strict().parse(req.query);
      return db.tx(
        async (tx) => {
          await lockUserAuthorities(tx, [req.principal.id]);
          await currentUserAuthority(tx, req.principal);
          const rows = (
            await tx.query(
              "SELECT id FROM wallets WHERE user_id=$1 AND data_mode=$2 ORDER BY id",
              [req.principal.id, mode(db)],
            )
          ).rows;
          const items = [];
          for (const row of rows)
            items.push(await billingAccountDTO(tx, row.id));
          return { items };
        },
        undefined,
        false,
        req.principal.id,
      );
    },
  );
}
