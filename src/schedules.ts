import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { requireUser, requireAdmin, audit, type Principal } from "./auth.js";
import { projectAccess, key, replay, eraseReplayContent } from "./access.js";
import { permit, scopePredicate, requireRecentMfa } from "./admin-access.js";
import { Problem, uuid, name, hash, canonical } from "./lib.js";
import { workflow } from "./business.js";
import {
  calendarInput,
  nextOccurrence,
  latestOccurrence,
  countOpportunities,
  type CalendarOccurrence,
} from "./schedule-time.js";

const root = "/v1/tenants/:tenant/projects/:project/workflow-schedules";
const params = z.object({ tenant: uuid, project: uuid });
const input = z
  .object({
    name,
    workflow_id: uuid,
    calendar: calendarInput,
    catch_up: z.enum(["latest", "skip"]).default("latest"),
    starts_at: z.string().datetime({ offset: true }).optional(),
    ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
const confirmation = input
  .extend({
    expected_workflow_version: z.number().int().positive(),
    expected_definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const reason = z.string().trim().min(5).max(1000);
type ScheduleBody = {
  calendar: z.infer<typeof calendarInput>;
  catch_up: "latest" | "skip";
  starts_at: string;
  ends_at: string | null;
  workflow_version: number;
  definition_hash: string;
  definition: z.infer<typeof workflow>;
  role_hashes: Record<string, string>;
  run_as: string;
  actor_auth_version: number;
  max_budget_micros: number;
};
async function prepare(
  tx: Tx,
  catalog: Catalog,
  actor: Principal,
  tenant: string,
  project: string,
  b: z.infer<typeof input>,
  expected?: {
    expected_workflow_version: number;
    expected_definition_hash: string;
  },
) {
  const w = (
    await tx.query(
      "SELECT * FROM workflows WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND state='published' AND content_state='active' FOR SHARE",
      [b.workflow_id, tenant, project],
    )
  ).rows[0];
  if (!w)
    throw new Problem(
      409,
      "WORKFLOW_NOT_PUBLISHED",
      "Choose a published, active workflow",
    );
  const definition = workflow.parse(w.definition),
    digest = hash(canonical(definition));
  if (
    expected &&
    (w.version !== expected.expected_workflow_version ||
      digest !== expected.expected_definition_hash)
  )
    throw new Problem(
      409,
      "WORKFLOW_VERSION_CHANGED",
      "Preview the current workflow before confirming",
    );
  const start = b.starts_at ? Date.parse(b.starts_at) : Date.now(),
    end = b.ends_at ? Date.parse(b.ends_at) : null;
  if (
    start < Date.now() - 300_000 ||
    (end !== null && (end <= start || end <= Date.now()))
  )
    throw new Problem(
      400,
      "SCHEDULE_INTERVAL",
      "Start must be current or future, and end must follow start",
    );
  const hashes: Record<string, string> = {};
  let budget = 0;
  for (const step of definition.steps) {
    if (step.kind === "analytics.summary") {
      if (
        !(
          await tx.query(
            "SELECT 1 FROM analytics_datasets WHERE id=$1 AND project_id=$2 AND content_state='active'",
            [step.dataset_id, project],
          )
        ).rowCount
      )
        throw new Problem(
          404,
          "DATASET_NOT_FOUND",
          "The workflow's source dataset is unavailable",
        );
    } else if (step.kind === "codex") {
      const role = catalog.role(step.role_key);
      await catalog.boundSkills(role);
      await catalog.ensureEnabled(tx, step.role_key);
      hashes[step.role_key] = catalog.digest(role);
      budget += step.budget_micros;
    }
  }
  const body: ScheduleBody = {
    calendar: { ...b.calendar, weekdays: [...b.calendar.weekdays].sort() },
    catch_up: b.catch_up,
    starts_at: new Date(start).toISOString(),
    ends_at: end === null ? null : new Date(end).toISOString(),
    workflow_version: w.version,
    definition_hash: digest,
    definition,
    role_hashes: hashes,
    run_as: actor.id,
    actor_auth_version: actor.authVersion,
    max_budget_micros: budget,
  };
  const first = nextOccurrence(body.calendar, start - 1);
  if (end !== null && first.due_ms >= end)
    throw new Problem(
      400,
      "SCHEDULE_EMPTY",
      "There is no scheduled time within the active interval",
    );
  return { body, first };
}
function nextTimes(body: ScheduleBody, after: number, count = 5) {
  const items: CalendarOccurrence[] = [];
  let point = Math.max(after, Date.parse(body.starts_at) - 1);
  for (let i = 0; i < count; i++) {
    const occurrence = nextOccurrence(body.calendar, point);
    if (body.ends_at && occurrence.due_ms >= Date.parse(body.ends_at)) break;
    items.push(occurrence);
    point = occurrence.due_ms;
  }
  return items;
}
async function readSchedule(
  tx: Tx,
  id: string,
  project?: string,
  lock = false,
) {
  const row = (
    await tx.query(
      `SELECT s.*,v.body FROM workflow_schedules s JOIN workflow_schedule_versions v ON v.schedule_id=s.id AND v.revision=s.revision WHERE s.id=$1 ${project ? "AND s.project_id=$2" : ""} ${lock ? "FOR UPDATE OF s" : ""}`,
      project ? [id, project] : [id],
    )
  ).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Schedule not found");
  return row;
}
function versionMatches(row: any, expected: number) {
  if (row.version !== expected)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "The schedule changed; refresh before updating it",
    );
  if (row.state === "retired" || row.content_state !== "active")
    throw new Problem(
      409,
      "SCHEDULE_RETIRED",
      "This schedule cannot be restarted",
    );
}
async function appendVersion(
  tx: Tx,
  row: any,
  body: ScheduleBody,
  actor: Principal,
  first: CalendarOccurrence,
  label: string,
) {
  const revision = row.revision + 1;
  await tx.query(
    "INSERT INTO workflow_schedule_versions(schedule_id,revision,tenant_id,project_id,body,created_by) VALUES($1,$2,$3,$4,$5,$6)",
    [row.id, revision, row.tenant_id, row.project_id, body, actor.id],
  );
  await tx.query(
    "UPDATE workflow_schedules SET name=$2,revision=$3,version=version+1,state='active',next_due_at=$4,last_error=NULL,updated_at=now() WHERE id=$1",
    [row.id, label, revision, first.due_at],
  );
}
export function registerSchedules(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  app.get(root, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      return {
        items: (
          await tx.query(
            "SELECT s.*,v.body FROM workflow_schedules s JOIN workflow_schedule_versions v ON v.schedule_id=s.id AND v.revision=s.revision WHERE s.project_id=$1 ORDER BY s.created_at DESC LIMIT 100",
            [project],
          )
        ).rows,
        occurrences: (
          await tx.query(
            "SELECT o.*,r.state AS run_state FROM workflow_schedule_occurrences o LEFT JOIN workflow_runs r ON r.id=o.run_id WHERE o.project_id=$1 ORDER BY o.created_at DESC,o.id DESC LIMIT 100",
            [project],
          )
        ).rows,
      };
    }, tenant);
  });
  app.post(root + "/preview", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params),
      b = input.parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "manage");
      const { body } = await prepare(
        tx,
        catalog,
        req.principal,
        tenant,
        project,
        b,
      );
      return {
        input: { ...b, starts_at: body.starts_at, ends_at: body.ends_at },
        workflow_version: body.workflow_version,
        definition_hash: body.definition_hash,
        run_as: body.run_as,
        max_budget_micros: body.max_budget_micros,
        next: nextTimes(body, Date.now() - 1),
      };
    }, tenant);
  });
  app.post(root, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params),
      b = confirmation.parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "manage");
      return replay(
        tx,
        req.principal.id,
        `schedule.create:${project}`,
        key(req),
        b,
        async () => {
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`schedules:${project}`],
          );
          if (
            Number(
              (
                await tx.query(
                  "SELECT count(*) FROM workflow_schedules WHERE project_id=$1 AND state<>'retired'",
                  [project],
                )
              ).rows[0].count,
            ) >= 50
          )
            throw new Problem(
              409,
              "SCHEDULE_LIMIT",
              "Each project supports up to 50 non-retired schedules",
            );
          const { body, first } = await prepare(
            tx,
            catalog,
            req.principal,
            tenant,
            project,
            b,
            b,
          );
          const row = (
            await tx.query(
              "INSERT INTO workflow_schedules(tenant_id,project_id,workflow_id,name,created_by,next_due_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              [
                tenant,
                project,
                b.workflow_id,
                b.name,
                req.principal.id,
                first.due_at,
              ],
            )
          ).rows[0];
          await tx.query(
            "INSERT INTO workflow_schedule_versions(schedule_id,revision,tenant_id,project_id,body,created_by) VALUES($1,1,$2,$3,$4,$5)",
            [row.id, tenant, project, body, req.principal.id],
          );
          await audit(
            tx,
            req.principal,
            "schedule.create",
            row.id,
            "succeeded",
            { revision: 1, workflow_id: b.workflow_id },
            tenant,
          );
          return { ...row, body };
        },
      );
    }, tenant);
  });
  app.get(root + "/:id", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project, id } = params
      .extend({ id: uuid })
      .parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      const row = await readSchedule(tx, id, project);
      return {
        ...row,
        versions: (
          await tx.query(
            "SELECT revision,body,created_by,created_at FROM workflow_schedule_versions WHERE schedule_id=$1 ORDER BY revision DESC LIMIT 100",
            [id],
          )
        ).rows,
        next: row.state === "active" ? nextTimes(row.body, Date.now() - 1) : [],
      };
    }, tenant);
  });
  app.post(
    root + "/:id/versions",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, id } = params
        .extend({ id: uuid })
        .parse(req.params);
      const b = confirmation
        .extend({ expected_version: z.number().int().positive() })
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "manage");
        return replay(
          tx,
          req.principal.id,
          `schedule.version:${id}`,
          key(req),
          b,
          async () => {
            const row = await readSchedule(tx, id, project, true);
            versionMatches(row, b.expected_version);
            if (row.workflow_id !== b.workflow_id)
              throw new Problem(
                409,
                "SCHEDULE_WORKFLOW_FIXED",
                "Create a separate schedule for another workflow",
              );
            const { body, first } = await prepare(
              tx,
              catalog,
              req.principal,
              tenant,
              project,
              {
                ...b,
                starts_at: new Date(
                  Math.max(
                    Date.now(),
                    b.starts_at ? Date.parse(b.starts_at) : 0,
                  ),
                ).toISOString(),
              },
              b,
            );
            await appendVersion(tx, row, body, req.principal, first, b.name);
            await audit(
              tx,
              req.principal,
              "schedule.version",
              id,
              "succeeded",
              { revision: row.revision + 1 },
              tenant,
            );
            return readSchedule(tx, id, project);
          },
        );
      }, tenant);
    },
  );
  app.post(
    root + "/:id/status",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project, id } = params
        .extend({ id: uuid })
        .parse(req.params);
      const b = z
        .object({
          expected_version: z.number().int().positive(),
          action: z.enum(["pause", "resume", "retire"]),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "manage");
        return replay(
          tx,
          req.principal.id,
          `schedule.status:${id}`,
          key(req),
          b,
          async () => {
            const row = await readSchedule(tx, id, project, true);
            versionMatches(row, b.expected_version);
            if (b.action === "resume") {
              if (row.state === "active")
                throw new Problem(
                  409,
                  "SCHEDULE_ACTIVE",
                  "The schedule is already active",
                );
              const old: ScheduleBody = row.body;
              const { body, first } = await prepare(
                tx,
                catalog,
                req.principal,
                tenant,
                project,
                {
                  name: row.name,
                  workflow_id: row.workflow_id,
                  calendar: old.calendar,
                  catch_up: old.catch_up,
                  starts_at: new Date(
                    Math.max(Date.now(), Date.parse(old.starts_at)),
                  ).toISOString(),
                  ends_at: old.ends_at,
                },
                {
                  expected_workflow_version: old.workflow_version,
                  expected_definition_hash: old.definition_hash,
                },
              );
              await appendVersion(
                tx,
                row,
                body,
                req.principal,
                first,
                row.name,
              );
            } else
              await tx.query(
                "UPDATE workflow_schedules SET state=$2,next_due_at=NULL,version=version+1,updated_at=now() WHERE id=$1",
                [id, b.action === "pause" ? "paused" : "retired"],
              );
            await audit(
              tx,
              req.principal,
              `schedule.${b.action}`,
              id,
              "succeeded",
              {},
              tenant,
            );
            return readSchedule(tx, id, project);
          },
        );
      }, tenant);
    },
  );
  app.get(
    "/v1/admin/workflow-schedules",
    { preHandler: requireAdmin(db) },
    async (req) =>
      db.tx(
        async (tx) => {
          const q = z
            .object({
              page: z.coerce.number().int().min(1).max(100000).default(1),
              page_size: z.coerce.number().int().min(1).max(100).default(25),
              search: z.string().max(160).default(""),
            })
            .parse(req.query);
          const scope = await scopePredicate(
            tx,
            req.principal,
            "admin.execution.read",
            "s.tenant_id",
            "s.project_id",
          );
          const args: any[] = [...scope.values, `%${q.search}%`],
            n = args.length;
          const where = `${scope.sql} AND s.name ILIKE $${n}`;
          const total = Number(
            (
              await tx.query(
                `SELECT count(*) FROM workflow_schedules s WHERE ${where}`,
                args,
              )
            ).rows[0].count,
          );
          const items = (
            await tx.query(
              `SELECT s.*,v.body->>'run_as' AS run_as,v.body->'calendar' AS calendar FROM workflow_schedules s JOIN workflow_schedule_versions v ON v.schedule_id=s.id AND v.revision=s.revision WHERE ${where} ORDER BY s.created_at DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
              [...args, q.page_size, (q.page - 1) * q.page_size],
            )
          ).rows;
          return { items, total, page: q.page, page_size: q.page_size };
        },
        undefined,
        true,
      ),
  );
  app.post(
    "/v1/admin/workflow-schedules/:id/pause",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id),
        b = z
          .object({ expected_version: z.number().int().positive(), reason })
          .strict()
          .parse(req.body);
      return db.tx(
        async (tx) => {
          const row = await readSchedule(tx, id, undefined, true);
          await permit(tx, req.principal, "admin.execution.pause", {
            tenant: row.tenant_id,
            project: row.project_id,
          });
          await requireRecentMfa(tx, req.principal);
          return replay(
            tx,
            req.principal.id,
            `admin.schedule.pause:${id}`,
            key(req),
            b,
            async () => {
              versionMatches(row, b.expected_version);
              await tx.query(
                "UPDATE workflow_schedules SET state='paused',next_due_at=NULL,version=version+1,updated_at=now() WHERE id=$1",
                [id],
              );
              await audit(
                tx,
                req.principal,
                "admin.execution.pause",
                id,
                "succeeded",
                { kind: "workflow_schedule", reason: b.reason },
                row.tenant_id,
              );
              return { ok: true };
            },
          );
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/workflow-schedules/:id/resume",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id),
        b = z
          .object({ expected_version: z.number().int().positive(), reason })
          .strict()
          .parse(req.body);
      return db.tx(
        async (tx) => {
          const row = await readSchedule(tx, id, undefined, true);
          await permit(tx, req.principal, "admin.execution.resume", {
            tenant: row.tenant_id,
            project: row.project_id,
          });
          await requireRecentMfa(tx, req.principal);
          return replay(
            tx,
            req.principal.id,
            `admin.schedule.resume:${id}`,
            key(req),
            b,
            async () => {
              versionMatches(row, b.expected_version);
              if (row.state === "active")
                throw new Problem(
                  409,
                  "SCHEDULE_ACTIVE",
                  "The schedule is already active",
                );
              const body: ScheduleBody = row.body;
              const user = (
                await tx.query("SELECT id,email,name FROM users WHERE id=$1", [
                  body.run_as,
                ])
              ).rows[0];
              const actor: Principal = {
                id: body.run_as,
                email: user?.email ?? "",
                name: user?.name ?? "",
                audience: "user",
                authVersion: body.actor_auth_version,
                sessionId: "",
                sessionHash: "",
              };
              try {
                await projectAccess(
                  tx,
                  actor,
                  row.tenant_id,
                  row.project_id,
                  "write",
                );
              } catch (error) {
                if (!(error instanceof Problem)) throw error;
                throw new Problem(
                  409,
                  "RUN_AUTHORIZATION_REQUIRED",
                  "A project administrator must confirm a new execution authorization",
                );
              }
              if (
                !(
                  await tx.query(
                    "SELECT 1 FROM workflows WHERE id=$1 AND content_state='active' AND state='published'",
                    [row.workflow_id],
                  )
                ).rowCount
              )
                throw new Problem(
                  409,
                  "WORKFLOW_UNAVAILABLE",
                  "The workflow must be active and published",
                );
              const first = nextOccurrence(
                body.calendar,
                Math.max(Date.now(), Date.parse(body.starts_at)) - 1,
              );
              if (body.ends_at && first.due_ms >= Date.parse(body.ends_at))
                throw new Problem(
                  409,
                  "SCHEDULE_EMPTY",
                  "The active interval has ended",
                );
              await tx.query(
                "UPDATE workflow_schedules SET state='active',next_due_at=$2,last_error=NULL,version=version+1,updated_at=now() WHERE id=$1",
                [id, first.due_at],
              );
              await audit(
                tx,
                req.principal,
                "admin.execution.resume",
                id,
                "succeeded",
                {
                  kind: "workflow_schedule",
                  reason: b.reason,
                  retained_run_as: body.run_as,
                },
                row.tenant_id,
              );
              return { ok: true };
            },
          );
        },
        undefined,
        true,
      );
    },
  );
}

/** Called by each Worker. The row lock, unique occurrence and active-run index
 * also protect multiple native Worker processes and crash/restart delivery. */
export async function advanceSchedules(
  db: Database,
  catalog: Catalog,
  at?: number,
) {
  const now = at ?? Date.now();
  const candidates = (
    await db.control.query(
      "SELECT id,tenant_id FROM workflow_schedules WHERE state='active' AND next_due_at<=$1 ORDER BY next_due_at LIMIT 20",
      [new Date(now)],
    )
  ).rows;
  for (const candidate of candidates) {
    await db
      .tx(
        async (tx) => {
          const row = (
            await tx.query(
              "SELECT s.*,v.body FROM workflow_schedules s JOIN workflow_schedule_versions v ON v.schedule_id=s.id AND v.revision=s.revision WHERE s.id=$1 AND s.state='active' AND s.next_due_at<=$2 FOR UPDATE OF s SKIP LOCKED",
              [candidate.id, new Date(now)],
            )
          ).rows[0];
          if (!row) return;
          const body: ScheduleBody = row.body;
          const first = nextOccurrence(
            body.calendar,
            new Date(row.next_due_at).getTime() - 1,
          );
          const end = body.ends_at ? Date.parse(body.ends_at) : Infinity;
          if (now >= end) {
            await tx.query(
              "UPDATE workflow_schedules SET state='ended',next_due_at=NULL,version=version+1,updated_at=now() WHERE id=$1",
              [row.id],
            );
            return;
          }
          const latest = latestOccurrence(body.calendar, now);
          if (latest.due_ms < first.due_ms) return;
          const u = (
            await tx.query("SELECT id,email,name FROM users WHERE id=$1", [
              body.run_as,
            ])
          ).rows[0];
          const actor: Principal = {
            id: body.run_as,
            email: u?.email ?? "",
            name: u?.name ?? "",
            audience: "user",
            authVersion: body.actor_auth_version,
            sessionId: "",
            sessionHash: "",
          };
          let blocked: string | undefined;
          if (row.content_state !== "active") blocked = "CONTENT_UNAVAILABLE";
          try {
            await projectAccess(
              tx,
              actor,
              row.tenant_id,
              row.project_id,
              "write",
            );
          } catch (error) {
            if (!(error instanceof Problem)) throw error;
            blocked = "AUTHORIZATION_CHANGED";
          }
          if (
            !(
              await tx.query(
                "SELECT 1 FROM workflows WHERE id=$1 AND content_state='active' AND state='published'",
                [row.workflow_id],
              )
            ).rowCount
          )
            blocked = "WORKFLOW_UNAVAILABLE";
          for (const [roleKey, digest] of Object.entries(body.role_hashes)) {
            if (catalog.digest(catalog.role(roleKey)) !== digest)
              blocked = "ROLE_VERSION_CHANGED";
          }
          const missed = countOpportunities(
            body.calendar,
            first.local,
            latest.local,
          );
          if (missed > 0)
            await tx.query(
              "INSERT INTO workflow_schedule_occurrences(tenant_id,project_id,schedule_id,revision,workflow_version,scheduled_local,scheduled_at,state,code,missed_count,through_local) VALUES($1,$2,$3,$4,$5,$6,$7,'skipped_missed','COALESCED',$8,$9) ON CONFLICT DO NOTHING",
              [
                row.tenant_id,
                row.project_id,
                row.id,
                row.revision,
                body.workflow_version,
                first.local,
                first.scheduled_at,
                missed,
                latest.local,
              ],
            );
          const unresolved = !!(
            await tx.query(
              "SELECT 1 FROM workflow_runs r WHERE r.schedule_id=$1 AND (r.state IN ('running','awaiting_approval') OR EXISTS(SELECT 1 FROM tasks t WHERE t.id=r.active_task AND t.status IN ('queued','running','paused','awaiting_approval','reconciling','needs_input'))) LIMIT 1",
              [row.id],
            )
          ).rowCount;
          const state = blocked
            ? "blocked"
            : latest.daylight_gap
              ? "skipped_dst"
              : unresolved
                ? "skipped_overlap"
                : body.catch_up === "skip" && now - latest.due_ms > 60_000
                  ? "skipped_missed"
                  : "launched";
          const runId = state === "launched" ? randomUUID() : null;
          const inserted = (
            await tx.query(
              "INSERT INTO workflow_schedule_occurrences(tenant_id,project_id,schedule_id,revision,workflow_version,scheduled_local,scheduled_at,state,run_id,code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id",
              [
                row.tenant_id,
                row.project_id,
                row.id,
                row.revision,
                body.workflow_version,
                latest.local,
                latest.scheduled_at,
                state,
                runId,
                blocked ??
                  (state === "skipped_dst" ? "NONEXISTENT_LOCAL_TIME" : null),
              ],
            )
          ).rowCount;
          if (inserted && runId)
            await tx.query(
              "INSERT INTO workflow_runs(id,tenant_id,project_id,workflow_id,created_by,actor_auth_version,definition,schedule_id,schedule_revision,scheduled_at,workflow_version,role_hashes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
              [
                runId,
                row.tenant_id,
                row.project_id,
                row.workflow_id,
                actor.id,
                body.actor_auth_version,
                body.definition,
                row.id,
                row.revision,
                latest.scheduled_at,
                body.workflow_version,
                body.role_hashes,
              ],
            );
          const next = nextOccurrence(body.calendar, latest.due_ms);
          await tx.query(
            "UPDATE workflow_schedules SET state=$2,next_due_at=$3,last_error=$4,version=version+1,updated_at=now() WHERE id=$1",
            [
              row.id,
              blocked ? "blocked" : next.due_ms >= end ? "ended" : "active",
              blocked || next.due_ms >= end ? null : next.due_at,
              blocked ?? null,
            ],
          );
          if (inserted)
            await audit(
              tx,
              actor,
              "schedule.trigger",
              row.id,
              blocked ? "denied" : "succeeded",
              {
                revision: row.revision,
                occurrence: latest.local,
                outcome: state,
                run_id: runId,
              },
              row.tenant_id,
            );
        },
        candidate.tenant_id,
        true,
      )
      .catch(async () => {
        // An invalid definition or unexpected database failure must not generate a
        // per-second execution storm. Explicit project-manager review is required.
        await db.control.query(
          "UPDATE workflow_schedules SET state='blocked',last_error='SCHEDULER_FAILED',next_due_at=NULL,version=version+1 WHERE id=$1 AND state='active' AND next_due_at<=$2",
          [candidate.id, new Date(now)],
        );
      });
  }
}

export async function eraseSchedule(tx: Tx, id: string) {
  await eraseReplayContent(tx, [id]);
  await tx.query("SELECT set_config('app.erasing_content','true',true)");
  await tx.query(
    "UPDATE workflow_schedule_versions SET body='{}' WHERE schedule_id=$1",
    [id],
  );
  await tx.query(
    "UPDATE workflow_schedules SET state='retired',next_due_at=NULL,version=version+1 WHERE id=$1",
    [id],
  );
}
