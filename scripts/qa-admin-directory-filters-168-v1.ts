import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import { verifyAdmin } from "./qa-auth.js";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
const fixture = JSON.parse(await readFile(process.argv[2], "utf8")), origin = "http://localhost:4318", root = process.cwd();
const receipt = "evidence/admin-directory-filters-168/admin-ui-01.json", attempt = "admin-directory-filters-168-01";
const scope = "Actual Admin OTP/TOTP and native SQL-backed combined directory filters, exact money, reload/detail return, unknown origin/activity and invalid-range prevention. Synthetic business records; no provider acceptance or new frozen release.";
const checks: any[] = [], screenshots: any[] = [], recordings: any[] = [], errors: string[] = [];
const sourceNames = ["copypaste-admin/src/main.tsx", "copypaste-admin/src/directory.tsx", "copypaste-admin/src/admin.css", "copypaste-platform/src/admin-directory.ts", "copypaste-platform/src/admin-directory-operational.ts", "copypaste-platform/src/auth.ts", "copypaste-platform/src/federation.ts"];
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const hashes = async () => Object.fromEntries(await Promise.all(sourceNames.map(async n => [n, sha(await readFile(path.resolve("..", n)))])));
const before = await hashes(); let browser: Browser | undefined, context: BrowserContext | undefined, recording: WorkmateRecording | undefined, browserClosed = false, stage = "initializing";
const match = (r: Response, p: string) => new URL(r.url()).pathname === p;
async function checked(r: Response) { const b = await r.json(); assert.equal(r.status(), 200, b.error?.code ?? String(r.status())); return b; }
const pass = (name: string, facts: unknown) => checks.push({ name, status: "passed", facts });
async function shot(page: Page, name: string) { await page.evaluate(async () => { await document.fonts.ready; }); screenshots.push(await saveWorkmateScreenshot("admin", attempt, name, await page.screenshot(), scope, root)); }
async function stopRecording() { if (!recording) return; const current = recording; recording = undefined; recordings.push(await current.stop()); }
const deadline = setTimeout(() => { errors.push("Admin journey deadline"); void browser?.close(); }, 180000);
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"), headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, timezoneId: "Asia/Hong_Kong" }); context.setDefaultTimeout(20000);
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); }); const page = await context.newPage(); page.on("pageerror", e => errors.push(String(e)));
  stage = "actual Admin sign-in"; await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.locator('input[name="email"]').fill(fixture.admin.email);
  const [challengeResponse] = await Promise.all([page.waitForResponse(r => match(r, "/v1/admin/auth/challenge") && r.request().method() === "POST"), page.getByRole("button", { name: "Send admin sign-in code", exact: true }).click()]); const challenge = await checked(challengeResponse);
  let code: string | undefined; for (let n = 0; n < 100 && !code; n++) { try { const mail = JSON.parse(await readFile(path.join(fixture.mailbox, challenge.challenge_id + ".json"), "utf8")); assert.equal(mail.to, fixture.admin.email); code = mail.text.match(/\b\d{6}\b/)?.[0]; } catch (e: any) { if (e.code !== "ENOENT") throw e; } if (!code) await new Promise(r => setTimeout(r, 100)); }
  assert.ok(code); await page.locator('input[name="code"]').fill(code); await verifyAdmin(page, fixture.admin.secret); await page.waitForURL(u => !["/", "/login"].includes(u.pathname)); pass("Independent Admin OTP and current TOTP", { actual_authentication: true });
  stage = "combined operational filters";
  const initial = page.waitForResponse(r => match(r, "/v1/admin/users")); await page.goto(origin + "/users?state=active", { waitUntil: "domcontentloaded" }); await checked(await initial);
  const openFilters = async () => { const details = page.locator("details.directory-filters"); if (!(await details.getAttribute("open"))) { if (!await details.evaluate(el => (el as HTMLDetailsElement).open)) await details.locator("summary").click(); } };
  await openFilters();
  const local = (iso: string) => page.evaluate(value => { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }, iso);
  // Date inputs have minute precision; widen the boundary to include the fixture's second.
  await page.locator('[name="registered_from"]').fill(await local(fixture.registered_from));
  await page.locator('[name="registered_to"]').fill(await local(fixture.registered_to));
  await page.locator('[name="activity"]').selectOption("known"); await page.locator('[name="vip_plan"]').fill("pro"); await page.locator('[name="vip_status"]').selectOption("effective");
  await page.locator('[name="charge_min_hkd"]').fill("0.875"); await page.locator('[name="charge_max_hkd"]').fill("0.875");
  await page.locator('[name="role_key"]').fill("assistant"); await page.locator('[name="role_usage"]').selectOption("started"); await page.locator('[name="cost_exception"]').selectOption("pending_reconciliation");
  await page.locator('[name="balance_state"]').selectOption("sufficient"); await page.locator('[name="balance_required_hkd"]').fill("1"); await page.locator('[name="billing_subject"]').selectOption("personal");
  recording = new WorkmateRecording("admin", "directory-filter-workflow", attempt, () => page.screenshot({ type: "jpeg", quality: 72 }), scope, root); await recording.start();
  await page.locator("details.directory-filters").scrollIntoViewIfNeeded(); await shot(page, "filters-01-combined-controls");
  const combined = page.waitForResponse(r => match(r, "/v1/admin/users") && new URL(r.url()).searchParams.get("charge_min_micros") === "875000"); await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  const rows = await checked(await combined); assert.deepEqual(rows.items.map((r: any) => r.id), [fixture.first]); assert.equal(rows.items[0].confirmed_customer_charges.amount_micros, "875000");
  await page.getByText("Harbour Active", { exact: true }).first().waitFor(); await shot(page, "filters-02-confirmed-result");
  const retained = new URL(page.url()).search; pass("Combined time/VIP/role/cost/account filters and exact HKD conversion", { user_id: fixture.first, charge_micros: "875000", current_url: retained });
  stage = "reload restores all conditions"; const reloaded = page.waitForResponse(r => match(r, "/v1/admin/users") && new URL(r.url()).searchParams.get("charge_max_micros") === "875000"); await page.reload(); assert.deepEqual((await checked(await reloaded)).items.map((r: any) => r.id), [fixture.first]); await openFilters();
  assert.equal(await page.locator('[name="charge_min_hkd"]').inputValue(), "0.875"); assert.equal(await page.locator('[name="vip_plan"]').inputValue(), "pro"); assert.equal(await page.locator('[name="billing_subject"]').inputValue(), "personal");
  pass("Reload restores the full filter URL and exact money inputs", { retained_filters: true });
  stage = "detail and return"; const detail = page.waitForResponse(r => match(r, "/v1/admin/users/" + fixture.first)); await page.getByRole("link", { name: "View user", exact: true }).click();
  assert.equal((await checked(await detail)).user.id, fixture.first); await page.getByText("Last account access", { exact: true }).waitFor(); await shot(page, "filters-03-distinct-access-and-login");
  const returned = page.waitForResponse(r => match(r, "/v1/admin/users") && new URL(r.url()).searchParams.get("charge_min_micros") === "875000"); await page.getByRole("link", { name: "Back to users", exact: true }).click(); await checked(await returned); assert.equal(new URL(page.url()).search, retained);
  pass("Operational profile separates login/access and restores directory context", { user_id: fixture.first });
  stage = "unknown activity and historical origin"; await openFilters(); const reset = page.waitForResponse(r => match(r, "/v1/admin/users") && !new URL(r.url()).searchParams.has("charge_min_micros")); await page.getByRole("button", { name: "Reset filters", exact: true }).click(); await checked(await reset); await openFilters();
  await page.locator('[name="activity"]').selectOption("unknown"); await page.locator('[name="registration_source"]').selectOption("unknown");
  const unknown = page.waitForResponse(r => match(r, "/v1/admin/users") && new URL(r.url()).searchParams.get("activity") === "unknown"); await page.getByRole("button", { name: "Apply filters", exact: true }).click(); const legacy = await checked(await unknown);
  assert.deepEqual(legacy.items.map((r: any) => r.id), [fixture.second]); assert.equal(legacy.items[0].last_active_at, null); assert.equal(legacy.items[0].registration_source, null); await page.getByText("Studio Legacy", { exact: true }).first().waitFor(); await shot(page, "filters-04-unknown-is-explicit");
  pass("Historical origin and unrecorded account access remain explicitly unknown", { user_id: fixture.second, activity: null, source: null });
  stage = "invalid range remains local"; await openFilters(); await page.locator('[name="charge_min_hkd"]').fill("2"); await page.locator('[name="charge_max_hkd"]').fill("1"); const oldUrl = page.url();
  await page.getByRole("button", { name: "Apply filters", exact: true }).click(); await page.getByText("Maximum charges must not be below minimum charges.", { exact: true }).waitFor(); assert.equal(page.url(), oldUrl); await shot(page, "filters-05-invalid-range-refused");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); pass("Invalid money range is refused before navigation and no horizontal overflow occurs", { retained_url: true }); await stopRecording();
} catch (e) { errors.push(stage + ": " + String(e).replaceAll(fixture.admin.secret, "[redacted]")); }
finally {
  clearTimeout(deadline); try { await stopRecording(); } catch (e) { errors.push("recording: " + String(e)); } try { await context?.close(); } catch (e) { errors.push("context: " + String(e)); } try { await browser?.close(); browserClosed = !!browser; } catch (e) { errors.push("browser: " + String(e)); }
  const after = await hashes(); if (JSON.stringify(before) !== JSON.stringify(after)) errors.push("Product source changed during the actual browser run");
  const status = errors.length === 0 && checks.length === 6 && browserClosed && recordings.length === 1 ? "passed" : "failed"; await mkdir(path.dirname(receipt), { recursive: true });
  await writeFile(receipt, JSON.stringify({ at: new Date().toISOString(), status, stage, checks, errors, screenshots, recordings, browser_closed: browserClosed, scope, sources_before: before, sources_after: after, verifier_sha256: sha(await readFile(import.meta.filename)) }, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status, checks: checks.length, errors, receipt })); assert.equal(status, "passed");
}
