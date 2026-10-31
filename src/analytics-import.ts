import { parse } from "csv-parse/sync";
import { z } from "zod";
import { canonical, hash, Problem } from "./lib.js";
import {
  decimalMicros,
  metricRow,
  metrics,
  type MetricRow,
} from "./metric-calculator.js";

import {
  campaignNumber,
  campaignDate,
  numberFormat,
  dateFormat,
  type CsvLayout,
} from "./analytics-conventions.js";

export const NORMALIZER_VERSION = "campaign-csv/1.0";
const fields = [
  "date",
  "date_end",
  "channel",
  "campaign",
  "entity_id",
  "account_id",
  "impressions",
  "clicks",
  "spend",
  "conversions",
  "revenue",
  "currency",
] as const;
type Field = (typeof fields)[number];
export const importOptions = z
  .object({
    source: z
      .enum(["csv_upload", "google_ads", "meta_ads"])
      .default("csv_upload"),
    timezone: z.string().min(1).max(100).default("Asia/Hong_Kong"),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    account_id: z.string().trim().min(1).max(200).optional(),
    entity_level: z
      .enum(["dataset", "campaign", "adset", "ad"])
      .default("dataset"),
    attribution_definition: z.string().trim().min(1).max(1000).optional(),
    conversion_definition: z.string().trim().min(1).max(1000).optional(),
    number_format: numberFormat.optional(),
    date_format: dateFormat.optional(),
    mapping: z.partialRecord(z.enum(fields), z.string().max(200)).default({}),
    source_filename: z
      .string()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n\x00/\\]/.test(v))
      .default("campaign.csv"),
  })
  .strict();
export type ImportOptions = z.input<typeof importOptions>;
const aliases: Record<Field, string[]> = {
  date: [
    "date",
    "Day",
    "Date",
    "Reporting starts",
    "日期",
    "日",
    "報告開始日期",
  ],
  date_end: ["date_end", "Reporting ends", "報告結束日期"],
  channel: ["channel", "Channel", "渠道"],
  campaign: [
    "campaign",
    "Campaign",
    "Campaign name",
    "廣告活動",
    "行銷活動名稱",
  ],
  entity_id: [
    "entity_id",
    "Campaign ID",
    "Campaign id",
    "Ad set ID",
    "Ad ID",
    "廣告活動 ID",
    "行銷活動編號",
  ],
  account_id: [
    "account_id",
    "Customer ID",
    "Account ID",
    "Account id",
    "客戶 ID",
  ],
  impressions: ["impressions", "Impressions", "曝光次數", "曝光數"],
  clicks: [
    "clicks",
    "Clicks",
    "Link clicks",
    "Clicks (all)",
    "點擊次數",
    "連結點擊次數",
  ],
  spend: [
    "spend",
    "Cost",
    "Amount spent",
    "Amount spent (HKD)",
    "Amount spent (USD)",
    "費用",
    "花費金額 (HKD)",
  ],
  conversions: [
    "conversions",
    "Conversions",
    "Purchases",
    "轉換",
    "轉換次數",
    "購買次數",
  ],
  revenue: [
    "revenue",
    "Conv. value",
    "Conversion value",
    "Purchase conversion value",
    "轉換價值",
    "購買轉換值",
  ],
  currency: ["currency", "Currency", "Account currency", "貨幣", "幣別"],
};
function fail(
  line: number,
  column: string,
  message: string,
  code = "CSV_ROW_INVALID",
): never {
  throw new Problem(400, code, message, [
    { path: `row ${line}.${column}`, message },
  ]);
}
function csvRecords(csv: string, layout: CsvLayout = {}) {
  const invalid = csv.search(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u,
  );
  if (invalid >= 0)
    fail(
      csv.slice(0, invalid).split(/\r\n|\r|\n/).length,
      "csv",
      "CSV contains unsupported control characters or malformed Unicode",
      "CSV_INVALID",
    );
  if (Buffer.byteLength(csv, "utf8") > 5_000_000)
    throw new Problem(400, "CSV_SIZE", "CSV exceeds 5 MB");
  const offset = (layout.header_row ?? 1) - 1;
  // Report headings are plain text, not CSV records. Skip their physical lines
  // before the lexer so quotes in a heading cannot corrupt the selected table.
  let start = 0;
  const breaks = csv.matchAll(/\r\n|\r|\n/g);
  for (let n = 0; n < offset; n++) {
    const next = breaks.next();
    if (next.done)
      throw new Problem(
        400,
        "CSV_SIZE",
        "The selected header row is outside the file",
      );
    start = next.value.index! + next.value[0].length;
  }
  const text = csv.slice(start),
    bytes = Buffer.from(text, "utf8");
  let records: {
    record: string[];
    info: { lines: number; records: number; bytes: number };
  }[];
  try {
    records = parse(text, {
      columns: false,
      delimiter: layout.delimiter ?? ",",
      info: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      max_record_size: 10000,
    }) as unknown as typeof records;
  } catch (e: any) {
    fail(
      offset + (Number(e.lines) || 1),
      "csv",
      "CSV could not be parsed; check quoting and column counts",
      "CSV_INVALID",
    );
  }
  // Use consumed original UTF-8 byte positions, not the parser's line counter:
  // quoted CRLF increments that counter twice. Scan once for true physical rows.
  let cursor = 0,
    physical = offset + 1;
  for (const entry of records) {
    while (cursor < entry.info.bytes) {
      const byte = bytes[cursor];
      if (byte === 13 || (byte === 10 && bytes[cursor - 1] !== 13)) physical++;
      cursor++;
    }
    const last = bytes[cursor - 1];
    entry.info.lines = physical - (last === 10 || last === 13 ? 1 : 0);
  }
  const header = records.shift();
  if (!header || !records.length || records.length > 10000)
    throw new Problem(400, "CSV_SIZE", "Upload between 1 and 10,000 data rows");
  const headers = header.record;
  if (
    headers.length > 100 ||
    headers.some((h) => !h || h.length > 200) ||
    new Set(headers.map((h) => h.toLowerCase())).size !== headers.length
  )
    fail(
      header.info.lines,
      "headers",
      "Headers must be non-empty, unique and at most 200 characters",
      "CSV_COLUMNS",
    );
  return { headers, records, header };
}
export function inspectMetricsCSV(csv: string, layout: CsvLayout = {}) {
  const { headers, records } = csvRecords(csv, layout);
  return {
    headers,
    input_row_count: records.length,
    source_sha256: hash(Buffer.from(csv, "utf8")),
  };
}
export function normalizeMetricsCSV(
  csv: string,
  input: ImportOptions = {},
  layout: CsvLayout = {},
) {
  const options = importOptions.parse(input);
  try {
    new Intl.DateTimeFormat("en", { timeZone: options.timezone }).format();
  } catch {
    throw new Problem(400, "INVALID_TIMEZONE", "Unknown timezone");
  }
  if (
    options.source !== "csv_upload" &&
    (!options.account_id ||
      options.entity_level === "dataset" ||
      !options.attribution_definition ||
      !options.conversion_definition ||
      !options.currency)
  )
    throw new Problem(
      400,
      "IMPORT_DEFINITION_REQUIRED",
      "Platform exports require account, entity level, currency, attribution and conversion definitions",
    );
  const { headers, records, header } = csvRecords(csv, layout);
  const mapping: Partial<Record<Field, string>> = {};
  for (const field of fields) {
    if (Object.hasOwn(options.mapping, field)) {
      const column = options.mapping[field]!;
      if (column && !headers.includes(column))
        fail(
          header.info.lines,
          field,
          `Mapped column ${column} does not exist`,
          "CSV_COLUMNS",
        );
      if (column) mapping[field] = column;
    } else {
      const candidates =
        field === "entity_id" && options.source !== "csv_upload"
          ? options.entity_level === "campaign"
            ? [
                "entity_id",
                "Campaign ID",
                "Campaign id",
                "廣告活動 ID",
                "行銷活動編號",
              ]
            : options.entity_level === "adset"
              ? ["entity_id", "Ad set ID", "Ad set id", "廣告組合編號"]
              : ["entity_id", "Ad ID", "Ad id", "廣告編號"]
          : aliases[field];
      const matches = headers.filter((h) =>
        candidates.some((a) => a.toLowerCase() === h.toLowerCase()),
      );
      if (matches.length > 1)
        fail(
          header.info.lines,
          field,
          `Select one column for ${field}: ${matches.join(", ")}`,
          "CSV_MAPPING_AMBIGUOUS",
        );
      if (matches.length) mapping[field] = matches[0];
    }
  }
  const used = Object.values(mapping);
  if (new Set(used).size !== used.length)
    fail(
      header.info.lines,
      "mapping",
      "Each column can map to only one metric",
      "CSV_COLUMNS",
    );
  const required: Field[] = ["date", "impressions", "clicks", "spend"];
  if (options.source === "csv_upload") required.push("channel");
  else required.push("entity_id");
  for (const field of required)
    if (!mapping[field])
      fail(
        header.info.lines,
        field,
        `Map a column for ${field}`,
        "CSV_COLUMNS",
      );
  const declared = mapping.spend?.match(/\(([A-Z]{3})\)$/)?.[1];
  const currencies = new Set<string>();
  const rows: MetricRow[] = [],
    identities = new Map<string, { body: string; line: number }>();
  let duplicateRows = 0;
  let assumedCurrency = false;
  const accounts = new Set<string>();
  for (const { record, info } of records) {
    const get = (key: Field) =>
      mapping[key] ? (record[headers.indexOf(mapping[key]!)] ?? "") : "";
    const line = info.lines; // Physical final line of the CSV record, including multiline quoted fields.
    const dateValue = (field: "date" | "date_end") =>
      campaignDate(
        get(field),
        options.date_format ?? "iso",
        line,
        mapping[field] || field,
      );
    const date = dateValue("date");
    if (get("date_end") && dateValue("date_end") !== date)
      fail(
        line,
        mapping.date_end!,
        "Export daily rows; a multi-day total cannot be assigned to one date",
      );
    if (
      options.account_id &&
      get("account_id") &&
      get("account_id") !== options.account_id
    )
      fail(
        line,
        mapping.account_id!,
        "Account does not match the confirmed import scope",
      );
    if (get("account_id")) accounts.add(get("account_id"));
    if (accounts.size > 1)
      fail(
        line,
        mapping.account_id!,
        "Import one account per snapshot; split multi-account exports",
      );
    const statedCurrency = get("currency");
    if (!statedCurrency && !options.currency && !declared)
      assumedCurrency = true;
    const currency = statedCurrency || options.currency || declared || "HKD";
    if (
      !/^[A-Z]{3}$/.test(currency) ||
      (options.currency && currency !== options.currency) ||
      (declared && currency !== declared)
    )
      fail(
        line,
        mapping.currency || "currency",
        "Currency does not match the confirmed import scope",
        "MIXED_CURRENCIES",
      );
    currencies.add(currency);
    if (currencies.size > 1)
      fail(
        line,
        mapping.currency || "currency",
        "Keep each currency in a separate dataset",
        "MIXED_CURRENCIES",
      );
    const value = (field: Field, nullable = false) =>
      campaignNumber(
        get(field),
        layout.canonical_cells
          ?.get(info.records)
          ?.has(headers.indexOf(mapping[field] || ""))
          ? "dot_decimal"
          : (options.number_format ?? "dot_decimal"),
        line,
        mapping[field] || field,
        nullable,
      );
    const money = (field: "spend" | "revenue", nullable = false) => {
      const v = value(field, nullable);
      if (v === null) return null;
      try {
        return decimalMicros(v);
      } catch (e) {
        fail(line, mapping[field] || field, (e as Error).message);
      }
    };
    const integer = (field: "impressions" | "clicks") => {
      const v = value(field)!;
      if (
        !/^\d+$/.test(v) ||
        !Number.isSafeInteger(Number(v)) ||
        Number(v) > 1e12
      )
        fail(
          line,
          mapping[field]!,
          "Use an integer between 0 and 1,000,000,000,000",
        );
      return Number(v);
    };
    const raw = {
      date,
      channel:
        get("channel") ||
        (options.source === "csv_upload"
          ? ""
          : options.source === "google_ads"
            ? "Google Ads"
            : "Meta Ads"),
      campaign: get("campaign"),
      ...(get("entity_id") ? { entity_id: get("entity_id") } : {}),
      impressions: integer("impressions"),
      clicks: integer("clicks"),
      spend_micros: money("spend")!,
      conversions: value("conversions", true),
      revenue_micros: money("revenue", true),
    };
    if (options.source !== "csv_upload" && !raw.entity_id)
      fail(
        line,
        mapping.entity_id!,
        "Entity ID is required for platform exports",
      );
    const checked = metricRow.safeParse(raw);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      fail(
        line,
        mapping[issue.path[0] as Field] || String(issue.path[0] || "clicks"),
        issue.message,
      );
    }
    const row = checked.data;
    const identity = canonical([
      row.date,
      row.channel,
      row.entity_id || row.campaign,
    ]);
    const body = canonical(row),
      prior = identities.get(identity);
    if (prior) {
      if (prior.body !== body)
        fail(
          line,
          "entity_id",
          `Conflicting rows at the same grain (previous record ends at line ${prior.line}); export one entity level or map entity_id`,
          "CSV_GRAIN_CONFLICT",
        );
      duplicateRows++;
      continue;
    }
    identities.set(identity, { body, line });
    rows.push(row);
  }
  const currency = [...currencies][0];
  const dates = rows.map((r) => r.date).sort();
  const spec = {
    normalizer_version:
      (options.number_format && options.number_format !== "dot_decimal") ||
      (options.date_format && options.date_format !== "iso")
        ? "campaign-csv/1.1"
        : NORMALIZER_VERSION,
    ...(options.number_format && options.number_format !== "dot_decimal"
      ? { number_format: options.number_format }
      : {}),
    ...(options.date_format && options.date_format !== "iso"
      ? { date_format: options.date_format }
      : {}),
    source: options.source,
    mapping,
    currency,
    timezone: options.timezone,
    date_range: { from: dates[0], to: dates.at(-1)! },
    account_id: options.account_id || [...accounts][0] || null,
    entity_level: options.entity_level,
    attribution_definition: options.attribution_definition || "not_provided",
    conversion_definition: options.conversion_definition || "not_provided",
  };
  const source_sha256 = hash(Buffer.from(csv, "utf8")),
    spec_hash = hash(canonical(spec));
  const warnings: string[] = [];
  const warning_codes: string[] = [];
  if (assumedCurrency)
    warnings.push(
      "Currency was assumed HKD; confirm before interpreting monetary values.",
    );
  if (!options.attribution_definition || !options.conversion_definition)
    warnings.push(
      "Attribution/conversion definitions were not provided; do not compare or deduplicate platform conversions.",
    );
  if (duplicateRows)
    warnings.push(`${duplicateRows} identical fact rows were skipped.`);
  if (rows.some((r) => r.conversions === null || r.revenue_micros === null))
    warnings.push(
      "Unavailable conversions/value remain unknown; dependent ratios are not calculated.",
    );
  if (assumedCurrency) warning_codes.push("assumed_currency");
  if (!options.attribution_definition || !options.conversion_definition)
    warning_codes.push("missing_definitions");
  if (duplicateRows) warning_codes.push("duplicate_rows");
  if (rows.some((r) => r.conversions === null || r.revenue_micros === null))
    warning_codes.push("unknown_conversions");
  return {
    rows,
    currency,
    timezone: options.timezone,
    source: options.source,
    headers,
    mapping,
    spec,
    spec_hash,
    source_sha256,
    import_key: hash(canonical({ source_sha256, spec_hash })),
    source_filename: options.source_filename,
    input_row_count: records.length,
    duplicate_row_count: duplicateRows,
    row_count: rows.length,
    warnings,
    warning_codes,
    summary: metrics(rows),
  };
}
