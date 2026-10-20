import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
} from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode } from "./qa-auth.js";

const web = "http://localhost:4317",
  apiOrigin = "http://localhost:4310";
const ownerEmail = `membership-owner-${randomUUID()}@example.invalid`,
  recipient = `membership-recipient-${randomUUID()}@example.invalid`;
const checks: string[] = [],
  errors: string[] = [],
  samples: any[] = [];
const contexts: BrowserContext[] = [],
  screenshots: string[] = [];
async function sources() {
  const result: Record<string, string> = {};
  for (const repo of [
    "copypaste-platform",
    "copypaste-web",
    "copypaste-delivery",
  ]) {
    const folder = path.resolve("..", repo);
    const files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: folder, encoding: "utf8", windowsHide: true },
    )
      .split("\0")
      .filter(Boolean);
    for (const file of [...new Set(files)].sort()) {
      const include =
        repo === "copypaste-delivery"
          ? ["scripts/qa-membership.ts", "scripts/qa-auth.ts"].includes(file)
          : /^(src|migrations)\//.test(file) ||
            /^(package(-lock)?\.json|index\.html|vite\.config\.ts)$/.test(file);
      if (include)
        result[`${repo}/${file}`] = createHash("sha256")
          .update(await readFile(path.join(folder, file)))
          .digest("hex");
    }
  }
  return result;
}
const sourceBefore = await sources();
let stage = "browser launch",
  sessionsClosed = false;
const deadline = setTimeout(() => {
  errors.push("Owned membership QA exceeded 240 seconds at " + stage);
  void server?.kill();
}, 240000);
const browserArgs = [
  "--disable-gpu",
  ...(process.env.COPYPASTE_QA_IN_PROCESS_GPU === "1"
    ? ["--in-process-gpu", "--disable-gpu-compositing"]
    : []),
];
const observed: { method: string; path: string; status: number }[] = [];
function observe(page: Page) {
  page.on("response", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith("/v1/"))
      observed.push({
        method: r.request().method(),
        path: p,
        status: r.status(),
      });
  });
}
let browser: Browser | undefined,
  server: BrowserServer | undefined,
  owner: Page | undefined,
  freshFailureCapture = false,
  closed = false;
async function bounded<T>(
  promise: Promise<T>,
  label: string,
  ms = 30000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + " timed out")), ms);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function login(page: Page, email: string) {
  await page.locator('input[name="email"]').fill(email);
  const code = await emailCode(page, () =>
    page.locator('form button[type="submit"]').click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
}
async function capture(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const folder = path.resolve("../copypaste-web/assets/screenshots");
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, name),
    fullPage: true,
    animations: "disabled",
  });
  screenshots.push(name);
}
async function mailLink(id: string) {
  const file = path.resolve(
    "../copypaste-platform/.data/mailbox",
    id + ".json",
  );
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try {
      const mail = JSON.parse(await readFile(file, "utf8"));
      return new URL(mail.text.match(/https?:\/\/\S+/)[0]).href;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(
    "Owned invitation mailbox did not receive its queued delivery",
  );
}
function sample(
  name: string,
  operation: string,
  schema: string,
  status: number,
  response: unknown,
) {
  samples.push({ name, operation, schema, status, response });
}
try {
  server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.WEB_CHROME_BIN ?? process.env.CHROME_BIN,
    args: browserArgs,
    timeout: 30000,
  });
  browser = await chromium.connect({
    wsEndpoint: server.wsEndpoint(),
    timeout: 30000,
  });
  const context = await bounded(
    browser.newContext({
      viewport: { width: 1440, height: 1050 },
    }),
    "Owner browser context",
  );
  contexts.push(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  owner = await bounded(context.newPage(), "Owner browser page");
  observe(owner);
  owner.setDefaultTimeout(20000);
  owner.on("pageerror", (e) => errors.push(e.message));
  await owner.goto(web + "/login", { waitUntil: "domcontentloaded" });
  stage = "owner email login and onboarding";
  await login(owner, ownerEmail);
  await owner.waitForURL("**/welcome");
  await owner
    .locator('input[name="name"]')
    .fill("Synthetic invitation workspace");
  await owner
    .locator('input[name="project_name"]')
    .fill("Membership acceptance");
  const [created] = await Promise.all([
    owner.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/tenants" &&
        r.request().method() === "POST",
    ),
    owner.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(created.status(), 200);
  const w = await created.json();
  await owner.waitForURL("**/app");
  const base = `/v1/tenants/${w.tenant.id}`;
  stage = "owner member invitation";
  await owner.goto(web + "/app/members", { waitUntil: "domcontentloaded" });
  await owner
    .getByRole("button", { name: "Invite a member", exact: true })
    .click();
  await owner.locator('input[name="email"]').fill(recipient);
  await owner.locator('select[name="role"]').selectOption("viewer");
  const [made] = await Promise.all([
    owner.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === base + "/invites" &&
        r.request().method() === "POST",
    ),
    owner
      .getByRole("button", { name: "Create invitation", exact: true })
      .click(),
  ]);
  assert.equal(made.status(), 201);
  const invite = await made.json();
  assert.equal(invite.invite_url, undefined);
  sample(
    "invitation-create",
    "POST /v1/tenants/{tenant_id}/invites",
    "Invite",
    201,
    invite,
  );
  const row = owner.locator(`[data-invite-id="${invite.id}"]`);
  await row.waitFor();
  const oldLink = await mailLink(invite.id);
  checks.push(
    "real owner onboarding, explicit viewer/project invitation, strict 201 response and durable mailbox delivery",
  );
  await row.getByRole("button", { name: "Resend", exact: true }).click();
  const [resent] = await Promise.all([
    owner.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith(`/invites/${invite.id}/resend`),
    ),
    owner.getByRole("button", { name: "Confirm", exact: true }).click(),
  ]);
  assert.equal(resent.status(), 200);
  let newLink = oldLink;
  for (let n = 0; n < 60 && newLink === oldLink; n++) {
    await new Promise((r) => setTimeout(r, 250));
    newLink = await mailLink(invite.id);
  }
  assert.notEqual(newLink, oldLink);
  await row.getByText("Sent", { exact: true }).waitFor();
  checks.push(
    "real resend confirmation rotates the email link and keeps invitation metadata free of credentials",
  );
  await capture(owner, "60-membership-invitations-current.png");
  const memberContext = await bounded(
    browser.newContext({
      viewport: { width: 1360, height: 950 },
    }),
    "Recipient browser context",
  );
  contexts.push(memberContext);
  await memberContext.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
  });
  const member = await bounded(
    memberContext.newPage(),
    "Recipient browser page",
  );
  member.setDefaultTimeout(20000);
  member.on("pageerror", (e) => errors.push(e.message));
  await member.goto(oldLink, { waitUntil: "domcontentloaded" });
  stage = "recipient email login, rotated token and invitation acceptance";
  await member.waitForURL("**/login?**");
  await login(member, recipient);
  await member.waitForURL("**/invite?**");
  const oldResult = await member.evaluate(async (token) => {
    const m = "/src/api.ts";
    const a = await import(m);
    try {
      await a.post("/v1/invites/accept", { token });
      return 200;
    } catch (e: any) {
      return e.status;
    }
  }, new URL(oldLink).searchParams.get("token"));
  assert.equal(oldResult, 404);
  await member.goto(newLink, { waitUntil: "domcontentloaded" });
  await member.getByText(recipient, { exact: true }).waitFor();
  const [accepted] = await Promise.all([
    member.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/invites/accept",
    ),
    member
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click(),
  ]);
  assert.equal(accepted.status(), 201);
  const membership = await accepted.json();
  assert.equal(membership.role, "viewer");
  sample(
    "invitation-accept",
    "POST /v1/invites/accept",
    "Member",
    201,
    membership,
  );
  await member.waitForURL("**/app");
  await member
    .locator(
      `select[aria-label="Switch workspace"] option[value="${w.tenant.id}"]`,
    )
    .waitFor({ state: "attached" });
  await member.goto(web + "/app/members", { waitUntil: "domcontentloaded" });
  await member
    .getByText(
      "Only workspace owners and administrators can manage members and invitations.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await member
      .getByRole("button", { name: "Invite a member", exact: true })
      .count(),
    0,
  );
  checks.push(
    "invitation survives real email login, rotated old link is rejected, acceptance selects the joined workspace and viewer management controls remain hidden",
  );
  await capture(member, "61-membership-viewer-current.png");
  const list = await owner.evaluate(async (base) => {
    const m = "/src/api.ts";
    return (await import(m)).api(base + "/members");
  }, base);
  sample(
    "members-list",
    "GET /v1/tenants/{tenant_id}/members",
    "MemberList",
    200,
    list,
  );
  await owner.reload({ waitUntil: "domcontentloaded" });
  const mr = owner.locator(`[data-member-id="${membership.id}"]`);
  await mr.waitFor();
  await capture(owner, "62-membership-directory-current.png");
  stage = "real member removal and existing-session authority";
  await mr.getByRole("button", { name: "Remove member", exact: true }).click();
  const [removed] = await Promise.all([
    owner.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/members/" + membership.id &&
        r.request().method() === "DELETE",
    ),
    owner.getByRole("button", { name: "Confirm removal", exact: true }).click(),
  ]);
  assert.equal(removed.status(), 200);
  sample(
    "member-remove",
    "DELETE /v1/members/{member_id}",
    "Ack",
    200,
    await removed.json(),
  );
  const denied = await member.evaluate(async (base) => {
    const m = "/src/api.ts";
    try {
      await (await import(m)).api(base + "/projects");
      return 200;
    } catch (e: any) {
      return e.status;
    }
  }, base);
  assert.equal(denied, 404);
  checks.push(
    "canonical member removal through the real confirmation immediately denies the recipient's existing browser session",
  );
  await owner
    .getByRole("button", { name: "Invite a member", exact: true })
    .click();
  await owner.locator('input[name="email"]').fill(recipient);
  const [secondMade] = await Promise.all([
    owner.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === base + "/invites" &&
        r.request().method() === "POST",
    ),
    owner
      .getByRole("button", { name: "Create invitation", exact: true })
      .click(),
  ]);
  assert.equal(secondMade.status(), 201);
  const second = await secondMade.json();
  const secondLink = await mailLink(second.id);
  await owner
    .locator(`[data-invite-id="${second.id}"]`)
    .getByRole("button", { name: "Revoke", exact: true })
    .click();
  const [revoked] = await Promise.all([
    owner.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith(`/invites/${second.id}/revoke`),
    ),
    owner.getByRole("button", { name: "Confirm", exact: true }).click(),
  ]);
  assert.equal(revoked.status(), 200);
  assert.equal((await revoked.json()).state, "revoked");
  const revokedResult = await member.evaluate(async (token) => {
    const m = "/src/api.ts";
    try {
      await (await import(m)).post("/v1/invites/accept", { token });
      return 200;
    } catch (e: any) {
      return e.status;
    }
  }, new URL(secondLink).searchParams.get("token"));
  assert.equal(revokedResult, 409);
  checks.push(
    "real Revoke confirmation invalidates its delivered link for the matching recipient",
  );
  stage = "delayed context response across logout";
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    intercepted = new Promise<void>((r) => (ready = r));
  await owner.route("**/v1/session/context?qa=late", async (route) => {
    const response = await route.fetch();
    ready();
    await gate;
    await route.fulfill({ response });
  });
  await owner.evaluate(() => {
    const m = "/src/api.ts";
    (window as any).lateContext = import(m)
      .then((a) => a.api("/v1/session/context?qa=late"))
      .then(
        () => "unexpected-success",
        (e) => e.code,
      );
  });
  await intercepted;
  await owner.evaluate(async () => {
    const m = "/src/api.ts";
    await (await import(m)).api("/v1/auth/session", { method: "DELETE" });
  });
  release();
  const late = await owner.evaluate(async () => {
    const code = await (window as any).lateContext;
    const m = "/src/api.ts";
    return { code, csrf: (await import(m)).csrfToken };
  });
  assert.deepEqual(late, { code: "SESSION_CHANGED", csrf: "" });
  checks.push(
    "a real delayed context HTTP response cannot restore CSRF after canonical server logout",
  );
} catch (e) {
  errors.push(e instanceof Error ? e.stack! : String(e));
  process.exitCode = 1;
  if (owner)
    freshFailureCapture = await owner
      .screenshot({
        path: "evidence/membership-ui-recovery-failure.png",
        fullPage: true,
        timeout: 5000,
      })
      .then(() => true)
      .catch(() => false);
} finally {
  clearTimeout(deadline);
  sessionsClosed = true;
  for (const context of contexts) {
    try {
      const r = await context.request.get(apiOrigin + "/v1/session/context", {
        timeout: 5000,
      });
      if (r.status() === 401) continue;
      assert.equal(
        r.status(),
        200,
        "Owned session cleanup must read its current context",
      );
      const session = await r.json();
      const ended = await context.request.delete(
        apiOrigin + "/v1/auth/session",
        {
          headers: {
            "X-CSRF-Token": session.csrf_token,
            "Idempotency-Key": randomUUID(),
            Origin: web,
          },
          timeout: 5000,
        },
      );
      assert.ok(
        [200, 204].includes(ended.status()),
        `Owned session logout failed: ${ended.status()} ${await ended.text()}`,
      );
      assert.equal(
        (
          await context.request.get(apiOrigin + "/v1/session/context", {
            timeout: 5000,
          })
        ).status(),
        401,
      );
    } catch (e) {
      sessionsClosed = false;
      errors.push("Owned session cleanup: " + (e as Error).message);
    }
  }
  if (browser)
    await bounded(browser.close(), "Browser disconnect", 10000).catch((e) =>
      errors.push(e.message),
    );
  if (server) {
    try {
      await bounded(server.close(), "Owned browser shutdown", 10000);
    } catch (e) {
      errors.push((e as Error).message);
      await bounded(
        server.kill(),
        "Owned browser forced shutdown",
        10000,
      ).catch((e) => errors.push(e.message));
    }
    closed =
      server.process().exitCode !== null ||
      server.process().signalCode !== null;
  }
  const sourceAfter = await sources(),
    stable = JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter);
  if (!stable)
    errors.push(
      "Participating runtime or verifier changed during membership QA",
    );
  await writeFile(
    "evidence/membership-ui-recovery.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status:
          !errors.length &&
          closed &&
          sessionsClosed &&
          stable &&
          checks.length === 6
            ? "passed"
            : "failed",
        scope:
          "Actual headless Web invitation/member journey and client context race; no packaged/native runtime acceptance claim.",
        model_calls: 0,
        browser_version: browser?.version(),
        executable:
          process.env.WEB_CHROME_BIN ??
          process.env.CHROME_BIN ??
          chromium.executablePath(),
        launch_mode: "owned_browser_server",
        browser_args: browserArgs,
        observed,
        failure_screenshot: freshFailureCapture
          ? "membership-ui-recovery-failure.png"
          : null,
        checks: checks.map((name) => ({ name, status: "passed" })),
        errors,
        browser_closed: closed,
        user_browser_tabs_touched: false,
        owned_sessions_closed: sessionsClosed,
        source_unchanged: stable,
        source_files: sourceBefore,
        screenshots,
        stage,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/membership-ui-contract-samples.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope: "Synthetic-account live HTTP response shapes only",
        origin: web,
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ checks: checks.length, errors, browser_closed: closed }),
  );
  if (
    errors.length ||
    !closed ||
    !sessionsClosed ||
    !stable ||
    checks.length !== 6
  )
    process.exitCode = 1;
}
