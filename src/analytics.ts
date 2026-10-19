import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import { requireUser } from "./auth.js";
import { projectAccess } from "./access.js";
import { name, Problem, uuid, csvCell, hash, canonical } from "./lib.js";
import {
  importOptions,
  normalizeMetricsCSV,
  inspectMetricsCSV,
} from "./analytics-import.js";
import {
  metrics,
  FORMULA_VERSION,
  type MetricRow,
} from "./metric-calculator.js";
export {
  metricRow,
  metrics,
  decimalMicros,
  type MetricRow,
} from "./metric-calculator.js";
export const parseMetricsCSV = normalizeMetricsCSV;

const input = importOptions
  .extend({ name, csv: z.string().min(1).max(5_000_000) })
  .strict();
function grouped<K extends "date" | "channel">(rows: MetricRow[], field: K) {
  const groups = new Map<string, MetricRow[]>();
  for (const row of rows) {
    const group = groups.get(row[field]);
    if (group) group.push(row);
    else groups.set(row[field], [row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, values]) =>
        ({ [field]: key, ...metrics(values) }) as Record<K, string> &
          ReturnType<typeof metrics>,
    );
}
/** Stable evidence IDs derive from the immutable dataset identity and metric.
 * They refer to this exact snapshot, never to a moving dashboard total. */
export function analyticsEvidence(d: any) {
  const m: ReturnType<typeof metrics> =
    d.metric_snapshot?.summary || metrics(d.rows);
  const formulaVersion = m.calculation.formula_version;
  const provenance = {
    snapshot_id: d.id,
    source: d.source,
    source_sha256: d.source_sha256 || null,
    spec_hash: d.spec_hash || null,
    data_as_of: null, // A CSV does not prove when the platform extracted it.
    captured_at: d.created_at,
    date_range: d.import_spec?.date_range || null,
    source_available:
      d.source_available ?? (d.raw_csv !== null && d.raw_csv !== undefined),
    definition: d.import_spec || null,
    legacy_scope_unverified: !d.import_spec,
    metrics_frozen: !!d.metric_snapshot,
  };
  const money = new Set(["spend", "conversion_value", "cpc", "cpm", "cpa"]);
  const evidence = Object.entries(m.exact).map(([metric_id, value]) => {
    const h = hash(
      canonical({ snapshot: d.id, metric_id, formula: formulaVersion }),
    );
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    return {
      id,
      snapshot_id: d.id,
      metric_id,
      value,
      unit: money.has(metric_id)
        ? d.currency
        : ["ctr", "cvr", "roas"].includes(metric_id)
          ? "ratio"
          : "count",
      formula_version: formulaVersion,
      scope: canonical({
        project_id: d.project_id,
        currency: d.currency,
        timezone: d.timezone,
        spec_hash: d.spec_hash || null,
      }),
      null_reason: m.null_reasons[metric_id] || null,
    };
  });
  return { ...m, provenance, evidence };
}
export async function persistDatasetEvidence(tx: Tx, d: any) {
  await tx.query(
    `INSERT INTO dataset_evidence(id,tenant_id,project_id,dataset_id,body)
     SELECT (e->>'id')::uuid,$1,$2,$3,e FROM jsonb_array_elements($4::jsonb) e ON CONFLICT(id) DO NOTHING`,
    [
      d.tenant_id,
      d.project_id,
      d.id,
      JSON.stringify(analyticsEvidence(d).evidence),
    ],
  );
}
function publicDataset(d: any, details = false) {
  const {
    raw_csv: _raw,
    rows,
    import_key: _key,
    metric_snapshot: _snapshot,
    ...rest
  } = d;
  return {
    ...rest,
    source_available:
      d.source_available ?? (d.raw_csv !== null && d.raw_csv !== undefined),
    row_count: d.row_count ?? rows.length,
    summary: analyticsEvidence(d),
    ...(details
      ? {
          rows,
          channels: d.metric_snapshot?.channels || grouped(rows, "channel"),
          daily: d.metric_snapshot?.daily || grouped(rows, "date"),
        }
      : {}),
  };
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function analyticsChart(d: any) {
  const all: ReturnType<typeof grouped<"channel">> = [
    ...(d.metric_snapshot?.channels || grouped(d.rows, "channel")),
  ].sort(
    (a, b) =>
      b.spend_micros - a.spend_micros ||
      String(a.channel).localeCompare(String(b.channel)),
  );
  const data = all.slice(0, 20),
    max = Math.max(1, ...data.map((r) => r.spend_micros));
  const bars = data
    .map(
      (r, i) =>
        `<text x="32" y="${124 + i * 45}" font-size="14">${escape(String(r.channel).slice(0, 36))}</text><rect x="310" y="${106 + i * 45}" width="${Math.round((r.spend_micros / max) * 430)}" height="25" rx="5" fill="#fdcdb7"/><text x="760" y="${124 + i * 45}" font-size="14">${r.exact.spend} ${escape(d.currency)}</text>`,
    )
    .join("");
  const height = 175 + data.length * 45;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}" role="img" aria-labelledby="title desc"><title id="title">Ad spend by channel</title><desc id="desc">${escape(d.currency)}; ${data.length} of ${all.length} channels; snapshot ${d.id}</desc><rect width="100%" height="100%" fill="#fffdfb"/><g font-family="Microsoft JhengHei, Arial, sans-serif" fill="#242424"><text x="32" y="42" font-size="25" font-weight="700">Ad spend by channel</text><text x="32" y="71" font-size="13">${escape(d.currency)} · ${escape(d.timezone)} · ${data.length} of ${all.length} channels</text>${bars}<text x="32" y="${height - 42}" font-size="11">Snapshot ${d.id} · formula ${d.metric_snapshot?.summary?.calculation?.formula_version || FORMULA_VERSION}</text><text x="32" y="${height - 22}" font-size="11">Source SHA-256 ${d.source_sha256 || "unavailable for legacy data"}</text></g></svg>`;
}
export function registerAnalytics(app: FastifyInstance, db: Database) {
  const base = "/v1/tenants/:tenant/projects/:project/analytics";
  const params = z.object({ tenant: uuid, project: uuid });
  app.get(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      const rows = (
        await tx.query(
          `SELECT id,tenant_id,project_id,name,currency,timezone,source,created_by,created_at,
            source_filename,source_sha256,spec_hash,import_spec,import_metadata,content_state,moderation_version,retention_expires_at,
            (raw_csv IS NOT NULL) AS source_available,jsonb_array_length(rows) AS row_count,
            CASE WHEN metric_snapshot IS NULL THEN rows ELSE '[]'::jsonb END AS rows,
            CASE WHEN metric_snapshot IS NULL THEN NULL ELSE jsonb_build_object('summary',metric_snapshot->'summary') END AS metric_snapshot
            FROM analytics_datasets WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,
          [project],
        )
      ).rows;
      return { items: rows.map((d) => publicDataset(d)) };
    }, tenant);
  });
  app.post(base + "/preview", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const b = input.parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "write");
      const { name: _name, csv, ...options } = b;
      const { rows, import_key, ...preview } = normalizeMetricsCSV(
        csv,
        options,
      );
      const existing = (
        await tx.query(
          "SELECT id FROM analytics_datasets WHERE project_id=$1 AND import_key=$2",
          [project, import_key],
        )
      ).rows[0];
      return {
        ...preview,
        sample: rows.slice(0, 5),
        existing_dataset_id: existing?.id || null,
      };
    }, tenant);
  });
  app.post(base + "/inspect", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const b = z
      .object({ csv: z.string().min(1).max(5_000_000) })
      .strict()
      .parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "write");
      return inspectMetricsCSV(b.csv);
    }, tenant);
  });
  app.post(base + "/import", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const b = input.parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "write");
      const { name, csv, ...options } = b;
      const data = normalizeMetricsCSV(csv, options);
      const created = (
        await tx.query(
          `INSERT INTO analytics_datasets(tenant_id,project_id,name,currency,timezone,rows,source,created_by,raw_csv,source_filename,source_sha256,import_key,spec_hash,import_spec,import_metadata,metric_snapshot)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT(tenant_id,project_id,import_key) WHERE import_key IS NOT NULL AND content_state<>'deleted' DO NOTHING RETURNING *`,
          [
            tenant,
            project,
            name,
            data.currency,
            data.timezone,
            JSON.stringify(data.rows),
            data.source,
            req.principal.id,
            csv,
            data.source_filename,
            data.source_sha256,
            data.import_key,
            data.spec_hash,
            JSON.stringify(data.spec),
            JSON.stringify({
              input_row_count: data.input_row_count,
              duplicate_row_count: data.duplicate_row_count,
              warnings: data.warnings,
              warning_codes: data.warning_codes,
            }),
            JSON.stringify({
              summary: data.summary,
              channels: grouped(data.rows, "channel"),
              daily: grouped(data.rows, "date"),
            }),
          ],
        )
      ).rows[0];
      const d =
        created ||
        (
          await tx.query(
            "SELECT * FROM analytics_datasets WHERE project_id=$1 AND import_key=$2",
            [project, data.import_key],
          )
        ).rows[0];
      if (!d)
        throw new Problem(
          409,
          "IMPORT_UNAVAILABLE",
          "This import is unavailable; ask a workspace administrator to review its content status",
        );
      await persistDatasetEvidence(tx, d);
      return { ...publicDataset(d), duplicate: !created };
    }, tenant);
  });
  async function dataset(req: any) {
    const { tenant, project, dataset } = params
      .extend({ dataset: uuid })
      .parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      const d = (
        await tx.query(
          "SELECT * FROM analytics_datasets WHERE id=$1 AND project_id=$2",
          [dataset, project],
        )
      ).rows[0];
      if (!d) throw new Problem(404, "NOT_FOUND", "Dataset not found");
      return d;
    }, tenant);
  }
  app.get(base + "/:dataset", { preHandler: requireUser(db) }, async (req) =>
    publicDataset(await dataset(req), true),
  );
  app.get(
    base + "/:dataset/report",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const d = await dataset(req);
      return reply
        .type("application/json; charset=utf-8")
        .header(
          "Content-Disposition",
          'attachment; filename="analytics-report.json"',
        )
        .send({
          schema_version: "campaign-report/1.0",
          snapshot_id: d.id,
          data_as_of: null,
          captured_at: d.created_at,
          date_range: d.import_spec?.date_range || null,
          currency: d.currency,
          timezone: d.timezone,
          definition: d.import_spec || null,
          summary: analyticsEvidence(d),
          channels: d.metric_snapshot?.channels || grouped(d.rows, "channel"),
          daily: d.metric_snapshot?.daily || grouped(d.rows, "date"),
          limitations: [
            ...(d.import_metadata?.warnings || []),
            "Platform-reported attribution is not cross-platform deduplicated conversions. No FX or causal inference applied.",
          ],
        });
    },
  );
  app.get(
    base + "/:dataset/chart",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const d = await dataset(req);
      return reply
        .type("image/svg+xml; charset=utf-8")
        .header(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'",
        )
        .header(
          "Content-Disposition",
          'attachment; filename="analytics-chart.svg"',
        )
        .send(analyticsChart(d));
    },
  );
  app.get(
    base + "/:dataset/source",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const d = await dataset(req);
      if (d.raw_csv === null)
        throw new Problem(
          404,
          "SOURCE_UNAVAILABLE",
          "Original source was not retained for this legacy dataset",
        );
      const bytes = Buffer.from(d.raw_csv, "utf8");
      if (hash(bytes) !== d.source_sha256)
        throw new Problem(
          409,
          "SOURCE_INTEGRITY_FAILED",
          "Source checksum verification failed",
        );
      return reply
        .type("application/octet-stream")
        .header("X-Content-Type-Options", "nosniff")
        .header(
          "Content-Disposition",
          'attachment; filename="campaign-source.csv"',
        )
        .header("X-Content-SHA256", d.source_sha256)
        .send(bytes);
    },
  );
  app.get(
    base + "/:dataset/export",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const d = await dataset(req);
      const fields = [
        "date",
        "channel",
        "campaign",
        "entity_id",
        "impressions",
        "clicks",
        "spend",
        "conversions",
        "revenue",
        "currency",
      ];
      const money = (v: number | null) =>
        v === null
          ? ""
          : `${Math.floor(v / 1000000)}.${String(v % 1000000).padStart(6, "0")}`;
      const csv = [
        fields.map(csvCell).join(","),
        ...d.rows.map((row: MetricRow) => {
          const r = {
            ...row,
            spend: money(row.spend_micros),
            revenue: money(row.revenue_micros),
            currency: d.currency,
          };
          return fields.map((f) => csvCell(r[f as keyof typeof r])).join(",");
        }),
      ].join("\r\n");
      return reply
        .type("text/csv; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="analytics.csv"')
        .send("\ufeff" + csv);
    },
  );
}
