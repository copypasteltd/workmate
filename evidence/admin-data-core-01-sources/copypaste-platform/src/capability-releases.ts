import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Principal } from "./auth.js";
import { audit, requireAdmin, requireUser } from "./auth.js";
import { key, replay, projectAccess, tenantAccess } from "./access.js";
import { canonical, hash, hmac, equal, Problem, uuid } from "./lib.js";
import { gatewayFingerprint } from "./capability-bindings.js";
import {
  admitProviderRequest,
  providerRequestPermit,
} from "./provider-request-control.js";
import { activeRuntimeProfile } from "./runtime-profiles.js";
import { validationProviderBudgetReceipt } from "./provider-budgets.js";
import { prepareCapabilityVideoSuite, capabilityVideoDTO } from "./capability-video-verification.js";
import { globalPlanAuthority } from "./admin-plans.js";
import {
  currentAdminControl,
  pinAdminPolicy,
} from "./admin-operation-policy.js";
import { adminOperationDTO } from "./admin-memberships.js";
import { createApprovalRequest } from "./admin-approval-storage.js";
import { readScope, pageBounds, pageCursor } from "./admin-directory.js";
import {
  capabilityDocument,
  capabilityBody,
  codexBinaryHash,
  verifyCapability,
} from "./capability-verification.js";
import {
  queueCapabilityWorkspacePurge,
  capabilityWorkspacePurgeDTO,
} from "./capability-workspace-cleanup.js";

const reason = z.string().trim().min(3).max(1000),
  command = z
    .object({ expected_version: z.number().int().positive(), reason })
    .strict();
const draftSchema = z.object({ document: capabilityDocument, reason }).strict();
const page = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const mode = (db: Database) =>
  db.config.DEMO_MODE ? "simulated" : "configured_services";
const actionPermission = (action: string) =>
  action === "catalog.rollback"
    ? "admin.catalog.rollback"
    : "admin.catalog.publish";
export const isCapabilityOperation = (op: any) =>
  op?.payload?.capability_command_version === 1 &&
  ["catalog.draft", "catalog.publish", "catalog.rollback"].includes(op.action);
export async function capabilityAuthority(
  tx: Tx,
  p: Principal,
  permission: string,
) {
  await globalPlanAuthority(tx, p, permission);
}
function frozen(op: any) {
  if (
    !isCapabilityOperation(op) ||
    op.target_ids.length !== 1 ||
    op.target_ids[0] !== op.payload.target_id ||
    hash(
      canonical({
        action: op.action,
        target_id: op.payload.target_id,
        command: op.payload.command,
      }),
    ) !== op.payload_hash
  )
    throw new Problem(
      409,
      "PAYLOAD_CHANGED",
      "The capability command no longer matches its reviewed snapshot",
    );
}
export async function capabilityOperationAuthority(
  tx: Tx,
  p: Principal,
  op: any,
  permission: string,
) {
  frozen(op);
  await capabilityAuthority(tx, p, permission);
}
async function policy(tx: Tx) {
  const source = await currentAdminControl(tx);
  return {
    id: await pinAdminPolicy(tx, {
      kind: "capability_release",
      source_id: source?.id ?? null,
      source_version: source?.version ?? null,
      independent_approval: true,
      window_minutes: 5,
    }),
    minutes: 5,
  };
}
const releaseSelect = `SELECT r.*,v.id AS validation_id,v.state AS validation_state,v.result AS validation_result,v.expires_at AS validation_expires_at,v.expires_at>now() AS validation_current,
 h.publication_id AS current_publication_id,h.revision AS head_revision,
 EXISTS(SELECT 1 FROM capability_publications p WHERE p.release_id=r.id) AS was_published
 FROM capability_releases r LEFT JOIN LATERAL(SELECT * FROM capability_validations WHERE release_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1) v ON true
 LEFT JOIN capability_heads h ON h.profile_key=r.profile_key AND h.data_mode=r.data_mode
 LEFT JOIN capability_publications current_p ON current_p.id=h.publication_id`;
function releaseDTO(row: any) {
  return {
    id: row.id,
    kind: "model_capability",
    profile_key: row.profile_key,
    data_mode: row.data_mode,
    version: row.version,
    document: row.definition,
    definition_hash: row.definition_hash,
    runtime_profile_id: row.runtime_profile_id,
    created_at: new Date(row.created_at).toISOString(),
    state:
      row.current_release_id === row.id
        ? "published"
        : row.was_published
          ? "superseded"
          : row.validation_state === "passed" && row.validation_current
            ? "validated"
            : row.validation_state === "failed"
              ? "rejected"
              : "draft",
    validation_id: row.validation_id ?? null,
    validation_state: row.validation_state ?? null,
    validation_expires_at: row.validation_expires_at
      ? new Date(row.validation_expires_at).toISOString()
      : null,
    validation_error_codes: row.validation_result?.error_code
      ? [row.validation_result.error_code]
      : [],
    head_revision: row.head_revision ?? 0,
    current_publication_id: row.current_publication_id ?? null,
  };
}
async function release(tx: Tx, db: Database, id: string) {
  const row = (
    await tx.query(
      releaseSelect.replace(
        "SELECT r.*,",
        "SELECT r.*,current_p.release_id AS current_release_id,",
      ) + " WHERE r.id=$1 AND r.data_mode=$2",
      [id, mode(db)],
    )
  ).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Capability release not found");
  return row;
}
async function validationDTO(tx: Tx, v: any) {
  const video = await capabilityVideoDTO(tx, v.id);
  const purge = (
    await tx.query(
      "SELECT * FROM capability_workspace_purges WHERE validation_id=$1",
      [v.id],
    )
  ).rows[0];
  return {
    id: v.id,
    release_id: v.release_id,
    state: v.state,
    capability_version_id: v.capability_version_id ?? null,
    created_at: new Date(v.created_at).toISOString(),
    finished_at: v.finished_at ? new Date(v.finished_at).toISOString() : null,
    expires_at: v.expires_at ? new Date(v.expires_at).toISOString() : null,
    result: v.result,
    workspace_cleanup: purge ? capabilityWorkspacePurgeDTO(purge) : null,
    ...(video ? { video_suite: video } : {}),
  };
}
async function expireVerifications(tx: Tx) {
  await tx.query(
    "UPDATE capability_validations v SET state='reconciling',finished_at=now(),result=jsonb_build_object('error_code','VERIFICATION_LEASE_EXPIRED','accepted',true,'usage_known',false) WHERE state='running' AND lease_until<now() AND NOT EXISTS(SELECT 1 FROM capability_video_suites s WHERE s.validation_id=v.id)",
  );
}
async function inspect(
  tx: Tx,
  db: Database,
  catalog: Catalog,
  id: string,
  b: z.infer<typeof command>,
  rollback: boolean,
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "capability-heads:" + mode(db),
  ]);
  const row = await release(tx, db, id);
  if (row.version !== b.expected_version)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "Select the exact capability document version",
    );
  if ((rollback && !row.was_published) || (!rollback && row.was_published))
    throw new Problem(
      409,
      "CAPABILITY_RELEASE_STATE",
      "Use a new draft for publication or a previously published document for rollback",
    );
  if (row.current_release_id === id)
    throw new Problem(
      409,
      "CAPABILITY_ALREADY_CURRENT",
      "This capability document is already current",
    );
  const v = (
    await tx.query(
      "SELECT *,expires_at>now() AS valid FROM capability_validations WHERE release_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
      [id],
    )
  ).rows[0];
  const runtime = await activeRuntimeProfile(tx, catalog);
  if (
    !v ||
    v.state !== "passed" ||
    !v.valid ||
    runtime.id !== row.runtime_profile_id ||
    runtime.pinned_version !== db.config.CODEX_VERSION ||
    row.gateway_fingerprint !== gatewayFingerprint(db.config) ||
    v.result.definition_hash !== row.definition_hash ||
    v.result.gateway_fingerprint !== row.gateway_fingerprint ||
    v.result.data_mode !== mode(db) ||
    v.result.codex_version !== db.config.CODEX_VERSION ||
    v.result.codex_binary_sha256 !== (await codexBinaryHash(db.config))
  )
    throw new Problem(
      409,
      "CAPABILITY_VERIFICATION_REQUIRED",
      "Run current verification of this exact document, gateway and Codex binary before publication",
    );
  await tx.query("SELECT lock_task_capability_versions($1,ARRAY[$2::uuid])", [
    row.runtime_profile_id,
    v.capability_version_id,
  ]);
  const cap = (
    await tx.query("SELECT * FROM internal_capability_versions WHERE id=$1", [
      v.capability_version_id,
    ])
  ).rows[0];
  if (
    !cap ||
    cap.revoked ||
    !cap.ready ||
    cap.fingerprint !==
      hash(
        canonical(
          capabilityBody(db.config, capabilityDocument.parse(row.definition)),
        ),
      )
  )
    throw new Problem(
      409,
      "CAPABILITY_VERSION_UNAVAILABLE",
      "The verified capability is revoked or changed",
    );
  const current = row.current_release_id
    ? await release(tx, db, row.current_release_id)
    : null;
  const before = {
    profile_key: row.profile_key,
    data_mode: row.data_mode,
    head_revision: row.head_revision ?? 0,
    publication_id: row.current_publication_id ?? null,
    current: current
      ? {
          release_id: current.id,
          version: current.version,
          document: current.definition,
        }
      : null,
    proposed: {
      release_id: row.id,
      version: row.version,
      document: row.definition,
      validation_id: v.id,
      capability_version_id: v.capability_version_id,
    },
  };
  return { row, v, before };
}
async function makeOperation(
  tx: Tx,
  p: Principal,
  action: string,
  id: string,
  b: unknown,
  k: string,
  policyId: string,
  payload: any,
  pending: boolean,
) {
  return (
    await tx.query(
      "INSERT INTO admin_operations(principal_id,action,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) VALUES($1,$2,$3,$4,$5,$6,$7,ARRAY[$8::uuid]) RETURNING *",
      [
        p.id,
        action,
        hash(canonical({ action, target_id: id, command: b })),
        {
          capability_command_version: 1,
          target_id: id,
          command: b,
          actor_session_id: p.sessionId,
          actor_auth_version: p.authVersion,
          ...payload,
        },
        hash(`${action}:${id}:${k}`),
        pending ? "pending_approval" : "running",
        policyId,
        id,
      ],
    )
  ).rows[0];
}
async function publish(
  tx: Tx,
  p: Principal,
  op: any,
  checked: Awaited<ReturnType<typeof inspect>>,
  rollback: boolean,
) {
  const { row, v, before } = checked;
  const fact = (
    await tx.query(
      "INSERT INTO capability_publications(profile_key,data_mode,release_id,validation_id,previous_publication_id,operation_id,actor_id,rollback) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [
        row.profile_key,
        row.data_mode,
        row.id,
        v.id,
        before.publication_id,
        op.id,
        p.id,
        rollback,
      ],
    )
  ).rows[0];
  if (before.publication_id)
    await tx.query(
      "UPDATE capability_heads SET publication_id=$3,revision=revision+1 WHERE profile_key=$1 AND data_mode=$2",
      [row.profile_key, row.data_mode, fact.id],
    );
  else
    await tx.query(
      "INSERT INTO capability_heads(profile_key,data_mode,publication_id,revision) VALUES($1,$2,$3,1)",
      [row.profile_key, row.data_mode, fact.id],
    );
  await tx.query(
    "UPDATE admin_operations SET state='succeeded',version=version+1,result=$2,result_ids=$3 WHERE id=$1",
    [
      op.id,
      {
        release_id: row.id,
        publication_id: fact.id,
        capability_version_id: v.capability_version_id,
      },
      [row.id, fact.id],
    ],
  );
  await audit(tx, p, actionPermission(op.action), row.id, "succeeded", {
    reason: op.payload.command.reason,
    operation_id: op.id,
    publication_id: fact.id,
    before,
    rollback,
  });
}
export async function decideCapabilityOperation(
  tx: Tx,
  db: Database,
  catalog: Catalog,
  reviewer: Principal,
  op: any,
  b: { decision: "approve" | "reject"; reason: string },
) {
  frozen(op);
  if (op.action === "catalog.draft")
    throw new Problem(
      409,
      "CAPABILITY_REVIEW_UNAVAILABLE",
      "Only publication and rollback require review",
    );
  await capabilityAuthority(tx, reviewer, actionPermission(op.action));
  if (b.decision === "reject") {
    await tx.query(
      "UPDATE admin_operations SET state='cancelled',approved_by=$2,version=version+1,result=$3 WHERE id=$1",
      [op.id, reviewer.id, { review_reason: b.reason }],
    );
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
  await capabilityAuthority(tx, actor, actionPermission(op.action));
  const rules = await policy(tx);
  if (rules.id !== op.policy_version_id)
    throw new Problem(
      409,
      "POLICY_CHANGED",
      "Create a new capability preview after policy changes",
    );
  const checked = await inspect(
    tx,
    db,
    catalog,
    op.payload.target_id,
    command.parse(op.payload.command),
    op.action === "catalog.rollback",
  );
  if (canonical(checked.before) !== canonical(op.payload.before))
    throw new Problem(
      409,
      "TARGET_CHANGED",
      "The capability head or verification changed while awaiting review",
    );
  await tx.query(
    "UPDATE admin_operations SET state='running',approved_by=$2 WHERE id=$1",
    [op.id, reviewer.id],
  );
  await publish(tx, actor, op, checked, op.action === "catalog.rollback");
}

export function registerCapabilityReleases(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  const auth = { preHandler: requireAdmin(db) },
    root = "/v1/admin/capability-releases";
  app.get(root, auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = page.parse(req.query);
    return db.tx(
      async (tx) => {
        await capabilityAuthority(tx, req.principal, "admin.catalog.read");
        await expireVerifications(tx);
        const s = await readScope(tx, req.principal, "admin.catalog.read"),
          bounds = await pageBounds(
            tx,
            db,
            req.principal,
            s,
            { ...q, data_mode: mode(db) },
            "capability_releases",
          );
        let where = `r.data_mode=${s.arg(mode(db))} AND r.created_at<=${s.arg(bounds.asof)}::timestamptz`;
        if (bounds.after)
          where += ` AND (r.created_at,r.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
        const rows = (
          await tx.query(
            releaseSelect.replace(
              "SELECT r.*,",
              `SELECT r.*,current_p.release_id AS current_release_id,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,`,
            ) +
              ` WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ${s.arg(q.limit + 1)}`,
            s.values,
          )
        ).rows;
        const selected = rows.slice(0, q.limit);
        await audit(
          tx,
          req.principal,
          "admin.catalog.read",
          "capability-releases",
        );
        return {
          items: selected.map(releaseDTO),
          next_cursor:
            rows.length > q.limit
              ? pageCursor(db, bounds, selected.at(-1))
              : null,
        };
      },
      undefined,
      true,
    );
  });
  app.get(root + "/:id", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    z.object({}).strict().parse(req.query);
    return db.tx(
      async (tx) => {
        await capabilityAuthority(tx, req.principal, "admin.catalog.read");
        await expireVerifications(tx);
        const row = await release(tx, db, uuid.parse((req.params as any).id));
        await audit(tx, req.principal, "admin.catalog.read", row.id);
        return releaseDTO(row);
      },
      undefined,
      true,
    );
  });
  app.post(root + "/drafts", auth, async (req, reply) => {
    const b = draftSchema.parse(req.body);
    reply.code(202);
    return db.tx(
      async (tx) => {
        await capabilityAuthority(tx, req.principal, "admin.catalog.draft");
        return replay(
          tx,
          req.principal.id,
          "capability.draft",
          key(req),
          b,
          async () => {
            await tx.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [`capability-document:${mode(db)}:${b.document.profile_key}`],
            );
            const runtime = await activeRuntimeProfile(tx, catalog),
              n = (
                await tx.query(
                  "SELECT coalesce(max(version),0)+1 AS n FROM capability_releases WHERE profile_key=$1 AND data_mode=$2",
                  [b.document.profile_key, mode(db)],
                )
              ).rows[0].n,
              id = randomUUID(),
              rules = await policy(tx),
              op = await makeOperation(
                tx,
                req.principal,
                "catalog.draft",
                id,
                b,
                key(req),
                rules.id,
                {},
                false,
              );
            await tx.query(
              "INSERT INTO capability_releases(id,profile_key,data_mode,version,definition,definition_hash,runtime_profile_id,gateway_fingerprint,created_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
              [
                id,
                b.document.profile_key,
                mode(db),
                n,
                b.document,
                hash(canonical(b.document)),
                runtime.id,
                gatewayFingerprint(db.config),
                req.principal.id,
                b.reason,
              ],
            );
            await tx.query(
              "UPDATE admin_operations SET state='succeeded',version=version+1,result_ids=ARRAY[$2::uuid],result=$3 WHERE id=$1",
              [op.id, id, { release_id: id }],
            );
            await audit(
              tx,
              req.principal,
              "admin.catalog.draft",
              id,
              "succeeded",
              {
                reason: b.reason,
                operation_id: op.id,
                definition_hash: hash(canonical(b.document)),
              },
            );
            return adminOperationDTO(
              (
                await tx.query("SELECT * FROM admin_operations WHERE id=$1", [
                  op.id,
                ])
              ).rows[0],
            );
          },
        );
      },
      undefined,
      true,
    );
  });
  app.post(root + "/:id/validations", auth, async (req, reply) => {
    const id = uuid.parse((req.params as any).id),
      b = command.parse(req.body),
      nonce = randomUUID(),
      k = hash(key(req)),
      payloadHash = hash(canonical(b));
    reply.code(202);
    const prepared = await db.tx(
      async (tx) => {
        await capabilityAuthority(tx, req.principal, "admin.catalog.publish");
        await expireVerifications(tx);
        const row = await release(tx, db, id);
        if (row.version !== b.expected_version)
          throw new Problem(
            409,
            "VERSION_CONFLICT",
            "Reload the exact capability document",
          );
        if (
          row.gateway_fingerprint !== gatewayFingerprint(db.config) ||
          row.runtime_profile_id !==
            (await activeRuntimeProfile(tx, catalog)).id
        )
          throw new Problem(
            409,
            "CAPABILITY_CONTEXT_CHANGED",
            "Create a draft for the current gateway and Codex version",
          );
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `capability-validation:${id}`,
        ]);
        let v = (
          await tx.query(
            "SELECT * FROM capability_validations WHERE principal_id=$1 AND release_id=$2 AND idempotency_hash=$3",
            [req.principal.id, id, k],
          )
        ).rows[0];
        if (v) {
          if (v.payload_hash !== payloadHash)
            throw new Problem(
              409,
              "IDEMPOTENCY_CONFLICT",
              "The verification key already belongs to another command",
            );
          return { row, v };
        }
        if (
          (
            await tx.query(
              "SELECT 1 FROM capability_validations WHERE release_id=$1 AND state='running'",
              [id],
            )
          ).rowCount
        )
          throw new Problem(
            409,
            "CAPABILITY_VERIFICATION_RUNNING",
            "The current verification is still running; inspect its receipt",
          );
        v = (
          await tx.query(
            "INSERT INTO capability_validations(release_id,principal_id,session_id,idempotency_hash,payload_hash,execution_nonce,lease_until) VALUES($1,$2,$3,$4,$5,$6,now()+CASE WHEN $7 THEN interval '2 hours' ELSE interval '4 minutes' END) RETURNING *",
            [
              id,
              req.principal.id,
              req.principal.sessionId,
              k,
              payloadHash,
              nonce,
              row.profile_key === "internal-video-v1",
            ],
          )
        ).rows[0];
        await audit(
          tx,
          req.principal,
          "admin.catalog.publish",
          id,
          "verification_started",
          {
            reason: b.reason,
            validation_id: v.id,
            definition_hash: row.definition_hash,
          },
        );
        await tx.query("SELECT register_validation_ai_budget($1)", [v.id]);
        if (row.profile_key === "internal-video-v1")
          await prepareCapabilityVideoSuite(tx, db, v, row, req.principal);
        return { row, v };
      },
      undefined,
      true,
      req.principal.id,
    );
    if (prepared.v.execution_nonce !== nonce || prepared.row.profile_key === "internal-video-v1")
      return db.tx(
        async (tx) => {
          await capabilityAuthority(tx, req.principal, "admin.catalog.publish");
          return validationDTO(tx, prepared.v);
        },
        undefined,
        true,
      );
    let outcome: Awaited<ReturnType<typeof verifyCapability>>;
    try {
      outcome = await verifyCapability(
        db.config,
        capabilityDocument.parse(prepared.row.definition),
        prepared.v.id,
        AbortSignal.timeout(180000),
        {
          budgeted: true,
          taskId: prepared.v.id,
          actorId: req.principal.id,
          authorize: async (request) => {
            const check = async (tx: Tx, recordEvent = false) => {
              await capabilityAuthority(
                tx,
                req.principal,
                "admin.catalog.publish",
              );
              const current = (
                await tx.query(
                  "SELECT *,lease_until>now() AS lease_current FROM capability_validations WHERE id=$1",
                  [prepared.v.id],
                )
              ).rows[0];
              const currentRelease = await release(tx, db, id);
              const document = capabilityDocument.parse(
                prepared.row.definition,
              );
              if (
                !current ||
                current.state !== "running" ||
                !current.lease_current ||
                current.execution_nonce !== nonce ||
                current.principal_id !== req.principal.id ||
                current.session_id !== req.principal.sessionId ||
                current.release_id !== id ||
                currentRelease.definition_hash !==
                  prepared.row.definition_hash ||
                currentRelease.gateway_fingerprint !==
                  gatewayFingerprint(db.config) ||
                (await activeRuntimeProfile(tx, catalog)).id !==
                  prepared.row.runtime_profile_id ||
                request.taskId !== current.id ||
                request.actorId !== req.principal.id ||
                request.model !== document.model_alias ||
                !(capabilityBody(
                  db.config,
                  document,
                ).supported_operations as readonly string[]).includes(
                  request.operation === "responses.input_tokens"
                    ? "responses"
                    : request.operation,
                )
              )
                throw new Problem(
                  409,
                  "CAPABILITY_CONTEXT_CHANGED",
                  "Verification scope is no longer authorized",
                );
              if (recordEvent)
                await tx.query(
                  "INSERT INTO capability_validation_events(validation_id,body) VALUES($1,$2)",
                  [
                    current.id,
                    {
                      event: "gateway.request_authorized",
                      operation_id: request.requestId,
                      operation: request.operation,
                      model_alias: request.model,
                      request_bytes: request.requestBytes,
                      request_hash: request.requestHash,
                      definition_hash: currentRelease.definition_hash,
                    },
                  ],
                );
            };
            const admitted = await db.tx(
              async (tx) => {
                await check(tx, true);
                return admitProviderRequest(tx, "validation", request);
              },
              undefined,
              true,
              req.principal.id,
            );
            return providerRequestPermit(
              db,
              admitted,
              { actorId: req.principal.id, control: true },
              check,
              request,
            );
          },
        },
      );
    } catch (error) {
      outcome = {
        state: "failed",
        evidence: {
          error_code:
            error instanceof Problem &&
            ["AI_SETUP_REQUIRED", "CODEX_BINARY_PIN_REQUIRED"].includes(
              error.code,
            )
              ? error.code
              : "CAPABILITY_SETUP_REQUIRED",
          accepted: false,
          usage_known: true,
          known_cost_micros: "0",
        },
        body: capabilityBody(
          db.config,
          capabilityDocument.parse(prepared.row.definition),
        ),
      };
    }
    const budgetReceipt = await validationProviderBudgetReceipt(
      db,
      prepared.v.id,
    );
    if (budgetReceipt.requests) {
      outcome.evidence.known_cost_micros = String(
        budgetReceipt.knownChargeMicros,
      );
      outcome.evidence.accepted = budgetReceipt.dispatched > 0;
      outcome.evidence.usage_known = !budgetReceipt.uncertain;
      if (budgetReceipt.uncertain || budgetReceipt.violation) {
        outcome.state = "reconciling";
        if (budgetReceipt.violation)
          outcome.evidence.error_code = "AI_REQUEST_BUDGET_VIOLATION";
      }
    }
    let denied: unknown;
    const result = await db.tx(
      async (tx) => {
        const v = (
          await tx.query(
            "SELECT * FROM capability_validations WHERE id=$1 FOR UPDATE",
            [prepared.v.id],
          )
        ).rows[0];
        try {
          await capabilityAuthority(tx, req.principal, "admin.catalog.publish");
          if (
            prepared.row.gateway_fingerprint !==
              gatewayFingerprint(db.config) ||
            (await activeRuntimeProfile(tx, catalog)).id !==
              prepared.row.runtime_profile_id
          )
            throw new Problem(
              409,
              "CAPABILITY_CONTEXT_CHANGED",
              "The runtime changed during verification",
            );
        } catch (error) {
          denied = error;
        }
        await tx.query(
          "INSERT INTO capability_validation_events(validation_id,body) VALUES($1,$2)",
          [
            v.id,
            {
              state: outcome.state,
              result: outcome.evidence,
              actor_authorized: !denied,
            },
          ],
        );
        await queueCapabilityWorkspacePurge(tx, v.id, outcome.evidence);
        if (v.state !== "running") return validationDTO(tx, v);
        let capId: string | null = null;
        if (outcome.state === "passed" && !denied) {
          const fingerprint = hash(canonical(outcome.body));
          await tx.query(
            "INSERT INTO internal_capability_versions(fingerprint,profile_key,data_mode,body,ready) VALUES($1,$2,$3,$4,true) ON CONFLICT(fingerprint) DO NOTHING",
            [fingerprint, prepared.row.profile_key, mode(db), outcome.body],
          );
          const cap = (
            await tx.query(
              "SELECT * FROM internal_capability_versions WHERE fingerprint=$1",
              [fingerprint],
            )
          ).rows[0];
          if (!cap.revoked) capId = cap.id;
          else {
            outcome.state = "failed";
            outcome.evidence.error_code = "CAPABILITY_VERSION_REVOKED";
          }
        }
        const state = denied ? "cancelled" : outcome.state;
        const saved = (
          await tx.query(
            "UPDATE capability_validations SET state=$2,capability_version_id=$3,result=$4,finished_at=now(),expires_at=CASE WHEN $2='passed' THEN now()+interval '24 hours' ELSE NULL END WHERE id=$1 RETURNING *",
            [v.id, state, capId, outcome.evidence],
          )
        ).rows[0];
        await audit(
          tx,
          req.principal,
          "admin.catalog.publish",
          id,
          "verification_" + state,
          {
            validation_id: v.id,
            known_cost_micros: outcome.evidence.known_cost_micros ?? null,
            error_code: outcome.evidence.error_code ?? null,
          },
        );
        return validationDTO(tx, saved);
      },
      undefined,
      true,
    );
    if (denied) throw denied;
    return result;
  });
  for (const action of ["video-cancellations", "video-rechecks"] as const) {
    app.post(root + "/validations/:validation/" + action, auth, async (req, reply) => {
      const id = uuid.parse((req.params as any).validation), b = command.parse(req.body);
      reply.code(202);
      return db.tx(async tx => {
        await capabilityAuthority(tx, req.principal, "admin.catalog.publish");
        const v = (await tx.query(`SELECT v.* FROM capability_validations v JOIN capability_releases r ON r.id=v.release_id
          JOIN capability_video_suites s ON s.validation_id=v.id WHERE v.id=$1 AND r.data_mode=$2 FOR UPDATE OF v`, [id, mode(db)])).rows[0];
        if (!v) throw new Problem(404, "NOT_FOUND", "Video validation not found");
        const r = await release(tx, db, v.release_id);
        if (r.version !== b.expected_version) throw new Problem(409, "VERSION_CONFLICT", "Reload the exact capability document");
        return replay(tx, req.principal.id, "capability." + action + ":" + id, key(req), b, async () => {
          if (action === "video-cancellations") {
            if (v.state !== "running") throw new Problem(409, "CAPABILITY_VERIFICATION_TERMINAL", "A completed eligibility receipt cannot be cancelled or reopened");
            await tx.query(`UPDATE capability_video_suites SET cancel_requested_at=coalesce(cancel_requested_at,clock_timestamp()),
              next_poll_at=clock_timestamp() WHERE validation_id=$1`, [id]);
          } else {
            // An explicit recheck only wakes the original resource poll; it
            // never creates another probe or reopens immutable eligibility.
            await tx.query("UPDATE capability_video_suites SET next_poll_at=clock_timestamp() WHERE validation_id=$1", [id]);
          }
          await audit(tx, req.principal, "admin.catalog.publish", v.release_id, action,
            { validation_id: id, reason: b.reason });
          return validationDTO(tx, v);
        });
      }, undefined, true, req.principal.id);
    });
  }
  app.get(root + "/validations/:validation", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    z.object({}).strict().parse(req.query);
    return db.tx(
      async (tx) => {
        await capabilityAuthority(tx, req.principal, "admin.catalog.read");
        await expireVerifications(tx);
        const v = (
          await tx.query(
            "SELECT v.* FROM capability_validations v JOIN capability_releases r ON r.id=v.release_id WHERE v.id=$1 AND r.data_mode=$2",
            [uuid.parse((req.params as any).validation), mode(db)],
          )
        ).rows[0];
        if (!v) throw new Problem(404, "NOT_FOUND", "Verification not found");
        await audit(tx, req.principal, "admin.catalog.read", v.id);
        return validationDTO(tx, v);
      },
      undefined,
      true,
    );
  });
  app.post(
    root + "/validations/:validation/workspace-purge-retries",
    auth,
    async (req, reply) => {
      const id = uuid.parse((req.params as any).validation),
        b = command.parse(req.body);
      reply.code(202).header("Cache-Control", "no-store");
      return db.tx(
        async (tx) => {
          await capabilityAuthority(tx, req.principal, "admin.catalog.publish");
          return replay(
            tx,
            req.principal.id,
            "capability.workspace-purge.retry:" + id,
            key(req),
            b,
            async () => {
              const job = (
                await tx.query(
                  "SELECT p.* FROM capability_workspace_purges p JOIN capability_validations v ON v.id=p.validation_id JOIN capability_releases r ON r.id=v.release_id WHERE p.validation_id=$1 AND r.data_mode=$2 FOR UPDATE OF p",
                  [id, mode(db)],
                )
              ).rows[0];
              if (!job)
                throw new Problem(
                  404,
                  "NOT_FOUND",
                  "Workspace reclamation job not found",
                );
              if (job.version !== b.expected_version)
                throw new Problem(
                  409,
                  "VERSION_CONFLICT",
                  "Reload the current reclamation job",
                );
              if (job.state !== "failed")
                throw new Problem(
                  409,
                  "WORKSPACE_PURGE_NOT_RETRYABLE",
                  "Only an exhausted reclamation job can be retried",
                );
              const saved = (
                await tx.query(
                  "UPDATE capability_workspace_purges SET state='queued',version=version+1,attempts=0,next_attempt_at=now(),completed_at=NULL,error_code=NULL WHERE validation_id=$1 RETURNING *",
                  [id],
                )
              ).rows[0];
              await audit(
                tx,
                req.principal,
                "admin.catalog.publish",
                id,
                "workspace_purge_retry",
                {
                  reason: b.reason,
                  previous_version: job.version,
                  previous_attempts: job.attempts,
                },
              );
              return capabilityWorkspacePurgeDTO(saved);
            },
          );
        },
        undefined,
        true,
      );
    },
  );
  for (const rollback of [false, true]) {
    const suffix = rollback ? "rollbacks" : "publications",
      action = rollback ? "catalog.rollback" : "catalog.publish";
    app.post(root + `/:id/${suffix}-previews`, auth, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const id = uuid.parse((req.params as any).id),
        b = command.parse(req.body);
      return db.tx(
        async (tx) => {
          await capabilityAuthority(
            tx,
            req.principal,
            actionPermission(action),
          );
          return replay(
            tx,
            req.principal.id,
            `capability.preview:${action}:${id}`,
            key(req),
            b,
            async () => {
              const checked = await inspect(tx, db, catalog, id, b, rollback),
                rules = await policy(tx),
                payload = {
                  capability_command_version: 1,
                  target_id: id,
                  command: b,
                  before: checked.before,
                  policy_version_id: rules.id,
                  actor_session_id: req.principal.sessionId,
                  actor_auth_version: req.principal.authVersion,
                };
              const preview = (
                await tx.query(
                  "INSERT INTO admin_previews(principal_id,action,payload,payload_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes') RETURNING *",
                  [
                    req.principal.id,
                    action,
                    payload,
                    hash(canonical({ action, target_id: id, command: b })),
                  ],
                )
              ).rows[0];
              await audit(
                tx,
                req.principal,
                actionPermission(action),
                id,
                "preview",
                { preview_id: preview.id, payload_hash: preview.payload_hash },
              );
              return {
                preview_id: preview.id,
                payload_hash: preview.payload_hash,
                before: checked.before,
                expires_at: new Date(preview.expires_at).toISOString(),
                decision: "independent_approval",
                creates_business_effect: false,
              };
            },
          );
        },
        undefined,
        true,
      );
    });
    app.post(root + `/:id/${suffix}`, auth, async (req, reply) => {
      const id = uuid.parse((req.params as any).id),
        b = command.parse(req.body);
      reply.code(202);
      return db.tx(
        async (tx) => {
          await capabilityAuthority(
            tx,
            req.principal,
            actionPermission(action),
          );
          return replay(
            tx,
            req.principal.id,
            `capability.commit:${action}:${id}`,
            key(req),
            b,
            async () => {
              const p = (
                await tx.query(
                  "SELECT *,now()<expires_at AS valid FROM admin_previews WHERE id=$1 AND principal_id=$2 AND action=$3 FOR UPDATE",
                  [
                    uuid.parse(req.headers["x-admin-preview-id"]),
                    req.principal.id,
                    action,
                  ],
                )
              ).rows[0];
              if (
                !p ||
                p.consumed_at ||
                !p.valid ||
                p.payload.target_id !== id ||
                p.payload_hash !==
                  hash(canonical({ action, target_id: id, command: b })) ||
                p.payload.actor_session_id !== req.principal.sessionId ||
                p.payload.actor_auth_version !== req.principal.authVersion
              )
                throw new Problem(
                  409,
                  "PREVIEW_INVALID",
                  "Create a fresh preview of this exact capability change",
                );
              const checked = await inspect(tx, db, catalog, id, b, rollback),
                rules = await policy(tx);
              if (rules.id !== p.payload.policy_version_id)
                throw new Problem(
                  409,
                  "POLICY_CHANGED",
                  "Create a fresh capability preview",
                );
              if (canonical(checked.before) !== canonical(p.payload.before))
                throw new Problem(
                  409,
                  "TARGET_CHANGED",
                  "The current capability or verification changed after preview",
                );
              const op = await makeOperation(
                tx,
                req.principal,
                action,
                id,
                b,
                key(req),
                rules.id,
                {
                  before: checked.before,
                  expires_at: new Date(p.expires_at).toISOString(),
                },
                true,
              );
              await createApprovalRequest(tx, op);
              await tx.query(
                "UPDATE admin_previews SET consumed_at=now() WHERE id=$1",
                [p.id],
              );
              await audit(
                tx,
                req.principal,
                actionPermission(action),
                id,
                "pending_approval",
                { operation_id: op.id, payload_hash: op.payload_hash },
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
  for (const detailed of [false, true])
    app.get(
      detailed ? "/v1/capabilities/details" : "/v1/capabilities",
      { preHandler: requireUser(db) },
      async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        const q = page.extend({ project_id: uuid.optional() }).parse(req.query),
          tenant = uuid.parse(req.headers["x-tenant-id"]);
        return db.tx(async (tx) => {
          await tenantAccess(tx, req.principal, tenant);
          if (q.project_id)
            await projectAccess(
              tx,
              req.principal,
              tenant,
              q.project_id,
              "read",
            );
          const versions = [
              ...(await catalog.currentCapabilities(tx)).values(),
            ].sort((a, b) => a.profile_key.localeCompare(b.profile_key)),
            fingerprint = hash(
              canonical(
                versions.map((v) => [v.id, v.revoked, v.head_revision ?? 0]),
              ),
            );
          let offset = 0;
          if (q.cursor) {
            try {
              const parts = q.cursor.split(".");
              if (parts.length !== 2) throw new Error();
              const [encoded, signature] = parts;
              if (!equal(hmac(db.config.MASTER_KEY!, encoded), signature ?? ""))
                throw new Error();
              const p = JSON.parse(
                Buffer.from(encoded, "base64url").toString(),
              );
              if (
                p.actor !== req.principal.id ||
                p.auth !== req.principal.authVersion ||
                p.tenant !== tenant ||
                p.project !== (q.project_id ?? null) ||
                p.detailed !== detailed ||
                p.limit !== q.limit
              )
                throw new Error();
              if (p.expires < Date.now() || p.fingerprint !== fingerprint)
                throw new Problem(
                  410,
                  "CURSOR_EXPIRED",
                  "Capabilities changed; reload the first page",
                );
              if (
                !Number.isSafeInteger(p.offset) ||
                p.offset < 0 ||
                p.offset > versions.length
              )
                throw new Error();
              offset = p.offset;
            } catch (error) {
              if (error instanceof Problem) throw error;
              throw new Problem(
                400,
                "CURSOR_INVALID",
                "Invalid capability cursor",
              );
            }
          }
          const items = versions.slice(offset, offset + q.limit).map((v) => {
            const b = v.body,
              implemented = ["responses", "images"].includes(b.wire_protocol),
              verified = !!(
                v.publication_id ||
                (b.profile_key === "internal-text-v1"
                  ? db.config.AI_VERIFIED
                  : db.config.AI_IMAGE_VERIFIED)
              );
            const state =
              v.revoked || !implemented
                ? "disabled"
                : b.gateway_fingerprint !== gatewayFingerprint(db.config)
                  ? "degraded"
                  : b.ready && verified
                    ? "verified"
                    : "unverified";
            const dto = {
              id: v.profile_key,
              version: v.id,
              kind:
                b.profile_key === "internal-text-v1"
                  ? "llm"
                  : b.profile_key === "internal-image2-v1"
                    ? "image"
                    : b.profile_key === "internal-video-v1"
                      ? "video"
                      : "audio",
              state,
              supported_operations: b.supported_operations ?? [],
              ...(b.model_alias ? { model_alias: b.model_alias } : {}),
              ...(b.wire_protocol ? { wire_protocol: b.wire_protocol } : {}),
              ...(b.reasoning_effort
                ? { reasoning_effort: b.reasoning_effort }
                : {}),
              limits: b.limits ?? {},
              ...(v.verified_at
                ? { verified_at: new Date(v.verified_at).toISOString() }
                : {}),
            };
            return detailed
              ? {
                  ...dto,
                  data_mode: v.data_mode,
                  rates: b.rates,
                  publication_id: v.publication_id ?? null,
                  release_id: v.release_id ?? null,
                  head_revision: v.head_revision ?? 0,
                }
              : dto;
          });
          let next_cursor: string | null = null;
          if (offset + q.limit < versions.length) {
            const value = Buffer.from(
              canonical({
                actor: req.principal.id,
                auth: req.principal.authVersion,
                tenant,
                project: q.project_id ?? null,
                detailed,
                limit: q.limit,
                offset: offset + q.limit,
                fingerprint,
                expires: Date.now() + 900000,
              }),
            ).toString("base64url");
            next_cursor = value + "." + hmac(db.config.MASTER_KEY!, value);
          }
          return { items, next_cursor };
        }, tenant);
      },
    );
}
