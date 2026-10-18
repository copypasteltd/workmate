import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { audit } from "./auth.js";
import type { Catalog } from "./catalog.js";
import { projectAccess } from "./access.js";
import { authorizeTaskPlan } from "./plans.js";
import { reserve } from "./billing.js";
import { Problem } from "./lib.js";
import type { WorkContext } from "./persistent-work.js";

export interface TaskInput {
  title: string;
  prompt: string;
  role_key: string;
  budget_micros: number;
  parent_id?: string;
  mode?: "execute" | "ask" | "plan";
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
  options: { context?: WorkContext; conversation?: any } = {},
) {
  if (b.prompt.length > 60000)
    throw new Problem(
      409,
      "CONTEXT_LIMIT",
      "The approved request and plan are too large; revise the plan before execution",
    );
  await projectAccess(tx, actor, tenant, project, "write");
  const role = catalog.role(b.role_key);
  await catalog.boundSkills(role);
  await catalog.ensureEnabled(tx, b.role_key);
  const ready = catalog.available(db.config, role, b.mode);
  if (!ready.available)
    throw new Problem(
      503,
      ready.reason!,
      "此服務正在準備，請聯絡工作區管理員 / This service requires workspace setup",
    );
  if (options.context && options.context.role_hash !== catalog.digest(role))
    throw new Problem(
      409,
      "ROLE_VERSION_CHANGED",
      "Update the specialist to the installed role version",
    );
  let parent: any;
  if (b.parent_id) {
    parent = (
      await tx.query(
        "SELECT private_owner,conversation_id FROM tasks WHERE id=$1 AND project_id=$2",
        [b.parent_id, project],
      )
    ).rows[0];
    if (!parent) throw new Problem(404, "NOT_FOUND", "Original task not found");
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
      `INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,actor_auth_version,parent_id,mode,conversation_id,private_owner,input_context,plan_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
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
        options.context ? actor.id : (parent?.private_owner ?? null),
        options.context ?? {},
        plan,
      ],
    )
  ).rows[0];
  await reserve(tx, tenant, task.id, b.budget_micros);
  await tx.query(
    "INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'task.queued',$3)",
    [tenant, task.id, { role_key: b.role_key, mode: task.mode }],
  );
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
