import {
  chromium,
  _electron,
  type Browser,
  type BrowserContext,
  type Page,
  type ElectronApplication,
} from "playwright";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode, verifyAdmin } from "./qa-auth.js";

const root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform"),
  desktop = path.join(root, "copypaste-desktop");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const { startIdentityFixture } = await import(
  pathToFileURL(path.join(platform, "tests/helpers/oidc-idp.ts")).href
);
let idp: any, browser: Browser | undefined;
const contexts: BrowserContext[] = [],
  checks: { name: string; status: string }[] = [],
  errors: string[] = [];
let electron: ElectronApplication | undefined,
  failure: unknown,
  adminContext: BrowserContext | undefined,
  tenant: string | undefined;
let connectionCreated = false;
async function context() {
  const c = await browser!.newContext({
    viewport: { width: 1440, height: 1080 },
    locale: "en-HK",
  });
  contexts.push(c);
  c.setDefaultTimeout(25000);
  await c.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return { c, p };
}
async function request(
  c: BrowserContext,
  url: string,
  method = "GET",
  data?: unknown,
  admin = false,
) {
  const origin = admin ? "http://localhost:4318" : "http://localhost:4317";
  const me = await (
    await c.request.get(origin + (admin ? "/v1/admin/me" : "/v1/me"))
  ).json();
  const r = await c.request.fetch(origin + url, {
    method,
    headers: {
      Origin: origin,
      "X-CSRF-Token": me.csrf_token,
      "Idempotency-Key": randomUUID(),
    },
    ...(data === undefined ? {} : { data }),
  });
  const value = await r.json();
  assert.equal(r.ok(), true, JSON.stringify(value));
  return value;
}
async function shot(p: Page, repo: string, name: string) {
  const dir = path.join(root, repo, "assets/screenshots");
  await mkdir(dir, { recursive: true });
  await p.screenshot({
    path: path.join(dir, name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
}
async function command(p: Page, dialog: ReturnType<Page["getByRole"]>) {
  const [response] = await Promise.all([
    p.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.includes("/sso") &&
        r.request().method() === "POST",
    ),
    p.waitForResponse(
      (r) =>
        /\/sso$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "GET",
    ),
    dialog.getByRole("button", { name: "Confirm action" }).click(),
  ]);
  assert.equal(response.ok(), true, JSON.stringify(await response.json()));
  await dialog.getByLabel("Action", { exact: true }).waitFor();
}
try {
  idp = await startIdentityFixture();
  execFileSync(
    process.execPath,
    ["--env-file=.env", "--import", "tsx", "scripts/qa-fixture.ts"],
    { cwd: platform, stdio: "pipe", windowsHide: true },
  );
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
    headless: true,
  });
  const user = await context(),
    address = `company-${randomUUID().slice(0, 8)}@example.invalid`,
    company = "Harbour Identity " + randomUUID().slice(0, 6),
    loginKey = "harbour-" + randomUUID().slice(0, 8);
  await user.p.goto("http://localhost:4317/login");
  await user.p.getByLabel("Work email").fill(address);
  const otp = await emailCode(user.p, () =>
    user.p.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await user.p.locator('input[name="code"]').fill(otp);
  await user.p.locator('form button[type="submit"]').click();
  await user.p.waitForURL("**/welcome");
  await user.p.locator('input[name="name"]').fill(company);
  await user.p.locator('input[name="project_name"]').fill("Company marketing");
  await user.p.locator('form button[type="submit"]').click();
  await user.p.waitForURL("**/app");
  tenant = (await request(user.c, "/v1/me")).memberships[0].id;
  checks.push({
    name: "email registration and workspace onboarding before company federation",
    status: "passed",
  });
  const admin = await context();
  adminContext = admin.c;
  const operator = JSON.parse(
    await readFile(path.join(platform, ".data/qa/operator.json"), "utf8"),
  );
  await admin.p.goto("http://localhost:4318/login");
  await admin.p.getByLabel("Administrator email").fill(operator.email);
  const adminOtp = await emailCode(
    admin.p,
    () =>
      admin.p.getByRole("button", { name: "Send admin sign-in code" }).click(),
    true,
  );
  await admin.p.locator('input[name="code"]').fill(adminOtp);
  await verifyAdmin(admin.p, operator.totp_secret);
  await admin.p.goto("http://localhost:4318/tenants");
  await admin.p.getByLabel("Search records").fill(company);
  await admin.p
    .getByRole("row")
    .filter({ hasText: company })
    .getByTitle("Company identity sign-in")
    .click();
  let dialog = admin.p.getByRole("dialog");
  await dialog.getByLabel("Connection name").fill("Harbour company identity");
  await dialog
    .getByLabel("Company sign-in key", { exact: true })
    .fill(loginKey);
  await dialog.getByLabel("OIDC issuer").fill(idp.issuer);
  await dialog.getByLabel("Client ID", { exact: true }).fill(idp.clientId);
  await dialog
    .getByLabel("Client secret (leave blank to retain)")
    .fill(idp.secret);
  await dialog
    .getByLabel("Allowed work email domains (comma separated)")
    .fill("example.invalid");
  await dialog
    .getByLabel("Reason")
    .fill("Configure isolated signed OIDC acceptance provider");
  await command(admin.p, dialog);
  connectionCreated = true;
  await dialog.getByLabel("Action", { exact: true }).selectOption("probe");
  await dialog
    .getByLabel("Reason")
    .fill("Validate discovery and public signing key");
  await command(admin.p, dialog);
  await dialog.getByLabel("Action", { exact: true }).selectOption("enable");
  await dialog
    .getByLabel("Reason")
    .fill("Enable isolated company identity acceptance");
  await command(admin.p, dialog);
  let connection = (
    await request(
      admin.c,
      `/v1/admin/tenants/${tenant}/sso`,
      "GET",
      undefined,
      true,
    )
  ).connection;
  assert.equal(connection.enabled, true);
  assert.equal(JSON.stringify(connection).includes(idp.secret), false);
  await shot(admin.p, "copypaste-admin", "12-company-sign-in");
  checks.push({
    name: "administrator MFA, write-only secret, save/check/enable company connection UI",
    status: "passed",
  });
  await user.p.goto("http://localhost:4317/app/settings");
  await user.p
    .getByRole("link", { name: "Connect company identity", exact: true })
    .click();
  await user.p
    .getByLabel("Company sign-in key", { exact: true })
    .fill(loginKey);
  await shot(user.p, "copypaste-web", "17-company-sign-in");
  await user.p
    .getByRole("button", { name: "Continue to company identity" })
    .click();
  await user.p
    .getByRole("link", { name: "Continue with test identity" })
    .click();
  await user.p.waitForURL("**/sso/confirm");
  await user.p.getByRole("button", { name: "Send connection code" }).waitFor();
  await shot(user.p, "copypaste-web", "18-company-identity-confirmation");
  const [proof] = await Promise.all([
    user.p.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/auth/sso/link/challenge" &&
        r.request().method() === "POST",
    ),
    user.p.getByRole("button", { name: "Send connection code" }).click(),
  ]);
  const ch = await proof.json();
  assert.equal(proof.ok(), true, JSON.stringify(ch));
  const mail = JSON.parse(
    await readFile(
      path.join(platform, ".data/mailbox", ch.challenge_id + ".json"),
      "utf8",
    ),
  );
  assert.equal(mail.to, address);
  await user.p
    .getByLabel("6-digit connection code")
    .fill(mail.text.match(/code is (\d{6})/)[1]);
  await user.p
    .getByRole("button", { name: "Confirm & connect identity" })
    .click();
  await user.p.waitForURL("**/app/settings");
  await user.p.getByText("Harbour company identity", { exact: true }).waitFor();
  await shot(user.p, "copypaste-web", "19-linked-company-identity");
  checks.push({
    name: "real signed issuer callback plus independent first-link work email proof",
    status: "passed",
  });
  electron = await _electron.launch({
    executablePath: path.join(desktop, "release/win-unpacked/CopyPaste.exe"),
    env: {
      ...process.env,
      COPYPASTE_USER_DATA: path.resolve(".data/sso-desktop-" + randomUUID()),
    },
  });
  const workspace = await electron.firstWindow();
  await workspace.waitForURL(/file:.*index\.html/);
  await workspace.waitForLoadState("load");
  workspace.on("pageerror", (e) => errors.push(e.message));
  await workspace.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await workspace.reload();
  await electron.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      (globalThis as any).__authURL = url;
    };
  });
  await workspace
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  let authURL = "";
  for (let i = 0; i < 100; i++) {
    authURL = await electron.evaluate(
      () => (globalThis as any).__authURL ?? "",
    );
    if (authURL) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(authURL);
  const native = await context();
  await native.p.goto(authURL);
  await native.p
    .getByRole("link", { name: "Sign in with company identity", exact: true })
    .click();
  await native.p.getByLabel("Work email").fill(address);
  await native.p
    .getByLabel("Company sign-in key", { exact: true })
    .fill(loginKey);
  await native.p
    .getByRole("button", { name: "Continue to company identity" })
    .click();
  await native.p
    .getByRole("link", { name: "Continue with test identity" })
    .click();
  await native.p.getByRole("button", { name: "Authorize & return" }).click();
  await workspace.waitForURL("**#/app");
  await workspace
    .getByRole("link", { name: "Account settings", exact: true })
    .click();
  await workspace
    .getByText("Harbour company identity", { exact: true })
    .waitFor();
  assert.equal(await electron.evaluate(({ app }) => app.isPackaged), true);
  await shot(workspace, "copypaste-desktop", "06-company-identity");
  checks.push({
    name: "packaged Desktop system-browser SSO to real loopback PKCE and authenticated native renderer",
    status: "passed",
  });
  const mobile = await context();
  await mobile.p.setViewportSize({ width: 390, height: 844 });
  await mobile.p.goto("http://localhost:4317/sso");
  await mobile.p
    .getByLabel("Company sign-in key", { exact: true })
    .fill(loginKey);
  assert.equal(
    await mobile.p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await shot(mobile.p, "copypaste-web", "20-company-sign-in-mobile");
  checks.push({
    name: "company identity login fits 390px viewport",
    status: "passed",
  });
  // Reopen to read the number of links after sign-in and capture the actual impact control.
  await admin.p.getByRole("button", { name: "Close", exact: true }).click();
  await admin.p
    .getByRole("row")
    .filter({ hasText: company })
    .getByTitle("Company identity sign-in")
    .click();
  dialog = admin.p.getByRole("dialog");
  await dialog.getByLabel("Action", { exact: true }).selectOption("disable");
  await dialog
    .getByLabel("Reason")
    .fill("Revoke all linked acceptance sessions");
  await dialog.getByRole("checkbox").check();
  await shot(admin.p, "copypaste-admin", "13-company-session-revocation");
  await command(admin.p, dialog);
  await dialog.getByText(/Linked users/).waitFor();
  const webMe = await user.c.request.get("http://localhost:4317/v1/me");
  assert.equal(webMe.status(), 401);
  const nativeMe = await workspace.evaluate(() =>
    (window as any).copyPasteBridge.request("/v1/me", {}),
  );
  assert.equal(nativeMe.status, 401);
  checks.push({
    name: "administrator disables connection and both browser/native credentials fail immediately",
    status: "passed",
  });
} catch (e) {
  failure = e;
  errors.push(e instanceof Error ? e.message : String(e));
  const dir = path.resolve(".data/qa-failures");
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < contexts.length; i++)
    for (const p of contexts[i].pages())
      await p
        .screenshot({ path: path.join(dir, `federation-${i}.png`) })
        .catch(() => {});
} finally {
  if (adminContext && tenant && connectionCreated)
    try {
      const current = (
        await request(
          adminContext,
          `/v1/admin/tenants/${tenant}/sso`,
          "GET",
          undefined,
          true,
        )
      ).connection;
      if (current?.enabled)
        await request(
          adminContext,
          `/v1/admin/tenants/${tenant}/sso/status`,
          "POST",
          {
            expected_version: current.version,
            action: "disable",
            reason: "Close isolated identity acceptance provider",
          },
          true,
        );
    } catch (e) {
      errors.push("SSO fixture cleanup failed: " + String(e));
    }
  for (const resource of [electron, ...contexts, browser, idp])
    if (resource)
      try {
        await resource.close();
      } catch (e) {
        errors.push("Resource close failed: " + String(e));
      }
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/federation.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        version,
        status: failure || errors.length ? "failed" : "passed",
        checks,
        errors,
        browser_closed: true,
        electron_closed: true,
        idp_closed: true,
        identity_provider:
          "native signed OIDC fixture; not a company-provider qualification",
      },
      null,
      2,
    ),
  );
}
if (failure) throw failure;
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  "Enterprise federation UI and packaged native sign-in passed; owned browser, app and IdP closed.",
);
