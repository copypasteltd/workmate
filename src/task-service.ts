import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { audit } from "./auth.js";
import type { Catalog } from "./catalog.js";
import { projectAccess } from "./access.js";
import { authorizeTaskPlan } from "./plans.js";
import { reserve } from "./billing.js";
import { Problem } from "./lib.js";
import type { WorkContext } from "./persistent-work.js";
import { freezeTaskSkills } from "./skill-lifecycle.js";
import {
  freezeTaskCapabilities,
  boundTaskAvailability,
} from "./capability-bindings.js";
import {
  stageInputDependencies,
  type InputDependency,
} from "./task-dependencies.js";

export interface TaskInput {
  title: string;
  prompt: string;
  role_key: string;
  budget_micros: number;
  parent_id?: string;
  mode?: "execute" | "ask" | "plan";
  dependencies?: InputDependency[];
}
export async function enqueueTask(
  tx: Tx,
  db: Database,
  catalog: Catalog,
  actor: Principal,
  tenant: string,
  project: string,
  b: TaskInput,
  requestKey: string,
  options: {
    context?: WorkContext;
    conversation?: any;
    billing_account_id?: string;
    content_source_task_id?: string;
    execution_location?: "cloud" | "desktop";
    role_hash?: string;
  } = {},
) {
  if (b.prompt.length > 60000)
    throw new Problem(
      409,
      "CONTEXT_LIMIT",
      "The approved request and plan are too large; revise the plan before execution",
    );
  await projectAccess(tx, actor, tenant, project, "write");
  if ((options.execution_location ?? "cloud") === "cloud" && actor.audience === "native" && actor.sessionId
    && (await tx.query("SELECT 1 FROM refresh_tokens WHERE session_id=$1 AND client_id='desktop'", [actor.sessionId])).rowCount)
    throw new Problem(409, "DESKTOP_LOCAL_EXECUTION_REQUIRED", "Start this work through the local Desktop Agent, or open the Web application for cloud work");
  const dataMode = (
    await tx.query("SELECT data_mode FROM tenants WHERE id=$1", [tenant])
  ).rows[0]?.data_mode;
  if ((dataMode === "simulated") !== db.config.DEMO_MODE)
    throw new Problem(
      409,
      "DATA_MODE_MISMATCH",
      "Simulated workspaces and configured-service workspaces use separate execution modes. Create a workspace in the current mode.",
    );
  let parent: any;
  if (b.parent_id) {
    parent = (
      await tx.query("SELECT * FROM tasks WHERE id=$1 AND project_id=$2", [
        b.parent_id,
        project,
      ])
    ).rows[0];
    if (!parent) throw new Problem(404, "NOT_FOUND", "Original task not found");
    if (parent.execution_location !== (options.execution_location ?? "cloud"))
      throw new Problem(409, "EXECUTION_LOCATION_CHANGED", "Continue the task in its original execution location");
    if (parent.private_owner && parent.private_owner !== actor.id)
      throw new Problem(404, "NOT_FOUND", "Original task not found");
    if (parent.input_context?.seo_change_task_id)
      throw new Problem(
        409,
        "SEO_CHANGE_NEW_TASK_REQUIRED",
        "Save a new change task from the retained audit so evidence and budget remain bound",
      );
    if (
      parent.conversation_id &&
      options.conversation?.id !== parent.conversation_id
    )
      throw new Problem(
        409,
        "CONVERSATION_CONTEXT_REQUIRED",
        "Continue this private task from its original conversation",
      );
  }
  if (parent?.role_key === b.role_key && options.context && options.context.role_hash !== parent.role_hash)
    throw new Problem(409, "ROLE_ADOPTION_NEW_TASK_REQUIRED", "Start a new task to adopt a different role/tool version");
  const role = catalog.role(b.role_key, options.context?.role_hash ?? options.role_hash ?? (parent?.role_key === b.role_key ? parent.role_hash : undefined));
  await catalog.boundSkills(role);
  await catalog.ensureEnabled(tx, b.role_key, catalog.digest(role));
  const ready = parent
    ? (
        await boundTaskAvailability(tx, db.config, catalog, {
          ...parent,
          role_key: b.role_key,
          mode: b.mode ?? "execute",
        })
      ).availability
    : await catalog.availableFor(tx, db.config, role, b.mode);
  if (!ready.available)
    throw new Problem(
      503,
      ready.reason!,
      "此服務正在準備，請聯絡工作區管理員 / This service requires workspace setup",
    );
  if (options.billing_account_id) {
    const payer = (
      await tx.query(
        "SELECT id,user_id,tenant_id,data_mode FROM wallets WHERE id=$1",
        [options.billing_account_id],
      )
    ).rows[0];
    if (
      !payer ||
      (payer.user_id
        ? payer.user_id !== actor.id
        : payer.tenant_id !== tenant) ||
      payer.data_mode !== dataMode
    )
      throw new Problem(
        404,
        "BILLING_ACCOUNT_NOT_FOUND",
        "An authorized billing account in this execution mode is required",
      );
  }
  const plan = await authorizeTaskPlan(
    tx,
    tenant,
    actor.id,
    role,
    b.budget_micros,
    b.mode,
  );
  const task = (
    await tx.query(
      `INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,actor_auth_version,parent_id,mode,conversation_id,private_owner,input_context,plan_snapshot,billing_account_id,execution_location)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        tenant,
        project,
        actor.id,
        b.title,
        b.prompt,
        b.role_key,
        catalog.digest(role),
        b.budget_micros,
        requestKey,
        actor.authVersion,
        b.parent_id ?? null,
        b.mode ?? "execute",
        options.conversation?.id ?? null,
        options.context || options.execution_location === "desktop" ? actor.id : (parent?.private_owner ?? null),
        {
          ...(options.context ?? {}),
          ...(options.content_source_task_id
            ? { plan_source_task_id: options.content_source_task_id }
            : {}),
        },
        plan,
        options.billing_account_id ?? null,
        options.execution_location ?? "cloud",
      ],
    )
  ).rows[0];
  await freezeTaskCapabilities(tx, db.config, catalog, task);
  await freezeTaskSkills(tx, catalog, task);
  const waiting = await stageInputDependencies(
    tx,
    task,
    role,
    b.dependencies,
    b.parent_id,
  );
  await reserve(tx, tenant, task.id, b.budget_micros);
  await tx.query(
    "INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,$3,$4)",
    [
      tenant,
      task.id,
      waiting ? "task.needs_input" : "task.queued",
      { role_key: b.role_key, mode: task.mode },
    ],
  );
  if (!waiting && task.execution_location === "cloud")
    await tx.query(
      "INSERT INTO outbox(tenant_id,topic,payload) VALUES($1,'task.run',$2)",
      [tenant, { task_id: task.id }],
    );
  await audit(
    tx,
    actor,
    "task.create",
    task.id,
    "succeeded",
    { mode: task.mode, conversation_id: task.conversation_id },
    tenant,
  );
  return task;
}
