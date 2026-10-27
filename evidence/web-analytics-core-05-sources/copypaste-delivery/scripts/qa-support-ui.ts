import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  randomUUID,
  randomBytes,
  createHash,
  createCipheriv,
} from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const platform = path.resolve("../copypaste-platform"),
  origin = "http://localhost:4310",
  web = "http://localhost:4317",
  adminOrigin = "http://localhost:4318",
  requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth"),
  sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const checks: any[] = [],
  samples: any[] = [],
  screenshots: any[] = [],
  errors: string[] = [],
  contexts: BrowserContext[] = [],
  clients: Client[] = [];
let browser: Browser | undefined,
  db: any,
  userId = "",
  adminId = "",
  closed = false,
  credentialsClosed = false,
  stage = "initialize";
type Client = { id: string; cookie: string; csrf: string; admin: boolean };
const pass = (name: string) => checks.push({ name, status: "passed" });
async function sources() {
  const files: string[] = [];
  for (const repo of [
    "copypaste-platform",
    "copypaste-admin",
    "copypaste-web",
    "copypaste-desktop",
    "copypaste-extension",
  ]) {
    const list = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: path.resolve("..", repo), encoding: "utf8", windowsHide: true },
    ).split("\0");
    for (const f of list)
      if (
        /^(src|renderer|migrations|catalog|contracts|public)\//.test(f) ||
        /^(package(-lock)?|tsconfig)\.json$/.test(f)
      )
        files.push(`${repo}/${f}`);
  }
  files.push(
    "copypaste-delivery/scripts/qa-support-ui.ts",
    "copypaste-delivery/package.json",
    "copypaste-delivery/package-lock.json",
  );
  return Object.fromEntries(
    await Promise.all(
      files
        .sort()
        .map(async (f) => [f, sha(await readFile(path.resolve("..", f)))]),
    ),
  );
}
const sourceBefore = await sources();
async function call(
  c: Client | undefined,
  method: string,
  endpoint: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(origin + endpoint, {
    method,
    headers: {
      Origin: c?.admin || endpoint.startsWith("/v1/admin/") ? adminOrigin : web,
      "Idempotency-Key": randomUUID(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(c ? { Cookie: c.cookie, "X-CSRF-Token": c.csrf } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return {
    status: response.status,
    data: await response.json(),
    headers: response.headers,
  };
}
async function login(email: string, secret?: any): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth",
    challenge = await call(undefined, "POST", prefix + "/challenge", { email });
  assert.equal(challenge.status, 200);
  const mail = JSON.parse(
    await readFile(
      path.join(
        platform,
        ".data/mailbox",
        challenge.data.challenge_id + ".json",
      ),
      "utf8",
    ),
  );
  assert.equal(mail.to, email);
  const result = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    ...(secret
      ? {
          totp: new OTPAuth.TOTP({
            secret,
            digits: 6,
            period: 30,
            algorithm: "SHA1",
          }).generate(),
        }
      : {}),
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const c = {
    id: result.data.user?.id ?? result.data.admin?.id ?? "",
    cookie: result.headers
      .getSetCookie()
      .find((v) => v.startsWith(secret ? "cp_admin_session=" : "cp_session="))!
      .split(";")[0],
    csrf: result.data.csrf_token,
    admin: !!secret,
  };
  clients.push(c);
  return c;
}
async function pageFor(c: Client) {
  const context = await browser!.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  const [name, value] = c.cookie.split("=");
  await context.addCookies([
    {
      name,
      value,
      url: c.admin ? adminOrigin : web,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function capture(page: Page, repo: string, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime))).map((a) => a.finished.catch(() => {})));
    window.scrollTo(0, 0);
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "No horizontal overflow",
  );
  const file = path.resolve("..", repo, "assets/screenshots", name);
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push({
    file: "dev/" + repo + "/assets/screenshots/" + name,
    sha256: sha(await readFile(file)),
    viewport: page.viewportSize(),
    unedited: true,
  });
}
async function until(f: () => Promise<boolean>, name: string) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await f()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("Timed out: " + name);
}
try {
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8"));
  db = new pg.Client({ connectionString: env.CONTROL_DATABASE_URL });
  await db.connect();
  const config = await (await fetch(origin + "/v1/public/config")).json();
  assert.equal(config.data_mode, "simulated");
  const fixtureName = "Support customer " + randomUUID().slice(0, 8),
    customer = await login(`support-ui-${randomUUID()}@example.invalid`);
  userId = customer.id;
  await db.query("UPDATE users SET name=$2 WHERE id=$1", [userId, fixtureName]);
  const workspace = await call(customer, "POST", "/v1/tenants", {
    name: "CopyPaste support workflow",
    project_name: "Autumn campaign",
  });
  assert.equal(workspace.status, 200, JSON.stringify(workspace.data));
  const tenant = workspace.data.tenant.id,
    project = workspace.data.project.id;
  const secret = new OTPAuth.Secret({ size: 20 }),
    iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(env.MASTER_KEY!, "hex"),
      iv,
    ),
    encrypted = Buffer.concat([
      cipher.update(secret.base32, "utf8"),
      cipher.final(),
    ]),
    sealed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      "base64",
    ),
    email = `support-ui-admin-${randomUUID()}@example.invalid`;
  adminId = (
    await db.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'CopyPaste care operator',$2) RETURNING id",
      [email, sealed],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,'support_agent','tenant',$2)",
    [adminId, tenant],
  );
  const operator = await login(email, secret);
  operator.id = adminId;
  const account = (
    await db.query(
      "SELECT id FROM wallets WHERE tenant_id=$1 AND data_mode='simulated'",
      [tenant],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,output,role_key,role_hash,budget_micros,idempotency_key,billing_account_id) VALUES($1,$2,$3,'Investigate an autumn design export','Controlled shared design prompt','Controlled shared diagnostic result','assistant','fixture',1,$4,$5)",
    [tenant, project, userId, randomUUID(), account],
  );
  browser = await chromium.launch({
    executablePath: process.env.WEB_CHROME_BIN ?? process.env.CHROME_BIN,
    headless: true,
  });
  const userPage = await pageFor(customer),
    adminPage = await pageFor(operator);
  stage = "customer settings explicit authorization";
  await userPage.goto(web + "/app/settings");
  const userPanel = userPage.getByTestId("support-access");
  await userPanel.waitFor();
  await userPanel.getByRole("checkbox", { name: "Autumn campaign" }).check();
  await userPanel
    .getByLabel("Reason for assistance")
    .fill("Help check the autumn design task");
  const [grantResponse] = await Promise.all([
    userPage.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/support-grants" &&
        r.request().method() === "POST",
    ),
    userPanel
      .getByRole("button", { name: "Create a time-limited grant" })
      .click(),
  ]);
  assert.equal(grantResponse.status(), 201);
  const grant = await grantResponse.json();
  samples.push({
    operation: "POST /v1/support-grants",
    schema: "SupportGrant",
    status: 201,
    response: grant,
  });
  await userPanel.locator("code", { hasText: grant.id }).waitFor();
  await capture(userPage, "copypaste-web", "51-support-grant-en-1440.png");
  pass(
    "Customer selects actual projects and creates a real revocable grant in account settings",
  );
  stage = "admin target selection and actual session";
  await adminPage.goto(adminOrigin + "/support");
  const panel = adminPage.getByTestId("admin-support");
  await panel.getByLabel("Search customers").fill(fixtureName);
  await panel.getByRole("button", { name: "Search", exact: true }).click();
  await panel.getByRole("button", { name: new RegExp(fixtureName) }).click();
  await panel.getByLabel("Target workspace").selectOption(tenant);
  await panel.getByRole("checkbox", { name: project, exact: true }).check();
  await panel.getByLabel("Customer grant ID (optional)").fill(grant.id);
  await panel
    .getByLabel("Support reason", { exact: true })
    .fill("Investigate the customer design export");
  const [createdResponse] = await Promise.all([
    adminPage.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/admin/support/sessions" &&
        r.request().method() === "POST",
    ),
    panel
      .getByRole("button", { name: "Start read-only session", exact: true })
      .click(),
  ]);
  assert.equal(createdResponse.status(), 202);
  const created = await createdResponse.json(),
    id = created.result_ids[0];
  samples.push({
    operation: "POST /v1/admin/support/sessions",
    schema: "AdminOperation",
    status: 202,
    response: created,
  });
  const view = adminPage.getByTestId("support-view");
  await view.waitFor();
  await view.getByText("READ-ONLY SUPPORT VIEW", { exact: true }).waitFor();
  assert.ok((await view.innerText()).includes(adminId));
  assert.ok((await view.innerText()).includes(userId));
  await view
    .getByText("Investigate an autumn design export", { exact: true })
    .waitFor();
  assert.equal(
    await view.getByRole("button", { name: "Read authorized content" }).count(),
    0,
  );
  pass(
    "A13 searches the real directory, selects a user/project and opens a banner with real administrator, customer and expiry",
  );
  stage = "supported layouts and preferences";
  for (const width of [375, 768, 1024, 1440]) {
    await adminPage.setViewportSize({ width, height: 1050 });
    await capture(
      adminPage,
      "copypaste-admin",
      `51-support-en-light-${width}.png`,
    );
    const hiddenInput = await panel
      .locator("input,textarea,select,button")
      .evaluateAll((nodes) =>
        nodes
          .filter((el) => {
            const e = el as HTMLElement;
            if (!e.getClientRects().length) return false;
            if (e instanceof HTMLButtonElement)
              return !e.textContent?.trim() && !e.getAttribute("aria-label");
            return e instanceof HTMLInputElement && e.type === "hidden"
              ? false
              : !(e as HTMLInputElement).labels?.length &&
                  !e.getAttribute("aria-label");
          })
          .map((e) => e.outerHTML),
      );
    assert.deepEqual(
      hiddenInput,
      [],
      "Visible support controls have accessible names",
    );
  }
  await adminPage
    .getByTitle("切換至繁體中文", { exact: true })
    .click();
  await adminPage
    .getByTitle("Theme: light / dark / system", { exact: true })
    .click();
  await view.getByText("只讀客服視圖", { exact: true }).waitFor();
  assert.equal(
    await adminPage.locator("html").getAttribute("data-theme"),
    "dark",
  );
  await capture(adminPage, "copypaste-admin", "51-support-zh-dark-1440.png");
  await adminPage.setViewportSize({ width: 375, height: 1050 });
  await capture(adminPage, "copypaste-admin", "51-support-zh-dark-375.png");
  await userPage
    .getByTitle("切換至繁體中文", { exact: true })
    .click();
  await userPage
    .getByTitle("Theme: light / dark / system", { exact: true })
    .click();
  await userPage.setViewportSize({ width: 375, height: 1050 });
  await capture(userPage, "copypaste-web", "51-support-grant-zh-dark-375.png");
  pass(
    "Actual 375/768/1024/1440 layouts, Traditional Chinese/English, light/dark, named controls and unedited screenshots",
  );
  stage = "read-only authority and strict response samples";
  const listed = await call(
    operator,
    "GET",
    "/v1/admin/support/sessions?limit=20",
  );
  assert.equal(listed.status, 200);
  samples.push({
    operation: "GET /v1/admin/support/sessions",
    schema: "AdminSupportSessionList",
    status: 200,
    response: listed.data,
  });
  const actual = await call(
    operator,
    "GET",
    `/v1/admin/support/sessions/${id}/view`,
    undefined,
    { "X-CopyPaste-Support-Session": id },
  );
  assert.equal(actual.status, 200);
  samples.push({
    operation: "GET support view session",
    schema: "AdminSupportSession",
    status: 200,
    response: actual.data.session,
  });
  assert.doesNotMatch(
    JSON.stringify(actual.data),
    /Controlled shared design prompt|Controlled shared diagnostic result|token_hash|auth_version|amount_micros/,
  );
  for (const [method, endpoint, body] of [
    ["GET", "/v1/session/context", undefined],
    ["GET", "/v1/admin/me", undefined],
    ["POST", "/v1/admin/support/sessions", {}],
    ["POST", "/v1/admin/billing/payments", {}],
    ["POST", "/v1/admin/entitlements", {}],
    ["GET", "/v1/auth/sessions", undefined],
  ] as const)
    assert.equal(
      (
        await call(operator, method, endpoint, body, {
          "X-CopyPaste-Support-Session": id,
        })
      ).status,
      403,
    );
  pass(
    "Explicit read-only context rejects user credentials, other reads, write, payment and VIP endpoints; default support gets no body or financial data",
  );
  stage = "customer revokes while support is open";
  const row = userPanel.locator("article").filter({ hasText: grant.id });
  await row.getByRole("button", { name: "撤銷授權", exact: true }).click();
  await until(
    async () => (await view.count()) === 0,
    "revocation clears the administrator view",
  );
  const afterRevoke = await call(
    operator,
    "GET",
    `/v1/admin/support/sessions/${id}/view`,
    undefined,
    { "X-CopyPaste-Support-Session": id },
  );
  assert.equal(afterRevoke.status, 410);
  await capture(
    adminPage,
    "copypaste-admin",
    "51-support-revoked-zh-dark-375.png",
  );
  pass(
    "Customer revokes from the real page; subsequent reads fail and polling clears the open support view",
  );
  stage = "real expiry with no user impersonation";
  await adminPage
    .getByTitle("Switch to English", { exact: true })
    .click();
  await adminPage.setViewportSize({ width: 1440, height: 1050 });
  const expiring = await call(operator, "POST", "/v1/admin/support/sessions", {
    user_id: userId,
    tenant_id: tenant,
    project_ids: [project],
    mode: "read_only",
    expires_at: new Date(Date.now() + 4500).toISOString(),
    reason: "Observe actual support deadline",
  });
  assert.equal(expiring.status, 202);
  const expiryId = expiring.data.result_ids[0];
  await panel
    .getByRole("button", { name: "Refresh support sessions", exact: true })
    .click();
  const entry = panel.locator("article").filter({ hasText: expiryId });
  await entry
    .getByRole("button", { name: "Open read-only view", exact: true })
    .click();
  await view.waitFor();
  await until(
    async () => (await view.count()) === 0,
    "local clock clears an expired support view",
  );
  assert.equal(
    (
      await call(
        operator,
        "GET",
        `/v1/admin/support/sessions/${expiryId}/view`,
        undefined,
        { "X-CopyPaste-Support-Session": expiryId },
      )
    ).status,
    410,
  );
  pass(
    "Actual server deadline and conservative client clock clear an open view without a worker or alternate customer session",
  );
  stage = "strict original contract checks";
  const contract = JSON.parse(
      await readFile(
        path.join(platform, "contracts/admin-support-schemas.json"),
        "utf8",
      ),
    ),
    { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
    ajv = new Ajv2020({ allErrors: true });
  requirePlatform("ajv-formats")(ajv);
  const defs = JSON.parse(
    JSON.stringify(contract.schemas).replaceAll(
      "#/components/schemas/",
      "#/$defs/",
    ),
  );
  for (const sample of samples) {
    const valid = ajv.compile({
      $defs: defs,
      $ref: "#/$defs/" + sample.schema,
    });
    assert.ok(valid(sample.response), JSON.stringify(valid.errors));
  }
  pass(
    "Every collected canonical grant, operation, session and list response matches the unchanged original strict schema",
  );
  const cookieFacts = (
    await db.query("SELECT audience FROM sessions WHERE user_id=$1", [userId])
  ).rows;
  assert.deepEqual(cookieFacts, [{ audience: "user" }]);
  pass(
    "Support workflow created no customer access/refresh token or additional login session",
  );
} catch (e) {
  errors.push(stage + ": " + (e as Error).message);
} finally {
  try {
    for (const c of contexts) await c.close();
    await browser?.close();
    closed = true;
  } catch (e) {
    errors.push("Browser cleanup: " + (e as Error).message);
  }
  if (db) {
    try {
      if (userId)
        await db.query(
          "UPDATE support_grants SET revoked_at=clock_timestamp() WHERE granted_by=$1 AND revoked_at IS NULL",
          [userId],
        );
      if (adminId)
        await db.query(
          "UPDATE support_sessions SET revoked_at=clock_timestamp() WHERE principal_id=$1 AND revoked_at IS NULL",
          [adminId],
        );
      await db.query(
        "UPDATE sessions SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL AND (user_id=$1 OR admin_id=$2)",
        [userId || null, adminId || null],
      );
      if (adminId)
        await db.query(
          "UPDATE admin_principals SET status='suspended',auth_version=auth_version+1,version=version+1 WHERE id=$1",
          [adminId],
        );
      credentialsClosed = true;
    } catch (e) {
      errors.push("Credential cleanup: " + (e as Error).message);
    } finally {
      await db.end();
    }
  }
  const stable =
    JSON.stringify(sourceBefore) === JSON.stringify(await sources());
  if (!stable) errors.push("Sources changed during verification");
  const report = {
    at: new Date().toISOString(),
    status: errors.length ? "failed" : "passed",
    stage,
    scope:
      "Actual native HTTP/email/TOTP authorization and Web/Admin support forms, scoped metadata and revocation/expiry; synthetic model/media/payment dependencies; no customer impersonation or whole-product/production acceptance",
    checks,
    errors,
    screenshots,
    samples,
    browser_closed: closed,
    owned_credentials_revoked: credentialsClosed,
    user_tabs_touched: false,
    source_unchanged: stable,
    source_files: sourceBefore,
    verifier_sha256: sha(await readFile(import.meta.filename)),
  };
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/support-ui.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: checks.length,
      source_files: Object.keys(sourceBefore).length,
      screenshots: screenshots.length,
      browser_closed: closed,
      owned_credentials_revoked: credentialsClosed,
      errors,
    }),
  );
}
assert.equal(errors.length, 0, "Inspect the preserved support UI report");
