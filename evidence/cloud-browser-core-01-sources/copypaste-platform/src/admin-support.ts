import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, requireUser, type Principal } from "./auth.js";
import { key, replay, tenantAccess } from "./access.js";
import { lockAdminAccess, requireSensitiveAdmin } from "./admin-access.js";
import { lockUserAuthorities, currentUserAuthority } from "./user-authority.js";
import { lockMemberships } from "./membership.js";
import { adminOperationDTO } from "./admin-memberships.js";
import { pinAdminPolicy } from "./admin-operation-policy.js";
import { canonical, equal, hash, hmac, Problem, uuid } from "./lib.js";

const projects = z
  .array(uuid)
  .max(100)
  .refine((v) => new Set(v).size === v.length, "Select each project once")
  .transform((v) => [...v].sort());
const grantInput = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    project_ids: projects,
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();
const createInput = z
  .object({
    user_id: uuid,
    tenant_id: uuid,
    project_ids: projects,
    support_grant_id: uuid.optional(),
    mode: z.literal("read_only"),
    expires_at: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
const pageInput = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const reasonInput = z
  .object({ reason: z.string().trim().min(3).max(1000) })
  .strict();
const selectSession = `SELECT s.*,c.actor_session_id,c.target_user_id,c.target_auth_version,c.target_membership_version,c.project_ids,c.support_grant_id,c.data_mode,c.created_at,
 to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
 FROM support_sessions s JOIN support_session_contexts c ON c.id=s.id`;
type Bound = {
  permissions: string[];
  effect: string;
  scope_kind: string;
  scope_id: string | null;
  limits: any;
  expires_at: Date | null;
  id: string;
};
const modeOf = (db: Database) =>
  db.config.DEMO_MODE ? "simulated" : "configured_services";
const unavailable = () =>
  new Problem(
    404,
    "SUPPORT_UNAVAILABLE",
    "The support session or its current authorization is unavailable",
  );
const iso = (v: string | Date) => new Date(v).toISOString();

/** An explicit support context is usable only by its own read-only endpoint.
 * It never changes req.principal or selects the customer's login credential. */
export function assertSupportContext(req: FastifyRequest) {
  const header = req.headers["x-copypaste-support-session"];
  if (header === undefined) return;
  const match =
    /^\/v1\/admin\/support\/sessions\/([a-f0-9-]{36})\/view(?:\/tasks\/[a-f0-9-]{36})?(?:\?.*)?$/i.exec(
      req.url,
    );
  if (
    typeof header !== "string" ||
    req.method !== "GET" ||
    !match ||
    match[1].toLowerCase() !== header.toLowerCase()
  )
    throw new Problem(
      403,
      "SUPPORT_READ_ONLY",
      "A support context allows only its own read-only view",
    );
}

async function liveAdmin(tx: Tx, actor: Principal): Promise<Bound[]> {
  await requireSensitiveAdmin(tx, actor);
  // Recheck wall clock after locks. Transaction-start now() must not extend MFA,
  // session or delegated permission deadlines while a request was waiting.
  const session = await tx.query(
    `SELECT 1 FROM sessions s JOIN admin_principals a ON a.id=s.admin_id WHERE s.id=$1 AND a.id=$2 AND s.audience='admin' AND s.auth_version=$3 AND a.auth_version=$3 AND a.status='active' AND a.enrollment_state='enrolled' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.mfa_at>clock_timestamp()-interval '10 minutes'`,
    [actor.sessionId, actor.id, actor.authVersion],
  );
  if (!session.rowCount)
    throw new Problem(
      403,
      "MFA_REQUIRED",
      "Sign in again with administrator MFA",
    );
  return (
    await tx.query(
      `SELECT b.*,r.permissions FROM admin_bindings b JOIN admin_roles r ON r.key=b.role_key WHERE b.principal_id=$1 AND (b.expires_at IS NULL OR b.expires_at>clock_timestamp()) ORDER BY b.id`,
      [actor.id],
    )
  ).rows;
}
function allowed(
  bs: Bound[],
  permission: string,
  tenant: string,
  project?: string,
  hours?: number,
) {
  const matching = bs.filter(
    (b) =>
      b.permissions.includes(permission) &&
      (b.scope_kind === "global" ||
        (b.scope_kind === "tenant" && b.scope_id === tenant) ||
        (b.scope_kind === "project" && b.scope_id === project)),
  );
  return (
    !matching.some((b) => b.effect === "deny") &&
    matching.some(
      (b) =>
        b.effect === "allow" &&
        (hours === undefined ||
          b.limits.max_duration_hours === undefined ||
          hours <= b.limits.max_duration_hours),
    )
  );
}
function authority(
  bs: Bound[],
  permission: string,
  tenant: string,
  ids: string[],
  hours?: number,
) {
  if (
    !(ids.length
      ? ids.every((id) => allowed(bs, permission, tenant, id, hours))
      : allowed(bs, permission, tenant, undefined, hours))
  )
    throw new Problem(
      403,
      "ADMIN_FORBIDDEN",
      "The complete selected support scope must fit your current permissions",
    );
}
function baseAuthority(
  bs: Bound[],
  permission: string,
  row: any,
  hours?: number,
) {
  for (const p of [permission, "admin.users.read", "admin.tenants.read"])
    authority(bs, p, row.tenant_id, row.project_ids, hours);
}
async function expiry(tx: Tx, value: string) {
  const row = (
    await tx.query(
      "SELECT $1::timestamptz>clock_timestamp() AND $1::timestamptz<=clock_timestamp()+interval '1 hour' AS valid,extract(epoch FROM ($1::timestamptz-clock_timestamp()))/3600 AS hours",
      [value],
    )
  ).rows[0];
  if (!row.valid)
    throw new Problem(
      400,
      "SUPPORT_EXPIRY_INVALID",
      "Select an expiry in the next hour",
    );
  return Number(row.hours);
}
async function target(
  tx: Tx,
  db: Database,
  tenant: string,
  user: string,
  ids: string[],
  frozen?: any,
) {
  const row = (
    await tx.query(
      `SELECT u.id,u.name,u.auth_version,m.version,m.role,t.name AS tenant_name FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE u.id=$1 AND t.id=$2 AND t.data_mode=$3 AND support_target_current(t.id,u.id,u.auth_version,m.version,$4::uuid[])`,
      [user, tenant, modeOf(db), ids],
    )
  ).rows[0];
  if (
    !row ||
    (frozen &&
      (frozen.target_auth_version !== row.auth_version ||
        frozen.target_membership_version !== row.version))
  )
    throw unavailable();
  if (ids.length)
    await tx.query(
      "SELECT id FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
      [ids],
    );
  return row;
}
async function grantRow(tx: Tx, id: string) {
  return (
    await tx.query(
      "SELECT *,support_grant_current(id) AS current,clock_timestamp() AS checked_at FROM support_grants WHERE id=$1",
      [id],
    )
  ).rows[0];
}
function grantDTO(row: any) {
  return {
    id: row.id,
    expires_at: iso(row.expires_at),
    state:
      row.revoked_at ||
      (!row.current && new Date(row.expires_at) > new Date(row.checked_at))
        ? "revoked"
        : new Date(row.expires_at) <= new Date(row.checked_at)
          ? "expired"
          : "active",
  };
}
async function currentSession(tx: Tx, row: any) {
  const checked = (
    await tx.query(
      `SELECT clock_timestamp() AS at, support_target_current($1,$2,$3,$4,$5::uuid[]) AS target_current, CASE WHEN $6::uuid IS NULL THEN true ELSE support_grant_current($6::uuid) END AS grant_current, EXISTS(SELECT 1 FROM sessions ss JOIN admin_principals a ON a.id=ss.admin_id WHERE ss.id=$7 AND a.id=$8 AND ss.audience='admin' AND ss.auth_version=a.auth_version AND a.status='active' AND a.enrollment_state='enrolled' AND ss.revoked_at IS NULL AND ss.expires_at>clock_timestamp() AND ss.mfa_at>clock_timestamp()-interval '10 minutes') AS actor_current`,
      [
        row.tenant_id,
        row.target_user_id,
        row.target_auth_version,
        row.target_membership_version,
        row.project_ids,
        row.support_grant_id,
        row.actor_session_id,
        row.principal_id,
      ],
    )
  ).rows[0];
  const state = row.revoked_at
    ? "revoked"
    : new Date(row.expires_at) <= new Date(checked.at)
      ? "expired"
      : !checked.target_current ||
          !checked.grant_current ||
          !checked.actor_current
        ? "revoked"
        : "active";
  return {
    at: iso(checked.at),
    dto: {
      id: row.id,
      actor_id: row.principal_id,
      user_id: row.target_user_id,
      tenant_id: row.tenant_id,
      mode: "read_only",
      state,
      expires_at: iso(row.expires_at),
    },
  };
}

// Signed keyset cursors retain PostgreSQL microseconds, and are bound to the
// actual session, current role bindings, workspace, mode and filter/limit.
async function bounds(tx: Tx, db: Database, context: unknown, cursor?: string) {
  const fingerprint = hash(canonical(context));
  if (cursor) {
    try {
      const [raw, sig, extra] = cursor.split(".");
      if (
        !raw ||
        !sig ||
        extra ||
        !equal(sig, hmac(db.config.MASTER_KEY!, "support:" + raw))
      )
        throw Error();
      const value = z
        .object({
          context: z.string(),
          asof: z.string().datetime(),
          at: z.string().datetime(),
          id: uuid,
          expires: z.number().int(),
        })
        .strict()
        .parse(JSON.parse(Buffer.from(raw, "base64url").toString()));
      if (value.context !== fingerprint || value.expires <= Date.now())
        throw Error();
      return value;
    } catch {
      throw new Problem(
        400,
        "CURSOR_INVALID",
        "Restart pagination after a session, scope or filter change",
      );
    }
  }
  const now = (
    await tx.query(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
    )
  ).rows[0].at;
  return {
    context: fingerprint,
    asof: now,
    at: null as string | null,
    id: null as string | null,
    expires: Date.now() + 15 * 60_000,
  };
}
function cursor(
  db: Database,
  page: Awaited<ReturnType<typeof bounds>>,
  row: any,
) {
  const raw = Buffer.from(
    canonical({ ...page, at: row.cursor_at, id: row.id }),
  ).toString("base64url");
  return raw + "." + hmac(db.config.MASTER_KEY!, "support:" + raw);
}
function visibleSQL(bs: Bound[], values: unknown[]) {
  const arg = (v: unknown) => {
    values.push(v);
    return "$" + values.length;
  };
  return ["admin.support.read", "admin.users.read", "admin.tenants.read"]
    .map((permission) => {
      const subset = bs.filter((b) => b.permissions.includes(permission));
      const ids = (effect: string, kind: string) =>
        subset
          .filter((b) => b.effect === effect && b.scope_kind === kind)
          .map((b) => b.scope_id);
      const global = arg(
          !subset.some((b) => b.effect === "deny" && b.scope_kind === "global"),
        ),
        allowGlobal = arg(
          subset.some((b) => b.effect === "allow" && b.scope_kind === "global"),
        ),
        allowTenant = arg(ids("allow", "tenant")),
        allowProject = arg(ids("allow", "project")),
        denyTenant = arg(ids("deny", "tenant")),
        denyProject = arg(ids("deny", "project"));
      return `(${global}::boolean AND NOT s.tenant_id=ANY(${denyTenant}::uuid[]) AND NOT c.project_ids&&${denyProject}::uuid[] AND ((${allowGlobal}::boolean OR s.tenant_id=ANY(${allowTenant}::uuid[])) OR (cardinality(c.project_ids)>0 AND c.project_ids<@${allowProject}::uuid[])))`;
    })
    .join(" AND ");
}

export const isSupportOperation = (op: any) =>
  ["support.sessions.create", "support.sessions.revoke"].includes(op.action);
export async function supportOperationAuthority(
  tx: Tx,
  actor: Principal,
  op: any,
  permission: string,
) {
  const row = (
    await tx.query(selectSession + " WHERE s.id=$1", [
      op.result?.support_session_id,
    ])
  ).rows[0];
  if (!row) throw unavailable();
  baseAuthority(await liveAdmin(tx, actor), permission, row);
}
async function operation(
  tx: Tx,
  p: Principal,
  action: string,
  row: any,
  input: unknown,
  k: string,
) {
  const policy = await pinAdminPolicy(tx, {
    action,
    version: 1,
    mode: "read_only",
    max_duration_minutes: 60,
    body_permission: "admin.content.body.read",
    private_body: false,
    current_scope_required: true,
    recent_mfa_minutes: 10,
  });
  return (
    await tx.query(
      `INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids,result_ids,result) VALUES($1,$2,$3,$4,$5,$6,'succeeded',$7,$8,$9,$10) RETURNING *`,
      [
        p.id,
        action,
        row.tenant_id,
        hash(canonical(input)),
        {
          command: input,
          actor_session_id: p.sessionId,
          project_ids: row.project_ids,
        },
        "support:" + k,
        policy,
        [row.target_user_id, row.tenant_id, row.id],
        [row.id],
        { support_session_id: row.id },
      ],
    )
  ).rows[0];
}

async function lockedSession(
  tx: Tx,
  db: Database,
  actor: Principal,
  id: string,
  permission: string,
  ownView = false,
) {
  let row = (
    await tx.query(selectSession + " WHERE s.id=$1 AND c.data_mode=$2", [
      id,
      modeOf(db),
    ])
  ).rows[0];
  if (!row) throw unavailable();
  const issuer = row.support_grant_id
    ? (
        await tx.query("SELECT granted_by FROM support_grants WHERE id=$1", [
          row.support_grant_id,
        ])
      ).rows[0]?.granted_by
    : null;
  await lockUserAuthorities(tx, [
    row.target_user_id,
    ...(issuer ? [issuer] : []),
  ]);
  await lockMemberships(tx, row.tenant_id);
  if (row.support_grant_id)
    await tx.query("SELECT id FROM support_grants WHERE id=$1 FOR SHARE", [
      row.support_grant_id,
    ]);
  row = (await tx.query(selectSession + " WHERE s.id=$1 FOR UPDATE OF s", [id]))
    .rows[0];
  baseAuthority(await liveAdmin(tx, actor), permission, row);
  if (
    ownView &&
    (row.principal_id !== actor.id || row.actor_session_id !== actor.sessionId)
  )
    throw unavailable();
  if (ownView) {
    await target(
      tx,
      db,
      row.tenant_id,
      row.target_user_id,
      row.project_ids,
      row,
    );
    if ((await currentSession(tx, row)).dto.state !== "active")
      throw new Problem(
        410,
        "SUPPORT_ENDED",
        "Support access expired, was revoked or no longer matches current authority",
      );
  }
  return row;
}
function taskDTO(row: any) {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.private_owner ? null : row.title,
    state: row.status,
    private: !!row.private_owner,
    error_code:
      typeof row.error_code === "string" &&
      /^[A-Z][A-Z0-9_]{0,79}$/.test(row.error_code)
        ? row.error_code
        : null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export function registerSupport(app: FastifyInstance, db: Database) {
  app.get(
    "/v1/support-grants",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = uuid.parse(req.headers["x-tenant-id"]),
        q = pageInput.parse(req.query);
      return db.tx(
        async (tx) => {
          await lockUserAuthorities(tx, [req.principal.id]);
          await lockMemberships(tx, tenant);
          const user = await currentUserAuthority(tx, req.principal),
            member = await tenantAccess(tx, req.principal, tenant, "manage");
          await target(tx, db, tenant, user.id, []);
          const page = await bounds(
            tx,
            db,
            {
              kind: "grants",
              user: user.id,
              session: req.principal.sessionId,
              version: user.auth_version,
              member: member.version,
              tenant,
              mode: modeOf(db),
              limit: q.limit,
            },
            q.cursor,
          );
          const rows = (
            await tx.query(
              `SELECT *,support_grant_current(id) AS current,clock_timestamp() AS checked_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM support_grants WHERE tenant_id=$1 AND data_mode=$2 AND created_at<=$3 AND ($4::timestamptz IS NULL OR (created_at,id)<($4,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT $6`,
              [tenant, modeOf(db), page.asof, page.at, page.id, q.limit + 1],
            )
          ).rows;
          return {
            items: rows.slice(0, q.limit).map((r) => ({
              ...grantDTO(r),
              project_ids: r.project_ids,
              granted_by: r.granted_by,
              reason: r.reason,
              created_at: iso(r.created_at),
            })),
            next_cursor:
              rows.length > q.limit
                ? cursor(db, page, rows[q.limit - 1])
                : null,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/support-grants",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = uuid.parse(req.headers["x-tenant-id"]),
        input = grantInput.parse(req.body),
        k = key(req);
      const result = await db.tx(
        async (tx) => {
          await lockUserAuthorities(tx, [req.principal.id]);
          await lockMemberships(tx, tenant);
          const user = await currentUserAuthority(tx, req.principal),
            member = await tenantAccess(tx, req.principal, tenant, "manage");
          await target(tx, db, tenant, user.id, input.project_ids);
          const saved = await replay(
            tx,
            user.id,
            "support.grants.create:" + tenant,
            k,
            input,
            async () => {
              await expiry(tx, input.expires_at);
              const row = (
                await tx.query(
                  `INSERT INTO support_grants(tenant_id,granted_by,issuer_auth_version,issuer_membership_version,project_ids,reason,expires_at,data_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
                  [
                    tenant,
                    user.id,
                    user.auth_version,
                    member.version,
                    input.project_ids,
                    input.reason,
                    input.expires_at,
                    modeOf(db),
                  ],
                )
              ).rows[0];
              await audit(
                tx,
                req.principal,
                "support.grants.create",
                row.id,
                "succeeded",
                {
                  project_ids: input.project_ids,
                  expires_at: input.expires_at,
                  reason: input.reason,
                },
                tenant,
              );
              return { id: row.id };
            },
          );
          return grantDTO(await grantRow(tx, saved.id));
        },
        undefined,
        true,
      );
      return reply.code(201).send(result);
    },
  );
  app.post(
    "/v1/support-grants/:id/revoke",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const tenant = uuid.parse(req.headers["x-tenant-id"]),
        id = uuid.parse((req.params as any).id),
        input = z
          .object({ reason: z.string().trim().min(1).max(1000) })
          .strict()
          .parse(req.body),
        k = key(req);
      const result = await db.tx(
        async (tx) => {
          await lockUserAuthorities(tx, [req.principal.id]);
          await lockMemberships(tx, tenant);
          await currentUserAuthority(tx, req.principal);
          await tenantAccess(tx, req.principal, tenant, "manage");
          await target(tx, db, tenant, req.principal.id, []);
          const row = await grantRow(tx, id);
          if (!row || row.tenant_id !== tenant || row.data_mode !== modeOf(db))
            throw unavailable();
          await replay(
            tx,
            req.principal.id,
            "support.grants.revoke:" + id,
            k,
            input,
            async () => {
              await tx.query(
                "UPDATE support_grants SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL",
                [id],
              );
              await audit(
                tx,
                req.principal,
                "support.grants.revoke",
                id,
                "succeeded",
                input,
                tenant,
              );
              return { id };
            },
          );
          return grantDTO(await grantRow(tx, id));
        },
        undefined,
        true,
      );
      return reply.code(201).send(result);
    },
  );
  app.get(
    "/v1/admin/support/sessions",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const q = pageInput.parse(req.query);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const bs = await liveAdmin(tx, req.principal);
          if (
            !bs.some(
              (b) =>
                b.effect === "allow" &&
                b.permissions.includes("admin.support.read"),
            )
          )
            throw new Problem(
              403,
              "ADMIN_FORBIDDEN",
              "Support access is required",
            );
          const page = await bounds(
            tx,
            db,
            {
              kind: "sessions",
              actor: req.principal.id,
              session: req.principal.sessionId,
              version: req.principal.authVersion,
              mode: modeOf(db),
              bs: bs.map((b) => ({
                ...b,
                expires_at: b.expires_at ? iso(b.expires_at) : null,
              })),
              limit: q.limit,
            },
            q.cursor,
          );
          const values: unknown[] = [
            modeOf(db),
            page.asof,
            page.at,
            page.id,
            q.limit + 1,
          ];
          const scope = visibleSQL(bs, values);
          const rows = (
            await tx.query(
              selectSession +
                ` JOIN tenants w ON w.id=s.tenant_id WHERE c.data_mode=$1 AND w.data_mode=$1 AND c.created_at<=$2 AND ($3::timestamptz IS NULL OR (c.created_at,s.id)<($3,$4::uuid)) AND ${scope} ORDER BY c.created_at DESC,s.id DESC LIMIT $5`,
              values,
            )
          ).rows;
          const items = [];
          for (const row of rows.slice(0, q.limit))
            items.push((await currentSession(tx, row)).dto);
          await audit(
            tx,
            req.principal,
            "admin.support.list",
            undefined,
            "succeeded",
            { returned: items.length },
          );
          return {
            items,
            next_cursor:
              rows.length > q.limit
                ? cursor(db, page, rows[q.limit - 1])
                : null,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/support/sessions",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      const input = createInput.parse(req.body),
        k = key(req);
      const result = await db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const grant = input.support_grant_id
            ? await grantRow(tx, input.support_grant_id)
            : null;
          await lockUserAuthorities(tx, [
            input.user_id,
            ...(grant ? [grant.granted_by] : []),
          ]);
          await lockMemberships(tx, input.tenant_id);
          const bs = await liveAdmin(tx, req.principal);
          baseAuthority(bs, "admin.support.start", input);
          const user = await target(
            tx,
            db,
            input.tenant_id,
            input.user_id,
            input.project_ids,
          );
          const saved = await replay(
            tx,
            req.principal.id,
            "support.sessions.create",
            k,
            input,
            async () => {
              const hours = await expiry(tx, input.expires_at);
              baseAuthority(bs, "admin.support.start", input, hours);
              if (input.support_grant_id) {
                await tx.query(
                  "SELECT id FROM support_grants WHERE id=$1 FOR SHARE",
                  [input.support_grant_id],
                );
                const live = await grantRow(tx, input.support_grant_id);
                if (
                  !live?.current ||
                  live.tenant_id !== input.tenant_id ||
                  live.data_mode !== modeOf(db) ||
                  input.project_ids.some(
                    (id) => !live.project_ids.includes(id),
                  ) ||
                  new Date(input.expires_at) > new Date(live.expires_at)
                )
                  throw unavailable();
              }
              const row = (
                await tx.query(
                  "INSERT INTO support_sessions(principal_id,tenant_id,reason,expires_at) VALUES($1,$2,$3,$4) RETURNING *",
                  [
                    req.principal.id,
                    input.tenant_id,
                    input.reason,
                    input.expires_at,
                  ],
                )
              ).rows[0];
              await tx.query(
                `INSERT INTO support_session_contexts(id,actor_session_id,target_user_id,target_auth_version,target_membership_version,project_ids,support_grant_id,data_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
                [
                  row.id,
                  req.principal.sessionId,
                  input.user_id,
                  user.auth_version,
                  user.version,
                  input.project_ids,
                  input.support_grant_id ?? null,
                  modeOf(db),
                ],
              );
              const op = await operation(
                tx,
                req.principal,
                "support.sessions.create",
                {
                  ...row,
                  target_user_id: input.user_id,
                  project_ids: input.project_ids,
                },
                input,
                k,
              );
              await audit(
                tx,
                req.principal,
                "admin.support.start",
                row.id,
                "succeeded",
                {
                  operation_id: op.id,
                  user_id: input.user_id,
                  project_ids: input.project_ids,
                  reason: input.reason,
                  expires_at: input.expires_at,
                  read_only: true,
                },
                input.tenant_id,
              );
              return { id: op.id };
            },
          );
          const op = (
            await tx.query("SELECT * FROM admin_operations WHERE id=$1", [
              saved.id,
            ])
          ).rows[0];
          // A retry belongs to the creating browser session; it cannot reattach a
          // previous session after reauthentication or create a second context.
          if (op.payload.actor_session_id !== req.principal.sessionId)
            throw unavailable();
          return adminOperationDTO(op);
        },
        undefined,
        true,
      );
      return reply.code(202).send(result);
    },
  );
  app.post(
    "/v1/admin/support/sessions/:id/revocations",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      const id = uuid.parse((req.params as any).id),
        input = reasonInput.parse(req.body),
        k = key(req);
      const result = await db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const row = await lockedSession(
            tx,
            db,
            req.principal,
            id,
            "admin.support.revoke",
          );
          const saved = await replay(
            tx,
            req.principal.id,
            "support.sessions.revoke:" + id,
            k,
            input,
            async () => {
              await tx.query(
                "UPDATE support_sessions SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL",
                [id],
              );
              const op = await operation(
                tx,
                req.principal,
                "support.sessions.revoke",
                row,
                input,
                k,
              );
              await audit(
                tx,
                req.principal,
                "admin.support.revoke",
                id,
                "succeeded",
                { operation_id: op.id, reason: input.reason },
                row.tenant_id,
              );
              return { id: op.id };
            },
          );
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
      return reply.code(202).send(result);
    },
  );
  const view = async (req: FastifyRequest, detail = false) => {
    const id = uuid.parse((req.params as any).id);
    z.object({}).strict().parse(req.query);
    if (req.headers["x-copypaste-support-session"] !== id)
      throw new Problem(
        400,
        "SUPPORT_CONTEXT_REQUIRED",
        "Open the explicit read-only support context",
      );
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const row = await lockedSession(
          tx,
          db,
          req.principal,
          id,
          "admin.support.read",
          true,
        );
        const user = await target(
          tx,
          db,
          row.tenant_id,
          row.target_user_id,
          row.project_ids,
          row,
        );
        const bs = await liveAdmin(tx, req.principal);
        const contentProjects = row.project_ids.filter((pid: string) =>
          allowed(bs, "admin.content.read", row.tenant_id, pid),
        );
        const taskId = detail ? uuid.parse((req.params as any).task) : null;
        const tasks = (
          await tx.query(
            `SELECT id,project_id,title,status,private_owner,error_code,created_at,updated_at${detail ? ",prompt,output" : ""} FROM tasks WHERE tenant_id=$1 AND project_id=ANY($2::uuid[]) AND content_state='active' AND (private_owner IS NULL OR private_owner=$3) AND ($4::uuid IS NULL OR id=$4) ORDER BY created_at DESC,id DESC LIMIT 21`,
            [row.tenant_id, contentProjects, row.target_user_id, taskId],
          )
        ).rows;
        let body: any = undefined;
        if (detail) {
          const task = tasks[0];
          if (
            !task ||
            task.private_owner ||
            !row.support_grant_id ||
            !allowed(
              bs,
              "admin.content.body.read",
              row.tenant_id,
              task.project_id,
            )
          )
            throw new Problem(
              403,
              "SUPPORT_BODY_FORBIDDEN",
              "Shared content requires a current user grant and independent body permission",
            );
          body = {
            task: taskDTO(task),
            prompt: task.prompt,
            output: task.output,
          };
        }
        const ps = (
          await tx.query(
            "SELECT id,name FROM projects WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND NOT archived ORDER BY name,id",
            [row.tenant_id, row.project_ids],
          )
        ).rows;
        await audit(
          tx,
          req.principal,
          detail ? "admin.support.body.read" : "admin.support.view",
          id,
          "succeeded",
          {
            user_id: row.target_user_id,
            project_ids: row.project_ids,
            ...(taskId ? { task_id: taskId } : {}),
            read_only: true,
          },
          row.tenant_id,
        );
        // The data and audit are one transaction. Recheck deadlines after the
        // audit too, so a slow audit cannot return a view past its deadline.
        const current = await currentSession(tx, row);
        const finalBindings = await liveAdmin(tx, req.principal);
        baseAuthority(finalBindings, "admin.support.read", row);
        for (const task of tasks)
          authority(finalBindings, "admin.content.read", row.tenant_id, [
            task.project_id,
          ]);
        if (detail)
          authority(finalBindings, "admin.content.body.read", row.tenant_id, [
            tasks[0].project_id,
          ]);
        if (current.dto.state !== "active")
          throw new Problem(410, "SUPPORT_ENDED", "Support access has ended");
        return {
          session: current.dto,
          actor: { id: req.principal.id, name: req.principal.name },
          target: { id: row.target_user_id, name: user.name },
          workspace: { id: row.tenant_id, name: user.tenant_name },
          projects: ps,
          read_only: true,
          as_of: current.at,
          ...(detail
            ? body
            : {
                tasks: tasks.slice(0, 20).map((task) => ({
                  ...taskDTO(task),
                  body_available:
                    !task.private_owner &&
                    !!row.support_grant_id &&
                    allowed(
                      bs,
                      "admin.content.body.read",
                      row.tenant_id,
                      task.project_id,
                    ),
                })),
                tasks_truncated: tasks.length > 20,
              }),
        };
      },
      undefined,
      true,
    );
  };
  app.get(
    "/v1/admin/support/sessions/:id/view",
    { preHandler: requireAdmin(db) },
    (req) => view(req),
  );
  app.get(
    "/v1/admin/support/sessions/:id/view/tasks/:task",
    { preHandler: requireAdmin(db) },
    (req) => view(req, true),
  );
}
