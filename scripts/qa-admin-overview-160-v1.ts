import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const fixture = JSON.parse(await readFile(process.argv[2], "utf8")), root = process.cwd();
const req = createRequire(path.resolve("../copypaste-platform/package.json"));
const OTPAuth = req("otpauth"), pg = req("pg");
const sql = new pg.Client({ connectionString: fixture.database_url });
const checks: string[] = [], errors: string[] = [], screenshots: any[] = [], recordings: any[] = [];
let browser: Browser | undefined, recording: WorkmateRecording | undefined, closed = false;
async function stopRecording() { if (recording) { const r = recording; recording = undefined; recordings.push(await r.stop()); } }
try {
  await sql.connect();
  browser = await chromium.launch({ executablePath: path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const page = await context.newPage(); page.setDefaultTimeout(25000); page.on("pageerror", e => errors.push(e.message));
  const source = "Actual Admin MFA and SQL-backed overview with synthetic users/funding/task settlement; no model request or real cloud computer; no Desktop/Extension UI claim";
  const shot = async (name: string) => screenshots.push(await saveWorkmateScreenshot("admin", "admin-overview-160-01", name, await page.screenshot(), source, root));
  await page.goto("http://localhost:4318/"); await page.locator('input[name="email"]').fill(fixture.email);
  const [challenge] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/admin/auth/challenge"), page.getByRole("button", { name: "Send admin sign-in code", exact: true }).click()]);
  assert.equal(challenge.status(), 200);
  const mail = JSON.parse(await readFile(path.join(fixture.mailbox, (await challenge.json()).challenge_id + ".json"), "utf8"));
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('input[name="totp"]').fill(new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(fixture.secret), digits: 6, period: 30, algorithm: "SHA1" }).generate());
  await page.getByRole("button", { name: "Verify & open dashboard", exact: true }).click();
  await page.getByRole("heading", { name: "A considered overview", exact: true }).waitFor();
  await page.locator(".metric-card").nth(2).locator("strong").filter({ hasText: /0\.88/ }).waitFor();
  const read = () => page.evaluate(async () => { const r = await fetch("/v1/admin/overview"); if (!r.ok) throw new Error("Overview " + r.status); return (await r.json()).summary; });
  const actual = await read(); for (const [k, v] of Object.entries(fixture.expected)) assert.equal(actual[k], v);
  assert.match(await page.locator(".metric-card").nth(3).innerText(), /1\.00/);
  await shot("confirmed-charges-personal-hold"); checks.push("Actual email OTP/MFA opens the current SQL-backed figures, including the personal hold and immutable charge fact");
  await page.route("**/v1/admin/overview", route => route.abort("failed"));
  await page.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.waitForFunction(() => { const xs = [...document.querySelectorAll(".metric-card strong")]; return xs.length === 4 && xs.every(x => x.textContent === "—"); });
  await shot("unavailable-is-not-zero");
  await page.unroute("**/v1/admin/overview");
  await page.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await page.locator(".metric-card").nth(2).locator("strong").filter({ hasText: /0\.88/ }).waitFor();
  checks.push("A failed real overview request clears prior figures, shows dashes, and recovers through the visible refresh control");
  recording = new WorkmateRecording("admin", "current-permission-overview", "admin-overview-160-01", () => page.screenshot({ type: "jpeg", quality: 72 }), source, root); await recording.start();
  const updated = await sql.query("UPDATE admin_roles SET permissions=$2 WHERE key=$1 RETURNING key", [fixture.role, JSON.stringify(["admin.overview.read", "admin.users.read"])]); assert.equal(updated.rowCount, 1);
  await page.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await page.waitForFunction(() => { const xs = [...document.querySelectorAll(".metric-card strong")]; return xs.length === 4 && xs[0].textContent === "1" && xs[2].textContent === "—" && xs[3].textContent === "—"; });
  const partial = await read(); assert.equal(partial.charged_micros, null); assert.equal(partial.reserved_micros, null); assert.equal(partial.users, 1);
  await shot("current-permission-fields");
  await page.locator('button[title="切換至繁體中文"]').click();
  await page.getByRole("heading", { name: "平台總覽", exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-Hant-HK");
  await page.getByRole("button", { name: "重新載入總覽", exact: true }).waitFor();
  await shot("traditional-chinese-overview"); await stopRecording();
  checks.push("A real current grant change removes financial fields on refresh, retains allowed user counts and keeps the Chinese interface usable");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await context.close();
} catch (e) { errors.push(String(e)); }
finally {
  try { await stopRecording(); } catch (e) { errors.push("recording: " + String(e)); }
  if (browser) { try { await browser.close(); closed = true; } catch (e) { errors.push("browser close: " + String(e)); } }
  await sql.end();
  await mkdir("evidence/admin-overview-160", { recursive: true });
  const status = errors.length === 0 && checks.length === 3 && closed ? "passed" : "failed";
  await writeFile("evidence/admin-overview-160/ui-01.json", JSON.stringify({ at: new Date().toISOString(), status, checks, errors, screenshots, recordings, browser_closed: closed, verifier_sha256: createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"), scope: "Actual Admin only; synthetic business facts, real authentication/SQL/accounting and rendering. No live providers or broad historical regression." }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status, checks: checks.length, errors })); assert.equal(status, "passed");
}
