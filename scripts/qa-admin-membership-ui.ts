import {
  chromium,
  type Browser,
  type BrowserServer,
  type BrowserContext,
  type Page,
} from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode, verifyAdmin } from "./qa-auth.js";

const root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform"),
  origin = "http://localhost:4310",
  web = "http://localhost:4317",
  admin = "http://localhost:4318";
const requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth");
const contexts: { context: BrowserContext; admin: boolean }[] = [],
  clients: Client[] = [],
  principals: string[] = [],
  checks: any[] = [],
  errors: string[] = [],
  samples: any[] = [],
  screenshots: any[] = [];
type Client = { cookies: Map<string, string>; csrf: string };
let browser: Browser | undefined,
  server: BrowserServer | undefined,
  db: any,
  stage = "fixture setup",
  pendingId = "",
  reviewer: Page | undefined,
  closed = false,
  principalsDisabled = false,
  sessionsClosed = true;
const pass = (name: string) => {
  checks.push({ name, status: "passed" });
  console.log("PASS: " + name);
};
const deadline = setTimeout(() => {
  errors.push("Owned membership Admin QA exceeded 300 seconds at " + stage);
  void server?.kill();
}, 300000);

async function sourceHashes() {
  const rows: Record<string, string> = {};
  for (const name of [
    "copypaste-platform",
    "copypaste-admin",
    "copypaste-web",
    "copypaste-delivery",
  ]) {
    const folder = path.join(root, name);
    const files = [
      ...new Set(
        execFileSync(
          "git",
          ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
          { cwd: folder, encoding: "utf8", windowsHide: true },
        )
          .split("\0")
          .filter(Boolean),
      ),
    ].sort();
    for (const file of files) {
      const include =
        name === "copypaste-delivery"
          ? [
              "scripts/qa-admin-membership-ui.ts",
              "scripts/qa-auth.ts",
              "package.json",
              "package-lock.json",
            ].includes(file)
          : /^(src|migrations)\//.test(file) ||
            /^(package(-lock)?\.json|index\.html|vite\.config\.ts)$/.test(file);
      if (include)
        rows[`${name}/${file}`] = createHash("sha256")
          .update(await readFile(path.join(folder, file)))
          .digest("hex");
    }
  }
  return rows;
}
const beforeSources = await sourceHashes();
function client() {
  const c = { cookies: new Map<string, string>(), csrf: "" };
  clients.push(c);
  return c;
}
async function call(c: Client, method: string, url: string, body?: unknown) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const r = await fetch(origin + url, {
    method,
    headers: {
      Origin: web,
      "Idempotency-Key": randomUUID(),
      ...(c.csrf ? { "X-CSRF-Token": c.csrf } : {}),
      ...(tenant ? { "X-Tenant-ID": tenant } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  for (const value of r.headers.getSetCookie()) {
    const p = value.split(";")[0],
      i = p.indexOf("="),
      k = p.slice(0, i);
    if (/max-age=0(?:;|$)/i.test(value)) c.cookies.delete(k);
    else c.cookies.set(k, p.slice(i + 1));
  }
  return { status: r.status, data: await r.json() };
}
async function mail(id: string) {
  const end = Date.now() + 15000;
  do {
    try {
      return JSON.parse(
        await readFile(
          path.join(platform, ".data/mailbox", id + ".json"),
          "utf8",
        ),
      );
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  } while (Date.now() < end);
  throw new Error("Owned mailbox delivery missing");
}
async function login(c: Client, prefix: string) {
  const email = `${prefix}-${randomUUID()}@example.invalid`;
  let challenge: any;
  for (let n = 0; n < 4; n++) {
    challenge = await call(c, "POST", "/v1/auth/challenges", { email });
    if (challenge.status !== 429) break;
    await new Promise((r) => setTimeout(r, 31000));
  }
  assert.equal(challenge.status, 202);
  const m = await mail(challenge.data.challenge_id);
  assert.equal(m.to, email);
  const r = await call(c, "POST", "/v1/auth/sessions", {
    challenge_id: challenge.data.challenge_id,
    code: m.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(r.status, 201);
  const ctx = await call(c, "GET", "/v1/session/context");
  assert.equal(ctx.status, 200);
  c.csrf = ctx.data.csrf_token;
  return { email, id: ctx.data.user.id };
}
async function page(isAdmin: boolean, c?: Client) {
  const context = await browser!.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  contexts.push({ context, admin: isAdmin });
  context.setDefaultTimeout(15000);
  if (c)
    await context.addCookies(
      [...c.cookies].map(([name, value]) => ({
        name,
        value,
        url: web,
        httpOnly: true,
        sameSite: "Lax" as const,
      })),
    );
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
async function adminLogin(p: Page, email: string, secret: string) {
  await p.goto(admin, { waitUntil: "domcontentloaded", timeout: 15000 });
  await p.getByLabel("Administrator email").fill(email);
  const code = await emailCode(
    p,
    () =>
      p
        .getByRole("button", { name: "Send admin sign-in code", exact: true })
        .click(),
    true,
  );
  await p.locator('input[name="code"]').fill(code);
  await verifyAdmin(p, secret);
  await p.waitForURL("**/overview");
}
async function browserAPI(
  p: Page,
  url: string,
  method = "GET",
  body?: unknown,
) {
  return p.evaluate(
    async ({ url, method, body }) => {
      const module = "/src/api.ts";
      const a = await import(module);
      try {
        return {
          status: 200,
          data: await a.api(url, {
            method,
            ...(body === undefined
              ? {}
              : {
                  body: JSON.stringify(body),
                  headers: { "Idempotency-Key": crypto.randomUUID() },
                }),
          }),
        };
      } catch (e: any) {
        return { status: e.status, data: { code: e.code, message: e.message } };
      }
    },
    { url, method, body },
  );
}
async function shot(p: Page, repo: string, name: string) {
  await p.evaluate(async () => {
    await document.fonts.ready;
  });
  const folder = path.join(root, repo, "assets/screenshots");
  await mkdir(folder, { recursive: true });
  await p.screenshot({
    path: path.join(folder, name),
    fullPage: true,
    animations: "disabled",
  });
  screenshots.push({ repository: repo, file: name });
}
async function openChange(p: Page, user: string) {
  await p.goto(`${admin}/users/${user}`, { waitUntil: "domcontentloaded" });
  await p
    .getByRole("button", { name: "Manage membership", exact: true })
    .click();
  const d = p.getByRole("dialog", {
    name: "Manage workspace membership",
    exact: true,
  });
  await d.getByLabel("Membership state", { exact: true }).waitFor();
  return d;
}
async function change(
  p: Page,
  user: string,
  state: string,
  role: string,
  reason: string,
  requestReview = false,
  previewShot?: string,
) {
  const d = await openChange(p, user);
  await d.getByLabel("Role", { exact: true }).selectOption(role);
  await d.getByLabel("Membership state", { exact: true }).selectOption(state);
  await d.getByLabel("Reason", { exact: true }).fill(reason);
  const before = await db.query(
    "SELECT status,role,version,admin_suspended FROM memberships WHERE user_id=$1",
    [user],
  );
  await d
    .getByRole("button", { name: "Preview access changes", exact: true })
    .click();
  await d.getByText("Requested access", { exact: true }).waitFor();
  assert.deepEqual(
    (
      await db.query(
        "SELECT status,role,version,admin_suspended FROM memberships WHERE user_id=$1",
        [user],
      )
    ).rows,
    before.rows,
    "Preview must not change membership",
  );
  if (previewShot) await shot(p, "copypaste-admin", previewShot);
  const [r] = await Promise.all([
    p.waitForResponse(
      (r) =>
        /^\/v1\/admin\/tenants\/[a-f0-9-]+\/memberships$/.test(
          new URL(r.url()).pathname,
        ) && r.request().method() === "POST",
    ),
    d
      .getByRole("button", {
        name: requestReview ? "Submit for approval" : "Confirm change",
        exact: true,
      })
      .click(),
  ]);
  assert.equal(r.status(), 202);
  const operation = await r.json();
  return { operation, dialog: d };
}
let check: (schema: string, data: unknown) => void;
function sample(name: string, operation: string, data: unknown, status = 202) {
  check("AdminOperation", data);
  samples.push({
    name,
    operation,
    schema: "AdminOperation",
    status,
    response: data,
  });
}

try {
  const config = await (
    await fetch(origin + "/v1/public/config", {
      signal: AbortSignal.timeout(10000),
    })
  ).json();
  assert.equal(config.data_mode, "simulated");
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { seal } = await import(
    pathToFileURL(path.join(platform, "src/lib.ts")).href
  );
  const owner = client(),
    member = client();
  await login(owner, "admin-ui-membership-owner");
  const target = await login(member, "admin-ui-membership-member");
  const created = await call(owner, "POST", "/v1/tenants", {
    name: "Synthetic membership UI workspace",
    project_name: "Controlled project access",
  });
  assert.equal(created.status, 200);
  const tenant = created.data.tenant.id,
    project = created.data.project.id;
  const invite = await call(owner, "POST", `/v1/tenants/${tenant}/invites`, {
    email: target.email,
    role: "member",
    project_ids: [project],
  });
  assert.equal(invite.status, 201);
  const inviteMail = await mail(invite.data.id),
    token = new URL(
      inviteMail.text.match(/https?:\/\/\S+/)[0],
    ).searchParams.get("token");
  const accepted = await call(member, "POST", "/v1/invites/accept", { token });
  assert.equal(accepted.status, 201);
  const membership = accepted.data.id;
  const fixture = JSON.parse(
      await readFile(
        path.join(platform, "contracts/admin-membership-schemas.json"),
        "utf8",
      ),
    ),
    specBytes = await readFile(
      path.join(root, "../docs/contracts/openapi.json"),
    ),
    spec = JSON.parse(specBytes.toString());
  assert.equal(
    fixture.source_sha256,
    createHash("sha256").update(specBytes).digest("hex"),
  );
  for (const [name, schema] of Object.entries(fixture.schemas))
    assert.deepEqual(schema, spec.components.schemas[name]);
  const Ajv = requirePlatform("ajv/dist/2020.js").Ajv2020,
    ajv = new Ajv({ allErrors: true });
  requirePlatform("ajv-formats")(ajv);
  ajv.addKeyword({ keyword: "components", schemaType: "object" });
  ajv.addSchema({ $id: "original", components: spec.components });
  const validateOperation = ajv.compile({
    $ref: "original#/components/schemas/AdminOperation",
  });
  check = (schema, data) => {
    assert.equal(schema, "AdminOperation");
    assert.ok(
      validateOperation(data),
      JSON.stringify(validateOperation.errors),
    );
  };
  const admins = [];
  for (let n = 0; n < 2; n++) {
    const email = `admin-ui-membership-operator-${randomUUID()}@example.invalid`,
      secret = new OTPAuth.Secret({ size: 20 }),
      p = (
        await db.query(
          "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic membership UI operator',$2) RETURNING id",
          [email, seal(env.MASTER_KEY!, secret.base32)],
        )
      ).rows[0];
    principals.push(p.id);
    await db.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,'super_admin','tenant',$2)",
      [p.id, tenant],
    );
    admins.push({ email, secret: secret.base32 });
  }
  server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
    args: ["--disable-gpu"],
    timeout: 15000,
  });
  browser = await chromium.connect(server.wsEndpoint(), { timeout: 15000 });
  stage = "actual scoped Admin email/TOTP logins";
  const actor = await page(true);
  reviewer = await page(true);
  await adminLogin(actor, admins[0].email, admins[0].secret);
  await adminLogin(reviewer, admins[1].email, admins[1].secret);
  pass(
    "two real scoped Admin email/TOTP browser logins and an actual customer invitation fixture; original membership schemas unchanged",
  );
  stage = "pure suspension preview and actual user-facing notice";
  const suspended = await change(
    actor,
    target.id,
    "suspended",
    "member",
    "Suspend only this workspace for review",
    false,
    "29-membership-suspension-preview.png",
  );
  assert.equal(suspended.operation.state, "succeeded");
  sample("member-suspend", "changeAdminMembership", suspended.operation);
  const link = suspended.dialog.getByRole("link", {
    name: "View operation records",
    exact: true,
  });
  assert.equal(
    await link.getAttribute("href"),
    `/jobs?search=${suspended.operation.id}`,
  );
  await link.click();
  await actor.waitForURL(
    (u) =>
      u.pathname === "/jobs" &&
      u.searchParams.get("search") === suspended.operation.id,
  );
  assert.equal(
    (await call(member, "GET", `/v1/tenants/${tenant}/projects`)).status,
    404,
  );
  assert.equal((await call(member, "GET", "/v1/me")).status, 200);
  const customer = await page(false, owner);
  await customer.goto(web + "/app/members", { waitUntil: "domcontentloaded" });
  const row = customer.locator(`[data-member-id="${membership}"]`);
  await row
    .getByText("Contact a platform administrator to restore access.", {
      exact: true,
    })
    .waitFor();
  await shot(customer, "copypaste-web", "63-membership-admin-suspended.png");
  pass(
    "actual pure preview and confirmed suspension, correct operation navigation, live denial to existing customer session and visible workspace-owner suspension notice",
  );
  stage = "explicit restoration through the real Admin form";
  const restored = await change(
    actor,
    target.id,
    "active",
    "member",
    "Restore reviewed project access",
  );
  assert.equal(restored.operation.state, "succeeded");
  sample("member-restore", "changeAdminMembership", restored.operation);
  await actor.keyboard.press("Escape");
  assert.equal(
    (await call(member, "GET", `/v1/tenants/${tenant}/projects`)).status,
    200,
  );
  assert.equal(
    (await db.query("SELECT status FROM users WHERE id=$1", [target.id]))
      .rows[0].status,
    "active",
  );
  await customer.reload({ waitUntil: "domcontentloaded" });
  await row.waitFor();
  assert.equal(
    await row
      .getByText("Contact a platform administrator to restore access.", {
        exact: true,
      })
      .count(),
    0,
  );
  pass(
    "explicit restoration re-enables the original project without changing global user status or leaving a stale owner notice",
  );
  stage = "privileged-role submission and actual self-review rejection";
  const elevated = await change(
    actor,
    target.id,
    "active",
    "admin",
    "Privileged project administration requires a second operator",
    true,
  );
  pendingId = elevated.operation.id;
  assert.equal(elevated.operation.state, "pending_approval");
  sample(
    "member-elevation-pending",
    "changeAdminMembership",
    elevated.operation,
  );
  const reviewLink = elevated.dialog.getByRole("link", {
    name: "View operation records",
    exact: true,
  });
  assert.equal(
    await reviewLink.getAttribute("href"),
    `/audit?view=approvals&search=${pendingId}`,
  );
  await reviewLink.click();
  await actor.waitForURL(
    (u) =>
      u.pathname === "/audit" &&
      u.searchParams.get("view") === "approvals" &&
      u.searchParams.get("search") === pendingId,
  );
  await actor.getByTitle("Review operation", { exact: true }).click();
  let review = actor.getByRole("dialog", {
    name: "Independent review",
    exact: true,
  });
  await review.getByText("active / admin", { exact: true }).waitFor();
  await review
    .getByLabel("Reason", { exact: true })
    .fill("Self review must be rejected");
  const [self] = await Promise.all([
    actor.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
        `/v1/admin/operations/${pendingId}/decision`,
    ),
    review.getByRole("button", { name: "Confirm action", exact: true }).click(),
  ]);
  assert.equal(self.status(), 403);
  await review.getByRole("alert").waitFor();
  assert.equal(
    (await db.query("SELECT role FROM memberships WHERE id=$1", [membership]))
      .rows[0].role,
    "member",
  );
  await actor.keyboard.press("Escape");
  pass(
    "privileged role changes remain unapplied, navigate to their exact pending operation, and visible self-approval is rejected",
  );
  stage = "independent frozen-command review and actual approval";
  await reviewer.goto(`${admin}/audit?view=approvals&search=${pendingId}`, {
    waitUntil: "domcontentloaded",
  });
  await reviewer.getByTitle("Review operation", { exact: true }).click();
  review = reviewer.getByRole("dialog", {
    name: "Independent review",
    exact: true,
  });
  await review.getByText("active / admin", { exact: true }).waitFor();
  await review.getByText(project, { exact: true }).first().waitFor();
  await shot(
    reviewer,
    "copypaste-admin",
    "30-membership-independent-review.png",
  );
  await review
    .getByLabel("Reason", { exact: true })
    .fill("Independent operator reviewed frozen role and project scope");
  const [approved] = await Promise.all([
    reviewer.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
        `/v1/admin/operations/${pendingId}/decision`,
    ),
    review.getByRole("button", { name: "Confirm action", exact: true }).click(),
  ]);
  assert.equal(approved.status(), 200);
  const actual = await browserAPI(
    reviewer,
    `/v1/admin/operations/${pendingId}`,
  );
  assert.equal(actual.status, 200);
  assert.equal(actual.data.state, "succeeded");
  sample(
    "member-elevation-approved-read",
    "getAdminOperation",
    actual.data,
    200,
  );
  pendingId = "";
  const latest = (
    await db.query("SELECT role,admin_suspended FROM memberships WHERE id=$1", [
      membership,
    ])
  ).rows[0];
  assert.equal(latest.role, "admin");
  assert.equal(latest.admin_suspended, false);
  pass(
    "a different scoped administrator reviews the actual frozen command and approves; the original member gains only the recorded role and current operation is strict",
  );
  stage = "Traditional Chinese dark narrow-screen membership preview";
  await actor.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await actor.setViewportSize({ width: 390, height: 1000 });
  await actor.goto(`${admin}/users/${target.id}`, {
    waitUntil: "domcontentloaded",
  });
  await actor
    .getByRole("button", { name: "管理企業成員", exact: true })
    .click();
  const narrow = actor.getByRole("dialog", {
    name: "管理企業成員",
    exact: true,
  });
  await narrow.getByLabel("角色", { exact: true }).selectOption("viewer");
  await narrow
    .getByLabel("成員狀態", { exact: true })
    .selectOption("suspended");
  await narrow
    .getByLabel("操作原因", { exact: true })
    .fill("核對角色與專案範圍後重新審批");
  await narrow
    .getByRole("button", { name: "預覽權限差異", exact: true })
    .click();
  await narrow.getByText("變更後權限", { exact: true }).waitFor();
  assert.ok(
    await actor.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await shot(actor, "copypaste-admin", "31-membership-mobile-dark.png");
  await actor.keyboard.press("Escape");
  pass(
    "the actual Traditional Chinese dark/mobile preview retains frozen role, project and reason without page-width overflow or unintended changes",
  );
} catch (e) {
  errors.push((e as Error).stack ?? String(e));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  if (pendingId && reviewer) {
    try {
      const result = await browserAPI(
        reviewer,
        `/v1/admin/operations/${pendingId}/decision`,
        "POST",
        {
          decision: "reject",
          reason: "Cancel this owned unfinished verification operation",
        },
      );
      assert.equal(result.status, 200);
    } catch (e) {
      errors.push("Owned pending operation cleanup: " + (e as Error).message);
    }
  }
  for (const entry of contexts) {
    try {
      const where = entry.admin ? "/v1/admin/me" : "/v1/session/context",
        r = await entry.context.request.get(origin + where, { timeout: 5000 });
      if (r.status() === 401) continue;
      assert.equal(r.status(), 200);
      const data = await r.json();
      const ended = await entry.context.request.fetch(
        origin + (entry.admin ? "/v1/admin/auth/logout" : "/v1/auth/session"),
        {
          method: entry.admin ? "POST" : "DELETE",
          headers: {
            Origin: entry.admin ? admin : web,
            "Idempotency-Key": randomUUID(),
            "X-CSRF-Token": data.csrf_token,
          },
          timeout: 5000,
        },
      );
      assert.equal(ended.status(), 200);
      assert.equal(
        (
          await entry.context.request.get(origin + where, { timeout: 5000 })
        ).status(),
        401,
      );
    } catch (e) {
      sessionsClosed = false;
      errors.push("Owned browser session cleanup: " + (e as Error).message);
    }
  }
  for (const c of clients) {
    try {
      if (c.csrf) {
        const r = await call(c, "DELETE", "/v1/auth/session");
        assert.equal(r.status, 200);
      }
    } catch (e) {
      sessionsClosed = false;
      errors.push("Owned fixture logout: " + (e as Error).message);
    }
  }
  if (browser)
    await Promise.race([
      browser.close(),
      new Promise((_, r) =>
        setTimeout(() => r(new Error("Browser disconnect timed out")), 5000),
      ),
    ]).catch((e) => errors.push(e.message));
  if (server) {
    try {
      await Promise.race([
        server.close(),
        new Promise((_, r) =>
          setTimeout(
            () => r(new Error("Owned browser shutdown timed out")),
            5000,
          ),
        ),
      ]);
    } catch (e) {
      errors.push((e as Error).message);
      await server.kill();
    }
    closed =
      server.process().exitCode !== null ||
      server.process().signalCode !== null;
  }
  if (db) {
    try {
      if (principals.length) {
        await db.query(
          "UPDATE sessions SET revoked_at=now() WHERE admin_id=ANY($1::uuid[]) AND revoked_at IS NULL",
          [principals],
        );
        await db.query(
          "UPDATE admin_principals SET status='suspended',auth_version=auth_version+1 WHERE id=ANY($1::uuid[])",
          [principals],
        );
        principalsDisabled =
          Number(
            (
              await db.query(
                "SELECT count(*) AS n FROM admin_principals WHERE id=ANY($1::uuid[]) AND status='active'",
                [principals],
              )
            ).rows[0].n,
          ) === 0;
        assert.ok(principalsDisabled, "Owned administrators remain active");
      }
    } catch (e) {
      errors.push("Owned Admin fixture cleanup: " + (e as Error).message);
    } finally {
      await db.end();
    }
  }
  const afterSources = await sourceHashes(),
    stable = JSON.stringify(beforeSources) === JSON.stringify(afterSources);
  if (!stable)
    errors.push("Runtime/verifier changed during Admin membership QA");
  const report = {
    at: new Date().toISOString(),
    status:
      checks.length === 6 &&
      !errors.length &&
      closed &&
      sessionsClosed &&
      stable
        ? "passed"
        : "failed",
    scope:
      "Current source Admin membership form, supplementary frozen preview/review, exact operation navigation, independent approval and Web owner notice only; not complete normative approval directory, native journeys or full acceptance",
    model_calls: 0,
    checks,
    errors,
    stage,
    screenshots,
    browser_closed: closed,
    user_browser_tabs_touched: false,
    owned_sessions_closed: sessionsClosed,
    owned_admin_principals_disabled:
      principalsDisabled && principals.length === 2,
    owned_admin_principal_ids: principals,
    source_unchanged: stable,
    source_files: beforeSources,
  };
  await writeFile(
    "evidence/admin-membership-ui.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    "evidence/admin-membership-ui-contract-samples.json",
    JSON.stringify(
      {
        at: report.at,
        origin: admin,
        scope:
          "Four actual strict AdminOperation responses from synthetic customer Admin UI",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: checks.length,
      errors,
      browser_closed: closed,
    }),
  );
  if (report.status !== "passed") process.exitCode = 1;
}
