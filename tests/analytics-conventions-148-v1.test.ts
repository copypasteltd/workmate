import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignFile, normalizeCampaignFile } from "../src/analytics-file.js";
import { normalizeMetricsCSV } from "../src/analytics-import.js";
import { canonical, hash, Problem } from "../src/lib.js";
import {
  campaignWorkbook,
  packWorkbook,
  stringCell,
  numericCell,
} from "./workbook-fixtures.js";

const options = {
  currency: "HKD",
  timezone: "Asia/Hong_Kong",
  attribution_definition: "7d click",
  conversion_definition: "Purchase",
};
const csv = (
  day = "2026-10-01",
  spend = "1234.56",
  impressions = "12345",
  conversions = "4.5",
) =>
  `date,channel,campaign,impressions,clicks,spend,conversions,revenue\n${day},Google,Launch,"${impressions}",100,"${spend}","${conversions}",4500`;
const fails = (run: () => unknown, field: RegExp) =>
  assert.throws(
    run,
    (e: unknown) =>
      e instanceof Problem &&
      e.status === 400 &&
      field.test(JSON.stringify(e.details)),
  );

test("default and explicitly standard conventions retain the pre-upgrade frozen specification and identity", () => {
  const d = normalizeMetricsCSV(csv(), options);
  assert.deepEqual(d.spec, {
    normalizer_version: "campaign-csv/1.0",
    source: "csv_upload",
    mapping: {
      date: "date",
      channel: "channel",
      campaign: "campaign",
      impressions: "impressions",
      clicks: "clicks",
      spend: "spend",
      conversions: "conversions",
      revenue: "revenue",
    },
    currency: "HKD",
    timezone: "Asia/Hong_Kong",
    date_range: { from: "2026-10-01", to: "2026-10-01" },
    account_id: null,
    entity_level: "dataset",
    attribution_definition: "7d click",
    conversion_definition: "Purchase",
  });
  const explicit = normalizeMetricsCSV(csv(), {
    ...options,
    number_format: "dot_decimal",
    date_format: "iso",
  });
  assert.equal(explicit.spec_hash, d.spec_hash);
  assert.equal(explicit.import_key, d.import_key);
  assert.equal(
    normalizeCampaignFile(Buffer.from(csv()), "report.csv", options, {
      csv_delimiter: "comma",
      csv_encoding: "utf8",
      header_row: 1,
    }).import_key,
    d.import_key,
  );
});

test("explicit day and month order produce different immutable facts and import identities", () => {
  const a = normalizeMetricsCSV(csv("01/10/2026"), {
    ...options,
    date_format: "day_first",
  });
  const b = normalizeMetricsCSV(csv("01/10/2026"), {
    ...options,
    date_format: "month_first",
  });
  assert.equal(a.rows[0].date, "2026-10-01");
  assert.equal(b.rows[0].date, "2026-01-10");
  assert.notEqual(a.import_key, b.import_key);
  fails(() => normalizeMetricsCSV(csv("01/10/2026"), options), /row 2.date/);
});

test("grouping conventions preserve exact amounts, fractional conversions and absent values", () => {
  for (const [format, amount, count, conversion] of [
    ["dot_decimal", "1,234.56", "12,345", "4.5"],
    ["comma_decimal", "1.234,56", "12.345", "4,5"],
    ["space_dot", "1 234.56", "12 345", "4.5"],
    ["space_comma", "1\u202f234,56", "12\u00a0345", "4,5"],
  ] as const) {
    const d = normalizeMetricsCSV(
      csv("2026-10-01", amount, count, conversion),
      { ...options, number_format: format },
    );
    assert.equal(d.summary.exact.spend, "1234.56000000");
    assert.equal(d.summary.exact.impressions, "12345");
    assert.equal(d.summary.exact.conversions, "4.50000000");
  }
  const missing = normalizeMetricsCSV(
    csv("2026-10-01", "0", "0", "--"),
    options,
  );
  assert.equal(missing.rows[0].conversions, null);
  assert.equal(missing.summary.exact.cpa, null);
});

test("bad grouping, percentages, negative and oversized or excessive-precision money are rejected", () => {
  for (const v of [
    "12.34,56",
    "1,234.56",
    "10%",
    "-1,2",
    "1e3",
    "1,1234567",
    "1000001",
  ])
    fails(
      () =>
        normalizeMetricsCSV(csv("2026-10-01", v), {
          ...options,
          number_format: "comma_decimal",
        }),
      /row 2.spend/,
    );
  fails(
    () => normalizeMetricsCSV(csv("2026-10-01", "1", "12,34"), options),
    /row 2.impressions/,
  );
});

test("calendar validation handles leap years and Chinese dates without two-digit-year or overflow guesses", () => {
  assert.equal(
    normalizeMetricsCSV(csv("29/02/2024"), {
      ...options,
      date_format: "day_first",
    }).rows[0].date,
    "2024-02-29",
  );
  assert.equal(
    normalizeMetricsCSV(csv("2026年10月1日"), {
      ...options,
      date_format: "year_first",
    }).rows[0].date,
    "2026-10-01",
  );
  for (const v of ["29/02/2026", "31/04/2026", "01/10/26", "10/01-2026"])
    fails(
      () =>
        normalizeMetricsCSV(csv(v), { ...options, date_format: "day_first" }),
      /row 2.date/,
    );
});

test("daily reporting ends are compared after explicit date normalization", () => {
  const text =
    "date,date_end,channel,impressions,clicks,spend\n1/10/2026,2026-10-01,Google,1,1,1";
  assert.equal(
    normalizeMetricsCSV(text, { ...options, date_format: "day_first" })
      .row_count,
    1,
  );
  fails(
    () =>
      normalizeMetricsCSV(
        text.replace("2026-10-01,Google", "2026-10-02,Google"),
        { ...options, date_format: "day_first" },
      ),
    /row 2.date_end/,
  );
});

test("semicolon, intro rows and UTF16 retain original bytes and physical error rows", () => {
  const text =
    "Daily campaign export\r\nHong Kong / synthetic\r\ndate;channel;impressions;clicks;spend;conversions\r\n01/10/2026;Meta;1.000;10;1.234,56;4,5";
  const bytes = Buffer.concat([
    Buffer.from([255, 254]),
    Buffer.from(text, "utf16le"),
  ]);
  const selection = { header_row: 3, csv_delimiter: "semicolon" as const };
  const info = campaignFile(bytes, "meta.csv", selection);
  assert.equal(info.csv_encoding, "utf16le");
  assert.equal(info.input_row_count, 1);
  assert.equal(info.source_sha256, hash(bytes));
  const d = normalizeCampaignFile(
    bytes,
    "meta.csv",
    { ...options, number_format: "comma_decimal", date_format: "day_first" },
    selection,
  );
  assert.equal(d.source_sha256, hash(bytes));
  assert.equal(d.summary.exact.spend, "1234.56000000");
  assert.deepEqual((d.spec as any).file, {
    format: "csv",
    parser_version: "campaign-file/1.1",
    header_row: 3,
    encoding: "utf16le",
    delimiter: "semicolon",
  });
  const broken = Buffer.from(text.replace("1.234,56", "12.34,56"));
  fails(
    () =>
      normalizeCampaignFile(
        broken,
        "meta.csv",
        {
          ...options,
          number_format: "comma_decimal",
          date_format: "day_first",
        },
        selection,
      ),
    /row 4.spend/,
  );
  assert.throws(
    () =>
      campaignFile(bytes, "meta.csv", { ...selection, csv_encoding: "utf8" }),
    /conflicts/,
  );
});

test("tab and UTF16BE support BOM detection and exact source identity", () => {
  const text =
    "date\tchannel\timpressions\tclicks\tspend\n2026/10/1\tGoogle\t1000\t10\t1234.56";
  const utf16 = Buffer.from(text, "utf16le");
  utf16.swap16();
  const bytes = Buffer.concat([Buffer.from([254, 255]), utf16]);
  const d = normalizeCampaignFile(
    bytes,
    "tab.csv",
    { ...options, date_format: "year_first" },
    { csv_delimiter: "tab" },
  );
  assert.equal(d.rows[0].date, "2026-10-01");
  assert.equal(d.source_sha256, hash(bytes));
  assert.equal(d.summary.exact.spend, "1234.56000000");
  assert.throws(
    () => campaignFile(Buffer.from([255, 254, 65]), "odd.csv"),
    /encoding/,
  );
});

test("localized XLSX text and stored numbers share exact facts without reinterpreting numeric cells", () => {
  const base = campaignWorkbook();
  const xml = base["xl/worksheets/sheet1.xml"]
    .replace(stringCell("A7", "2026-10-01"), stringCell("A7", "01/10/2026"))
    .replace(numericCell("F7", "100.125"), stringCell("F7", "1.234,56"));
  const bytes = packWorkbook({ ...base, "xl/worksheets/sheet1.xml": xml });
  const d = normalizeCampaignFile(bytes, "mixed.xlsx", {
    ...options,
    date_format: "day_first",
    number_format: "comma_decimal",
  });
  assert.equal(d.rows[0].date, "2026-10-01");
  assert.equal(d.summary.exact.spend, "1234.56000000");
  assert.equal(d.summary.exact.conversions, "4.50000000");
  assert.equal(d.summary.exact.conversion_value, "450.00000000");
  assert.throws(
    () => campaignFile(bytes, "mixed.xlsx", { csv_delimiter: "tab" }),
    /do not apply/,
  );
});

test("CR and CRLF inside XLSX text do not shift canonical numeric cells or physical error locations", () => {
  for (const name of ["Launch\r香港", "Launch\r\n香港"]) {
    const base = campaignWorkbook("1.234");
    const xml = base["xl/worksheets/sheet1.xml"].replace(
      stringCell("C7", "Launch\n香港"),
      stringCell("C7", name)
        .replaceAll("\r", "&#13;")
        .replaceAll("\n", "&#10;"),
    );
    const d = normalizeCampaignFile(
      packWorkbook({ ...base, "xl/worksheets/sheet1.xml": xml }),
      "cr.xlsx",
      { ...options, number_format: "comma_decimal" },
    );
    assert.equal(d.summary.exact.spend, "1.23400000");
    assert.equal(d.summary.exact.conversions, "4.50000000");
    const broken = xml.replace(
      numericCell("F7", "1.234"),
      stringCell("F7", "bad"),
    );
    fails(
      () =>
        normalizeCampaignFile(
          packWorkbook({ ...base, "xl/worksheets/sheet1.xml": broken }),
          "cr.xlsx",
          { ...options, number_format: "comma_decimal" },
        ),
      /Campaigns!F7/,
    );
  }
});
