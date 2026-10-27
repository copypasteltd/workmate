import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const ownedRoot = path.resolve(".data/workbook-interop"),
  fixture = path.join(ownedRoot, randomUUID()),
  checks: { name: string; status: string; detail?: string }[] = [],
  sources: { file: string; sha256: string }[] = [];
let generator: unknown,
  cleaned = false;
try {
  const python = process.env.WORKBOOK_QA_PYTHON;
  assert.ok(
    python && path.isAbsolute(python),
    "Set WORKBOOK_QA_PYTHON to a native Python with openpyxl installed",
  );
  await mkdir(fixture, { recursive: true });
  await promisify(execFile)(
    python,
    [path.resolve("scripts/qa-workbook-fixture.py"), fixture],
    { windowsHide: true },
  );
  generator = JSON.parse(
    await readFile(path.join(fixture, "generator.json"), "utf8"),
  );
  const { campaignFile, normalizeCampaignFile } = await import(
    pathToFileURL(path.resolve("../copypaste-platform/src/analytics-file.ts"))
      .href
  );
  for (const system of ["1900", "1904"]) {
    const file = `openpyxl-${system}.xlsx`,
      bytes = await readFile(path.join(fixture, file));
    sources.push({
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const inspected = campaignFile(bytes, file, { header_row: 3 });
    assert.equal(inspected.selected_sheet, null);
    assert.equal(inspected.sheets.length, 3);
    const result = normalizeCampaignFile(
      bytes,
      file,
      { currency: "HKD", timezone: "Asia/Hong_Kong" },
      { sheet_name: "香港 Campaign facts", header_row: 3 },
    );
    assert.equal(result.row_count, 2);
    assert.deepEqual(
      result.rows.map((r: { date: string }) => r.date),
      ["2026-10-01", "2026-10-02"],
    );
    assert.equal(result.rows[0].campaign, "香港 Launch\nCampaign");
    assert.equal(result.summary.exact.spend, "100.12500100");
    assert.equal(result.summary.exact.conversion_value, "450.87625000");
    assert.equal(result.spec.file.date_system, system);
    assert.equal(result.source_sha256, sources.at(-1)!.sha256);
    assert.ok(result.warning_codes.includes("hidden_rows_included"));
    checks.push({
      name: `independent openpyxl ${system} workbook: explicit sheet/header, real date styles, exact decimals/scientific notation, sparse rows, merged introduction, Unicode and hidden-row warning`,
      status: "passed",
    });
  }
  const formula = await readFile(path.join(fixture, "openpyxl-formula.xlsx"));
  assert.throws(
    () =>
      normalizeCampaignFile(
        formula,
        "formula.xlsx",
        {},
        { sheet_name: "香港 Campaign facts", header_row: 3 },
      ),
    (e: any) =>
      e.status === 400 && e.details?.[0]?.path === "香港 Campaign facts!F7",
  );
  sources.push({
    file: "openpyxl-formula.xlsx",
    sha256: createHash("sha256").update(formula).digest("hex"),
  });
  checks.push({
    name: "a formula saved by the independent writer is rejected at its actual worksheet/cell",
    status: "passed",
  });
  const precision = await readFile(
    path.join(fixture, "openpyxl-invalid-precision.xlsx"),
  );
  assert.throws(
    () =>
      normalizeCampaignFile(
        precision,
        "precision.xlsx",
        {},
        { sheet_name: "香港 Campaign facts", header_row: 3 },
      ),
    (e: any) =>
      e.status === 400 &&
      e.details?.[0]?.path === "香港 Campaign facts!F8 (spend)" &&
      /six decimal/.test(e.message),
  );
  sources.push({
    file: "openpyxl-invalid-precision.xlsx",
    sha256: createHash("sha256").update(precision).digest("hex"),
  });
  checks.push({
    name: "seven-decimal source money is rejected with the actual workbook cell; the six-decimal input policy is preserved",
    status: "passed",
  });
} catch (e: any) {
  checks.push({
    name: "independent XLSX interoperability",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  const relative = path.relative(ownedRoot, fixture);
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  );
  await rm(fixture, { recursive: true, force: true });
  cleaned = true;
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/workbook-interop.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope:
          "Independent openpyxl XLSX writer compatibility; not the complete official platform-export matrix",
        generator,
        checks,
        sources,
        owned_fixture_cleaned: cleaned,
      },
      null,
      2,
    ) + "\n",
  );
}
