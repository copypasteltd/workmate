import { randomUUID } from "node:crypto";
import {
  persistBudgetReceipt,
  recoverBudgetReceipts,
} from "./external-budget-receipts.js";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { audit } from "./auth.js";
import { projectAccess, replay } from "./access.js";
import { currentUserAuthority, lockUserAuthorities } from "./user-authority.js";
import { canonical, Problem, seal, unseal } from "./lib.js";
import { connectorAccount, connectorCredential } from "./connector-model.js";
import {
  connectorConfigurationHash,
  refreshConnectorCredential,
} from "./connector-provider.js";
import {
  budgetDecisionInput,
  budgetDigest,
  budgetPolicyInput,
  budgetPrepareInput,
  budgetProposalInput,
  budgetProtocol,
  budgetRequest,
  checkBudgetPolicy,
  googleBudgetSnapshot,
  policyBody,
  budgetCloseInput,
  budgetRevisionInput,
  budgetObserveInput,
} from "./external-budget-model.js";
import {
  BudgetRejected,
  readGoogleBudget,
  writeGoogleBudget,
  type BudgetConnection,
} from "./google-budget-provider.js";
import type { z } from "zod";

export const externalBudgetMode = (db: Database) =>
  db.config.DEMO_MODE ? "simulated" : "configured_services";
const missing = () =>
  new Problem(404, "NOT_FOUND", "Budget operation or scope not found");
const policyLock = (connection: string, project: string, account: string) =>
  `external-budget-policy:${connection}:${project}:${account}`;
async function budgetProjectAccess(
  tx: Tx,
  actor: Principal,
  tenant: string,
  project: string,
  action: "read" | "write" | "manage",
) {
  // Hold source authority rows through the admission commit, including project removal/archive.
  await tx.query(
    "SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE u.id=$1 AND t.id=$2 FOR SHARE OF u,m,t",
    [actor.id, tenant],
  );
  await tx.query(
    "SELECT 1 FROM projects WHERE tenant_id=$1 AND id=$2 FOR SHARE",
    [tenant, project],
  );
  await tx.query(
    "SELECT 1 FROM project_members WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3 FOR SHARE",
    [tenant, project, actor.id],
  );
  return projectAccess(tx, actor, tenant, project, action);
}
export async function budgetLock(
  tx: Tx,
  connection: string,
  project: string,
  account: string,
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    policyLock(connection, project, account),
  ]);
}

export async function budgetConnection(
  db: Database,
  tx: Tx,
  actor: Principal,
  tenant: string,
  project: string,
  connection: string,
  account: string,
  action: "read" | "write" | "manage" = "read",
  admin = false,
) {
  if (!admin) await budgetProjectAccess(tx, actor, tenant, project, action);
  const row = (
    await tx.query(
      `SELECT c.*,p.auth_version,p.version,p.project_ids,p.account_ids,p.configuration_hash,p.data_mode,p.api_version,
    a.body AS account FROM connections c JOIN connector_profiles p ON p.connection_id=c.id
    JOIN connector_accounts a ON a.connection_id=c.id AND a.auth_version=p.auth_version AND a.account_id=$4
    WHERE c.id=$1 AND c.tenant_id=$2 AND $3::uuid=ANY(p.project_ids) AND $4=ANY(p.account_ids) FOR SHARE OF c,p`,
      [connection, tenant, project, account],
    )
  ).rows[0];
  if (
    !row ||
    row.provider !== "google_ads" ||
    row.state !== "connected" ||
    !row.encrypted_secret ||
    row.data_mode !== externalBudgetMode(db) ||
    row.configuration_hash !==
      connectorConfigurationHash(db.config, "google_ads")
  )
    throw missing();
  const details = connectorAccount.parse(row.account);
  if (!details.readable || details.kind !== "advertiser" || !details.currency)
    throw new Problem(
      409,
      "BUDGET_ACCOUNT_UNAVAILABLE",
      "Select an authorized advertiser with a known currency",
    );
  const credential = connectorCredential.parse(
    JSON.parse(unseal(db.config.MASTER_KEY!, row.encrypted_secret)),
  );
  if (!credential.scopes.includes("https://www.googleapis.com/auth/adwords"))
    throw new Problem(
      409,
      "BUDGET_WRITE_SCOPE_REQUIRED",
      "Reconnect Google Ads with the required account authorization",
    );
  return {
    row,
    account: details,
    context: {
      credential,
      account_id: account,
      login_customer_id: details.login_customer_id,
    } satisfies BudgetConnection,
  };
}

export async function currentBudgetPolicy(
  tx: Tx,
  connection: string,
  project: string,
  account: string,
) {
  return (
    await tx.query(
      "SELECT * FROM external_budget_policies WHERE connection_id=$1 AND project_id=$2 AND account_id=$3 ORDER BY version DESC LIMIT 1",
      [connection, project, account],
    )
  ).rows[0];
}
export function budgetPolicyDTO(row: any) {
  return row
    ? {
        id: row.id,
        version: row.version,
        connection_id: row.connection_id,
        project_id: row.project_id,
        account_id: row.account_id,
        policy: policyBody.parse(row.body),
        payload_sha256: row.payload_sha256,
        data_mode: row.data_mode,
        created_at: row.created_at.toISOString(),
      }
    : null;
}
function activePolicy(db: Database, row: any) {
  if (
    !row ||
    row.data_mode !== externalBudgetMode(db) ||
    budgetDigest(row.body) !== row.payload_sha256
  )
    throw new Problem(
      409,
      "BUDGET_POLICY_REQUIRED",
      "A current, explicitly configured project budget policy is required",
    );
  const policy = policyBody.parse(row.body);
  if (!policy.enabled || Date.parse(policy.expires_at) <= Date.now())
    throw new Problem(
      409,
      "BUDGET_POLICY_DISABLED",
      "The budget policy is disabled or expired",
    );
  return policy;
}

export async function saveBudgetPolicy(
  db: Database,
  tx: Tx,
  actor: Principal,
  tenant: string,
  project: string,
  connection: string,
  account: string,
  input: unknown,
  admin = false,
) {
  const parsed = budgetPolicyInput.parse(input);
  if (!admin) {
    await lockUserAuthorities(tx, [actor.id]);
    await currentUserAuthority(tx, actor);
  }
  await budgetLock(tx, connection, project, account);
  const source = await budgetConnection(
    db,
    tx,
    actor,
    tenant,
    project,
    connection,
    account,
    "manage",
    admin,
  );
  const current = await currentBudgetPolicy(tx, connection, project, account);
  if ((current?.version ?? 0) !== parsed.expected_version)
    throw new Problem(
      409,
      "BUDGET_POLICY_VERSION_CHANGED",
      "Reload the current budget policy",
    );
  const expiry = Date.parse(parsed.policy.expires_at);
  if (
    parsed.policy.enabled &&
    (expiry <= Date.now() || expiry > Date.now() + 30 * 86400000)
  )
    throw new Problem(
      400,
      "BUDGET_POLICY_EXPIRY",
      "Choose a policy expiry within the next 30 days",
    );
  if (source.account.currency !== parsed.policy.currency)
    throw new Problem(
      409,
      "BUDGET_CURRENCY_CHANGED",
      "Use the advertiser account's exact currency",
    );
  const row = (
    await tx.query(
      `INSERT INTO external_budget_policies(tenant_id,project_id,connection_id,account_id,version,body,payload_sha256,data_mode,created_by,created_by_audience)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        tenant,
        project,
        connection,
        account,
        parsed.expected_version + 1,
        parsed.policy,
        budgetDigest(parsed.policy),
        externalBudgetMode(db),
        actor.id,
        admin ? "admin" : "user",
      ],
    )
  ).rows[0];
  await tx.query(
    `UPDATE external_budget_operations SET state='cancelled',version=version+1,error_code='BUDGET_POLICY_CHANGED',finished_at=clock_timestamp(),lease_token=NULL,lease_until=NULL
    WHERE connection_id=$1 AND project_id=$2 AND account_id=$3 AND state IN('awaiting_confirmation','queued','checking')`,
    [connection, project, account],
  );
  await audit(
    tx,
    actor,
    "external_budget.policy.publish",
    row.id,
    "succeeded",
    {
      connection_id: connection,
      project_id: project,
      payload_sha256: row.payload_sha256,
      enabled: row.body.enabled,
    },
    tenant,
  );
  return budgetPolicyDTO(row);
}

async function preparedContext(
  db: Database,
  actor: Principal,
  tenant: string,
  project: string,
  connection: string,
  account: string,
  action: "read" | "write",
  authorize?: (tx: Tx) => Promise<unknown>,
  requirePolicy = true,
  admin = false,
) {
  const source = await db.tx(
    async (tx) => {
      await authorize?.(tx);
      const source = await budgetConnection(
        db,
        tx,
        actor,
        tenant,
        project,
        connection,
        account,
        action,
        admin,
      );
      const row = await currentBudgetPolicy(tx, connection, project, account);
      if (requirePolicy) activePolicy(db, row);
      return { ...source, policyRow: row };
    },
    tenant,
    true,
    actor.id,
  );
  const credential = await refreshConnectorCredential(
    db.config,
    "google_ads",
    source.context.credential,
  );
  if (canonical(credential) !== canonical(source.context.credential)) {
    await db.tx(
      async (tx) => {
        await authorize?.(tx);
        await budgetLock(tx, connection, project, account);
        const current = await budgetConnection(
          db,
          tx,
          actor,
          tenant,
          project,
          connection,
          account,
          action,
          admin,
        );
        if (
          current.row.auth_version !== source.row.auth_version ||
          current.row.encrypted_secret !== source.row.encrypted_secret
        )
          throw new Problem(
            409,
            "BUDGET_CONNECTION_CHANGED",
            "The connection authorization changed",
          );
        await tx.query(
          "UPDATE connections SET encrypted_secret=$2 WHERE id=$1",
          [connection, seal(db.config.MASTER_KEY!, JSON.stringify(credential))],
        );
      },
      tenant,
      true,
      actor.id,
    );
    source.context.credential = credential;
  }
  return source;
}

export async function previewBudget(
  db: Database,
  actor: Principal,
  tenant: string,
  project: string,
  connection: string,
  input: unknown,
  authorize?: (tx: Tx) => Promise<unknown>,
) {
  const parsed = budgetPrepareInput.parse(input);
  const source = await preparedContext(
    db,
    actor,
    tenant,
    project,
    connection,
    parsed.account_id,
    "read",
    authorize,
  );
  const body = activePolicy(db, source.policyRow);
  if (!body.budget_ids.includes(parsed.budget_id))
    throw new Problem(
      403,
      "BUDGET_POLICY_SCOPE",
      "This budget is not listed in the project policy",
    );
  const snapshot = await readGoogleBudget(
    db.config,
    source.context,
    parsed.budget_id,
  );
  checkBudgetPolicy(body, snapshot, parsed.new_average_daily_micros);
  const preview = await db.tx(
    async (tx) => {
      await authorize?.(tx);
      await budgetLock(tx, connection, project, parsed.account_id);
      const current = await budgetConnection(
        db,
        tx,
        actor,
        tenant,
        project,
        connection,
        parsed.account_id,
      );
      if (
        current.row.auth_version !== source.row.auth_version ||
        current.row.version !== source.row.version ||
        (await currentBudgetPolicy(tx, connection, project, parsed.account_id))
          ?.id !== source.policyRow.id
      )
        throw new Problem(
          409,
          "BUDGET_AUTHORITY_CHANGED",
          "The connection or budget policy changed",
        );
      const specification = {
        protocol: budgetProtocol,
        connection_auth_version: current.row.auth_version,
        binding_version: current.row.version,
        configuration_hash: current.row.configuration_hash,
        api_version: current.row.api_version,
        policy_id: source.policyRow.id,
        policy_version: source.policyRow.version,
        policy_sha256: source.policyRow.payload_sha256,
        before: snapshot,
        desired_average_daily_micros: parsed.new_average_daily_micros,
        source_sha256: budgetDigest(snapshot),
      };
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `external-budget-previews:${actor.id}:${project}`,
      ]);
      if (
        Number(
          (
            await tx.query(
              "SELECT count(*) FROM external_budget_previews WHERE actor_id=$1 AND project_id=$2 AND expires_at>clock_timestamp()",
              [actor.id, project],
            )
          ).rows[0].count,
        ) >= 100
      )
        throw new Problem(
          429,
          "BUDGET_PREVIEW_LIMIT",
          "Wait for earlier previews to expire before creating more",
        );
      return (
        await tx.query(
          `INSERT INTO external_budget_previews(tenant_id,project_id,connection_id,account_id,actor_id,actor_auth_version,body,body_sha256,data_mode,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,least($10::timestamptz,clock_timestamp()+interval '10 minutes')) RETURNING id,expires_at`,
          [
            tenant,
            project,
            connection,
            parsed.account_id,
            actor.id,
            actor.authVersion,
            specification,
            budgetDigest(specification),
            externalBudgetMode(db),
            body.expires_at,
          ],
        )
      ).rows[0];
    },
    tenant,
    true,
    actor.id,
  );
  return {
    protocol: budgetProtocol,
    preview_id: preview.id,
    expires_at: preview.expires_at.toISOString(),
    before: snapshot,
    source_sha256: budgetDigest(snapshot),
    desired_average_daily_micros: parsed.new_average_daily_micros,
    policy: budgetPolicyDTO(source.policyRow),
    data_mode: externalBudgetMode(db),
    provider_mutations: 0,
    additional_ai_calls: 0,
    limitation:
      "Average daily budget, not a maximum daily charge. Concurrent changes outside this application cannot be locked.",
  };
}

export function budgetOperationDTO(row: any) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    connection_id: row.connection_id,
    account_id: row.account_id,
    budget_id: row.budget_id,
    state: row.state,
    version: row.version,
    payload_sha256: row.payload_sha256,
    specification: row.specification,
    policy_id: row.policy_id,
    policy_version: row.policy_version,
    data_mode: row.data_mode,
    created_by: row.actor_id,
    confirmed_by: row.confirmed_by,
    error_code: row.error_code,
    observation: row.observation,
    resolution: row.resolution,
    request_sha256: row.request_sha256,
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
    finished_at: row.finished_at?.toISOString() ?? null,
    additional_ai_calls: 0,
    additional_ai_charge_micros: "0",
  };
}
export async function budgetOperation(
  db: Database,
  tx: Tx,
  tenant: string,
  project: string,
  id: string,
  lock = false,
) {
  const row = (
    await tx.query(
      `SELECT * FROM external_budget_operations WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND data_mode=$4${lock ? " FOR UPDATE" : ""}`,
      [id, tenant, project, externalBudgetMode(db)],
    )
  ).rows[0];
  if (!row) throw missing();
  return row;
}

export async function prepareBudget(
  db: Database,
  actor: Principal,
  tenant: string,
  project: string,
  connection: string,
  input: unknown,
  requestKey: string,
  taskId?: string,
  authorize?: (tx: Tx) => Promise<unknown>,
) {
  const parsed = budgetProposalInput.parse(input);
  return db.tx(
    async (tx) => {
      await authorize?.(tx);
      await lockUserAuthorities(tx, [actor.id]);
      await currentUserAuthority(tx, actor);
      await budgetProjectAccess(tx, actor, tenant, project, "write");
      await budgetLock(tx, connection, project, parsed.account_id);
      const response = await replay(
        tx,
        actor.id,
        "external_budget.prepare:" + project,
        requestKey,
        { connection, ...parsed, task_id: taskId ?? null },
        async () => {
          const current = await budgetConnection(
            db,
            tx,
            actor,
            tenant,
            project,
            connection,
            parsed.account_id,
            "write",
          );
          const source = (
            await tx.query(
              `SELECT * FROM external_budget_previews WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND connection_id=$4
        AND actor_id=$5 AND data_mode=$6`,
              [
                parsed.preview_id,
                tenant,
                project,
                connection,
                actor.id,
                externalBudgetMode(db),
              ],
            )
          ).rows[0];
          if (!source) throw missing();
          const specification = source.body;
          const policyRow = await currentBudgetPolicy(
            tx,
            connection,
            project,
            parsed.account_id,
          );
          const policy = activePolicy(db, policyRow);
          if (
            source.actor_auth_version !== actor.authVersion ||
            source.expires_at.valueOf() <= Date.now() ||
            source.body_sha256 !== budgetDigest(specification) ||
            source.account_id !== parsed.account_id ||
            specification.before.budget_id !== parsed.budget_id ||
            specification.desired_average_daily_micros !==
              parsed.new_average_daily_micros ||
            specification.source_sha256 !== parsed.expected_source_sha256 ||
            budgetDigest(specification.before) !== parsed.expected_source_sha256
          )
            throw new Problem(
              409,
              "BUDGET_PREVIEW_CHANGED",
              "The exact preview changed or expired; preview the budget again",
            );
          if (
            current.row.auth_version !==
              specification.connection_auth_version ||
            current.row.version !== specification.binding_version ||
            current.row.configuration_hash !==
              specification.configuration_hash ||
            current.row.api_version !== specification.api_version ||
            policyRow.id !== specification.policy_id
          )
            throw new Problem(
              409,
              "BUDGET_AUTHORITY_CHANGED",
              "The connection or policy changed after preview",
            );
          checkBudgetPolicy(
            policy,
            googleBudgetSnapshot.parse(specification.before),
            parsed.new_average_daily_micros,
          );
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [
              `external-budget-target:${tenant}:${parsed.account_id}:${parsed.budget_id}`,
            ],
          );
          const unresolved = (
            await tx.query(
              "SELECT id FROM external_budget_operations WHERE tenant_id=$1 AND account_id=$2 AND budget_id=$3 AND state IN('awaiting_confirmation','queued','checking','dispatched','unknown')",
              [tenant, parsed.account_id, parsed.budget_id],
            )
          ).rows[0];
          if (unresolved)
            throw new Problem(
              409,
              "BUDGET_TARGET_UNRESOLVED",
              "Resolve or cancel the existing operation for this budget first",
            );
          const auto = policy.confirmation === "within_policy";
          const row = (
            await tx.query(
              `INSERT INTO external_budget_operations(tenant_id,project_id,connection_id,account_id,budget_id,policy_id,policy_version,specification,payload_sha256,data_mode,actor_id,actor_auth_version,task_id,state,confirmed_by,confirmed_auth_version,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,least($17::timestamptz,clock_timestamp()+interval '15 minutes')) RETURNING *`,
              [
                tenant,
                project,
                connection,
                parsed.account_id,
                parsed.budget_id,
                policyRow.id,
                policyRow.version,
                specification,
                budgetDigest(specification),
                externalBudgetMode(db),
                actor.id,
                actor.authVersion,
                taskId ?? null,
                auto ? "queued" : "awaiting_confirmation",
                auto ? actor.id : null,
                auto ? actor.authVersion : null,
                policy.expires_at,
              ],
            )
          ).rows[0];
          await audit(
            tx,
            actor,
            "external_budget.prepare",
            row.id,
            "succeeded",
            {
              payload_sha256: row.payload_sha256,
              state: row.state,
              task_id: taskId ?? null,
            },
            tenant,
          );
          return { id: row.id };
        },
      );
      // A lost creation response returns the current original operation, even after
      // execution, policy withdrawal or preview expiry. Authority is still current.
      return budgetOperationDTO(
        await budgetOperation(
          db,
          tx,
          tenant,
          project,
          (response as { id: string }).id,
        ),
      );
    },
    tenant,
    true,
    actor.id,
  );
}

export async function decideBudget(
  db: Database,
  tx: Tx,
  actor: Principal,
  tenant: string,
  project: string,
  id: string,
  input: unknown,
) {
  const parsed = budgetDecisionInput.parse(input);
  await lockUserAuthorities(tx, [actor.id]);
  await currentUserAuthority(tx, actor);
  await budgetProjectAccess(tx, actor, tenant, project, "manage");
  const initial = await budgetOperation(db, tx, tenant, project, id);
  await budgetLock(tx, initial.connection_id, project, initial.account_id);
  const row = await budgetOperation(db, tx, tenant, project, id, true);
  if (
    row.state !== "awaiting_confirmation" ||
    row.version !== parsed.expected_version ||
    row.payload_sha256 !== parsed.payload_sha256
  )
    throw new Problem(
      409,
      "BUDGET_CONFIRMATION_CHANGED",
      "Reload the exact operation before deciding",
    );
  if (parsed.decision === "confirm") {
    await budgetConnection(
      db,
      tx,
      actor,
      tenant,
      project,
      row.connection_id,
      row.account_id,
      "manage",
    );
    const policy = await currentBudgetPolicy(
      tx,
      row.connection_id,
      project,
      row.account_id,
    );
    if (policy?.id !== row.policy_id || row.expires_at.valueOf() <= Date.now())
      throw new Problem(
        409,
        "BUDGET_CONFIRMATION_EXPIRED",
        "The policy or exact operation expired",
      );
    checkBudgetPolicy(
      activePolicy(db, policy),
      googleBudgetSnapshot.parse(row.specification.before),
      row.specification.desired_average_daily_micros,
    );
    if (budgetDigest(row.specification) !== row.payload_sha256)
      throw new Problem(
        409,
        "BUDGET_DIGEST_CHANGED",
        "Frozen operation evidence changed",
      );
  }
  const next = (
    await tx.query(
      `UPDATE external_budget_operations SET state=$2,confirmed_by=$3,confirmed_auth_version=$4,version=version+1,
    finished_at=CASE WHEN $2='cancelled' THEN clock_timestamp() ELSE NULL END WHERE id=$1 RETURNING *`,
      [
        id,
        parsed.decision === "confirm" ? "queued" : "cancelled",
        parsed.decision === "confirm" ? actor.id : null,
        parsed.decision === "confirm" ? actor.authVersion : null,
      ],
    )
  ).rows[0];
  await audit(
    tx,
    actor,
    "external_budget." + parsed.decision,
    id,
    "succeeded",
    { payload_sha256: row.payload_sha256 },
    tenant,
  );
  return budgetOperationDTO(next);
}

export async function cancelBudget(
  db: Database,
  tx: Tx,
  actor: Principal,
  tenant: string,
  project: string,
  id: string,
  input: unknown,
  admin = false,
) {
  const parsed = budgetRevisionInput.parse(input);
  if (!admin) {
    await lockUserAuthorities(tx, [actor.id]);
    await currentUserAuthority(tx, actor);
    await budgetProjectAccess(tx, actor, tenant, project, "write");
  }
  const initial = await budgetOperation(db, tx, tenant, project, id);
  if (!admin && initial.actor_id !== actor.id)
    await budgetProjectAccess(tx, actor, tenant, project, "manage");
  await budgetLock(tx, initial.connection_id, project, initial.account_id);
  const row = await budgetOperation(db, tx, tenant, project, id, true);
  if (
    row.version !== parsed.expected_version ||
    !["awaiting_confirmation", "queued", "checking"].includes(row.state)
  )
    throw new Problem(
      409,
      "BUDGET_CANNOT_CANCEL",
      "Only a current operation that has not been dispatched can be cancelled",
    );
  const next = (
    await tx.query(
      `UPDATE external_budget_operations SET state='cancelled',version=version+1,
    lease_token=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id=$1 RETURNING *`,
      [id],
    )
  ).rows[0];
  await audit(
    tx,
    actor,
    "external_budget.cancel",
    id,
    "succeeded",
    { payload_sha256: row.payload_sha256 },
    tenant,
  );
  return budgetOperationDTO(next);
}

/** A current remote value is an observation, never proof that our request caused it. */
export async function observeBudget(
  db: Database,
  actor: Principal,
  tenant: string,
  project: string,
  id: string,
  input: unknown,
  authorize?: (tx: Tx) => Promise<unknown>,
  admin = false,
) {
  const parsed = budgetObserveInput.parse(input);
  const initial = await db.tx(
    async (tx) => {
      await authorize?.(tx);
      if (!admin)
        await budgetProjectAccess(tx, actor, tenant, project, "manage");
      const row = await budgetOperation(db, tx, tenant, project, id);
      if (row.state !== "unknown" || row.version !== parsed.expected_version)
        throw new Problem(
          409,
          "BUDGET_OBSERVATION_CHANGED",
          "Reload the unknown operation before observing",
        );
      return row;
    },
    tenant,
    true,
    actor.id,
  );
  const connection = parsed.connection_id ?? initial.connection_id;
  const source = await preparedContext(
    db,
    actor,
    tenant,
    project,
    connection,
    initial.account_id,
    "read",
    authorize,
    false,
    admin,
  );
  const snapshot = await readGoogleBudget(
    db.config,
    source.context,
    initial.budget_id,
  );
  return db.tx(
    async (tx) => {
      await authorize?.(tx);
      if (!admin) {
        await lockUserAuthorities(tx, [actor.id]);
        await currentUserAuthority(tx, actor);
        await budgetProjectAccess(tx, actor, tenant, project, "manage");
      }
      await budgetLock(tx, initial.connection_id, project, initial.account_id);
      const current = await budgetConnection(
        db,
        tx,
        actor,
        tenant,
        project,
        connection,
        initial.account_id,
        "read",
        admin,
      );
      if (
        current.row.auth_version !== source.row.auth_version ||
        current.row.version !== source.row.version
      )
        throw new Problem(
          409,
          "BUDGET_CONNECTION_CHANGED",
          "The observation connection changed",
        );
      const row = await budgetOperation(db, tx, tenant, project, id, true);
      if (row.state !== "unknown" || row.version !== parsed.expected_version)
        throw new Problem(
          409,
          "BUDGET_OBSERVATION_CHANGED",
          "The operation changed during observation",
        );
      const observation = {
        protocol: budgetProtocol,
        source: "provider_read",
        attribution: "unknown",
        connection_id: connection,
        connection_auth_version: current.row.auth_version,
        binding_version: current.row.version,
        snapshot,
        observed_at: new Date().toISOString(),
        actor_id: actor.id,
      };
      const next = (
        await tx.query(
          "UPDATE external_budget_operations SET observation=$2,version=version+1 WHERE id=$1 RETURNING *",
          [id, { ...observation, sha256: budgetDigest(observation) }],
        )
      ).rows[0];
      await audit(
        tx,
        actor,
        "external_budget.observe",
        id,
        "succeeded",
        { observation_sha256: next.observation.sha256, attribution: "unknown" },
        tenant,
      );
      return budgetOperationDTO(next);
    },
    tenant,
    true,
    actor.id,
  );
}

export async function closeUnknownBudget(
  db: Database,
  tx: Tx,
  actor: Principal,
  tenant: string,
  project: string,
  id: string,
  input: unknown,
  admin = false,
) {
  const parsed = budgetCloseInput.parse(input);
  if (!admin) {
    await lockUserAuthorities(tx, [actor.id]);
    await currentUserAuthority(tx, actor);
    await budgetProjectAccess(tx, actor, tenant, project, "manage");
  }
  const initial = await budgetOperation(db, tx, tenant, project, id);
  await budgetLock(tx, initial.connection_id, project, initial.account_id);
  const row = await budgetOperation(db, tx, tenant, project, id, true);
  const observation = row.observation;
  const { sha256: observationHash, ...observed } = observation ?? {};
  if (
    row.state !== "unknown" ||
    row.version !== parsed.expected_version ||
    !observation ||
    observationHash !== parsed.observation_sha256 ||
    budgetDigest(observed) !== observationHash ||
    Date.parse(observation.observed_at) < Date.now() - 10 * 60_000
  )
    throw new Problem(
      409,
      "BUDGET_CLOSURE_CHANGED",
      "Observe the unknown operation again before acknowledging closure",
    );
  // Reconnection is supported; closure still requires current access to that exact account.
  const authority = await budgetConnection(
    db,
    tx,
    actor,
    tenant,
    project,
    observation.connection_id,
    row.account_id,
    "read",
    admin,
  );
  if (
    authority.row.auth_version !== observation.connection_auth_version ||
    authority.row.version !== observation.binding_version
  )
    throw new Problem(
      409,
      "BUDGET_OBSERVATION_CHANGED",
      "Observe the account again after its authorization changes",
    );
  const resolution = {
    reason: parsed.reason,
    acknowledge_unknown_attribution: true,
    observation_sha256: observationHash,
    resolved_by: actor.id,
    resolved_at: new Date().toISOString(),
    attribution: "unknown",
    retry_dispatched_request: false,
  };
  const next = (
    await tx.query(
      `UPDATE external_budget_operations SET state='closed_unknown',version=version+1,resolution=$2,
    finished_at=clock_timestamp() WHERE id=$1 RETURNING *`,
      [id, resolution],
    )
  ).rows[0];
  await audit(
    tx,
    actor,
    "external_budget.close_unknown",
    id,
    "succeeded",
    resolution,
    tenant,
  );
  return budgetOperationDTO(next);
}

export async function budgetDetail(
  db: Database,
  tx: Tx,
  tenant: string,
  project: string,
  id: string,
) {
  const row = await budgetOperation(db, tx, tenant, project, id);
  const receipts = (
    await tx.query(
      "SELECT id,outcome,body,body_sha256,created_at FROM external_budget_receipts WHERE operation_id=$1 ORDER BY created_at,id",
      [id],
    )
  ).rows;
  const events = (
    await tx.query(
      "SELECT id::text,version,state,actor_id,details,created_at FROM external_budget_events WHERE operation_id=$1 ORDER BY version",
      [id],
    )
  ).rows;
  return { operation: budgetOperationDTO(row), receipts, events };
}

async function actorFor(
  tx: Tx,
  id: string,
  version: number,
): Promise<Principal> {
  const user = (
    await tx.query(
      "SELECT id,email,name,auth_version,status FROM users WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (!user || user.status !== "active" || user.auth_version !== version)
    throw new Problem(
      409,
      "BUDGET_ACTOR_REVOKED",
      "An operation actor no longer has authority",
    );
  return {
    id,
    email: user.email,
    name: user.name,
    authVersion: version,
    audience: "user",
    sessionId: "",
    sessionHash: "",
  };
}
async function dispatchAuthority(db: Database, tx: Tx, row: any) {
  await lockUserAuthorities(tx, [row.actor_id, row.confirmed_by]);
  const creator = await actorFor(tx, row.actor_id, row.actor_auth_version);
  const approver = await actorFor(
    tx,
    row.confirmed_by,
    row.confirmed_auth_version,
  );
  await budgetProjectAccess(
    tx,
    creator,
    row.tenant_id,
    row.project_id,
    "write",
  );
  const policy = await currentBudgetPolicy(
    tx,
    row.connection_id,
    row.project_id,
    row.account_id,
  );
  const parsed = activePolicy(db, policy);
  const connection = await budgetConnection(
    db,
    tx,
    approver,
    row.tenant_id,
    row.project_id,
    row.connection_id,
    row.account_id,
    parsed.confirmation === "each_operation" ? "manage" : "write",
  );
  const spec = row.specification;
  if (
    policy.id !== row.policy_id ||
    budgetDigest(spec) !== row.payload_sha256 ||
    connection.row.auth_version !== spec.connection_auth_version ||
    connection.row.version !== spec.binding_version ||
    connection.row.configuration_hash !== spec.configuration_hash ||
    connection.row.api_version !== spec.api_version ||
    row.expires_at.valueOf() <= Date.now()
  )
    throw new Problem(
      409,
      "BUDGET_AUTHORITY_CHANGED",
      "The operation, policy or connection changed or expired",
    );
  const snapshot = googleBudgetSnapshot.parse(spec.before);
  checkBudgetPolicy(parsed, snapshot, spec.desired_average_daily_micros);
  if (row.task_id) {
    const task = (
      await tx.query(
        "SELECT status FROM tasks WHERE id=$1 AND tenant_id=$2 AND project_id=$3",
        [row.task_id, row.tenant_id, row.project_id],
      )
    ).rows[0];
    if (!task || ["cancelled", "failed", "reconciling"].includes(task.status))
      throw new Problem(
        409,
        "BUDGET_ORIGIN_TASK_UNAVAILABLE",
        "The originating task was cancelled or could not complete",
      );
  }
  return { creator, approver, connection, snapshot };
}

export async function advanceExternalBudgets(db: Database) {
  await recoverBudgetReceipts(db);
  await db.tx(
    async (tx) => {
      await tx.query(
        "DELETE FROM external_budget_previews WHERE expires_at<clock_timestamp()-interval '1 hour'",
      );
      await tx.query(
        `UPDATE external_budget_operations SET state=CASE WHEN state='dispatched' THEN 'unknown' ELSE 'failed' END,
      version=version+1,error_code=CASE WHEN state='dispatched' THEN 'BUDGET_DISPATCH_LEASE_LOST' ELSE 'BUDGET_CHECK_LEASE_LOST' END,finished_at=clock_timestamp()
      WHERE data_mode=$1 AND state IN('checking','dispatched') AND lease_until<clock_timestamp()`,
        [externalBudgetMode(db)],
      );
      await tx.query(
        `UPDATE external_budget_operations SET state='expired',version=version+1,error_code='BUDGET_OPERATION_EXPIRED',finished_at=clock_timestamp()
      WHERE data_mode=$1 AND state IN('awaiting_confirmation','queued') AND expires_at<=clock_timestamp()`,
        [externalBudgetMode(db)],
      );
    },
    undefined,
    true,
  );
  const lease = randomUUID();
  const row = await db.tx(
    async (tx) => {
      const candidate = (
        await tx.query(
          "SELECT * FROM external_budget_operations WHERE data_mode=$1 AND state='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [externalBudgetMode(db)],
        )
      ).rows[0];
      if (!candidate) return;
      return (
        await tx.query(
          "UPDATE external_budget_operations SET state='checking',version=version+1,lease_token=$2,lease_until=clock_timestamp()+interval '2 minutes' WHERE id=$1 RETURNING *",
          [candidate.id, lease],
        )
      ).rows[0];
    },
    undefined,
    true,
  );
  if (!row) return 0;
  let admitted: any = null;
  let outcome: "applied" | "rejected" | "unknown" = "unknown";
  let receiptBody: Record<string, unknown> = {};
  try {
    const checked = await db.tx(
      async (tx) => {
        await lockUserAuthorities(tx, [row.actor_id, row.confirmed_by]);
        await budgetLock(tx, row.connection_id, row.project_id, row.account_id);
        return dispatchAuthority(db, tx, row);
      },
      row.tenant_id,
      true,
    );
    const connection = (
      await preparedContext(
        db,
        checked.approver,
        row.tenant_id,
        row.project_id,
        row.connection_id,
        row.account_id,
        "write",
      )
    ).context;
    const current = await readGoogleBudget(
      db.config,
      connection,
      row.budget_id,
    );
    if (budgetDigest(current) !== budgetDigest(checked.snapshot))
      throw new Problem(
        409,
        "BUDGET_REMOTE_CHANGED",
        "The external budget changed after preview; create a fresh operation",
      );
    if (
      current.amount_micros === row.specification.desired_average_daily_micros
    ) {
      await db.tx(
        (tx) =>
          tx.query(
            "UPDATE external_budget_operations SET state='no_change',version=version+1,finished_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND state='checking'",
            [row.id, lease],
          ),
        row.tenant_id,
        true,
      );
      return 1;
    }
    admitted = await db.tx(
      async (tx) => {
        await lockUserAuthorities(tx, [row.actor_id, row.confirmed_by]);
        await budgetLock(tx, row.connection_id, row.project_id, row.account_id);
        const locked = await budgetOperation(
          db,
          tx,
          row.tenant_id,
          row.project_id,
          row.id,
          true,
        );
        if (
          locked.state !== "checking" ||
          locked.lease_token !== lease ||
          locked.lease_until.valueOf() <= Date.now()
        )
          throw new Problem(
            409,
            "BUDGET_LEASE_LOST",
            "The operation is no longer owned by this worker",
          );
        await dispatchAuthority(db, tx, locked);
        return (
          await tx.query(
            "UPDATE external_budget_operations SET state='dispatched',version=version+1,request_sha256=$3 WHERE id=$1 AND lease_token=$2 RETURNING *",
            [
              row.id,
              lease,
              budgetDigest(
                budgetRequest(
                  current,
                  row.specification.desired_average_daily_micros,
                ),
              ),
            ],
          )
        ).rows[0];
      },
      row.tenant_id,
      true,
    );
    const receipt = await writeGoogleBudget(
      db.config,
      connection,
      current,
      row.specification.desired_average_daily_micros,
    );
    if (receipt.request_sha256 !== admitted.request_sha256)
      throw new Problem(
        409,
        "BUDGET_REQUEST_CHANGED",
        "The exact dispatched request changed",
      );
    outcome = "applied";
    receiptBody = receipt;
  } catch (error) {
    const code =
      error instanceof Problem ? error.code : "BUDGET_OPERATION_FAILED";
    if (admitted) {
      outcome = error instanceof BudgetRejected ? "rejected" : "unknown";
      receiptBody = {
        error_code: code,
        payload_sha256: row.payload_sha256,
        request_sha256: admitted.request_sha256,
      };
    } else
      await db.tx(
        (tx) =>
          tx.query(
            "UPDATE external_budget_operations SET state='failed',version=version+1,error_code=$3,finished_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND state='checking'",
            [row.id, lease, code],
          ),
        row.tenant_id,
        true,
      );
  }
  if (admitted)
    await persistBudgetReceipt(db, admitted, lease, outcome, receiptBody);
  return 1;
}
