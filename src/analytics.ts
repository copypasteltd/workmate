import { z } from "zod";
import { parse } from "csv-parse/sync";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db.js";
import { requireUser } from "./auth.js";
import { projectAccess } from "./access.js";
import { name, Problem, uuid, csvCell } from "./lib.js";
export const metricRow = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (s) =>
          !Number.isNaN(Date.parse(s)) &&
          new Date(s).toISOString().startsWith(s),
      ),
    channel: z.string().min(1).max(80),
    campaign: z.string().max(200).default(""),
    impressions: z.number().int().nonnegative().max(1e12),
    clicks: z.number().int().nonnegative().max(1e12),
    spend_micros: z.number().int().nonnegative().max(1e12),
    conversions: z.number().finite().nonnegative().max(1e9),
    revenue_micros: z.number().int().nonnegative().max(1e12),
  })
  .strict()
  .refine((r) => r.clicks <= r.impressions, "Clicks cannot exceed impressions");
export type MetricRow = z.infer<typeof metricRow>;
export function metrics(rows: MetricRow[]) {
  const t = rows.reduce(
    (a, r) => ({
      impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks,
      spend_micros: a.spend_micros + r.spend_micros,
      conversions: a.conversions + r.conversions,
      revenue_micros: a.revenue_micros + r.revenue_micros,
    }),
    {
      impressions: 0,
      clicks: 0,
      spend_micros: 0,
      conversions: 0,
      revenue_micros: 0,
    },
  );
  if (
    ![t.impressions, t.clicks, t.spend_micros, t.revenue_micros].every(
      Number.isSafeInteger,
    )
  )
    throw new Problem(
      400,
      "DATASET_TOO_LARGE",
      "Totals exceed exact integer limits",
    );
  return {
    ...t,
    ctr: t.impressions ? t.clicks / t.impressions : null,
    cpc_micros: t.clicks ? t.spend_micros / t.clicks : null,
    cpa_micros: t.conversions ? t.spend_micros / t.conversions : null,
    roas: t.spend_micros ? t.revenue_micros / t.spend_micros : null,
    conversion_rate: t.clicks ? t.conversions / t.clicks : null,
  };
}
export function decimalMicros(s: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(s.trim()))
    throw new Problem(
      400,
      "INVALID_AMOUNT",
      "Use a non-negative amount with at most six decimal places",
    );
  const [whole, fraction = ""] = s.trim().split(".");
  const n = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  if (n > 1000000000000n)
    throw new Problem(400, "INVALID_AMOUNT", "Amount is too large");
  return Number(n);
}
export function parseMetricsCSV(csv: string) {
  let rows: any[];
  try {
    rows = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      max_record_size: 10000,
    });
  } catch {
    throw new Problem(400, "CSV_INVALID", "CSV could not be parsed");
  }
  if (!rows.length || rows.length > 10000)
    throw new Problem(400, "CSV_SIZE", "Upload between 1 and 10,000 rows");
  const required = [
    "date",
    "channel",
    "impressions",
    "clicks",
    "spend",
    "conversions",
    "revenue",
  ];
  if (!required.every((k) => Object.hasOwn(rows[0], k)))
    throw new Problem(
      400,
      "CSV_COLUMNS",
      "Required columns: " + required.join(", "),
    );
  const currencies = new Set(rows.map((r) => r.currency || "HKD"));
  if (currencies.size !== 1)
    throw new Problem(
      400,
      "MIXED_CURRENCIES",
      "Keep each currency in a separate dataset",
    );
  return {
    currency: String([...currencies][0]),
    rows: rows.map((r) =>
      metricRow.parse({
        date: r.date,
        channel: r.channel,
        campaign: r.campaign ?? "",
        impressions: Number(r.impressions),
        clicks: Number(r.clicks),
        spend_micros: decimalMicros(r.spend),
        conversions: Number(r.conversions),
        revenue_micros: decimalMicros(r.revenue),
      }),
    ),
  };
}
export function registerAnalytics(app: FastifyInstance, db: Database) {
  const base = "/v1/tenants/:tenant/projects/:project/analytics";
  const params = z.object({ tenant: uuid, project: uuid });
  app.get(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      const items = (
        await tx.query(
          "SELECT * FROM analytics_datasets WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100",
          [project],
        )
      ).rows;
      return {
        items: items.map((d) => ({
          ...d,
          row_count: d.rows.length,
          summary: metrics(d.rows),
          rows: undefined,
        })),
      };
    }, tenant);
  });
  app.post(base + "/import", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const b = z
      .object({
        name,
        csv: z.string().min(1).max(5_000_000),
        timezone: z.string().default("Asia/Hong_Kong"),
      })
      .strict()
      .parse(req.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: b.timezone }).format();
    } catch {
      throw new Problem(400, "INVALID_TIMEZONE", "Unknown timezone");
    }
    const data = parseMetricsCSV(b.csv);
    if (!/^[A-Z]{3}$/.test(data.currency))
      throw new Problem(400, "INVALID_CURRENCY", "Use an ISO currency code");
    metrics(data.rows);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "write");
      const d = (
        await tx.query(
          "INSERT INTO analytics_datasets(tenant_id,project_id,name,currency,timezone,rows,source,created_by) VALUES($1,$2,$3,$4,$5,$6,'csv_upload',$7) RETURNING id,name,currency,timezone,source,created_at",
          [
            tenant,
            project,
            b.name,
            data.currency,
            b.timezone,
            JSON.stringify(data.rows),
            req.principal.id,
          ],
        )
      ).rows[0];
      return { ...d, row_count: data.rows.length, summary: metrics(data.rows) };
    }, tenant);
  });
  app.get(base + "/:dataset", { preHandler: requireUser(db) }, async (req) => {
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
      const channels = [...new Set(d.rows.map((r: MetricRow) => r.channel))];
      return {
        ...d,
        summary: metrics(d.rows),
        channels: channels.map((c) => ({
          channel: c,
          ...metrics(d.rows.filter((r: MetricRow) => r.channel === c)),
        })),
      };
    }, tenant);
  });
  app.get(
    base + "/:dataset/export",
    { preHandler: requireUser(db) },
    async (req, reply) => {
      const { tenant, project, dataset } = params
        .extend({ dataset: uuid })
        .parse(req.params);
      const d = await db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        return (
          await tx.query(
            "SELECT * FROM analytics_datasets WHERE id=$1 AND project_id=$2",
            [dataset, project],
          )
        ).rows[0];
      }, tenant);
      if (!d) throw new Problem(404, "NOT_FOUND", "Dataset not found");
      const fields = [
        "date",
        "channel",
        "campaign",
        "impressions",
        "clicks",
        "spend_micros",
        "conversions",
        "revenue_micros",
      ];
      const csv = [
        fields.map(csvCell).join(","),
        ...d.rows.map((r: any) => fields.map((f) => csvCell(r[f])).join(",")),
      ].join("\r\n");
      return reply
        .type("text/csv; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="analytics.csv"')
        .send("\ufeff" + csv);
    },
  );
}
