import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";
import contract from "../contracts/task-schemas.json" with { type: "json" };
import businessInputs from "../contracts/business-inputs-v1.schema.json" with { type: "json" };
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { audit, requireUser, type Principal } from "./auth.js";
import { key, projectAccess, replay, tenantAccess } from "./access.js";
import { canonical, equal, hmac, Problem, uuid } from "./lib.js";
import { enqueueTask } from "./task-service.js";
import { inputAnswer } from "./task-input-contracts.js";
import {
  activeTaskStates,
  freezeWorkContext,
  getAgentVersion,
  ownConversation,
} from "./persistent-work.js";
import {
  inputDependencies,
  resolveInputSelections,
} from "./task-dependencies.js";
import { assertReportSources } from "./analysis-reports.js";
import { assertTaskContentSources } from "./task-content-sources.js";
import {
  controlUnclaimedTask,
  requestTaskCancellation,
} from "./task-control.js";

// Validate the original schemas, including conditional inputs and exact Money.
// No coercion, removed fields, defaults or supplementary weaker request schema.
const ajv = new Ajv2020({ allErrors: true, strict: false });
const addFormats = createRequire(import.meta.url)("ajv-formats") as (
  a: Ajv2020,
) => void;
addFormats(ajv);
const definitions = JSON.parse(
  JSON.stringify({ ...contract.schemas, ...businessInputs.schemas }).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function validate(schema: string, value: unknown) {
  schema = schema === "TaskCreate" ? "TaskCreateWithBusinessInputs" : schema === "TaskInput" ? "TaskInputWithBusinessAnswers" : schema;
  let check = validators.get(schema);
  if (!check) {
    check = ajv.compile({ $defs: definitions, $ref: "#/$defs/" + schema });
    validators.set(schema, check);
  }
  if (!check(value))
    throw new Problem(
      400,
      "VALIDATION_ERROR",
      "Please check the task request",
      check.errors?.map((error) => ({
        path: error.instancePath,
        message: error.message,
      })),
    );
}

const tenantOf = (req: FastifyRequest) =>
  uuid.parse(req.headers["x-tenant-id"]);
const taskOf = (req: FastifyRequest) => uuid.parse((req.params as any).task_id);

async function authorizedTask(
  tx: Tx,
  p: Principal,
  tenant: string,
  id: string,
  action: "read" | "write" = "read",
  lock = false,
) {
  await tenantAccess(tx, p, tenant);
  const t = (
    await tx.query(
      "SELECT * FROM tasks WHERE tenant_id=$1 AND id=$2" +
        (lock ? " FOR UPDATE" : ""),
      [tenant, id],
    )
  ).rows[0];
  if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
  await projectAccess(tx, p, tenant, t.project_id, action);
  return t;
}

function identity(t: any) {
  const result = uuid.safeParse(t.input_context?.agent_id);
  if (!result.success)
    throw new Problem(
      409,
      "LEGACY_TASK_CONTEXT_REQUIRED",
      "This historical task has no retained specialist identity; use its original project interface",
    );
  return result.data;
}

/** Only normative public fields. Neither a worker row nor an old replay body is
 * a Task DTO. Recheck content sources every time, including idempotent reads.
 */
export async function canonicalTask(tx: Tx, t: any) {
  const agent = identity(t);
  let sourceError: string | undefined;
  try {
    await assertReportSources(tx, t, false);
    await assertTaskContentSources(tx, t);
  } catch (error) {
    if (
      !(error instanceof Problem) ||
      ![
        "TASK_SOURCE_REVOKED",
        "TASK_SOURCE_BUSY",
        "ANALYSIS_SOURCE_REVOKED",
        "ANALYSIS_SOURCE_CHANGING",
        "SEO_SOURCE_REVOKED",
        "SEO_CHANGE_SOURCE_REVOKED",
        "SEO_CHANGE_SOURCE_CHANGING",
      ].includes(error.code)
    )
      throw error;
    sourceError = error.code;
  }
  const reservation = (
    await tx.query("SELECT status FROM reservations WHERE task_id=$1", [t.id])
  ).rows[0];
  const uncertain =
    t.status === "reconciling" || reservation?.status === "reconciling";
  const terminal = ["succeeded", "failed", "cancelled"].includes(t.status);
  const status =
    t.cancel_requested && !terminal
      ? "cancelling"
      : t.status === "awaiting_approval"
        ? "waiting_approval"
        : t.status === "reconciling"
          ? "paused"
          : t.status;
  const attempt = t.fencing_token ?? t.initial_attempt_id;
  const artifacts = sourceError
    ? []
    : (
        await tx.query(
          `SELECT DISTINCT a.id FROM assets a JOIN asset_versions v ON v.asset_id=a.id
     WHERE a.tenant_id=$1 AND a.project_id=$2 AND a.state='active' AND v.version=a.current_version
     AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
     AND v.metadata->>'task_id'=$3 ORDER BY a.id`,
          [t.tenant_id, t.project_id, t.id],
        )
      ).rows.map((a) => a.id);
  const pending = sourceError
    ? []
    : (
        await tx.query(
          "SELECT step_key FROM task_dependencies WHERE task_id=$1 AND state='pending' ORDER BY step_key",
          [t.id],
        )
      ).rows.map((d) => d.step_key);
  const charged = BigInt(t.charged_micros ?? 0),
    accrued = BigInt(t.accrued_micros ?? 0);
  const lastSeq = Number(t.last_event_seq);
  if (!Number.isSafeInteger(lastSeq) || lastSeq < 0)
    throw new Problem(
      503,
      "TASK_REPRESENTATION_UNAVAILABLE",
      "Task event sequence exceeds the supported public integer range",
    );
  const result = {
    id: t.id,
    tenant_id: t.tenant_id,
    project_id: t.project_id,
    agent_id: agent,
    attempt_id: attempt,
    type: t.input_context?.canonical_request?.type ?? "delegation",
    status,
    version: t.version,
    last_seq: lastSeq,
    created_at: new Date(t.created_at).toISOString(),
    review_state: sourceError ? "pending_review" : (await tx.query("SELECT business_review_state($1) AS state", [t.id])).rows[0].state,
    artifact_ids: artifacts,
    confirmed_cost: {
      currency: "HKD",
      amount_micros: String(charged > accrued ? charged : accrued),
    },
    cost_state: uncertain
      ? "reconciling"
      : ["settled", "released"].includes(reservation?.status)
        ? "confirmed"
        : "estimated",
    ...(!sourceError
      ? {
          input: t.input_context?.canonical_request?.input ?? {
            prompt: t.prompt,
          },
        }
      : {}),
    steps: [
      {
        key: "execution",
        attempt_id: attempt,
        artifact_ids: artifacts,
        state:
          sourceError || uncertain
            ? "unknown"
            : t.status === "succeeded"
              ? "completed"
              : t.status === "failed"
                ? "failed"
                : t.status === "cancelled"
                  ? "cancelled"
                  : t.status === "running"
                    ? "running"
                    : ["needs_input", "paused", "awaiting_approval"].includes(
                          t.status,
                        )
                      ? "waiting"
                      : "pending",
        ...(sourceError || uncertain || t.error_code
          ? {
              error_code:
                sourceError ?? (uncertain ? "RESULT_UNKNOWN" : t.error_code),
            }
          : {}),
      },
    ],
    pending_input_fields: pending,
    ...(t.conversation_id ? { conversation_id: t.conversation_id } : {}),
    ...(t.parent_id ? { parent_task_id: t.parent_id } : {}),
    mode: t.mode,
    execution_class: t.execution_class,
    capacity_wait_reason: t.capacity_wait_reason ?? null,
  };
  // Do not return a partially shaped object if historical data is incompatible.
  try {
    validate("Task", result);
  } catch {
    throw new Problem(
      503,
      "TASK_REPRESENTATION_UNAVAILABLE",
      "This task cannot currently be represented by the public contract",
    );
  }
  return result;
}

const cursorShape = z
  .object({
    v: z.literal(1),
    tenant: uuid,
    actor: uuid,
    project: uuid.nullable(),
    created_at: z.string().datetime({ precision: 6 }),
    id: uuid,
  })
  .strict();
function readCursor(db: Database, value: string | undefined, scope: object) {
  if (!value) return null;
  try {
    const [encoded, signature, extra] = value.split(".");
    if (
      extra !== undefined ||
      !encoded ||
      !signature ||
      !equal(hmac(db.config.MASTER_KEY!, "task-list-v1:" + encoded), signature)
    )
      throw new Error();
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new Error();
    const data = cursorShape.parse(JSON.parse(bytes.toString("utf8")));
    if (
      canonical({
        tenant: data.tenant,
        actor: data.actor,
        project: data.project,
      }) !== canonical(scope)
    )
      throw new Error();
    return data;
  } catch {
    throw new Problem(
      400,
      "CURSOR_INVALID",
      "Use the cursor returned for this account, workspace and filter",
    );
  }
}
function writeCursor(db: Database, value: z.infer<typeof cursorShape>) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return encoded + "." + hmac(db.config.MASTER_KEY!, "task-list-v1:" + encoded);
}

export function registerCanonicalTasks(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  app.get("/v1/tasks", { preHandler: requireUser(db) }, async (req) => {
    const tenant = tenantOf(req);
    const q = z
      .object({
        project_id: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).max(1500).optional(),
      })
      .strict()
      .parse(req.query);
    const scope = {
      tenant,
      actor: req.principal.id,
      project: q.project_id ?? null,
    };
    const after = readCursor(db, q.cursor, scope);
    return db.tx(async (tx) => {
      const member = await tenantAccess(tx, req.principal, tenant);
      if (q.project_id)
        await projectAccess(tx, req.principal, tenant, q.project_id);
      const rows = (
        await tx.query(
          `SELECT t.*,to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         FROM tasks t JOIN projects p ON p.id=t.project_id AND p.tenant_id=t.tenant_id
         WHERE t.tenant_id=$1 AND NOT p.archived AND ($2::uuid IS NULL OR t.project_id=$2)
         AND ($3::boolean OR EXISTS(SELECT 1 FROM project_members m WHERE m.tenant_id=$1 AND m.project_id=t.project_id AND m.user_id=$4))
         AND t.input_context ? 'agent_id'
         AND ($5::timestamptz IS NULL OR (t.created_at,t.id)<($5::timestamptz,$6::uuid))
         ORDER BY t.created_at DESC,t.id DESC LIMIT $7`,
          [
            tenant,
            q.project_id ?? null,
            ["owner", "admin"].includes(member.role),
            req.principal.id,
            after?.created_at ?? null,
            after?.id ?? null,
            q.limit + 1,
          ],
        )
      ).rows;
      const page = rows.slice(0, q.limit),
        items = [];
      for (const t of page) {
        await projectAccess(tx, req.principal, tenant, t.project_id);
        items.push(await canonicalTask(tx, t));
      }
      const last = page.at(-1);
      return {
        items,
        next_cursor:
          rows.length > q.limit && last
            ? writeCursor(db, {
                v: 1,
                ...scope,
                created_at: last.cursor_created_at,
                id: last.id,
              })
            : null,
      };
    }, tenant);
  });

  app.get(
    "/v1/tasks/:task_id",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = taskOf(req);
      return db.tx(
        async (tx) =>
          canonicalTask(
            tx,
            await authorizedTask(tx, req.principal, tenant, id),
          ),
        tenant,
      );
    },
  );

  app.post("/v1/tasks", { preHandler: requireUser(db) }, async (req, reply) => {
    const tenant = tenantOf(req),
      requestKey = key(req);
    validate("TaskCreate", req.body);
    const b = req.body as any;
    const budget = BigInt(b.budget.amount_micros);
    if (budget <= 0n || budget > 1_000_000_000_000n)
      throw new Problem(
        422,
        "BUDGET_INVALID",
        "Choose a positive task budget up to the configured maximum",
      );
    const unsupported = [
      "device_id",
      "source_artifact_id",
      "source_cell_ids",
      "agent_group_id",
      "workspace_id",
      "confirmed_plan_id",
      "project_config_version_id",
    ].filter((field) => b[field] !== undefined);
    if (b.type !== "delegation" || unsupported.length)
      throw new Problem(
        409,
        "TASK_CONTRACT_CAPABILITY_UNAVAILABLE",
        "This unified creation path currently accepts specialist delegations; use the dedicated business workflow for other task types",
        { fields: unsupported, type: b.type },
      );
    const prompt = z.string().trim().min(1).max(30000).parse(b.input.prompt);
    const versionIds = z
      .array(uuid)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length)
      .parse(b.input.asset_version_ids ?? []);
    const dependencies = inputDependencies.parse([
      ...(b.dependencies ?? []),
      ...(versionIds.length
        ? [
            {
              kind: "file",
              description: "Explicitly selected delegation assets",
              resource_ids: versionIds,
            },
          ]
        : []),
    ]);
    const value = await db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, b.project_id, "write");
      const accepted = await replay(
        tx,
        req.principal.id,
        `canonical.task.create:${tenant}`,
        requestKey,
        b,
        async () => {
          let conversation;
          if (b.conversation_id) {
            conversation = await ownConversation(
              tx,
              req.principal,
              b.project_id,
              b.conversation_id,
              true,
            );
            if (conversation.archived)
              throw new Problem(
                409,
                "CONVERSATION_ARCHIVED",
                "Unarchive the conversation before delegating",
              );
            if (conversation.agent_id !== b.agent_id)
              throw new Problem(
                409,
                "CONVERSATION_AGENT_MISMATCH",
                "Use the conversation's specialist",
              );
            if (
              (
                await tx.query(
                  "SELECT 1 FROM tasks WHERE conversation_id=$1 AND status=ANY($2::text[]) LIMIT 1",
                  [conversation.id, activeTaskStates],
                )
              ).rowCount
            )
              throw new Problem(
                409,
                "CONVERSATION_BUSY",
                "Finish or reconcile the current work before another delegation",
              );
          }
          const agent = await getAgentVersion(
            tx,
            b.project_id,
            b.agent_id,
            conversation?.agent_version,
            true,
          );
          const context = {
            ...(await freezeWorkContext(
              tx,
              req.principal,
              tenant,
              b.project_id,
              agent,
              conversation,
              catalog,
            )),
            canonical_request: { type: "delegation", input: b.input },
          };
          const t = await enqueueTask(
            tx,
            db,
            catalog,
            req.principal,
            tenant,
            b.project_id,
            {
              title:
                conversation?.name ?? prompt.replace(/\s+/g, " ").slice(0, 160),
              prompt,
              role_key: agent.role_key,
              budget_micros: Number(budget),
              mode: b.mode ?? "execute",
              dependencies,
            },
            `canonical:${b.project_id}:${requestKey}`,
            { context, conversation },
          );
          if (conversation) {
            await tx.query(
              "INSERT INTO conversation_messages(tenant_id,project_id,conversation_id,client_message_id,role,intent,body,task_id) VALUES($1,$2,$3,$4,'user','delegate',$5,$6)",
              [
                tenant,
                b.project_id,
                conversation.id,
                randomUUID(),
                prompt,
                t.id,
              ],
            );
            await tx.query(
              "UPDATE conversations SET version=version+1,updated_at=now() WHERE id=$1",
              [conversation.id],
            );
          }
          return {
            task_id: t.id,
            status: t.status,
            version: t.version,
            location: `/v1/tasks/${t.id}`,
          };
        },
      );
      // Replays retain a minimal acceptance receipt and recheck current visibility.
      await authorizedTask(
        tx,
        req.principal,
        tenant,
        accepted.task_id,
        "write",
      );
      return accepted;
    }, tenant);
    return reply.code(202).header("Location", value.location).send(value);
  });

  app.post(
    "/v1/tasks/:task_id/controls",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = taskOf(req),
        requestKey = key(req);
      validate("TaskControl", req.body);
      const b = req.body as any;
      if (b.reason?.length > 2000)
        throw new Problem(
          422,
          "REASON_TOO_LONG",
          "Use a reason up to 2000 characters",
        );
      const value = await db.tx(async (tx) => {
        const t = await authorizedTask(
          tx,
          req.principal,
          tenant,
          id,
          "write",
          true,
        );
        identity(t);
        await replay(
          tx,
          req.principal.id,
          "canonical.task.control",
          requestKey,
          { tenant, task_id: id, ...b },
          async () => {
            if (t.version !== b.expected_version)
              throw new Problem(
                409,
                "VERSION_CONFLICT",
                "Task changed; refresh first",
              );
            if (b.action === "retry")
              throw new Problem(
                409,
                "TASK_RETRY_CHECKPOINT_UNAVAILABLE",
                "Retry requires a separately authorized recoverable checkpoint; uncertain work is never replayed",
              );
            if (b.action === "cancel") await requestTaskCancellation(tx, t);
            else {
              await assertTaskContentSources(tx, t);
              await controlUnclaimedTask(tx, db, catalog, t, b.action);
            }
            await audit(
              tx,
              req.principal,
              `task.${b.action}`,
              id,
              "succeeded",
              { api: "canonical", ...(b.reason ? { reason: b.reason } : {}) },
              tenant,
            );
            return { task_id: id };
          },
        );
        return canonicalTask(
          tx,
          await authorizedTask(tx, req.principal, tenant, id, "write"),
        );
      }, tenant);
      return reply.code(202).send(value);
    },
  );

  app.post(
    "/v1/tasks/:task_id/inputs",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = taskOf(req),
        requestKey = key(req);
      validate("TaskInput", req.body);
      const b = req.body as any;
      const answers = z
        .record(
          z.string().min(1),
          inputAnswer,
        )
        .parse(b.answers);
      if (Object.keys(answers).length > 32)
        throw new Problem(
          422,
          "INPUT_SELECTION_LIMIT",
          "Choose up to 32 pending input requests",
        );
      const value = await db.tx(async (tx) => {
        const t = await authorizedTask(
          tx,
          req.principal,
          tenant,
          id,
          "write",
          true,
        );
        identity(t);
        await replay(
          tx,
          req.principal.id,
          "canonical.task.inputs",
          requestKey,
          { tenant, task_id: id, ...b },
          async () => {
            if (t.version !== b.expected_version)
              throw new Problem(
                409,
                "VERSION_CONFLICT",
                "Task changed; refresh first",
              );
            const deps = (
              await tx.query(
                "SELECT * FROM task_dependencies WHERE task_id=$1 ORDER BY id FOR UPDATE",
                [id],
              )
            ).rows;
            const selections = Object.entries(answers).map(
              ([field, answer]) => {
                const d = deps.find(
                  (d) => d.step_key === field && d.state === "pending",
                );
                if (!d)
                  throw new Problem(
                    409,
                    "INPUT_FIELD_UNAVAILABLE",
                    "Answer a current pending input field",
                  );
                return {
                  id: d.id,
                  expected_version: d.version,
                  ...answer,
                };
              },
            );
            if (b.asset_version_ids !== undefined) {
              const attachments = deps
                .filter((d) => d.kind === "file" && answers[d.step_key])
                .flatMap((d) => { const answer = answers[d.step_key]!; return "resource_ids" in answer ? answer.resource_ids : []; });
              if (
                canonical([...new Set(attachments)].sort()) !==
                canonical([...b.asset_version_ids].sort())
              )
                throw new Problem(
                  422,
                  "INPUT_ATTACHMENT_MISMATCH",
                  "Asset versions must match the file resources explicitly selected in answers",
                );
            }
            await resolveInputSelections(tx, t, selections);
            await audit(
              tx,
              req.principal,
              "task.inputs",
              id,
              "succeeded",
              { fields: Object.keys(answers) },
              tenant,
            );
            return { task_id: id };
          },
        );
        return canonicalTask(
          tx,
          await authorizedTask(tx, req.principal, tenant, id, "write"),
        );
      }, tenant);
      return reply.code(202).send(value);
    },
  );
}
