import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Storage } from "./storage.js";
import type { RuntimeContext } from "./runtime.js";
import { requireUser, requireAdmin, audit, type Principal } from "./auth.js";
import { projectAccess, key, replay, eraseReplayContent } from "./access.js";
import { lockUserAuthorities } from "./user-authority.js";
import { permit, scopePredicate, requireRecentMfa } from "./admin-access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { assertTaskContentSources } from "./task-content-sources.js";
import { CloudWorkflows, runInputs } from "./cloud-workflows.js";
import {
  nextOccurrence,
  latestOccurrence,
  countOpportunities,
} from "./schedule-time.js";
import {
  scheduleOptions,
  scheduleToolRequest,
  scheduleRequestDecision,
  scheduleControl,
  normalizeScheduleOptions,
  upcomingScheduleTimes,
  type CloudScheduleBody,
} from "./cloud-schedule-model.js";
import type { FrozenEventMethod } from "./cloud-event-model.js";

const root = "/v1/tenants/:tenant/projects/:project/cloud-workflow-schedules";
const routeParams = z.object({ tenant: uuid, project: uuid });
const unavailable = (code = "SCHEDULE_UNAVAILABLE") =>
  new Problem(
    409,
    code,
    "Review the current private workflow, schedule and authorization before continuing",
  );
const missing = () =>
  new Problem(404, "NOT_FOUND", "Private cloud schedule not found");
const bodyOf = (row: any): CloudScheduleBody => row.body;
const sourceShape = (
  body: FrozenEventMethod,
  tenant: string,
  project: string,
) => ({
  tenant_id: tenant,
  project_id: project,
  origin_task_id: body.origin_task_id,
  workflow_id: body.workflow_id,
  workflow_version: body.workflow_version,
  role_hashes: body.role_hashes,
});
function publicRequest(row: any, definition: unknown, ready: boolean) {
  return {
    id: row.id,
    state: row.state,
    specification_hash: row.specification_hash,
    body: row.body,
    created_at: row.created_at,
    expires_at: row.expires_at,
    origin_ready: ready,
    expired: Date.now() >= new Date(row.expires_at).getTime(),
    definition,
    next: upcomingScheduleTimes(row.body),
    customer_confirmation_required: true,
  };
}
async function desktopGuard(tx: Tx, actor: Principal) {
  if (
    actor.audience === "native" &&
    actor.sessionId &&
    (
      await tx.query(
        "SELECT 1 FROM refresh_tokens WHERE session_id=$1 AND client_id='desktop'",
        [actor.sessionId],
      )
    ).rowCount
  )
    throw unavailable("DESKTOP_LOCAL_EXECUTION_REQUIRED");
}
async function scheduleRow(
  tx: Tx,
  id: string,
  owner: string,
  project: string,
  lock = false,
) {
  const row = (
    await tx.query(
      `SELECT s.*,v.body,v.specification_hash,v.request_id AS version_request_id
    FROM cloud_schedules s JOIN cloud_schedule_versions v ON v.schedule_id=s.id AND v.revision=s.revision
    WHERE s.id=$1 AND s.private_owner=$2 AND s.project_id=$3 AND s.content_state='active'
    ${lock ? "FOR UPDATE OF s" : ""}`,
      [id, owner, project],
    )
  ).rows[0];
  if (!row) throw missing();
  return row;
}
async function unresolved(tx: Tx, id: string) {
  return !!(
    await tx.query(
      `SELECT 1 FROM workflow_runs r WHERE r.cloud_schedule_id=$1 AND
    (r.state IN('running','awaiting_approval') OR EXISTS(SELECT 1 FROM tasks t WHERE t.cloud_workflow_run_id=r.id
      AND t.status IN('queued','running','paused','awaiting_approval','needs_input','reconciling'))) LIMIT 1`,
      [id],
    )
  ).rowCount;
}

/** Model tools prepare requests. Only authenticated customer routes activate them. */
export class CloudWorkflowSchedules {
  private workflows: CloudWorkflows;
  constructor(
    private db: Database,
    private catalog: Catalog,
    storage: Storage,
  ) {
    this.workflows = new CloudWorkflows(db, catalog, storage);
  }
  async checked(
    tx: Tx,
    actor: Principal,
    tenant: string,
    project: string,
    body: FrozenEventMethod,
  ) {
    const v = (
      await tx.query(
        `SELECT v.definition FROM workflow_versions v WHERE v.workflow_id=$1 AND v.version=$2`,
        [body.workflow_id, body.workflow_version],
      )
    ).rows[0];
    if (!v) throw missing();
    const { origin, version } = await runInputs(
      tx,
      { ...sourceShape(body, tenant, project), definition: v.definition },
      actor,
    );
    if (
      version.definition_hash !== body.workflow_definition_hash ||
      canonical(version.role_hashes) !== canonical(body.role_hashes) ||
      canonical(version.source_refs) !== canonical(body.source_refs)
    )
      throw unavailable("WORKFLOW_VERSION_CHANGED");
    const checked = await this.workflows.validate(
      tx,
      origin,
      actor,
      version.definition,
      version.role_hashes,
    );
    if (
      checked.step_budget_micros !== body.max_budget_micros ||
      canonical(checked.role_hashes) !== canonical(body.role_hashes)
    )
      throw unavailable("WORKFLOW_BUDGET_CHANGED");
    return { origin, version, checked };
  }
  async prepare(
    tx: Tx,
    actor: Principal,
    task: any,
    raw: z.infer<typeof scheduleToolRequest>,
    replacement?: any,
  ) {
    await projectAccess(tx, actor, task.tenant_id, task.project_id, "write");
    if (
      task.execution_location !== "cloud" ||
      task.private_owner !== actor.id ||
      task.cloud_workflow_run_id ||
      !["running", "succeeded"].includes(task.status) ||
      task.cancel_requested ||
      task.content_state !== "active" ||
      new Date(task.retention_expires_at).getTime() <= Date.now()
    )
      throw unavailable("WORKFLOW_ORIGIN_NOT_READY");
    const version = (
      await tx.query(
        `SELECT v.* FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id
      JOIN tasks origin ON origin.id=w.origin_task_id WHERE v.workflow_id=$1 AND v.version=$2 AND v.published_at IS NOT NULL
      AND w.tenant_id=$3 AND w.project_id=$4 AND w.private_owner=$5 AND w.execution_location='cloud' AND w.content_state='active'
      AND origin.conversation_id IS NOT DISTINCT FROM $6::uuid FOR SHARE OF w`,
        [
          raw.workflow_id,
          raw.workflow_version,
          task.tenant_id,
          task.project_id,
          actor.id,
          task.conversation_id ?? null,
        ],
      )
    ).rows[0];
    if (!version || version.definition_hash !== raw.workflow_definition_hash)
      throw unavailable("WORKFLOW_VERSION_CHANGED");
    await assertTaskContentSources(tx, task);
    const checked = await this.workflows.validate(
      tx,
      task,
      actor,
      version.definition,
      version.role_hashes,
    );
    let options;
    try {
      options = normalizeScheduleOptions(raw);
    } catch (e) {
      throw new Problem(
        400,
        (e as Error).message,
        "Choose a current or future start and an end after the start with at least one scheduled time",
      );
    }
    if (canonical(checked.role_hashes) !== canonical(version.role_hashes))
      throw unavailable("WORKFLOW_ROLE_VERSION_CHANGED");
    if (task.status === "running") {
      await tx.query(
        `INSERT INTO native_workflow_reads(task_id,workflow_id,version,tenant_id,project_id,private_owner)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [
          task.id,
          version.workflow_id,
          version.version,
          task.tenant_id,
          task.project_id,
          actor.id,
        ],
      );
      await assertTaskContentSources(tx, task);
    }
    const body: CloudScheduleBody = {
      name: options.name,
      calendar: options.calendar,
      catch_up: options.catch_up,
      starts_at: options.starts_at,
      ends_at: options.ends_at,
      expected_output: options.expected_output,
      origin_task_id: task.id,
      workflow_id: version.workflow_id,
      workflow_version: version.version,
      workflow_definition_hash: version.definition_hash,
      role_hashes: version.role_hashes,
      source_refs: version.source_refs,
      max_budget_micros: checked.step_budget_micros,
      actor_auth_version: actor.authVersion,
      replaces_schedule_id: replacement?.id ?? null,
      expected_schedule_version: replacement?.version ?? null,
    };
    return {
      body,
      specification_hash: hash(canonical(body)),
      definition: version.definition,
      next: upcomingScheduleTimes(body),
      customer_confirmation_required: true,
    };
  }
  async saveRequest(
    tx: Tx,
    actor: Principal,
    task: any,
    raw: z.infer<typeof scheduleToolRequest>,
    replacement?: any,
  ) {
    const prepared = await this.prepare(tx, actor, task, raw, replacement);
    // The first call freezes an omitted start. A new model call ID with the
    // same arguments must retain that original request, not add another timer.
    const inputHash = hash(
      canonical({ ...prepared.body, starts_at: raw.starts_at ?? null }),
    );
    const row =
      (
        await tx.query(
          `INSERT INTO cloud_schedule_requests(tenant_id,project_id,private_owner,origin_task_id,body,specification_hash,expires_at,request_input_hash)
      VALUES($1,$2,$3,$4,$5,$6,least(now()+interval '7 days',$7::timestamptz),$8)
      ON CONFLICT(origin_task_id,request_input_hash) DO NOTHING RETURNING *`,
          [
            task.tenant_id,
            task.project_id,
            actor.id,
            task.id,
            prepared.body,
            prepared.specification_hash,
            task.retention_expires_at,
            inputHash,
          ],
        )
      ).rows[0] ??
      (
        await tx.query(
          "SELECT * FROM cloud_schedule_requests WHERE origin_task_id=$1 AND request_input_hash=$2 AND content_state='active'",
          [task.id, inputHash],
        )
      ).rows[0];
    if (!row) throw unavailable();
    await audit(
      tx,
      actor,
      "cloud.schedule.request",
      row.id,
      "succeeded",
      {
        specification_hash: row.specification_hash,
        workflow_version: prepared.body.workflow_version,
        max_budget_micros: prepared.body.max_budget_micros,
        replaces_schedule_id: replacement?.id ?? null,
      },
      task.tenant_id,
    );
    return publicRequest(row, prepared.definition, task.status === "succeeded");
  }
  async read(
    tx: Tx,
    actor: Principal,
    tenant: string,
    project: string,
    taskId?: string,
  ) {
    const requests = (
      await tx.query(
        `SELECT q.*,t.status AS origin_status,v.definition FROM cloud_schedule_requests q
      JOIN tasks t ON t.id=q.origin_task_id JOIN workflow_versions v ON v.workflow_id=(q.body->>'workflow_id')::uuid
      AND v.version=(q.body->>'workflow_version')::int WHERE q.tenant_id=$1 AND q.project_id=$2 AND q.private_owner=$3
      AND q.content_state='active' AND t.content_state='active' AND t.retention_expires_at>clock_timestamp()
      AND task_content_sources_available(t.id) AND ($4::uuid IS NULL OR q.origin_task_id=$4)
      ORDER BY q.created_at DESC,q.id DESC LIMIT 50`,
        [tenant, project, actor.id, taskId ?? null],
      )
    ).rows;
    const schedules = (
      await tx.query(
        `SELECT s.*,v.body,v.specification_hash,wv.definition FROM cloud_schedules s
      JOIN cloud_schedule_versions v ON v.schedule_id=s.id AND v.revision=s.revision JOIN tasks t ON t.id=(v.body->>'origin_task_id')::uuid
      JOIN workflow_versions wv ON wv.workflow_id=(v.body->>'workflow_id')::uuid AND wv.version=(v.body->>'workflow_version')::int
      WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.private_owner=$3 AND s.content_state='active'
      AND t.content_state='active' AND t.retention_expires_at>clock_timestamp() AND task_content_sources_available(t.id)
      AND ($4::uuid IS NULL OR t.id=$4) ORDER BY s.created_at DESC,s.id DESC LIMIT 100`,
        [tenant, project, actor.id, taskId ?? null],
      )
    ).rows;
    const ids = schedules.map((s) => s.id);
    const occurrences = (
      await tx.query(
        `SELECT o.*,v.body->'calendar' AS calendar,r.state AS run_state,r.cursor,r.active_task,r.error_code AS run_error,
      coalesce((SELECT sum(t.charged_micros) FROM tasks t WHERE t.cloud_workflow_run_id=r.id),0)::text AS charged_micros
      FROM cloud_schedule_occurrences o JOIN cloud_schedule_versions v ON v.schedule_id=o.schedule_id AND v.revision=o.revision
      LEFT JOIN workflow_runs r ON r.id=o.run_id WHERE o.schedule_id=ANY($1::uuid[])
      ORDER BY o.created_at DESC,o.id DESC LIMIT 100`,
        [ids],
      )
    ).rows;
    return {
      requests: requests.map((q) =>
        publicRequest(q, q.definition, q.origin_status === "succeeded"),
      ),
      schedules: schedules.map((s) => ({
        ...s,
        next: s.state === "active" ? upcomingScheduleTimes(s.body) : [],
      })),
      occurrences,
    };
  }
  build(
    t: any,
    actor: Principal,
    authorize: (tx: Tx) => Promise<void>,
  ): RuntimeContext["tools"] {
    if (
      t.execution_location === "desktop" ||
      t.cloud_workflow_run_id ||
      !t.private_owner ||
      t.role_key !== "workflow-consultant"
    )
      return [];
    const tool = (
      name: string,
      description: string,
      schema: z.ZodType,
      write: boolean,
      fn: (tx: Tx, a: any) => Promise<unknown>,
    ) => ({
      name,
      description,
      inputSchema: z.toJSONSchema(schema),
      run: (raw: unknown, callId: string) =>
        this.db.tx(
          async (tx) => {
            await authorize(tx);
            if (write && t.mode !== "execute")
              throw new Problem(
                403,
                "EXECUTE_MODE_REQUIRED",
                "Approve an Execute task to request a schedule",
              );
            const args = schema.parse(raw);
            return write
              ? replay(
                  tx,
                  actor.id,
                  "cloud.schedule.tool:" + t.id,
                  callId,
                  { name, args },
                  () => fn(tx, args),
                )
              : fn(tx, args);
          },
          t.tenant_id,
          false,
          actor.id,
        ),
    });
    return [
      tool(
        "workflow_schedule_preview",
        "Validate a fixed published PRIVATE CLOUD workflow and explicit customer-specified timezone, daily/weekly times, outputs and missed-run policy. No activation or child fees. Ask the customer for missing schedule details; do not invent them.",
        scheduleToolRequest,
        false,
        (tx, a) => this.prepare(tx, actor, t, a),
      ),
      tool(
        "workflow_schedule_request",
        "Prepare a persistent PRIVATE CLOUD schedule request for customer review. Does NOT activate, reserve child fees or authorize later work. The customer must review exact methods, inputs, timezone, dates, outputs and per-run budget and explicitly activate it in the interface. Desktop uses local schedules instead.",
        scheduleToolRequest,
        true,
        (tx, a) => this.saveRequest(tx, actor, t, a),
      ),
      tool(
        "workflow_schedule_status",
        "Read exact pending schedule requests and actual occurrence/run outcomes from this private task. Requested or pending is never active or completed. No approval or automatic restart tool exists.",
        z.object({}).strict(),
        false,
        (tx) => this.read(tx, actor, t.tenant_id, t.project_id, t.id),
      ),
    ].filter(
      (v) => t.mode === "execute" || v.name !== "workflow_schedule_request",
    );
  }
}

export function registerCloudWorkflowSchedules(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
  storage: Storage,
) {
  const service = new CloudWorkflowSchedules(db, catalog, storage);
  app.get(root, { preHandler: requireUser(db) }, async (req) => {
    const p = routeParams.parse(req.params),
      q = z.object({ task_id: uuid.optional() }).strict().parse(req.query);
    return db.tx(
      async (tx) => {
        await projectAccess(tx, req.principal, p.tenant, p.project);
        return service.read(tx, req.principal, p.tenant, p.project, q.task_id);
      },
      p.tenant,
      false,
      req.principal.id,
    );
  });
  app.post(root + "/requests", { preHandler: requireUser(db) }, async (req) => {
    const p = routeParams.parse(req.params),
      b = scheduleOptions
        .extend({ source_run_id: uuid })
        .strict()
        .parse(req.body);
    return db.tx(
      async (tx) => {
        await lockUserAuthorities(tx, [req.principal.id]);
        await projectAccess(tx, req.principal, p.tenant, p.project, "write");
        await desktopGuard(tx, req.principal);
        return replay(
          tx,
          req.principal.id,
          "cloud.schedule.prepare:" + p.project,
          key(req),
          b,
          async () => {
            const run = (
              await tx.query(
                "SELECT * FROM workflow_runs WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND private_owner=$4 AND execution_location='cloud' AND content_state='active'",
                [b.source_run_id, p.tenant, p.project, req.principal.id],
              )
            ).rows[0];
            if (!run) throw missing();
            const { origin, version } = await runInputs(tx, run, req.principal);
            return service.saveRequest(tx, req.principal, origin, {
              ...b,
              workflow_id: version.workflow_id,
              workflow_version: version.version,
              workflow_definition_hash: version.definition_hash,
            });
          },
        );
      },
      p.tenant,
      false,
      req.principal.id,
    );
  });
  app.post(
    root + "/:id/requests",
    { preHandler: requireUser(db) },
    async (req) => {
      const p = routeParams.extend({ id: uuid }).parse(req.params),
        b = scheduleOptions
          .extend({ expected_version: z.number().int().positive() })
          .strict()
          .parse(req.body);
      return db.tx(
        async (tx) => {
          await lockUserAuthorities(tx, [req.principal.id]);
          await projectAccess(tx, req.principal, p.tenant, p.project, "write");
          await desktopGuard(tx, req.principal);
          return replay(
            tx,
            req.principal.id,
            "cloud.schedule.revise:" + p.id,
            key(req),
            b,
            async () => {
              const s = await scheduleRow(
                  tx,
                  p.id,
                  req.principal.id,
                  p.project,
                  true,
                ),
                old = bodyOf(s);
              if (
                s.version !== b.expected_version ||
                ["retired", "ended"].includes(s.state)
              )
                throw unavailable("SCHEDULE_VERSION_CHANGED");
              const { origin } = await service.checked(
                tx,
                req.principal,
                p.tenant,
                p.project,
                old,
              );
              return service.saveRequest(
                tx,
                req.principal,
                origin,
                {
                  ...b,
                  workflow_id: old.workflow_id,
                  workflow_version: old.workflow_version,
                  workflow_definition_hash: old.workflow_definition_hash,
                },
                s,
              );
            },
          );
        },
        p.tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.post(
    root + "/requests/:id/decision",
    { preHandler: requireUser(db) },
    async (req) => {
      const p = routeParams.extend({ id: uuid }).parse(req.params),
        b = scheduleRequestDecision.parse(req.body);
      return db.tx(
        async (tx) => {
          await lockUserAuthorities(tx, [req.principal.id]);
          await projectAccess(
            tx,
            req.principal,
            p.tenant,
            p.project,
            b.decision === "activate" ? "approve" : "write",
          );
          await desktopGuard(tx, req.principal);
          return replay(
            tx,
            req.principal.id,
            "cloud.schedule.decision:" + p.id,
            key(req),
            b,
            async () => {
              const q = (
                await tx.query(
                  "SELECT * FROM cloud_schedule_requests WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND private_owner=$4 AND content_state='active' FOR UPDATE",
                  [p.id, p.tenant, p.project, req.principal.id],
                )
              ).rows[0];
              if (!q) throw missing();
              const body = bodyOf(q);
              if (
                q.specification_hash !== b.specification_hash ||
                hash(canonical(body)) !== b.specification_hash ||
                body.max_budget_micros !== b.max_budget_micros
              )
                throw unavailable("SCHEDULE_REQUEST_CHANGED");
              if (
                q.state !== "pending" ||
                new Date(q.expires_at).getTime() <= Date.now()
              )
                throw unavailable("SCHEDULE_REQUEST_EXPIRED");
              if (b.decision === "decline") {
                await tx.query(
                  "UPDATE cloud_schedule_requests SET state='declined' WHERE id=$1",
                  [q.id],
                );
                await audit(
                  tx,
                  req.principal,
                  "cloud.schedule.decline",
                  q.id,
                  "succeeded",
                  {},
                  p.tenant,
                );
                return { request_id: q.id, state: "declined" };
              }
              if (body.actor_auth_version !== req.principal.authVersion)
                throw unavailable("SCHEDULE_AUTHORIZATION_CHANGED");
              await service.checked(
                tx,
                req.principal,
                p.tenant,
                p.project,
                body,
              );
              const first = nextOccurrence(
                body.calendar,
                Math.max(Date.now(), Date.parse(body.starts_at)) - 1,
              );
              if (body.ends_at && first.due_ms >= Date.parse(body.ends_at))
                throw unavailable("SCHEDULE_EMPTY");
              let schedule;
              if (body.replaces_schedule_id) {
                const old = await scheduleRow(
                  tx,
                  body.replaces_schedule_id,
                  req.principal.id,
                  p.project,
                  true,
                );
                if (
                  old.version !== body.expected_schedule_version ||
                  ["retired", "ended"].includes(old.state)
                )
                  throw unavailable("SCHEDULE_VERSION_CHANGED");
                await tx.query(
                  `INSERT INTO cloud_schedule_versions(schedule_id,revision,tenant_id,project_id,private_owner,request_id,body,specification_hash)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
                  [
                    old.id,
                    old.revision + 1,
                    p.tenant,
                    p.project,
                    req.principal.id,
                    q.id,
                    body,
                    q.specification_hash,
                  ],
                );
                schedule = (
                  await tx.query(
                    "UPDATE cloud_schedules SET name=$2,revision=revision+1,version=version+1,state='active',next_due_at=$3,last_error=NULL,updated_at=now() WHERE id=$1 RETURNING *",
                    [old.id, body.name, first.due_at],
                  )
                ).rows[0];
              } else {
                await tx.query(
                  "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
                  ["cloud.schedules:" + p.project + ":" + req.principal.id],
                );
                if (
                  Number(
                    (
                      await tx.query(
                        "SELECT count(*) FROM cloud_schedules WHERE project_id=$1 AND private_owner=$2 AND state NOT IN('retired','ended')",
                        [p.project, req.principal.id],
                      )
                    ).rows[0].count,
                  ) >= 50
                )
                  throw unavailable("SCHEDULE_LIMIT");
                schedule = (
                  await tx.query(
                    "INSERT INTO cloud_schedules(tenant_id,project_id,private_owner,request_id,name,next_due_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
                    [
                      p.tenant,
                      p.project,
                      req.principal.id,
                      q.id,
                      body.name,
                      first.due_at,
                    ],
                  )
                ).rows[0];
                await tx.query(
                  `INSERT INTO cloud_schedule_versions(schedule_id,revision,tenant_id,project_id,private_owner,request_id,body,specification_hash)
            VALUES($1,1,$2,$3,$4,$5,$6,$7)`,
                  [
                    schedule.id,
                    p.tenant,
                    p.project,
                    req.principal.id,
                    q.id,
                    body,
                    q.specification_hash,
                  ],
                );
              }
              await tx.query(
                "UPDATE cloud_schedule_requests SET state='activated' WHERE id=$1",
                [q.id],
              );
              await audit(
                tx,
                req.principal,
                "cloud.schedule.activate",
                schedule.id,
                "succeeded",
                {
                  request_id: q.id,
                  revision: schedule.revision,
                  specification_hash: q.specification_hash,
                  max_budget_micros: body.max_budget_micros,
                },
                p.tenant,
              );
              return {
                schedule,
                body,
                specification_hash: q.specification_hash,
              };
            },
          );
        },
        p.tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.post(
    root + "/:id/status",
    { preHandler: requireUser(db) },
    async (req) => {
      const p = routeParams.extend({ id: uuid }).parse(req.params),
        b = scheduleControl.parse(req.body);
      return db.tx(
        async (tx) => {
          await lockUserAuthorities(tx, [req.principal.id]);
          await projectAccess(
            tx,
            req.principal,
            p.tenant,
            p.project,
            b.action === "resume" ? "approve" : "write",
          );
          if (b.action === "resume") await desktopGuard(tx, req.principal);
          return replay(
            tx,
            req.principal.id,
            "cloud.schedule.status:" + p.id,
            key(req),
            b,
            async () => {
              const row = await scheduleRow(
                  tx,
                  p.id,
                  req.principal.id,
                  p.project,
                  true,
                ),
                body = bodyOf(row);
              if (
                row.version !== b.expected_version ||
                row.specification_hash !== b.specification_hash ||
                body.max_budget_micros !== b.max_budget_micros ||
                ["retired", "ended"].includes(row.state)
              )
                throw unavailable("SCHEDULE_VERSION_CHANGED");
              let next: string | null = null;
              if (b.action === "resume") {
                if (row.state === "active")
                  throw unavailable("SCHEDULE_ACTIVE");
                if (body.actor_auth_version !== req.principal.authVersion)
                  throw unavailable("SCHEDULE_AUTHORIZATION_CHANGED");
                if (await unresolved(tx, row.id))
                  throw unavailable("SCHEDULE_CURRENT_RUN_UNRESOLVED");
                await service.checked(
                  tx,
                  req.principal,
                  p.tenant,
                  p.project,
                  body,
                );
                const point = nextOccurrence(
                  body.calendar,
                  Math.max(Date.now(), Date.parse(body.starts_at)) - 1,
                );
                if (body.ends_at && point.due_ms >= Date.parse(body.ends_at))
                  throw unavailable("SCHEDULE_EMPTY");
                next = point.due_at;
                await tx.query(
                  `INSERT INTO cloud_schedule_versions(schedule_id,revision,tenant_id,project_id,private_owner,request_id,body,specification_hash)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
                  [
                    row.id,
                    row.revision + 1,
                    p.tenant,
                    p.project,
                    req.principal.id,
                    row.version_request_id,
                    body,
                    row.specification_hash,
                  ],
                );
              }
              const state =
                b.action === "resume"
                  ? "active"
                  : b.action === "pause"
                    ? "paused"
                    : "retired";
              const schedule = (
                await tx.query(
                  "UPDATE cloud_schedules SET state=$2,next_due_at=$3,revision=revision+$4,version=version+1,last_error=NULL,updated_at=now() WHERE id=$1 RETURNING *",
                  [row.id, state, next, b.action === "resume" ? 1 : 0],
                )
              ).rows[0];
              await audit(
                tx,
                req.principal,
                "cloud.schedule." + b.action,
                row.id,
                "succeeded",
                { revision: schedule.revision, current_runs_preserved: true },
                p.tenant,
              );
              return { schedule };
            },
          );
        },
        p.tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.get(root + "/:id", { preHandler: requireUser(db) }, async (req) => {
    const p = routeParams.extend({ id: uuid }).parse(req.params),
      q = z.object({ before: uuid.optional() }).strict().parse(req.query);
    return db.tx(
      async (tx) => {
        await projectAccess(tx, req.principal, p.tenant, p.project);
        const s = await scheduleRow(tx, p.id, req.principal.id, p.project);
        await service.checked(
          tx,
          req.principal,
          p.tenant,
          p.project,
          bodyOf(s),
        );
        const cursor = q.before
          ? (
              await tx.query(
                "SELECT created_at::text AS created_at,id FROM cloud_schedule_occurrences WHERE id=$1 AND schedule_id=$2",
                [q.before, s.id],
              )
            ).rows[0]
          : null;
        if (q.before && !cursor) throw missing();
        const occurrences = (
          await tx.query(
            `SELECT o.*,v.body->'calendar' AS calendar,r.state AS run_state,r.cursor,r.active_task,
        coalesce((SELECT sum(t.charged_micros) FROM tasks t WHERE t.cloud_workflow_run_id=r.id),0)::text AS charged_micros
        FROM cloud_schedule_occurrences o JOIN cloud_schedule_versions v ON v.schedule_id=o.schedule_id AND v.revision=o.revision
        LEFT JOIN workflow_runs r ON r.id=o.run_id WHERE o.schedule_id=$1 AND ($2::timestamptz IS NULL OR (o.created_at,o.id)<($2,$3::uuid))
        ORDER BY o.created_at DESC,o.id DESC LIMIT 51`,
            [s.id, cursor?.created_at ?? null, cursor?.id ?? null],
          )
        ).rows;
        const versions = (
          await tx.query(
            "SELECT revision,body,specification_hash,created_at FROM cloud_schedule_versions WHERE schedule_id=$1 ORDER BY revision DESC LIMIT 100",
            [s.id],
          )
        ).rows;
        return {
          schedule: s,
          versions,
          occurrences: occurrences.slice(0, 50),
          next_cursor: occurrences.length > 50 ? occurrences[49].id : null,
        };
      },
      p.tenant,
      false,
      req.principal.id,
    );
  });
  registerAdminCloudSchedules(app, db);
}

function actorFor(user: any, authVersion: number): Principal {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    audience: "user",
    authVersion,
    sessionId: "",
    sessionHash: "",
  };
}
async function blockSchedule(tx: Tx, row: any, code: string) {
  await tx.query(
    "UPDATE cloud_schedules SET state='blocked',next_due_at=NULL,last_error=$2,version=version+1,updated_at=now() WHERE id=$1 AND state='active'",
    [row.id, code],
  );
}

/** Bounded native worker; frozen authorization and one occurrence commit with the run. */
export async function advanceCloudSchedules(
  db: Database,
  catalog: Catalog,
  storage: Storage,
  at = Date.now(),
) {
  const service = new CloudWorkflowSchedules(db, catalog, storage);
  const candidates = (
    await db.control.query(
      `SELECT s.id,s.tenant_id,s.project_id,s.private_owner FROM cloud_schedules s
    WHERE s.state='active' AND (s.next_due_at<=$1 OR EXISTS(SELECT 1 FROM workflow_runs r WHERE r.cloud_schedule_id=s.id
      AND r.cloud_schedule_revision=s.revision AND r.state='failed')) ORDER BY s.next_due_at LIMIT 20`,
      [new Date(at)],
    )
  ).rows;
  for (const candidate of candidates) {
    try {
      await db.tx(
        async (tx) => {
          await lockUserAuthorities(tx, [candidate.private_owner]);
          const row = (
            await tx.query(
              `SELECT s.*,v.body,v.specification_hash,v.request_id AS version_request_id FROM cloud_schedules s
          JOIN cloud_schedule_versions v ON v.schedule_id=s.id AND v.revision=s.revision WHERE s.id=$1 AND s.state='active'
          AND s.content_state='active' FOR UPDATE OF s SKIP LOCKED`,
              [candidate.id],
            )
          ).rows[0];
          if (!row) return;
          const body = bodyOf(row),
            u = (
              await tx.query("SELECT id,email,name FROM users WHERE id=$1", [
                candidate.private_owner,
              ])
            ).rows[0];
          const actor = actorFor(u, body.actor_auth_version);
          if (
            (
              await tx.query(
                "SELECT 1 FROM workflow_runs WHERE cloud_schedule_id=$1 AND cloud_schedule_revision=$2 AND state='failed' LIMIT 1",
                [row.id, row.revision],
              )
            ).rowCount
          ) {
            await blockSchedule(tx, row, "SCHEDULE_RUN_FAILED_REVIEW_REQUIRED");
            await audit(
              tx,
              actor,
              "cloud.schedule.block",
              row.id,
              "succeeded",
              { code: "SCHEDULE_RUN_FAILED_REVIEW_REQUIRED" },
              row.tenant_id,
            );
            return;
          }
          if (new Date(row.next_due_at).getTime() > at) return;
          const end = body.ends_at ? Date.parse(body.ends_at) : Infinity;
          if (at >= end) {
            await tx.query(
              "UPDATE cloud_schedules SET state='ended',next_due_at=NULL,version=version+1,updated_at=now() WHERE id=$1",
              [row.id],
            );
            return;
          }
          const { version } = await service.checked(
            tx,
            actor,
            row.tenant_id,
            row.project_id,
            body,
          );
          const first = nextOccurrence(
              body.calendar,
              new Date(row.next_due_at).getTime() - 1,
            ),
            latest = latestOccurrence(body.calendar, at);
          if (latest.due_ms < first.due_ms) return;
          const missed = countOpportunities(
            body.calendar,
            first.local,
            latest.local,
          );
          if (missed > 0)
            await tx.query(
              `INSERT INTO cloud_schedule_occurrences(tenant_id,project_id,private_owner,schedule_id,revision,scheduled_local,scheduled_at,state,code,missed_count,through_local)
          VALUES($1,$2,$3,$4,$5,$6,$7,'skipped_missed','COALESCED',$8,$9) ON CONFLICT DO NOTHING`,
              [
                row.tenant_id,
                row.project_id,
                row.private_owner,
                row.id,
                row.revision,
                first.local,
                first.scheduled_at,
                missed,
                latest.local,
              ],
            );
          const overlap = await unresolved(tx, row.id);
          const state = latest.daylight_gap
            ? "skipped_dst"
            : overlap
              ? "skipped_overlap"
              : body.catch_up === "skip" && at - latest.due_ms > 60_000
                ? "skipped_missed"
                : "launched";
          const occurrenceId = randomUUID(),
            runId = state === "launched" ? randomUUID() : null;
          const inserted = (
            await tx.query(
              `INSERT INTO cloud_schedule_occurrences(id,tenant_id,project_id,private_owner,schedule_id,revision,scheduled_local,scheduled_at,state,run_id,code)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id`,
              [
                occurrenceId,
                row.tenant_id,
                row.project_id,
                row.private_owner,
                row.id,
                row.revision,
                latest.local,
                latest.scheduled_at,
                state,
                runId,
                latest.daylight_gap
                  ? "NONEXISTENT_LOCAL_TIME"
                  : overlap
                    ? "CURRENT_RUN_UNRESOLVED"
                    : null,
              ],
            )
          ).rowCount;
          if (inserted && runId)
            await tx.query(
              `INSERT INTO workflow_runs(id,tenant_id,project_id,workflow_id,created_by,actor_auth_version,
          definition,workflow_version,role_hashes,execution_location,private_owner,origin_task_id,state,authorized_at,
          cloud_schedule_id,cloud_schedule_revision,cloud_schedule_occurrence_id,results)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'cloud',$5,$10,'running',now(),$11,$12,$13,$14)`,
              [
                runId,
                row.tenant_id,
                row.project_id,
                body.workflow_id,
                row.private_owner,
                body.actor_auth_version,
                version.definition,
                body.workflow_version,
                body.role_hashes,
                body.origin_task_id,
                row.id,
                row.revision,
                occurrenceId,
                JSON.stringify([
                  {
                    kind: "authorization",
                    actor_id: row.private_owner,
                    schedule_id: row.id,
                    schedule_revision: row.revision,
                    request_id: row.version_request_id,
                    specification_hash: row.specification_hash,
                    definition_hash: body.workflow_definition_hash,
                    max_budget_micros: body.max_budget_micros,
                  },
                ]),
              ],
            );
          const next = nextOccurrence(body.calendar, latest.due_ms);
          await tx.query(
            "UPDATE cloud_schedules SET state=$2,next_due_at=$3,version=version+1,updated_at=now() WHERE id=$1",
            [
              row.id,
              next.due_ms >= end ? "ended" : "active",
              next.due_ms >= end ? null : next.due_at,
            ],
          );
          if (inserted)
            await audit(
              tx,
              actor,
              "cloud.schedule.trigger",
              row.id,
              "succeeded",
              {
                revision: row.revision,
                occurrence: latest.local,
                state,
                run_id: runId,
              },
              row.tenant_id,
            );
        },
        candidate.tenant_id,
        false,
        candidate.private_owner,
      );
    } catch (error) {
      await db.tx(
        async (tx) => {
          const row = (
            await tx.query(
              "SELECT * FROM cloud_schedules WHERE id=$1 AND state='active' FOR UPDATE",
              [candidate.id],
            )
          ).rows[0];
          if (!row) return;
          const code =
            error instanceof Problem ? error.code : "SCHEDULE_EXECUTION_FAILED";
          await blockSchedule(tx, row, code);
          await audit(
            tx,
            { id: candidate.private_owner, audience: "user" } as Principal,
            "cloud.schedule.block",
            row.id,
            "denied",
            { code },
            row.tenant_id,
          );
        },
        undefined,
        true,
      );
    }
  }
  await purgeUnavailableCloudSchedules(db);
}

/** Remove private request bodies when their original authorized content expires. */
export async function purgeUnavailableCloudSchedules(db: Database) {
  await db.tx(
    async (tx) => {
      const unavailable = (
        await tx.query(`SELECT q.id FROM cloud_schedule_requests q JOIN tasks t ON t.id=q.origin_task_id
      WHERE q.content_state='active' AND (t.content_state<>'active' OR t.retention_expires_at<=clock_timestamp())
      ORDER BY q.created_at LIMIT 20 FOR UPDATE OF q SKIP LOCKED`)
      ).rows.map((r) => r.id);
      if (!unavailable.length) return;
      await tx.query("SELECT set_config('app.erasing_content','true',true)");
      const ids = (
        await tx.query(
          "SELECT DISTINCT schedule_id AS id FROM cloud_schedule_versions WHERE request_id=ANY($1::uuid[])",
          [unavailable],
        )
      ).rows.map((r) => r.id);
      await eraseReplayContent(tx, [...unavailable, ...ids]);
      await tx.query(
        "UPDATE cloud_schedule_versions SET body='{}' WHERE schedule_id=ANY($1::uuid[])",
        [ids],
      );
      await tx.query(
        "UPDATE cloud_schedules SET name='[Removed]',state='retired',content_state='deleted',next_due_at=NULL,version=version+1 WHERE id=ANY($1::uuid[])",
        [ids],
      );
      await tx.query(
        "UPDATE cloud_schedule_requests SET body='{}',content_state='deleted' WHERE id=ANY($1::uuid[])",
        [unavailable],
      );
    },
    undefined,
    true,
  );
}

function registerAdminCloudSchedules(app: FastifyInstance, db: Database) {
  app.get(
    "/v1/admin/private-cloud-schedules",
    { preHandler: requireAdmin(db) },
    async (req) =>
      db.tx(
        async (tx) => {
          const q = z
            .object({
              page: z.coerce.number().int().min(1).max(100000).default(1),
              page_size: z.coerce.number().int().min(1).max(100).default(50),
            })
            .strict()
            .parse(req.query);
          const scope = await scopePredicate(
            tx,
            req.principal,
            "admin.execution.read",
            "s.tenant_id",
            "s.project_id",
          );
          const values = [
              ...scope.values,
              q.page_size,
              (q.page - 1) * q.page_size,
            ],
            n = scope.values.length;
          const items = (
            await tx.query(
              `SELECT s.id,s.tenant_id,s.project_id,s.private_owner,s.state,s.version,s.revision,s.next_due_at,s.last_error,
      v.body->'calendar' AS calendar,v.body->>'max_budget_micros' AS max_budget_micros,s.created_at
      FROM cloud_schedules s JOIN cloud_schedule_versions v ON v.schedule_id=s.id AND v.revision=s.revision
      WHERE ${scope.sql} ORDER BY s.created_at DESC,s.id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
              values,
            )
          ).rows;
          return {
            items,
            total: Number(
              (
                await tx.query(
                  `SELECT count(*) FROM cloud_schedules s WHERE ${scope.sql}`,
                  scope.values,
                )
              ).rows[0].count,
            ),
            ...q,
          };
        },
        undefined,
        true,
      ),
  );
  app.post(
    "/v1/admin/private-cloud-schedules/:id/pause",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id),
        b = z
          .object({
            expected_version: z.number().int().positive(),
            reason: z.string().trim().min(5).max(1000),
          })
          .strict()
          .parse(req.body);
      return db.tx(
        async (tx) => {
          const s = (
            await tx.query(
              "SELECT * FROM cloud_schedules WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!s) throw missing();
          await permit(tx, req.principal, "admin.execution.pause", {
            tenant: s.tenant_id,
            project: s.project_id,
          });
          await requireRecentMfa(tx, req.principal);
          return replay(
            tx,
            req.principal.id,
            "admin.cloud.schedule.pause:" + id,
            key(req),
            b,
            async () => {
              if (s.version !== b.expected_version || s.state !== "active")
                throw unavailable("SCHEDULE_VERSION_CHANGED");
              await tx.query(
                "UPDATE cloud_schedules SET state='paused',next_due_at=NULL,version=version+1,updated_at=now() WHERE id=$1",
                [id],
              );
              await audit(
                tx,
                req.principal,
                "admin.execution.pause",
                id,
                "succeeded",
                {
                  kind: "private_cloud_schedule",
                  reason: b.reason,
                  current_runs_preserved: true,
                },
                s.tenant_id,
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
