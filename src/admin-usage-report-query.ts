import type { Tx } from "./db.js";
import { ReadScope } from "./admin-directory.js";
import { Problem } from "./lib.js";
import { usageReportLimit, type UsageReportFilters } from "./admin-usage-report-model.js";

/** Customer ledger charges are work-level facts. A capability filter selects
 * works that used it; it never assigns the entire charge to that capability. */
export async function captureUsageReport(tx: Tx, s: ReadScope, f: UsageReportFilters, mode: string) {
  const where = [`b.data_mode=${s.arg(mode)}`, s.scope("admin.usage.read", "b.tenant_id", "b.project_id"), `b.created_at>=${s.arg(f.period_from)}::timestamptz`, `b.created_at<${s.arg(f.period_to)}::timestamptz`];
  for (const [key, value] of Object.entries({ user_id: f.user_id, tenant_id: f.tenant_id, project_id: f.project_id, billing_account_id: f.billing_account_id })) if (value) where.push(`b.${key}=${s.arg(value)}::uuid`);
  if (f.task_id) where.push(`b.kind='task' AND b.id=${s.arg(f.task_id)}::uuid`);
  for (const key of ["payer_kind", "source", "role_key"] as const) if (f[key]) where.push(`b.${key}=${s.arg(f[key])}`);
  if (f.user_id) where.push(s.scope("admin.users.read", "b.tenant_id", "b.project_id"));
  const userName = `CASE WHEN ${s.userField("admin.users.read", "u")} THEN nullif(u.name,'') END`;
  const internal = s.scope("admin.usage.internal_cost.read", "b.tenant_id", "b.project_id");
  const exportable = `(${s.scope("admin.exports.create", "b.tenant_id", "b.project_id")} AND ${s.scope("admin.exports.download", "b.tenant_id", "b.project_id")})`;
  const opFilter: string[] = [];
  if (f.capability_version_id) opFilter.push(`o.capability_version_id=${s.arg(f.capability_version_id)}::uuid`);
  if (f.model_alias) opFilter.push(`o.model_alias=${s.arg(f.model_alias)}`);
  const matchOperations = opFilter.length ? `EXISTS(SELECT 1 FROM ops o WHERE o.work_id=b.id AND b.kind='task' AND ${opFilter.join(" AND ")})` : "true";
  const result = (await tx.query(`WITH raw AS (
    SELECT t.id,'task'::text AS kind,t.tenant_id,t.project_id,t.created_by AS user_id,${userName} AS user_name,n.name AS tenant_name,p.name AS project_name,
      t.billing_account_id,CASE WHEN w.user_id IS NULL THEN 'tenant' ELSE 'user' END AS payer_kind,coalesce(w.user_id,w.tenant_id) AS payer_id,
      CASE WHEN t.execution_location='desktop' THEN 'desktop_agent' ELSE 'cloud_agent' END AS source,t.role_key,t.role_hash AS template_hash,
      t.status AS state,t.created_at,t.data_mode,t.attempt,r.runtime_profile_id
    FROM tasks t JOIN users u ON u.id=t.created_by JOIN tenants n ON n.id=t.tenant_id JOIN projects p ON p.id=t.project_id
      JOIN wallets w ON w.id=t.billing_account_id AND w.data_mode=t.data_mode LEFT JOIN task_runtime_bindings r ON r.task_id=t.id
    UNION ALL
    SELECT c.id,'resource',c.tenant_id,c.project_id,c.private_owner,${userName},n.name,p.name,h.billing_account_id,
      CASE WHEN w.user_id IS NULL THEN 'tenant' ELSE 'user' END,coalesce(w.user_id,w.tenant_id),'cloud_resource',NULL::text,NULL::text,c.state,c.confirmed_at,w.data_mode,NULL::integer,NULL::uuid
    FROM cloud_runtime_sessions c JOIN cloud_runtime_holds h ON h.session_id=c.id JOIN wallets w ON w.id=h.billing_account_id
      JOIN users u ON u.id=c.private_owner JOIN tenants n ON n.id=c.tenant_id JOIN projects p ON p.id=c.project_id
  ), candidate AS MATERIALIZED (
    SELECT b.*,${internal} AS internal_readable,${exportable} AS exportable FROM raw b WHERE ${where.join(" AND ")}
    ORDER BY b.created_at DESC,b.id DESC,b.kind LIMIT ${usageReportLimit.works + 1}
  ), ops AS MATERIALIZED (
    SELECT r.task_id AS work_id,r.id,r.channel AS channel,r.operation_id,r.operation AS action,r.model_alias,r.capability_version_id,r.attempt,r.state,r.created_at,
      CASE WHEN r.channel='input_count' THEN jsonb_build_object('counted_input_tokens',r.effective_counted_input_tokens::text)
       WHEN r.request_class='image' THEN jsonb_build_object('images',r.effective_image_units::text)
       ELSE jsonb_build_object('input_tokens',r.effective_input_tokens::text,'output_tokens',r.effective_output_tokens::text) END AS units
    FROM current_ai_provider_requests r JOIN candidate b ON b.id=r.task_id AND b.kind='task' WHERE r.data_mode=b.data_mode
    UNION ALL
    SELECT v.task_id,v.id,'video',v.operation_id::text,'video.generate',v.model_alias,v.capability_version_id,NULL::integer,v.state,v.created_at,jsonb_build_object('video_seconds',v.billable_seconds::text)
    FROM ai_video_jobs v JOIN candidate b ON b.id=v.task_id AND b.kind='task' WHERE v.data_mode=b.data_mode
    UNION ALL
    SELECT a.task_id,a.id,'audio',a.operation_id::text,a.kind,a.model_alias,a.capability_version_id,NULL::integer,a.state,a.created_at,jsonb_build_object(a.pricing_unit,a.effective_units::text)
    FROM current_audio_accounting_requests a JOIN candidate b ON b.id=a.task_id AND b.kind='task' WHERE a.channel='audio_customer' AND a.data_mode=b.data_mode
    UNION ALL
    SELECT o.task_id,o.id,'tool',o.call_id,o.action,NULL::text,NULL::uuid,NULL::integer,o.state,o.created_at,'{}'::jsonb
    FROM tool_operations o JOIN candidate b ON b.id=o.task_id AND b.kind='task'
  ), selected AS MATERIALIZED (SELECT b.* FROM candidate b WHERE ${matchOperations}),
  bounded_ops AS MATERIALIZED (SELECT o.* FROM ops o JOIN selected b ON b.id=o.work_id AND b.kind='task' ORDER BY o.created_at,o.id,o.channel LIMIT ${usageReportLimit.operations + 1}),
  charges AS MATERIALIZED (
    SELECT l.*,b.kind AS work_kind,b.id AS work_id FROM ledger l JOIN selected b
      ON (b.kind='task' AND l.task_id=b.id) OR (b.kind='resource' AND l.cloud_runtime_session_id=b.id)
    WHERE l.kind='charge' AND l.data_mode=b.data_mode AND l.billing_account_id=b.billing_account_id
  ), refunds AS MATERIALIZED (
    SELECT j.id,j.amount_micros,j.created_at,j.operation_id,c.work_id,c.work_kind,j.source_entry_id
    FROM billing_journal j JOIN billing_journal original ON original.id=j.source_entry_id
      JOIN charges c ON c.id=original.raw_entry_id
    WHERE j.kind='compensation' AND j.direction='credit' AND j.billing_account_id=c.billing_account_id
      AND EXISTS(SELECT 1 FROM billing_operations bo WHERE bo.id=j.operation_id AND bo.action='billing.refund')
  )
  SELECT statement_timestamp() AS as_of,(SELECT count(*)::int FROM candidate) AS candidate_count,
    (SELECT count(*)::int FROM bounded_ops) AS operation_count,
    coalesce((SELECT jsonb_agg(to_jsonb(b)||jsonb_build_object(
      'confirmed_micros',(SELECT coalesce(sum(-c.amount_micros),0)::text FROM charges c WHERE c.work_id=b.id AND c.work_kind=b.kind),
      'refunded_micros',(SELECT coalesce(sum(r.amount_micros),0)::text FROM refunds r WHERE r.work_id=b.id AND r.work_kind=b.kind),
      'reserved_micros',CASE WHEN b.kind='task' THEN coalesce((SELECT amount_micros::text FROM reservations h WHERE h.task_id=b.id AND h.status='reserved'),'0') ELSE coalesce((SELECT amount_micros::text FROM cloud_runtime_holds h WHERE h.session_id=b.id AND h.state='reserved'),'0') END,
      'reconciliation_hold_micros',CASE WHEN b.kind='task' THEN coalesce((SELECT amount_micros::text FROM reservations h WHERE h.task_id=b.id AND h.status='reconciling'),'0') ELSE coalesce((SELECT amount_micros::text FROM cloud_runtime_holds h WHERE h.session_id=b.id AND h.state='reconciling'),'0') END,
      'operations',coalesce((SELECT jsonb_agg(to_jsonb(o)-'work_id' ORDER BY o.created_at,o.id,o.channel) FROM bounded_ops o WHERE b.kind='task' AND o.work_id=b.id),'[]'::jsonb),
      'ledger',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'kind','charge','amount_micros',c.amount_micros::text,'operation_id',c.operation_id,'created_at',c.created_at) ORDER BY c.created_at,c.id) FROM charges c WHERE c.work_id=b.id AND c.work_kind=b.kind),'[]'::jsonb),
      'refunds',coalesce((SELECT jsonb_agg((to_jsonb(r)-ARRAY['work_id','work_kind'])||jsonb_build_object('amount_micros',r.amount_micros::text) ORDER BY r.created_at,r.id) FROM refunds r WHERE r.work_id=b.id AND r.work_kind=b.kind),'[]'::jsonb)
    ) ORDER BY b.created_at DESC,b.id DESC,b.kind) FROM selected b),'[]'::jsonb) AS works`, s.values)).rows[0];
  if (result.candidate_count > usageReportLimit.works || result.operation_count > usageReportLimit.operations)
    throw new Problem(413, "USAGE_REPORT_TOO_LARGE", "Narrow the work creation period, user or project; reports never truncate totals");
  for (const w of result.works) {
    w.unresolved = w.state === "reconciling" || w.reconciliation_hold_micros !== "0" || w.operations.some((o: any) => ["unknown", "reconciling", "dispatched", "submitting", "in_progress"].includes(o.state));
    if (w.internal_readable) w.internal_cost = { amount_micros: null, state: "not_recorded" };
    delete w.internal_readable;
  }
  return { as_of: new Date(result.as_of).toISOString(), works: result.works };
}
