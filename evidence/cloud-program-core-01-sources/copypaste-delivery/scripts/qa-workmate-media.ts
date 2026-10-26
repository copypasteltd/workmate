import { chromium, type Browser, type Page } from "playwright";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import {
  WorkmateRecording, saveWorkmateScreenshot,
} from "./record-workmate-media.js";

const delivery = path.resolve(import.meta.dirname, ".."), dev = path.dirname(delivery);
const platform = path.join(dev, "copypaste-platform"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const recordings: any[] = [], screenshots: any[] = [], checks: string[] = [], active = new Map<string, WorkmateRecording>();
let failure: string | null = null, adminClosed = false;
async function captureNativePanel(panel: any, format: "png" | "jpeg" = "png") {
  const shot = await panel.send("Page.captureScreenshot", {
    format, ...(format === "jpeg" ? { quality: 85 } : {}), captureBeyondViewport: false,
  });
  return Buffer.from(shot.data, "base64");
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function snap(component: string, name: string, page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; });
  screenshots.push(await saveWorkmateScreenshot(component, attempt, name, await page.screenshot({ type: "png" }), "Actual running product viewport"));
}
async function start(component: string, capture: () => Promise<Buffer>, source: string) {
  const scene = new WorkmateRecording(component, "interaction", attempt, capture, source);
  active.set(component, scene);
  await scene.start();
  console.log("MEDIA: recording " + component);
}
async function stop(component: string) {
  const scene = active.get(component);
  if (!scene) return;
  const facts = await scene.stop();
  active.delete(component);
  if (facts) recordings.push(facts);
  console.log("MEDIA: encoded " + component);
}
async function adminCapture(facts: any) {
  const { system, env, email } = facts;
  const requirePlatform = createRequire(path.join(platform, "package.json"));
  const OTPAuth = requirePlatform("otpauth");
  const { seal } = await import(pathToFileURL(path.join(platform, "src/lib.ts")).href);
  const secret = new OTPAuth.Secret({ size: 20 });
  const adminEmail = "workmate-demo-" + randomUUID() + "@example.invalid";
  const principal = (await system.db.control.query(
    "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
    [adminEmail, "Demo administrator", seal(env.MASTER_KEY, secret.base32)],
  )).rows[0];
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
    [principal.id],
  );
  async function api(method: string, url: string, payload?: unknown) {
    const r = await system.app.inject({ method, url, headers: {
      origin: "http://localhost:4318", "content-type": "application/json", "idempotency-key": randomUUID(),
    }, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });
    assert.ok(r.statusCode >= 200 && r.statusCode < 300, "Actual local Admin authentication must succeed: " + r.statusCode);
    return r;
  }
  const challenge = (await api("POST", "/v1/admin/auth/challenge", { email: adminEmail })).json();
  const mail = JSON.parse(await readFile(path.join(env.DATA_DIR, "mailbox", challenge.challenge_id + ".json"), "utf8"));
  assert.equal(mail.to, adminEmail);
  const verified = await api("POST", "/v1/admin/auth/verify", {
    challenge_id: challenge.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0],
    totp: new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate(),
  });
  const setCookie = verified.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie : [String(setCookie)]).find((s: string) => s.startsWith("cp_admin_session="))!.split(";")[0];
  assert.ok(cookie.startsWith("cp_admin_session="));
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true, args: ["--disable-gpu"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
    await context.addCookies([{ name: "cp_admin_session", value: cookie.slice(cookie.indexOf("=") + 1), url: "http://localhost:4318", httpOnly: true }]);
    await context.addInitScript(() => {
      if (!localStorage.getItem("cp_locale")) localStorage.setItem("cp_locale", "en");
      if (!localStorage.getItem("cp_theme")) localStorage.setItem("cp_theme", "light");
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto("http://localhost:4318/users");
    await page.getByRole("heading", { name: "Users", exact: true }).waitFor();
    await page.locator(".table-link").first().waitFor();
    await snap("admin", "users-en", page);
    await start("admin", () => page.screenshot({ type: "jpeg", quality: 85 }), "Actual authenticated Admin using an isolated synthetic operator and customer");
    await page.locator(".directory-filters summary").click();
    const user = (await system.db.control.query("SELECT id FROM users WHERE email=$1", [email])).rows[0];
    assert.ok(user?.id);
    await page.locator('input[name="user_id"]').fill(user.id);
    await page.locator('.directory-filters button[type="submit"]').click();
    await sleep(700);
    await page.locator(".table-link").first().click();
    await page.getByRole("heading", { name: "Workspace membership & usage", exact: true }).waitFor();
    await snap("admin", "user-usage-en", page);
    await sleep(700);
    await page.getByRole("button", { name: "Grant VIP", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await sleep(800);
    await snap("admin", "vip-en", page);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Manage credit", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await sleep(800);
    await snap("admin", "credit-en", page);
    await stop("admin");
    checks.push("Actual Admin email OTP and TOTP session, filtered user directory, current workspace usage, VIP and credit forms; no financial commit is claimed");
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      localStorage.setItem("cp_locale", "zh-HK");
      localStorage.setItem("cp_theme", "dark");
    });
    await page.reload();
    await page.getByRole("heading", { name: "企業歸屬與消耗", exact: true }).waitFor();
    await snap("admin", "user-usage-zh-dark", page);
    await context.close();
  } finally {
    await stop("admin");
    await browser?.close();
    adminClosed = true;
  }
}

(globalThis as any).__workmateMediaHook = async (stage: string, facts: any) => {
  if (stage === "desktop.start" || stage === "web.start") {
    const component = stage.split(".")[0], page = facts.page as Page;
    await page.locator(".input-request select").waitFor();
    await page.locator(".task-inputs").scrollIntoViewIfNeeded();
    assert.equal(await page.locator(".input-request select option").count() > 1, true);
    await snap(component, "input-ready-en", page);
    await start(component, () => page.screenshot({ type: "jpeg", quality: 85 }), "Actual " + component + " task selection and response; the model-turn fixture is explicitly synthetic");
  } else if (stage === "desktop.stop" || stage === "web.stop") {
    const component = stage.split(".")[0];
    await facts.page.getByText("Same-task UI fixture completed.", { exact: true }).scrollIntoViewIfNeeded();
    await sleep(900);
    await snap(component, "result-en", facts.page);
    await stop(component);
    checks.push(component + ": actual authorized selection, refresh retention, original task response and visible settled usage");
  } else if (stage === "extension.start") {
    await facts.evaluate("document.querySelector('#input-requests').scrollIntoView({block:'center'})");
    await sleep(500);
    screenshots.push(await saveWorkmateScreenshot("extension", attempt, "sidepanel-native-en",
      await captureNativePanel(facts.panel), "Actual native SIDE_PANEL document viewport captured directly from its existing CDP target; excludes browser toolbar"));
    await start("extension", () => captureNativePanel(facts.panel, "jpeg"),
      "Actual right SIDE_PANEL document viewport; native context, right layout, reduced main-page width and no popup/extra tab are independently asserted in the same journey. Browser toolbar is outside this capture. Model-turn fixture is explicitly synthetic.");
  } else if (stage === "extension.stop") {
    await facts.evaluate("document.querySelector('#task-output').scrollIntoView({block:'center'})");
    await sleep(900);
    screenshots.push(await saveWorkmateScreenshot("extension", attempt, "sidepanel-result-en",
      await captureNativePanel(facts.panel), "Actual native SIDE_PANEL document viewport after the original task response; excludes browser toolbar"));
    await stop("extension");
    checks.push("Actual right Chrome SIDE_PANEL document interaction recorded directly; native right layout and absence of action popup/extra tab independently asserted in this journey; browser toolbar excluded from media");
  } else if (stage === "admin.capture") {
    await adminCapture(facts);
  }
};

try {
  await import("./qa-paid-input-native.js");
} catch (e) {
  failure = String(e);
  throw e;
} finally {
  for (const component of [...active.keys()]) await stop(component).catch(e => { failure ??= String(e); });
  delete (globalThis as any).__workmateMediaHook;
  const source_files: Record<string, string> = {};
  for (const file of ["qa-workmate-media.ts", "record-workmate-media.ts", "qa-paid-input-native.ts"])
    source_files["scripts/" + file] = sha(await readFile(path.join(delivery, "scripts", file)));
  const report = {
    at: new Date().toISOString(), status: !failure && recordings.length === 4 && adminClosed ? "passed" : "failed",
    scope: "Actual product interactions, not animated mockups. Backend, identity, authorization, input selection and settlement run against an owned native isolated database. UI model turns and business/provider data are synthetic as authorized; separate retained integration tests execute actual Codex processes against a synthetic internal gateway. Admin media shows directory/usage and permission-gated VIP/credit forms, without claiming a financial commit.",
    failure, native_journey: "evidence/paid-input-native-" + attempt + "-journey.json",
    recordings, screenshots, checks, owned_admin_browser_closed: adminClosed, source_files,
  };
  await writeFile(path.join(delivery, "evidence/workmate-media-" + attempt + ".json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log("MEDIA: " + JSON.stringify({ status: report.status, recordings: recordings.length, screenshots: screenshots.length }));
  assert.equal(report.status, "passed", failure ?? "All four actual client recordings and Admin cleanup are required");
}
