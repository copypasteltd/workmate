import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import { verifyAdmin } from "./qa-auth.js";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
const { parse } = createRequire(path.resolve("../copypaste-platform/package.json"))("csv-parse/sync");
const fixture = JSON.parse(await readFile(process.argv[2], "utf8")), origin = "http://localhost:4318", root = process.cwd();
const receipt = "evidence/admin-posting-period-172/admin-ui-01.json", attempt = "admin-posting-period-172-01";
const scope = "Actual Admin OTP/TOTP and native SQL-backed posting-period reports: historical work, Hong Kong midnight groups, projected detail/CSV, refund-only negative net, refresh, legacy cohort and responsive layout. Explicit synthetic historical accounting facts; no supplier-cost, payment or full professional acceptance claim.";
const checks: any[] = [], screenshots: any[] = [], recordings: any[] = [], errors: string[] = [];
const sources = ["copypaste-admin/src/main.tsx", "copypaste-admin/src/usage-reports.tsx", "copypaste-admin/src/usage-reports.css", "copypaste-platform/src/admin.ts", "copypaste-platform/src/admin-usage-reports.ts", "copypaste-platform/src/admin-usage-report-model.ts", "copypaste-platform/src/admin-usage-report-query.ts"];
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async n => [n, sha(await readFile(path.resolve("..", n)))])));
const before = await hashes(); let browser: Browser | undefined, context: BrowserContext | undefined, recording: WorkmateRecording | undefined, browserClosed = false, stage = "initializing";
const match = (r: Response, p: string) => new URL(r.url()).pathname === p;
const reportRead = (r: Response) => /\/v1\/admin\/usage-reports\/[0-9a-f-]+$/.test(new URL(r.url()).pathname) && r.request().method() === "GET";
async function checked(r: Response) { const b = await r.json(); assert.equal(r.status(), 200, b.error?.message ?? String(r.status())); return b; }
const pass = (name: string, facts: unknown) => checks.push({ name, status: "passed", facts });
async function shot(page: Page, name: string) { await page.evaluate(async () => { await document.fonts.ready; }); screenshots.push(await saveWorkmateScreenshot("admin", attempt, name, await page.screenshot({ fullPage: true }), scope, root)); }
async function stopRecording() { if (!recording) return; const current = recording; recording = undefined; recordings.push(await current.stop()); }
const deadline = setTimeout(() => { errors.push("Owned browser deadline"); void browser?.close(); }, 240000);
try {
  browser = await chromium.launch({ executablePath: path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"), headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, timezoneId: "Asia/Hong_Kong", acceptDownloads: true }); context.setDefaultTimeout(16000);
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(String(e)));
  stage = "sign-in"; await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.locator('input[name="email"]').fill(fixture.admin.email);
  const [challengeResponse] = await Promise.all([page.waitForResponse(r => match(r, "/v1/admin/auth/challenge") && r.request().method() === "POST"), page.getByRole("button", { name: "Send admin sign-in code", exact: true }).click()]);
  const challenge = await checked(challengeResponse); let code: string | undefined;
  for (let n = 0; n < 100 && !code; n++) {
    try { const mail = JSON.parse(await readFile(path.join(fixture.mailbox, challenge.challenge_id + ".json"), "utf8")); assert.equal(mail.to, fixture.admin.email); code = mail.text.match(/\b\d{6}\b/)?.[0]; }
    catch (e: any) { if (e.code !== "ENOENT") throw e; }
    if (!code) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(code); await page.locator('input[name="code"]').fill(code); await verifyAdmin(page, fixture.admin.secret); await page.waitForURL(u => !["/", "/login"].includes(u.pathname));
  pass("Actual independent Admin OTP and TOTP", { authenticated: true });
  const query = new URLSearchParams({ user_id: fixture.user, time_basis: "ledger_posted_at", ...fixture.historicalFilters });
  await page.goto(origin + "/usage?" + query, { waitUntil: "domcontentloaded" });
  recording = new WorkmateRecording("admin", "posting-period-workflow", attempt, () => page.screenshot({ type: "jpeg", quality: 72 }), scope, root); await recording.start();
  stage = "create historical posting report";
  const [created] = await Promise.all([page.waitForResponse(reportRead), page.getByRole("button", { name: "Create fresh report", exact: true }).click()]); const report = await checked(created);
  assert.equal(report.time_basis, "ledger_posted_at"); assert.equal(report.total, 1); assert.equal(report.summary.confirmed_micros, "500003"); assert.equal(report.summary.refunded_micros, "100001"); assert.equal(report.summary.net_micros, "400002");
  await page.getByRole("heading", { name: "Work details 1", exact: true }).waitFor(); assert.equal(await page.locator(".usage-totals").first().getByText("Outside posted activity", { exact: true }).count(), 2);
  await page.getByText("Units describe the selected works' lifetime operations, not units newly used in this posting period. Do not add units across day groups.", { exact: true }).waitFor();
  await shot(page, "posting-01-period-summary"); pass("Posting selector includes historical works with separated holds and explicit lifetime units", { report_id: report.id, watermark: report.watermark, gross: "500003", refunds: "100001" });
  stage = "Hong Kong day projection"; await page.locator('[name="usage_group"]').selectOption("day");
  const [grouped] = await Promise.all([page.waitForResponse(r => reportRead(r) && new URL(r.url()).searchParams.get("group_key") === fixture.days[1]), page.locator("button.usage-group").filter({ hasText: fixture.days[1] }).click()]);
  const group = await checked(grouped); assert.equal(group.summary.confirmed_micros, "300002"); assert.equal(group.summary.refunded_micros, "100001"); assert.equal(group.summary.net_micros, "200001"); assert.equal(group.watermark, report.watermark);
  await shot(page, "posting-02-hong-kong-day"); pass("Hong Kong day groups contain only their own postings", { day: fixture.days[1], gross: "300002", refunds: "100001", net: "200001" });
  stage = "projected detail";
  const [detailResponse] = await Promise.all([page.waitForResponse(r => match(r, `/v1/admin/usage-reports/${report.id}/works/task/${fixture.historical}`)), page.getByRole("button", { name: "View details", exact: true }).click()]); const detail = await checked(detailResponse);
  assert.equal(detail.selection.group_key, fixture.days[1]); assert.equal(detail.work.confirmed_micros, group.summary.confirmed_micros); assert.equal(detail.work.refunds.length, 1); assert.equal(detail.work.ledger.length, 1); assert.equal(detail.work.refunds[0].original_charge_id, fixture.charges[0]);
  const dialog = page.getByRole("dialog"); await dialog.getByText(/Original charge \(reference only, not counted again\)/).waitFor(); await shot(page, "posting-03-day-detail-original-charge"); await dialog.getByRole("button", { name: "Close", exact: true }).click();
  pass("Detail carries the same day selection and traces the original charge outside it", { original_charge: fixture.charges[0], included_charge: fixture.charges[1] });
  stage = "actual CSV and refresh";
  const [downloaded] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export selection", exact: true }).click()]);
  const csv = await readFile((await downloaded.path())!, "utf8"), rows = parse(csv, { columns: true, bom: true });
  assert.equal(rows.length, 1); assert.equal(rows[0].confirmed_micros, "300002"); assert.equal(rows[0].refunded_micros, "100001"); assert.equal(rows[0].net_micros, "200001"); assert.equal(rows[0].group_key, fixture.days[1]); assert.equal(rows[0].watermark, report.watermark); assert.equal(rows[0].reserved_micros, "");
  const retained = page.url(); const [reloaded] = await Promise.all([page.waitForResponse(reportRead), page.reload()]); const reload = await checked(reloaded); assert.equal(reload.watermark, report.watermark); assert.equal(reload.summary.net_micros, "200001"); assert.equal(page.url(), retained); assert.equal(await page.locator('[name="time_basis"]').inputValue(), "ledger_posted_at");
  pass("Actual CSV and refresh retain exact selected-day money and watermark", { csv_sha256: sha(csv), net: "200001" });
  stage = "refund-only period";
  await page.locator('[name="period_from"]').fill(fixture.days[1] + "T00:01"); await page.locator('[name="period_to"]').fill(fixture.days[1] + "T00:02");
  const [refundResponse] = await Promise.all([page.waitForResponse(reportRead), page.getByRole("button", { name: "Create fresh report", exact: true }).click()]); const refund = await checked(refundResponse);
  assert.equal(refund.summary.confirmed_micros, "0"); assert.equal(refund.summary.refunded_micros, "100001"); assert.equal(refund.summary.net_micros, "-100001");
  await page.locator(".usage-totals").first().locator(":scope > div").nth(2).getByText(/0\.100001/).waitFor(); await shot(page, "posting-04-refund-only-negative-net");
  pass("Refund-only period renders negative net without reimporting the old charge", { gross: "0", refund: "100001", net: "-100001" });
  stage = "legacy cohort and layout";
  await page.locator('[name="time_basis"]').selectOption("work_created_at");
  const [cohortResponse] = await Promise.all([page.waitForResponse(reportRead), page.getByRole("button", { name: "Create fresh report", exact: true }).click()]); const cohort = await checked(cohortResponse); assert.equal(cohort.time_basis, "work_created_at"); assert.equal(cohort.total, 0);
  await page.getByRole("heading", { name: "No matching works", exact: true }).waitFor(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 760, height: 1080 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await shot(page, "posting-05-cohort-responsive");
  pass("Creation-period compatibility and responsive layout stay usable", { old_work_excluded_from_creation_cohort: true, horizontal_overflow: false });
  await stopRecording();
} catch (e) { errors.push(stage + ": " + String(e).replaceAll(fixture.admin.secret, "[redacted]")); }
finally {
  clearTimeout(deadline); try { await stopRecording(); } catch (e) { errors.push(String(e)); } try { await context?.close(); } catch (e) { errors.push(String(e)); } try { await browser?.close(); browserClosed = !!browser; } catch (e) { errors.push(String(e)); }
  const after = await hashes(); if (JSON.stringify(before) !== JSON.stringify(after)) errors.push("Product source changed during actual UI qualification");
  const status = errors.length === 0 && checks.length === 7 && browserClosed && recordings.length === 1 ? "passed" : "failed";
  await mkdir(path.dirname(receipt), { recursive: true }); await writeFile(receipt, JSON.stringify({ at: new Date().toISOString(), status, stage, checks, errors, screenshots, recordings, browser_closed: browserClosed, scope, sources_before: before, sources_after: after, verifier_sha256: sha(await readFile(import.meta.filename)) }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status, checks: checks.length, errors, receipt })); assert.equal(status, "passed");
}
