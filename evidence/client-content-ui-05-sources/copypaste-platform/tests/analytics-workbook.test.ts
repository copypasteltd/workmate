import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignFile, normalizeCampaignFile } from "../src/analytics-file.js";
import { normalizeMetricsCSV } from "../src/analytics-import.js";
import { readWorkbook } from "../src/analytics-workbook.js";
import { Problem, hash } from "../src/lib.js";
import {
  packWorkbook,
  campaignWorkbook,
  workbookParts,
  stringCell,
  numericCell,
} from "./workbook-fixtures.js";
const options = {
  currency: "HKD",
  timezone: "Asia/Hong_Kong",
  account_id: "A",
  attribution_definition: "7d click",
  conversion_definition: "Purchase",
};
const rejects = (run: () => unknown, match: RegExp, path?: string) =>
  assert.throws(
    run,
    (e: unknown) =>
      e instanceof Problem &&
      e.status === 400 &&
      match.test(e.message) &&
      (!path || (e.details as any)?.[0]?.path === path),
  );
test("XLSX sparse rows, multiline strings and stored decimals retain exact money and actual file identity", () => {
  const bytes = packWorkbook(campaignWorkbook("1.00125E+2"));
  const d = normalizeCampaignFile(bytes, "export.xlsx", options);
  assert.equal(d.row_count, 1);
  assert.equal(d.rows[0].campaign, "Launch\n香港");
  assert.equal(d.summary.exact.spend, "100.12500000");
  assert.equal(d.summary.exact.conversions, "4.50000000");
  assert.equal(d.source_sha256, hash(bytes));
  assert.equal((d.spec as any).file?.worksheet, "Campaigns");
  assert.equal(d.raw_csv, null);
});
test("XML numeric references preserve Unicode and attributes without recursive decoding or invalid-codepoint removal", () => {
  const original = campaignWorkbook();
  const replacement = (content: string) => ({
    ...original,
    "xl/workbook.xml": original["xl/workbook.xml"].replace(
      'name="Campaigns"',
      'name="&#39321;&#28207;"',
    ),
    "xl/worksheets/sheet1.xml": original["xl/worksheets/sheet1.xml"].replace(
      stringCell("C7", "Launch\n香港"),
      `<c r="C7" t="inlineStr"><is><t>${content}</t></is></c>`,
    ),
  });
  const result = normalizeCampaignFile(
    packWorkbook(
      replacement(
        "&#39321;&#x6e2f; &amp; &lt; &gt; &quot; &apos; &#x1f600; &amp;#39321;",
      ),
    ),
    "unicode.xlsx",
    options,
  );
  assert.equal(result.rows[0].campaign, "香港 & < > \" ' 😀 &#39321;");
  assert.equal((result.spec as any).file.worksheet, "香港");
  assert.equal(
    normalizeCampaignFile(
      packWorkbook(replacement("<![CDATA[&#39321; & literal]]>")),
      "cdata.xlsx",
      options,
    ).rows[0].campaign,
    "&#39321; & literal",
  );
  for (const value of [
    "&#0;",
    "&#xD800;",
    "&#xFFFE;",
    "&#1114112;",
    "&#12x;",
    "&#x;",
    "&bogus;",
  ])
    rejects(
      () => readWorkbook(packWorkbook(replacement(value))),
      /character reference|Malformed XML/,
    );
});
test("shared rich strings preserve labels and worksheet choices are explicit", () => {
  const parts = campaignWorkbook();
  parts["xl/_rels/workbook.xml.rels"] = parts[
    "xl/_rels/workbook.xml.rels"
  ].replace(
    "</Relationships>",
    '<Relationship Id="shared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
  );
  parts["xl/sharedStrings.xml"] =
    "<sst><si><r><t>Long </t></r><r><t>campaign</t></r></si></sst>";
  parts["xl/worksheets/sheet1.xml"] = parts["xl/worksheets/sheet1.xml"].replace(
    stringCell("C7", "Launch\n香港"),
    '<c r="C7" t="s"><v>0</v></c>',
  );
  assert.equal(
    normalizeCampaignFile(packWorkbook(parts), "rich.xlsx", options).rows[0]
      .campaign,
    "Long campaign",
  );
  const multi = workbookParts([
    { name: "First", xml: '<row r="1">' + stringCell("A1", "date") + "</row>" },
    {
      name: "Second",
      xml: '<row r="1">' + stringCell("A1", "date") + "</row>",
    },
    { name: "Hidden", xml: "", hidden: true },
  ]);
  const info = campaignFile(packWorkbook(multi), "multi.xlsx");
  assert.equal(info.headers, null);
  assert.equal(info.sheets.length, 3);
  rejects(
    () => normalizeCampaignFile(packWorkbook(multi), "multi.xlsx", options),
    /Choose the worksheet/,
  );
  rejects(
    () => readWorkbook(packWorkbook(multi), "Hidden"),
    /visible worksheet/,
  );
});
test("1900 and 1904 dates have explicit calendar behavior and invalid date serials are rejected", () => {
  for (const [serial, system, expected] of [
    ["1", false, "1900-01-01"],
    ["61", false, "1900-03-01"],
    ["0", true, "1904-01-01"],
  ] as const) {
    const parts = workbookParts(
      [
        {
          name: "Dates",
          xml:
            '<row r="1">' +
            stringCell("A1", "date") +
            '</row><row r="2">' +
            numericCell("A2", serial, 1) +
            "</row>",
        },
      ],
      system,
    );
    assert.equal(
      readWorkbook(packWorkbook(parts)).csv,
      `"date"\n"${expected}"\n`,
    );
  }
  for (const serial of ["60", "1.5", "-1"]) {
    const p = workbookParts([
      {
        name: "Dates",
        xml:
          '<row r="1">' +
          stringCell("A1", "date") +
          '</row><row r="2">' +
          numericCell("A2", serial, 1) +
          "</row>",
      },
    ]);
    rejects(() => readWorkbook(packWorkbook(p)), /date|whole-day/i, "Dates!A2");
  }
});
test("header selection and hidden rows are retained; row errors refer to the original cell after multiline records", () => {
  const parts = campaignWorkbook();
  parts["xl/worksheets/sheet1.xml"] = parts["xl/worksheets/sheet1.xml"]
    .replace('r="1"', 'r="3"')
    .replaceAll(/([A-J])1"/g, '$13"')
    .replace('<row r="7">', '<row r="7" hidden="1">')
    .replace(numericCell("F7", "100.125"), stringCell("F7", "invalid"));
  rejects(
    () =>
      normalizeCampaignFile(packWorkbook(parts), "bad.xlsx", options, {
        header_row: 3,
      }),
    /non-negative decimal/,
    "Campaigns!F7 (spend)",
  );
  parts["xl/worksheets/sheet1.xml"] = parts["xl/worksheets/sheet1.xml"].replace(
    stringCell("F7", "invalid"),
    numericCell("F7", "100.125"),
  );
  const d = normalizeCampaignFile(packWorkbook(parts), "hidden.xlsx", options, {
    header_row: 3,
  });
  assert.ok(d.warning_codes.includes("hidden_rows_included"));
  assert.equal(d.row_count, 1);
});
test("formula cells never use cached results; external links, macros, DTD and bad styles fail closed", () => {
  const attacks = [
    (p: Record<string, string>) =>
      (p["xl/worksheets/sheet1.xml"] = p["xl/worksheets/sheet1.xml"].replace(
        numericCell("F7", "100.125"),
        '<c r="F7"><f>WEBSERVICE("https://example.invalid")</f><v>100</v></c>',
      )),
    (p: Record<string, string>) =>
      (p["xl/_rels/workbook.xml.rels"] = p[
        "xl/_rels/workbook.xml.rels"
      ].replace(
        "</Relationships>",
        '<Relationship Id="external" Type="hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>',
      )),
    (p: Record<string, string>) => (p["xl/vbaProject.bin"] = "unexecuted"),
    (p: Record<string, string>) =>
      (p["xl/workbook.xml"] =
        '<!DOCTYPE workbook [<!ENTITY evil SYSTEM "file:///C:/Windows/win.ini">]>' +
        p["xl/workbook.xml"]),
    (p: Record<string, string>) =>
      (p["xl/worksheets/sheet1.xml"] = p["xl/worksheets/sheet1.xml"].replace(
        '<c r="F7">',
        '<c r="F7" s="99">',
      )),
  ];
  for (const attack of attacks) {
    const p = campaignWorkbook();
    attack(p);
    rejects(
      () => campaignFile(packWorkbook(p), "unsafe.xlsx"),
      /formula|external|macro|declarations|style/i,
    );
  }
});
test("ZIP integrity, traversal and expansion limits are validated before interpreting workbook XML", () => {
  const p = campaignWorkbook();
  p["../escape.xml"] = "<x/>";
  rejects(() => campaignFile(packWorkbook(p), "traversal.xlsx"), /Unsafe/);
  const corrupt = packWorkbook(campaignWorkbook());
  const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupt.writeUInt32LE(12_000_001, central + 24);
  rejects(() => campaignFile(corrupt, "large.xlsx"), /oversized/);
  const checksum = packWorkbook(campaignWorkbook());
  const start = checksum.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  checksum.writeUInt32LE(0, start + 16);
  rejects(() => campaignFile(checksum, "broken.xlsx"), /checksum/);
});
test("CSV file and legacy text imports share a snapshot identity; plain formula-like labels stay literal", () => {
  const csv =
    "date,channel,campaign,impressions,clicks,spend\n2026-10-01,Google,=1+1,100,10,1.125";
  const file = normalizeCampaignFile(Buffer.from(csv), "file.csv", options),
    text = normalizeMetricsCSV(csv, options);
  assert.equal(file.import_key, text.import_key);
  assert.equal(file.spec_hash, text.spec_hash);
  assert.equal(file.rows[0].campaign, "=1+1");
  assert.throws(
    () => campaignFile(Buffer.from([0xff, 0xfe]), "broken.csv"),
    /UTF-8/,
  );
  assert.throws(
    () => campaignFile(Buffer.from("xlsm"), "export.xlsm"),
    /Only UTF-8 CSV and standard XLSX/,
  );
});
