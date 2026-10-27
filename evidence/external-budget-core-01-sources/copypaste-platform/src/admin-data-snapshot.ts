import type { Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { readScope } from "./admin-directory.js";
import { canonical, hash, Problem } from "./lib.js";
import {
  dataLimits,
  type DataCommand,
  type DataTarget,
} from "./admin-data-model.js";

export const sourcePermissions = {
  users: "admin.users.read",
  usage: "admin.usage.read",
  billing: "admin.billing.read",
  audit: "admin.audit.read",
} as const;

/** One SQL statement freezes selection AND field projection in one MVCC snapshot.
 * Internal ids restrict later verification to the original set; new rows never
 * silently enter an already reviewed export. No raw prompts, ledger detail or
 * audit bodies are part of the CSV projection. */
export async function captureDataExport(
  tx: Tx,
  p: Principal,
  command: Extract<DataCommand, { kind: "export" }>,
  ids?: string[],
  downloading = false,
): Promise<DataTarget[]> {
  const f = command.filters,
    source = command.source;
  const s = await readScope(tx, p, sourcePermissions[source]);
  const exportPermission = downloading
    ? "admin.exports.download"
    : "admin.exports.create";
  if (!s.has(exportPermission))
    throw new Problem(403, "ADMIN_FORBIDDEN", "No export permission");
  let from: string,
    where: string,
    projection: string,
    raw: string,
    version = "NULL::integer",
    id: string,
    created: string,
    search: string;
  const scoped = (key: string, tenant: string, project?: string) =>
    s.scope(
      key,
      `coalesce(${tenant},'00000000-0000-0000-0000-000000000000'::uuid)`,
      project &&
        `coalesce(${project},'00000000-0000-0000-0000-000000000000'::uuid)`,
    );
  if (source === "users") {
    from = "users u";
    id = "u.id";
    created = "u.created_at";
    version = "u.version";
    where = `${s.user("admin.users.read")} AND ${s.userField(exportPermission)}`;
    const contact = s.userField("admin.users.contact.read");
    let memberships = `${s.member("admin.users.read")} AND ${s.member(exportPermission)}`;
    if (f.tenant_id)
      memberships += ` AND m.tenant_id=${s.arg(f.tenant_id)}::uuid`;
    if (f.project_id)
      memberships += ` AND EXISTS(SELECT 1 FROM projects p WHERE p.id=${s.arg(f.project_id)}::uuid AND ${s.projects("admin.users.read")} AND ${s.projects(exportPermission)})`;
    if (f.tenant_id || f.project_id)
      where += ` AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND ${memberships})`;
    if (f.user_id) where += ` AND u.id=${s.arg(f.user_id)}::uuid`;
    if (f.state)
      where += ` AND (CASE WHEN u.admin_closed_at IS NOT NULL THEN 'closed' WHEN u.status='active' THEN 'active' ELSE 'frozen' END)=${s.arg(f.state)}`;
    search = `(u.name ILIKE $SEARCH ESCAPE '\\' OR (${contact} AND u.email ILIKE $SEARCH ESCAPE '\\'))`;
    projection = `jsonb_build_object('id',u.id,'display_name',coalesce(nullif(u.name,''),split_part(u.email,'@',1)),
      'masked_contact',regexp_replace(u.email,'^(.).*(@.*)$','\\1***\\2'),
      'state',CASE WHEN u.admin_closed_at IS NOT NULL THEN 'closed' WHEN u.status='active' THEN 'active' ELSE 'frozen' END,
      'registered_at',u.created_at,'last_login_at',u.last_login_at,'version',u.version,
      'tenant_ids',ARRAY(SELECT m.tenant_id FROM memberships m WHERE m.user_id=u.id AND ${memberships} ORDER BY m.tenant_id)) ||
      CASE WHEN ${contact} THEN jsonb_build_object('contact',u.email) ELSE '{}'::jsonb END`;
    raw = "to_jsonb(u)";
  } else if (source === "usage") {
    from = "tasks t";
    id = "t.id";
    created = "t.created_at";
    version = "t.version";
    where = `${scoped(sourcePermissions[source], "t.tenant_id", "t.project_id")} AND ${scoped(exportPermission, "t.tenant_id", "t.project_id")} AND t.data_mode=current_setting('app.data_mode',true)`;
    if (f.tenant_id) where += ` AND t.tenant_id=${s.arg(f.tenant_id)}::uuid`;
    if (f.project_id) where += ` AND t.project_id=${s.arg(f.project_id)}::uuid`;
    if (f.user_id) where += ` AND t.created_by=${s.arg(f.user_id)}::uuid`;
    search =
      "(t.id::text ILIKE $SEARCH ESCAPE '\\' OR t.status ILIKE $SEARCH ESCAPE '\\')";
    projection = `jsonb_build_object('id',t.id,'user_id',t.created_by,'tenant_id',t.tenant_id,'project_id',t.project_id,'state',t.status,
      'created_at',t.created_at,'charged_micros',t.charged_micros::text,'currency','HKD','input_tokens',t.input_tokens::text,
      'output_tokens',t.output_tokens::text,'version',t.version,'data_mode',t.data_mode)`;
    raw = "to_jsonb(t)";
  } else if (source === "billing") {
    from =
      "ledger l JOIN wallets w ON (l.billing_account_id=w.id OR (l.billing_account_id IS NULL AND l.tenant_id=w.tenant_id AND l.data_mode=w.data_mode)) LEFT JOIN tasks t ON t.id=l.task_id";
    id = "l.id";
    created = "l.created_at";
    where = `${s.account(sourcePermissions[source])} AND ${s.account(exportPermission)} AND l.data_mode=current_setting('app.data_mode',true) AND w.data_mode=l.data_mode`;
    if (f.tenant_id) where += ` AND l.tenant_id=${s.arg(f.tenant_id)}::uuid`;
    if (f.project_id) where += ` AND t.project_id=${s.arg(f.project_id)}::uuid`;
    if (f.user_id) where += ` AND l.user_id=${s.arg(f.user_id)}::uuid`;
    search =
      "(l.id::text ILIKE $SEARCH ESCAPE '\\' OR l.kind ILIKE $SEARCH ESCAPE '\\')";
    projection = `jsonb_build_object('id',l.id,'billing_account_id',w.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'task_id',l.task_id,
      'operation_id',l.operation_id,'kind',l.kind,'amount_micros',l.amount_micros::text,'currency','HKD','created_at',l.created_at,'data_mode',l.data_mode)`;
    raw = "to_jsonb(l)";
  } else {
    from = "audit_log a";
    id = "a.id";
    created = "a.created_at";
    where = `${scoped(sourcePermissions[source], "a.tenant_id")} AND ${scoped(exportPermission, "a.tenant_id")}`;
    // An audit record has no project scope. A project deny cannot be defeated
    // by omitting the project filter and exporting the containing enterprise.
    for (const key of [sourcePermissions[source], exportPermission]) {
      const denyProjects = s.bs
        .filter(
          (b) =>
            b.effect === "deny" &&
            b.scope_kind === "project" &&
            b.permissions.includes(key),
        )
        .map((b) => b.scope_id);
      where += ` AND NOT EXISTS(SELECT 1 FROM projects dp WHERE dp.tenant_id=a.tenant_id AND dp.id=ANY(${s.arg(denyProjects)}::uuid[]))`;
    }
    if (f.tenant_id) where += ` AND a.tenant_id=${s.arg(f.tenant_id)}::uuid`;
    search =
      "(a.action ILIKE $SEARCH ESCAPE '\\' OR a.target ILIKE $SEARCH ESCAPE '\\' OR a.id::text ILIKE $SEARCH ESCAPE '\\')";
    projection = `jsonb_build_object('id',a.id::text,'principal_id',a.principal_id,'actor_kind',a.actor_kind,'action',a.action,
      'tenant_id',a.tenant_id,'target',a.target,'outcome',a.outcome,'created_at',a.created_at)`;
    raw = "to_jsonb(a)";
  }
  if (f.created_from)
    where += ` AND ${created}>=${s.arg(f.created_from)}::timestamptz`;
  if (f.created_to)
    where += ` AND ${created}<${s.arg(f.created_to)}::timestamptz`;
  if (f.q)
    where += ` AND ${search.replaceAll("$SEARCH", s.arg("%" + f.q.replace(/[\\%_]/g, "\\$&") + "%"))}`;
  if (ids) where += ` AND ${id}::text=ANY(${s.arg(ids)}::text[])`;
  const rows = (
    await tx.query(
      `SELECT ${id}::text AS id,${version} AS version,${projection} AS row,
    encode(sha256(convert_to(${raw}::text,'UTF8')),'hex') AS source_hash FROM ${from} WHERE ${where} ORDER BY ${created},${id} LIMIT ${dataLimits.exportRows + 1}`,
      s.values,
    )
  ).rows;
  if (rows.length > dataLimits.exportRows)
    throw new Problem(
      409,
      "EXPORT_TOO_LARGE",
      "Narrow the filters to at most 10000 records; nothing was silently truncated",
    );
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    row: r.row,
    fingerprint: hash(canonical({ source_hash: r.source_hash, row: r.row })),
  }));
}
