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
const receipt = "evidence/admin-team-usage-174/admin-ui-03.json", attempt = "admin-team-usage-174-03";
const scope = "Actual Admin OTP/TOTP and native SQL-backed team consumption: team/standalone and run groups, original task attribution, same-snapshot CSV and reload, intersected filters and narrow layout. Synthetic accounting; no new team-runtime/model/professional/production acceptance claim.";
const checks: any[] = [], screenshots: any[] = [], recordings: any[] = [], errors: string[] = [];
const sources = ["copypaste-admin/src/main.tsx", "copypaste-admin/src/usage-reports.tsx", "copypaste-admin/src/usage-reports.css", "copypaste-platform/src/admin.ts", "copypaste-platform/src/admin-usage-reports.ts", "copypaste-platform/src/admin-usage-report-model.ts", "copypaste-platform/src/admin-usage-report-query.ts"];
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async n => [n, sha(await readFile(path.resolve("..", n)))])));
const before = await hashes(); let browser: Browser | undefined, context: BrowserContext | undefined, recording: WorkmateRecording | undefined, browserClosed = false, stage = "initializing";
const match = (r: Response, p: string) => new URL(r.url()).pathname === p;
const reportRead = (r: Response) => /\/v1\/admin\/usage-reports\/[0-9a-f-]+$/.test(new URL(r.url()).pathname) && r.request().method() === "GET";
async function checked(r: Response) { const b = await r.json(); assert.equal(r.status(), 200, b.error?.message ?? String(r.status())); return b; }
const pass = (name: string, facts: unknown) => checks.push({ name, status: "passed", facts });
// Serialize movie frames and full-page stills so their temporary viewport
// changes never overlap within the same CDP page.
let screenshotQueue: Promise<void> = Promise.resolve();
function capture(page: Page, options: any) {
  const next = screenshotQueue.then(() => page.screenshot(options));
  screenshotQueue = next.then(() => undefined, () => undefined);
  return next;
}
async function shot(page: Page, name: string) { await page.evaluate(async () => { await document.fonts.ready; }); screenshots.push(await saveWorkmateScreenshot("admin", attempt, name, await capture(page, { fullPage: true }), scope, root)); }
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
  const query = new URLSearchParams(fixture.filters);
  await page.goto(origin + "/usage?" + query, { waitUntil: "domcontentloaded" });
  recording = new WorkmateRecording("admin", "team-consumption-workflow", attempt, () => capture(page, { type: "jpeg", quality: 72 }), scope, root); await recording.start();
  stage = "team totals";
  const [created] = await Promise.all([page.waitForResponse(reportRead), page.getByRole("button", { name: "Create fresh report", exact: true }).click()]); const report = await checked(created);
  assert.equal(report.total, 5); assert.equal(report.summary.confirmed_micros, "630025");
  await page.locator('[name="usage_group"]').selectOption("team");
  await page.getByText("Standalone works", { exact: true }).waitFor();
  assert.equal(report.groups.team.find((g: any) => g.key === fixture.group).confirmed_micros, "520016");
  assert.ok(!(await page.locator("body").innerText()).includes(fixture.privateName));
  await shot(page, "team-01-team-and-standalone"); pass("Team summary adds actual member/coordinator charges once and separates standalone works", { team: "520016", standalone: "110009" });
  stage = "run selection"; await page.locator('[name="usage_group"]').selectOption("team_run");
  const selected = "?group_by=team_run&group_key=" + fixture.runs[0];
  const [grouped] = await Promise.all([page.waitForResponse(r => reportRead(r) && new URL(r.url()).searchParams.get("group_key") === fixture.runs[0]), page.locator("button.usage-group").filter({ hasText: fixture.runs[0] }).click()]); const group = await checked(grouped);
  assert.equal(group.total, 2); assert.equal(group.summary.confirmed_micros, "200004"); assert.equal(group.watermark, report.watermark);
  await page.getByRole("heading", { name: "Work details 2", exact: true }).waitFor(); await shot(page, "team-02-single-run");
  pass("One selected team run excludes the other run and standalone work", { run: fixture.runs[0], works: 2, confirmed: "200004" });
  stage = "team work detail";
  const [detailResponse] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname.includes(`/v1/admin/usage-reports/${report.id}/works/`)), page.getByRole("button", { name: "View details", exact: true }).first().click()]); const detail = await checked(detailResponse);
  assert.equal(detail.work.team_run_id, fixture.runs[0]); assert.equal(detail.work.team_id, fixture.group); assert.equal(detail.watermark, report.watermark);
  const dialog = page.getByRole("dialog"); await dialog.getByText("team_node_key", { exact: true }).waitFor(); await shot(page, "team-03-original-task-attribution"); await dialog.getByRole("button", { name: "Close", exact: true }).click();
  pass("Actual detail exposes fixed financial lineage without reading private team content", { node: detail.work.team_node_key, run: detail.work.team_run_id });
  stage = "CSV and reload";
  const [downloaded] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export selection", exact: true }).click()]);
  const csv = await readFile((await downloaded.path())!, "utf8"), rows = parse(csv, { columns: true, bom: true }); assert.equal(rows.length, 2);
  for (const row of rows) { assert.equal(row.team_id, fixture.group); assert.equal(row.team_run_id, fixture.runs[0]); assert.equal(row.watermark, report.watermark); }
  const retained = page.url(), [reloaded] = await Promise.all([page.waitForResponse(reportRead), page.reload()]); const reload = await checked(reloaded);
  assert.equal(reload.watermark, report.watermark); assert.equal(reload.summary.confirmed_micros, "200004"); assert.equal(page.url(), retained);
  pass("Actual selected CSV and URL reload retain the same team run and watermark", { csv_sha256: sha(csv), rows: 2 });
  stage = "team and run filters"; await page.getByText("More filters", { exact: true }).click();
  await page.locator('[name="team_id"]').fill(fixture.group); await page.locator('[name="team_run_id"]').fill(fixture.runs[1]); await page.locator('[name="time_basis"]').selectOption("ledger_posted_at");
  const [filteredResponse] = await Promise.all([page.waitForResponse(reportRead), page.getByRole("button", { name: "Create fresh report", exact: true }).click()]); const filtered = await checked(filteredResponse);
  assert.equal(filtered.total, 2); assert.equal(filtered.summary.confirmed_micros, "320012"); assert.equal(filtered.filters.team_id, fixture.group); assert.equal(filtered.filters.team_run_id, fixture.runs[1]); assert.equal(filtered.time_basis, "ledger_posted_at");
  await shot(page, "team-04-team-run-period-filters"); pass("Team/run filters intersect with actual posting-period selection", { run: fixture.runs[1], confirmed: "320012" });
  stage = "responsive layout"; await page.setViewportSize({ width: 760, height: 1080 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await shot(page, "team-05-responsive");
  pass("Team billing references remain usable at narrow width without horizontal overflow", { width: 760, horizontal_overflow: false });
  await stopRecording();
} catch (e) { errors.push(stage + ": " + String(e).replaceAll(fixture.admin.secret, "[redacted]")); }
finally {
  clearTimeout(deadline); try { await stopRecording(); } catch (e) { errors.push(String(e)); } try { await context?.close(); } catch (e) { errors.push(String(e)); } try { await browser?.close(); browserClosed = !!browser; } catch (e) { errors.push(String(e)); }
  const after = await hashes(); if (JSON.stringify(before) !== JSON.stringify(after)) errors.push("Product source changed during actual UI qualification");
  const status = errors.length === 0 && checks.length === 7 && browserClosed && recordings.length === 1 ? "passed" : "failed";
  await mkdir(path.dirname(receipt), { recursive: true }); await writeFile(receipt, JSON.stringify({ at: new Date().toISOString(), status, stage, checks, errors, screenshots, recordings, browser_closed: browserClosed, scope, sources_before: before, sources_after: after, verifier_sha256: sha(await readFile(import.meta.filename)) }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status, checks: checks.length, errors, receipt })); assert.equal(status, "passed");
}
