import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import { verifyAdmin } from "./qa-auth.js";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

// The parent runner owns fixture creation, native services and database cleanup.
// This runner owns only its browser/context and never confirms a business write.
type Fixture = {
  admin: { email: string; secret: string };
  user: { id: string; email: string; name?: string };
  second: { id: string; email: string; name?: string };
  mailbox: string;
  database_url: string;
};
type User = { id: string; email: string; name: string };
type Account = { id: string; subject: { kind: string; id: string } };
type Check = { name: string; status: "passed"; facts: unknown };

assert.ok(process.argv[2], "Usage: node --import tsx scripts/qa-admin-target-165-v1.ts <fixture.json> [receipt.json]");
const fixture: Fixture = JSON.parse(await readFile(process.argv[2], "utf8"));
const root = process.cwd();
assert.equal(path.basename(root), "copypaste-delivery", "Run from the canonical delivery repository");
const adminOrigin = new URL(process.env.QA_ADMIN_ORIGIN ?? "http://localhost:4318").origin;
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(adminOrigin).hostname));
const database = new URL(fixture.database_url);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname));
assert.notEqual(database.port, "55432", "The unrelated project database is forbidden");
assert.notEqual(fixture.user.id, fixture.second.id);
const attempt = process.env.QA_ATTEMPT ?? "functional-closure-165-01";
assert.match(attempt, /^[a-z0-9-]{1,100}$/);
const receiptFile = path.resolve(process.argv[3] ?? "evidence/functional-closure-165/admin-ui-01.json");
const platformRequire = createRequire(path.resolve("../copypaste-platform/package.json"));
const pg = platformRequire("pg");
const sql = new pg.Client({ connectionString: fixture.database_url });
const checks: Check[] = [], errors: string[] = [], screenshots: unknown[] = [], recordings: unknown[] = [];
const observations: { kind: string; facts: unknown }[] = [];
const source = "Actual Admin UI with email OTP/TOTP, real SQL-backed directory and fee/VIP previews. Synthetic fixture users; no confirmation, credit grant, VIP activation, external AI request, Desktop or Extension claim.";
const sources = [
  "copypaste-admin/src/main.tsx", "copypaste-admin/src/directory.tsx", "copypaste-admin/src/vip.tsx",
  "copypaste-admin/src/fees.tsx", "copypaste-admin/src/ui.tsx", "copypaste-platform/src/admin-directory.ts",
  "copypaste-platform/src/admin-billing.ts", "copypaste-platform/src/admin-fees.ts", "copypaste-platform/src/admin-vip.ts",
];
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const redact = (error: unknown) => String(error)
  .replaceAll(fixture.admin.secret, "[TOTP redacted]")
  .replaceAll(fixture.database_url, "[database URL redacted]");
let browser: Browser | undefined, context: BrowserContext | undefined;
let recording: WorkmateRecording | undefined, connected = false, browserClosed = false;
let stage = "initializing", originalSnapshot: unknown, finalSnapshot: unknown;
let beforeSources: Record<string, string> = {}, afterSources: Record<string, string> = {};

async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sources.map(async file => [file, sha(await readFile(path.resolve("..", file)))])));
}
function pass(name: string, facts: unknown) { checks.push({ name, status: "passed", facts }); }
async function checked(response: Response) {
  const body = await response.json();
  assert.equal(response.status(), 200, `${response.request().method()} ${new URL(response.url()).pathname}: ${body?.error?.code ?? response.status()}`);
  return body;
}
function isResponse(response: Response, pathname: string, method = "GET") {
  return new URL(response.url()).pathname === pathname && response.request().method() === method;
}
async function stopRecording() {
  if (!recording) return;
  const current = recording; recording = undefined;
  recordings.push(await current.stop());
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; });
  screenshots.push(await saveWorkmateScreenshot("admin", attempt, name, await page.screenshot(), source, root));
}
function startRecording(page: Page, name: string) {
  recording = new WorkmateRecording("admin", name, attempt, () => page.screenshot({ type: "jpeg", quality: 72 }), source, root);
  return recording.start();
}
async function mailboxCode(id: string) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    try {
      const mail = JSON.parse(await readFile(path.resolve(fixture.mailbox, id + ".json"), "utf8"));
      assert.equal(mail.to, fixture.admin.email);
      const code = mail.text.match(/\b\d{6}\b/)?.[0];
      assert.ok(code, "This login challenge must have an actual delivered OTP");
      return code as string;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error("The owned Admin challenge email did not arrive");
}
async function login(page: Page) {
  await page.goto(adminOrigin, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(fixture.admin.email);
  const [response] = await Promise.all([
    page.waitForResponse(r => isResponse(r, "/v1/admin/auth/challenge", "POST")),
    page.getByRole("button", { name: "Send admin sign-in code", exact: true }).click(),
  ]);
  const challenge = await checked(response);
  await page.locator('input[name="code"]').fill(await mailboxCode(challenge.challenge_id));
  // Existing helper respects the normal one-use TOTP counter; no auth bypass.
  await verifyAdmin(page, fixture.admin.secret);
  await page.waitForURL(url => !["/", "/login"].includes(url.pathname));
}
async function userDetail(page: Page, user: User, sameDocument = false) {
  const [response] = await Promise.all([
    page.waitForResponse(r => isResponse(r, `/v1/admin/users/${user.id}`)),
    (async () => {
      if (sameDocument) {
        const timeOrigin = await page.evaluate(() => performance.timeOrigin);
        await page.evaluate(url => {
          history.pushState({}, "", url);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, "/users/" + user.id);
        assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, "The route transition must preserve the actual document");
      } else await page.goto(adminOrigin + "/users/" + user.id, { waitUntil: "domcontentloaded" });
    })(),
  ]);
  const data = await checked(response);
  assert.equal(data.user.id, user.id);
  await page.getByRole("heading", { name: user.name, exact: true }).first().waitFor();
  return data;
}
async function openVip(page: Page, user: User) {
  await page.getByRole("button", { name: "Grant VIP", exact: true }).click();
  const dialog = page.getByRole("dialog"), input = dialog.locator('input[name="subject_id"]');
  await input.waitFor();
  assert.equal(await input.inputValue(), user.id);
  assert.equal(await input.evaluate(element => (element as HTMLInputElement).readOnly && (element as HTMLInputElement).required), true);
  assert.equal(await input.evaluate(element => (element as HTMLInputElement).checkValidity()), true);
  assert.equal(await dialog.getByLabel("Subject type", { exact: true }).isDisabled(), true);
  return dialog;
}
async function openFees(page: Page, user: User) {
  const [response] = await Promise.all([
    page.waitForResponse(r => isResponse(r, "/v1/admin/billing/accounts")),
    page.getByRole("button", { name: "Manage credit", exact: true }).click(),
  ]);
  const url = new URL(response.url()), body = await checked(response);
  assert.equal(url.searchParams.get("subject_id"), user.id);
  assert.ok(body.items.length > 0, "Fixture user must have an initialized personal wallet in this server data mode");
  for (const account of body.items as Account[]) assert.deepEqual(account.subject, { kind: "user", id: user.id });
  observations.push({ kind: "fee-account-query", facts: { user_id: user.id, subject_id: url.searchParams.get("subject_id"), account_ids: body.items.map((a: Account) => a.id) } });
  return { dialog: page.getByRole("dialog"), account: body.items[0] as Account };
}
async function snapshot(operator: string) {
  // Transaction is read-only; preview/audit/replay rows are intentionally allowed.
  await sql.query("BEGIN READ ONLY");
  try {
    const users = [fixture.user.id, fixture.second.id];
    const wallets = (await sql.query("SELECT id,to_jsonb(w) AS state FROM wallets w WHERE user_id=ANY($1::uuid[]) ORDER BY id", [users])).rows;
    const grants = (await sql.query("SELECT id,to_jsonb(e) AS state FROM entitlements e WHERE user_id=ANY($1::uuid[]) ORDER BY id", [users])).rows;
    const canonical = (await sql.query("SELECT g.id,to_jsonb(g) AS state FROM vip_grants g JOIN entitlement_subjects s ON s.id=g.subject_id WHERE s.user_id=ANY($1::uuid[]) ORDER BY g.id", [users])).rows;
    const funds = (await sql.query("SELECT f.id,to_jsonb(f) AS state FROM funding_lots f JOIN wallets w ON w.id=f.billing_account_id WHERE w.user_id=ANY($1::uuid[]) ORDER BY f.id", [users])).rows;
    const facts = (await sql.query("SELECT (SELECT count(*)::int FROM ledger l JOIN wallets w ON w.id=l.billing_account_id WHERE w.user_id=ANY($1::uuid[])) AS ledger_count,(SELECT count(*)::int FROM admin_operations WHERE principal_id=$2) AS operation_count", [users, operator])).rows[0];
    await sql.query("COMMIT");
    return { wallets, grants, canonical, funds, facts };
  } catch (error) { await sql.query("ROLLBACK"); throw error; }
}
function localInput(milliseconds: number) {
  const date = new Date(milliseconds);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
async function directoryResponse(page: Page, id?: string) {
  return page.waitForResponse(response => isResponse(response, "/v1/admin/users") &&
    (id ? new URL(response.url()).searchParams.get("user_id") === id : !new URL(response.url()).searchParams.has("user_id")));
}
async function revealFilters(page: Page) {
  const details = page.locator("details.directory-filters");
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
  return details.locator("form");
}

const deadline = setTimeout(() => {
  errors.push("Owned Admin verification exceeded 240 seconds at " + stage);
  void browser?.close().catch(error => errors.push("deadline close: " + redact(error)));
}, 240_000);
deadline.unref();
try {
  beforeSources = await sourceHashes();
  await sql.connect(); connected = true;
  const adminRow = (await sql.query("SELECT id FROM admin_principals WHERE email=$1", [fixture.admin.email])).rows[0];
  assert.ok(adminRow, "Parent fixture must provide the enrolled Admin principal");
  const rows = (await sql.query("SELECT id,email,name FROM users WHERE id=ANY($1::uuid[]) ORDER BY id", [[fixture.user.id, fixture.second.id]])).rows as User[];
  const first = rows.find(row => row.id === fixture.user.id), second = rows.find(row => row.id === fixture.second.id);
  assert.ok(first && second);
  assert.equal(first.email, fixture.user.email); assert.equal(second.email, fixture.second.email);
  assert.ok(first.name.trim() && second.name.trim(), "Fixture users must have nonempty names for authorized display-name search");
  originalSnapshot = await snapshot(adminRow.id);
  let executablePath = process.env.CHROME_BIN;
  if (!executablePath) {
    const bundled = path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe");
    executablePath = await access(bundled).then(() => bundled, () => chromium.executablePath());
  }
  browser = await chromium.launch({ executablePath, headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  context.setDefaultTimeout(20_000);
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push("pageerror: " + redact(error)));
  stage = "actual Admin OTP and TOTP";
  await login(page);
  const detail = await userDetail(page, first);
  const vipFilter = detail.user.vip_summary === "none" ? "false" : "true";

  stage = "selected-user VIP target and actual preview";
  await startRecording(page, "selected-user-vip-fee-previews");
  const vip = await openVip(page, first);
  await screenshot(page, "admin-target-01-readonly-vip-subject");
  const plan = vip.getByLabel("Published fixed plan version", { exact: true });
  await plan.locator('option:not([value=""])').first().waitFor({ state: "attached" });
  const planId = await plan.locator('option:not([value=""])').evaluateAll(elements => {
    const options = elements.map(element => ({ id: element.getAttribute("value"), name: element.textContent ?? "" }));
    return (options.find(option => /pro/i.test(option.name)) ?? options.find(option => !/starter|free/i.test(option.name)) ?? options[0])?.id;
  });
  assert.ok(planId, "Seed must provide a published immutable VIP plan");
  await plan.selectOption(planId);
  await vip.locator('input[name="starts_at"]').fill(localInput(Date.now() + 5 * 60_000));
  await vip.locator('input[name="ends_at"]').fill(localInput(Date.now() + 24 * 3_600_000));
  await vip.locator('textarea[name="reason"]').fill("Owned stage 165 selected-user preview; no grant confirmation");
  const [vipResponse] = await Promise.all([
    page.waitForResponse(r => isResponse(r, "/v1/admin/entitlement-previews", "POST")),
    vip.getByRole("button", { name: "Preview entitlement change", exact: true }).click(),
  ]);
  const vipPreview = await checked(vipResponse);
  assert.equal(vipResponse.request().postDataJSON().subject.id, first.id);
  assert.equal(vipPreview.target_ids[0], first.id);
  assert.equal(vipPreview.creates_business_effect, false);
  await vip.getByRole("button", { name: "Confirm submission", exact: true }).waitFor();
  await screenshot(page, "admin-target-02-real-vip-preview");
  pass("VIP readonly subject equals the selected user and reaches the real frozen preview", { user_id: first.id, preview_id: vipPreview.preview_id, plan_version_id: planId, creates_business_effect: false });

  stage = "same-document user switch discards VIP preview";
  await userDetail(page, second, true);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.notEqual(await page.locator("body").evaluate(element => element.style.overflow), "hidden");
  const secondVip = await openVip(page, second);
  assert.equal(await secondVip.getByRole("button", { name: "Confirm submission", exact: true }).count(), 0);
  await screenshot(page, "admin-target-03-switched-user-fresh-vip");
  await page.keyboard.press("Escape"); await secondVip.waitFor({ state: "hidden" });

  stage = "selected-user fee query and actual gift preview";
  await userDetail(page, first, true);
  const fee = await openFees(page, first);
  await fee.dialog.getByLabel("Billing account", { exact: true }).fill(fee.account.id);
  await fee.dialog.locator('input[name="amount"]').fill("0.01");
  await fee.dialog.locator('input[name="expiry"]').fill(localInput(Date.now() + 24 * 3_600_000));
  await fee.dialog.locator('textarea[name="reason"]').fill("Owned stage 165 selected-user fee preview only");
  const [feeResponse] = await Promise.all([
    page.waitForResponse(r => isResponse(r, `/v1/admin/billing/accounts/${fee.account.id}/previews`, "POST")),
    fee.dialog.getByRole("button", { name: "Preview change", exact: true }).click(),
  ]);
  const feePreview = await checked(feeResponse);
  assert.equal(feeResponse.request().postDataJSON().action, "gift");
  assert.deepEqual(feePreview.target_ids, [fee.account.id]);
  assert.equal(feePreview.creates_business_effect, false);
  await fee.dialog.getByText("Review the frozen account, amount and source. A preview does not change balances.", { exact: true }).waitFor();
  await screenshot(page, "admin-target-04-real-subject-fee-preview");
  pass("Manage credit sends subject_id, lists only this user's accounts and reaches a real no-effect gift preview", { user_id: first.id, account_id: fee.account.id, preview_id: feePreview.preview_id, creates_business_effect: false });

  stage = "same-document user switch discards fee preview";
  await userDetail(page, second, true);
  assert.equal(await page.getByRole("dialog").count(), 0);
  const secondFee = await openFees(page, second);
  assert.notEqual(secondFee.account.id, fee.account.id);
  assert.equal(await secondFee.dialog.getByRole("button", { name: "Edit and refresh account", exact: true }).count(), 0);
  await screenshot(page, "admin-target-05-switched-user-fresh-fee-target");
  await page.keyboard.press("Escape"); await secondFee.dialog.waitFor({ state: "hidden" });
  await stopRecording();
  pass("Same-document user changes unmount old VIP and fee previews and open fresh operations for the new user", { from_user: first.id, to_user: second.id, navigation: "history pushState + popstate; performance.timeOrigin unchanged", checked: ["VIP readonly target", "old dialogs removed", "old previews removed", "new fee subject_id and account"] });

  stage = "directory filters survive detail return and reload";
  await page.goto(adminOrigin + "/users", { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Search records", exact: true }).fill(first.name);
  let filters = await revealFilters(page);
  await filters.locator('input[name="user_id"]').fill(first.id);
  await filters.locator('select[name="state"]').selectOption("active");
  await filters.locator('select[name="vip"]').selectOption(vipFilter);
  await filters.locator('select[name="limit"]').selectOption("20");
  await startRecording(page, "directory-filter-return-reload");
  const pendingFiltered = directoryResponse(page, first.id);
  await filters.getByRole("button", { name: "Apply filters", exact: true }).click();
  const filtered = await checked(await pendingFiltered);
  assert.equal(filtered.items.length, 1); assert.equal(filtered.items[0].id, first.id);
  const expected = { user_id: first.id, state: "active", vip: vipFilter, limit: "20", search: first.name };
  const assertQuery = () => {
    const query = new URL(page.url()).searchParams;
    for (const [key, value] of Object.entries(expected)) assert.equal(query.get(key), value, "Preserved URL field " + key);
  };
  assertQuery();
  filters = await revealFilters(page);
  await screenshot(page, "admin-target-06-directory-url-filters");
  await page.locator(`a.table-link[href^="/users/${first.id}"]`).click();
  await page.getByRole("heading", { name: first.name, exact: true }).first().waitFor();
  assertQuery();
  const pendingReturn = directoryResponse(page, first.id);
  await page.getByRole("link", { name: "Back to users", exact: true }).click();
  assert.equal((await checked(await pendingReturn)).items[0].id, first.id);
  assertQuery();
  const pendingReload = directoryResponse(page, first.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal((await checked(await pendingReload)).items[0].id, first.id);
  assertQuery();
  filters = await revealFilters(page);
  assert.equal(await filters.locator('input[name="user_id"]').inputValue(), first.id);
  assert.equal(await filters.locator('select[name="state"]').inputValue(), "active");
  assert.equal(await filters.locator('select[name="vip"]').inputValue(), vipFilter);
  assert.equal(await filters.locator('select[name="limit"]').inputValue(), "20");
  assert.equal(await page.getByRole("textbox", { name: "Search records", exact: true }).inputValue(), first.name);
  await screenshot(page, "admin-target-07-returned-and-reloaded-filters");
  const pendingReset = directoryResponse(page);
  await filters.getByRole("button", { name: "Reset filters", exact: true }).click();
  await checked(await pendingReset);
  const reset = new URL(page.url()).searchParams;
  for (const key of ["user_id", "state", "vip", "limit"]) assert.equal(reset.has(key), false);
  assert.equal(reset.get("search"), first.name);
  await screenshot(page, "admin-target-08-reset-keeps-search");
  await stopRecording();
  pass("URL keeps supported directory filters and search through detail, return and reload; reset clears filters and keeps search", expected);

  stage = "no financial or entitlement confirmation occurred";
  finalSnapshot = await snapshot(adminRow.id);
  assert.deepEqual(finalSnapshot, originalSnapshot, "Owned users' wallet/funding/grants/ledger and operator mutation counts must remain unchanged");
  afterSources = await sourceHashes(); assert.deepEqual(afterSources, beforeSources, "Audited product source must not change during this browser run");
  pass("Previews created no user credit or VIP business mutations", { before_sha256: sha(JSON.stringify(originalSnapshot)), after_sha256: sha(JSON.stringify(finalSnapshot)) });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
} catch (error) {
  errors.push(stage + ": " + redact(error));
} finally {
  clearTimeout(deadline);
  try { await stopRecording(); } catch (error) { errors.push("recording: " + redact(error)); }
  if (context) { try { await context.close(); } catch (error) { errors.push("context close: " + redact(error)); } }
  if (browser) { try { await browser.close(); browserClosed = true; } catch (error) { errors.push("browser close: " + redact(error)); } }
  if (connected) { try { await sql.end(); } catch (error) { errors.push("SQL close: " + redact(error)); } }
  const status = errors.length === 0 && checks.length === 5 && browserClosed && recordings.length === 2 ? "passed" : "failed";
  await mkdir(path.dirname(receiptFile), { recursive: true });
  await writeFile(receiptFile, JSON.stringify({
    at: new Date().toISOString(), status, stage, checks, errors, screenshots, recordings, observations,
    browser_closed: browserClosed, actual_browser_run: true, scope: source,
    fixture_users: [fixture.user.id, fixture.second.id], database_access: "Read-only transaction snapshots of only the owned fixture users and operator; fixture cleanup belongs to parent runner",
    sources_before: beforeSources, sources_after: afterSources,
    verifier_sha256: sha(await readFile(import.meta.filename)),
  }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status, checks: checks.length, errors, receipt: path.relative(root, receiptFile).replaceAll("\\", "/") }));
  assert.equal(status, "passed");
}
