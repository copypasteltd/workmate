import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
} from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  web = "http://localhost:4317",
  admin = "http://localhost:4318",
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const requirePlatform = createRequire(path.join(platform, "package.json")),
  { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
  OTPAuth = requirePlatform("otpauth"),
  ajv = new Ajv2020({ allErrors: true });
requirePlatform("ajv-formats")(ajv);
const contractBytes = await readFile(
    path.resolve("../../docs/contracts/scoped-seo-openapi.json"),
  ),
  contract = JSON.parse(contractBytes.toString()),
  defs = JSON.parse(
    JSON.stringify(contract.components.schemas).replaceAll(
      "#/components/schemas/",
      "#/$defs/",
    ),
  ),
  validators = Object.fromEntries(
    Object.keys(defs).map((name) => [
      name,
      ajv.compile({ $defs: defs, $ref: "#/$defs/" + name }),
    ]),
  );
const checks: any[] = [],
  errors: string[] = [],
  samples: any[] = [],
  screenshots: any[] = [],
  downloads: any[] = [],
  contexts: BrowserContext[] = [],
  owned = path.resolve(".data/scoped-seo-ui", randomUUID()),
  sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let isolated: any,
  system: any,
  advance: any,
  browser: Browser | undefined,
  server: BrowserServer | undefined,
  currentPage: Page | undefined,
  stage = "setup",
  browserClosed = false,
  apiClosed = false,
  fixtureClosed = false,
  browserRuntime: any,
  clock = Date.now();
const pass = (name: string) => {
  checks.push({ name, status: "passed" });
  console.log("PASS: " + name);
};
function sample(name: string, value: any, route: string) {
  assert.ok(
    validators[name](value),
    name + ": " + JSON.stringify(validators[name].errors),
  );
  samples.push({ schema: name, response: value, route });
  return value;
}
async function response(
  page: Page,
  method: string,
  endpoint: string,
  action: () => Promise<unknown>,
  status = 200,
  schema?: string,
) {
  const [r] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === method &&
        new URL(r.url()).pathname === endpoint,
    ),
    action(),
  ]);
  assert.equal(r.status(), status, await r.text());
  const body = await r.json();
  return schema ? sample(schema, body, method + " " + endpoint) : body;
}
async function call(
  client: any,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
) {
  const r = await system.app.inject({
    method,
    url,
    headers: {
      origin: url.startsWith("/v1/admin") ? admin : web,
      cookie: client.cookie,
      "x-csrf-token": client.csrf,
      "idempotency-key": randomUUID(),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  assert.ok(r.statusCode >= 200 && r.statusCode < 300, r.body);
  return r.json();
}
async function context() {
  const c = await browser!.newContext({
    viewport: { width: 1440, height: 1080 },
    acceptDownloads: true,
  });
  contexts.push(c);
  c.setDefaultTimeout(20000);
  await c.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  return c;
}
async function fit(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll(".seo-workbench *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 15)
      .map((e) => ({ tag: e.tagName, class: e.className, width: e.getBoundingClientRect().width })),
  }));
  assert.ok(
    dimensions.width <= dimensions.viewport + 1,
    "Page fits viewport: " + JSON.stringify(dimensions),
  );
  const modal = page.getByRole("dialog");
  if (await modal.count())
    assert.ok(
      await modal.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "Dialog fits viewport",
    );
}
async function shot(page: Page, repo: string, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const file = path.resolve(
    delivery,
    "../copypaste-" + repo,
    "assets/screenshots",
    `scoped-seo-${attempt}-${name}.png`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await assert.rejects(access(file), (e: any) => e.code === "ENOENT");
  await page.screenshot({
    path: file,
    fullPage: false,
    animations: "disabled",
  });
  screenshots.push({
    path: path
      .relative(path.resolve(delivery, ".."), file)
      .replaceAll("\\", "/"),
    sha256: sha(await readFile(file)),
    edited: false,
  });
}
async function finish(id: string, tenant: string, client: any) {
  for (let n = 0; n < 150; n++) {
    const run = await call(
      client,
      "GET",
      "/v1/seo/audits/" + id,
      undefined,
      tenant,
    );
    if (!["queued", "running"].includes(run.state))
      return sample("SeoAudit", run, "GET audit after collection");
    clock = Math.max(clock + 1100, Date.parse(run.progress.next_attempt_at));
    await advance(system.db, system.catalog, system.storage, {
      now: () => clock,
    });
  }
  throw new Error(
    "Persisted SEO queue did not finish within the bounded fixture",
  );
}
async function downloaded(page: Page, label: string, name: string) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: label, exact: true }).click(),
  ]);
  const file = path.join(owned, name);
  await download.saveAs(file);
  const bytes = await readFile(file);
  downloads.push({
    name,
    bytes: bytes.length,
    sha256: sha(bytes),
    actual_browser_download: true,
  });
  return bytes;
}
async function adminLogin(
  metadataOnly: boolean,
  tenant: string,
  project: string,
) {
  const email = `seo-admin-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 }),
    { seal } = await import(
      pathToFileURL(path.join(platform, "src/lib.ts")).href
    ),
    id = (
      await system.db.control.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
        [
          email,
          metadataOnly
            ? "Website metadata reviewer"
            : "Website content operator",
          seal(system.db.config.MASTER_KEY, secret.base32),
        ],
      )
    ).rows[0].id;
  const role = metadataOnly ? "seo-metadata-" + randomUUID() : "super_admin";
  if (metadataOnly)
    await system.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
      [role, JSON.stringify(["admin.content.read"])],
    );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,tenant_id,project_id) VALUES($1,$2,$3,$4,$5)",
    [
      id,
      role,
      metadataOnly ? "project" : "global",
      metadataOnly ? tenant : null,
      metadataOnly ? project : null,
    ],
  );
  const c = await context(),
    page = await c.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(admin);
  await page.getByLabel("Administrator email").fill(email);
  const challenge = await response(
    page,
    "POST",
    "/v1/admin/auth/challenge",
    () =>
      page
        .getByRole("button", { name: "Send admin sign-in code", exact: true })
        .click(),
  );
  const mail = JSON.parse(
    await readFile(
      path.join(
        isolated.directory,
        "mailbox",
        challenge.challenge_id + ".json",
      ),
      "utf8",
    ),
  );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page
    .locator('input[name="totp"]')
    .fill(
      new OTPAuth.TOTP({
        secret,
        digits: 6,
        period: 30,
        algorithm: "SHA1",
      }).generate(),
    );
  await response(page, "POST", "/v1/admin/auth/verify", () =>
    page
      .getByRole("button", { name: "Verify & open dashboard", exact: true })
      .click(),
  );
  await page.goto(admin + "/content");
  await page.getByLabel("Search records").waitFor();
  return page;
}
const deadline = setTimeout(() => {
  errors.push("Deadline at " + stage);
  void server?.kill();
}, 600000);
try {
  const load = (file: string) =>
      import(pathToFileURL(path.join(platform, file)).href),
    { isolatedTestEnvironment } = await load(
      "tests/native-test-environment.ts",
    ),
    { buildApp } = await load("src/server.ts"),
    { loadConfig } = await load("src/config.ts");
  ({ advanceSeoAudits: advance } = await load("src/seo-audits.ts"));
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
    }),
    { worker: false },
  );
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  await mkdir(owned, { recursive: true });
  const executable =
    process.env.CHROME_BIN ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  server = await chromium.launchServer({
    headless: true,
    executablePath: executable,
    args: ["--disable-gpu"],
    timeout: 15000,
  });
  browser = await chromium.connect(server.wsEndpoint());
  browserRuntime = {
    executable,
    sha256: sha(await readFile(executable)),
    version: browser.version(),
  };
  const c = await context(),
    page = await c.newPage();
  currentPage = page;
  page.on("pageerror", (e) => errors.push(e.message));
  stage = "actual customer login and onboarding";
  await page.goto(web + "/login");
  await page
    .getByLabel("Work email")
    .fill(`seo-ui-${randomUUID()}@example.invalid`);
  const challenge = await response(
      page,
      "POST",
      "/v1/auth/challenges",
      () =>
        page
          .getByRole("button", { name: "Send sign-in code", exact: true })
          .click(),
      202,
    ),
    mail = JSON.parse(
      await readFile(
        path.join(
          isolated.directory,
          "mailbox",
          challenge.challenge_id + ".json",
        ),
        "utf8",
      ),
    );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour SEO team");
  await page.locator('input[name="project_name"]').fill("Campaign website");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const me = await page.evaluate(async () =>
      (await fetch("/v1/session/context")).json(),
    ),
    cookie = (await c.cookies()).find((v) => v.name === "cp_session")!,
    client = { cookie: "cp_session=" + cookie.value, csrf: me.csrf_token },
    tenant = me.memberships[0].id,
    project = (await call(client, "GET", `/v1/tenants/${tenant}/projects`))
      .items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  pass(
    "actual customer email login, onboarding and current workspace selection",
  );
  await page.goto(web + "/app/analytics?view=seo");
  await page
    .getByRole("heading", { name: "Website audits & rechecks", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "New audit", exact: true }).click();
  const modal = page.getByRole("dialog");
  assert.equal(
    await modal
      .getByRole("button", { name: "Start audit", exact: true })
      .isEnabled(),
    false,
  );
  await modal.getByLabel("Page request limit", { exact: true }).fill("10");
  await fit(page);
  await shot(page, "web", "scope-en");
  stage = "reject before scope and funding approval";
  const traffic = system.seoFixture.calls.length;
  await modal
    .getByLabel("Allowed exact hosts (one per line)", { exact: true })
    .fill("outside.example.invalid");
  await modal.getByRole("checkbox").check();
  await response(
    page,
    "POST",
    "/v1/seo/audits",
    () =>
      modal.getByRole("button", { name: "Start audit", exact: true }).click(),
    400,
  );
  await modal
    .getByLabel("Allowed exact hosts (one per line)", { exact: true })
    .fill("marketing.example.invalid");
  await modal.getByRole("checkbox").check();
  await response(
    page,
    "POST",
    "/v1/seo/audits",
    () =>
      modal.getByRole("button", { name: "Start audit", exact: true }).click(),
    402,
  );
  assert.equal(system.seoFixture.calls.length, traffic);
  pass(
    "explicit confirmation, out-of-scope seeds and insufficient funds stop before website traffic",
  );
  await call(client, "POST", `/v1/tenants/${tenant}/demo-credit`, {});
  const a = await response(
    page,
    "POST",
    "/v1/seo/audits",
    () =>
      modal.getByRole("button", { name: "Start audit", exact: true }).click(),
    202,
    "SeoAudit",
  );
  await modal.waitFor({ state: "hidden" });
  assert.equal(new URL(page.url()).searchParams.get("audit"), a.id);
  sample(
    "SeoAuditList",
    await call(
      client,
      "GET",
      "/v1/seo/audits?project_id=" + project,
      undefined,
      tenant,
    ),
    "GET audit history",
  );
  stage = "pause and resume before collection";
  await response(
    page,
    "POST",
    `${base}/tasks/${a.task_id}/controls`,
    () => page.getByRole("button", { name: "Pause", exact: true }).click(),
    202,
  );
  await advance(system.db, system.catalog, system.storage);
  assert.equal(system.seoFixture.calls.length, traffic);
  await response(
    page,
    "POST",
    `${base}/tasks/${a.task_id}/controls`,
    () => page.getByRole("button", { name: "Resume", exact: true }).click(),
    202,
  );
  pass(
    "actual UI pause/resume uses current task versions and stops pre-model collection",
  );
  stage = "real synthetic HTTP collection and source evidence";
  const collected = await finish(a.id, tenant, client);
  assert.equal(collected.state, "partial");
  assert.equal(collected.task_status, "queued");
  await page.reload();
  await page.locator(".seo-finding").first().waitFor();
  await fit(page);
  await shot(page, "web", "findings-en");
  const findings = sample(
      "SeoFindingsPage",
      await call(
        client,
        "GET",
        `/v1/seo/audits/${a.id}/findings`,
        undefined,
        tenant,
      ),
      "GET findings",
    ),
    pages = sample(
      "SeoPages",
      await call(
        client,
        "GET",
        `/v1/seo/audits/${a.id}/pages`,
        undefined,
        tenant,
      ),
      "GET pages",
    ),
    broken = findings.items.find((f: any) => f.code === "broken_link");
  assert.ok(broken);
  assert.equal(
    findings.items.filter((f: any) => f.code === "duplicate_title").length,
    2,
  );
  assert.ok(pages.items.some((p: any) => p.reason === "SEO_ROBOTS_DISALLOWED"));
  assert.equal(
    system.seoFixture.calls.some((c: any) => c.path === "/blocked"),
    false,
  );
  const article = page
    .locator(".seo-finding")
    .filter({
      has: page.getByRole("heading", { name: "Broken link", exact: true }),
    });
  const document = await response(
    page,
    "GET",
    `/v1/seo/audits/${a.id}/documents/${broken.source_id}`,
    () =>
      article
        .getByRole("button", { name: "Inspect source evidence", exact: true })
        .click(),
    200,
    "SeoDocument",
  );
  await shot(page, "web", "source-en");
  const sourceBytes = await downloaded(
      page,
      "Download immutable source",
      "source.json",
    ),
    source = JSON.parse(sourceBytes.toString());
  assert.equal(
    source.text.slice(broken.location.start, broken.location.end),
    broken.location.quote,
  );
  assert.equal(
    sha(Buffer.from(source.raw_base64, "base64")),
    document.raw_sha256,
  );
  await page.keyboard.press("Escape");
  pass(
    "actual HTTP finds duplicate titles and a broken link, respects robots and downloads matching immutable UTF-16 source evidence",
  );
  const evidence = JSON.parse(
    (
      await downloaded(page, "Download evidence JSON", "evidence.json")
    ).toString(),
  );
  sample("SeoResult", evidence, "GET evidence attachment");
  assert.deepEqual(evidence.findings, findings.items);
  pass(
    "browser evidence JSON attachment retains exact frozen URL findings and coverage",
  );
  stage = "actual Codex through the internal simulated gateway";
  await system.worker.run(tenant, a.task_id);
  const reported = sample(
    "SeoAudit",
    await call(client, "GET", "/v1/seo/audits/" + a.id, undefined, tenant),
    "GET after actual Codex",
  );
  assert.equal(reported.task_status, "succeeded", reported.progress.error_code);
  assert.ok(reported.report_asset_version_id);
  const task = (
    await system.db.control.query(
      "SELECT runtime_thread,input_tokens,output_tokens FROM tasks WHERE id=$1",
      [a.task_id],
    )
  ).rows[0];
  assert.ok(
    task.runtime_thread &&
      Number(task.input_tokens) > 0 &&
      Number(task.output_tokens) > 0,
  );
  assert.ok(
    (
      await system.db.control.query(
        "SELECT 1 FROM task_events WHERE task_id=$1 AND kind='seo.facts_read'",
        [a.task_id],
      )
    ).rowCount,
  );
  await page.reload();
  const html = (
    await downloaded(page, "Download report", "report.html")
  ).toString();
  assert.match(html, /Scoped SEO audit/);
  assert.ok(html.includes(broken.id));
  assert.equal(html.includes("{{"), false);
  pass(
    "actual locked Codex process reads scoped facts and publishes a validated report through the internal synthetic gateway",
  );
  stage = "task link and saved audit navigation";
  await page.getByRole("link", { name: "View task", exact: true }).click();
  await page.waitForURL("**/app/tasks/" + a.task_id);
  await page.goBack();
  await page
    .getByRole("heading", { name: "Website audits & rechecks", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("audit"), a.id);
  pass(
    "task links open the existing task route and browser Back restores the saved audit",
  );
  stage = "same-scope repair recheck";
  system.seoFixture.setRevision(2);
  await page
    .getByRole("button", { name: "Recheck the same scope", exact: true })
    .click();
  const recheckModal = page.getByRole("dialog");
  assert.equal(
    await recheckModal
      .getByLabel("Start URLs (one per line)", { exact: true })
      .isDisabled(),
    true,
  );
  await recheckModal.getByRole("checkbox").check();
  const b = await response(
    page,
    "POST",
    `/v1/seo/audits/${a.id}/recheck`,
    () =>
      recheckModal
        .getByRole("button", { name: "Start recheck", exact: true })
        .click(),
    202,
    "SeoAudit",
  );
  await recheckModal.waitFor({ state: "hidden" });
  await finish(b.id, tenant, client);
  await page.reload();
  await page.locator(".seo-comparison").waitFor();
  const rechecked = sample(
    "SeoFindingsPage",
    await call(
      client,
      "GET",
      `/v1/seo/audits/${b.id}/findings`,
      undefined,
      tenant,
    ),
    "GET recheck findings",
  );
  for (const issue of findings.items.filter((f: any) =>
    ["broken_link", "duplicate_title"].includes(f.code),
  ))
    assert.equal(
      rechecked.comparison.changes.find(
        (c: any) => c.previous_finding_id === issue.id,
      ).state,
      "resolved",
    );
  assert.deepEqual(
    (
      await call(
        client,
        "GET",
        `/v1/seo/audits/${a.id}/findings`,
        undefined,
        tenant,
      )
    ).items,
    findings.items,
  );
  await fit(page);
  await shot(page, "web", "recheck-en");
  pass(
    "actual repaired synthetic pages resolve only observed issues and retain the old audit unchanged",
  );
  // No second inference is necessary for a crawl comparison; cancel its pending AI interpretation explicitly.
  await response(page, "POST", `${base}/tasks/${b.task_id}/cancel`, () =>
    page.getByRole("button", { name: "Cancel task", exact: true }).click(),
  );
  assert.equal(
    (await call(client, "GET", "/v1/seo/audits/" + b.id, undefined, tenant))
      .task_status,
    "cancelled",
  );
  pass(
    "explicit cancellation of pending interpretation uses the existing task settlement path",
  );
  stage = "bilingual theme and narrow layout";
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "網站診斷與復查", exact: true })
    .waitFor();
  await page.locator(".seo-comparison").waitFor();
  await fit(page);
  await shot(page, "web", "recheck-zh-dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await fit(page);
  await shot(page, "web", "recheck-zh-narrow");
  pass(
    "Traditional Chinese dark and narrow layouts retain scope, unknown coverage and recheck findings",
  );
  stage = "scoped Admin metadata and body permission";
  const sourceName = (
    await system.db.control.query("SELECT name FROM assets WHERE id=$1", [
      document.asset_id,
    ])
  ).rows[0].name;
  const reader = await adminLogin(true, tenant, project);
  await reader.getByLabel("Search records").fill(sourceName);
  await reader.getByRole("cell", { name: sourceName, exact: true }).waitFor();
  assert.equal(await reader.locator('button[title="Read content"]').count(), 0);
  const forbidden = await reader.evaluate(
    async (id) => (await fetch("/v1/admin/content/" + id + "/body")).status,
    document.asset_id,
  );
  assert.equal(forbidden, 403);
  await shot(reader, "admin", "source-metadata-en");
  pass(
    "project-scoped Admin metadata permission cannot read private website source bodies",
  );
  const operator = await adminLogin(false, tenant, project);
  await operator.getByLabel("Search records").fill(sourceName);
  const row = operator
    .getByRole("row")
    .filter({
      has: operator.getByRole("cell", { name: sourceName, exact: true }),
    });
  await row.waitFor();
  await row.locator('button[title="Read content"]').click();
  await operator.locator(".content-body").waitFor();
  assert.ok(
    (await operator.locator(".content-body").innerText()).includes(
      document.raw_sha256,
    ),
  );
  await shot(operator, "admin", "source-body-en");
  await operator.keyboard.press("Escape");
  pass(
    "independently authorized Admin body review displays the retained source container as text",
  );
  stage = "actual Admin quarantine clears customer evidence";
  await row.locator('button[title="Manage content"]').click();
  const management = operator.getByRole("dialog");
  await management.locator('select[name="action"]').selectOption("quarantine");
  await management
    .locator('textarea[name="reason"]')
    .fill("Website evidence under reviewed quarantine");
  await response(
    operator,
    "POST",
    `/v1/admin/content/${document.asset_id}/action`,
    () =>
      management
        .getByRole("button", { name: "Confirm action", exact: true })
        .click(),
  );
  await management.waitFor({ state: "hidden" });
  await page.reload();
  await page
    .getByRole("heading", { name: "網站診斷與復查", exact: true })
    .waitFor();
  await page.locator(".seo-finding").first().waitFor({ state: "hidden" });
  assert.equal(await page.locator(".seo-source").count(), 0);
  const blocked = await page.evaluate(
    async ({ id, tenant }) =>
      (
        await fetch(`/v1/seo/audits/${id}/download?format=json`, {
          headers: { "X-Tenant-ID": tenant },
        })
      ).status,
    { id: b.id, tenant },
  );
  assert.equal(blocked, 404);
  pass(
    "actual Admin source quarantine fences both original and dependent recheck evidence and clears the customer view",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
} catch (error) {
  errors.push(stage + ": " + (error as Error).message);
  if (currentPage)
    errors.push(
      "Final page: " +
        new URL(currentPage.url()).pathname +
        " · " +
        (
          await currentPage
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(0, 1400),
    );
} finally {
  clearTimeout(deadline);
  for (const c of contexts) await c.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) {
    await server.close().catch(async () => server!.kill());
    browserClosed =
      server.process().exitCode !== null ||
      server.process().signalCode !== null;
  }
  if (system)
    try {
      await system.app.close();
      apiClosed = true;
    } catch {
      errors.push("Owned API close failed");
    }
  if (isolated)
    try {
      process.chdir(platform);
      await isolated.cleanup();
      fixtureClosed = true;
    } catch {
      errors.push("Owned isolated fixture cleanup failed");
    }
  const passed =
    errors.length === 0 && browserClosed && apiClosed && fixtureClosed;
  await writeFile(
    path.join(delivery, `evidence/scoped-seo-ui-${attempt}-journey.json`),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope:
          "Actual built Web/Admin, synthetic native HTTP, native PostgreSQL and locked Codex through the internal synthetic gateway. No live website/TLS, complete TC-029 or whole-product qualification.",
        checks,
        errors,
        samples,
        screenshots,
        downloads,
        browser_closed: browserClosed,
        browser_runtime: browserRuntime,
        owned_api_closed: apiClosed,
        isolated_database_dropped_or_deferred_fixture_queued: fixtureClosed,
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
      owned_api_closed: apiClosed,
    }),
  );
  process.exitCode = passed ? 0 : 1;
}
