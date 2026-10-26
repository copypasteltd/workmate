import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import { key } from "./access.js";
import {
  bindings,
  lockAdminAccess,
  permit,
  requireSensitiveAdmin,
} from "./admin-access.js";
import {
  accountPolicy,
  accountState,
  changeAccountStatus,
  lockAccountTarget,
  userAccountAuthority,
} from "./admin-accounts.js";
import { readScope } from "./admin-directory.js";
import { canonical, hash, seal, unseal, Problem, uuid } from "./lib.js";
import {
  dataCommand,
  dataLimits,
  dataCsvCell,
  jobConfirmation,
  jobControl,
  type DataCommand,
  type DataTarget,
} from "./admin-data-model.js";
import { captureDataExport, sourcePermissions } from "./admin-data-snapshot.js";

const root = "/v1/admin/data-jobs";
const scopeOf = (c: DataCommand) =>
  c.kind === "export"
    ? { tenant: c.filters.tenant_id, project: c.filters.project_id }
    : {};
const principal = (j: any): Principal => ({
  id: j.principal_id,
  audience: "admin",
  sessionId: j.session_id,
  authVersion: j.auth_version,
  email: "",
  name: "",
  sessionHash: "",
});
const safeCode = (e: unknown) =>
  e instanceof Problem ? e.code : "DATABASE_RETRY_REQUIRED";
const transient = (e: any) =>
  ["40001", "40P01", "55P03", "57014"].includes(e?.code);
const conflict = (
  message = "The preview or target changed; review a fresh preview",
) => new Problem(409, "PREVIEW_STALE", message);

async function accessHash(tx: Tx, p: Principal) {
  return hash(
    canonical(
      (await bindings(tx, p))
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
async function authorize(
  tx: Tx,
  p: Principal,
  c: DataCommand,
  reading = false,
) {
  await lockAdminAccess(tx);
  await requireSensitiveAdmin(tx, p);
  await permit(
    tx,
    p,
    reading ? "admin.jobs.read" : "admin.jobs.create",
    scopeOf(c),
    c.kind === "users.status" ? { batch: c.ids.length } : undefined,
  );
  if (c.kind === "export") {
    await permit(tx, p, "admin.exports.create", scopeOf(c));
    await readScope(tx, p, sourcePermissions[c.source]);
  } else {
    await permit(
      tx,
      p,
      "admin.users.status.write",
      {},
      { batch: c.ids.length },
    );
    await readScope(tx, p, "admin.users.read");
  }
}
async function capture(
  tx: Tx,
  p: Principal,
  c: DataCommand,
  selected?: string[],
): Promise<DataTarget[]> {
  if (c.kind === "export") return captureDataExport(tx, p, c, selected);
  // Account lifecycle commands share the same locks and invariants as the
  // canonical single-account workflow, including overlapping project denies.
  for (const id of [...c.ids].sort()) {
    await lockAccountTarget(tx, "users.status.write", id);
    await userAccountAuthority(tx, p, id, "admin.users.status.write");
  }
  const s = await readScope(tx, p, "admin.users.read");
  const rows = (
    await tx.query(
      `SELECT u.id,u.version,u.auth_version,u.status,u.admin_closed_at FROM users u WHERE u.id=ANY(${s.arg(c.ids)}::uuid[]) AND ${s.user("admin.users.read")} ORDER BY u.id FOR NO KEY UPDATE OF u`,
      s.values,
    )
  ).rows;
  if (rows.length !== c.ids.length)
    throw new Problem(
      404,
      "NOT_FOUND",
      "Some selected accounts are unavailable in your scope",
    );
  if (rows.some((r) => r.admin_closed_at))
    throw new Problem(
      409,
      "ACCOUNT_CLOSED",
      "Reopening a closed account requires the reviewed single-account workflow",
    );
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    fingerprint: hash(canonical(r)),
    row: {
      id: r.id,
      state: accountState(r, "users"),
      version: r.version,
      auth_version: r.auth_version,
    },
  }));
}
const targetFacts = (targets: DataTarget[]) =>
  targets.map(({ id, version, fingerprint }) => ({ id, version, fingerprint }));
const sameTargets = (
  a: DataTarget[],
  b: { id: string; version: number | null; fingerprint: string }[],
) =>
  canonical(targetFacts(a).sort((a, b) => a.id.localeCompare(b.id))) ===
  canonical([...b].sort((a, b) => a.id.localeCompare(b.id)));
function decode<T>(db: Database, cipher: string | null, digest: string): T {
  if (!cipher)
    throw new Problem(
      410,
      "DATA_JOB_EXPIRED",
      "The encrypted snapshot has expired",
    );
  const value = unseal(db.config.MASTER_KEY!, cipher);
  if (hash(value) !== digest)
    throw new Problem(
      409,
      "SNAPSHOT_INTEGRITY",
      "Snapshot integrity verification failed",
    );
  return JSON.parse(value);
}
async function preview(
  db: Database,
  tx: Tx,
  p: Principal,
  c: DataCommand,
  retry?: any,
) {
  await authorize(tx, p, c);
  const targets = await capture(tx, p, c, retry?.ids);
  if (retry && targets.length !== retry.ids.length)
    throw new Problem(
      409,
      "RETRY_SELECTION_CHANGED",
      "Some failed targets are unavailable; create a new explicit selection",
    );
  if (!targets.length)
    throw new Problem(
      409,
      "NO_TARGETS",
      "No records match the authorized selection",
    );
  const policy =
    c.kind === "users.status"
      ? await accountPolicy(tx, "users.status.batch")
      : null;
  const access = await accessHash(tx, p),
    facts = targetFacts(targets);
  const definition = hash(
    canonical({
      command: c,
      access_hash: access,
      policy_version_id: policy?.id ?? null,
      targets: facts,
      retry_of: retry?.id ?? null,
    }),
  );
  const manifest = {
    total: targets.length,
    columns: [...new Set(targets.flatMap((t) => Object.keys(t.row)))].sort(),
    targets: facts,
    policy_version_id: policy?.id ?? null,
    retry_parent_revision: retry?.revision ?? null,
    source: c.kind === "export" ? c.source : "users.status",
    filters: c.kind === "export" ? c.filters : {},
    data_mode: db.config.DEMO_MODE ? "simulated" : "configured_services",
  };
  const payload = canonical(targets);
  const row = (
    await tx.query(
      `INSERT INTO admin_data_previews(principal_id,session_id,auth_version,access_hash,command,definition_hash,retry_of,manifest,payload_ciphertext,payload_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,expires_at`,
      [
        p.id,
        p.sessionId,
        p.authVersion,
        access,
        c,
        definition,
        retry?.id ?? null,
        manifest,
        seal(db.config.MASTER_KEY!, payload),
        hash(payload),
      ],
    )
  ).rows[0];
  await audit(
    tx,
    p,
    "admin.data-jobs.preview",
    row.id,
    "succeeded",
    {
      definition_hash: definition,
      total: targets.length,
      kind: c.kind,
      source: manifest.source,
      retry_of: retry?.id ?? null,
    },
    scopeOf(c).tenant,
  );
  return {
    ...row,
    definition_hash: definition,
    command: c,
    manifest,
    sample: targets.slice(0, 5).map((t) => t.row),
  };
}
async function event(
  tx: Tx,
  job: string,
  action: string,
  actor?: string,
  detail: unknown = {},
  item?: number,
) {
  await tx.query(
    "INSERT INTO admin_data_events(job_id,item_ordinal,action,actor_id,detail) VALUES($1,$2,$3,$4,$5)",
    [job, item ?? null, action, actor ?? null, detail],
  );
}
async function load(tx: Tx, p: Principal, id: string) {
  await lockAdminAccess(tx);
  await requireSensitiveAdmin(tx, p);
  const j = (
    await tx.query(
      "SELECT * FROM admin_data_jobs WHERE id=$1 AND principal_id=$2 FOR UPDATE",
      [id, p.id],
    )
  ).rows[0];
  if (!j) throw new Problem(404, "NOT_FOUND", "Data job not found");
  await permit(tx, p, "admin.jobs.read", scopeOf(j.command));
  return j;
}
function revision(j: any, v: number) {
  if (j.revision !== v)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "The job progressed; refresh before confirming this action",
    );
}
async function fresh(tx: Tx, p: Principal, j: any, reading = false) {
  await authorize(tx, p, dataCommand.parse(j.command), reading);
  if ((await accessHash(tx, p)) !== j.access_hash)
    throw new Problem(
      403,
      "ACCESS_CHANGED",
      "Access changed; create a newly authorized preview",
    );
  if (new Date(j.expires_at).getTime() <= Date.now())
    throw new Problem(410, "DATA_JOB_EXPIRED", "This data job has expired");
  if (
    j.command.kind === "users.status" &&
    (await accountPolicy(tx, "users.status.batch")).id !== j.policy_version_id
  )
    throw new Problem(
      409,
      "POLICY_CHANGED",
      "The account policy changed; create a new reviewed job",
    );
}
async function counts(tx: Tx, id: string) {
  const rows = (
    await tx.query(
      "SELECT state,count(*)::int AS count FROM admin_data_items WHERE job_id=$1 GROUP BY state",
      [id],
    )
  ).rows;
  return Object.fromEntries(
    ["pending", "succeeded", "failed", "cancelled"].map((k) => [
      k,
      rows.find((r) => r.state === k)?.count ?? 0,
    ]),
  ) as Record<string, number>;
}
const dto = (j: any, c: Record<string, number>) => ({
  id: j.id,
  kind: j.command.kind,
  source: j.command.source ?? "users",
  reason: j.command.reason,
  state: j.state,
  revision: j.revision,
  total: j.total,
  counts: c,
  definition_hash: j.definition_hash,
  retry_of: j.retry_of,
  created_at: j.created_at,
  updated_at: j.updated_at,
  expires_at: j.expires_at,
  error_code: j.error_code,
  manifest: j.manifest,
});

export function registerAdminDataJobs(app: FastifyInstance, db: Database) {
  app.post(
    root + "/previews",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      const c = dataCommand.parse(req.body);
      reply.header("Cache-Control", "private, no-store");
      return db.tx((tx) => preview(db, tx, req.principal, c), undefined, true);
    },
  );
  app.post(root, { preHandler: requireAdmin(db) }, async (req, reply) => {
    const b = jobConfirmation.parse(req.body),
      idem = key(req),
      p = req.principal,
      requestHash = hash(canonical(b));
    const result = await db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        await requireSensitiveAdmin(tx, p);
        const old = (
          await tx.query(
            "SELECT * FROM admin_data_jobs WHERE principal_id=$1 AND idempotency_key=$2",
            [p.id, idem],
          )
        ).rows[0];
        if (old) {
          if (old.request_hash !== requestHash)
            throw new Problem(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Use a new key for another preview",
            );
          await fresh(tx, p, old, true);
          return dto(old, await counts(tx, old.id));
        }
        const pre = (
          await tx.query(
            "SELECT * FROM admin_data_previews WHERE id=$1 AND principal_id=$2 FOR UPDATE",
            [b.preview_id, p.id],
          )
        ).rows[0];
        if (
          !pre ||
          pre.definition_hash !== b.definition_hash ||
          pre.session_id !== p.sessionId ||
          pre.auth_version !== p.authVersion ||
          new Date(pre.expires_at).getTime() <= Date.now()
        )
          throw conflict();
        const c = dataCommand.parse(pre.command);
        await authorize(tx, p, c);
        if ((await accessHash(tx, p)) !== pre.access_hash)
          throw conflict("Access changed after preview");
        if (
          (
            await tx.query(
              "SELECT 1 FROM admin_data_jobs WHERE preview_id=$1",
              [pre.id],
            )
          ).rowCount
        )
          throw new Problem(
            409,
            "PREVIEW_CONSUMED",
            "This preview already has a job",
          );
        if (pre.retry_of) {
          const parent = await load(tx, p, pre.retry_of);
          revision(parent, pre.manifest.retry_parent_revision);
          await fresh(tx, p, parent, true);
          if (
            (
              await tx.query(
                "SELECT 1 FROM admin_data_jobs WHERE retry_of=$1",
                [parent.id],
              )
            ).rowCount
          )
            throw conflict(
              "A retry child already exists; follow that child's result",
            );
        }
        const frozen = decode<DataTarget[]>(
          db,
          pre.payload_ciphertext,
          pre.payload_hash,
        );
        const current = await capture(
          tx,
          p,
          c,
          c.kind === "export" ? frozen.map((t) => t.id) : undefined,
        );
        if (!sameTargets(current, pre.manifest.targets)) throw conflict();
        const policy =
          c.kind === "users.status"
            ? await accountPolicy(tx, "users.status.batch")
            : null;
        if ((policy?.id ?? null) !== pre.manifest.policy_version_id)
          throw conflict("The account policy changed after preview");
        const j = (
          await tx.query(
            `INSERT INTO admin_data_jobs(preview_id,principal_id,command,definition_hash,access_hash,policy_version_id,auth_version,session_id,state,total,manifest,idempotency_key,request_hash,retry_of)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$10,$11,$12,$13) RETURNING *`,
            [
              pre.id,
              p.id,
              c,
              pre.definition_hash,
              pre.access_hash,
              policy?.id ?? null,
              p.authVersion,
              p.sessionId,
              frozen.length,
              pre.manifest,
              idem,
              requestHash,
              pre.retry_of,
            ],
          )
        ).rows[0];
        // A single bounded JSON insert, not 10000 round trips in the HTTP request.
        const items = frozen.map((t, i) => {
          const text = canonical(t.row);
          return {
            ordinal: i,
            target_id: t.id,
            target_version: t.version,
            fingerprint: t.fingerprint,
            payload_ciphertext: seal(db.config.MASTER_KEY!, text),
            payload_hash: hash(text),
          };
        });
        await tx.query(
          `INSERT INTO admin_data_items(job_id,ordinal,target_id,target_version,fingerprint,payload_ciphertext,payload_hash)
        SELECT $1,x.ordinal,x.target_id,x.target_version,x.fingerprint,x.payload_ciphertext,x.payload_hash FROM jsonb_to_recordset($2::jsonb)
        AS x(ordinal integer,target_id text,target_version integer,fingerprint text,payload_ciphertext text,payload_hash text)`,
          [j.id, JSON.stringify(items)],
        );
        if (pre.retry_of)
          await tx.query(
            "UPDATE admin_data_jobs SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
            [pre.retry_of],
          );
        await event(tx, j.id, "queued", p.id, {
          definition_hash: j.definition_hash,
          total: j.total,
          retry_of: pre.retry_of,
        });
        await audit(
          tx,
          p,
          "admin.data-jobs.create",
          j.id,
          "queued",
          { kind: c.kind, total: j.total, definition_hash: j.definition_hash },
          scopeOf(c).tenant,
        );
        return dto(j, {
          pending: j.total,
          succeeded: 0,
          failed: 0,
          cancelled: 0,
        });
      },
      undefined,
      true,
    );
    reply.code(202).header("Cache-Control", "private, no-store");
    return result;
  });
  app.get(root, { preHandler: requireAdmin(db) }, async (req, reply) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        before: z.string().datetime({ offset: true }).optional(),
        before_id: uuid.optional(),
      })
      .strict()
      .refine((v) => !!v.before === !!v.before_id, "Supply both cursor fields")
      .parse(req.query);
    reply.header("Cache-Control", "private, no-store");
    return db.tx(
      async (tx) => {
        const p = req.principal;
        await lockAdminAccess(tx);
        await requireSensitiveAdmin(tx, p);
        const access = await accessHash(tx, p);
        const rows = (
          await tx.query(
            "SELECT * FROM admin_data_jobs WHERE principal_id=$1 AND access_hash=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5",
            [p.id, access, q.before ?? null, q.before_id ?? null, q.limit + 1],
          )
        ).rows;
        const items = [];
        for (const j of rows.slice(0, q.limit)) {
          try {
            await authorize(tx, p, j.command, true);
            items.push(dto(j, await counts(tx, j.id)));
          } catch (e) {
            if (!(e instanceof Problem) || e.status !== 403) throw e;
          }
        }
        const last = rows[q.limit - 1];
        return {
          items,
          has_more: rows.length > q.limit,
          next_cursor:
            rows.length > q.limit
              ? {
                  before: new Date(last.created_at).toISOString(),
                  before_id: last.id,
                }
              : null,
        };
      },
      undefined,
      true,
    );
  });
  app.get(
    root + "/:id",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      const id = uuid.parse((req.params as any).id),
        q = z
          .object({
            offset: z.coerce.number().int().min(0).default(0),
            limit: z.coerce.number().int().min(1).max(100).default(50),
          })
          .strict()
          .parse(req.query);
      reply.header("Cache-Control", "private, no-store");
      return db.tx(
        async (tx) => {
          const p = req.principal,
            j = await load(tx, p, id);
          await authorize(tx, p, j.command, true);
          if ((await accessHash(tx, p)) !== j.access_hash)
            throw new Problem(403, "ACCESS_CHANGED", "Access changed");
          const items = (
            await tx.query(
              "SELECT ordinal,target_id,target_version,state,attempts,retryable,error_code,completed_at FROM admin_data_items WHERE job_id=$1 ORDER BY ordinal OFFSET $2 LIMIT $3",
              [id, q.offset, q.limit],
            )
          ).rows;
          const events = (
            await tx.query(
              "SELECT id::text,item_ordinal,action,detail,created_at FROM admin_data_events WHERE job_id=$1 ORDER BY id DESC LIMIT 50",
              [id],
            )
          ).rows;
          return {
            ...dto(j, await counts(tx, id)),
            items,
            events,
            offset: q.offset,
            limit: q.limit,
          };
        },
        undefined,
        true,
      );
    },
  );
  for (const action of ["cancel", "reauthorize", "retry-previews"] as const)
    app.post(
      root + "/:id/" + action,
      { preHandler: requireAdmin(db) },
      async (req, reply) => {
        const id = uuid.parse((req.params as any).id),
          b = jobControl.parse(req.body);
        reply.header("Cache-Control", "private, no-store");
        return db.tx(
          async (tx) => {
            const p = req.principal,
              j = await load(tx, p, id);
            revision(j, b.expected_revision);
            if (action === "cancel") {
              if (
                !["queued", "running", "needs_authorization"].includes(j.state)
              )
                throw new Problem(
                  409,
                  "JOB_TERMINAL",
                  "Only unfinished jobs can be cancelled",
                );
              await tx.query(
                "UPDATE admin_data_items SET state='cancelled',completed_at=clock_timestamp() WHERE job_id=$1 AND state='pending'",
                [id],
              );
              const v = (
                await tx.query(
                  "UPDATE admin_data_jobs SET state='cancelled',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING revision",
                  [id],
                )
              ).rows[0];
              await event(tx, id, "cancelled", p.id, { reason: b.reason });
              await audit(tx, p, "admin.data-jobs.cancel", id, "succeeded", {
                reason: b.reason,
              });
              return { id, state: "cancelled", revision: v.revision };
            }
            await fresh(tx, p, j, true);
            if (action === "reauthorize") {
              await authorize(tx, p, j.command);
              if (j.state !== "needs_authorization")
                throw new Problem(
                  409,
                  "JOB_STATE",
                  "This job is not waiting for authorization",
                );
              await tx.query(
                "UPDATE admin_data_jobs SET state='queued',session_id=$2,auth_version=$3,revision=revision+1,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1",
                [id, p.sessionId, p.authVersion],
              );
              await event(tx, id, "reauthorized", p.id, { reason: b.reason });
              await audit(
                tx,
                p,
                "admin.data-jobs.reauthorize",
                id,
                "succeeded",
                { reason: b.reason },
              );
              return { id, state: "queued", revision: j.revision + 1 };
            }
            if (!["failed", "partially_succeeded"].includes(j.state))
              throw new Problem(
                409,
                "JOB_STATE",
                "Retry only the failed part of a finished job",
              );
            if (
              (
                await tx.query(
                  "SELECT 1 FROM admin_data_jobs WHERE retry_of=$1",
                  [id],
                )
              ).rowCount
            )
              throw new Problem(
                409,
                "RETRY_ALREADY_CREATED",
                "A retry child already exists; open it instead",
              );
            const ids = (
              await tx.query(
                "SELECT target_id FROM admin_data_items WHERE job_id=$1 AND state='failed' ORDER BY ordinal",
                [id],
              )
            ).rows.map((r) => r.target_id);
            const c: DataCommand =
              j.command.kind === "users.status"
                ? { ...j.command, ids, reason: b.reason }
                : { ...j.command, reason: b.reason };
            return preview(db, tx, p, c, { id, revision: j.revision, ids });
          },
          undefined,
          true,
        );
      },
    );
  app.get(
    root + "/:id/download",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      const id = uuid.parse((req.params as any).id),
        q = z
          .object({
            accept_partial: z.enum(["true"]).optional(),
            format: z.enum(["csv", "manifest"]).default("csv"),
          })
          .strict()
          .parse(req.query);
      const out = await db.tx(
        async (tx) => {
          const p = req.principal,
            j = await load(tx, p, id);
          await fresh(tx, p, j, true);
          if (
            j.command.kind !== "export" ||
            !["succeeded", "partially_succeeded"].includes(j.state)
          )
            throw new Problem(
              409,
              "EXPORT_NOT_READY",
              "This export is not ready",
            );
          await permit(tx, p, "admin.exports.download", scopeOf(j.command));
          if (j.state === "partially_succeeded" && q.accept_partial !== "true")
            throw new Problem(
              409,
              "PARTIAL_EXPORT_CONFIRMATION",
              "Review the missing records and explicitly accept a partial file",
            );
          const items = (
            await tx.query(
              "SELECT * FROM admin_data_items WHERE job_id=$1 AND state='succeeded' ORDER BY ordinal",
              [id],
            )
          ).rows;
          const current = await captureDataExport(
            tx,
            p,
            j.command,
            items.map((i) => i.target_id),
            true,
          );
          if (
            !sameTargets(
              current,
              items.map((i) => ({
                id: i.target_id,
                version: i.target_version,
                fingerprint: i.fingerprint,
              })),
            )
          )
            throw new Problem(
              409,
              "EXPORT_CHANGED",
              "A frozen record or its authorization changed; create a new export",
            );
          const c = await counts(tx, id);
          await event(tx, id, "downloaded", p.id, {
            format: q.format,
            rows: items.length,
            partial: c.failed > 0,
          });
          await audit(
            tx,
            p,
            "admin.data-jobs.download",
            id,
            "succeeded",
            {
              definition_hash: j.definition_hash,
              rows: items.length,
              partial: c.failed > 0,
            },
            scopeOf(j.command).tenant,
          );
          if (q.format === "manifest")
            return {
              type: "application/json; charset=utf-8",
              ext: "json",
              body: JSON.stringify(
                {
                  id,
                  definition_hash: j.definition_hash,
                  source: j.command.source,
                  filters: j.command.filters,
                  counts: c,
                  manifest: j.manifest,
                  created_at: j.created_at,
                  expires_at: j.expires_at,
                },
                null,
                2,
              ),
            };
          const columns = j.manifest.columns as string[];
          const lines = items.map((i) => {
            const row = decode<Record<string, unknown>>(
              db,
              i.payload_ciphertext,
              i.payload_hash,
            );
            return columns.map((k) => dataCsvCell(row[k])).join(",");
          });
          return {
            type: "text/csv; charset=utf-8",
            ext: "csv",
            body:
              "\ufeff" +
              [columns.map(dataCsvCell).join(","), ...lines].join("\r\n") +
              "\r\n",
          };
        },
        undefined,
        true,
      );
      return reply
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header(
          "Content-Disposition",
          `attachment; filename="workmate-data-${id}.${out.ext}"`,
        )
        .type(out.type)
        .send(out.body);
    },
  );
}

/** Maintenance runs without a browser. Each item's domain mutation, outcome and
 * audit event commit together. A crash rolls back all three, so another worker
 * can safely pick it up. The shared authority gate serializes permission edits
 * before job/subject locks; no external request is made inside this transaction. */
export async function advanceAdminDataJobs(
  db: Database,
  limit: number = dataLimits.processItems,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > dataLimits.processItems)
    throw new Error("Bound data job processing to 1..30 items");
  await db.tx(
    async (tx) => {
      await lockAdminAccess(tx);
      await tx.query(
        "UPDATE admin_data_previews SET payload_ciphertext=NULL WHERE expires_at<=clock_timestamp() AND payload_ciphertext IS NOT NULL",
      );
      const expired = (
        await tx.query(
          "SELECT id FROM admin_data_jobs WHERE expires_at<=clock_timestamp() AND state<>'expired' ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED",
        )
      ).rows;
      for (const j of expired) {
        await tx.query(
          "UPDATE admin_data_items SET state='cancelled',completed_at=clock_timestamp() WHERE job_id=$1 AND state='pending'",
          [j.id],
        );
        await tx.query(
          "UPDATE admin_data_items SET payload_ciphertext=NULL WHERE job_id=$1 AND payload_ciphertext IS NOT NULL",
          [j.id],
        );
        await tx.query(
          "UPDATE admin_data_jobs SET state='expired',revision=revision+1,updated_at=clock_timestamp(),error_code='DATA_JOB_EXPIRED' WHERE id=$1",
          [j.id],
        );
        await event(tx, j.id, "expired", undefined, {
          encrypted_payload_erased: true,
        });
      }
    },
    undefined,
    true,
  );
  let processed = 0;
  for (let n = 0; n < limit; n++) {
    const result = await db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const j = (
          await tx.query(`SELECT j.* FROM admin_data_jobs j WHERE j.state IN('queued','running') AND j.expires_at>clock_timestamp()
        AND EXISTS(SELECT 1 FROM admin_data_items i WHERE i.job_id=j.id AND i.state='pending' AND i.next_attempt_at<=clock_timestamp()) ORDER BY j.updated_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED`)
        ).rows[0];
        if (!j) return false;
        const p = principal(j);
        try {
          await fresh(tx, p, j);
        } catch (e) {
          if (!(e instanceof Problem)) throw e;
          await tx.query(
            "UPDATE admin_data_jobs SET state='needs_authorization',revision=revision+1,error_code=$2,updated_at=clock_timestamp() WHERE id=$1",
            [j.id, e.code],
          );
          await event(tx, j.id, "needs_authorization", undefined, {
            error_code: e.code,
          });
          return true;
        }
        const i = (
          await tx.query(
            "SELECT * FROM admin_data_items WHERE job_id=$1 AND state='pending' AND next_attempt_at<=clock_timestamp() ORDER BY ordinal LIMIT 1 FOR UPDATE",
            [j.id],
          )
        ).rows[0];
        await tx.query("SAVEPOINT data_item_action");
        let outcome = "succeeded",
          error: string | null = null,
          retryable = false;
        try {
          const c = dataCommand.parse(j.command),
            one: DataCommand =
              c.kind === "users.status" ? { ...c, ids: [i.target_id] } : c;
          const now = await capture(
            tx,
            p,
            one,
            c.kind === "export" ? [i.target_id] : undefined,
          );
          if (
            !sameTargets(now, [
              {
                id: i.target_id,
                version: i.target_version,
                fingerprint: i.fingerprint,
              },
            ])
          )
            throw new Problem(
              409,
              "TARGET_CHANGED",
              "The frozen target changed before execution",
            );
          decode(db, i.payload_ciphertext, i.payload_hash);
          if (c.kind === "users.status")
            await changeAccountStatus(
              tx,
              "users",
              i.target_id,
              c.state,
              "stop_new",
            );
          await audit(
            tx,
            p,
            "admin.data-jobs.item",
            i.target_id,
            "succeeded",
            {
              job_id: j.id,
              ordinal: i.ordinal,
              definition_hash: j.definition_hash,
              kind: c.kind,
              expected_version: i.target_version,
              requested_state: c.kind === "users.status" ? c.state : undefined,
            },
            scopeOf(c).tenant,
          );
          await tx.query("RELEASE SAVEPOINT data_item_action");
        } catch (e) {
          await tx.query("ROLLBACK TO SAVEPOINT data_item_action");
          await tx.query("RELEASE SAVEPOINT data_item_action");
          error = safeCode(e);
          retryable = transient(e);
          outcome =
            retryable && i.attempts + 1 < dataLimits.attempts
              ? "pending"
              : "failed";
          await audit(
            tx,
            p,
            "admin.data-jobs.item",
            i.target_id,
            "failed",
            { job_id: j.id, ordinal: i.ordinal, error_code: error },
            scopeOf(j.command).tenant,
          );
        }
        await tx.query(
          "UPDATE admin_data_items SET state=$3,attempts=attempts+1,retryable=$4,error_code=$5,next_attempt_at=clock_timestamp()+($6::int*interval '1 second'),completed_at=CASE WHEN $3='pending' THEN NULL ELSE clock_timestamp() END WHERE job_id=$1 AND ordinal=$2",
          [
            j.id,
            i.ordinal,
            outcome,
            retryable,
            error,
            Math.min(30, 2 ** i.attempts),
          ],
        );
        await event(
          tx,
          j.id,
          outcome === "pending" ? "item_retry_scheduled" : "item_" + outcome,
          undefined,
          {
            target_id: i.target_id,
            attempt: i.attempts + 1,
            error_code: error,
          },
          i.ordinal,
        );
        const c = await counts(tx, j.id),
          state = c.pending
            ? "running"
            : c.failed
              ? c.succeeded
                ? "partially_succeeded"
                : "failed"
              : "succeeded";
        await tx.query(
          "UPDATE admin_data_jobs SET state=$2,revision=revision+1,updated_at=clock_timestamp(),error_code=NULL WHERE id=$1",
          [j.id, state],
        );
        if (!c.pending)
          await event(tx, j.id, "completed", undefined, { state, counts: c });
        return true;
      },
      undefined,
      true,
    );
    if (!result) break;
    processed++;
  }
  return { processed };
}
