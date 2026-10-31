import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { requireAdmin, audit } from "./auth.js";
import {
  bindings,
  lockAdminAccess,
  requireSensitiveAdmin,
} from "./admin-access.js";
import { accountState } from "./admin-accounts.js";
import { canonical, equal, hash, hmac, Problem, uuid } from "./lib.js";
import { z } from "zod";
import { operationalDirectoryFields, validateOperationalDirectory } from "./admin-directory-operational.js";

const baseQuery = {
  q: z.string().trim().min(1).max(160).optional(),
  cursor: z.string().min(1).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};
const tenantQuery = z.object(baseQuery).strict();
const userQuery = z
  .object({
    ...baseQuery,
    ...operationalDirectoryFields,
    user_id: uuid.optional(),
    tenant_id: uuid.optional(),
    project_id: uuid.optional(),
    period_from: z.string().datetime({ offset: true }).optional(),
    period_to: z.string().datetime({ offset: true }).optional(),
    state: z.enum(["active", "frozen", "closed"]).optional(),
    vip: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
  })
  .strict()
  .superRefine(validateOperationalDirectory);
type Query = z.infer<typeof userQuery>;
type Binding = Awaited<ReturnType<typeof bindings>>[number];
const iso = (d: Date | string) => new Date(d).toISOString();
const money = (amount: string) => ({ currency: "HKD", amount_micros: amount });
const mask = (email: string) => email.replace(/^(.).*(@.*)$/, "$1***$2");
const escaped = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

/** Every predicate uses the same current binding set. Caller owns the access lock. */
export class ReadScope {
  values: unknown[] = [];
  constructor(readonly bs: Binding[]) {}
  arg(value: unknown) {
    this.values.push(value);
    return "$" + this.values.length;
  }
  has(key: string) {
    return (
      !this.bs.some(
        (b) =>
          b.effect === "deny" &&
          b.scope_kind === "global" &&
          b.permissions.includes(key),
      ) &&
      this.bs.some((b) => b.effect === "allow" && b.permissions.includes(key))
    );
  }
  global(key: string) {
    return (
      this.has(key) &&
      this.bs.some(
        (b) =>
          b.effect === "allow" &&
          b.scope_kind === "global" &&
          b.permissions.includes(key),
      )
    );
  }
  scope(key: string, tenant: string, project?: string) {
    const bs = this.bs.filter((b) => b.permissions.includes(key));
    const ids = (effect: string, kind: string) =>
      bs
        .filter((b) => b.effect === effect && b.scope_kind === kind)
        .map((b) => b.scope_id);
    const a = this.arg(this.global(key)),
      ta = this.arg(ids("allow", "tenant")),
      pa = this.arg(ids("allow", "project"));
    const td = this.arg(ids("deny", "tenant")),
      pd = this.arg(ids("deny", "project"));
    return `(${this.has(key) ? "true" : "false"} AND (${a}::boolean OR ${tenant}=ANY(${ta}::uuid[])${project ? ` OR ${project}=ANY(${pa}::uuid[])` : ""}) AND NOT (${tenant}=ANY(${td}::uuid[])${project ? ` OR ${project}=ANY(${pd}::uuid[])` : ""}) AND ${pa}::uuid[] IS NOT NULL AND ${pd}::uuid[] IS NOT NULL)`;
  }
  projects(key: string, member = "m", project = "p") {
    return `${project}.tenant_id=${member}.tenant_id AND (${member}.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=${project}.id AND pm.user_id=${member}.user_id)) AND ${this.scope(key, `${project}.tenant_id`, `${project}.id`)}`;
  }
  member(key: string, member = "m") {
    return `(${this.scope(key, `${member}.tenant_id`)} OR EXISTS(SELECT 1 FROM projects p WHERE ${this.projects(key, member)}))`;
  }
  user(key: string, user = "u") {
    return `((${this.arg(this.global(key))}::boolean AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=${user}.id)) OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=${user}.id AND ${this.member(key)}))`;
  }
  userField(key: string, user = "u") {
    return `(${this.noDeniedMembership(key, user)} AND ((${this.arg(this.global(key) && this.global("admin.users.read"))}::boolean AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=${user}.id)) OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=${user}.id AND ${this.member("admin.users.read")} AND ${this.member(key)})))`;
  }
  noDeniedMembership(key: string, user = "u") {
    const denies = this.bs.filter(
      (b) => b.effect === "deny" && b.permissions.includes(key),
    );
    return `NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=${user}.id AND (m.tenant_id=ANY(${this.arg(denies.filter((b) => b.scope_kind === "tenant").map((b) => b.scope_id))}::uuid[]) OR EXISTS(SELECT 1 FROM projects p WHERE p.tenant_id=m.tenant_id AND p.id=ANY(${this.arg(denies.filter((b) => b.scope_kind === "project").map((b) => b.scope_id))}::uuid[]))))`;
  }
  personalField(key: string, user = "u") {
    return `(${this.arg(this.global(key))}::boolean AND ${this.noDeniedMembership(key, user)})`;
  }
  account(key: string, wallet = "w") {
    const deniedProjects = this.bs
      .filter(
        (b) =>
          b.effect === "deny" &&
          b.scope_kind === "project" &&
          b.permissions.includes(key),
      )
      .map((b) => b.scope_id);
    return `((${wallet}.tenant_id IS NOT NULL AND ${this.scope(key, `${wallet}.tenant_id`)} AND NOT EXISTS(SELECT 1 FROM projects bp WHERE bp.tenant_id=${wallet}.tenant_id AND bp.id=ANY(${this.arg(deniedProjects)}::uuid[]))) OR (${wallet}.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM users bu WHERE bu.id=${wallet}.user_id AND ${this.personalField(key, "bu")})))`;
  }
}

export async function readScope(tx: Tx, p: Principal, permission: string) {
  await lockAdminAccess(tx);
  await requireSensitiveAdmin(tx, p);
  const scope = new ReadScope(await bindings(tx, p));
  if (!scope.has(permission))
    throw new Problem(403, "ADMIN_FORBIDDEN", "No readable directory scope");
  return scope;
}
function memberFilter(s: ReadScope, q: Query, alias = "m") {
  let sql = s.member("admin.users.read", alias);
  if (q.tenant_id) sql += ` AND ${alias}.tenant_id=${s.arg(q.tenant_id)}::uuid`;
  if (q.project_id)
    sql += ` AND EXISTS(SELECT 1 FROM projects p WHERE p.id=${s.arg(q.project_id)}::uuid AND ${s.projects("admin.users.read", alias)})`;
  return sql;
}
function taskFilter(s: ReadScope, q: Query, alias = "t") {
  let sql = `${s.scope("admin.users.read", `${alias}.tenant_id`, `${alias}.project_id`)} AND ${s.scope("admin.usage.read", `${alias}.tenant_id`, `${alias}.project_id`)}`;
  if (q.tenant_id) sql += ` AND ${alias}.tenant_id=${s.arg(q.tenant_id)}::uuid`;
  if (q.project_id)
    sql += ` AND ${alias}.project_id=${s.arg(q.project_id)}::uuid`;
  return sql;
}
function usageMember(s: ReadScope, q: Query) {
  let project = `${s.scope("admin.users.read", "p.tenant_id", "p.id")} AND ${s.scope("admin.usage.read", "p.tenant_id", "p.id")}`;
  if (q.project_id) project += ` AND p.id=${s.arg(q.project_id)}::uuid`;
  return `${memberFilter(s, q)} AND EXISTS(SELECT 1 FROM projects p WHERE p.tenant_id=m.tenant_id AND ${project})`;
}
function entitled(s: ReadScope, user = "u", q: Query = { limit: 50 }) {
  // Personal grants require a global field permission; tenant grants require an active membership.
  return `${s.noDeniedMembership("admin.entitlements.read", user)} AND e.state='active' AND e.starts_at<=now() AND e.ends_at>now() AND ${user}.status='active' AND ${user}.admin_closed_at IS NULL AND ((e.user_id=${user}.id AND ${s.personalField("admin.entitlements.read", user)}) OR EXISTS(SELECT 1 FROM memberships em JOIN tenants et ON et.id=em.tenant_id WHERE em.user_id=${user}.id AND em.tenant_id=e.tenant_id AND em.status='active' AND NOT em.admin_suspended AND et.status='active' AND et.admin_closed_at IS NULL AND ${memberFilter(s, q, "em")} AND ${s.scope("admin.entitlements.read", "em.tenant_id")}))`;
}
function usageVisible(s: ReadScope, q: Query) {
  return `(EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND ${usageMember(s, q)}) OR (${s.arg(s.global("admin.users.read") && s.global("admin.usage.read"))}::boolean AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id)))`;
}
function chargeAmount(s: ReadScope, q: Query) {
  let where = taskFilter(s, q);
  if (q.period_from) where += ` AND l.created_at>=${s.arg(q.period_from)}::timestamptz`;
  if (q.period_to) where += ` AND l.created_at<${s.arg(q.period_to)}::timestamptz`;
  return `(SELECT coalesce(sum(-l.amount_micros),0) FROM ledger l JOIN tasks t ON t.id=l.task_id WHERE l.user_id=u.id AND l.kind='charge' AND ${where})`;
}
function grantSubject(s: ReadScope, q: Query) {
  return `${s.noDeniedMembership("admin.entitlements.read")} AND ((e.user_id=u.id AND ${s.personalField("admin.entitlements.read")}) OR EXISTS(SELECT 1 FROM memberships em WHERE em.user_id=u.id AND em.tenant_id=e.tenant_id AND em.status='active' AND NOT em.admin_suspended AND ${memberFilter(s, q, "em")} AND ${s.scope("admin.entitlements.read", "em.tenant_id")}))`;
}
function advancedWhere(s: ReadScope, q: Query, dataMode: string) {
  const predicates: string[] = [];
  for (const [field, from, to] of [["u.created_at", q.registered_from, q.registered_to], ["u.last_active_at", q.active_from, q.active_to]]) {
    if (from) predicates.push(`${field}>=${s.arg(from)}::timestamptz`);
    if (to) predicates.push(`${field}<${s.arg(to)}::timestamptz`);
  }
  if (q.activity) predicates.push(`u.last_active_at IS ${q.activity === "known" ? "NOT " : ""}NULL`);
  if (q.registration_source) predicates.push(q.registration_source === "unknown" ? "u.registration_source IS NULL" : `u.registration_source=${s.arg(q.registration_source)}`);
  if (q.charge_min_micros !== undefined || q.charge_max_micros !== undefined) {
    predicates.push(usageVisible(s, q));
    if (q.charge_min_micros !== undefined) predicates.push(`${chargeAmount(s, q)}>=${s.arg(q.charge_min_micros)}::numeric`);
    if (q.charge_max_micros !== undefined) predicates.push(`${chargeAmount(s, q)}<=${s.arg(q.charge_max_micros)}::numeric`);
  }
  if (q.vip_plan || q.vip_status || q.vip_expiry_from || q.vip_expiry_to) {
    let grant = `e.plan<>'starter' AND ${grantSubject(s, q)}`;
    if (q.vip_plan) grant += ` AND e.plan=${s.arg(q.vip_plan)}`;
    if (q.vip_expiry_from) grant += ` AND e.ends_at>=${s.arg(q.vip_expiry_from)}::timestamptz`;
    if (q.vip_expiry_to) grant += ` AND e.ends_at<${s.arg(q.vip_expiry_to)}::timestamptz`;
    if (q.vip === true || q.vip_status === "effective") grant += ` AND ${entitled(s, "u", q)}`;
    if (q.vip_status === "scheduled") grant += " AND e.state='active' AND e.starts_at>now()";
    if (q.vip_status === "expired") grant += " AND e.state<>'revoked' AND e.ends_at<=now()";
    if (q.vip_status === "suspended") grant += " AND e.state='suspended' AND e.ends_at>now()";
    if (q.vip_status === "revoked") grant += " AND e.state='revoked'";
    predicates.push(`EXISTS(SELECT 1 FROM entitlement_access e WHERE ${grant})`);
  }
  if (q.role_key || q.cost_exception) {
    let task = `t.created_by=u.id AND ${taskFilter(s, q)}`;
    if (q.period_from) task += ` AND t.created_at>=${s.arg(q.period_from)}::timestamptz`;
    if (q.period_to) task += ` AND t.created_at<${s.arg(q.period_to)}::timestamptz`;
    if (q.role_key) {
      let role = task + ` AND t.role_key=${s.arg(q.role_key)}`;
      if (q.role_usage === "started") role += " AND t.attempt>0";
      predicates.push(`EXISTS(SELECT 1 FROM tasks t WHERE ${role})`);
    }
    if (q.cost_exception) {
      predicates.push(usageVisible(s, q));
      const pending = `EXISTS(SELECT 1 FROM tasks t WHERE ${task} AND (t.status='reconciling' OR EXISTS(SELECT 1 FROM tool_operations o WHERE o.task_id=t.id AND o.state='reconciling')))`;
      predicates.push(q.cost_exception === "none" ? `NOT ${pending}` : pending);
    }
  }
  if (q.balance_state) {
    let account = `w.data_mode=${s.arg(dataMode)} AND ${s.account("admin.billing.read")} AND (w.user_id=u.id OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=w.tenant_id AND ${memberFilter(s, q)}))`;
    if (q.billing_subject === "personal") account += " AND w.user_id IS NOT NULL";
    if (q.billing_subject === "tenant") account += " AND w.tenant_id IS NOT NULL";
    // Same available amount as billingAccount after lazy expiry, without writing
    // ledger entries during a directory read. Debt is already in balance.
    const lots = "(SELECT coalesce(sum(f.remaining_micros),0) FROM funding_lots f WHERE f.billing_account_id=w.id)";
    const expired = "(SELECT coalesce(sum(f.remaining_micros-f.reserved_micros),0) FROM funding_lots f WHERE f.billing_account_id=w.id AND f.expires_at<=now() AND f.remaining_micros>f.reserved_micros)";
    const available = `(w.balance_micros::numeric+w.credit_limit_micros-w.reserved_micros-${expired})`;
    predicates.push(`EXISTS(SELECT 1 FROM wallets w WHERE ${account} AND ${lots}>=w.balance_micros AND ${available}${q.balance_state === "insufficient" ? "<" : ">="}${s.arg(q.balance_required_micros ?? "1")}::numeric)`);
  }
  return predicates.length ? " AND " + predicates.map(v => "(" + v + ")").join(" AND ") : "";
}
async function userDto(
  tx: Tx,
  p: Principal,
  bs: Binding[],
  row: any,
  q: Query,
) {
  const s = new ReadScope(bs),
    id = s.arg(row.id);
  const ms = (
    await tx.query(
      `SELECT m.tenant_id,m.role,m.status,m.admin_suspended,
    ARRAY(SELECT p.id FROM projects p WHERE ${s.projects("admin.users.read")} ORDER BY p.id) AS project_ids
    FROM memberships m WHERE m.user_id=${id} AND ${memberFilter(s, q)} ORDER BY m.tenant_id`,
      s.values,
    )
  ).rows;
  const c = new ReadScope(bs);
  const contact = (
    await tx.query(
      `SELECT u.id FROM users u WHERE u.id=${c.arg(row.id)} AND ${c.userField("admin.users.contact.read")}`,
      c.values,
    )
  ).rowCount;
  const dto: any = {
    id: row.id,
    display_name: row.name || row.email.split("@")[0],
    masked_contact: mask(row.email),
    ...(contact ? { contact: row.email } : {}),
    state: accountState(row, "users"),
    registered_at: iso(row.created_at),
    last_login_at: row.last_login_at ? iso(row.last_login_at) : null,
    tenant_ids: ms.map((m) => m.tenant_id),
    version: row.version,
    auth_version: row.auth_version,
    ...(q.view === "operations" ? {
      registration_source: row.registration_source ?? null,
      last_active_at: row.last_active_at ? iso(row.last_active_at) : null,
    } : {}),
  };
  if (s.has("admin.usage.read")) {
    const a = new ReadScope(bs),
      uid = a.arg(row.id);
    let where = taskFilter(a, q);
    if (q.period_from)
      where += ` AND l.created_at>=${a.arg(q.period_from)}::timestamptz`;
    if (q.period_to)
      where += ` AND l.created_at<${a.arg(q.period_to)}::timestamptz`;
    // Zero is a confirmed empty charge set; unresolved reservations never enter this sum.
    const n = (
      await tx.query(
        `SELECT coalesce(sum(-l.amount_micros),0)::text AS amount,
      EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=${uid} AND ${usageMember(a, q)}) AS authorized
      FROM ledger l JOIN tasks t ON t.id=l.task_id WHERE l.user_id=${uid} AND l.kind='charge' AND ${where}`,
        a.values,
      )
    ).rows[0];
    if (
      n.authorized ||
      (s.global("admin.usage.read") &&
        !ms.length &&
        s.global("admin.users.read"))
    )
      dto.confirmed_customer_charges = money(row.directory_filtered_charges ?? n.amount);
  }
  if (s.has("admin.entitlements.read")) {
    const e = new ReadScope(bs),
      uid = e.arg(row.id);
    const plans = (
      await tx.query(
        `SELECT DISTINCT e.plan FROM entitlement_access e,users u WHERE u.id=${uid} AND ${entitled(e, "u", q)} ORDER BY e.plan`,
        e.values,
      )
    ).rows.map((r) => r.plan);
    // Omit the field when there is no authorized entitlement scope for this user.
    const a = new ReadScope(bs);
    const allowed = (
      await tx.query(
        `SELECT 1 FROM users u WHERE u.id=${a.arg(row.id)} AND ${a.noDeniedMembership("admin.entitlements.read")} AND (${a.personalField("admin.entitlements.read")} OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND ${a.member("admin.users.read")} AND ${a.scope("admin.entitlements.read", "m.tenant_id")}))`,
        a.values,
      )
    ).rowCount;
    if (allowed)
      dto.vip_summary =
        plans.filter((v) => v !== "starter").join(", ") || "none";
  }
  return {
    dto,
    memberships: ms.map((m) => ({
      tenant_id: m.tenant_id,
      project_ids: m.project_ids,
      role: m.role,
      state: m.admin_suspended
        ? "suspended"
        : m.status === "removed"
          ? "removed"
          : "active",
    })),
  };
}

const cursorShape = z
  .object({
    v: z.literal(1),
    kind: z.enum([
      "users",
      "tenants",
      "billing_accounts",
      "billing_ledger",
      "billing_payments",
      "billing_refunds",
      "commercial_plans",
      "capability_releases",
      "provider_requests",
      "provider_policies",
      "audio_accounting",
      "vip_grants",
      "approvals",
    ]),
    owner: uuid,
    auth: z.number().int(),
    session: uuid,
    filters: z.string(),
    scope: z.string(),
    asof: z.string().datetime(),
    at: z.string().datetime(),
    id: uuid,
    expires: z.number().int(),
  })
  .strict();
function cursorContext(
  p: Principal,
  bs: Binding[],
  q: { cursor?: string; [key: string]: unknown },
  kind: z.infer<typeof cursorShape>["kind"],
) {
  const { cursor: _cursor, ...filters } = q;
  return {
    v: 1 as const,
    kind,
    owner: p.id,
    auth: p.authVersion,
    session: p.sessionId,
    filters: hash(canonical(filters)),
    scope: hash(
      canonical(
        bs
          .map((b) => ({
            id: b.id,
            role: b.role_key,
            scope: b.scope_kind,
            target: b.scope_id,
            effect: b.effect,
            permissions: [...b.permissions].sort(),
            expires: b.expires_at ? iso(b.expires_at) : null,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    ),
  };
}
export async function pageBounds(
  tx: Tx,
  db: Database,
  p: Principal,
  s: ReadScope,
  q: { cursor?: string; [key: string]: unknown },
  kind: z.infer<typeof cursorShape>["kind"],
) {
  const context = cursorContext(p, s.bs, q, kind);
  if (q.cursor) {
    try {
      const [raw, signature, extra] = q.cursor.split(".");
      if (
        !raw ||
        !signature ||
        extra ||
        !equal(signature, hmac(db.config.MASTER_KEY!, "admin-directory:" + raw))
      )
        throw new Error();
      const data = cursorShape.parse(
        JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
      );
      for (const [k, v] of Object.entries(context))
        if (data[k as keyof typeof data] !== v) throw new Error();
      if (data.expires < Date.now()) throw new Error();
      return {
        context,
        asof: data.asof,
        after: { at: data.at, id: data.id },
        expires: data.expires,
      };
    } catch {
      throw new Problem(
        400,
        "CURSOR_INVALID",
        "Restart pagination after filters, session or permissions change",
      );
    }
  }
  const asof = (
    await tx.query(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
    )
  ).rows[0].at;
  return { context, asof, after: null, expires: Date.now() + 15 * 60_000 };
}
export function pageCursor(
  db: Database,
  bounds: Awaited<ReturnType<typeof pageBounds>>,
  row: any,
) {
  const raw = Buffer.from(
    canonical({
      ...bounds.context,
      asof: bounds.asof,
      at: row.cursor_at,
      id: row.id,
      expires: bounds.expires,
    }),
  ).toString("base64url");
  return raw + "." + hmac(db.config.MASTER_KEY!, "admin-directory:" + raw);
}

export function registerAdminDirectory(app: FastifyInstance, db: Database) {
  app.get("/v1/admin/users", { preHandler: requireAdmin(db) }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = userQuery.parse(req.query);
    return db.tx(
      async (tx) => {
        const s = await readScope(tx, req.principal, "admin.users.read");
        if (
          ((q.period_from || q.period_to || q.charge_min_micros !== undefined || q.charge_max_micros !== undefined || q.role_key || q.cost_exception) && !s.has("admin.usage.read")) ||
          ((q.vip !== undefined || q.vip_plan || q.vip_status || q.vip_expiry_from || q.vip_expiry_to) && !s.has("admin.entitlements.read")) ||
          (q.balance_state && !s.has("admin.billing.read"))
        )
          throw new Problem(
            403,
            "ADMIN_FORBIDDEN",
            "The selected filter requires its field permission",
          );
        const bounds = await pageBounds(tx, db, req.principal, s, q, "users");
        let where = s.user("admin.users.read");
        if (q.user_id) where += ` AND u.id=${s.arg(q.user_id)}::uuid`;
        if (q.tenant_id || q.project_id)
          where += ` AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND ${memberFilter(s, q)})`;
        if (q.state)
          where += ` AND (CASE WHEN u.admin_closed_at IS NOT NULL THEN 'closed' WHEN u.status='active' THEN 'active' ELSE 'frozen' END)=${s.arg(q.state)}`;
        if (q.q) {
          const term = s.arg(escaped(q.q));
          where += ` AND (u.name ILIKE ${term} OR (${s.userField("admin.users.contact.read")} AND u.email ILIKE ${term}))`;
        }
        if (q.vip !== undefined)
          where += ` AND ${s.noDeniedMembership("admin.entitlements.read")} AND (${s.personalField("admin.entitlements.read")} OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND ${memberFilter(s, q)} AND ${s.scope("admin.entitlements.read", "m.tenant_id")})) AND ${q.vip ? "" : "NOT "}EXISTS(SELECT 1 FROM entitlement_access e WHERE e.plan<>'starter' AND ${entitled(s, "u", q)})`;
        where += advancedWhere(s, q, db.config.DEMO_MODE ? "simulated" : "configured_services");
        where += ` AND u.created_at<=${s.arg(bounds.asof)}::timestamptz`;
        if (bounds.after)
          where += ` AND (u.created_at,u.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
        const chargeProjection = q.charge_min_micros !== undefined || q.charge_max_micros !== undefined
          ? `,${chargeAmount(s, q)}::text AS directory_filtered_charges` : "";
        const rows = (
          await tx.query(
            `SELECT u.*,to_char(u.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at${chargeProjection} FROM users u WHERE ${where} ORDER BY u.created_at DESC,u.id DESC LIMIT ${s.arg(q.limit + 1)}`,
            s.values,
          )
        ).rows;
        const items = [];
        for (const row of rows.slice(0, q.limit))
          items.push((await userDto(tx, req.principal, s.bs, row, q)).dto);
        await audit(
          tx,
          req.principal,
          "admin.users.read",
          undefined,
          "succeeded",
          { count: items.length, filters_hash: bounds.context.filters },
        );
        return {
          items,
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
    "/v1/admin/users/:user_id",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const id = uuid.parse((req.params as any).user_id);
      const projection = z.object({ view: z.literal("operations").optional() }).passthrough().parse(req.query);
      return db.tx(
        async (tx) => {
          const s = await readScope(tx, req.principal, "admin.users.read");
          const row = (
            await tx.query(
              `SELECT u.* FROM users u WHERE u.id=${s.arg(id)} AND ${s.user("admin.users.read")}`,
              s.values,
            )
          ).rows[0];
          if (!row) throw new Problem(404, "NOT_FOUND", "User not found");
          const { dto, memberships } = await userDto(
            tx,
            req.principal,
            s.bs,
            row,
            { limit: 50, view: projection.view },
          );
          const b = new ReadScope(s.bs);
          const accounts = (
            await tx.query(
              `SELECT w.id FROM wallets w WHERE w.data_mode=${b.arg(db.config.DEMO_MODE ? "simulated" : "configured_services")} AND ${b.account("admin.billing.read")} AND (w.user_id=${b.arg(id)} OR EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=w.tenant_id AND m.user_id=${b.arg(id)} AND ${b.member("admin.users.read")})) ORDER BY w.id`,
              b.values,
            )
          ).rows.map((r) => r.id);
          const e = new ReadScope(s.bs);
          const plans = (
            await tx.query(
              `SELECT DISTINCT e.plan FROM entitlement_access e,users u WHERE u.id=${e.arg(id)} AND ${entitled(e)} ORDER BY e.plan`,
              e.values,
            )
          ).rows.map((r) => r.plan);
          await audit(tx, req.principal, "admin.users.read", id);
          return {
            user: dto,
            memberships,
            billing_account_ids: accounts,
            effective_entitlements: plans,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.get(
    "/v1/admin/users/:user_id/management-context",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).user_id);
      return db.tx(
        async (tx) => {
          const s = await readScope(tx, req.principal, "admin.users.read");
          if (
            !(
              await tx.query(
                `SELECT 1 FROM users u WHERE u.id=${s.arg(id)} AND ${s.user("admin.users.read")}`,
                s.values,
              )
            ).rowCount
          )
            throw new Problem(404, "NOT_FOUND", "User not found");
          const m = new ReadScope(s.bs);
          const rows = (
            await tx.query(
              `SELECT t.id AS tenant_id,t.name FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=${m.arg(id)} AND ${m.member("admin.users.read")} ORDER BY t.id`,
              m.values,
            )
          ).rows;
          for (const row of rows) {
            const u = new ReadScope(s.bs),
              uid = u.arg(id),
              tid = u.arg(row.tenant_id);
            const readable = await tx.query(
              `SELECT 1 FROM memberships m WHERE m.user_id=${uid} AND m.tenant_id=${tid} AND ${usageMember(u, { limit: 50, tenant_id: row.tenant_id })} LIMIT 1`,
              u.values,
            );
            // Build a new parameter set after the independent authorization query.
            if (readable.rowCount) {
              const a = new ReadScope(s.bs),
                who = a.arg(id),
                filter = taskFilter(a, { limit: 50, tenant_id: row.tenant_id });
              row.task_count = Number(
                (
                  await tx.query(
                    `SELECT count(*)::int AS n FROM tasks t WHERE t.created_by=${who} AND ${filter}`,
                    a.values,
                  )
                ).rows[0].n,
              );
              const c = new ReadScope(s.bs),
                owner = c.arg(id),
                cf = taskFilter(c, { limit: 50, tenant_id: row.tenant_id });
              row.confirmed_customer_charges = money(
                (
                  await tx.query(
                    `SELECT coalesce(sum(-l.amount_micros),0)::text AS n FROM ledger l JOIN tasks t ON t.id=l.task_id WHERE l.user_id=${owner} AND l.kind='charge' AND ${cf}`,
                    c.values,
                  )
                ).rows[0].n,
              );
            }
          }
          const e = new ReadScope(s.bs);
          const personalAllowed = (
            await tx.query(
              `SELECT 1 FROM users u WHERE u.id=${e.arg(id)} AND ${e.personalField("admin.entitlements.read")}`,
              e.values,
            )
          ).rowCount;
          const personal = personalAllowed
            ? (
                await tx.query(
                  "SELECT id,plan,state,starts_at,ends_at FROM entitlement_access WHERE user_id=$1 ORDER BY created_at DESC,id DESC",
                  [id],
                )
              ).rows
            : null;
          await audit(
            tx,
            req.principal,
            "admin.users.management-context.read",
            id,
          );
          return { memberships: rows, personal_entitlements: personal };
        },
        undefined,
        true,
      );
    },
  );
  app.get(
    "/v1/admin/tenants",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const q = tenantQuery.parse(req.query);
      return db.tx(
        async (tx) => {
          const s = await readScope(tx, req.principal, "admin.tenants.read"),
            bounds = await pageBounds(tx, db, req.principal, s, q, "tenants");
          let where = `(${s.scope("admin.tenants.read", "t.id")} OR EXISTS(SELECT 1 FROM projects p WHERE p.tenant_id=t.id AND ${s.scope("admin.tenants.read", "p.tenant_id", "p.id")}))`;
          if (q.q) where += ` AND t.name ILIKE ${s.arg(escaped(q.q))}`;
          where += ` AND t.created_at<=${s.arg(bounds.asof)}::timestamptz`;
          if (bounds.after)
            where += ` AND (t.created_at,t.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
          const rows = (
            await tx.query(
              `SELECT t.*,w.id AS billing_account_id,to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM tenants t JOIN wallets w ON w.tenant_id=t.id WHERE ${where} ORDER BY t.created_at DESC,t.id DESC LIMIT ${s.arg(q.limit + 1)}`,
              s.values,
            )
          ).rows;
          await audit(
            tx,
            req.principal,
            "admin.tenants.read",
            undefined,
            "succeeded",
            {
              count: Math.min(q.limit, rows.length),
              filters_hash: bounds.context.filters,
            },
          );
          return {
            items: rows.slice(0, q.limit).map((r) => ({
              id: r.id,
              name: r.name,
              state: accountState(r, "tenants"),
              version: r.version,
              billing_account_id: r.billing_account_id,
            })),
            next_cursor:
              rows.length > q.limit
                ? pageCursor(db, bounds, rows[q.limit - 1])
                : null,
          };
        },
        undefined,
        true,
      );
    },
  );
}
