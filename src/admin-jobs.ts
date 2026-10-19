import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { requireAdmin, audit, type Principal } from "./auth.js";
import {
  permit,
  requireRecentMfa,
  requireSensitiveAdmin,
  lockAdminAccess,
  bindings,
} from "./admin-access.js";
import { Problem, uuid, csvCell, hash, canonical } from "./lib.js";
import { key, replay } from "./access.js";
import {
  accountPolicy,
  changeAccountStatus,
  lockAccountTarget,
  userAccountAuthority,
} from "./admin-accounts.js";
import { lockUserAuthorities } from "./user-authority.js";
async function exportAccessVersion(tx: Tx, p: Principal) {
  const rows = await bindings(tx, p);
  return hash(
    canonical(
      rows
        .map((b) => ({
          id: b.id,
          role: b.role_key,
          scope: b.scope_kind,
          target: b.scope_id,
          effect: b.effect,
          limits: b.limits,
          expires: b.expires_at ? new Date(b.expires_at).toISOString() : null,
          permissions: [...b.permissions].sort(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
  );
}
export function registerAdminJobs(app: FastifyInstance, db: Database) {
  app.post(
    "/v1/admin/exports",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const b = z
        .object({
          source: z.enum(["users", "usage", "billing", "audit"]),
          tenant_id: uuid.optional(),
        })
        .strict()
        .parse(req.body);
      await db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await requireSensitiveAdmin(tx, req.principal);
          await permit(
            tx,
            req.principal,
            "admin.exports.create",
            b.tenant_id ? { tenant: b.tenant_id } : {},
          );
        },
        undefined,
        true,
      );
      const r = await app.inject({
        method: "GET",
        url: `/v1/admin/${b.source}?${b.source === "users" ? "limit=1" : "page_size=1"}${b.tenant_id ? "&tenant_id=" + b.tenant_id : ""}`,
        headers: { cookie: req.headers.cookie ?? "" },
      });
      if (r.statusCode !== 200)
        throw new Problem(
          r.statusCode,
          "EXPORT_FORBIDDEN",
          "The source is not readable",
        );
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await requireSensitiveAdmin(tx, req.principal);
          await permit(
            tx,
            req.principal,
            "admin.exports.create",
            b.tenant_id ? { tenant: b.tenant_id } : {},
          );
          const e = (
            await tx.query(
              "INSERT INTO exports(principal_id,source,permission,scope,state,expires_at) VALUES($1,$2,$3,$4,'ready',now()+interval '15 minutes') RETURNING id,source,state,expires_at",
              [
                req.principal.id,
                b.source,
                `admin.${b.source}.read`,
                { tenant_id: b.tenant_id ?? null },
              ],
            )
          ).rows[0];
          await audit(tx, req.principal, "admin.exports.create", e.id);
          return e;
        },
        undefined,
        true,
      );
    },
  );
  app.get(
    "/v1/admin/exports/:id/download",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      const id = uuid.parse((req.params as any).id);
      const e = await db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await requireSensitiveAdmin(tx, req.principal);
          const e = (
            await tx.query(
              "SELECT *,expires_at>now() AS valid FROM exports WHERE id=$1 AND principal_id=$2",
              [id, req.principal.id],
            )
          ).rows[0];
          if (!e || !e.valid)
            throw new Problem(404, "EXPORT_EXPIRED", "Export expired");
          await permit(
            tx,
            req.principal,
            "admin.exports.download",
            e.scope.tenant_id ? { tenant: e.scope.tenant_id } : {},
          );
          return {
            ...e,
            access_version: await exportAccessVersion(tx, req.principal),
          };
        },
        undefined,
        true,
      );
      const rows: any[] = [];
      let cursor: string | null = null;
      for (let page = 1; page <= 5; page++) {
        const r = await app.inject({
          method: "GET",
          url: `/v1/admin/${e.source}?${e.source === "users" ? "limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "") : "page_size=100&page=" + page}${e.scope.tenant_id ? "&tenant_id=" + e.scope.tenant_id : ""}`,
          headers: { cookie: req.headers.cookie ?? "" },
        });
        if (r.statusCode !== 200)
          throw new Problem(
            403,
            "EXPORT_FORBIDDEN",
            "Source permission changed",
          );
        const data: any = r.json();
        if (e.source !== "users" && data.total > 500)
          throw new Problem(
            409,
            "EXPORT_TOO_LARGE",
            "Narrow the export scope to at most 500 records",
          );
        rows.push(...data.items);
        if (e.source === "users") {
          cursor = data.next_cursor;
          if (!cursor) break;
          if (page === 5)
            throw new Problem(
              409,
              "EXPORT_TOO_LARGE",
              "Narrow the export scope to at most 500 records",
            );
        } else if (data.items.length < 100) break;
      }
      const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const csv =
        "\ufeff" +
        [
          columns.map(csvCell).join(","),
          ...rows.map((r) =>
            columns
              .map((c) =>
                csvCell(
                  typeof r[c] === "object"
                    ? JSON.stringify(r[c])
                    : (r[c] ?? ""),
                ),
              )
              .join(","),
          ),
        ].join("\r\n");
      await db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await requireSensitiveAdmin(tx, req.principal);
          await permit(
            tx,
            req.principal,
            "admin.exports.download",
            e.scope.tenant_id ? { tenant: e.scope.tenant_id } : {},
          );
          if (
            e.access_version !== (await exportAccessVersion(tx, req.principal))
          )
            throw new Problem(
              403,
              "EXPORT_FORBIDDEN",
              "Authorization changed while preparing the export",
            );
          await audit(
            tx,
            req.principal,
            "admin.exports.download",
            id,
            "succeeded",
            {
              rows: rows.length,
              limit: 500,
            },
          );
        },
        undefined,
        true,
      );
      return reply
        .type("text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="copypaste-${e.source}.csv"`,
        )
        .send(csv);
    },
  );
  const batchSchema = z
    .object({
      action: z.literal("users.status"),
      ids: z.array(uuid).min(1).max(100),
      status: z.enum(["active", "suspended"]),
      reason: z.string().min(3).max(2000),
    })
    .strict();
  const snapshot = async (tx: Tx, ids: string[]) =>
    (
      await tx.query(
        "SELECT id,status,auth_version,version,admin_closed_at FROM users WHERE id=ANY($1::uuid[]) ORDER BY id",
        [ids],
      )
    ).rows;
  app.post(
    "/v1/admin/jobs/preview",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const command = batchSchema.parse(req.body);
      command.ids = [...new Set(command.ids)].sort();
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await permit(
            tx,
            req.principal,
            "admin.jobs.create",
            {},
            { batch: command.ids.length },
          );
          await lockUserAuthorities(tx, command.ids);
          for (const id of command.ids) {
            await lockAccountTarget(tx, "users.status.write", id);
            await userAccountAuthority(
              tx,
              req.principal,
              id,
              "admin.users.status.write",
            );
          }
          await requireSensitiveAdmin(tx, req.principal);
          const targets = await snapshot(tx, command.ids),
            policy = await accountPolicy(tx, "users.status.batch");
          if (targets.some((t) => t.admin_closed_at))
            throw new Problem(
              409,
              "ACCOUNT_CLOSED",
              "Use the reviewed account status flow to reopen a closed account",
            );
          const payload = {
            command,
            target_hash: hash(canonical(targets)),
            policy_version_id: policy.id,
          };
          const r = (
            await tx.query(
              "INSERT INTO admin_previews(principal_id,action,payload,payload_hash,expires_at) VALUES($1,'users.status',$2,$3,now()+interval '5 minutes') RETURNING id,payload_hash,expires_at",
              [req.principal.id, payload, hash(canonical(payload))],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "admin.jobs.preview",
            r.id,
            "succeeded",
            { count: command.ids.length, reason: command.reason },
          );
          return {
            ...r,
            command,
            found: targets.length,
            missing: command.ids.length - targets.length,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post("/v1/admin/jobs", { preHandler: requireAdmin(db) }, async (req) => {
    const input = z
      .object({
        preview_id: uuid,
        payload_hash: z.string().regex(/^[a-f\d]{64}$/),
      })
      .strict()
      .parse(req.body);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        await requireSensitiveAdmin(tx, req.principal);
        const source = (
          await tx.query(
            "SELECT * FROM admin_previews WHERE id=$1 AND principal_id=$2 AND action='users.status'",
            [input.preview_id, req.principal.id],
          )
        ).rows[0];
        if (!source || source.payload_hash !== input.payload_hash)
          throw new Problem(
            409,
            "PREVIEW_EXPIRED",
            "Refresh the batch preview",
          );
        const b = batchSchema.parse(source.payload.command);
        await permit(
          tx,
          req.principal,
          "admin.jobs.create",
          {},
          { batch: b.ids.length },
        );
        await lockUserAuthorities(tx, b.ids);
        for (const id of b.ids) {
          await lockAccountTarget(tx, "users.status.write", id);
          await userAccountAuthority(
            tx,
            req.principal,
            id,
            "admin.users.status.write",
          );
        }
        return replay(
          tx,
          req.principal.id,
          "admin.jobs.create",
          key(req),
          input,
          async () => {
            const preview = (
              await tx.query(
                "SELECT *,expires_at>now() AS valid FROM admin_previews WHERE id=$1 FOR UPDATE",
                [source.id],
              )
            ).rows[0];
            if (!preview.valid || preview.consumed_at)
              throw new Problem(
                409,
                "PREVIEW_EXPIRED",
                "Refresh the batch preview",
              );
            await tx.query(
              "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE",
              [b.ids],
            );
            const targets = await snapshot(tx, b.ids),
              policy = await accountPolicy(tx, "users.status.batch");
            if (hash(canonical(targets)) !== preview.payload.target_hash)
              throw new Problem(
                409,
                "TARGET_CHANGED",
                "A user changed; preview the batch again",
              );
            if (preview.payload.policy_version_id !== policy.id)
              throw new Problem(
                409,
                "POLICY_CHANGED",
                "Policy changed; preview the batch again",
              );
            if (targets.some((t) => t.admin_closed_at))
              throw new Problem(
                409,
                "ACCOUNT_CLOSED",
                "Use the reviewed account status flow to reopen a closed account",
              );
            const results = [];
            for (const id of b.ids) {
              const old = targets.find((t) => t.id === id);
              if (old) {
                await changeAccountStatus(
                  tx,
                  "users",
                  id,
                  b.status === "active" ? "active" : "frozen",
                  "stop_new",
                );
                await audit(
                  tx,
                  req.principal,
                  "admin.users.status.write",
                  id,
                  "succeeded",
                  {
                    reason: b.reason,
                    before: old,
                    state: b.status,
                    inflight_policy: "stop_new",
                    batch_preview_id: source.id,
                  },
                );
              }
              results.push({ id, state: old ? "succeeded" : "not_found" });
            }
            const state = results.every((r) => r.state === "succeeded")
              ? "succeeded"
              : "partially_succeeded";
            const job = (
              await tx.query(
                "INSERT INTO admin_operations(principal_id,action,payload_hash,payload,idempotency_key,state,result,policy_version_id,target_ids,result_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,state,result",
                [
                  req.principal.id,
                  b.action,
                  hash(canonical(b)),
                  b,
                  key(req),
                  state,
                  { items: results },
                  policy.id,
                  b.ids,
                  results
                    .filter((r) => r.state === "succeeded")
                    .map((r) => r.id),
                ],
              )
            ).rows[0];
            await tx.query(
              "UPDATE admin_previews SET consumed_at=now() WHERE id=$1",
              [source.id],
            );
            await audit(
              tx,
              req.principal,
              "admin.jobs.create",
              job.id,
              "succeeded",
              {
                reason: b.reason,
                count: results.length,
                policy_version_id: policy.id,
              },
            );
            return job;
          },
        );
      },
      undefined,
      true,
    );
  });
  app.post(
    "/v1/admin/support/:id/revoke",
    { preHandler: requireAdmin(db) },
    async (req) =>
      db.tx(
        async (tx) => {
          const id = uuid.parse((req.params as any).id);
          const r = (
            await tx.query("SELECT * FROM support_sessions WHERE id=$1", [id])
          ).rows[0];
          if (!r)
            throw new Problem(404, "NOT_FOUND", "Support session not found");
          await permit(tx, req.principal, "admin.support.revoke", {
            tenant: r.tenant_id,
          });
          await tx.query(
            "UPDATE support_sessions SET revoked_at=now() WHERE id=$1",
            [id],
          );
          await audit(
            tx,
            req.principal,
            "admin.support.revoke",
            id,
            "succeeded",
            {},
            r.tenant_id,
          );
          return { ok: true };
        },
        undefined,
        true,
      ),
  );
}
