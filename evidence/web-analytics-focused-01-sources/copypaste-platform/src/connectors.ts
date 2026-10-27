import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireUser, requireAdmin, type Principal } from "./auth.js";
import {
  permit,
  scopePredicate,
  requireSensitiveAdmin,
} from "./admin-access.js";
import {
  currentAdminControl,
  pinAdminPolicy,
} from "./admin-operation-policy.js";
import { adminOperationDTO } from "./admin-memberships.js";
import { projectAccess, tenantAccess, key, replay } from "./access.js";
import { validFederation } from "./federation-session.js";
import {
  canonical,
  csvCell,
  hash,
  Problem,
  seal,
  token,
  unseal,
  uuid,
} from "./lib.js";
import { Storage, saveAsset } from "./storage.js";
import { persistCampaignSnapshot } from "./analytics.js";
import { normalizeMetricsCSV } from "./analytics-import.js";
import {
  connectionDTO,
  connectionListDTO,
  connectorAccount,
  connectorCreateInput,
  connectorCredential,
  connectorFact,
  connectorLimits,
  connectorQuery,
  connectorSyncDTO,
  connectorSyncInput,
  connectorUpdateInput,
  connectorVersion,
  discoveryCursor,
  internalProvider,
  pageCursor,
  profilesFor,
  publicProvider,
  type ConnectorFact,
  type ConnectorQuery,
  type ConnectorProvider,
} from "./connector-model.js";
import {
  connectorAuthorizationURL,
  connectorConfigurationHash,
  connectorProviders,
  connectorSettings,
  discoverConnectorPage,
  exchangeConnectorCode,
  readConnectorPage,
  refreshConnectorCredential,
} from "./connector-provider.js";
import { ConnectorFailure } from "./connector-http.js";
import {
  calculateWebAnalytics,
  checkedWebSnapshot,
  renderWebAnalytics,
  webAnalyticsOptions,
  webAnalyticsPage,
  webAnalyticsSelection,
} from "./web-analytics.js";

const tenantOf = (req: FastifyRequest) =>
  uuid.parse(req.headers["x-tenant-id"] ?? (req.params as any).tenant);
const idOf = (req: FastifyRequest) => uuid.parse((req.params as any).id);
const notFound = () =>
  new Problem(404, "NOT_FOUND", "Connection or synchronization not found");
const mode = (db: Database) =>
  db.config.DEMO_MODE ? "simulated" : "configured_services";
const joined = `SELECT c.*,p.auth_version,p.version,p.account_ids,p.project_ids,p.data_mode,p.api_version,p.configuration_hash,
 p.catalog_state,p.catalog_limits,p.last_sync_at,p.data_as_of FROM connections c JOIN connector_profiles p ON p.connection_id=c.id`;
async function connection(
  tx: Tx,
  p: Principal,
  tenant: string,
  id: string,
  action: "read" | "write" | "manage" = "read",
  lock = false,
) {
  const c = (
    await tx.query(
      `${joined} WHERE c.id=$1 AND c.tenant_id=$2${lock ? " FOR UPDATE OF c,p" : ""}`,
      [id, tenant],
    )
  ).rows[0];
  if (!c) throw notFound();
  await projectAccess(tx, p, tenant, c.project_id, action);
  return c;
}
async function dto(db: Database, tx: Tx, c: any, p?: Principal) {
  const pending =
    c.state === "pending" && p
      ? (
          await tx.query(
            "SELECT * FROM connector_oauth_states WHERE connection_id=$1 AND actor_id=$2 AND session_id=$3 AND consumed_at IS NULL AND expires_at>clock_timestamp() ORDER BY expires_at DESC LIMIT 1",
            [c.id, p.id, p.sessionId],
          )
        ).rows[0]
      : null;
  return connectionDTO.parse({
    id: c.id,
    project_id: c.project_id,
    provider: publicProvider(c.provider),
    state:
      c.state !== "revoked" && c.configuration_hash === "0".repeat(64)
        ? "reauth_required"
        : c.state === "connected"
          ? c.catalog_state === "complete"
            ? "active"
            : "degraded"
          : c.state === "error"
            ? "reauth_required"
            : c.state,
    auth_version: c.auth_version,
    version: c.version,
    account_ids: c.account_ids,
    data_as_of: c.data_as_of?.toISOString() ?? null,
    ...(pending
      ? {
          authorization_url: connectorAuthorizationURL(
            db.config,
            publicProvider(c.provider),
            unseal(db.config.MASTER_KEY!, pending.encrypted_state),
            unseal(db.config.MASTER_KEY!, pending.encrypted_verifier),
          ),
        }
      : {}),
  });
}
function syncDTO(job: any, snapshot?: string) {
  return connectorSyncDTO.parse({
    id: job.id,
    connection_id: job.connection_id,
    state: job.state === "cancelled" ? "failed" : job.state,
    ...(snapshot ? { snapshot_id: snapshot } : {}),
  });
}
function jobInfo(job: any) {
  return {
    ...syncDTO(job),
    kind: job.kind,
    status: job.state,
    segment: job.segment,
    page_count: job.page_count,
    row_count: job.row_count,
    raw_bytes: Number(job.raw_bytes),
    attempts: job.attempts,
    error_code: job.error_code,
    limitations: job.limitations,
    captured_at: job.finished_at?.toISOString() ?? null,
    next_attempt_at: job.next_attempt_at.toISOString(),
    created_at: job.created_at.toISOString(),
    spec_hash: job.spec_hash,
    source_mode: job.data_mode,
    retry_of: job.retry_of,
  };
}
async function enqueue(
  tx: Tx,
  c: any,
  actor: Principal,
  kind: "discover" | "sync",
  specification: unknown,
  retryOf?: string,
) {
  const active = (
    await tx.query(
      "SELECT id FROM connector_jobs WHERE connection_id=$1 AND state IN('queued','running')",
      [c.id],
    )
  ).rows[0];
  if (active)
    throw new Problem(
      409,
      "CONNECTOR_BUSY",
      "Wait for or cancel the active synchronization",
    );
  return (
    await tx.query(
      `INSERT INTO connector_jobs(tenant_id,project_id,connection_id,kind,actor_id,actor_auth_version,connection_auth_version,binding_version,data_mode,specification,spec_hash,retry_of)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        c.tenant_id,
        c.project_id,
        c.id,
        kind,
        actor.id,
        actor.authVersion,
        c.auth_version,
        c.version,
        c.data_mode,
        JSON.stringify(specification),
        hash(canonical(specification)),
        retryOf ?? null,
      ],
    )
  ).rows[0];
}
async function sourceRows(tx: Tx, job: any) {
  const pages = (
    await tx.query(
      `SELECT p.*,v.storage_key,v.erased_at,a.state,a.private_owner,a.project_id,a.retention_expires_at
    FROM connector_pages p JOIN assets a ON a.id=p.asset_id JOIN asset_versions v ON v.asset_id=p.asset_id AND v.version=p.asset_version
    WHERE p.job_id=$1 ORDER BY p.ordinal`,
      [job.id],
    )
  ).rows;
  if (
    pages.some(
      (p) =>
        p.state !== "active" ||
        p.erased_at ||
        p.private_owner ||
        p.project_id !== job.project_id ||
        (p.retention_expires_at &&
          p.retention_expires_at.valueOf() <= Date.now()),
    )
  )
    throw new Problem(
      409,
      "CONNECTOR_SOURCE_REMOVED",
      "A retained source page is unavailable",
    );
  return pages;
}
const snapshotBody = z
  .object({
    schema: z.literal("copypaste-connector-snapshot-1"),
    source_mode: z.enum(["simulated", "configured_services"]),
    spec_hash: z.string().regex(/^[a-f\d]{64}$/),
    specification: z.record(z.string(), z.unknown()),
    facts: z.array(connectorFact).max(connectorLimits.facts),
    limitations: z.array(z.string()),
    captured_at: z.iso.datetime(),
    data_as_of: z.null(),
  })
  .strict();
async function snapshotAccess(
  tx: Tx,
  p: Principal,
  tenant: string,
  id: string,
) {
  const row = (
    await tx.query(
      `SELECT s.*,a.state AS content_state,a.retention_expires_at,v.storage_key,v.erased_at FROM connector_snapshots s
    JOIN assets a ON a.id=s.asset_id JOIN asset_versions v ON v.asset_id=s.asset_id AND v.version=s.asset_version
    WHERE s.id=$1 AND s.tenant_id=$2 AND connector_asset_available(s.asset_id)`,
      [id, tenant],
    )
  ).rows[0];
  if (
    !row ||
    row.content_state !== "active" ||
    row.erased_at ||
    (row.retention_expires_at &&
      row.retention_expires_at.valueOf() <= Date.now())
  )
    throw notFound();
  await projectAccess(tx, p, tenant, row.project_id);
  return row;
}
async function createSync(
  db: Database,
  tx: Tx,
  c: any,
  actor: Principal,
  dates: z.infer<typeof connectorSyncInput>,
  retryOf?: string,
) {
  if (c.state !== "connected" || c.catalog_state !== "complete")
    throw new Problem(
      409,
      "CONNECTOR_NOT_READY",
      "Complete authorization and account discovery first",
    );
  if (
    c.data_mode !== mode(db) ||
    c.configuration_hash !==
      connectorConfigurationHash(db.config, publicProvider(c.provider))
  )
    throw new Problem(
      409,
      "CONNECTOR_CONFIGURATION_CHANGED",
      "Reconnect using the current company configuration",
    );
  if (!c.account_ids.length || !c.project_ids.length)
    throw new Problem(
      409,
      "CONNECTOR_SCOPE_REQUIRED",
      "Confirm the accounts and projects first",
    );
  for (const project of c.project_ids)
    await projectAccess(tx, actor, c.tenant_id, project, "manage");
  const accounts = (
    await tx.query(
      "SELECT body FROM connector_accounts WHERE connection_id=$1 AND auth_version=$2 AND account_id=ANY($3) ORDER BY account_id",
      [c.id, c.auth_version, c.account_ids],
    )
  ).rows.map((v) => connectorAccount.parse(v.body));
  if (
    accounts.length !== c.account_ids.length ||
    accounts.some((a) => !a.readable || a.kind === "manager")
  )
    throw new Problem(
      409,
      "CONNECTOR_ACCOUNT_UNAVAILABLE",
      "Select currently authorized reporting accounts",
    );
  const queries = accounts.flatMap((account) =>
    profilesFor(publicProvider(c.provider)).map((profile) =>
      connectorQuery.parse({
        provider: publicProvider(c.provider),
        api_version: c.api_version,
        account,
        profile,
        ...dates,
        page_size:
          c.data_mode === "simulated"
            ? 2
            : c.provider === "search_console"
              ? 25000
              : c.provider === "meta"
                ? 1000
                : 10000,
        conversion_action_type: "purchase",
        version: connectorVersion,
      }),
    ),
  );
  return enqueue(
    tx,
    c,
    actor,
    "sync",
    {
      dates,
      queries,
      project_ids: c.project_ids,
      accounts: c.account_ids,
      connection_auth_version: c.auth_version,
      binding_version: c.version,
    },
    retryOf,
  );
}
async function history(tx: Tx, c: any, cursor?: string) {
  if (
    cursor &&
    !(
      await tx.query(
        "SELECT 1 FROM connector_jobs WHERE id=$1 AND connection_id=$2",
        [cursor, c.id],
      )
    ).rowCount
  )
    throw notFound();
  const rows = (
    await tx.query(
      `SELECT * FROM connector_jobs WHERE connection_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM connector_jobs WHERE id=$2 AND connection_id=$1)) ORDER BY created_at DESC,id DESC LIMIT 21`,
      [c.id, cursor ?? null],
    )
  ).rows;
  const jobs = rows.slice(0, 20);
  const snapshots = (
    await tx.query(
      `SELECT s.id,s.project_id,s.state,s.row_count,s.captured_at,s.data_as_of,s.spec_hash,s.data_mode,s.asset_id,s.dataset_ids,s.limitations
     FROM connector_snapshots s JOIN assets a ON a.id=s.asset_id WHERE s.job_id=ANY($1) AND s.project_id=$2 AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND connector_asset_available(s.asset_id) ORDER BY s.captured_at DESC`,
      [jobs.map((j) => j.id), c.project_id],
    )
  ).rows;
  return {
    jobs: jobs.map(jobInfo),
    snapshots,
    next_history_cursor: rows.length > 20 ? jobs[jobs.length - 1].id : null,
  };
}
export function registerConnections(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
) {
  app.get(
    "/v1/admin/connections",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const q = z
        .object({
          tenant_id: uuid.optional(),
          project_id: uuid.optional(),
          user_id: uuid.optional(),
          period_from: z.iso.datetime({ offset: true }).optional(),
          period_to: z.iso.datetime({ offset: true }).optional(),
          cursor: uuid.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          q: z.string().max(200).optional(),
        })
        .strict()
        .parse(req.query);
      if (
        q.period_from &&
        q.period_to &&
        Date.parse(q.period_from) > Date.parse(q.period_to)
      )
        throw new Problem(
          400,
          "CONNECTOR_PERIOD_INVALID",
          "Start must precede end",
        );
      return db.tx(
        async (tx) => {
          const scoped = await scopePredicate(
              tx,
              req.principal,
              "admin.connections.read",
              "c.tenant_id",
              "c.project_id",
            ),
            args: any[] = [...scoped.values];
          if (
            !scoped.values[0] &&
            !(scoped.values[1] as unknown[]).length &&
            !(scoped.values[2] as unknown[]).length
          )
            throw new Problem(
              403,
              "ADMIN_FORBIDDEN",
              "No authorized connection scope",
            );
          const add = (v: unknown) => {
            args.push(v);
            return `$${args.length}`;
          };
          let where = scoped.sql;
          for (const [column, value] of [
            ["tenant_id", q.tenant_id],
            ["project_id", q.project_id],
            ["created_by", q.user_id],
          ] as const)
            if (value) where += ` AND c.${column}=${add(value)}::uuid`;
          if (q.cursor) where += ` AND c.id>${add(q.cursor)}::uuid`;
          if (q.period_from)
            where += ` AND c.created_at>=${add(q.period_from)}::timestamptz`;
          if (q.period_to)
            where += ` AND c.created_at<=${add(q.period_to)}::timestamptz`;
          if (q.q)
            where += ` AND (c.name||' '||c.provider) ILIKE ${add("%" + q.q.replace(/[\\%_]/g, "\\$&") + "%")}`;
          const rows = (
            await tx.query(
              `${joined} WHERE ${where} ORDER BY c.id LIMIT ${add(q.limit + 1)}`,
              args,
            )
          ).rows;
          await audit(
            tx,
            req.principal,
            "admin.connections.read",
            undefined,
            "succeeded",
            { tenant_id: q.tenant_id, project_id: q.project_id },
          );
          return connectionListDTO.parse({
            items: await Promise.all(
              rows.slice(0, q.limit).map((c) => dto(db, tx, c)),
            ),
            next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
          });
        },
        undefined,
        true,
      );
    },
  );
  app.get(
    "/v1/admin/connections/:id/detail",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = idOf(req);
      return db.tx(
        async (tx) => {
          const c = (await tx.query(`${joined} WHERE c.id=$1`, [id])).rows[0];
          if (!c) throw notFound();
          await permit(tx, req.principal, "admin.connections.read", {
            tenant: c.tenant_id,
            project: c.project_id,
          });
          const jobs = (
            await tx.query(
              "SELECT * FROM connector_jobs WHERE connection_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30",
              [id],
            )
          ).rows;
          const snapshots = (
            await tx.query(
              "SELECT id,project_id,state,row_count,captured_at,data_as_of,data_mode,asset_id,dataset_ids,limitations FROM connector_snapshots WHERE job_id=ANY($1) AND project_id=$2 ORDER BY captured_at DESC",
              [jobs.map((j) => j.id), c.project_id],
            )
          ).rows;
          await audit(
            tx,
            req.principal,
            "admin.connections.detail",
            id,
            "succeeded",
            {},
            c.tenant_id,
          );
          return {
            connection: await dto(db, tx, c),
            tenant_id: c.tenant_id,
            project_id: c.project_id,
            name: c.name,
            source_mode: c.data_mode,
            api_version: c.api_version,
            project_ids: c.project_ids,
            catalog_state: c.catalog_state,
            limitations: c.catalog_limits,
            scopes: c.scopes,
            last_sync_at: c.last_sync_at?.toISOString() ?? null,
            jobs: jobs.map(jobInfo),
            snapshots,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/connections/:id/revocations",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      const id = idOf(req),
        body = z
          .object({ reason: z.string().trim().min(3).max(1000) })
          .strict()
          .parse(req.body),
        requestKey = key(req);
      return db.tx(
        async (tx) => {
          const c = (
            await tx.query("SELECT * FROM connections WHERE id=$1 FOR UPDATE", [
              id,
            ])
          ).rows[0];
          if (!c) throw notFound();
          await permit(tx, req.principal, "admin.connections.revoke", {
            tenant: c.tenant_id,
            project: c.project_id,
          });
          await requireSensitiveAdmin(tx, req.principal);
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`admin.operation:${req.principal.id}:${requestKey}`],
          );
          const previous = (
            await tx.query(
              "SELECT action,target_ids FROM admin_operations WHERE principal_id=$1 AND idempotency_key=$2",
              [req.principal.id, requestKey],
            )
          ).rows[0];
          if (
            previous &&
            (previous.action !== "connections.revoke" ||
              previous.target_ids.length !== 1 ||
              previous.target_ids[0] !== id)
          )
            throw new Problem(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Use a new request key for a different operation",
            );
          const saved = await replay(
            tx,
            req.principal.id,
            `admin.connection.revoke:${id}`,
            requestKey,
            body,
            async () => {
              const control = await currentAdminControl(tx),
                policy = await pinAdminPolicy(tx, {
                  schema: "connector-revocation-1",
                  source_policy_id: control?.id ?? null,
                  source_policy_version: control?.version ?? null,
                  source_policy: control?.body ?? {},
                  semantics:
                    "immediate_revocation_of_read_access_no_financial_or_external_write",
                });
              const payload = {
                connection_id: id,
                tenant_id: c.tenant_id,
                project_id: c.project_id,
                reason: body.reason,
              };
              const operation = (
                await tx.query(
                  "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) VALUES($1,'connections.revoke',$2,$3,$4,$5,'queued',$6,$7) RETURNING *",
                  [
                    req.principal.id,
                    c.tenant_id,
                    hash(canonical(payload)),
                    JSON.stringify(payload),
                    requestKey,
                    policy,
                    [id],
                  ],
                )
              ).rows[0];
              await tx.query(
                "UPDATE connections SET state='revoked',encrypted_secret=NULL WHERE id=$1",
                [id],
              );
              await tx.query(
                "UPDATE admin_operations SET state='succeeded',result=$2,result_ids=$3,version=version+1 WHERE id=$1",
                [operation.id, JSON.stringify({ ok: true }), [id]],
              );
              await audit(
                tx,
                req.principal,
                "admin.connections.revoke",
                id,
                "succeeded",
                { reason: body.reason, operation_id: operation.id },
                c.tenant_id,
              );
              return { id: operation.id };
            },
          );
          reply.code(202);
          return adminOperationDTO(
            (
              await tx.query("SELECT * FROM admin_operations WHERE id=$1", [
                saved.id,
              ])
            ).rows[0],
          );
        },
        undefined,
        true,
      );
    },
  );
  app.get("/v1/connections/launch/:state", async (req) => {
    const state = z
      .string()
      .regex(/^[\w-]{43}$/)
      .parse((req.params as any).state);
    return db.tx(
      async (tx) => {
        const saved = (
          await tx.query(
            "SELECT * FROM connector_oauth_states WHERE digest=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
            [hash(state)],
          )
        ).rows[0];
        if (!saved)
          throw new Problem(
            401,
            "OAUTH_STATE_INVALID",
            "Restart the expired authorization",
          );
        const actor = await oauthActor(tx, saved),
          c = await connection(
            tx,
            actor,
            saved.tenant_id,
            saved.connection_id,
            "manage",
          );
        if (
          c.state !== "pending" ||
          saved.configuration_hash !==
            connectorConfigurationHash(db.config, publicProvider(c.provider))
        )
          throw new Problem(
            409,
            "CONNECTOR_AUTHORITY_CHANGED",
            "Restart authorization using the current connection",
          );
        return {
          authorization_url: connectorAuthorizationURL(
            db.config,
            publicProvider(c.provider),
            state,
            unseal(db.config.MASTER_KEY!, saved.encrypted_verifier),
          ),
          source_mode: c.data_mode,
        };
      },
      undefined,
      true,
    );
  });
  app.get(
    "/v1/connector-providers",
    { preHandler: requireUser(db) },
    async () => ({
      items: Object.entries(connectorProviders).map(([provider, p]) => ({
        provider,
        name: p.name,
        configured: connectorSettings(db.config, provider as ConnectorProvider)
          .available,
        source_mode: mode(db),
        api_version:
          connectorSettings(db.config, provider as ConnectorProvider).version ??
          null,
      })),
    }),
  );
  app.get("/v1/connections", { preHandler: requireUser(db) }, async (req) => {
    const tenant = tenantOf(req),
      q = z
        .object({
          project_id: uuid.optional(),
          cursor: uuid.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        })
        .strict()
        .parse(req.query);
    return db.tx(
      async (tx) => {
        const membership = await tenantAccess(tx, req.principal, tenant);
        if (q.project_id)
          await projectAccess(tx, req.principal, tenant, q.project_id);
        const list = (
          await tx.query(
            `${joined} WHERE c.tenant_id=$1 AND ($2::uuid IS NULL OR c.project_id=$2) AND ($3::uuid IS NULL OR c.id>$3)
              AND EXISTS(SELECT 1 FROM projects pr WHERE pr.id=c.project_id AND pr.tenant_id=c.tenant_id AND NOT pr.archived
                AND ($4 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=pr.id AND pm.tenant_id=c.tenant_id AND pm.user_id=$5)))
              ORDER BY c.id LIMIT $6`,
            [
              tenant,
              q.project_id ?? null,
              q.cursor ?? null,
              ["owner", "admin"].includes(membership.role),
              req.principal.id,
              q.limit + 1,
            ],
          )
        ).rows;
        const allowed: any[] = [];
        for (const c of list) {
          try {
            await projectAccess(tx, req.principal, tenant, c.project_id);
            allowed.push(c);
          } catch (e) {
            if (!(e instanceof Problem && [403, 404].includes(e.status)))
              throw e;
          }
          if (allowed.length > q.limit) break;
        }
        return connectionListDTO.parse({
          items: await Promise.all(
            allowed.slice(0, q.limit).map((c) => dto(db, tx, c, req.principal)),
          ),
          next_cursor:
            allowed.length > q.limit ? allowed[q.limit - 1].id : null,
        });
      },
      tenant,
      true,
      req.principal.id,
    );
  });
  app.post(
    "/v1/connections",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        b = connectorCreateInput.parse(req.body),
        k = key(req);
      return db.tx(
        async (tx) => {
          await projectAccess(
            tx,
            req.principal,
            tenant,
            b.project_id,
            "manage",
          );
          const setup = connectorSettings(db.config, b.provider);
          if (!setup.available)
            throw new Problem(
              503,
              "CONNECTOR_SETUP_REQUIRED",
              "Company OAuth configuration is required",
            );
          const saved = await replay(
            tx,
            req.principal.id,
            `connection.create:${tenant}`,
            k,
            b,
            async () => {
              const c = (
                await tx.query(
                  "INSERT INTO connections(tenant_id,project_id,provider,name,state,created_by) VALUES($1,$2,$3,$4,'pending',$5) RETURNING *",
                  [
                    tenant,
                    b.project_id,
                    internalProvider(b.provider),
                    connectorProviders[b.provider].name,
                    req.principal.id,
                  ],
                )
              ).rows[0];
              const state = token(),
                verifier = token(),
                fingerprint = connectorConfigurationHash(db.config, b.provider);
              await tx.query(
                "INSERT INTO connector_profiles(connection_id,tenant_id,project_id,data_mode,api_version,configuration_hash) VALUES($1,$2,$3,$4,$5,$6)",
                [
                  c.id,
                  tenant,
                  b.project_id,
                  mode(db),
                  setup.version,
                  fingerprint,
                ],
              );
              await tx.query(
                `INSERT INTO connector_oauth_states(digest,tenant_id,connection_id,actor_id,actor_auth_version,session_id,encrypted_verifier,encrypted_state,configuration_hash,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '10 minutes')`,
                [
                  hash(state),
                  tenant,
                  c.id,
                  req.principal.id,
                  req.principal.authVersion,
                  req.principal.sessionId,
                  seal(db.config.MASTER_KEY!, verifier),
                  seal(db.config.MASTER_KEY!, state),
                  fingerprint,
                ],
              );
              await audit(
                tx,
                req.principal,
                "connection.create",
                c.id,
                "succeeded",
                { provider: b.provider, source_mode: mode(db) },
                tenant,
              );
              return { id: c.id };
            },
          );
          reply.code(201);
          return dto(
            db,
            tx,
            await connection(tx, req.principal, tenant, saved.id, "manage"),
            req.principal,
          );
        },
        tenant,
        true,
        req.principal.id,
      );
    },
  );
  app.get("/v1/connections/callback", async (req, reply) => {
    const q = z
      .object({
        state: z.string().min(40).max(100),
        code: z.string().min(1).max(4000).optional(),
        error: z.string().max(200).optional(),
        scope: z.string().max(9000).optional(),
        authuser: z.string().max(100).optional(),
        prompt: z.string().max(100).optional(),
        error_reason: z.string().max(200).optional(),
        error_description: z.string().max(1000).optional(),
      })
      .strict()
      .parse(req.query);
    const state = await db.tx(
      async (tx) => {
        const s = (
          await tx.query(
            "SELECT * FROM connector_oauth_states WHERE digest=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE",
            [hash(q.state)],
          )
        ).rows[0];
        if (!s)
          throw new Problem(
            401,
            "OAUTH_STATE_INVALID",
            "Authorization expired or already used",
          );
        const p = await oauthActor(tx, s);
        const c = await connection(
          tx,
          p,
          s.tenant_id,
          s.connection_id,
          "manage",
          true,
        );
        if (
          c.state !== "pending" ||
          s.configuration_hash !==
            connectorConfigurationHash(db.config, publicProvider(c.provider))
        )
          throw new Problem(
            409,
            "CONNECTOR_CONFIGURATION_CHANGED",
            "Restart authorization",
          );
        await tx.query(
          "UPDATE connector_oauth_states SET consumed_at=clock_timestamp() WHERE digest=$1",
          [s.digest],
        );
        return { ...s, provider: publicProvider(c.provider) };
      },
      undefined,
      true,
    );
    if (!q.code || q.error) {
      await db.control.query(
        "UPDATE connections SET state='error',encrypted_secret=NULL WHERE id=$1 AND state='pending'",
        [state.connection_id],
      );
      throw new Problem(
        400,
        "CONNECTOR_CONSENT_DENIED",
        "Provider authorization was not granted",
      );
    }
    let credential;
    try {
      credential = await exchangeConnectorCode(
        db.config,
        state.provider,
        q.code,
        unseal(db.config.MASTER_KEY!, state.encrypted_verifier),
      );
    } catch (e) {
      await db.control.query(
        "UPDATE connections SET state='error',encrypted_secret=NULL WHERE id=$1 AND state='pending'",
        [state.connection_id],
      );
      throw e;
    }
    const out = await db.tx(
      async (tx) => {
        const p = await oauthActor(tx, state),
          c = await connection(
            tx,
            p,
            state.tenant_id,
            state.connection_id,
            "manage",
            true,
          );
        if (
          c.state !== "pending" ||
          state.configuration_hash !==
            connectorConfigurationHash(db.config, state.provider)
        )
          throw new Problem(
            409,
            "CONNECTOR_AUTHORITY_CHANGED",
            "Authorization changed before completion",
          );
        await tx.query(
          "UPDATE connections SET state='connected',encrypted_secret=$2,scopes=$3 WHERE id=$1",
          [
            c.id,
            seal(db.config.MASTER_KEY!, JSON.stringify(credential)),
            credential.scopes,
          ],
        );
        await tx.query(
          "UPDATE connector_profiles SET auth_version=auth_version+1,version=version+1,catalog_state='discovering' WHERE connection_id=$1",
          [c.id],
        );
        const current = await connection(
          tx,
          p,
          state.tenant_id,
          c.id,
          "manage",
        );
        await enqueue(tx, current, p, "discover", {
          provider: state.provider,
          api_version: current.api_version,
        });
        await audit(
          tx,
          p,
          "connection.authorize",
          c.id,
          "succeeded",
          {
            provider: state.provider,
            scopes: credential.scopes,
            source_mode: current.data_mode,
          },
          state.tenant_id,
        );
        return dto(db, tx, current);
      },
      state.tenant_id,
      true,
      state.actor_id,
    );
    if (req.headers.accept?.includes("text/html"))
      return reply.redirect(
        `${db.config.WEB_ORIGIN}/app/connections?connected=${out.id}`,
      );
    return out;
  });
  app.get(
    "/v1/connections/:id/detail",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req);
      return db.tx(
        async (tx) => {
          const c = await connection(tx, req.principal, tenant, id);
          const accounts = (
            await tx.query(
              "SELECT body FROM connector_accounts WHERE connection_id=$1 AND auth_version=$2 ORDER BY account_id",
              [id, c.auth_version],
            )
          ).rows.map((v) => connectorAccount.parse(v.body));
          return {
            connection: await dto(db, tx, c, req.principal),
            name: c.name,
            source_mode: c.data_mode,
            api_version: c.api_version,
            project_ids: c.project_ids,
            scopes: c.scopes,
            catalog_state: c.catalog_state,
            limitations: c.catalog_limits,
            accounts,
            last_sync_at: c.last_sync_at?.toISOString() ?? null,
            ...(await history(tx, c)),
          };
        },
        tenant,
        true,
        req.principal.id,
      );
    },
  );
  app.get(
    "/v1/connections/:id/history",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        q = z.object({ cursor: uuid.optional() }).strict().parse(req.query);
      return db.tx(
        async (tx) =>
          history(
            tx,
            await connection(tx, req.principal, tenant, id),
            q.cursor,
          ),
        tenant,
        true,
        req.principal.id,
      );
    },
  );
  app.patch(
    "/v1/connections/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        b = connectorUpdateInput.parse(req.body),
        k = key(req);
      return db.tx(
        async (tx) => {
          const c = await connection(
            tx,
            req.principal,
            tenant,
            id,
            "manage",
            true,
          );
          await replay(
            tx,
            req.principal.id,
            `connection.scope:${id}`,
            k,
            b,
            async () => {
              if (c.version !== b.expected_version)
                throw new Problem(
                  409,
                  "VERSION_CONFLICT",
                  "Refresh the current connection",
                );
              if (c.state !== "connected" || c.catalog_state !== "complete")
                throw new Problem(
                  409,
                  "CONNECTOR_NOT_READY",
                  "Complete current account discovery first",
                );
              if (
                b.account_ids.length &&
                (!b.project_ids.length || !b.project_ids.includes(c.project_id))
              )
                throw new Problem(
                  400,
                  "CONNECTOR_PROJECT_SCOPE",
                  "Include the connection's home project",
                );
              for (const project of b.project_ids)
                await projectAccess(
                  tx,
                  req.principal,
                  tenant,
                  project,
                  "manage",
                );
              const found = (
                await tx.query(
                  "SELECT body FROM connector_accounts WHERE connection_id=$1 AND auth_version=$2 AND account_id=ANY($3)",
                  [id, c.auth_version, b.account_ids],
                )
              ).rows;
              if (
                found.length !== b.account_ids.length ||
                found.some((a) => !a.body.readable || a.body.kind === "manager")
              )
                throw new Problem(
                  403,
                  "CONNECTOR_ACCOUNT_DENIED",
                  "Only discovered readable accounts may be selected",
                );
              await tx.query(
                "UPDATE connector_jobs SET state='cancelled',finished_at=clock_timestamp(),revision=revision+1,lease_token=NULL,lease_until=NULL,encrypted_cursor=NULL,error_code='CONNECTOR_BINDING_CHANGED' WHERE connection_id=$1 AND state IN('queued','running')",
                [id],
              );
              await tx.query(
                "UPDATE connector_profiles SET version=version+1,account_ids=$2,project_ids=$3 WHERE connection_id=$1",
                [
                  id,
                  b.account_ids.slice().sort(),
                  b.project_ids.slice().sort(),
                ],
              );
              await audit(
                tx,
                req.principal,
                "connection.scope",
                id,
                "succeeded",
                {
                  account_ids: b.account_ids,
                  project_ids: b.project_ids,
                  previous_version: c.version,
                },
                tenant,
              );
              return { ok: true };
            },
          );
          return dto(db, tx, await connection(tx, req.principal, tenant, id));
        },
        tenant,
        true,
        req.principal.id,
      );
    },
  );
  app.delete(
    "/v1/connections/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        k = key(req);
      return db.tx(
        async (tx) => {
          await connection(tx, req.principal, tenant, id, "manage", true);
          return replay(
            tx,
            req.principal.id,
            `connection.revoke:${id}`,
            k,
            {},
            async () => {
              await tx.query(
                "UPDATE connections SET state='revoked',encrypted_secret=NULL WHERE id=$1",
                [id],
              );
              await audit(
                tx,
                req.principal,
                "connection.revoke",
                id,
                "succeeded",
                {},
                tenant,
              );
              return { ok: true };
            },
          );
        },
        tenant,
        true,
        req.principal.id,
      );
    },
  );
  app.post(
    "/v1/connections/:id/discovery",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        k = key(req);
      z.object({})
        .strict()
        .parse(req.body ?? {});
      return db.tx(
        async (tx) => {
          const c = await connection(
            tx,
            req.principal,
            tenant,
            id,
            "manage",
            true,
          );
          if (c.state !== "connected")
            throw new Problem(409, "CONNECTOR_NOT_READY", "Reconnect first");
          const saved = await replay(
            tx,
            req.principal.id,
            `connection.discover:${id}`,
            k,
            {},
            async () => {
              await tx.query(
                "UPDATE connector_profiles SET auth_version=auth_version+1,version=version+1,catalog_state='discovering',account_ids='{}',project_ids='{}' WHERE connection_id=$1",
                [id],
              );
              const current = await connection(
                tx,
                req.principal,
                tenant,
                id,
                "manage",
              );
              const job = await enqueue(
                tx,
                current,
                req.principal,
                "discover",
                {
                  provider: publicProvider(c.provider),
                  api_version: c.api_version,
                },
              );
              return { id: job.id };
            },
          );
          reply.code(202);
          return syncDTO(
            (
              await tx.query("SELECT * FROM connector_jobs WHERE id=$1", [
                saved.id,
              ])
            ).rows[0],
          );
        },
        tenant,
        true,
        req.principal.id,
      );
    },
  );
  app.post(
    "/v1/connections/:id/syncs",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = tenantOf(req),
        id = idOf(req),
        b = connectorSyncInput.parse(req.body),
        k = key(req);
      return db.tx(
        async (tx) => {
          const c = await connection(
            tx,
            req.principal,
            tenant,
            id,
            "manage",
            true,
          );
          const saved = await replay(
            tx,
            req.principal.id,
            `connection.sync:${id}`,
            k,
            b,
            async () => {
              const job = await createSync(db, tx, c, req.principal, b);
              await audit(
                tx,
                req.principal,
                "connection.sync",
                job.id,
                "succeeded",
                { connection_id: id, spec_hash: job.spec_hash },
                tenant,
              );
              return { id: job.id };
            },
          );
          reply.code(202);
          return syncDTO(
            (
              await tx.query("SELECT * FROM connector_jobs WHERE id=$1", [
                saved.id,
              ])
            ).rows[0],
          );
        },
        tenant,
        true,
        req.principal.id,
      );
    },
  );
  for (const detail of [false, true])
    app.get(
      `/v1/syncs/:id${detail ? "/detail" : ""}`,
      { preHandler: requireUser(db) },
      async (req) => {
        const tenant = tenantOf(req),
          id = idOf(req);
        return db.tx(
          async (tx) => {
            const job = (
              await tx.query(
                "SELECT * FROM connector_jobs WHERE id=$1 AND tenant_id=$2",
                [id, tenant],
              )
            ).rows[0];
            if (!job) throw notFound();
            await projectAccess(tx, req.principal, tenant, job.project_id);
            const snapshots = (
              await tx.query(
                "SELECT id FROM connector_snapshots WHERE job_id=$1 AND project_id=$2 ORDER BY id",
                [id, job.project_id],
              )
            ).rows;
            return detail
              ? {
                  ...jobInfo(job),
                  snapshot_ids: snapshots.map((v) => v.id),
                  specification: job.specification,
                }
              : syncDTO(job, snapshots[0]?.id);
          },
          tenant,
          true,
          req.principal.id,
        );
      },
    );
  for (const action of ["cancel", "retry"] as const)
    app.post(
      `/v1/syncs/:id/${action}`,
      { preHandler: requireUser(db) },
      async (req, reply) => {
        const tenant = tenantOf(req),
          id = idOf(req),
          k = key(req);
        z.object({})
          .strict()
          .parse(req.body ?? {});
        return db.tx(
          async (tx) => {
            const old = (
              await tx.query(
                "SELECT * FROM connector_jobs WHERE id=$1 AND tenant_id=$2",
                [id, tenant],
              )
            ).rows[0];
            if (!old) throw notFound();
            const c = await connection(
              tx,
              req.principal,
              tenant,
              old.connection_id,
              "manage",
              true,
            );
            const result = await replay(
              tx,
              req.principal.id,
              `connection.${action}:${id}`,
              k,
              {},
              async () => {
                if (action === "cancel") {
                  await tx.query(
                    "UPDATE connector_jobs SET state='cancelled',finished_at=clock_timestamp(),revision=revision+1,lease_token=NULL,lease_until=NULL,encrypted_cursor=NULL,error_code='CONNECTOR_CANCELLED' WHERE id=$1 AND state IN('queued','running')",
                    [id],
                  );
                  return { id };
                }
                if (!["partial", "failed", "cancelled"].includes(old.state))
                  throw new Problem(
                    409,
                    "CONNECTOR_RETRY_UNAVAILABLE",
                    "Only an unfinished or failed result can be retried",
                  );
                if (c.state !== "connected")
                  throw new Problem(
                    409,
                    "CONNECTOR_NOT_READY",
                    "Reconnect the provider first",
                  );
                if (old.kind === "discover")
                  await tx.query(
                    "UPDATE connector_profiles SET auth_version=auth_version+1,version=version+1,catalog_state='discovering',account_ids='{}',project_ids='{}' WHERE connection_id=$1",
                    [c.id],
                  );
                const current = await connection(
                  tx,
                  req.principal,
                  tenant,
                  c.id,
                  "manage",
                );
                const job =
                  old.kind === "discover"
                    ? await enqueue(
                        tx,
                        current,
                        req.principal,
                        "discover",
                        {
                          provider: publicProvider(c.provider),
                          api_version: c.api_version,
                        },
                        id,
                      )
                    : await createSync(
                        db,
                        tx,
                        c,
                        req.principal,
                        connectorSyncInput.parse(old.specification.dates),
                        id,
                      );
                if (old.kind === "discover")
                  await tx.query(
                    "UPDATE connector_profiles SET catalog_state='discovering' WHERE connection_id=$1",
                    [c.id],
                  );
                await audit(
                  tx,
                  req.principal,
                  `connection.${action}`,
                  id,
                  "succeeded",
                  { new_job: job.id },
                  tenant,
                );
                return { id: job.id };
              },
            );
            if (action === "retry") reply.code(202);
            return {
              ...jobInfo(
                (
                  await tx.query("SELECT * FROM connector_jobs WHERE id=$1", [
                    result.id,
                  ])
                ).rows[0],
              ),
            };
          },
          tenant,
          true,
          req.principal.id,
        );
      },
    );
  for (const snapshotRoute of [
    "/v1/connector-snapshots/:id",
    "/v1/tenants/:tenant/projects/:project/connector-snapshots/:id",
  ])
    app.get(
      snapshotRoute,
      { preHandler: requireUser(db) },
      async (req, reply) => {
        const tenant = tenantOf(req),
          id = idOf(req),
          q = z
            .object({
              offset: z.coerce
                .number()
                .int()
                .min(0)
                .max(connectorLimits.facts)
                .default(0),
              limit: z.coerce.number().int().min(1).max(100).default(25),
              format: z.enum(["json", "csv"]).optional(),
            })
            .strict()
            .parse(req.query);
        const row = await db.tx(
          (tx) => snapshotAccess(tx, req.principal, tenant, id),
          tenant,
          true,
          req.principal.id,
        );
        if (
          (req.params as any).project &&
          (row.project_id !== (req.params as any).project ||
            tenant !== (req.params as any).tenant)
        )
          throw notFound();
        const bytes = await storage.get(row.storage_key);
        if (hash(bytes) !== row.sha256)
          throw new Problem(
            409,
            "CONNECTOR_SNAPSHOT_INTEGRITY",
            "The retained snapshot failed integrity verification",
          );
        const body = snapshotBody.parse(JSON.parse(bytes.toString("utf8")));
        await db.tx(
          (tx) => snapshotAccess(tx, req.principal, tenant, id),
          tenant,
          true,
          req.principal.id,
        );
        if (q.format === "json")
          return reply
            .type("application/json")
            .header(
              "Content-Disposition",
              'attachment; filename="marketing-snapshot.json"',
            )
            .send(bytes);
        if (q.format === "csv") {
          const csv = [
            "account_id,profile,date,dimensions_json,metrics_json,currency,timezone",
            ...body.facts.map((f) =>
              [
                f.account_id,
                f.profile,
                f.date,
                JSON.stringify(f.dimensions),
                JSON.stringify(f.metrics),
                f.currency,
                f.timezone,
              ]
                .map(csvCell)
                .join(","),
            ),
          ].join("\r\n");
          return reply
            .type("text/csv; charset=utf-8")
            .header(
              "Content-Disposition",
              'attachment; filename="marketing-facts.csv"',
            )
            .send("\uFEFF" + csv);
        }
        return {
          id,
          project_id: row.project_id,
          source: row.source,
          state: row.state,
          source_mode: row.data_mode,
          row_count: row.row_count,
          captured_at: row.captured_at.toISOString(),
          data_as_of: null,
          limitations: body.limitations,
          specification: body.specification,
          spec_hash: row.spec_hash,
          dataset_ids: row.dataset_ids,
          asset_id: row.asset_id,
          web_analysis_options: webAnalyticsOptions(body),
          facts: body.facts.slice(q.offset, q.offset + q.limit),
          next_offset:
            q.offset + q.limit < body.facts.length ? q.offset + q.limit : null,
        };
      },
    );
  for (const reportRoute of [
    "/v1/connector-snapshots/:id/web-analysis",
    "/v1/tenants/:tenant/projects/:project/connector-snapshots/:id/web-analysis",
  ]) app.get(reportRoute, { preHandler: requireUser(db) }, async (req, reply) => {
    const tenant = tenantOf(req), id = idOf(req);
    const q = webAnalyticsSelection.extend({
      group_by: z.string().max(100).default("").transform(s => s ? s.split(",") : [])
        .pipe(webAnalyticsSelection.shape.group_by),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      format: z.enum(["page", "json", "csv", "html"]).default("page"),
      locale: z.enum(["zh-HK", "en-HK"]).default("zh-HK"),
    }).strict().parse(req.query);
    const access = async (tx: Tx) => {
      const row = await snapshotAccess(tx, req.principal, tenant, id);
      if ((req.params as any).project && (row.project_id !== (req.params as any).project || tenant !== (req.params as any).tenant)) throw notFound();
      return row;
    };
    const row = await db.tx(access, tenant, true, req.principal.id);
    const body = checkedWebSnapshot(row, await storage.get(row.storage_key));
    const { offset, limit, format, locale, ...selection } = q;
    const report = calculateWebAnalytics(row, body, selection);
    const result = format === "page" ? webAnalyticsPage(report, offset, limit) : renderWebAnalytics(report, format, locale);
    await db.tx(async tx => {
      try { await tx.query("SELECT id FROM assets WHERE id=$1 FOR SHARE NOWAIT", [row.asset_id]); }
      catch (e) { if ((e as any).code === "55P03") throw new Problem(409, "CONNECTOR_SOURCE_CHANGING", "The source is changing; reload its current availability"); throw e; }
      const current = await access(tx);
      if (current.sha256 !== row.sha256 || current.spec_hash !== row.spec_hash || current.state !== row.state)
        throw new Problem(409, "CONNECTOR_SNAPSHOT_INTEGRITY", "The source changed during calculation");
    }, tenant, true, req.principal.id);
    reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
    if (format !== "page") return reply.type(format === "html" ? "text/html; charset=utf-8" : format === "csv" ? "text/csv; charset=utf-8" : "application/json")
      .header("Content-Disposition", `attachment; filename="workmate-web-analysis.${format}"`).send(result);
    return result;
  });
  // Historical arbitrary-account report entry points are deliberately retired.
  const legacy = "/v1/tenants/:tenant/projects/:project/connections";
  app.get(legacy, { preHandler: requireUser(db) }, async (req) => {
    const b = z.object({ tenant: uuid, project: uuid }).parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, b.tenant, b.project);
      return {
        items: (
          await tx.query(
            "SELECT id,provider,name,state,scopes,created_at FROM connections WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC",
            [b.tenant, b.project],
          )
        ).rows,
        providers: Object.entries(connectorProviders).map(([p, v]) => ({
          key: internalProvider(p as ConnectorProvider),
          name: v.name,
          configured: connectorSettings(db.config, p as ConnectorProvider)
            .available,
        })),
      };
    }, b.tenant);
  });
  for (const suffix of ["/authorize", "/:id/report"])
    app.post(legacy + suffix, { preHandler: requireUser(db) }, async (req) => {
      const b = z.object({ tenant: uuid, project: uuid }).parse(req.params);
      await db.tx(
        (tx) => projectAccess(tx, req.principal, b.tenant, b.project, "manage"),
        b.tenant,
      );
      throw new Problem(
        410,
        "CONNECTOR_SCOPED_FLOW_REQUIRED",
        "Use the current authorization, discovered-account selection and persistent synchronization flow",
      );
    });
  app.delete(legacy + "/:id", { preHandler: requireUser(db) }, async (req) => {
    const b = z
      .object({ tenant: uuid, project: uuid, id: uuid })
      .parse(req.params);
    key(req);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, b.tenant, b.project, "manage");
      const c = (
        await tx.query(
          "SELECT * FROM connections WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
          [b.tenant, b.project, b.id],
        )
      ).rows[0];
      if (!c) throw notFound();
      await tx.query(
        "UPDATE connections SET state='revoked',encrypted_secret=NULL WHERE id=$1",
        [b.id],
      );
      await audit(
        tx,
        req.principal,
        "connection.revoke",
        b.id,
        "succeeded",
        {},
        b.tenant,
      );
      return { ok: true };
    }, b.tenant);
  });
}
async function oauthActor(tx: Tx, state: any): Promise<Principal> {
  const s = (
    await tx.query(
      `SELECT s.*,u.email,u.name,u.status,u.auth_version AS current_version FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,
      [state.session_id, state.actor_id],
    )
  ).rows[0];
  if (
    !s ||
    s.status !== "active" ||
    s.auth_version !== state.actor_auth_version ||
    s.current_version !== state.actor_auth_version ||
    !(await validFederation(tx, s))
  )
    throw new Problem(
      401,
      "CONNECTOR_INITIATOR_EXPIRED",
      "The initiating session expired; restart authorization",
    );
  return {
    id: s.user_id,
    email: s.email,
    name: s.name,
    audience: s.audience,
    sessionId: s.id,
    sessionHash: s.token_hash,
    authVersion: s.auth_version,
  };
}

async function guardedJob(db: Database, tx: Tx, id: string, lease: string) {
  const j = (
    await tx.query(
      "SELECT * FROM connector_jobs WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp()",
      [id, lease],
    )
  ).rows[0];
  if (!j)
    throw new Problem(
      409,
      "CONNECTOR_LEASE_LOST",
      "Synchronization ownership changed",
    );
  const u = (await tx.query("SELECT * FROM users WHERE id=$1", [j.actor_id]))
    .rows[0];
  const actor: Principal = {
    id: j.actor_id,
    email: u?.email ?? "",
    name: u?.name ?? "",
    audience: "user",
    sessionId: "",
    sessionHash: "",
    authVersion: j.actor_auth_version,
  };
  const c = await connection(
    tx,
    actor,
    j.tenant_id,
    j.connection_id,
    "manage",
    true,
  );
  const locked = (
    await tx.query(
      "SELECT 1 FROM connector_jobs WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp() FOR UPDATE",
      [id, lease],
    )
  ).rowCount;
  if (!locked)
    throw new Problem(
      409,
      "CONNECTOR_LEASE_LOST",
      "Synchronization ownership changed",
    );
  if (j.expires_at.valueOf() <= Date.now())
    throw new Problem(
      409,
      "CONNECTOR_LIFETIME_EXCEEDED",
      "The synchronization expired",
    );
  if (
    c.state !== "connected" ||
    !c.encrypted_secret ||
    c.auth_version !== j.connection_auth_version ||
    c.version !== j.binding_version ||
    c.data_mode !== mode(db) ||
    j.data_mode !== mode(db) ||
    c.configuration_hash !==
      connectorConfigurationHash(db.config, publicProvider(c.provider)) ||
    hash(canonical(j.specification)) !== j.spec_hash
  )
    throw new Problem(
      409,
      "CONNECTOR_AUTHORITY_CHANGED",
      "Authorization or the frozen scope changed",
    );
  if (j.kind === "sync") {
    if (
      canonical(c.account_ids) !== canonical(j.specification.accounts) ||
      canonical(c.project_ids) !== canonical(j.specification.project_ids)
    )
      throw new Problem(
        409,
        "CONNECTOR_BINDING_CHANGED",
        "The selected account scope changed",
      );
    for (const project of j.specification.project_ids)
      await projectAccess(tx, actor, j.tenant_id, project, "manage");
    await sourceRows(tx, j);
  }
  return { job: j, actor, c };
}
async function publishSnapshot(
  db: Database,
  storage: Storage,
  id: string,
  lease: string,
  partial: boolean,
  reason?: string,
) {
  const frozen = await db.tx(
    async (tx) => {
      const g = await guardedJob(db, tx, id, lease);
      return { ...g, pages: await sourceRows(tx, g.job) };
    },
    undefined,
    true,
  );
  const facts: ConnectorFact[] = [],
    seen = new Set<string>(),
    limits = new Set<string>([
      ...frozen.job.limitations,
      ...(reason ? [reason] : []),
    ]);
  for (const page of frozen.pages) {
    const bytes = await storage.get(page.storage_key);
    if (hash(bytes) !== page.sha256)
      throw new Problem(
        409,
        "CONNECTOR_SOURCE_INTEGRITY",
        "A retained page failed integrity verification",
      );
    const body = JSON.parse(bytes.toString("utf8"));
    for (const value of z
      .array(connectorFact)
      .max(connectorLimits.facts)
      .parse(body.facts)) {
      if (seen.has(value.key)) {
        partial = true;
        limits.add("CONNECTOR_OVERLAPPING_PAGES");
        continue;
      }
      seen.add(value.key);
      facts.push(value);
    }
  }
  const captured = new Date().toISOString(),
    body = snapshotBody.parse({
      schema: "copypaste-connector-snapshot-1",
      source_mode: frozen.job.data_mode,
      spec_hash: frozen.job.spec_hash,
      specification: frozen.job.specification,
      facts,
      limitations: [...limits],
      captured_at: captured,
      data_as_of: null,
    });
  await db.tx(
    async (tx) => {
      const { job, actor, c } = await guardedJob(db, tx, id, lease);
      const pages = await sourceRows(tx, job);
      if (
        canonical(pages.map((p) => [p.ordinal, p.sha256])) !==
        canonical(frozen.pages.map((p) => [p.ordinal, p.sha256]))
      )
        throw new Problem(
          409,
          "CONNECTOR_SOURCE_CHANGED",
          "Source pages changed",
        );
      for (const project of job.specification.project_ids) {
        const asset = await saveAsset(tx, storage, {
          tenant: job.tenant_id,
          project,
          user: actor.id,
          name: `${c.provider}-${job.specification.dates.date_from}-${job.specification.dates.date_to}.json`,
          mime: "application/json",
          kind: "connector_snapshot",
          bytes: Buffer.from(JSON.stringify(body)),
          metadata: {
            connector_job_id: job.id,
            source_mode: job.data_mode,
            spec_hash: job.spec_hash,
            limitations: body.limitations,
            data_as_of: null,
          },
        });
        const datasets: string[] = [];
        if (["google_ads", "meta"].includes(c.provider) && !partial) {
          for (const raw of job.specification.queries) {
            const q = connectorQuery.parse(raw),
              selected = facts.filter(
                (f) =>
                  f.account_id === q.account.account_id &&
                  f.profile === "campaign",
              );
            if (
              !selected.length ||
              !q.account.currency ||
              !q.account.timezone ||
              selected.some((f) =>
                ["spend", "impressions", "clicks"].some(
                  (k) => f.metrics[k] === null,
                ),
              )
            )
              continue;
            const csv = [
              "date,channel,campaign,entity_id,account_id,impressions,clicks,spend,conversions,revenue,currency",
              ...selected.map((f) =>
                [
                  f.date,
                  publicProvider(c.provider),
                  f.dimensions.campaign_name,
                  f.dimensions.campaign_id,
                  f.account_id,
                  f.metrics.impressions,
                  f.metrics.clicks,
                  f.metrics.spend,
                  f.metrics.conversions,
                  f.metrics.revenue,
                  f.currency,
                ]
                  .map(csvCell)
                  .join(","),
              ),
            ].join("\r\n");
            try {
              const normalized = normalizeMetricsCSV(csv, {
                source: publicProvider(c.provider) as "google_ads" | "meta_ads",
                source_filename: `connector-${q.account.account_id}.csv`,
                timezone: q.account.timezone,
                currency: q.account.currency,
                account_id: q.account.account_id,
                entity_level: "campaign",
                attribution_definition:
                  c.provider === "meta"
                    ? "Meta account attribution setting; conversion report time; snapshot " +
                      job.id
                    : "Google Ads account configured attribution; snapshot " +
                      job.id,
                conversion_definition:
                  c.provider === "meta"
                    ? "Exact action_type purchase; missing remains unknown"
                    : "Google Ads metrics.conversions and conversions_value; configured primary conversion actions",
              });
              const csvSource = await saveAsset(tx, storage, {
                tenant: job.tenant_id,
                project,
                user: actor.id,
                name: `connector-${q.account.account_id}.csv`,
                mime: "text/csv",
                kind: "connector_analysis_source",
                bytes: Buffer.from(csv),
                metadata: {
                  connector_job_id: job.id,
                  connector_snapshot_asset_id: asset.id,
                  source_mode: job.data_mode,
                  spec_hash: job.spec_hash,
                  limitations: body.limitations,
                  data_as_of: null,
                },
              });
              await tx.query(
                "INSERT INTO connector_analysis_sources(tenant_id,project_id,snapshot_asset_id,csv_asset_id) VALUES($1,$2,$3,$4)",
                [job.tenant_id, project, asset.id, csvSource.id],
              );
              const dataset = await persistCampaignSnapshot(tx, {
                tenant: job.tenant_id,
                project,
                user: actor.id,
                name: `${connectorProviders[publicProvider(c.provider)].name} · ${q.account.name}`,
                data: normalized,
                rawCsv: csv,
                sourceVersion: csvSource.version.id,
              });
              datasets.push(dataset.id);
            } catch (e) {
              // Never coerce unsupported precision or missing values into a plausible report.
              if (!(e instanceof Problem && e.status === 400)) throw e;
              throw new Problem(
                409,
                "CONNECTOR_ANALYSIS_NORMALIZATION",
                "The provider facts could not be represented by the fixed analysis schema",
              );
            }
          }
        }
        await tx.query(
          `INSERT INTO connector_snapshots(tenant_id,project_id,job_id,source,state,asset_id,asset_version,sha256,row_count,spec_hash,data_mode,limitations,dataset_ids,captured_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            job.tenant_id,
            project,
            job.id,
            publicProvider(c.provider),
            partial ? "partial" : "complete",
            asset.id,
            asset.version.version,
            asset.version.sha256,
            facts.length,
            job.spec_hash,
            job.data_mode,
            body.limitations,
            datasets,
            captured,
          ],
        );
      }
      await tx.query(
        "UPDATE connector_jobs SET state=$2,finished_at=clock_timestamp(),revision=revision+1,lease_token=NULL,lease_until=NULL,encrypted_cursor=NULL,error_code=$3,limitations=$4 WHERE id=$1",
        [
          id,
          partial ? "partial" : "complete",
          reason ?? null,
          body.limitations,
        ],
      );
      await tx.query(
        "UPDATE connector_profiles SET last_sync_at=clock_timestamp() WHERE connection_id=$1",
        [c.id],
      );
      await audit(
        tx,
        actor,
        "connection.sync.finish",
        id,
        "succeeded",
        {
          state: partial ? "partial" : "complete",
          rows: facts.length,
          spec_hash: job.spec_hash,
        },
        job.tenant_id,
      );
    },
    frozen.job.tenant_id,
    true,
    frozen.actor.id,
  );
}
export async function advanceConnectors(
  db: Database,
  storage: Storage,
  options: { signal?: AbortSignal } = {},
) {
  if (options.signal?.aborted) return;
  const lease = randomUUID();
  const claimed = await db.tx(
    async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('connector-read-capacity',0))",
      );
      const count = Number(
        (
          await tx.query(
            "SELECT count(*) FROM connector_jobs WHERE state='running' AND lease_until>clock_timestamp()",
          )
        ).rows[0].count,
      );
      if (count >= 2) return null;
      const j = (
        await tx.query(
          `SELECT j.* FROM connector_jobs j WHERE j.state IN('queued','running') AND j.next_attempt_at<=clock_timestamp()
      AND (j.lease_until IS NULL OR j.lease_until<clock_timestamp()) AND j.data_mode=$1
      AND NOT EXISTS(SELECT 1 FROM connector_jobs running WHERE running.tenant_id=j.tenant_id AND running.state='running' AND running.lease_until>clock_timestamp())
      ORDER BY j.next_attempt_at,j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
          [mode(db)],
        )
      ).rows[0];
      if (!j) return null;
      return (
        await tx.query(
          "UPDATE connector_jobs SET state='running',started_at=coalesce(started_at,clock_timestamp()),lease_token=$2,lease_until=clock_timestamp()+interval '90 seconds',revision=revision+1 WHERE id=$1 RETURNING *",
          [j.id, lease],
        )
      ).rows[0];
    },
    undefined,
    true,
  );
  if (!claimed) return;
  try {
    let g = await db.tx(
      (tx) => guardedJob(db, tx, claimed.id, lease),
      claimed.tenant_id,
      true,
    );
    const provider = publicProvider(g.c.provider);
    let credential = connectorCredential.parse(
      JSON.parse(unseal(db.config.MASTER_KEY!, g.c.encrypted_secret)),
    );
    const fresh = await refreshConnectorCredential(
      db.config,
      provider,
      credential,
      options.signal,
    );
    if (fresh !== credential) {
      await db.tx(
        async (tx) => {
          const current = await guardedJob(db, tx, claimed.id, lease);
          await tx.query(
            "UPDATE connections SET encrypted_secret=$2 WHERE id=$1",
            [current.c.id, seal(db.config.MASTER_KEY!, JSON.stringify(fresh))],
          );
        },
        claimed.tenant_id,
        true,
      );
      credential = fresh;
    }
    g = await db.tx(
      (tx) => guardedJob(db, tx, claimed.id, lease),
      claimed.tenant_id,
      true,
    );
    const cursor = g.job.encrypted_cursor
      ? JSON.parse(unseal(db.config.MASTER_KEY!, g.job.encrypted_cursor))
      : null;
    if (claimed.kind === "discover") {
      const page = await discoverConnectorPage(
        db.config,
        provider,
        credential,
        cursor ? discoveryCursor.parse(cursor) : null,
        options.signal,
      );
      await db.tx(
        async (tx) => {
          const { job, c } = await guardedJob(db, tx, claimed.id, lease);
          const cursorHash = page.next ? hash(canonical(page.next)) : null;
          const count = Number(
            (
              await tx.query(
                "SELECT count(*) FROM connector_accounts WHERE connection_id=$1 AND auth_version=$2",
                [c.id, c.auth_version],
              )
            ).rows[0].count,
          );
          let limited =
            count + page.accounts.filter((a) => a.readable).length >
              connectorLimits.catalogAccounts ||
            job.page_count + 1 >= connectorLimits.pages ||
            (!!cursorHash && job.cursor_hashes.includes(cursorHash));
          for (const account of page.accounts.slice(
            0,
            Math.max(0, connectorLimits.catalogAccounts - count),
          ))
            await tx.query(
              "INSERT INTO connector_accounts(connection_id,tenant_id,auth_version,account_id,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
              [
                c.id,
                job.tenant_id,
                c.auth_version,
                account.account_id,
                JSON.stringify(account),
              ],
            );
          if (limited && !page.next)
            limited =
              count + page.accounts.length > connectorLimits.catalogAccounts;
          const limits = [
            ...new Set([
              ...job.limitations,
              ...page.limitations,
              ...(limited ? ["CONNECTOR_CATALOG_INCOMPLETE"] : []),
            ]),
          ];
          const done = !page.next || limited;
          await tx.query(
            "UPDATE connector_jobs SET state=$2,page_count=page_count+1,revision=revision+1,encrypted_cursor=$3,cursor_hashes=$4,lease_token=NULL,lease_until=NULL,finished_at=CASE WHEN $5 THEN clock_timestamp() END,attempts=0,limitations=$6 WHERE id=$1",
            [
              job.id,
              done ? (limited ? "partial" : "complete") : "queued",
              !done
                ? seal(db.config.MASTER_KEY!, JSON.stringify(page.next))
                : null,
              cursorHash
                ? [...job.cursor_hashes, cursorHash]
                : job.cursor_hashes,
              done,
              limits,
            ],
          );
          if (done)
            await tx.query(
              "UPDATE connector_profiles SET catalog_state=$2,catalog_limits=$3 WHERE connection_id=$1",
              [c.id, limited ? "partial" : "complete", limits],
            );
        },
        claimed.tenant_id,
        true,
      );
      return;
    }
    const queries = z
      .array(connectorQuery)
      .min(1)
      .max(40)
      .parse(g.job.specification.queries);
    if (g.job.segment >= queries.length) {
      await publishSnapshot(db, storage, claimed.id, lease, false);
      return;
    }
    const q = queries[g.job.segment],
      page = await readConnectorPage(
        db.config,
        q,
        credential,
        cursor ? pageCursor.parse(cursor) : null,
        options.signal,
      );
    const result = await db.tx(
      async (tx) => {
        const { job, actor } = await guardedJob(db, tx, claimed.id, lease);
        if (job.ordinal !== g.job.ordinal || job.segment !== g.job.segment)
          throw new Problem(
            409,
            "CONNECTOR_LEASE_LOST",
            "Synchronization changed",
          );
        const nextHash = page.next
          ? hash(canonical({ segment: job.segment, cursor: page.next }))
          : null;
        const over =
          job.page_count + 1 > connectorLimits.pages ||
          job.row_count + page.facts.length > connectorLimits.facts ||
          Number(job.raw_bytes) + page.raw_bytes > connectorLimits.rawBytes;
        if (over)
          return {
            finish: true,
            partial: true,
            reason: "CONNECTOR_RESOURCE_LIMIT",
          };
        const asset = await saveAsset(tx, storage, {
          tenant: job.tenant_id,
          project: job.project_id,
          user: actor.id,
          name: `connector-page-${job.ordinal + 1}.json`,
          mime: "application/json",
          kind: "connector_source_page",
          bytes: Buffer.from(
            JSON.stringify({
              schema: "copypaste-connector-page-1",
              facts: page.facts,
              raw: page.raw,
              query: q,
              provider_sha256: page.raw_sha256,
            }),
          ),
          metadata: {
            connector_job_id: job.id,
            ordinal: job.ordinal,
            source_mode: job.data_mode,
            query_hash: hash(canonical(q)),
            data_as_of: null,
          },
        });
        await tx.query(
          "INSERT INTO connector_pages(job_id,tenant_id,ordinal,segment,asset_id,asset_version,sha256,provider_sha256,row_count,query_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            job.id,
            job.tenant_id,
            job.ordinal,
            job.segment,
            asset.id,
            asset.version.version,
            asset.version.sha256,
            page.raw_sha256,
            page.facts.length,
            hash(canonical(q)),
          ],
        );
        const loop = !!nextHash && job.cursor_hashes.includes(nextHash);
        const segment = page.next ? job.segment : job.segment + 1;
        const finish =
          segment >= queries.length ||
          loop ||
          (job.page_count + 1 >= connectorLimits.pages &&
            (page.next || segment < queries.length));
        const limits = [...new Set([...job.limitations, ...page.limitations])];
        await tx.query(
          "UPDATE connector_jobs SET segment=$2,ordinal=ordinal+1,page_count=page_count+1,row_count=row_count+$3,raw_bytes=raw_bytes+$4,attempts=0,encrypted_cursor=$5,cursor_hashes=$6,limitations=$7,revision=revision+1,state=$8,lease_token=CASE WHEN $9 THEN lease_token END,lease_until=CASE WHEN $9 THEN lease_until END WHERE id=$1",
          [
            job.id,
            segment,
            page.facts.length,
            page.raw_bytes,
            page.next
              ? seal(db.config.MASTER_KEY!, JSON.stringify(page.next))
              : null,
            nextHash ? [...job.cursor_hashes, nextHash] : job.cursor_hashes,
            limits,
            finish ? "running" : "queued",
            finish,
          ],
        );
        return {
          finish,
          partial: loop || segment < queries.length,
          reason: loop
            ? "CONNECTOR_CURSOR_LOOP"
            : segment < queries.length && finish
              ? "CONNECTOR_RESOURCE_LIMIT"
              : undefined,
        };
      },
      claimed.tenant_id,
      true,
    );
    if (result.finish)
      await publishSnapshot(
        db,
        storage,
        claimed.id,
        lease,
        result.partial,
        result.reason,
      );
  } catch (e) {
    if (options.signal?.aborted) {
      await db.control.query(
        "UPDATE connector_jobs SET state='queued',lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE id=$1 AND lease_token=$2 AND state='running'",
        [claimed.id, lease],
      );
      return;
    }
    const code = e instanceof Problem ? e.code : "CONNECTOR_PROCESSING_FAILED";
    const transient = e instanceof ConnectorFailure && e.kind === "retry";
    const current = (
      await db.control.query(
        "SELECT * FROM connector_jobs WHERE id=$1 AND lease_token=$2 AND state='running'",
        [claimed.id, lease],
      )
    ).rows[0];
    if (!current) return;
    if (
      transient &&
      current.attempts + 1 < connectorLimits.attemptsPerPage &&
      current.expires_at.valueOf() > Date.now()
    ) {
      const delay = Math.max(
        (e as ConnectorFailure).retryAfterMs,
        Math.min(300000, 1000 * 2 ** current.attempts),
      );
      await db.control.query(
        "UPDATE connector_jobs SET state='queued',attempts=attempts+1,next_attempt_at=clock_timestamp()+make_interval(secs=>$3),lease_token=NULL,lease_until=NULL,revision=revision+1,error_code=$4 WHERE id=$1 AND lease_token=$2",
        [claimed.id, lease, delay / 1000, code],
      );
      return;
    }
    if (e instanceof ConnectorFailure && e.kind === "reauth")
      await db.control.query(
        "UPDATE connections SET state='error',encrypted_secret=NULL WHERE id=$1 AND state='connected'",
        [claimed.connection_id],
      );
    // Preserve source pages as an explicitly partial immutable result on ordinary provider failures.
    if (
      claimed.kind === "sync" &&
      current.page_count > 0 &&
      e instanceof ConnectorFailure &&
      e.kind !== "reauth"
    ) {
      try {
        await publishSnapshot(db, storage, claimed.id, lease, true, code);
        return;
      } catch {
        /* Lost authority never publishes. */
      }
    }
    await db.tx(
      async (tx) => {
        await tx.query(
          "UPDATE connector_jobs SET state='failed',finished_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,encrypted_cursor=NULL,revision=revision+1,error_code=$3 WHERE id=$1 AND lease_token=$2",
          [claimed.id, lease, code],
        );
        if (claimed.kind === "discover")
          await tx.query(
            "UPDATE connector_profiles SET catalog_state='failed',catalog_limits=$2 WHERE connection_id=$1 AND auth_version=$3",
            [claimed.connection_id, [code], claimed.connection_auth_version],
          );
      },
      claimed.tenant_id,
      true,
    );
  }
}
