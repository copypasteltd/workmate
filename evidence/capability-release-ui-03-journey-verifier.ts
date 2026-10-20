import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
  type Locator,
  type Response,
} from "playwright";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  admin = "http://localhost:4318",
  origin = "http://localhost:4310",
  root = "/v1/admin/capability-releases",
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const requirePlatform = createRequire(path.join(platform, "package.json")),
  OTPAuth = requirePlatform("otpauth"),
  { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
  ajv = new Ajv2020({ allErrors: true });
requirePlatform("ajv-formats")(ajv);
const contractPath = path.resolve(
    "../../docs/contracts/capability-releases.openapi.json",
  ),
  contractBytes = await readFile(contractPath),
  contract = JSON.parse(contractBytes.toString()),
  defs = JSON.parse(
    JSON.stringify(contract.components.schemas).replaceAll(
      "#/components/schemas/",
      "#/$defs/",
    ),
  );
const validators = Object.fromEntries(
  Object.keys(defs).map((name) => [
    name,
    ajv.compile({ $defs: defs, $ref: "#/$defs/" + name }),
  ]),
);
const checks: any[] = [],
  samples: any[] = [],
  screenshots: any[] = [],
  errors: string[] = [],
  contexts: BrowserContext[] = [];
let isolated: any,
  system: any,
  server: BrowserServer | undefined,
  browser: Browser | undefined,
  stage = "initializing",
  browserClosed = false,
  appClosed = false,
  databaseDropped = false;
let browserRuntime: {
  executable: string;
  sha256: string;
  version: string;
} | null = null;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex"),
  pass = (name: string) => checks.push({ name, status: "passed" });
function sample(schema: string, value: any, route: string) {
  const validator = validators[schema];
  assert.ok(validator(value), JSON.stringify(validator.errors));
  samples.push({ schema, route, response: value });
  return value;
}
async function response(
  page: Page,
  method: string,
  endpoint: string,
  click: () => Promise<unknown>,
  schema: string,
  status = 200,
) {
  const [r] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === endpoint &&
        r.request().method() === method,
      { timeout: 90000 },
    ),
    click(),
  ]);
  assert.equal(r.status(), status, endpoint);
  return sample(schema, await r.json(), method + " " + endpoint);
}
async function screenshot(page: Page, name: string) {
  const directory = path.resolve("../copypaste-admin/assets/screenshots");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `capabilities-${attempt}-${name}.png`);
  await assert.rejects(access(file), (error: any) => error.code === "ENOENT");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({
    path: file,
    fullPage: !(await page.getByRole("dialog").count()),
    animations: "disabled",
    timeout: 10000,
  });
  screenshots.push({
    path: path.relative(path.resolve(".."), file).replaceAll("\\", "/"),
    sha256: sha(await readFile(file)),
    viewport: page.viewportSize(),
    edited: false,
  });
}
async function fit(page: Page) {
  if (
    (page.viewportSize()?.width ?? Infinity) <= 740 &&
    !(await page.locator(".admin-shell.mobile-open").count())
  )
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar")!.getBoundingClientRect().right <= 1,
    );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page must fit the viewport",
  );
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    assert.ok(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "Dialog must fit its viewport",
    );
}
async function call(
  c: { cookie: string; csrf: string } | undefined,
  method: string,
  url: string,
  body?: unknown,
  headers = {},
) {
  const raw = await system.app.inject({
    method,
    url,
    headers: {
      origin: url.startsWith("/v1/admin") ? admin : "http://localhost:4317",
      "idempotency-key": randomUUID(),
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    payload: body ? JSON.stringify(body) : undefined,
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function login(name: string, readonly = false) {
  const email = `capability-ui-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 }),
    { seal } = await import(
      pathToFileURL(path.join(platform, "src/lib.ts")).href
    ),
    principal = (
      await system.db.control.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
        [email, name, seal(system.db.config.MASTER_KEY, secret.base32)],
      )
    ).rows[0].id;
  let role = "super_admin";
  if (readonly) {
    role = "capability-read-" + randomUUID();
    await system.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
      [role, JSON.stringify(["admin.catalog.read"])],
    );
  }
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",
    [principal, role],
  );
  const context = await browser!.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(admin, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Administrator email").fill(email);
  const [challenge] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/admin/auth/challenge",
    ),
    page
      .getByRole("button", { name: "Send admin sign-in code", exact: true })
      .click(),
  ]);
  assert.equal(challenge.status(), 200);
  const mail = JSON.parse(
    await readFile(
      path.join(
        isolated.directory,
        "mailbox",
        (await challenge.json()).challenge_id + ".json",
      ),
      "utf8",
    ),
  );
  assert.equal(mail.to, email);
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('input[name="totp"]').fill(
    new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  );
  const [verified] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/admin/auth/verify",
    ),
    page
      .getByRole("button", { name: "Verify & open dashboard", exact: true })
      .click(),
  ]);
  assert.equal(verified.status(), 200);
  const auth = await verified.json();
  await page.waitForURL(readonly ? "**/catalog" : "**/overview");
  const cookie = (await context.cookies()).find(
    (c) => c.name === "cp_admin_session",
  );
  assert.ok(cookie);
  return {
    page,
    principal,
    role,
    cookie: `cp_admin_session=${cookie.value}`,
    csrf: auth.csrf_token,
  };
}
const card = (page: Page, id: string) =>
  page.locator(`[data-release-id="${id}"]`);
async function catalog(page: Page) {
  const loaded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === root && r.request().method() === "GET",
  );
  await page.goto(admin + "/catalog?view=capabilities", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { name: "Model capabilities", exact: true })
    .waitFor();
  const result = await loaded;
  assert.equal(result.status(), 200);
  const data = sample(
    "CapabilityReleaseList",
    await result.json(),
    "GET current configuration list",
  );
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll("[data-release-id]").length === expected,
    data.items.length,
  );
}
async function draft(page: Page, from?: string, image = false) {
  await catalog(page);
  if (from)
    await card(page, from)
      .getByRole("button", { name: "Create new version", exact: true })
      .click();
  else
    await page
      .getByRole("button", { name: "Create configuration", exact: true })
      .click();
  const d = page.getByRole("dialog", {
    name: "Create model configuration",
    exact: true,
  });
  await d
    .getByLabel("Capability type", { exact: true })
    .selectOption(image ? "internal-image2-v1" : "internal-text-v1");
  await d
    .getByLabel("Internal model alias", { exact: true })
    .fill(image ? "image2-demo" : "copypaste-demo");
  if (image)
    await d
      .getByLabel("Rate per image (HKD)", { exact: true })
      .fill("0.250001");
  else {
    await d
      .getByLabel("Reasoning effort", { exact: true })
      .selectOption(from ? "max" : "medium");
    await d
      .getByLabel("Input rate (HKD / million tokens)", { exact: true })
      .fill(from ? "2.000001" : "0.000001");
    await d
      .getByLabel("Output rate (HKD / million tokens)", { exact: true })
      .fill(from ? "4.000001" : "1.234567");
  }
  await d
    .getByLabel("Operation reason", { exact: true })
    .fill("Synthetic UI configuration; internal simulated service only");
  const saved = await response(
      page,
      "POST",
      root + "/drafts",
      () =>
        d
          .getByRole("button", { name: "Save configuration", exact: true })
          .click(),
      "AdminOperation",
      202,
    ),
    id = saved.result_ids[0];
  await page
    .getByRole("dialog", { name: "Configuration & validation", exact: true })
    .waitFor();
  return id as string;
}
async function validate(page: Page, id: string) {
  const d = page.getByRole("dialog", {
    name: "Configuration & validation",
    exact: true,
  });
  await d
    .getByLabel("Validation reason", { exact: true })
    .fill("Synthetic UI protocol verification with actual pinned Codex");
  const result = await response(
    page,
    "POST",
    `${root}/${id}/validations`,
    () =>
      d.getByRole("button", { name: "Run validation", exact: true }).click(),
    "CapabilityValidation",
    202,
  );
  assert.equal(result.state, "passed");
  assert.equal(result.result.usage_known, true);
  assert.match(result.result.codex_binary_sha256, /^[a-f0-9]{64}$/);
  await d
    .getByRole("heading", { name: "Validation passed", exact: true })
    .waitFor();
  await screenshot(
    page,
    id === first
      ? "validation-text-en"
      : result.result.supported_operations?.includes("images.generate")
        ? "validation-image-en"
        : "validation-version-en",
  );
  await fit(page);
  await d.getByRole("button", { name: "Close", exact: true }).click();
  return result;
}
async function requestPublication(
  page: Page,
  id: string,
  rollback = false,
  editPreview = false,
) {
  await catalog(page);
  await card(page, id)
    .getByRole("button", {
      name: rollback ? "Preview rollback" : "Preview publication",
      exact: true,
    })
    .click();
  const d = page.getByRole("dialog", {
      name: rollback
        ? "Roll back model configuration"
        : "Publish model configuration",
      exact: true,
    }),
    suffix = rollback ? "rollbacks" : "publications";
  await d
    .getByLabel("Operation reason", { exact: true })
    .fill("Synthetic UI independent publication review");
  let preview = await response(
    page,
    "POST",
    `${root}/${id}/${suffix}-previews`,
    () =>
      d
        .getByRole("button", { name: "Compare configurations", exact: true })
        .click(),
    "CapabilityPublicationPreview",
  );
  if (editPreview) {
    await d
      .getByLabel("Operation reason", { exact: true })
      .fill("Updated synthetic UI independent publication reason");
    assert.equal(
      await d
        .getByRole("button", {
          name: "Request independent approval",
          exact: true,
        })
        .count(),
      0,
    );
    const renewed = await response(
      page,
      "POST",
      `${root}/${id}/${suffix}-previews`,
      () =>
        d
          .getByRole("button", { name: "Compare configurations", exact: true })
          .click(),
      "CapabilityPublicationPreview",
    );
    assert.notEqual(renewed.preview_id, preview.preview_id);
    preview = renewed;
    pass(
      "editing the reason invalidates the frozen comparison and requires a new preview",
    );
  }
  assert.equal(preview.before.proposed.release_id, id);
  await screenshot(
    page,
    rollback
      ? "rollback-comparison-en"
      : preview.before.current
        ? "publication-comparison-en"
        : "first-publication-en",
  );
  await fit(page);
  await d.getByRole("checkbox").check();
  const op = await response(
    page,
    "POST",
    `${root}/${id}/${suffix}`,
    () =>
      d
        .getByRole("button", {
          name: "Request independent approval",
          exact: true,
        })
        .click(),
    "AdminOperation",
    202,
  );
  assert.equal(op.state, "pending_approval");
  await d
    .getByRole("heading", {
      name: "Waiting for another administrator",
      exact: true,
    })
    .waitFor();
  await d.getByRole("link", { name: "View approval", exact: true }).click();
  return op;
}
async function review(page: Page, operation: any, own = false) {
  await page.goto(`${admin}/audit?view=approvals&search=${operation.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Review operation", exact: true })
    .click();
  const d = page.getByRole("dialog", {
    name: "Independent review",
    exact: true,
  });
  await d.getByLabel("Proposed model configuration", { exact: true }).waitFor();
  if (own) {
    await d
      .getByText("Another administrator must review this operation.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await d
        .getByRole("button", { name: "Confirm review decision", exact: true })
        .count(),
      0,
    );
    await d.getByRole("button", { name: "Close", exact: true }).click();
    return;
  }
  await screenshot(page, `independent-review-${++reviewIndex}-en`);
  await fit(page);
  await d.getByLabel("Decision", { exact: true }).selectOption("approve");
  await d
    .getByLabel("Review reason", { exact: true })
    .fill("Independent synthetic browser review of model effort and rates");
  const [r] = await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/v1\/admin\/approvals\/[^/]+\/decisions$/.test(
          new URL(r.url()).pathname,
        ) && r.request().method() === "POST",
    ),
    d
      .getByRole("button", { name: "Confirm review decision", exact: true })
      .click(),
  ]);
  assert.equal(r.status(), 202);
  const result = sample(
    "AdminOperation",
    await r.json(),
    "POST shared approval decision",
  );
  assert.equal(result.state, "succeeded");
  await d.waitFor({ state: "hidden" });
}
let first = "";
let reviewIndex = 0;
const deadline = setTimeout(() => {
  errors.push("UI verification deadline at " + stage);
  void server?.kill();
}, 480000);
try {
  const { isolatedTestEnvironment } = await import(
      pathToFileURL(path.join(platform, "tests/native-test-environment.ts"))
        .href
    ),
    { buildApp } = await import(
      pathToFileURL(path.join(platform, "src/server.ts")).href
    ),
    { loadConfig } = await import(
      pathToFileURL(path.join(platform, "src/config.ts")).href
    );
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  const configured = isolated.env.CODEX_BIN ?? "codex",
    binary = path.isAbsolute(configured)
      ? configured
      : execFileSync(
          process.platform === "win32" ? "where.exe" : "which",
          [configured],
          { windowsHide: true, encoding: "utf8" },
        )
          .split(/\r?\n/)
          .find((p) => path.isAbsolute(p.trim()))!
          .trim();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      CODEX_BIN: binary,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "true",
    }),
    { worker: false },
  );
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const browserExecutable = process.env.CHROME_BIN ?? chromium.executablePath(),
    browserHash = sha(await readFile(browserExecutable));
  server = await chromium.launchServer({
    headless: true,
    executablePath: browserExecutable,
    args: ["--disable-gpu"],
    timeout: 15000,
  });
  browser = await chromium.connect(server.wsEndpoint(), { timeout: 15000 });
  browserRuntime = {
    executable: browserExecutable,
    sha256: browserHash,
    version: browser.version(),
  };
  stage = "actual email and TOTP login";
  const operator = await login("Synthetic capability operator"),
    reviewer = await login("Synthetic independent capability reviewer"),
    page = operator.page;
  pass(
    "two actual independent email and TOTP Admin sessions in an isolated database",
  );
  stage = "typed text configuration and actual Codex validation";
  first = await draft(page);
  const text = await validate(page, first);
  assert.ok(text.result.checks.includes("tool_call_and_result"));
  const saved = sample(
    "CapabilityRelease",
    (await call(operator, "GET", root + "/" + first)).data,
    "GET exact text configuration",
  );
  assert.deepEqual(saved.document.rates, [1, 1234567]);
  assert.equal(saved.document.reasoning_effort, "medium");
  pass(
    "typed text fields preserve a single HKD micro and exact rates through real persistence and pinned Codex tool-loop validation",
  );
  stage = "first publication and self-review denial";
  const op1 = await requestPublication(page, first);
  await review(page, op1, true);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM capability_heads",
      )
    ).rows[0].n,
    0,
  );
  await review(reviewer.page, op1);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT release_id FROM capability_publications WHERE operation_id=$1",
        [op1.id],
      )
    ).rows[0].release_id,
    first,
  );
  pass(
    "request stays pending without a current head, self-review is unavailable, and independent UI review creates the actual publication",
  );
  stage = "new immutable version and publication comparison";
  const second = await draft(page, first);
  await validate(page, second);
  const op2 = await requestPublication(page, second, false, true);
  await review(reviewer.page, op2);
  assert.equal(
    (await call(operator, "GET", root + "/" + first)).data.state,
    "superseded",
  );
  assert.equal(
    (await call(operator, "GET", root + "/" + second)).data.state,
    "published",
  );
  pass(
    "new-version prefill, model/effort/rate comparison, and actual independent replacement publication",
  );
  stage = "actual rollback with new publication fact";
  const op3 = await requestPublication(page, first, true);
  await review(reviewer.page, op3);
  assert.equal(
    (await call(operator, "GET", root + "/" + first)).data.state,
    "published",
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT rollback FROM capability_publications WHERE operation_id=$1",
        [op3.id],
      )
    ).rows[0].rollback,
    true,
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM capability_publications",
      )
    ).rows[0].n,
    3,
  );
  pass(
    "rollback comparison and independent UI review append a fact and retain all prior publications",
  );
  stage = "image generation/edit validation";
  const image = await draft(page, undefined, true),
    imageReceipt = await validate(page, image);
  assert.ok(
    imageReceipt.result.checks.includes("images.generate") &&
      imageReceipt.result.checks.includes("images.edit"),
  );
  assert.equal(imageReceipt.result.known_cost_micros, "500002");
  pass(
    "image configuration validates generation and multipart editing and displays the exact combined synthetic cost",
  );
  stage = "responsive bilingual current page";
  await catalog(page);
  await screenshot(page, "catalog-en");
  await fit(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await fit(page);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector(".sidebar")!.getBoundingClientRect().left,
      ) <= 1,
  );
  await page
    .getByRole("button", { name: "Close navigation", exact: true })
    .click();
  await fit(page);
  pass(
    "mobile navigation opens on request and finishes closing before the configuration page is captured",
  );
  await screenshot(page, "catalog-mobile-en");
  await card(page, image)
    .getByRole("button", { name: "Configuration & validation", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Validation passed", exact: true })
    .waitFor();
  await fit(page);
  await screenshot(page, "image-mobile-en");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await page.reload();
  await page.getByRole("heading", { name: "模型能力", exact: true }).waitFor();
  await fit(page);
  await screenshot(page, "catalog-zh-dark");
  pass(
    "English and Traditional Chinese, light and dark, desktop and 390px layouts without horizontal overflow",
  );
  stage = "read-only and current read revocation";
  const readonly = await login("Synthetic read-only catalog operator", true);
  await catalog(readonly.page);
  await card(readonly.page, first).waitFor();
  assert.equal(
    await readonly.page
      .getByRole("button", { name: "Create configuration", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await readonly.page
      .getByRole("button", { name: "Preview publication", exact: true })
      .count(),
    0,
  );
  const denied = await call(readonly, "POST", root + "/drafts", {
    document: saved.document,
    reason: "Synthetic forbidden draft",
  });
  assert.equal(denied.status, 403);
  await screenshot(readonly.page, "read-only-en");
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,effect) VALUES($1,$2,'global','deny')",
    [readonly.principal, readonly.role],
  );
  await readonly.page.getByRole("alert").first().waitFor({ timeout: 20000 });
  assert.equal(await readonly.page.locator("[data-release-id]").count(), 0);
  pass(
    "read-only controls remain unavailable, the server rejects a forced mutation, and a new read deny clears previously loaded configurations",
  );
  stage = "strict supplemental customer DTO";
  const email = randomUUID() + "@example.invalid",
    challenge = await call(undefined, "POST", "/v1/auth/challenge", { email });
  const mail = JSON.parse(
      await readFile(
        path.join(
          isolated.directory,
          "mailbox",
          challenge.data.challenge_id + ".json",
        ),
        "utf8",
      ),
    ),
    auth = await call(undefined, "POST", "/v1/auth/verify", {
      challenge_id: challenge.data.challenge_id,
      code: mail.text.match(/\b\d{6}\b/)[0],
    });
  assert.equal(auth.status, 200);
  const cookie = auth.raw.cookies.find((c: any) => c.name === "cp_session"),
    customer = {
      cookie: `cp_session=${cookie.value}`,
      csrf: auth.data.csrf_token,
    };
  const tenant = await call(customer, "POST", "/v1/tenants", {
    name: "Synthetic capability UI customer",
    project_name: "Version inspection",
  });
  assert.equal(tenant.status, 200);
  for (const detailed of [false, true]) {
    const result = await call(
      customer,
      "GET",
      "/v1/capabilities" + (detailed ? "/details" : ""),
      undefined,
      { "x-tenant-id": tenant.data.tenant.id },
    );
    assert.equal(result.status, 200);
    sample(
      detailed ? "CapabilityDetailsList" : "CapabilityList",
      result.data,
      "GET customer capabilities" + (detailed ? "/details" : ""),
    );
  }
  pass(
    "actual customer identity and membership return strict original and additive capability contracts",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
} catch (error) {
  errors.push(stage + ": " + (error as Error).message);
} finally {
  clearTimeout(deadline);
  for (const context of contexts) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) {
    await server.close().catch(async () => server!.kill());
    browserClosed =
      server.process().exitCode !== null ||
      server.process().signalCode !== null;
  }
  if (system) {
    try {
      await system.app.close();
      appClosed = true;
    } catch {
      errors.push("Owned API close failed");
    }
  }
  if (isolated) {
    const previous = process.cwd();
    process.chdir(platform);
    try {
      await isolated.cleanup();
      databaseDropped = true;
    } catch {
      errors.push("Owned fixture/database cleanup failed");
    } finally {
      process.chdir(previous);
    }
  }
  const passed =
    errors.length === 0 && browserClosed && appClosed && databaseDropped;
  await writeFile(
    path.join(
      delivery,
      `evidence/capability-release-ui-${attempt}-journey.json`,
    ),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope:
          "Actual built Admin, real email/TOTP sessions, isolated native PostgreSQL, actual pinned Codex and labelled simulated AI/media; no production or original end-to-end acceptance claim",
        checks,
        errors,
        samples,
        screenshots,
        browser_closed: browserClosed,
        browser_runtime: browserRuntime,
        owned_api_closed: appClosed,
        isolated_database_dropped_or_deferred_fixture_queued: databaseDropped,
        supplemental_contract_sha256: sha(contractBytes),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: passed ? "passed" : "failed",
      checks: checks.length,
      errors,
      browser_closed: browserClosed,
      owned_api_closed: appClosed,
    }),
  );
  process.exitCode = passed ? 0 : 1;
}
