import {
  emailCode,
  authenticatorCode as totp,
  verifyAdmin,
} from "./qa-auth.js";
import { chromium, type Page, type BrowserContext } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
const root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform"),
  origin = "http://localhost:4318";
const checks: { name: string; status: string; detail?: string }[] = [],
  errors: string[] = [];
async function sendCode(page: Page, button: string) {
  return emailCode(
    page,
    () => page.getByRole("button", { name: button, exact: true }).click(),
    true,
  );
}
async function request(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const me = await (await fetch("/v1/admin/me")).json();
      const r = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf_token ?? "",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    },
    { url, method, body },
  );
}
async function screenshot(page: Page, name: string) {
  // Keys are always password inputs; OTP/code inputs are cleared before capture.
  await page
    .locator('input[name="setup_key"]')
    .evaluateAll((inputs) =>
      inputs.forEach(
        (input) => ((input as HTMLInputElement).type = "password"),
      ),
    );
  await page
    .locator('input[name="code"],input[name="totp"]')
    .evaluateAll((inputs) =>
      inputs.forEach((input) => ((input as HTMLInputElement).value = "")),
    );
  const dir = path.join(root, "copypaste-admin/assets/screenshots");
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
}
async function signIn(
  page: Page,
  operator: { email: string; totp_secret: string },
) {
  await page.goto(origin);
  await page.locator('input[name="email"]').fill(operator.email);
  const emailCode = await sendCode(page, "Send admin sign-in code");
  await page.locator('input[name="code"]').fill(emailCode);
  await verifyAdmin(page, operator.totp_secret);
  await page.waitForURL("**/overview");
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  headless: true,
});
const contexts: BrowserContext[] = [];
async function context() {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    locale: "en-HK",
  });
  contexts.push(c);
  c.setDefaultTimeout(20000);
  c.setDefaultNavigationTimeout(25000);
  await c.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return { c, p };
}
try {
  const operator = JSON.parse(
    await readFile(path.join(platform, ".data/qa/operator.json"), "utf8"),
  );
  const admin = await context();
  await signIn(admin.p, operator);
  const role = "qa_usage_" + randomUUID().slice(0, 8),
    email = `usage-reviewer-${randomUUID().slice(0, 8)}@example.invalid`;
  assert.equal(
    (
      await request(admin.p, "/v1/admin/access/roles", "POST", {
        key: role,
        name: "Campaign usage reviewer",
        permissions: ["admin.overview.read", "admin.usage.read"],
        reason: "Browser QA least privilege reviewer",
      })
    ).status,
    200,
  );
  await admin.p.goto(origin + "/access");
  await admin.p
    .getByRole("button", { name: "Invite administrator", exact: true })
    .click();
  await admin.p
    .getByLabel("Administrator name", { exact: true })
    .fill("Harbour usage reviewer");
  await admin.p.getByLabel("Administrator email", { exact: true }).fill(email);
  await admin.p.getByLabel("Initial permission role").selectOption(role);
  await admin.p
    .getByLabel("Reason", { exact: true })
    .fill("Marketing usage review access for browser QA");
  const invitedResponse = admin.p.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/admin/access/principals") &&
      r.request().method() === "POST",
  );
  await admin.p
    .getByRole("button", { name: "Create and send invitation" })
    .click();
  const invited = await (await invitedResponse).json();
  assert.equal(invited.delivery, "sent");
  await admin.p
    .getByRole("heading", { name: "Invitation sent", exact: true })
    .waitFor();
  await admin.p.getByRole("button", { name: "Done", exact: true }).click();
  await admin.p.getByLabel("Search records", { exact: true }).fill(email);
  await admin.p
    .getByRole("button", { name: "Manage administrator " + email, exact: true })
    .waitFor();
  await screenshot(admin.p, "04-admin-identities");
  console.log("Admin identity browser checkpoint " + (checks.length + 1));
  checks.push({
    name: "separate administrator login; least privilege role and atomic emailed invitation through UI",
    status: "passed",
  });

  const mail = JSON.parse(
      await readFile(
        path.join(platform, `.data/mailbox/${invited.invitation_id}.json`),
        "utf8",
      ),
    ),
    link = mail.text.match(/http[^\s]+/)[0];
  const recipient = await context();
  await recipient.p.goto(link);
  await recipient.p
    .getByRole("button", { name: "Send setup code", exact: true })
    .waitFor();
  assert.equal(new URL(recipient.p.url()).hash, "");
  assert.equal(
    await recipient.p.evaluate(() =>
      JSON.stringify([localStorage, sessionStorage]).includes("token="),
    ),
    false,
  );
  await screenshot(recipient.p, "05-admin-email-enrollment");
  const setupCode = await sendCode(recipient.p, "Send setup code");
  await recipient.p
    .getByLabel("Email verification code", { exact: true })
    .fill(setupCode);
  await recipient.p
    .getByRole("button", { name: "Verify email and set up MFA", exact: true })
    .click();
  const keyInput = recipient.p.getByLabel("Manual setup key", { exact: true });
  await keyInput.waitFor();
  const key = await keyInput.inputValue();
  assert.equal(await keyInput.getAttribute("type"), "password");
  await screenshot(recipient.p, "06-admin-mfa-enrollment");
  await recipient.p
    .getByLabel("New authenticator code", { exact: true })
    .fill(totp(key));
  await recipient.p
    .getByRole("button", { name: "Confirm authenticator", exact: true })
    .click();
  await recipient.p.waitForURL("**/overview");
  assert.equal(
    await recipient.p
      .getByRole("link", { name: "Admin access", exact: true })
      .count(),
    0,
  );
  assert.equal(
    (
      await request(recipient.p, "/v1/admin/access/principals", "POST", {
        email: "forbidden@example.invalid",
        name: "Forbidden",
        reason: "Must be rejected",
      })
    ).status,
    403,
  );
  console.log("Admin identity browser checkpoint " + (checks.length + 1));
  checks.push({
    name: "recipient email OTP and real TOTP enrollment, fragment removal, independent session and denied privilege escalation",
    status: "passed",
  });

  const stale = await context();
  await stale.c.addCookies(await recipient.c.cookies());
  await recipient.p
    .getByLabel("Authenticator settings", { exact: true })
    .click();
  const replacementCode = await sendCode(
    recipient.p,
    "Send authenticator replacement code",
  );
  await recipient.p
    .getByLabel("Email verification code", { exact: true })
    .fill(replacementCode);
  await recipient.p
    .getByRole("button", { name: "Verify email", exact: true })
    .click();
  const newKey = await recipient.p
    .getByLabel("Manual setup key", { exact: true })
    .inputValue();
  await screenshot(recipient.p, "07-admin-authenticator-settings");
  await recipient.p
    .getByLabel("New authenticator code", { exact: true })
    .fill(totp(newKey));
  await recipient.p
    .getByRole("button", { name: "Confirm authenticator", exact: true })
    .click();
  await recipient.p.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal((await request(recipient.p, "/v1/admin/me")).status, 200);
  await stale.p.goto(origin);
  await stale.p
    .getByRole("button", { name: "Send admin sign-in code", exact: true })
    .waitFor();
  console.log("Admin identity browser checkpoint " + (checks.length + 1));
  checks.push({
    name: "self authenticator replacement through email and new real TOTP; old cookie invalidated while current session succeeds",
    status: "passed",
  });

  await admin.p
    .getByRole("button", { name: "Manage administrator " + email, exact: true })
    .click();
  await admin.p
    .getByRole("heading", { name: "Sign-in sessions", exact: true })
    .waitFor();
  await screenshot(admin.p, "08-admin-account-sessions");
  assert.equal(
    await admin.p.evaluate(() => document.body.style.overflow),
    "hidden",
  );
  await admin.p
    .getByRole("button", { name: "Suspend account", exact: true })
    .click();
  await admin.p
    .getByLabel("Reason", { exact: true })
    .fill("Suspend a QA account and invalidate active sessions");
  await admin.p
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await admin.p
    .getByRole("button", { name: "Resume account", exact: true })
    .waitFor();
  await recipient.p.reload();
  await recipient.p
    .getByRole("button", { name: "Send admin sign-in code", exact: true })
    .waitFor();
  await admin.p
    .getByRole("button", { name: "Resume account", exact: true })
    .click();
  await admin.p
    .getByLabel("Reason", { exact: true })
    .fill("Resume the QA account without restoring old sessions");
  await admin.p
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await admin.p
    .getByRole("button", { name: "Suspend account", exact: true })
    .waitFor();
  assert.equal((await request(recipient.p, "/v1/admin/me")).status, 401);
  console.log("Admin identity browser checkpoint " + (checks.length + 1));
  checks.push({
    name: "account detail shows safe session metadata; UI suspension revokes access and resumption preserves revocation",
    status: "passed",
  });

  await admin.p.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await admin.p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await screenshot(admin.p, "09-admin-account-mobile");
  await admin.p.getByRole("button", { name: "Close", exact: true }).click();
  assert.notEqual(
    await admin.p.evaluate(() => document.body.style.overflow),
    "hidden",
  );
  await admin.p.setViewportSize({ width: 1440, height: 1080 });
  await admin.p
    .getByRole("button", { name: "Invite administrator", exact: true })
    .click();
  const waitingEmail = `waiting-admin-${randomUUID().slice(0, 8)}@example.invalid`;
  await admin.p
    .getByLabel("Administrator name", { exact: true })
    .fill("Awaiting role assignment");
  await admin.p
    .getByLabel("Administrator email", { exact: true })
    .fill(waitingEmail);
  await admin.p
    .getByLabel("Reason", { exact: true })
    .fill("Verify pending invitation resend without granting permissions");
  const pendingResponse = admin.p.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/admin/access/principals") &&
      r.request().method() === "POST",
  );
  await admin.p
    .getByRole("button", { name: "Create and send invitation" })
    .click();
  const pending = await (await pendingResponse).json();
  await admin.p.getByRole("button", { name: "Done", exact: true }).click();
  await admin.p
    .getByLabel("Search records", { exact: true })
    .fill(waitingEmail);
  await admin.p
    .getByRole("button", {
      name: "Manage administrator " + waitingEmail,
      exact: true,
    })
    .click();
  await admin.p
    .getByRole("button", { name: "Resend invitation", exact: true })
    .click();
  await admin.p
    .getByLabel("Reason", { exact: true })
    .fill("Replace previous pending invitation for browser QA");
  const resend = admin.p.waitForResponse(
    (r) => r.url().endsWith("/enrollment") && r.request().method() === "POST",
  );
  await admin.p
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  const resent = await (await resend).json();
  assert.equal(resent.delivery, "sent");
  assert.notEqual(resent.invitation_id, pending.invitation_id);
  const oldMail = JSON.parse(
    await readFile(
      path.join(platform, `.data/mailbox/${pending.invitation_id}.json`),
      "utf8",
    ),
  );
  await stale.p.goto(oldMail.text.match(/http[^\s]+/)[0]);
  await stale.p.getByRole("alert").waitFor();
  console.log("Admin identity browser checkpoint " + (checks.length + 1));
  checks.push({
    name: "390px account UI; explicit invitation resend invalidates the old link",
    status: "passed",
  });
  const replacementMail = JSON.parse(
    await readFile(
      path.join(platform, `.data/mailbox/${resent.invitation_id}.json`),
      "utf8",
    ),
  );
  await stale.p.goto(replacementMail.text.match(/http[^\s]+/)[0]);
  const waitingCode = await sendCode(stale.p, "Send setup code");
  await stale.p
    .getByLabel("Email verification code", { exact: true })
    .fill(waitingCode);
  await stale.p
    .getByRole("button", { name: "Verify email and set up MFA", exact: true })
    .click();
  const waitingKey = await stale.p
    .getByLabel("Manual setup key", { exact: true })
    .inputValue();
  await stale.p
    .getByLabel("New authenticator code", { exact: true })
    .fill(totp(waitingKey));
  await stale.p
    .getByRole("button", { name: "Confirm authenticator", exact: true })
    .click();
  await stale.p
    .getByRole("heading", {
      name: "Your account is ready; access awaits assignment",
      exact: true,
    })
    .waitFor();
  assert.equal(
    (await request(stale.p, "/v1/admin/access/principals")).status,
    403,
  );
  await screenshot(stale.p, "10-admin-awaiting-access");
  assert.equal(
    (
      await request(admin.p, "/v1/admin/access/bindings", "POST", {
        principal_id: pending.principal.id,
        role_key: role,
        scope_kind: "global",
        reason: "Assign a waiting QA administrator a bounded review role",
      })
    ).status,
    200,
  );
  await stale.p.reload();
  await stale.p
    .getByRole("button", { name: "Send admin sign-in code", exact: true })
    .waitFor();
  checks.push({
    name: "unassigned recipient can enroll into a waiting screen; assigning access invalidates the earlier session",
    status: "passed",
  });
  if (errors.length) throw new Error(errors.join("\n"));
} catch (e: any) {
  console.log("Admin identity browser checkpoint " + (checks.length + 1));
  checks.push({
    name: "administrator identity browser workflow",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/admin-identities.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        version: "0.3.0",
        checks,
        errors,
        browser_closed: true,
      },
      null,
      2,
    ),
  );
}
