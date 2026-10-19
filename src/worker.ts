import { CodeWorkspace } from "./code-workspace.js";
import {
  readCloudSource,
  writeCloudSource,
  bundleCloudSources,
} from "./cloud-source.js";
import { listCloudReferences, readCloudReference } from "./cloud-references.js";
import { PgBoss } from "pg-boss";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Storage } from "./storage.js";
import { saveAsset } from "./storage.js";
import {
  CodexRuntimeAdapter,
  RuntimeFailure,
  type RuntimeContext,
} from "./runtime.js";
import { projectAccess, replay } from "./access.js";
import { settle, tokenCharge } from "./billing.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { event } from "./tasks.js";
import { analyticsEvidence } from "./analytics.js";
import {
  assertReportSources,
  reportFacts,
  analysisReportInstructions,
  finalizeAnalysisReport,
} from "./analysis-reports.js";
import type { Principal } from "./auth.js";
import { advanceWorkflows, poster, renderProjectPoster } from "./business.js";
import {
  pngFromSVG,
  pdfFromSVG,
  motionFromSVG,
  designFormatsForTools,
} from "./render.js";
import { resolveWorkContext } from "./persistent-work.js";
import { advanceSchedules } from "./schedules.js";
import { expireFederationAttempts } from "./federation-session.js";
import { ErasureService } from "./erasure.js";
import { cleanUploadStaging } from "./uploads.js";
import { RetentionService } from "./retention.js";
import { recoverQueuedClaims } from "./task-recovery.js";
import { assertTaskSkills } from "./skill-lifecycle.js";
import { authorizeExecutionPlan } from "./plans.js";
import { claimCapacity, readyOutbox } from "./execution-capacity.js";
import {
  checkInputDependencies,
  assertInputDependencies,
  inputDependencyContext,
  inputDependencyBinding,
} from "./task-dependencies.js";

export class Worker {
  private boss: PgBoss;
  private timer?: ReturnType<typeof setInterval>;
  private dispatching = false;
  private active = new Map<string, AbortController>();
  private erasure: ErasureService;
  private retention: RetentionService;
  constructor(
    private db: Database,
    private catalog: Catalog,
    private storage: Storage,
    private runtime = new CodexRuntimeAdapter(db.config),
  ) {
    this.erasure = new ErasureService(db, storage, (id) => this.active.has(id));
    this.retention = new RetentionService(db, storage, (id) =>
      this.active.has(id),
    );
    this.boss = new PgBoss({
      connectionString: db.config.QUEUE_DATABASE_URL,
      schema: "pgboss",
      application_name: "copypaste-worker",
    });
    this.boss.on("error", () => {});
  }
  async start() {
    await this.boss.start();
    await this.boss.createQueue("task.run", {
      retryLimit: 0,
      expireInSeconds: 1200,
    });
    await this.boss.work<{ tenant: string; task: string }>(
      "task.run",
      { batchSize: 1, localConcurrency: this.db.config.WORKER_CONCURRENCY },
      async (jobs) => {
        for (const j of jobs) await this.run(j.data.tenant, j.data.task);
      },
    );
    this.timer = setInterval(() => void this.dispatch().catch(() => {}), 1000);
    await this.dispatch();
  }
  async dispatch() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const c = await this.db.control.connect();
      try {
        await c.query("BEGIN");
        const items = await readyOutbox(
          c,
          this.db.config.DEMO_MODE ? "simulated" : "configured_services",
        );
        for (const o of items) {
          let jobId: string | null = null;
          if (o.topic === "task.run")
            jobId = await this.boss.send(
              "task.run",
              { tenant: o.tenant_id, task: o.payload.task_id },
              { singletonKey: o.id, retryLimit: 0 },
            );
          await c.query(
            "UPDATE outbox SET dispatched_at=now(),queue_job_id=$2 WHERE id=$1",
            [o.id, jobId],
          );
        }
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      // Unknown abandoned execution is retained for reconciliation; it is never blindly replayed.
      await this.db.control.query(
        "UPDATE tasks SET status='reconciling',error_code='WORKER_LEASE_EXPIRED',version=version+1 WHERE status='running' AND lease_until<now()",
      );
      await this.db.control.query(
        "UPDATE reservations r SET status='reconciling' FROM tasks t WHERE t.id=r.task_id AND t.status='reconciling' AND r.status='reserved'",
      );
    } finally {
      // A connector/workflow error must never starve cleanup or other due work.
      for (const [name, operation] of [
        ["queue_recovery", () => recoverQueuedClaims(this.db)],
        ["schedules", () => advanceSchedules(this.db, this.catalog)],
        [
          "workflows",
          () => advanceWorkflows(this.db, this.catalog, this.storage),
        ],
        ["federation", () => expireFederationAttempts(this.db.control)],
        ["retention", () => this.retention.advance()],
        ["erasure", () => this.erasure.advance()],
        ["uploads", () => cleanUploadStaging(this.db)],
      ] as const) {
        try {
          await operation();
        } catch (e) {
          console.error(
            JSON.stringify({
              component: "worker.maintenance",
              operation: name,
              error_code: (e as { code?: string }).code ?? "MAINTENANCE_FAILED",
            }),
          );
        }
      }
      this.dispatching = false;
    }
  }
  async run(tenant: string, id: string) {
    const fencing = randomUUID();
    // Worker control identity locates the owner; restricted execution still uses RLS.
    const owner = (
      await this.db.control.query(
        "SELECT created_by FROM tasks WHERE id=$1 AND tenant_id=$2",
        [id, tenant],
      )
    ).rows[0]?.created_by;
    if (!owner) return;
    let task: any;
    let actor: Principal;
    task = await this.db.tx(
      async (tx) => {
        const t = (
          await tx.query(
            "SELECT * FROM tasks WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
            [id, tenant],
          )
        ).rows[0];
        if (!t || t.status !== "queued") return null;
        if ((t.data_mode === "simulated") !== this.db.config.DEMO_MODE)
          return null;
        const u = (
          await tx.query("SELECT * FROM users WHERE id=$1", [t.created_by])
        ).rows[0];
        actor = {
          id: u.id,
          email: u.email,
          name: u.name,
          audience: "user",
          sessionId: "",
          sessionHash: "",
          authVersion: t.actor_auth_version,
        };
        let currentPlan;
        try {
          await projectAccess(tx, actor, tenant, t.project_id, "write");
          if (t.content_state !== "active")
            throw new Error("Content is unavailable");
          await this.catalog.ensureEnabled(tx, t.role_key);
          await assertTaskSkills(tx, this.catalog, t);
          await assertReportSources(tx, t);
          currentPlan = await authorizeExecutionPlan(
            tx,
            tenant,
            t.created_by,
            this.catalog.role(t.role_key),
            t.mode,
          );
          await resolveWorkContext(
            tx,
            actor,
            tenant,
            t.project_id,
            t.input_context,
            this.db.config.CODEX_VERSION,
            [...this.catalog.capabilityVersions.values()].map((v) => v.id),
          );
          if (
            this.catalog.digest(this.catalog.role(t.role_key)) !== t.role_hash
          )
            throw new Error("Role version changed");
        } catch {
          await settle(tx, tenant, id, 0, t.created_by);
          await tx.query(
            "UPDATE tasks SET status='cancelled',error_code='AUTHORIZATION_CHANGED',version=version+1 WHERE id=$1",
            [id],
          );
          await event(tx, tenant, id, "task.cancelled", {
            reason: "AUTHORIZATION_CHANGED",
          });
          return null;
        }
        if (!(await checkInputDependencies(tx, t))) return null;
        const started = await claimCapacity(
          tx,
          t,
          this.catalog.role(t.role_key),
          currentPlan.body.max_active_tasks,
          fencing,
        );
        if (!started) return null;
        await event(tx, tenant, id, "task.started", {});
        return started;
      },
      tenant,
      false,
      owner,
    );
    if (!task) return;
    const controller = new AbortController();
    this.active.set(id, controller);
    let checking = false;
    const heartbeat = setInterval(() => {
      if (checking) return;
      checking = true;
      void this.db
        .tx(
          async (tx) => {
            const t = (
              await tx.query(
                "SELECT * FROM tasks WHERE id=$1 AND fencing_token=$2 AND status='running'",
                [id, fencing],
              )
            ).rows[0];
            if (!t || t.cancel_requested || t.content_state !== "active") {
              controller.abort();
              return;
            }
            try {
              await projectAccess(tx, actor, tenant, task.project_id, "write");
              await this.catalog.ensureEnabled(tx, task.role_key);
              await assertTaskSkills(tx, this.catalog, task);
              await assertInputDependencies(tx, t);
              await assertReportSources(tx, t);
              await authorizeExecutionPlan(
                tx,
                tenant,
                task.created_by,
                this.catalog.role(task.role_key),
                task.mode,
              );
              await resolveWorkContext(
                tx,
                actor,
                tenant,
                task.project_id,
                task.input_context,
                this.db.config.CODEX_VERSION,
                [...this.catalog.capabilityVersions.values()].map((v) => v.id),
              );
            } catch {
              controller.abort();
              return;
            }
            await tx.query(
              "UPDATE tasks SET lease_until=now()+interval '45 seconds' WHERE id=$1 AND fencing_token=$2",
              [id, fencing],
            );
          },
          tenant,
          false,
          owner,
        )
        .catch(() => controller.abort())
        .finally(() => {
          checking = false;
        });
    }, 3000);
    const emit = async (kind: string, body: any) =>
      this.db.tx(
        async (tx) => {
          const live = (
            await tx.query(
              "SELECT * FROM tasks WHERE id=$1 AND fencing_token=$2 AND status='running'",
              [id, fencing],
            )
          ).rows[0];
          if (!live) throw new Error("Fenced execution");
          await assertReportSources(tx, live);
          if (kind === "runtime.thread")
            await tx.query("UPDATE tasks SET runtime_thread=$2 WHERE id=$1", [
              id,
              body.thread_id,
            ]);
          if (kind === "runtime.turn")
            await tx.query("UPDATE tasks SET runtime_turn=$2 WHERE id=$1", [
              id,
              body.turn_id,
            ]);
          await event(tx, tenant, id, kind, body);
        },
        tenant,
        false,
        owner,
      );
    let completedUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          usageKnown: boolean;
          accepted: boolean;
        }
      | undefined;
    try {
      const role = this.catalog.role(task.role_key);
      const bound = await this.catalog.boundSkills(role);
      await emit("skills.loaded", {
        packages: bound.map((s) => ({
          key: s.key,
          version: s.version,
          sha256: s.sha256,
        })),
      });
      const context = await this.db.tx(
        async (tx) => {
          await projectAccess(tx, actor!, tenant, task.project_id, "write");
          await assertInputDependencies(tx, task);
          await assertReportSources(tx, task);
          const work = await resolveWorkContext(
            tx,
            actor!,
            tenant,
            task.project_id,
            task.input_context,
            this.db.config.CODEX_VERSION,
            [...this.catalog.capabilityVersions.values()].map((v) => v.id),
          );
          return {
            ...work,
            instructions:
              work.instructions + (await inputDependencyContext(tx, task)),
          };
        },
        tenant,
        false,
        owner,
      );
      const effectiveRole = {
        ...role,
        tool_ids: role.tool_ids.filter(
          (id: string) => !context.role || context.role.tool_ids.includes(id),
        ),
      };
      const result = await this.runtime.start({
        taskId: id,
        prompt: `${context.instructions}\n\nWork mode: ${task.mode ?? "execute"}. ${task.mode === "execute" ? "Perform the authorized work." : "Read-only investigation. Return a written answer or plan; do not create assets or perform business writes."}\n\nCurrent user request:\n${task.prompt}${task.input_context?.analysis_report_id ? "\n\n" + analysisReportInstructions : ""}`,
        workspace: path.resolve(this.db.config.DATA_DIR, "runs", tenant, id),
        skills: bound,
        signal: controller.signal,
        onEvent: emit,
        tools: this.tools(task, actor!, fencing, effectiveRole),
      });
      completedUsage = result;
      await this.finish(
        task,
        fencing,
        result.status === "completed"
          ? "succeeded"
          : result.status === "interrupted"
            ? "cancelled"
            : "failed",
        result.text,
        result.inputTokens,
        result.outputTokens,
        !result.usageKnown && result.accepted,
      );
    } catch (e) {
      const f = e instanceof RuntimeFailure ? e : null;
      await this.finish(
        task,
        fencing,
        "failed",
        "",
        f?.inputTokens ?? completedUsage?.inputTokens ?? 0,
        f?.outputTokens ?? completedUsage?.outputTokens ?? 0,
        f
          ? f.accepted && !f.usageKnown
          : completedUsage
            ? completedUsage.accepted && !completedUsage.usageKnown
            : false,
        f?.code ?? "RUNTIME_UNAVAILABLE",
      );
    } finally {
      clearInterval(heartbeat);
      this.active.delete(id);
    }
  }
  private async finish(
    t: any,
    fencing: string,
    status: string,
    text: string,
    input: number,
    output: number,
    uncertain: boolean,
    error?: string,
  ) {
    await this.db.tx(
      async (tx) => {
        const live = (
          await tx.query(
            "SELECT * FROM tasks WHERE id=$1 AND fencing_token=$2 FOR UPDATE",
            [t.id, fencing],
          )
        ).rows[0];
        if (!live || live.status !== "running") return;
        if (live.cancel_requested) status = "cancelled";
        const erased = live.content_state === "deleted";
        if (live.content_state !== "active") {
          status = "cancelled";
          text = "";
          error = "CONTENT_UNAVAILABLE";
        }
        let contextDigest = "";
        try {
          const u = (
            await tx.query(
              "SELECT email,name,auth_version FROM users WHERE id=$1",
              [t.created_by],
            )
          ).rows[0];
          const actor: Principal = {
            id: t.created_by,
            email: u.email,
            name: u.name,
            authVersion: t.actor_auth_version,
            audience: "user",
            sessionId: "",
            sessionHash: "",
          };
          await projectAccess(tx, actor, t.tenant_id, t.project_id, "write");
          await this.catalog.ensureEnabled(tx, t.role_key);
          await assertTaskSkills(tx, this.catalog, t);
          await assertInputDependencies(tx, live);
          await assertReportSources(tx, live);
          await authorizeExecutionPlan(
            tx,
            t.tenant_id,
            t.created_by,
            this.catalog.role(t.role_key),
            t.mode,
          );
          const context = await resolveWorkContext(
            tx,
            actor,
            t.tenant_id,
            t.project_id,
            live.input_context,
            this.db.config.CODEX_VERSION,
            [...this.catalog.capabilityVersions.values()].map((v) => v.id),
          );
          contextDigest = context.digest;
        } catch {
          status = "cancelled";
          text = "";
          error = "CONTEXT_REVOKED";
        }
        const ops = (
          await tx.query(
            "SELECT coalesce(sum(charge_micros) FILTER(WHERE state='succeeded'),0)::text AS charge,bool_or(state IN ('accepted','reconciling')) AS uncertain FROM tool_operations WHERE task_id=$1",
            [t.id],
          )
        ).rows[0];
        const cost =
          tokenCharge(
            input,
            output,
            this.db.config.AI_INPUT_HKD_MICROS_PER_MILLION ?? 0,
            this.db.config.AI_OUTPUT_HKD_MICROS_PER_MILLION ?? 0,
          ) + Number(ops.charge);
        if (
          status === "succeeded" &&
          !uncertain &&
          !ops.uncertain &&
          live.input_context?.analysis_report_id
        ) {
          try {
            text = await finalizeAnalysisReport(tx, this.storage, live, text);
          } catch (e) {
            if (
              !(e instanceof Problem) ||
              e.code !== "REPORT_NARRATIVE_INVALID"
            )
              throw e;
            status = "failed";
            error = e.code;
            text = "";
            await tx.query(
              "UPDATE analysis_reports SET validation=$2 WHERE id=$1",
              [
                live.input_context.analysis_report_id,
                JSON.stringify({ state: "failed", error_code: e.code }),
              ],
            );
          }
        }
        await tx.query(
          "UPDATE tasks SET status=$2,output=$3,input_tokens=$4,output_tokens=$5,error_code=$6,lease_until=NULL,updated_at=now(),version=version+1 WHERE id=$1",
          [t.id, status, text, input, output, error ?? null],
        );
        await settle(
          tx,
          t.tenant_id,
          t.id,
          cost,
          t.created_by,
          uncertain || !!ops.uncertain,
        );
        if (!erased)
          await event(tx, t.tenant_id, t.id, "task.finished", {
            status: uncertain || ops.uncertain ? "reconciling" : status,
            charge_micros: cost,
            error_code: error ?? null,
          });
        if (!erased)
          await event(tx, t.tenant_id, t.id, "usage.updated", {
            amount_micros: String(cost),
            cost_state:
              uncertain || ops.uncertain ? "reconciling" : "confirmed",
          });
        if (text && !uncertain && !ops.uncertain && live.conversation_id) {
          await tx.query(
            "INSERT INTO conversation_messages(tenant_id,project_id,conversation_id,client_message_id,role,intent,body,task_id) VALUES($1,$2,$3,$4,'assistant','result',$5,$4) ON CONFLICT(conversation_id,client_message_id) DO NOTHING",
            [t.tenant_id, t.project_id, live.conversation_id, t.id, text],
          );
          await tx.query(
            "UPDATE conversations SET version=version+1,updated_at=now() WHERE id=$1",
            [live.conversation_id],
          );
        }
        if (
          status === "succeeded" &&
          text &&
          live.mode === "plan" &&
          !uncertain &&
          !ops.uncertain
        ) {
          await tx.query(
            "INSERT INTO task_plans(task_id,tenant_id,project_id,input_hash,body,conversation_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(task_id) DO NOTHING",
            [
              t.id,
              t.tenant_id,
              t.project_id,
              hash(
                canonical({
                  prompt: live.prompt,
                  role_hash: live.role_hash,
                  context: contextDigest,
                  ...(await inputDependencyBinding(tx, live)),
                }),
              ),
              text,
              live.input_context.conversation_version
                ? live.input_context.conversation_version + 1
                : null,
            ],
          );
        }
      },
      t.tenant_id,
      true,
      t.created_by,
    );
  }
  private tools(
    t: any,
    actor: Principal,
    fencing: string,
    role: any,
  ): RuntimeContext["tools"] {
    const authorize = async (tx: any) => {
      await projectAccess(tx, actor, t.tenant_id, t.project_id, "write");
      await this.catalog.ensureEnabled(tx, t.role_key);
      await assertTaskSkills(tx, this.catalog, t);
      await assertInputDependencies(tx, t);
      await assertReportSources(tx, t);
      await authorizeExecutionPlan(
        tx,
        t.tenant_id,
        t.created_by,
        this.catalog.role(t.role_key),
        t.mode,
      );
      await resolveWorkContext(
        tx,
        actor,
        t.tenant_id,
        t.project_id,
        t.input_context,
        this.db.config.CODEX_VERSION,
        [...this.catalog.capabilityVersions.values()].map((v) => v.id),
      );
      await tx.query("SELECT set_config('app.task_id',$1,true)", [t.id]);
      if (
        !(
          await tx.query(
            "SELECT 1 FROM tasks WHERE id=$1 AND fencing_token=$2 AND status='running' AND NOT cancel_requested",
            [t.id, fencing],
          )
        ).rowCount
      )
        throw new Problem(409, "RUN_FENCED", "Execution is no longer active");
    };
    const txTool =
      (fn: (tx: any, a: any) => Promise<unknown>, schema: z.ZodType) =>
      (args: unknown, callId: string) =>
        this.db.tx(async (tx) => {
          await authorize(tx);
          const a = schema.parse(args);
          return replay(tx, actor.id, `tool:${t.id}`, callId, a, () =>
            fn(tx, a),
          );
        }, t.tenant_id);
    const tools: RuntimeContext["tools"] = [
      {
        name: "project_assets",
        description:
          "List currently authorized project assets and their immutable versions.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        run: txTool(
          async (tx) => ({
            items: (
              await tx.query(
                "SELECT id,name,kind,current_version FROM assets WHERE project_id=$1 AND state='active' ORDER BY created_at DESC LIMIT 100",
                [t.project_id],
              )
            ).rows,
          }),
          z.object({}).strict(),
        ),
      },
      {
        name: "asset_text_read",
        description:
          "Read an authorized text, JSON or CSV asset in the current project.",
        inputSchema: {
          type: "object",
          properties: { asset_id: { type: "string" } },
          required: ["asset_id"],
          additionalProperties: false,
        },
        run: txTool(
          async (tx, a) => {
            const v = (
              await tx.query(
                "SELECT v.* FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=$1 AND a.project_id=$2 AND a.state='active'",
                [a.asset_id, t.project_id],
              )
            ).rows[0];
            if (
              !v ||
              !["text/plain", "text/csv", "application/json"].includes(
                v.mime_type,
              ) ||
              Number(v.bytes) > 500000
            )
              throw new Error("Unsupported text asset");
            return {
              text: (await this.storage.get(v.storage_key)).toString("utf8"),
            };
          },
          z.object({ asset_id: uuid }).strict(),
        ),
      },
      {
        name: "deliver_text",
        description:
          "Create an actual immutable editable text, Markdown, HTML, JSON or SVG deliverable.",
        inputSchema: {
          type: "object",
          properties: {
            filename: { type: "string" },
            content: { type: "string" },
            mime_type: {
              type: "string",
              enum: [
                "text/plain",
                "text/markdown",
                "text/html",
                "application/json",
                "image/svg+xml",
              ],
            },
          },
          required: ["filename", "content", "mime_type"],
          additionalProperties: false,
        },
        run: txTool(
          async (tx, a) =>
            saveAsset(tx, this.storage, {
              tenant: t.tenant_id,
              project: t.project_id,
              user: actor.id,
              name: a.filename,
              mime: a.mime_type,
              bytes: Buffer.from(a.content),
              kind: "deliverable",
              metadata: { task_id: t.id },
            }),
          z
            .object({
              filename: z.string().min(1).max(160),
              content: z.string().max(2_000_000),
              mime_type: z.enum([
                "text/plain",
                "text/markdown",
                "text/html",
                "application/json",
                "image/svg+xml",
              ]),
            })
            .strict(),
        ),
      },
      {
        name: "marketing_metrics",
        description:
          "Calculate exact aggregate marketing metrics from an authorized dataset. Never average row ratios.",
        inputSchema: {
          type: "object",
          properties: { dataset_id: { type: "string" } },
          required: ["dataset_id"],
          additionalProperties: false,
        },
        run: txTool(
          async (tx, a) => {
            const d = (
              await tx.query(
                "SELECT * FROM analytics_datasets WHERE id=$1 AND project_id=$2",
                [a.dataset_id, t.project_id],
              )
            ).rows[0];
            if (!d) throw new Error("Dataset not found");
            return {
              currency: d.currency,
              timezone: d.timezone,
              ...analyticsEvidence(d),
            };
          },
          z.object({ dataset_id: uuid }).strict(),
        ),
      },
    ];
    if (role.tool_ids.includes("asset.read"))
      tools.push(
        {
          name: "cloud_files",
          description:
            "Browse authorized project files and this conversation's private file tree. References pin exact immutable versions. Use next_cursor to continue.",
          inputSchema: {
            type: "object",
            properties: { q: { type: "string" }, cursor: { type: "string" } },
            additionalProperties: false,
          },
          run: txTool(
            (tx, a) => listCloudReferences(tx, t, a.q, a.cursor),
            z
              .object({
                q: z.string().max(150).optional(),
                cursor: uuid.optional(),
              })
              .strict(),
          ),
        },
        {
          name: "cloud_file_read",
          description:
            "Read an authorized cloud file by its workspace_node_id and exact asset_version_id. Removed or changed references cannot be used.",
          inputSchema: {
            type: "object",
            properties: {
              workspace_node_id: { type: "string" },
              asset_version_id: { type: "string" },
            },
            required: ["workspace_node_id", "asset_version_id"],
            additionalProperties: false,
          },
          run: txTool(
            (tx, a) =>
              readCloudReference(
                tx,
                this.storage,
                t,
                a.workspace_node_id,
                a.asset_version_id,
              ),
            z
              .object({ workspace_node_id: uuid, asset_version_id: uuid })
              .strict(),
          ),
        },
      );
    const workspace = new CodeWorkspace(
      path.resolve(
        this.db.config.DATA_DIR,
        "runs",
        t.tenant_id,
        t.id,
        "project",
      ),
    );
    if (role.tool_ids.includes("code.read"))
      tools.push({
        name: "code_read",
        description:
          "Read a source file from this task workspace, including its exact SHA-256 for a safe edit.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
        run: txTool(
          async (tx, a) =>
            t.conversation_id && t.private_owner
              ? ((await readCloudSource(tx, this.storage, t, a.path)) ??
                Promise.reject(
                  new Problem(404, "NOT_FOUND", "Working source not found"),
                ))
              : workspace.read(a.path),
          z.object({ path: z.string().max(500) }).strict(),
        ),
      });
    if (role.tool_ids.includes("code.patch"))
      tools.push({
        name: "code_write",
        description:
          "Create or update a UTF-8 source file in this task workspace. Existing files require expected_sha256 from code_read.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            expected_sha256: { type: "string" },
          },
          required: ["path", "content"],
          additionalProperties: false,
        },
        run: txTool(
          (tx, a) =>
            t.conversation_id && t.private_owner
              ? writeCloudSource(
                  tx,
                  this.storage,
                  t,
                  a.path,
                  a.content,
                  a.expected_sha256,
                )
              : workspace.write(a.path, a.content, a.expected_sha256),
          z
            .object({
              path: z.string().max(500),
              content: z.string().max(1_000_000),
              expected_sha256: z
                .string()
                .regex(/^[a-f\d]{64}$/)
                .optional(),
            })
            .strict(),
        ),
      });
    if (
      role.tool_ids.includes("code.read") &&
      role.tool_ids.includes("delivery.package")
    )
      tools.push({
        name: "code_package",
        description:
          "Package actual workspace sources with a hash manifest into a downloadable ZIP. This does not claim tests have executed.",
        inputSchema: {
          type: "object",
          properties: { filename: { type: "string" } },
          required: ["filename"],
          additionalProperties: false,
        },
        run: txTool(
          async (tx, a) => {
            const zip =
              t.conversation_id && t.private_owner
                ? await bundleCloudSources(tx, this.storage, t)
                : await workspace.bundle();
            return saveAsset(tx, this.storage, {
              tenant: t.tenant_id,
              project: t.project_id,
              user: actor.id,
              name: a.filename,
              mime: "application/zip",
              bytes: zip.bytes,
              kind: "source_package",
              metadata: {
                task_id: t.id,
                files: zip.files,
                execution_validation: "not_executed",
              },
            });
          },
          z
            .object({ filename: z.string().min(1).max(160).endsWith(".zip") })
            .strict(),
        ),
      });
    const allowedFormats = designFormatsForTools(role.tool_ids);
    if (allowedFormats.length) {
      const renderInput = z
        .object({
          filename: z.string().min(1).max(120),
          document: poster,
          format: z.enum(
            allowedFormats as [
              (typeof allowedFormats)[number],
              ...(typeof allowedFormats)[number][],
            ],
          ),
          duration: z.number().int().min(3).max(15).optional(),
          effect: z.enum(["fade", "zoom", "still"]).optional(),
        })
        .strict();
      tools.push({
        name: "design_render",
        description:
          "Save an editable poster JSON source and render one permitted format. PDF is a single-page raster review copy; text and layers remain editable only in the source. MP4 is a bounded H.264/AAC motion creative.",
        inputSchema: z.toJSONSchema(renderInput),
        run: txTool(async (tx, a) => {
          const source = await saveAsset(tx, this.storage, {
            tenant: t.tenant_id,
            project: t.project_id,
            user: actor.id,
            name: a.filename + ".editable.json",
            mime: "application/json",
            bytes: Buffer.from(JSON.stringify(a.document, null, 2)),
            kind: "editable_design",
            metadata: { task_id: t.id },
          });
          const svg = await renderProjectPoster(
            tx,
            this.storage,
            t.project_id,
            a.document,
          );
          let bytes = Buffer.from(svg),
            mime = "image/svg+xml",
            probe: any = null;
          if (a.format === "png") {
            bytes = Buffer.from(pngFromSVG(svg));
            mime = "image/png";
          }
          if (a.format === "pdf") {
            const r = await pdfFromSVG(
              svg,
              a.document.width,
              a.document.height,
            );
            bytes = r.bytes;
            probe = r.probe;
            mime = "application/pdf";
          }
          if (a.format === "mp4") {
            const r = await motionFromSVG(
              svg,
              a.document.width,
              a.document.height,
              {
                duration: a.duration ?? 6,
                effect: a.effect ?? "fade",
                dataDir: this.db.config.DATA_DIR,
              },
            );
            bytes = r.bytes;
            probe = r.probe;
            mime = "video/mp4";
          }
          return {
            source,
            rendered: await saveAsset(tx, this.storage, {
              tenant: t.tenant_id,
              project: t.project_id,
              user: actor.id,
              name: a.filename + "." + a.format,
              mime,
              bytes,
              kind: "design_render",
              metadata: { task_id: t.id, source_asset_id: source.id, probe },
            }),
          };
        }, renderInput),
      });
    }
    if (role.tool_ids.includes("font.inspect"))
      tools.push({
        name: "font_catalog",
        description:
          "List the bounded font families supported by the editable native layout renderer.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        run: txTool(
          async () => ({
            families: ["sans", "serif", "mono"],
            chinese_fallback:
              "Microsoft JhengHei / Noto Sans TC when installed",
            embedding: false,
            license_note:
              "Customer-provided fonts require explicit rights; do not invent a license.",
          }),
          z.object({}).strict(),
        ),
      });
    if (role.tool_ids.includes("image.generate.internal"))
      tools.push(this.imageTool(t, actor, fencing, authorize, false));
    if (role.tool_ids.includes("image.edit.internal"))
      tools.push(this.imageTool(t, actor, fencing, authorize, true));
    if (
      t.input_context?.analysis_report_id &&
      role.tool_ids.includes("dataset.read")
    )
      tools.push({
        name: "analysis_report_facts",
        description:
          "Read a bounded page of frozen report evidence, scope and exact values. Follow next_offset to inspect additional metrics and independent scopes. Numerical prose must use evidence placeholders.",
        inputSchema: {
          type: "object",
          properties: {
            offset: { type: "integer", minimum: 0, maximum: 3300 },
          },
          additionalProperties: false,
        },
        run: txTool(
          (tx, b) => reportFacts(tx, t, b.offset),
          z
            .object({ offset: z.number().int().min(0).max(3300).default(0) })
            .strict(),
        ),
      });
    const permitted = tools.filter(
      (tool) =>
        (
          ({
            project_assets: role.tool_ids.includes("asset.read"),
            asset_text_read: role.tool_ids.includes("asset.read"),
            cloud_files: role.tool_ids.includes("asset.read"),
            cloud_file_read: role.tool_ids.includes("asset.read"),
            deliver_text: role.tool_ids.includes("asset.write"),
            marketing_metrics: role.tool_ids.includes("dataset.read"),
            analysis_report_facts:
              !!t.input_context?.analysis_report_id &&
              role.tool_ids.includes("dataset.read"),
            image2_generate: role.tool_ids.includes("image.generate.internal"),
            code_read: role.tool_ids.includes("code.read"),
            code_write: role.tool_ids.includes("code.patch"),
            code_package: role.tool_ids.includes("delivery.package"),
            design_render: allowedFormats.length > 0,
            font_catalog: role.tool_ids.includes("font.inspect"),
            image2_edit: role.tool_ids.includes("image.edit.internal"),
          }) as Record<string, boolean>
        )[tool.name],
    );
    // A model cannot regain write capabilities by ignoring the requested mode.
    return t.mode === "ask" ||
      t.mode === "plan" ||
      t.input_context?.analysis_report_id
      ? permitted.filter((tool) =>
          [
            "project_assets",
            "asset_text_read",
            "cloud_files",
            "cloud_file_read",
            "marketing_metrics",
            "analysis_report_facts",
            "code_read",
            "font_catalog",
          ].includes(tool.name),
        )
      : permitted;
  }
  private imageTool(
    t: any,
    actor: Principal,
    fencing: string,
    authorize: (tx: any) => Promise<void>,
    edit = false,
  ): RuntimeContext["tools"][number] {
    return {
      name: edit ? "image2_edit" : "image2_generate",
      description: edit
        ? "Edit an authorized current project image through the company internal Image 2 capability and save a new immutable artifact."
        : "Generate one real image through the company internal Image 2 capability, with a recorded charge and immutable artifact.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          filename: { type: "string" },
          ...(edit ? { asset_id: { type: "string" } } : {}),
        },
        required: ["prompt", "filename", ...(edit ? ["asset_id"] : [])],
        additionalProperties: false,
      },
      run: async (args, callId) => {
        const b = z
          .object({
            prompt: z.string().min(5).max(12000),
            filename: z.string().min(1).max(160).endsWith(".png"),
            ...(edit ? { asset_id: uuid } : {}),
          })
          .strict()
          .parse(args);
        const c = this.db.config;
        if (
          !c.AI_IMAGE_VERIFIED ||
          !c.AI_IMAGE_MODEL ||
          !c.AI_IMAGE_HKD_MICROS_PER_IMAGE ||
          !c.AI_BASE_URL ||
          !c.AI_API_KEY
        )
          throw new Error("Image 2 is not configured");
        let source: { bytes: Buffer; mime: string; name: string } | undefined;
        if (edit)
          source = await this.db.tx(async (tx) => {
            await authorize(tx);
            const v = (
              await tx.query(
                "SELECT a.name,v.mime_type,v.storage_key,v.bytes FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=$1 AND a.project_id=$2 AND a.state='active'",
                [(b as any).asset_id, t.project_id],
              )
            ).rows[0];
            if (
              !v ||
              !["image/png", "image/jpeg", "image/webp"].includes(
                v.mime_type,
              ) ||
              Number(v.bytes) > 10_000_000
            )
              throw new Error(
                "Choose a current project PNG, JPEG or WebP smaller than 10 MB",
              );
            return {
              bytes: await this.storage.get(v.storage_key),
              mime: v.mime_type,
              name: v.name,
            };
          }, t.tenant_id);
        const op = await this.db.tx(async (tx) => {
          await authorize(tx);
          if (
            edit &&
            !(
              await tx.query(
                "SELECT 1 FROM assets WHERE id=$1 AND project_id=$2 AND state='active'",
                [(b as any).asset_id, t.project_id],
              )
            ).rowCount
          )
            throw new Problem(
              403,
              "ASSET_REVOKED",
              "The source image is no longer authorized",
            );
          await tx.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE", [t.id]);
          const old = (
            await tx.query(
              "SELECT * FROM tool_operations WHERE task_id=$1 AND call_id=$2",
              [t.id, callId],
            )
          ).rows[0];
          if (old) {
            if (old.input_hash !== hash(canonical(b)))
              throw new Error("Tool request conflict");
            if (old.state === "succeeded") return old;
            throw new Error("Operation requires reconciliation; do not replay");
          }
          const sum = (
            await tx.query(
              "SELECT coalesce(sum(charge_micros),0)::text AS n FROM tool_operations WHERE task_id=$1 AND state<>'failed'",
              [t.id],
            )
          ).rows[0];
          if (
            Number(sum.n) + c.AI_IMAGE_HKD_MICROS_PER_IMAGE! >
            Number(t.budget_micros)
          )
            throw new Error("Image budget exceeded");
          return (
            await tx.query(
              "INSERT INTO tool_operations(tenant_id,task_id,call_id,action,state,input_hash,charge_micros) VALUES($1,$2,$3,$6,'accepted',$4,$5) RETURNING *",
              [
                t.tenant_id,
                t.id,
                callId,
                hash(canonical(b)),
                c.AI_IMAGE_HKD_MICROS_PER_IMAGE,
                edit ? "image2.edit" : "image2.generate",
              ],
            )
          ).rows[0];
        }, t.tenant_id);
        if (op.state === "succeeded") return op.result;
        try {
          const form = new FormData();
          if (source) {
            form.append("model", c.AI_IMAGE_MODEL);
            form.append("prompt", b.prompt);
            form.append("n", "1");
            form.append("size", "1024x1024");
            form.append("output_format", "png");
            form.append(
              "image",
              new Blob([new Uint8Array(source.bytes)], { type: source.mime }),
              source.name,
            );
          }
          const response = await fetch(
            c.AI_BASE_URL.replace(/\/$/, "") +
              (edit ? "/images/edits" : "/images/generations"),
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${c.AI_API_KEY}`,
                ...(edit ? {} : { "Content-Type": "application/json" }),
                "Idempotency-Key": op.id,
              },
              body: edit
                ? form
                : JSON.stringify({
                    model: c.AI_IMAGE_MODEL,
                    prompt: b.prompt,
                    n: 1,
                    size: "1024x1024",
                    quality: "high",
                    output_format: "png",
                  }),
              redirect: "error",
              signal: AbortSignal.timeout(180000),
            },
          );
          if (!response.ok) throw new Error("Image gateway rejected operation");
          const r: any = await response.json();
          const encoded = r.data?.[0]?.b64_json;
          if (typeof encoded !== "string" || encoded.length > 70_000_000)
            throw new Error("Gateway must return bounded base64 image bytes");
          const bytes = Buffer.from(encoded, "base64");
          if (
            bytes.length < 8 ||
            bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
          )
            throw new Error("Invalid PNG response");
          return this.db.tx(async (tx) => {
            await authorize(tx);
            const a = await saveAsset(tx, this.storage, {
              tenant: t.tenant_id,
              project: t.project_id,
              user: actor.id,
              name: b.filename,
              mime: "image/png",
              bytes,
              kind: "generated_image",
              metadata: {
                task_id: t.id,
                operation_id: op.id,
                model: c.AI_IMAGE_MODEL,
              },
            });
            await tx.query(
              "UPDATE tool_operations SET state='succeeded',result=$2 WHERE id=$1",
              [op.id, a],
            );
            return a;
          }, t.tenant_id);
        } catch {
          await this.db.tx(
            (tx) =>
              tx.query(
                "UPDATE tool_operations SET state='reconciling' WHERE id=$1 AND state='accepted'",
                [op.id],
              ),
            t.tenant_id,
            false,
            actor.id,
          );
          throw new Error(
            "Image result is uncertain and needs reconciliation; do not retry creation",
          );
        }
      },
    };
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    for (const c of this.active.values()) c.abort();
    await this.boss.stop({ graceful: true, timeout: 20000 });
  }
}
