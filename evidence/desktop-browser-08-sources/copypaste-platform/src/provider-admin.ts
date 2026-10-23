import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import { lockAdminAccess } from "./admin-access.js";
import { readScope, pageBounds, pageCursor } from "./admin-directory.js";
import { adminOperationDTO } from "./admin-memberships.js";
import { createApprovalRequest } from "./admin-approval-storage.js";
import {
  currentAdminControl,
  pinAdminPolicy,
} from "./admin-operation-policy.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { key, replay } from "./access.js";
import { gatewayFingerprint } from "./capability-bindings.js";
import {
  globalProviderAuthority,
  providerAuthority,
  providerVisibility,
  requestRow,
  providerRequestDTO,
  modeOf,
  type ProviderScope,
} from "./provider-admin-access.js";
import {
  providerPage,
  providerPolicyDraft,
  providerCommand,
  providerSubmit,
  providerRequestQuery,
  providerChannel,
  providerEvidenceCreate,
  providerActionPermission,
  type ProviderCommand,
} from "./provider-admin-model.js";
import {
  currentProviderPolicy,
  inspectProviderPolicy,
  applyProviderPolicy,
} from "./provider-admin-policy.js";
import {
  inspectProviderRequestCommand,
  applyProviderRequestCommand,
  inspectProviderTaskSettlement,
  applyProviderTaskSettlement,
  assertProviderEvidenceBinding,
} from "./provider-admin-reconciliation.js";

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const commandHash = (b: unknown) => hash(canonical(b));
export const isProviderAdminOperation = (op: any) =>
  op?.payload?.provider_admin_command_version === 1 &&
  [
    "ai.policy.draft",
    "ai.policy.publish",
    "ai.evidence.write",
    "ai.cost.reconcile",
    "ai.capacity.release",
    "ai.tasks.settle",
  ].includes(op.action);
export const providerOperationReadPermission = (op: any) =>
  op.action.startsWith("ai.policy.")
    ? "admin.ai.policy.read"
    : "admin.ai.cost.read";
function frozen(op: any) {
  if (
    !isProviderAdminOperation(op) ||
    (op.payload.command?.action && op.payload.command.action !== op.action) ||
    commandHash(op.payload.command) !== op.payload_hash
  )
    throw new Problem(
      409,
      "PAYLOAD_CHANGED",
      "Provider operation differs from its frozen command",
    );
  return op.payload.command;
}
export async function providerOperationAuthority(
  tx: Tx,
  p: Principal,
  op: any,
  permission: string,
) {
  frozen(op);
  const s = op.payload.scope as ProviderScope;
  await providerAuthority(
    tx,
    p,
    s,
    permission,
    op.action === "ai.tasks.settle",
  );
  await providerAuthority(
    tx,
    p,
    s,
    providerOperationReadPermission(op),
    op.action === "ai.tasks.settle",
  );
  if (!op.action.startsWith("ai.policy."))
    await providerAuthority(
      tx,
      p,
      s,
      "admin.ai.requests.read",
      op.action === "ai.tasks.settle",
    );
}
async function rules(tx: Tx) {
  const source = await currentAdminControl(tx);
  return pinAdminPolicy(tx, {
    kind: "provider_admin",
    schema_version: 1,
    independent_approval: true,
    window_minutes: 5,
    source_id: source?.id ?? null,
    source_version: source?.version ?? null,
  });
}
async function commandScope(
  tx: Tx,
  db: Database,
  b: ProviderCommand,
): Promise<ProviderScope> {
  if (b.action === "ai.policy.publish")
    return { data_mode: modeOf(db), tenant_id: null, project_id: null };
  if ("request_id" in b) {
    const r = await requestRow(tx, b.channel, b.request_id);
    return {
      data_mode: r.data_mode,
      tenant_id: r.tenant_id,
      project_id: r.project_id,
    };
  }
  const t = (
    await tx.query(
      "SELECT tenant_id,data_mode FROM tasks WHERE id=$1 AND data_mode=current_setting('app.data_mode')",
      [b.task_id],
    )
  ).rows[0];
  if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
  return { data_mode: t.data_mode, tenant_id: t.tenant_id, project_id: null };
}
async function commandAuthority(
  tx: Tx,
  p: Principal,
  scope: ProviderScope,
  b: ProviderCommand,
) {
  await providerAuthority(
    tx,
    p,
    scope,
    providerActionPermission(b.action),
    b.action === "ai.tasks.settle",
  );
  await providerAuthority(
    tx,
    p,
    scope,
    b.action === "ai.policy.publish"
      ? "admin.ai.policy.read"
      : "admin.ai.cost.read",
    b.action === "ai.tasks.settle",
  );
  if (b.action !== "ai.policy.publish")
    await providerAuthority(
      tx,
      p,
      scope,
      "admin.ai.requests.read",
      b.action === "ai.tasks.settle",
    );
}
async function inspect(tx: Tx, db: Database, b: ProviderCommand) {
  if (b.action === "ai.policy.publish")
    return json(await inspectProviderPolicy(tx, db, b));
  if (b.action === "ai.tasks.settle")
    return json(await inspectProviderTaskSettlement(tx, b));
  return json(await inspectProviderRequestCommand(tx, b));
}
async function newOperation(
  tx: Tx,
  p: Principal,
  action: string,
  command: unknown,
  k: string,
  scope: ProviderScope,
  extra: any = {},
  pending = false,
) {
  const b = command as any;
  return (
    await tx.query(
      `INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        p.id,
        action,
        scope.tenant_id,
        commandHash(command),
        {
          provider_admin_command_version: 1,
          data_mode: scope.data_mode,
          scope,
          command,
          actor_session_id: p.sessionId,
          actor_auth_version: p.authVersion,
          ...extra,
        },
        hash(action + ":" + k),
        pending ? "pending_approval" : "running",
        await rules(tx),
        [b.draft_id ?? b.request_id ?? b.task_id].filter(Boolean),
      ],
    )
  ).rows[0];
}
async function finish(tx: Tx, p: Principal, op: any, result: any) {
  const ids = Object.values(result).filter(
    (v): v is string => typeof v === "string" && uuid.safeParse(v).success,
  );
  await tx.query(
    "UPDATE admin_operations SET state='succeeded',version=version+1,result=$2,result_ids=$3,target_ids=CASE WHEN cardinality(target_ids)=0 THEN $3 ELSE target_ids END WHERE id=$1",
    [op.id, result, ids],
  );
  await audit(tx, p, "admin." + op.action, op.id, "succeeded", {
    reason: op.payload.command.reason,
    operation_id: op.id,
    approved_by: op.approved_by ?? null,
  });
  return adminOperationDTO(
    (await tx.query("SELECT * FROM admin_operations WHERE id=$1", [op.id]))
      .rows[0],
  );
}
export async function decideProviderAdminOperation(
  tx: Tx,
  db: Database,
  reviewer: Principal,
  op: any,
  b: { decision: "approve" | "reject"; reason: string },
) {
  if (reviewer.id === op.principal_id)
    throw new Problem(
      403,
      "SELF_APPROVAL_FORBIDDEN",
      "A different authorized administrator must review this operation",
    );
  const command = providerCommand.parse(frozen(op));
  await providerOperationAuthority(
    tx,
    reviewer,
    op,
    providerActionPermission(command.action),
  );
  if (b.decision === "reject") {
    await tx.query(
      "UPDATE admin_operations SET state='cancelled',approved_by=$2,version=version+1,result=$3 WHERE id=$1",
      [op.id, reviewer.id, { review_reason: b.reason }],
    );
    await audit(tx, reviewer, "admin." + op.action, op.id, "cancelled", {
      reason: b.reason,
    });
    return;
  }
  const actor: Principal = {
    id: op.principal_id,
    audience: "admin",
    sessionId: op.payload.actor_session_id,
    authVersion: op.payload.actor_auth_version,
    sessionHash: "",
    email: "",
    name: "",
  };
  await providerOperationAuthority(
    tx,
    actor,
    op,
    providerActionPermission(command.action),
  );
  if ((await rules(tx)) !== op.policy_version_id)
    throw new Problem(
      409,
      "POLICY_CHANGED",
      "Provider approval policy changed; preview again",
    );
  const scope = await commandScope(tx, db, command);
  if (canonical(scope) !== canonical(op.payload.scope))
    throw new Problem(409, "TARGET_CHANGED", "Provider subject scope changed");
  const checked = await inspect(tx, db, command);
  if (canonical(checked) !== canonical(op.payload.before))
    throw new Problem(
      409,
      "TARGET_CHANGED",
      "Provider facts changed while awaiting approval",
    );
  await tx.query(
    "UPDATE admin_operations SET state='running',approved_by=$2 WHERE id=$1",
    [op.id, reviewer.id],
  );
  op.approved_by = reviewer.id;
  const result =
    command.action === "ai.policy.publish"
      ? await applyProviderPolicy(tx, op, checked as any, reviewer.id)
      : command.action === "ai.tasks.settle"
        ? await applyProviderTaskSettlement(tx, op, checked as any, reviewer.id)
        : await applyProviderRequestCommand(
            tx,
            op,
            checked as any,
            reviewer.id,
          );
  await finish(tx, actor, op, result);
}
export function registerProviderAdmin(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireAdmin(db) };
  app.get("/v1/admin/ai/policy", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    z.object({}).strict().parse(req.query);
    return db.tx(
      async (tx) => {
        await globalProviderAuthority(
          tx,
          req.principal,
          "admin.ai.policy.read",
        );
        const r = await currentProviderPolicy(tx, db);
        await audit(tx, req.principal, "admin.ai.policy.read", "current");
        return r;
      },
      undefined,
      true,
    );
  });
  app.get("/v1/admin/ai/policies", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = providerPage.parse(req.query);
    return db.tx(
      async (tx) => {
        await globalProviderAuthority(
          tx,
          req.principal,
          "admin.ai.policy.read",
        );
        const s = await readScope(tx, req.principal, "admin.ai.policy.read"),
          bounds = await pageBounds(
            tx,
            db,
            req.principal,
            s,
            q,
            "provider_policies",
          );
        let where = `d.data_mode=${s.arg(modeOf(db))} AND d.created_at<=${s.arg(bounds.asof)}::timestamptz`;
        if (bounds.after)
          where += ` AND (d.created_at,d.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
        const rows = (
          await tx.query(
            `SELECT d.*,p.id AS publication_id,p.created_at AS published_at,to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM ai_provider_policy_drafts d LEFT JOIN ai_provider_admin_publications p ON p.draft_id=d.id WHERE ${where} ORDER BY d.created_at DESC,d.id DESC LIMIT ${s.arg(q.limit + 1)}`,
            s.values,
          )
        ).rows;
        await audit(tx, req.principal, "admin.ai.policy.read", "history");
        return {
          items: rows.slice(0, q.limit),
          next_cursor:
            rows.length > q.limit
              ? pageCursor(db, bounds, rows[q.limit - 1])
              : null,
        };
      },
      undefined,
      true,
    );
  });
  app.post("/v1/admin/ai/policies/drafts", auth, async (req, reply) => {
    const b = providerPolicyDraft.parse(req.body);
    reply.code(202);
    return db.tx(
      async (tx) => {
        await globalProviderAuthority(
          tx,
          req.principal,
          "admin.ai.policy.draft",
        );
        await globalProviderAuthority(
          tx,
          req.principal,
          "admin.ai.policy.read",
        );
        return replay(
          tx,
          req.principal.id,
          "provider-admin.draft",
          key(req),
          b,
          async () => {
            const mode = modeOf(db);
            await currentProviderPolicy(tx, db);
            const op = await newOperation(
              tx,
              req.principal,
              "ai.policy.draft",
              b,
              key(req),
              { data_mode: mode, tenant_id: null, project_id: null },
            );
            const d = (
              await tx.query(
                `INSERT INTO ai_provider_policy_drafts(data_mode,version,gateway_fingerprint,definition,actor_id,operation_id,reason)
          VALUES($1,(SELECT coalesce(max(version),0)+1 FROM ai_provider_policy_drafts WHERE data_mode=$1),$2,$3,$4,$5,$6) RETURNING id,version`,
                [
                  mode,
                  gatewayFingerprint(db.config),
                  b.definition,
                  req.principal.id,
                  op.id,
                  b.reason,
                ],
              )
            ).rows[0];
            return finish(tx, req.principal, op, {
              draft_id: d.id,
              version: d.version,
            });
          },
        );
      },
      undefined,
      true,
    );
  });
  app.get("/v1/admin/ai/requests", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = providerRequestQuery.parse(req.query);
    if (q.data_mode && q.data_mode !== modeOf(db))
      throw new Problem(404, "NOT_FOUND", "Data mode not found");
    return db.tx(
      async (tx) => {
        const s = await readScope(tx, req.principal, "admin.ai.requests.read"),
          bounds = await pageBounds(
            tx,
            db,
            req.principal,
            s,
            q,
            "provider_requests",
          );
        let where = `r.data_mode=${s.arg(modeOf(db))} AND ${providerVisibility(s, "admin.ai.requests.read")} AND r.created_at<=${s.arg(bounds.asof)}::timestamptz`;
        for (const field of [
          "subject_kind",
          "operation",
          "state",
          "tenant_id",
          "project_id",
          "actor_id",
          "task_id",
          "validation_id",
          "capability_version_id",
          "release_id",
        ] as const)
          if (q[field]) where += ` AND r.${field}=${s.arg(q[field])}`;
        if (q.period_from)
          where += ` AND r.created_at>=${s.arg(q.period_from)}::timestamptz`;
        if (q.period_to)
          where += ` AND r.created_at<${s.arg(q.period_to)}::timestamptz`;
        if (q.cost_state)
          where += ` AND ${providerVisibility(s, "admin.ai.cost.read")} AND r.cost_state=${s.arg(q.cost_state)}`;
        if (q.capacity_state)
          where += ` AND r.capacity_held=${s.arg(q.capacity_state === "held")}::boolean`;
        if (bounds.after)
          where += ` AND (r.created_at,r.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
        const rows = (
          await tx.query(
            `SELECT r.*,${providerVisibility(s, "admin.ai.cost.read")} AS can_read_cost,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM current_ai_provider_requests r WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ${s.arg(q.limit + 1)}`,
            s.values,
          )
        ).rows;
        await audit(
          tx,
          req.principal,
          "admin.ai.requests.read",
          "directory",
          "succeeded",
          {
            count: Math.min(rows.length, q.limit),
            filters_hash: bounds.context.filters,
          },
        );
        return {
          items: rows
            .slice(0, q.limit)
            .map((r) => providerRequestDTO(r, r.can_read_cost)),
          next_cursor:
            rows.length > q.limit
              ? pageCursor(db, bounds, rows[q.limit - 1])
              : null,
        };
      },
      undefined,
      true,
    );
  });
  app.get(
    "/v1/admin/ai/requests/:channel/:request_id",
    auth,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      z.object({}).strict().parse(req.query);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const r = await requestRow(
            tx,
            providerChannel.parse((req.params as any).channel),
            uuid.parse((req.params as any).request_id),
          );
          await providerAuthority(
            tx,
            req.principal,
            r,
            "admin.ai.requests.read",
          );
          const s = await readScope(
            tx,
            req.principal,
            "admin.ai.requests.read",
          );
          s.values = [];
          const cost = (
            await tx.query(
              `SELECT ${providerVisibility(s, "admin.ai.cost.read")} AS allowed FROM current_ai_provider_requests r WHERE channel=${s.arg(r.channel)} AND id=${s.arg(r.id)}`,
              s.values,
            )
          ).rows[0].allowed;
          const evidence = cost
            ? (
                await tx.query(
                  "SELECT id,document_hash,actor_id,reason,created_at FROM ai_provider_evidence WHERE provider_request_id=$1 OR count_request_id=$1 ORDER BY created_at,id",
                  [r.id],
                )
              ).rows
            : undefined;
          await audit(tx, req.principal, "admin.ai.requests.read", r.id);
          return {
            ...providerRequestDTO(r, cost),
            ...(evidence ? { evidence } : {}),
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/ai/requests/:channel/:request_id/evidence",
    auth,
    async (req, reply) => {
      const b = providerEvidenceCreate.parse(req.body),
        channel = providerChannel.parse((req.params as any).channel),
        id = uuid.parse((req.params as any).request_id);
      reply.code(202);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const r = await requestRow(tx, channel, id, true);
          for (const permission of [
            "admin.ai.requests.read",
            "admin.ai.cost.read",
            "admin.ai.evidence.write",
          ])
            await providerAuthority(tx, req.principal, r, permission);
          return replay(
            tx,
            req.principal.id,
            "provider-admin.evidence:" + channel + ":" + id,
            key(req),
            b,
            async () => {
              assertProviderEvidenceBinding(r, b.document);
              const scope = {
                data_mode: r.data_mode,
                tenant_id: r.tenant_id,
                project_id: r.project_id,
              };
              const op = await newOperation(
                tx,
                req.principal,
                "ai.evidence.write",
                b,
                key(req),
                scope,
              );
              const e = (
                await tx.query(
                  `INSERT INTO ai_provider_evidence(provider_request_id,count_request_id,data_mode,canonical_document,document,actor_id,operation_id,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,document_hash`,
                  [
                    channel === "generation" ? id : null,
                    channel === "input_count" ? id : null,
                    r.data_mode,
                    canonical(b.document),
                    b.document,
                    req.principal.id,
                    op.id,
                    b.reason,
                  ],
                )
              ).rows[0];
              return finish(tx, req.principal, op, {
                evidence_id: e.id,
                document_hash: e.document_hash,
                source: "human_submission",
              });
            },
          );
        },
        undefined,
        true,
      );
    },
  );
  app.get("/v1/admin/ai/evidence/:evidence_id", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    z.object({}).strict().parse(req.query);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const e = (
          await tx.query(
            "SELECT * FROM ai_provider_evidence WHERE id=$1 AND data_mode=current_setting('app.data_mode')",
            [uuid.parse((req.params as any).evidence_id)],
          )
        ).rows[0];
        if (!e) throw new Problem(404, "NOT_FOUND", "Evidence not found");
        const r = await requestRow(
          tx,
          e.provider_request_id ? "generation" : "input_count",
          e.provider_request_id ?? e.count_request_id,
        );
        await providerAuthority(tx, req.principal, r, "admin.ai.requests.read");
        await providerAuthority(tx, req.principal, r, "admin.ai.cost.read");
        await audit(
          tx,
          req.principal,
          "admin.ai.cost.read",
          e.id,
          "succeeded",
          { kind: "human_evidence" },
        );
        return {
          id: e.id,
          document: e.document,
          canonical_document: e.canonical_document,
          document_hash: e.document_hash,
          source: "human_submission",
          actor_id: e.actor_id,
          reason: e.reason,
          created_at: e.created_at,
        };
      },
      undefined,
      true,
    );
  });
  app.get(
    "/v1/admin/ai/tasks/:task_id/settlement",
    auth,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      z.object({}).strict().parse(req.query);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const t = (
            await tx.query(
              "SELECT id,tenant_id,data_mode,status,version,charged_micros,budget_micros FROM tasks WHERE id=$1 AND data_mode=current_setting('app.data_mode')",
              [uuid.parse((req.params as any).task_id)],
            )
          ).rows[0];
          if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
          for (const permission of [
            "admin.ai.requests.read",
            "admin.ai.cost.read",
          ])
            await providerAuthority(
              tx,
              req.principal,
              { ...t, project_id: null },
              permission,
              true,
            );
          const violations = (
            await tx.query(
              "SELECT x.id,x.code FROM ai_request_budget_violations x JOIN ai_gateway_requests r ON r.id=x.provider_request_id WHERE r.task_id=$1 ORDER BY x.id",
              [t.id],
            )
          ).rows;
          const reservation =
            (
              await tx.query(
                "SELECT status,amount_micros FROM reservations WHERE task_id=$1",
                [t.id],
              )
            ).rows[0] ?? null;
          await audit(
            tx,
            req.principal,
            "admin.ai.cost.read",
            t.id,
            "succeeded",
            { kind: "task_settlement" },
          );
          return { task: t, reservation, violations };
        },
        undefined,
        true,
      );
    },
  );
  app.post("/v1/admin/ai/previews", auth, async (req, reply) => {
    const b = providerCommand.parse(req.body);
    reply.header("Cache-Control", "no-store");
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const scope = await commandScope(tx, db, b);
        await commandAuthority(tx, req.principal, scope, b);
        return replay(
          tx,
          req.principal.id,
          "provider-admin.preview",
          key(req),
          b,
          async () => {
            const before = await inspect(tx, db, b),
              policy = await rules(tx),
              payload = {
                provider_admin_command_version: 1,
                data_mode: scope.data_mode,
                scope,
                command: b,
                before,
                policy_version_id: policy,
                actor_session_id: req.principal.sessionId,
                actor_auth_version: req.principal.authVersion,
              };
            const p = (
              await tx.query(
                "INSERT INTO admin_previews(principal_id,action,payload,payload_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes') RETURNING *",
                [req.principal.id, b.action, payload, commandHash(b)],
              )
            ).rows[0];
            await audit(
              tx,
              req.principal,
              providerActionPermission(b.action),
              p.id,
              "preview",
              { payload_hash: p.payload_hash },
            );
            return {
              preview_id: p.id,
              payload_hash: p.payload_hash,
              policy_version_id: policy,
              before,
              command: b,
              decision: "independent_approval",
              expires_at: p.expires_at,
              creates_business_effect: false,
            };
          },
        );
      },
      undefined,
      true,
    );
  });
  app.post("/v1/admin/ai/operations", auth, async (req, reply) => {
    const b = providerSubmit.parse(req.body);
    reply.code(202);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const scope = await commandScope(tx, db, b.command);
        await commandAuthority(tx, req.principal, scope, b.command);
        return replay(
          tx,
          req.principal.id,
          "provider-admin.operation",
          key(req),
          b,
          async () => {
            const p = (
              await tx.query(
                "SELECT *,expires_at>now() AS valid FROM admin_previews WHERE id=$1 AND principal_id=$2 FOR UPDATE",
                [b.preview_id, req.principal.id],
              )
            ).rows[0];
            if (
              !p ||
              !p.valid ||
              p.consumed_at ||
              p.action !== b.command.action ||
              p.payload.provider_admin_command_version !== 1 ||
              p.payload_hash !== commandHash(b.command) ||
              p.payload.actor_session_id !== req.principal.sessionId ||
              p.payload.actor_auth_version !== req.principal.authVersion
            )
              throw new Problem(
                409,
                "PREVIEW_INVALID",
                "Create a fresh preview of this exact provider command",
              );
            if (p.payload.policy_version_id !== (await rules(tx)))
              throw new Problem(
                409,
                "POLICY_CHANGED",
                "Create a new preview after approval policy changes",
              );
            const before = await inspect(tx, db, b.command);
            if (
              canonical(before) !== canonical(p.payload.before) ||
              canonical(scope) !== canonical(p.payload.scope)
            )
              throw new Problem(
                409,
                "TARGET_CHANGED",
                "Provider facts changed; preview again",
              );
            const op = await newOperation(
              tx,
              req.principal,
              b.command.action,
              b.command,
              key(req),
              scope,
              { before, expires_at: new Date(p.expires_at).toISOString() },
              true,
            );
            await tx.query(
              "UPDATE admin_previews SET consumed_at=now() WHERE id=$1",
              [p.id],
            );
            await createApprovalRequest(tx, op);
            await audit(
              tx,
              req.principal,
              providerActionPermission(b.command.action),
              op.id,
              "pending_approval",
              {
                reason: b.command.reason,
                policy_version_id: op.policy_version_id,
              },
            );
            return adminOperationDTO(op);
          },
        );
      },
      undefined,
      true,
    );
  });
}
