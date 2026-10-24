import { TaskBusinessTools } from "./task-business-tools.js";
import { GeneratedVideoJobs } from "./video-jobs.js";
import { CapabilityVideoVerification } from "./capability-video-verification.js";
import {
  assertTaskContentSources,
  recordTaskSourceRead,
} from "./task-content-sources.js";
import { expireAdminApprovals } from "./admin-approval-storage.js";
import { advanceCreativeMatrices } from "./creative-matrices.js";
import { advanceConnectors } from "./connectors.js";
import { advanceSeoAudits } from "./seo-audits.js";
import { seoCrawlReady } from "./seo-source-access.js";
import {
  seoChangeFacts,
  seoChangeInstructions,
  finalizeSeoChange,
  cancelUnavailableSeoChanges,
} from "./seo-changes.js";
import {
  seoAuditFacts,
  seoAuditInstructions,
  finalizeSeoReport,
} from "./seo-reports.js";
import {
  advanceVideoProjects,
  createVideoProject,
  enqueueVideoRender,
} from "./video-projects.js";
import { videoCreate } from "./video-project-model.js";
import { videoRendererProfile } from "./video-render.js";
import { dispatchFinancialNotifications } from "./financial-notifications.js";
import { CodeWorkspace } from "./code-workspace.js";
import { cleanAuthReceipts } from "./auth-receipts.js";
import { dispatchInvitationMail } from "./invitation-delivery.js";
import {
  readCloudSource,
  writeCloudSource,
  bundleCloudSources,
} from "./cloud-source.js";
import { listCloudReferences, readCloudReference } from "./cloud-references.js";
import { PgBoss } from "pg-boss";
import { taskCapabilities, runtimeSelection } from "./capability-bindings.js";
import {
  internalAIRequest,
  finishInternalAIRequest,
  AIRequestFailure,
  type AIRequestInfo,
} from "./internal-ai-gateway.js";
import {
  admitProviderRequest,
  providerRequestPermit,
  recoverProviderRequests,
} from "./provider-request-control.js";
import { validateVerificationPNG } from "./png-validation.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
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
import { taskProviderBudgetReceipt } from "./provider-budgets.js";
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
import { lockTaskTools, reuseCompletedTaskTool } from "./task-tool-reuse.js";
import {
  paidInputRequest,
  requestPaidInputs,
  assertNoPendingInputRequest,
  queuedPaidContinuation,
  consumePaidContinuation,
  completePaidInputCheckpoint,
  settleIdleTask,
} from "./paid-task-inputs.js";
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
  private stopping = false;
  private matrixRun: Promise<unknown> | null = null;
  private videoRun: Promise<unknown> | null = null;
  private videoAbort = new AbortController();
  private generatedVideoRun: Promise<unknown> | null = null;
  private generatedVideoAbort = new AbortController();
  private capabilityVideoRun: Promise<unknown> | null = null;
  private capabilityVideoAbort = new AbortController();
  private connectorRun: Promise<unknown> | null = null;
  private connectorAbort = new AbortController();
  private seoRun: Promise<unknown> | null = null;
  private seoAbort = new AbortController();
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
      // Local media composition has its own bounded queue and must not hold up
      // request recovery, invitations, erasure or other maintenance work.
      if (!this.stopping && !this.matrixRun) {
        this.matrixRun = advanceCreativeMatrices(this.db, this.storage)
          .catch(() =>
            console.error(
              JSON.stringify({
                component: "worker.creative_matrices",
                error_code: "MATRIX_MAINTENANCE_FAILED",
              }),
            ),
          )
          .finally(() => {
            this.matrixRun = null;
          });
      }
      if (!this.stopping && !this.videoRun) {
        this.videoRun = advanceVideoProjects(this.db, this.storage, undefined, {
          signal: this.videoAbort.signal,
        })
          .catch(() =>
            console.error(
              JSON.stringify({
                component: "worker.video_projects",
                error_code: "VIDEO_MAINTENANCE_FAILED",
              }),
            ),
          )
          .finally(() => {
            this.videoRun = null;
          });
      }
      if (!this.stopping && !this.generatedVideoRun) {
        this.generatedVideoRun = new GeneratedVideoJobs(this.db, this.catalog, this.storage).advance(this.generatedVideoAbort.signal)
          .catch(() => console.error(JSON.stringify({ component: "worker.generated_video", error_code: "VIDEO_JOB_MAINTENANCE_FAILED" })))
          .finally(() => { this.generatedVideoRun = null; });
      }
      if (!this.stopping && !this.capabilityVideoRun) {
        this.capabilityVideoRun = new CapabilityVideoVerification(this.db, this.catalog)
          .advance(this.capabilityVideoAbort.signal)
          .catch(() => console.error(JSON.stringify({ component: "worker.capability_video", error_code: "VIDEO_VERIFICATION_MAINTENANCE_FAILED" })))
          .finally(() => { this.capabilityVideoRun = null; });
      }
      if (!this.stopping && !this.connectorRun) {
        this.connectorRun = advanceConnectors(this.db, this.storage, {
          signal: this.connectorAbort.signal,
        })
          .catch(() =>
            console.error(
              JSON.stringify({
                component: "worker.connectors",
                error_code: "CONNECTOR_MAINTENANCE_FAILED",
              }),
            ),
          )
          .finally(() => {
            this.connectorRun = null;
          });
      }
      if (!this.stopping && !this.seoRun) {
        this.seoRun = advanceSeoAudits(this.db, this.catalog, this.storage, {
          signal: this.seoAbort.signal,
        })
          .catch(() =>
            console.error(
              JSON.stringify({
                component: "worker.seo",
                error_code: "SEO_MAINTENANCE_FAILED",
              }),
            ),
          )
          .finally(() => {
            this.seoRun = null;
          });
      }
      // A connector/workflow error must never starve cleanup or other due work.
      for (const [name, operation] of [
        ["provider_requests", () => recoverProviderRequests(this.db)],
        ["queue_recovery", () => recoverQueuedClaims(this.db)],
        ["schedules", () => advanceSchedules(this.db, this.catalog)],
        [
          "workflows",
          () => advanceWorkflows(this.db, this.catalog, this.storage),
        ],
        ["federation", () => expireFederationAttempts(this.db.control)],
        ["auth_receipts", () => cleanAuthReceipts(this.db)],
        ["retention", () => this.retention.advance()],
        ["seo-change-sources", () => cancelUnavailableSeoChanges(this.db)],
        ["erasure", () => this.erasure.advance()],
        ["uploads", () => cleanUploadStaging(this.db)],
        ["invitations", () => dispatchInvitationMail(this.db)],
        ["admin_approvals", () => expireAdminApprovals(this.db)],
        [
          "entitlement_notifications",
          () => dispatchEntitlementNotifications(this.db),
        ],
        [
          "financial_notifications",
          () => dispatchFinancialNotifications(this.db),
        ],
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
        if (!t || t.execution_location !== "cloud" || t.status !== "queued") return null;
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
        let continuation: any = null;
        try {
          await projectAccess(tx, actor, tenant, t.project_id, "write");
          if (t.content_state !== "active")
            throw new Error("Content is unavailable");
          await this.catalog.ensureEnabled(tx, t.role_key, t.role_hash);
          await assertTaskSkills(tx, this.catalog, t);
          await assertReportSources(tx, t);
          currentPlan = await authorizeExecutionPlan(
            tx,
            tenant,
            t.created_by,
            this.catalog.forTask(t),
            t.mode,
          );
          await resolveWorkContext(
            tx,
            actor,
            tenant,
            t.project_id,
            t.input_context,
            this.db.config.CODEX_VERSION,
            (await taskCapabilities(tx, this.db.config, this.catalog, t))
              .versionIds,
          );
          if (
            this.catalog.digest(this.catalog.forTask(t)) !== t.role_hash
          )
            throw new Error("Role version changed");
          if (!(await checkInputDependencies(tx, t))) return null;
          await assertTaskContentSources(tx, t);
          continuation = await queuedPaidContinuation(tx, t);
        } catch (error) {
          const code =
            error instanceof Problem && error.code.startsWith("TASK_")
              ? error.code
              : "AUTHORIZATION_CHANGED";
          const known = await settleIdleTask(tx, t);
          await tx.query(
            "UPDATE tasks SET status=$3,error_code=$2,version=version+1 WHERE id=$1",
            [id, code, known ? "cancelled" : "reconciling"],
          );
          if (known)
            await event(tx, tenant, id, "task.cancelled", { reason: code });
          else
            await event(tx, tenant, id, "task.finished", {
              status: "reconciling",
              error_code: code,
            });
          return null;
        }
        if (!(await seoCrawlReady(tx, t))) return null;
        const started = await claimCapacity(
          tx,
          t,
          this.catalog.forTask(t),
          currentPlan.body.max_active_tasks,
          fencing,
        );
        if (!started) return null;
        await consumePaidContinuation(tx, continuation, started);
        if (continuation) started.resume_thread = continuation.runtime_thread;
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
    let heartbeatPending: Promise<void> = Promise.resolve();
    const heartbeat = setInterval(() => {
      if (checking) return;
      checking = true;
      heartbeatPending = this.db
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
              await this.catalog.ensureEnabled(tx, task.role_key, task.role_hash);
              await assertTaskSkills(tx, this.catalog, task);
              await assertInputDependencies(tx, t);
              await assertReportSources(tx, t);
              await authorizeExecutionPlan(
                tx,
                tenant,
                task.created_by,
                this.catalog.forTask(task),
                task.mode,
              );
              await resolveWorkContext(
                tx,
                actor,
                tenant,
                task.project_id,
                task.input_context,
                this.db.config.CODEX_VERSION,
                (await taskCapabilities(tx, this.db.config, this.catalog, t))
                  .versionIds,
              );
              await assertTaskContentSources(tx, t);
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
    const stopHeartbeat = async () => {
      clearInterval(heartbeat);
      // A timer callback may still own a transaction after clearInterval. Join
      // it before finalization so it cannot renew a completed task's lease or
      // leave a source lock behind after run() has returned to its caller.
      await heartbeatPending;
    };
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
          await assertTaskContentSources(tx, live);
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
      const role = this.catalog.forTask(task);
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
          const capabilities = await taskCapabilities(
            tx,
            this.db.config,
            this.catalog,
            task,
          );
          const work = await resolveWorkContext(
            tx,
            actor!,
            tenant,
            task.project_id,
            task.input_context,
            this.db.config.CODEX_VERSION,
            capabilities.versionIds,
          );
          await assertTaskContentSources(tx, task);
          return {
            ...work,
            capabilities,
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
        prompt: `${context.instructions}\n\nWork mode: ${task.mode ?? "execute"}. ${task.mode === "execute" ? "Perform the authorized work. If essential authorized files or connections are missing, use request_input and finish the turn. Never invent missing data or perform more tool operations after requesting inputs." : "Read-only investigation. Return a written answer or plan; do not create assets or perform business writes."}${task.resume_thread ? "\nContinue the same authorized task after the user supplied the requested inputs. Reuse completed tool results and artifacts from this thread; do not repeat completed operations." : ""}\n\nCurrent user request:\n${task.prompt}${task.input_context?.analysis_report_id ? "\n\n" + analysisReportInstructions : ""}${task.input_context?.seo_audit_id ? "\n\n" + seoAuditInstructions : ""}${task.input_context?.seo_change_task_id ? "\n\n" + seoChangeInstructions : ""}`,
        workspace: path.resolve(this.db.config.DATA_DIR, "runs", tenant, id),
        thread: task.resume_thread,
        skills: bound,
        selection: runtimeSelection(context.capabilities),
        requestAuthority: {
          budgeted: true,
          taskId: id,
          tenantId: tenant,
          projectId: task.project_id,
          actorId: actor!.id,
          capabilityVersionId: context.capabilities.text.id,
          attempt: task.attempt,
          fencingToken: fencing,
          authorize: (request) =>
            this.authorizeInference(task, actor!, fencing, request),
        },
        signal: controller.signal,
        onEvent: emit,
        tools: this.tools(task, actor!, fencing, effectiveRole, !!context.capabilities.video),
      });
      completedUsage = result;
      await stopHeartbeat();
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
        undefined,
        result.status === "completed" && result.usageKnown
          ? { thread: result.thread, turn: result.turn }
          : undefined,
      );
    } catch (e) {
      await stopHeartbeat();
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
      await stopHeartbeat();
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
    native?: { thread: string; turn: string },
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
        // Adapter usage is per turn. Provider receipts, when present below,
        // remain the authoritative cumulative task total across all attempts.
        input += Number(live.input_tokens);
        output += Number(live.output_tokens);
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
          await this.catalog.ensureEnabled(tx, t.role_key, t.role_hash);
          await assertTaskSkills(tx, this.catalog, t);
          await assertInputDependencies(tx, live);
          await assertReportSources(tx, live);
          await authorizeExecutionPlan(
            tx,
            t.tenant_id,
            t.created_by,
            this.catalog.forTask(t),
            t.mode,
          );
          const context = await resolveWorkContext(
            tx,
            actor,
            t.tenant_id,
            t.project_id,
            live.input_context,
            this.db.config.CODEX_VERSION,
            (await taskCapabilities(tx, this.db.config, this.catalog, live))
              .versionIds,
          );
          await assertTaskContentSources(tx, live);
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
        let meteredTokens = 0;
        try {
          // Historical prices remain authoritative after revocation, a gateway
          // change or a new publication. They are not an execution permission.
          const binding = await taskCapabilities(
            tx,
            this.db.config,
            this.catalog,
            live,
            false,
          );
          meteredTokens = tokenCharge(
            input,
            output,
            binding.text.body.rates[0],
            binding.text.body.rates[1],
          );
        } catch {
          if (input || output || uncertain) {
            uncertain = true;
            status = "failed";
            text = "";
            error = "TASK_PRICING_RECONCILIATION_REQUIRED";
          }
        }
        const toolCharge = Number(ops.charge);
        if (
          !Number.isSafeInteger(toolCharge) ||
          !Number.isSafeInteger(toolCharge + meteredTokens)
        )
          throw new Error("Invalid immutable tool charge");
        const receipt = await taskProviderBudgetReceipt(tx, t.id);
        // Actual gateway facts survive a lost terminal frame or a pricing
        // violation. Tool image facts are already included, so never add twice.
        const cost = receipt.requests
          ? receipt.knownChargeMicros
          : meteredTokens + toolCharge;
        if (receipt.requests) {
          input = receipt.inputTokens;
          output = receipt.outputTokens;
          uncertain ||= receipt.uncertain || receipt.violation;
          if (receipt.violation) {
            status = "failed";
            text = "";
            error = "AI_REQUEST_BUDGET_VIOLATION";
          }
        }
        const inputRequested = !!(
          await tx.query(
            "SELECT 1 FROM task_input_checkpoints WHERE task_id=$1 AND fencing_token=$2 AND state='requested'",
            [t.id, fencing],
          )
        ).rowCount;
        if (
          inputRequested &&
          status === "succeeded" &&
          !uncertain &&
          !ops.uncertain
        ) {
          try {
            if (
              await completePaidInputCheckpoint(
                tx,
                live,
                text,
                input,
                output,
                cost,
                native,
              )
            )
              return;
          } catch (e) {
            if (
              !(e instanceof Problem) ||
              e.code !== "INPUT_CHECKPOINT_UNAVAILABLE"
            )
              throw e;
            status = "failed";
            error = e.code;
            text = "";
          }
        }
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
        if (
          status === "succeeded" &&
          !uncertain &&
          !ops.uncertain &&
          live.input_context?.seo_audit_id
        ) {
          try {
            text = await finalizeSeoReport(tx, this.storage, live, text);
          } catch (e) {
            if (!(e instanceof Problem) || e.code !== "SEO_NARRATIVE_INVALID")
              throw e;
            status = "failed";
            error = e.code;
            text = "";
          }
        }
        if (
          status === "succeeded" &&
          !uncertain &&
          !ops.uncertain &&
          live.input_context?.seo_change_task_id
        ) {
          try {
            text = await finalizeSeoChange(tx, this.storage, live, text);
          } catch (e) {
            if (
              !(e instanceof Problem) ||
              e.code !== "SEO_CHANGE_NARRATIVE_INVALID"
            )
              throw e;
            status = "failed";
            error = e.code;
            text = "";
          }
        }
        await tx.query(
          "UPDATE tasks SET status=$2,output=$3,input_tokens=$4,output_tokens=$5,error_code=$6,accrued_micros=$7,lease_until=NULL,updated_at=now(),version=version+1 WHERE id=$1",
          [t.id, status, text, input, output, error ?? null, cost],
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
  private async authorizeTaskRequest(
    tx: any,
    t: any,
    actor: Principal,
    fencing: string,
  ) {
    await projectAccess(tx, actor, t.tenant_id, t.project_id, "write");
    await this.catalog.ensureEnabled(tx, t.role_key, t.role_hash);
    await assertTaskSkills(tx, this.catalog, t);
    await assertInputDependencies(tx, t);
    await assertReportSources(tx, t);
    await authorizeExecutionPlan(
      tx,
      t.tenant_id,
      t.created_by,
      this.catalog.forTask(t),
      t.mode,
    );
    const capabilities = await taskCapabilities(
      tx,
      this.db.config,
      this.catalog,
      t,
    );
    await resolveWorkContext(
      tx,
      actor,
      t.tenant_id,
      t.project_id,
      t.input_context,
      this.db.config.CODEX_VERSION,
      capabilities.versionIds,
    );
    await assertTaskContentSources(tx, t);
    await tx.query("SELECT set_config('app.task_id',$1,true)", [t.id]);
    if (
      !(
        await tx.query(
          "SELECT 1 FROM tasks WHERE id=$1 AND tenant_id=$3 AND project_id=$4 AND created_by=$5 AND fencing_token=$2 AND status='running' AND content_state='active' AND NOT cancel_requested AND lease_until>now()",
          [t.id, fencing, t.tenant_id, t.project_id, actor.id],
        )
      ).rowCount
    )
      throw new Problem(409, "RUN_FENCED", "Execution is no longer active");
    return capabilities;
  }
  private async authorizeInference(
    t: any,
    actor: Principal,
    fencing: string,
    request: AIRequestInfo,
  ) {
    const authorize = async (tx: Tx) => {
      const binding = await this.authorizeTaskRequest(tx, t, actor, fencing);
      const capability = request.operation.startsWith("responses")
        ? binding.text
        : binding.image;
      if (
        !capability ||
        request.taskId !== t.id ||
        request.tenantId !== t.tenant_id ||
        request.projectId !== t.project_id ||
        request.actorId !== actor.id ||
        request.capabilityVersionId !== capability.id ||
        request.model !== capability.body.model_alias ||
        request.attempt !== t.attempt ||
        request.fencingToken !== fencing ||
        !(
          await tx.query(
            "SELECT 1 FROM reservations WHERE task_id=$1 AND status='reserved'",
            [t.id],
          )
        ).rowCount
      )
        throw new Problem(
          409,
          "AI_REQUEST_SCOPE_INVALID",
          "Inference scope is no longer authorized",
        );
      return capability;
    };
    const admitted = await this.db.tx(
      async (tx) => {
        const capability = await authorize(tx);
        await event(tx, t.tenant_id, t.id, "gateway.request_authorized", {
          operation_id: request.requestId,
          operation: request.operation,
          capability_version_id: capability.id,
          model_alias: request.model,
          request_bytes: request.requestBytes,
          request_hash: request.requestHash,
          attempt: t.attempt,
        });
        return admitProviderRequest(tx, "task", request);
      },
      t.tenant_id,
      false,
      actor.id,
    );
    return providerRequestPermit(
      this.db,
      admitted,
      { tenantId: t.tenant_id, actorId: actor.id, control: false },
      async (tx) => {
        await authorize(tx);
      },
      request,
    );
  }
  private tools(t: any, actor: Principal, fencing: string, role: any, videoReady = false): RuntimeContext["tools"] {
    // A fixed GEO observation has no retrieval, file, connector or mutation
    // tools, regardless of tools available to the selected specialist role.
    if (t.input_context?.geo_sample_id) return [];
    return new TaskBusinessTools(this.db, this.catalog, this.storage, {
      authorize: tx => this.authorizeTaskRequest(tx, t, actor, fencing),
      inference: request => this.authorizeInference(t, actor, fencing, request),
      signal: this.active.get(t.id)?.signal,
      videoReady,
    }).build(t, actor, fencing, role);
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const c of this.active.values()) c.abort();
    await this.boss.stop({ graceful: true, timeout: 20000 });
    this.videoAbort.abort();
    this.generatedVideoAbort.abort();
    this.capabilityVideoAbort.abort();
    this.connectorAbort.abort();
    this.seoAbort.abort();
    await this.videoRun;
    await this.generatedVideoRun;
    await this.capabilityVideoRun;
    await this.connectorRun;
    await this.seoRun;
    await this.matrixRun;
  }
}
import { dispatchEntitlementNotifications } from "./user-entitlements.js";
