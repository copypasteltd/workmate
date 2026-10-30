import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Principal } from "./auth.js";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import { requireUser, audit } from "./auth.js";
import { key, projectAccess, replay } from "./access.js";
import {
  canonical,
  hash,
  micros,
  name,
  Problem,
  seal,
  token,
  unseal,
  uuid,
} from "./lib.js";
import { validFederation } from "./federation-session.js";
import { enqueueTask } from "./task-service.js";
import { revisionSelection } from "./delivery-revision-model.js";
import { prepareDeliveryRevision } from "./delivery-revisions.js";
import { deliveryTaskAccess } from "./business-quality.js";
import { event } from "./tasks.js";
import { assertTaskSkills } from "./skill-lifecycle.js";
import { projectConfigurationInstructions } from "./project-configuration.js";
import { assertTaskContentSources } from "./task-content-sources.js";
import { authorizeExecutionPlan } from "./plans.js";
import { taskCapabilities } from "./capability-bindings.js";
import {
  admitProviderRequest,
  providerRequestPermit,
} from "./provider-request-control.js";
import { taskProviderBudgetReceipt } from "./provider-budgets.js";
import { settle } from "./billing.js";
import {
  startScopedInferenceGateway,
  type AIRequestInfo,
} from "./internal-ai-gateway.js";
import { desktopRuntime, seedDesktopRuntime } from "./desktop-runtime.js";
import {
  desktopSessionBinding,
  desktopStartBody,
  desktopStartupState,
  assertDesktopStartupAuthority,
  registerDesktopStartupRecovery,
} from "./desktop-startup-recovery.js";
import {
  desktopToolNames,
  desktopCompanyToolSchema,
} from "./desktop-tool-policy.js";
import { requestTaskCancellation } from "./task-control.js";
import type { Storage } from "./storage.js";
import { registerDesktopSolutions } from "./desktop-solutions.js";
import { registerDesktopGeo, desktopGeoProtocol } from "./desktop-geo.js";
import {
  freezeWorkContext,
  getAgentVersion,
  resolveWorkContext,
  type WorkContext,
} from "./persistent-work.js";
import { TaskBusinessTools } from "./task-business-tools.js";
import {
  DesktopWorkflows,
  lockNativeWorkflowParent,
} from "./desktop-workflows.js";

const params = z.object({ tenant: uuid, project: uuid });
const executionParams = params.extend({ execution: uuid });
const binding = desktopSessionBinding;
const createBody = binding
  .extend({
    title: name,
    prompt: z.string().trim().min(1).max(30000),
    role_key: z.string().max(80),
    budget_micros: micros,
    agent_id: uuid.optional(),
    agent_version: z.number().int().positive().optional(),
    delivery_revision: revisionSelection.optional(),
  })
  .strict()
  .refine(
    (b) => !!b.agent_id === !!b.agent_version,
    "Supply both the specialist ID and its fixed version",
  );
const reportBody = z
  .object({
    status: z.enum(["completed", "failed", "interrupted", "unknown"]),
    output: z.string().max(100000),
    thread_id: z.string().min(1).max(128),
    turn_id: z.string().min(1).max(128),
  })
  .strict();
// Admission means the native tool protocol is connected, not full professional
// qualification. Native workflow steps have their own local execution contract.
export const desktopLocalRoleKeys = [
  "assistant",
  "fullstack",
  "frontend",
  "backend-api",
  "software-qa",
  "landing-page",
  "ui-ux",
  "designer",
  "brand-visual",
  "ad-creative",
  "ecommerce",
  "social-content",
  "illustration-ip",
  "typography-layout",
  "presentation",
  "information-design",
  "marketing-analyst",
  "video-motion",
  "workflow-consultant",
];
const companyToolNames = new Set([
  "project_assets",
  "asset_text_read",
  "cloud_files",
  "cloud_file_read",
  "deliver_text",
  "marketing_metrics",
  "design_render",
  "font_catalog",
  "image2_generate",
  "image2_edit",
  "project_reference_read",
  "solution_list",
  "solution_read",
  "solution_source_read",
]);
const methodToolNames = new Set([
  "solution_list",
  "solution_read",
  "solution_source_read",
]);
// New tools are available only on explicitly versioned specialists. Already
// frozen 1.0 tasks retain their original descriptors and authority.
const analysisCompanyToolNames = new Set([
  "analysis_sources",
  "analysis_file_inspect",
  "connector_read",
  "external_budget_preview",
  "external_budget_prepare",
  "external_budget_status",
  "sheet_calculate",
  "analysis_source_read",
  "chart_render",
]);
const editableCompanyToolNames = new Set([
  "design_sources",
  "design_source_read",
  "design_chart_read",
  "vector_render",
  "slides_build",
  "slides_render",
]);
// Existing native roles keep exactly their published tool bindings. The new
// specialist has no old native thread and receives the video contract only.
const videoCompanyToolNames = new Set([
  "video_projects",
  "video_project_read",
  "video_project_queue",
  "video_project_status",
  "video_project_edit",
  "video_project_render",
  "video_project_cancel",
  "generated_video_create",
  "generated_video_status",
  "generated_video_cancel",
  "audio_produce",
  "effects_catalog",
  "effects_sources",
  "effect_render",
]);
const companyCall = z
  .object({
    tool: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    arguments: z.record(z.string(), z.unknown()),
    call_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
    thread_id: z.string().min(1).max(128),
    turn_id: z.string().min(1).max(128),
    startup_fencing_token: uuid.optional(),
  })
  .strict();
const denied = (code = "DESKTOP_EXECUTION_UNAVAILABLE") =>
  new Problem(
    409,
    code,
    "This local execution needs to be stopped or reconciled on its owning desktop",
  );
type Gateway = Awaited<ReturnType<typeof startScopedInferenceGateway>>;

/** Platform grants inference/budget only. It cannot grant local OS permissions. */
export async function registerDesktopExecutions(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
  storage: Storage,
) {
  await seedDesktopRuntime(db);
  registerDesktopSolutions(app, db, catalog, desktopLocalRoleKeys);
  const gateways = new Map<string, Promise<Gateway>>(),
    shutdown = new AbortController();
  const companyCalls = new Map<
    string,
    { taskId: string; abort: AbortController; promise: Promise<unknown> }
  >();
  const base = "/v1/tenants/:tenant/projects/:project/desktop-executions";
  const workflows = new DesktopWorkflows(
    db,
    catalog,
    storage,
    authorize,
    desktopLocalRoleKeys,
  );

  async function desktopFamily(tx: Tx, actor: Principal) {
    if (actor.audience !== "native")
      throw new Problem(
        403,
        "DESKTOP_SIGN_IN_REQUIRED",
        "Sign in from the desktop application",
      );
    const row = (
      await tx.query(
        `SELECT family_id FROM refresh_tokens WHERE session_id=$1 AND user_id=$2 AND client_id='desktop'
       AND revoked_at IS NULL AND expires_at>now() LIMIT 1`,
        [actor.sessionId, actor.id],
      )
    ).rows[0];
    if (!row)
      throw new Problem(
        403,
        "DESKTOP_SIGN_IN_REQUIRED",
        "A current desktop authorization is required",
      );
    return row.family_id as string;
  }

  registerDesktopGeo(app, db, catalog, desktopFamily, desktopLocalRoleKeys);

  async function own(tx: Tx, req: FastifyRequest, write = false, lock = false) {
    const p = executionParams.parse(req.params);
    await projectAccess(
      tx,
      req.principal,
      p.tenant,
      p.project,
      write ? "write" : "read",
    );
    const family = await desktopFamily(tx, req.principal);
    if (lock) {
      const hint = (
        await tx.query("SELECT * FROM tasks WHERE id=$1 AND project_id=$2", [
          p.execution,
          p.project,
        ])
      ).rows[0];
      if (hint) await lockNativeWorkflowParent(tx, hint);
    }
    const t = (
      await tx.query(
        "SELECT * FROM tasks WHERE id=$1 AND project_id=$2" +
          (lock ? " FOR UPDATE" : ""),
        [p.execution, p.project],
      )
    ).rows[0];
    if (!t || t.execution_location !== "desktop")
      throw new Problem(404, "NOT_FOUND", "Local execution not found");
    const d = (
      await tx.query(
        "SELECT * FROM desktop_executions WHERE task_id=$1" +
          (lock ? " FOR UPDATE" : ""),
        [t.id],
      )
    ).rows[0];
    if (!d || d.actor_id !== req.principal.id || d.native_family_id !== family)
      throw new Problem(404, "NOT_FOUND", "Local execution not found");
    return { d, t };
  }

  async function authorize(tx: Tx, d: any, t: any, active = true) {
    t.native_method_tools_version = d.method_tools_version;
    const parent = await lockNativeWorkflowParent(tx, t, true);
    if (parent) await authorize(tx, parent.d, parent.t);
    const actor: Principal = {
      id: t.created_by,
      authVersion: t.actor_auth_version,
      audience: "native",
      email: "",
      name: "",
      sessionId: "",
      sessionHash: "",
    };
    await projectAccess(tx, actor, t.tenant_id, t.project_id, "write");
    const sessions = (
      await tx.query(
        `SELECT s.* FROM sessions s JOIN refresh_tokens f ON f.session_id=s.id WHERE f.family_id=$1 AND f.client_id='desktop'
       AND f.user_id=$2 AND f.revoked_at IS NULL AND f.expires_at>now() AND s.revoked_at IS NULL AND s.expires_at>now()
       AND s.auth_version=$3 ORDER BY s.created_at DESC LIMIT 1`,
        [d.native_family_id, actor.id, actor.authVersion],
      )
    ).rows;
    if (!sessions[0] || !(await validFederation(tx, sessions[0])))
      throw denied("DESKTOP_AUTHORIZATION_REVOKED");
    await catalog.ensureEnabled(tx, t.role_key, t.role_hash);
    if (catalog.digest(catalog.forTask(t)) !== t.role_hash)
      throw denied("DESKTOP_ROLE_VERSION_CHANGED");
    await assertTaskSkills(tx, catalog, t);
    await authorizeExecutionPlan(
      tx,
      t.tenant_id,
      t.created_by,
      catalog.forTask(t),
      t.mode,
    );
    await assertTaskContentSources(tx, t);
    if (t.input_context?.agent_id) {
      const agent = await getAgentVersion(
        tx,
        t.project_id,
        t.input_context.agent_id,
        t.input_context.agent_version,
      );
      const resolved = await resolveWorkContext(
        tx,
        actor,
        t.tenant_id,
        t.project_id,
        t.input_context,
        catalog.runtimeProfile.pinned_version,
        [...(await catalog.currentCapabilities(tx)).values()].map((v) => v.id),
      );
      t.native_agent_tool_ids = agent.body.tool_ids;
      t.native_specialist_instructions = resolved.instructions;
    }
    const capabilities = await taskCapabilities(tx, db.config, catalog, t);
    if (
      active &&
      (d.state !== "running" ||
        t.status !== "running" ||
        t.cancel_requested ||
        t.content_state !== "active" ||
        new Date(t.lease_until).getTime() <= Date.now() ||
        new Date(d.credential_expires_at).getTime() <= Date.now())
    )
      throw denied();
    if (
      !(
        await tx.query(
          "SELECT 1 FROM reservations WHERE task_id=$1 AND status='reserved'",
          [t.id],
        )
      ).rowCount
    )
      throw denied("DESKTOP_RESERVATION_UNAVAILABLE");
    await tx.query("SELECT set_config('app.task_id',$1,true)", [t.id]);
    return { actor, capabilities };
  }

  async function inferenceAuthority(d: any, t: any, request: AIRequestInfo) {
    const check = async (tx: Tx) => {
      // Lock the task before its execution row everywhere; dispatch, finish and
      // heartbeat use the same ordering and cannot admit behind finalization.
      await lockNativeWorkflowParent(tx, t);
      const current = (
        await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [t.id])
      ).rows[0];
      const execution = (
        await tx.query(
          "SELECT * FROM desktop_executions WHERE task_id=$1 FOR UPDATE",
          [t.id],
        )
      ).rows[0];
      if (!current || !execution || current.fencing_token !== t.fencing_token)
        throw denied();
      assertDesktopStartupAuthority(execution, current, request.fencingToken);
      const { capabilities } = await authorize(tx, execution, current);
      const operation =
        request.operation === "responses.input_tokens"
          ? "responses"
          : request.operation;
      if (
        operation !== "responses" &&
        operation !== "images.generate" &&
        operation !== "images.edit"
      )
        throw denied("AI_REQUEST_SCOPE_INVALID");
      const capability =
        operation === "responses" ? capabilities.text : capabilities.image;
      if (
        !capability ||
        !capability.body.supported_operations.includes(operation) ||
        request.taskId !== t.id ||
        request.tenantId !== t.tenant_id ||
        request.projectId !== t.project_id ||
        request.actorId !== t.created_by ||
        request.attempt !== t.attempt ||
        request.fencingToken !== t.fencing_token ||
        request.capabilityVersionId !== capability.id ||
        request.model !== capability.body.model_alias
      )
        throw denied("AI_REQUEST_SCOPE_INVALID");
    };
    const admitted = await db.tx(
      async (tx) => {
        await check(tx);
        return admitProviderRequest(tx, "task", request);
      },
      t.tenant_id,
      false,
      t.created_by,
    );
    return providerRequestPermit(
      db,
      admitted,
      { tenantId: t.tenant_id, actorId: t.created_by, control: false },
      check,
      request,
    );
  }

  async function closeGateway(id: string) {
    for (const [gatewayKey, gateway] of [...gateways]) {
      if (gatewayKey !== id && !gatewayKey.startsWith(id + ":")) continue;
      try {
        await (await gateway).close();
      } finally {
        if (gateways.get(gatewayKey) === gateway) gateways.delete(gatewayKey);
      }
    }
  }

  function businessTools(
    t: any,
    actor: Principal,
    signal?: AbortSignal,
    videoReady = false,
  ) {
    if (t.input_context?.geo_sample_id) return [];
    const installedRole = catalog.forTask(t);
    const role = t.native_agent_tool_ids
      ? {
          ...installedRole,
          tool_ids: installedRole.tool_ids.filter((id: string) =>
            t.native_agent_tool_ids.includes(id),
          ),
        }
      : installedRole;
    const analysisReady =
      (role.version === "1.1.0" ||
        (role.role_key === "marketing-analyst" &&
          ["1.2.0", "1.3.0"].includes(role.version))) &&
      ["marketing-analyst", "information-design", "presentation"].includes(
        role.role_key,
      );
    const editableReady =
      role.version === "1.1.0" &&
      ["brand-visual", "presentation"].includes(role.role_key);
    const tools = new TaskBusinessTools(db, catalog, storage, {
      authorize: async (tx) => {
        await lockNativeWorkflowParent(tx, t);
        const current = (
          await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [t.id])
        ).rows[0];
        const execution = (
          await tx.query(
            "SELECT * FROM desktop_executions WHERE task_id=$1 FOR UPDATE",
            [t.id],
          )
        ).rows[0];
        if (
          !current ||
          !execution ||
          current.fencing_token !== t.fencing_token ||
          current.created_by !== actor.id
        )
          throw denied();
        await authorize(tx, execution, current);
      },
      inference: (request) => inferenceAuthority(null, t, request),
      signal,
      videoReady,
    })
      .build(t, actor, t.fencing_token, role)
      .filter(
        (tool) =>
          (companyToolNames.has(tool.name) &&
            (!methodToolNames.has(tool.name) ||
              t.native_method_tools_version === 1)) ||
          (analysisReady && analysisCompanyToolNames.has(tool.name)) ||
          (editableReady && editableCompanyToolNames.has(tool.name)) ||
          (role.role_key === "social-content" && role.version === "1.1.0" &&
            ["publication_accounts", "publication_preview", "publication_prepare", "publication_status"].includes(tool.name)) ||
          (t.role_key === "video-motion" &&
            (videoCompanyToolNames.has(tool.name) ||
              methodToolNames.has(tool.name))),
      );
    return [
      ...tools,
      ...(role.tool_ids.includes("workflow.run") &&
      role.tool_ids.includes("workflow.validate")
        ? workflows.build(t, actor)
        : []),
    ];
  }
  async function closeCompanyCalls(id?: string) {
    const calls = [...companyCalls.values()].filter(
      (call) => id === undefined || call.taskId === id,
    );
    calls.forEach((call) => call.abort.abort());
    await Promise.allSettled(calls.map((call) => call.promise));
  }

  const publicExecution = (d: any, t: any) => ({
    task_id: t.id,
    local_session_id: d.local_session_id,
    device_id: d.device_id,
    execution_location: "desktop",
    state: d.state,
    status: t.status,
    cancel_requested: t.cancel_requested,
    budget_micros: t.budget_micros,
    charged_micros: t.charged_micros,
    accrued_micros: t.accrued_micros,
    lease_until: t.lease_until,
    credential_expires_at: d.credential_expires_at,
    output: t.output,
    result_origin: d.client_report ? "desktop_client_report" : null,
    error_code: t.error_code,
    startup: desktopStartupState(d, t),
  });

  async function startReceipt(tx: Tx, actor: Principal, live: any, task: any) {
    const { capabilities } = await authorize(tx, live, task);
    const skills = await Promise.all(
      (await catalog.boundSkills(catalog.forTask(task))).map(async skill => ({
        key: skill.key, sha256: skill.sha256, content: await catalog.verifySkill(skill),
      })),
    );
    const companyTools = businessTools(task, actor, undefined, !!capabilities.video)
      .map(({ name, description, inputSchema }) => ({
        name, description, inputSchema: desktopCompanyToolSchema(inputSchema),
      }));
    const projectInstructions = await projectConfigurationInstructions(
      tx, task.tenant_id, task.project_id, task.input_context?.project_configuration,
    );
    const contract = {
      inference_path: "/v1/desktop-inference/v1",
      model: capabilities.text.body.model_alias,
      effort: capabilities.text.body.reasoning_effort,
      company_tools: companyTools,
      ...(task.input_context?.geo_sample_id ? { observation_protocol: desktopGeoProtocol } : {}),
      runtime: desktopRuntime,
      skills,
      project_configuration: task.input_context?.project_configuration ?? null,
      prompt: task.native_specialist_instructions || projectInstructions
        ? (task.native_specialist_instructions || projectInstructions) + "\n\n" + task.prompt
        : task.prompt,
      role_instructions: catalog.forTask(task).workflow.map((step: any) => step.instruction).join("\n"),
    };
    if (live.startup_protocol) {
      const digest = hash(canonical(contract));
      if (live.startup_contract_sha256 && live.startup_contract_sha256 !== digest)
        throw denied("DESKTOP_STARTUP_CONTRACT_CHANGED");
      if (!live.startup_contract_sha256) {
        if (live.startup_attempt !== 1 || live.startup_state !== "preparing")
          throw denied("DESKTOP_STARTUP_CONTRACT_CHANGED");
        await tx.query("UPDATE desktop_executions SET startup_contract_sha256=$2 WHERE task_id=$1", [task.id, digest]);
        live = { ...live, startup_contract_sha256: digest };
      }
    }
    return {
      ...publicExecution(live, task), ...contract,
      credential: {
        token: unseal(db.config.MASTER_KEY!, live.credential_cipher),
        expires_at: live.credential_expires_at,
      },
    };
  }

  registerDesktopStartupRecovery(app, db, {
    base, own, authorize, receipt: startReceipt,
    close: async taskId => { await closeCompanyCalls(taskId); await closeGateway(taskId); },
  });

  workflows.register(app, base, (tx, req) => own(tx, req, true, true));

  app.get(base + "/runtime", { preHandler: requireUser(db) }, async (req) => {
    const p = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, p.tenant, p.project, "write");
      await desktopFamily(tx, req.principal);
      return {
        ...desktopRuntime,
        role_keys: desktopLocalRoleKeys,
        local_permission_authority: "customer_device_only",
      };
    }, p.tenant);
  });

  app.get(
    base + "/specialists/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const p = params.extend({ id: uuid }).parse(req.params),
        q = z
          .object({ version: z.coerce.number().int().positive() })
          .strict()
          .parse(req.query);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, p.tenant, p.project, "write");
        await desktopFamily(tx, req.principal);
        const agent = await getAgentVersion(
          tx,
          p.project,
          p.id,
          q.version,
          true,
        );
        if (!desktopLocalRoleKeys.includes(agent.role_key))
          throw denied("DESKTOP_ROLE_NOT_READY");
        await catalog.ensureEnabled(tx, agent.role_key, agent.body.role_hash);
        await freezeWorkContext(
          tx,
          req.principal,
          p.tenant,
          p.project,
          agent,
          undefined,
          catalog,
        );
        return {
          id: agent.id,
          version: agent.bound_version,
          name: agent.body.name,
          role_key: agent.role_key,
        };
      }, p.tenant);
    },
  );

  app.post(base, { preHandler: requireUser(db) }, async (req) => {
    const p = params.parse(req.params),
      b = createBody.parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, p.tenant, p.project, "write");
      const family = await desktopFamily(tx, req.principal);
      if (!desktopLocalRoleKeys.includes(b.role_key))
        throw new Problem(
          409,
          "DESKTOP_ROLE_NOT_READY",
          "This specialist's native company tools are not qualified yet",
        );
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "desktop-session:" + b.local_session_id,
      ]);
      return replay(
        tx,
        req.principal.id,
        "desktop.create:" + p.project,
        key(req),
        b,
        async () => {
          const previous = (
            await tx.query(
              "SELECT d.*,t.role_key,t.role_hash,t.input_context FROM desktop_executions d JOIN tasks t ON t.id=d.task_id WHERE local_session_id=$1 ORDER BY d.created_at DESC LIMIT 1",
              [b.local_session_id],
            )
          ).rows[0];
          if (
            previous &&
            (previous.tenant_id !== p.tenant ||
              previous.project_id !== p.project ||
              previous.actor_id !== req.principal.id ||
              previous.device_id !== b.device_id ||
              previous.native_family_id !== family ||
              previous.workspace_hash !== b.workspace_hash ||
              previous.runtime_sha256 !== b.runtime_sha256 ||
              previous.role_key !== b.role_key ||
              (previous.input_context?.agent_id ?? null) !==
                (b.agent_id ?? null) ||
              (previous.input_context?.agent_version ?? null) !==
                (b.agent_version ?? null) ||
              previous.role_hash !==
                catalog.digest(catalog.role(b.role_key, previous.role_hash)) ||
              previous.state !== "finished")
          )
            throw denied("DESKTOP_SESSION_BINDING_CHANGED");
          let context: WorkContext | undefined;
          if (b.agent_id) {
            const agent = await getAgentVersion(
              tx,
              p.project,
              b.agent_id,
              b.agent_version,
              true,
            );
            if (agent.role_key !== b.role_key)
              throw denied("DESKTOP_SPECIALIST_ROLE_CHANGED");
            context = previous
              ? previous.input_context
              : await freezeWorkContext(
                  tx,
                  req.principal,
                  p.tenant,
                  p.project,
                  agent,
                  undefined,
                  catalog,
                );
            await resolveWorkContext(
              tx,
              req.principal,
              p.tenant,
              p.project,
              context!,
              catalog.runtimeProfile.pinned_version,
              [...(await catalog.currentCapabilities(tx)).values()].map(
                (v) => v.id,
              ),
            );
          }
          const revision = b.delivery_revision ? await (async () => {
            if (!previous || b.delivery_revision!.source_task_id !== previous.task_id)
              throw denied("DESKTOP_REVISION_SESSION_CHANGED");
            const original = await deliveryTaskAccess(tx, req.principal, p.tenant, previous.task_id, p.project);
            return prepareDeliveryRevision(tx, storage, req.principal, original, b.delivery_revision!, b.prompt);
          })() : undefined;
          const t = await enqueueTask(
            tx,
            db,
            catalog,
            req.principal,
            p.tenant,
            p.project,
            {
              title: b.title,
              prompt: revision?.prompt ?? b.prompt,
              role_key: b.role_key,
              budget_micros: b.budget_micros,
              ...(previous ? { parent_id: previous.task_id } : {}),
              ...(revision ? { dependencies: revision.dependencies } : {}),
            },
            key(req),
            { execution_location: "desktop", ...(context ? { context } : {}),
              ...(revision ? { delivery_revision: revision.binding, content_source_task_id: previous.task_id } : {}) },
          );
          const d = (
            await tx.query(
              `INSERT INTO desktop_executions(task_id,tenant_id,project_id,actor_id,device_id,local_session_id,native_family_id,workspace_hash,runtime_sha256,method_tools_version)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
              [
                t.id,
                p.tenant,
                p.project,
                req.principal.id,
                b.device_id,
                b.local_session_id,
                family,
                b.workspace_hash,
                b.runtime_sha256,
                previous?.method_tools_version ?? 1,
              ],
            )
          ).rows[0];
          await event(tx, p.tenant, t.id, "desktop.execution.prepared", {
            device_id: b.device_id,
            local_session_id: b.local_session_id,
            execution_location: "desktop",
          });
          return publicExecution(d, t);
        },
      );
    }, p.tenant);
  });

  app.get(
    base + "/:execution",
    { preHandler: requireUser(db) },
    async (req) => {
      const p = executionParams.parse(req.params);
      return db.tx(async (tx) => {
        const { d, t } = await own(tx, req);
        await assertTaskContentSources(tx, t);
        return publicExecution(d, t);
      }, p.tenant);
    },
  );

  app.post(
    base + "/:execution/start",
    { preHandler: requireUser(db) },
    async (req) => {
      const p = executionParams.parse(req.params),
        b = desktopStartBody.parse(req.body);
      return db.tx(async (tx) => {
        const { d, t } = await own(tx, req, true, true);
        if (
          d.device_id !== b.device_id ||
          d.local_session_id !== b.local_session_id ||
          d.workspace_hash !== b.workspace_hash ||
          d.runtime_sha256 !== b.runtime_sha256
        )
          throw denied("DESKTOP_SESSION_BINDING_CHANGED");
        await authorize(tx, d, t, false);
        const receipt = await replay(
          tx,
          req.principal.id,
          "desktop.start:" + t.id,
          key(req),
          b,
          async () => {
            if (
              d.state !== "prepared" ||
              t.status !== "queued" ||
              t.cancel_requested ||
              t.attempt !== 0
            )
              throw denied();
            const plan = await authorizeExecutionPlan(
              tx,
              p.tenant,
              req.principal.id,
              catalog.forTask(t),
            );
            const reason = (
              await tx.query(
                "SELECT claim_desktop_capacity($1,$2,$3,$4) AS reason",
                [t.id, b.device_id, plan.body.max_active_tasks, randomUUID()],
              )
            ).rows[0].reason;
            if (reason)
              throw new Problem(
                429,
                "DESKTOP_CAPACITY_WAIT",
                "Execution capacity is occupied; retry this request",
              );
            const secret = token(),
              expiresAt = new Date(Date.now() + db.config.AI_SCOPE_TTL_MS);
            await tx.query(
              "UPDATE desktop_executions SET state='running',credential_cipher=$2,credential_hash=$3,credential_expires_at=$4,started_at=now(),startup_protocol=$5,startup_attempt=$6,startup_state=$7,startup_deadline_at=$8 WHERE task_id=$1",
              [
                t.id,
                seal(db.config.MASTER_KEY!, secret),
                hash(secret),
                expiresAt,
                b.startup_protocol ?? null,
                b.startup_protocol ? 1 : 0,
                b.startup_protocol ? "preparing" : "not_started",
                b.startup_protocol ? expiresAt : null,
              ],
            );
            await event(tx, p.tenant, t.id, "desktop.execution.started", {
              runtime_version: desktopRuntime.pinned_version,
              execution_location: "desktop",
            });
            return { task_id: t.id };
          },
        );
        const live = (
          await tx.query("SELECT * FROM desktop_executions WHERE task_id=$1", [
            receipt.task_id,
          ])
        ).rows[0];
        const task = (
          await tx.query("SELECT * FROM tasks WHERE id=$1", [receipt.task_id])
        ).rows[0];
        return startReceipt(tx, req.principal, live, task);
      }, p.tenant);
    },
  );

  app.post(
    base + "/:execution/tools",
    { preHandler: requireUser(db), bodyLimit: 2_100_000 },
    async (req, reply) => {
      const p = executionParams.parse(req.params),
        body = companyCall.parse(req.body);
      key(req);
      const {
        task: prepared,
        expiresAt,
        videoReady,
      } = await db.tx(async (tx) => {
        const { d, t } = await own(tx, req, true, true);
        const { capabilities } = await authorize(tx, d, t);
        assertDesktopStartupAuthority(d, t, body.startup_fencing_token);
        if (
          !businessTools(
            t,
            req.principal,
            undefined,
            !!capabilities.video,
          ).some((tool) => tool.name === body.tool)
        )
          throw new Problem(
            403,
            "DESKTOP_TOOL_NOT_ALLOWED",
            "This specialist cannot use that company tool",
          );
        // Commit the native call binding BEFORE effects. A different HTTP key,
        // tool, turn or payload cannot reuse this call id after a lost response.
        await replay(
          tx,
          req.principal.id,
          "desktop.tool:" + t.id,
          body.call_id,
          body,
          async () => {
            await event(
              tx,
              t.tenant_id,
              t.id,
              "desktop.company_tool.requested",
              { tool: body.tool, call_id: body.call_id },
            );
            return { bound: true };
          },
        );
        return {
          task: t,
          expiresAt: new Date(d.credential_expires_at).getTime(),
          videoReady: !!capabilities.video,
        };
      }, p.tenant);
      const callKey = prepared.id + ":" + body.call_id,
        existing = companyCalls.get(callKey);
      if (existing) return existing.promise;
      const abort = new AbortController();
      const closed = () => {
        if (!reply.raw.writableFinished) abort.abort();
      };
      req.raw.once("aborted", closed);
      reply.raw.once("close", closed);
      const signal = AbortSignal.any([
        shutdown.signal,
        abort.signal,
        AbortSignal.timeout(
          Math.max(
            1,
            Math.min(
              ["generated_video_create", "audio_produce"].includes(body.tool)
                ? 850000
                : db.config.AI_REQUEST_TIMEOUT_MS,
              expiresAt - Date.now(),
            ),
          ),
        ),
      ]);
      const promise = Promise.resolve()
        .then(async () => {
          if (signal.aborted) throw denied();
          const tool = businessTools(
            prepared,
            req.principal,
            signal,
            videoReady,
          ).find((item) => item.name === body.tool)!;
          const output = await tool.run(body.arguments, body.call_id);
          if (Buffer.byteLength(JSON.stringify(output)) > 2_000_000)
            throw new Problem(
              413,
              "DESKTOP_TOOL_RESULT_TOO_LARGE",
              "Company tool result is too large",
            );
          // An artifact may complete while permission is withdrawn. Keep its
          // durable measured result, but never disclose it after withdrawal.
          await db.tx(async (tx) => {
            const { d, t } = await own(tx, req, true, true);
            await authorize(tx, d, t);
          }, p.tenant);
          if (signal.aborted) throw denied();
          return { output };
        })
        .catch(async (error) => {
          // Fence subsequent requests when a dispatched image has no known result.
          const uncertain = await db.tx(
            async (tx) => {
              const current = (
                await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [
                  prepared.id,
                ])
              ).rows[0];
              if (!current || current.fencing_token !== prepared.fencing_token)
                return true;
              const pending = (
                await tx.query(
                  `SELECT 1 FROM tool_operations WHERE task_id=$1 AND call_id=$2 AND state IN ('accepted','reconciling')
          UNION ALL SELECT 1 FROM ai_video_jobs WHERE task_id=$1 AND call_id=$2 AND NOT usage_known
          UNION ALL SELECT 1 FROM ai_audio_jobs WHERE task_id=$1 AND call_id=$2 AND NOT usage_known`,
                  [prepared.id, body.call_id],
                )
              ).rowCount;
              if (pending) {
                await requestTaskCancellation(tx, current);
                return true;
              }
              return false;
            },
            p.tenant,
            true,
            prepared.created_by,
          );
          if (uncertain)
            throw new Problem(
              409,
              "DESKTOP_COMPANY_TOOL_UNCERTAIN",
              "This company operation needs reconciliation and cannot be replayed automatically",
            );
          throw error;
        });
      const active = { taskId: prepared.id, abort, promise };
      companyCalls.set(callKey, active);
      try {
        return await promise;
      } finally {
        req.raw.off("aborted", closed);
        reply.raw.off("close", closed);
        if (companyCalls.get(callKey) === active) companyCalls.delete(callKey);
      }
    },
  );

  app.post(
    base + "/:execution/heartbeat",
    { preHandler: requireUser(db) },
    async (req) => {
      const p = executionParams.parse(req.params);
      z.object({}).strict().parse(req.body);
      return db.tx(async (tx) => {
        const { d, t } = await own(tx, req, true, true);
        if (
          d.state === "running" &&
          t.status === "running" &&
          !t.cancel_requested
        ) {
          await authorize(tx, d, t);
          const cost = await taskProviderBudgetReceipt(tx, t.id);
          await tx.query(
            "UPDATE tasks SET lease_until=now()+interval '45 seconds',accrued_micros=$2 WHERE id=$1",
            [t.id, cost.knownChargeMicros],
          );
        }
        return publicExecution(
          d,
          (await tx.query("SELECT * FROM tasks WHERE id=$1", [t.id])).rows[0],
        );
      }, p.tenant);
    },
  );

  app.post(
    base + "/:execution/cancel",
    { preHandler: requireUser(db) },
    async (req) => {
      const p = executionParams.parse(req.params);
      z.object({}).strict().parse(req.body);
      key(req);
      const result = await db.tx(async (tx) => {
        const { d, t } = await own(tx, req, false, true);
        const cancelled = await requestTaskCancellation(tx, t);
        if (
          d.state === "prepared" &&
          ["cancelled", "failed"].includes(cancelled.status)
        )
          await tx.query(
            "UPDATE desktop_executions SET state='finished',finished_at=now() WHERE task_id=$1",
            [t.id],
          );
        return publicExecution(
          (
            await tx.query(
              "SELECT * FROM desktop_executions WHERE task_id=$1",
              [t.id],
            )
          ).rows[0],
          cancelled,
        );
      }, p.tenant);
      await closeCompanyCalls(p.execution);
      await closeGateway(p.execution);
      return result;
    },
  );

  app.post(
    base + "/:execution/finish",
    { preHandler: requireUser(db) },
    async (req) => {
      const p = executionParams.parse(req.params),
        report = reportBody.parse(req.body);
      key(req);
      // First fence admission durably; then close any in-flight upstream; finally
      // settle only server-observed usage. A retry resumes these same phases.
      await db.tx(async (tx) => {
        const { d, t } = await own(tx, req, false, true);
        if (d.client_report && d.client_report.hash !== hash(canonical(report)))
          throw denied("DESKTOP_RESULT_CONFLICT");
        if (["finished", "reconciling"].includes(d.state)) return;
        if (!["running", "recovering", "stopping"].includes(d.state)) throw denied();
        await tx.query(
          "UPDATE desktop_executions SET state='stopping',client_report=$2 WHERE task_id=$1",
          [
            t.id,
            {
              hash: hash(canonical(report)),
              status: report.status,
              thread_id: report.thread_id,
              turn_id: report.turn_id,
            },
          ],
        );
      }, p.tenant);
      await closeCompanyCalls(p.execution);
      await closeGateway(p.execution);
      return db.tx(async (tx) => {
        const { d, t } = await own(tx, req, false, true);
        if (["finished", "reconciling"].includes(d.state))
          return publicExecution(d, t);
        await tx.query("SELECT set_config('app.task_id',$1,true)", [t.id]);
        const cost = await taskProviderBudgetReceipt(tx, t.id);
        const uncertain =
          cost.uncertain ||
          cost.violation ||
          report.status === "unknown" ||
          t.status === "reconciling" ||
          new Date(t.lease_until).getTime() <= Date.now();
        const status = uncertain
          ? "reconciling"
          : t.cancel_requested || report.status === "interrupted"
            ? "cancelled"
            : report.status === "completed"
              ? "succeeded"
              : "failed";
        await tx.query(
          "UPDATE tasks SET status=$2,output=$3,runtime_thread=$4,runtime_turn=$5,input_tokens=$6,output_tokens=$7,accrued_micros=$8,lease_until=NULL,version=version+1,updated_at=now() WHERE id=$1",
          [
            t.id,
            status,
            report.output,
            report.thread_id,
            report.turn_id,
            cost.inputTokens,
            cost.outputTokens,
            cost.knownChargeMicros,
          ],
        );
        await settle(
          tx,
          p.tenant,
          t.id,
          cost.knownChargeMicros,
          t.created_by,
          uncertain,
        );
        await tx.query(
          "UPDATE desktop_executions SET state=$2,finished_at=now() WHERE task_id=$1",
          [t.id, uncertain ? "reconciling" : "finished"],
        );
        await event(tx, p.tenant, t.id, "desktop.execution.finished", {
          status,
          result_origin: "desktop_client_report",
          provider_usage: "company_server_receipt",
          charged_micros: String(cost.knownChargeMicros),
          usage_known: !uncertain,
        });
        await audit(
          tx,
          req.principal,
          "desktop.finish",
          t.id,
          "succeeded",
          { status, usage_known: !uncertain },
          p.tenant,
        );
        return publicExecution(
          (
            await tx.query(
              "SELECT * FROM desktop_executions WHERE task_id=$1",
              [t.id],
            )
          ).rows[0],
          (await tx.query("SELECT * FROM tasks WHERE id=$1", [t.id])).rows[0],
        );
      }, p.tenant);
    },
  );

  app.post(
    "/v1/desktop-inference/v1/responses",
    { bodyLimit: db.config.AI_MAX_REQUEST_BYTES },
    async (req, reply) => {
      if (req.headers.origin || req.headers.cookie)
        throw new Problem(
          403,
          "DESKTOP_INFERENCE_ONLY",
          "Use the scoped native inference credential",
        );
      const secret =
        req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1];
      const d = secret
        ? (
            await db.control.query(
              "SELECT * FROM desktop_executions WHERE credential_hash=$1",
              [hash(secret)],
            )
          ).rows[0]
        : null;
      if (!d)
        throw new Problem(
          401,
          "DESKTOP_CREDENTIAL_REQUIRED",
          "A current scoped desktop credential is required",
        );
      const prepared = await db.tx(
        async (tx) => {
          const hint = (
            await tx.query("SELECT * FROM tasks WHERE id=$1", [d.task_id])
          ).rows[0];
          if (hint) await lockNativeWorkflowParent(tx, hint);
          const t = (
            await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [
              d.task_id,
            ])
          ).rows[0];
          const execution = (
            await tx.query(
              "SELECT * FROM desktop_executions WHERE task_id=$1 FOR UPDATE",
              [d.task_id],
            )
          ).rows[0];
          if (!t || !execution || execution.credential_hash !== hash(secret!))
            throw denied();
          assertDesktopStartupAuthority(execution, t, t.fencing_token);
          const { capabilities, actor } = await authorize(tx, execution, t);
          return {
            t,
            execution,
            capabilities,
            companyTools: businessTools(
              t,
              actor,
              undefined,
              !!capabilities.video,
            ).map(({ name, inputSchema }) => ({
              name,
              inputSchema: desktopCompanyToolSchema(inputSchema),
            })),
          };
        },
        d.tenant_id,
        false,
        d.actor_id,
      );
      const gatewayKey = d.task_id + ":" + prepared.t.fencing_token;
      let gateway = gateways.get(gatewayKey);
      if (!gateway) {
        const { t, execution, capabilities, companyTools } = prepared;
        gateway = startScopedInferenceGateway(db.config, {
          model: capabilities.text.body.model_alias!,
          reasoningEffort: capabilities.text.body.reasoning_effort!,
          tools: t.input_context?.geo_sample_id
            ? []
            : [
                ...desktopToolNames,
                ...companyTools.map((tool) => "copypaste." + tool.name),
              ],
          nativeDesktop: !t.input_context?.geo_sample_id,
          nativeCompanyTools: companyTools,
          signal: shutdown.signal,
          authority: {
            taskId: t.id,
            tenantId: t.tenant_id,
            projectId: t.project_id,
            actorId: t.created_by,
            attempt: t.attempt,
            fencingToken: t.fencing_token,
            capabilityVersionId: capabilities.text.id,
            budgeted: true,
            authorize: (request) => inferenceAuthority(execution, t, request),
          },
        });
        gateways.set(gatewayKey, gateway);
        void gateway.catch(() => {
          if (gateways.get(gatewayKey) === gateway) gateways.delete(gatewayKey);
        });
      }
      const live = await gateway,
        disconnected = new AbortController();
      reply.raw.once("close", () => {
        if (!reply.raw.writableFinished) disconnected.abort();
      });
      const response = await fetch(live.baseURL + "/responses", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + live.credential,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
        redirect: "error",
        signal: AbortSignal.any([
          shutdown.signal,
          disconnected.signal,
          AbortSignal.timeout(
            Math.max(
              1,
              new Date(d.credential_expires_at).getTime() - Date.now(),
            ),
          ),
        ]),
      });
      reply
        .code(response.status)
        .type(response.headers.get("content-type") ?? "application/json");
      if (response.headers.has("retry-after"))
        reply.header("Retry-After", response.headers.get("retry-after"));
      return reply.send(
        response.body ? Readable.fromWeb(response.body as any) : "",
      );
    },
  );

  async function recover() {
    const rows = (
      await db.control.query(
        `SELECT d.task_id FROM desktop_executions d JOIN tasks t ON t.id=d.task_id WHERE
       (d.state='prepared' AND (d.created_at<now()-interval '5 minutes' OR t.cancel_requested OR t.status IN ('cancelled','failed','reconciling')))
       OR (d.state IN ('running','recovering','stopping') AND (t.status='reconciling' OR t.lease_until<=now() OR coalesce(d.credential_expires_at,d.startup_deadline_at)<=now())) LIMIT 100`,
      )
    ).rows;
    for (const row of rows) {
      await closeCompanyCalls(row.task_id);
      await closeGateway(row.task_id);
      await db.tx(
        async (tx) => {
          const hint = (
            await tx.query("SELECT * FROM tasks WHERE id=$1", [row.task_id])
          ).rows[0];
          if (hint) await lockNativeWorkflowParent(tx, hint);
          const t = (
            await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [
              row.task_id,
            ])
          ).rows[0];
          const d = (
            await tx.query(
              "SELECT * FROM desktop_executions WHERE task_id=$1 FOR UPDATE",
              [row.task_id],
            )
          ).rows[0];
          if (!t || !d || ["finished", "reconciling"].includes(d.state)) return;
          const unclaimed = d.state === "prepared" && t.attempt === 0;
          if (
            !unclaimed &&
            t.status !== "reconciling" &&
            new Date(t.lease_until).getTime() > Date.now() &&
            new Date(d.credential_expires_at).getTime() > Date.now()
          )
            return;
          const cost = await taskProviderBudgetReceipt(tx, t.id),
            uncertain = !unclaimed || cost.uncertain || cost.violation;
          await tx.query(
            "UPDATE tasks SET status=$2,error_code=$3,lease_until=NULL,accrued_micros=$4,version=version+1 WHERE id=$1",
            [
              t.id,
              uncertain ? "reconciling" : "cancelled",
              uncertain ? "DESKTOP_OWNER_LOST" : "DESKTOP_START_EXPIRED",
              cost.knownChargeMicros,
            ],
          );
          await settle(
            tx,
            t.tenant_id,
            t.id,
            cost.knownChargeMicros,
            t.created_by,
            uncertain,
          );
          await tx.query(
            "UPDATE desktop_executions SET state=$2,finished_at=now() WHERE task_id=$1",
            [t.id, uncertain ? "reconciling" : "finished"],
          );
          await event(tx, t.tenant_id, t.id, "desktop.execution.owner_lost", {
            usage_known: !uncertain,
            automatically_replayed: false,
          });
        },
        undefined,
        true,
      );
    }
    return rows.length;
  }
  let maintenanceRun: Promise<unknown> | undefined;
  const maintenance = db.config.WORKER_ENABLED
    ? setInterval(() => {
        if (maintenanceRun || shutdown.signal.aborted) return;
        maintenanceRun = recover()
          .catch((error) =>
            app.log.error({ err: error }, "Desktop execution recovery failed"),
          )
          .finally(() => {
            maintenanceRun = undefined;
          });
      }, 5000)
    : undefined;
  maintenance?.unref();
  return {
    recover,
    async close() {
      if (maintenance) clearInterval(maintenance);
      shutdown.abort();
      await maintenanceRun;
      await closeCompanyCalls();
      await Promise.allSettled([...gateways.keys()].map(closeGateway));
    },
  };
}
