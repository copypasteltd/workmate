import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCampaignFile } from "../src/analytics-file.js";
import { Problem } from "../src/lib.js";
test("plain report headings are skipped before lexing and quoted CRLF retains actual physical error coordinates", () => {
  const csv =
    'Report "custom" heading\r\ndate,channel,campaign,impressions,clicks,spend\r\n01/10/2026,Google,"香港\r\nLaunch",1000,bad,100';
  assert.throws(
    () =>
      normalizeCampaignFile(
        Buffer.from(csv),
        "export.csv",
        { date_format: "day_first" },
        { header_row: 2 },
      ),
    (e: unknown) =>
      e instanceof Problem && /row 4.clicks/.test(JSON.stringify(e.details)),
  );
  const d = normalizeCampaignFile(
    Buffer.from(csv.replace(",bad,", ",10,")),
    "export.csv",
    { date_format: "day_first" },
    { header_row: 2 },
  );
  assert.equal(d.rows[0].date, "2026-10-01");
  assert.equal(d.summary.exact.spend, "100.00000000");
});
