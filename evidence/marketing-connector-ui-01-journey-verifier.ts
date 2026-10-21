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
    path.resolve("../../docs/contracts/marketing-connector-openapi.json"),
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
  sha = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
  owned = path.resolve(".data/marketing-connector-ui", randomUUID());
let isolated: any,
  system: any,
  advance: any,
  server: BrowserServer | undefined,
  browser: Browser | undefined,
  stage = "setup",
  browserClosed = false,
  apiClosed = false,
  fixtureClosed = false,
  browserRuntime: any;
const pass = (name: string) => {
  checks.push({ name, status: "passed" });
  console.log("PASS: " + name);
};
function sample(name: string, value: any, route: string) {
  assert.ok(
    validators[name](value),
    name + " " + JSON.stringify(validators[name].errors),
  );
  samples.push({ schema: name, route, response: value });
  return value;
}
async function response(
  page: Page,
  method: string,
  endpoint: string,
  action: () => Promise<unknown>,
  schema: string,
  status = 200,
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
  return sample(schema, await r.json(), method + " " + endpoint);
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
async function shot(page: Page, repo: string, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const file = path.resolve(
    delivery,
    "../copypaste-" + repo,
    "assets/screenshots",
    `marketing-connectors-${attempt}-${name}.png`,
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
async function fit(page: Page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page fits viewport",
  );
  const modal = page.getByRole("dialog");
  if (await modal.count())
    assert.ok(
      await modal.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "Dialog fits viewport",
    );
}
async function finish(id: string) {
  for (let i = 0; i < 35; i++) {
    if (
      !(
        await system.db.control.query(
          "SELECT 1 FROM connector_jobs WHERE connection_id=$1 AND state IN('queued','running')",
          [id],
        )
      ).rowCount
    )
      return;
    await advance(system.db, system.storage);
  }
  throw new Error("Bounded synchronization did not finish");
}
async function context() {
  const c = await browser!.newContext({
    viewport: { width: 1440, height: 1080 },
    acceptDownloads: true,
  });
  contexts.push(c);
  c.setDefaultTimeout(15000);
  await c.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  return c;
}
async function operator(readonly = false) {
  const email = `connector-admin-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 }),
    { seal } = await import(
      pathToFileURL(path.join(platform, "src/lib.ts")).href
    ),
    p = (
      await system.db.control.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
        [
          email,
          readonly ? "Connection metadata reviewer" : "Connection operator",
          seal(system.db.config.MASTER_KEY, secret.base32),
        ],
      )
    ).rows[0].id;
  let role = "super_admin";
  if (readonly) {
    role = "connector-reader-" + randomUUID();
    await system.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
      [role, JSON.stringify(["admin.connections.read"])],
    );
  }
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",
    [p, role],
  );
  const c = await context(),
    page = await c.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(admin);
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
  const challengeBody = await challenge.json(),
    mail = JSON.parse(
      await readFile(
        path.join(
          isolated.directory,
          "mailbox",
          challengeBody.challenge_id + ".json",
        ),
        "utf8",
      ),
    );
  assert.equal(mail.to, email);
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
  const [verified] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/admin/auth/verify",
    ),
    page
      .getByRole("button", { name: "Verify & open dashboard", exact: true })
      .click(),
  ]);
  assert.equal(verified.status(), 200);
  await page.waitForURL(readonly ? "**/connections" : "**/overview");
  return page;
}
const deadline = setTimeout(() => {
  errors.push("Deadline at " + stage);
  void server?.kill();
}, 480000);
try {
  const load = async (f: string) =>
      import(pathToFileURL(path.join(platform, f)).href),
    { isolatedTestEnvironment } = await load(
      "tests/native-test-environment.ts",
    ),
    { buildApp } = await load("src/server.ts"),
    { loadConfig } = await load("src/config.ts");
  ({ advanceConnectors: advance } = await load("src/connectors.ts"));
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      DEMO_MODE: "true",
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
  page.on("pageerror", (e) => errors.push(e.message));
  stage = "customer email login and onboarding";
  await page.goto(web + "/login");
  const email = `connector-ui-${randomUUID()}@example.invalid`;
  await page.getByLabel("Work email").fill(email);
  const [challenge] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/auth/challenges",
    ),
    page
      .getByRole("button", { name: "Send sign-in code", exact: true })
      .click(),
  ]);
  assert.equal(challenge.status(), 202);
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
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour marketing team");
  await page.locator('input[name="project_name"]').fill("Hong Kong campaigns");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const me = await page.evaluate(
      async () => await (await fetch("/v1/session/context")).json(),
    ),
    cookie = (await c.cookies()).find((v) => v.name === "cp_session")!,
    client = { cookie: "cp_session=" + cookie.value, csrf: me.csrf_token },
    tenant = me.memberships[0].id,
    project = (await call(client, "GET", `/v1/tenants/${tenant}/projects`))
      .items[0].id;
  pass(
    "actual browser email sign-in, session restoration and company/project onboarding",
  );
  const connected: any[] = [];
  for (const provider of [
    { id: "google_ads", name: "Google Ads" },
    { id: "meta_ads", name: "Meta Ads" },
    { id: "ga4", name: "Google Analytics 4" },
    { id: "search_console", name: "Google Search Console" },
  ]) {
    stage = provider.name + " actual browser consent";
    await page.goto(web + "/app/connections");
    await page
      .getByRole("heading", { name: "Connections", exact: true })
      .waitFor();
    const card = page
      .locator(".connection-card")
      .filter({
        has: page.getByRole("heading", { name: provider.name, exact: true }),
      });
    const connection = await response(
      page,
      "POST",
      "/v1/connections",
      () =>
        card
          .getByRole("button", { name: "Connect account", exact: true })
          .click(),
      "Connection",
      201,
    );
    connected.push({ ...connection, provider: provider.id });
    await page
      .getByRole("button", {
        name: "允許模擬讀取 / Allow simulated read",
        exact: true,
      })
      .waitFor();
    assert.match(page.url(), /^http:\/\/127\.0\.0\.1:\d+\/consent\//);
    if (provider.id === "google_ads")
      await shot(page, "web", "simulated-consent");
    await page
      .getByRole("button", {
        name: "允許模擬讀取 / Allow simulated read",
        exact: true,
      })
      .click();
    await page.waitForURL("**/app/connections?connected=" + connection.id);
    await finish(connection.id);
    await page.locator(".connector-account").first().waitFor();
    const detail = sample(
      "ConnectorDetail",
      await call(
        client,
        "GET",
        `/v1/connections/${connection.id}/detail`,
        undefined,
        tenant,
      ),
      "GET current discovered scope",
    );
    assert.equal(detail.source_mode, "simulated");
    assert.equal(detail.connection.state, "active");
    for (const box of await page
      .locator(".connector-account input:not(:disabled)")
      .all())
      await box.check();
    if (provider.id === "google_ads")
      assert.equal(
        await page.locator(".connector-account input:disabled").count(),
        1,
      );
    const bound = await response(
      page,
      "PATCH",
      `/v1/connections/${connection.id}`,
      () =>
        page
          .getByRole("button", {
            name: "Confirm accounts & projects",
            exact: true,
          })
          .click(),
      "Connection",
    );
    assert.ok(bound.account_ids.length > 0);
    pass(
      provider.name +
        ": actual consent, authorized directory and explicit scope confirmation",
    );
    const queued = await response(
      page,
      "POST",
      `/v1/connections/${connection.id}/syncs`,
      () =>
        page
          .getByRole("button", { name: "Create snapshot", exact: true })
          .click(),
      "ConnectorSync",
      202,
    );
    if (provider.id === "ga4") {
      system.connectorFixture.setFaults("ga4", ["rate_limit"]);
      await advance(system.db, system.storage);
      await page
        .getByText(
          "The provider is temporarily rate-limiting requests. A retry follows its requested delay.",
          { exact: false },
        )
        .waitFor();
      assert.equal(
        (
          await system.db.control.query(
            "SELECT state FROM connector_jobs WHERE id=$1",
            [queued.id],
          )
        ).rows[0].state,
        "queued",
      );
      await system.db.control.query(
        "UPDATE connector_jobs SET next_attempt_at=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1",
        [queued.id],
      );
      pass(
        "GA4: provider rate limit is retained and shown before a scheduled retry",
      );
    }
    await finish(connection.id);
    await page
      .getByRole("button", { name: "Inspect facts & limits", exact: true })
      .first()
      .waitFor();
    const job = sample(
      "ConnectorSync",
      await call(client, "GET", `/v1/syncs/${queued.id}`, undefined, tenant),
      "GET completed sync",
    );
    assert.equal(job.state, "complete");
    const facts = await response(
      page,
      "GET",
      `/v1/connector-snapshots/${job.snapshot_id}`,
      () =>
        page
          .getByRole("button", { name: "Inspect facts & limits", exact: true })
          .first()
          .click(),
      "ConnectorFacts",
    );
    assert.equal(facts.source_mode, "simulated");
    assert.equal(facts.data_as_of, null);
    assert.equal(facts.facts.length, facts.row_count);
    await fit(page);
    if (provider.id === "meta_ads") {
      assert.equal(facts.facts[0].metrics.conversions, "2");
      assert.equal(facts.facts.at(-1).metrics.conversions, null);
      await shot(page, "web", "meta-facts-en");
    }
    if (provider.id === "ga4") {
      assert.ok(facts.limitations.includes("GA4_THRESHOLDING"));
      assert.equal(new Set(facts.facts.map((f: any) => f.profile)).size, 2);
      await shot(page, "web", "ga4-facts-en");
    }
    if (provider.id === "search_console")
      assert.ok(
        facts.limitations.includes("GSC_TOP_ROWS_ONLY_NOT_FULL_COVERAGE"),
      );
    await page.keyboard.press("Escape");
    for (const format of ["json", "csv"]) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page
          .locator(".connector-snapshot")
          .first()
          .getByRole("button", { name: format.toUpperCase(), exact: true })
          .click(),
      ]);
      const target = path.join(owned, provider.id + "." + format);
      await download.saveAs(target);
      const bytes = await readFile(target);
      assert.ok(bytes.length > 100);
      if (format === "json") {
        const body = JSON.parse(bytes.toString());
        assert.equal(body.facts.length, facts.row_count);
        assert.equal(body.spec_hash, facts.spec_hash);
      } else assert.ok(bytes.toString().includes("metrics_json"));
      downloads.push({
        provider: provider.id,
        format,
        bytes: bytes.length,
        sha256: sha(bytes),
        actual_browser_download: true,
      });
    }
    pass(
      provider.name +
        ": complete durable pagination, fixed facts, coverage limits and actual JSON/CSV downloads",
    );
  }
  stage = "cancellation and current source quarantine";
  const last = connected.at(-1);
  const cancel = await response(
    page,
    "POST",
    `/v1/connections/${last.id}/syncs`,
    () =>
      page
        .getByRole("button", { name: "Create snapshot", exact: true })
        .click(),
    "ConnectorSync",
    202,
  );
  await response(
    page,
    "POST",
    `/v1/syncs/${cancel.id}/cancel`,
    () =>
      page
        .getByRole("button", { name: "Cancel remaining reads", exact: true })
        .first()
        .click(),
    "ConnectorJob",
  );
  assert.equal(await advance(system.db, system.storage), null);
  pass("actual cancel action stops queued supplier reads without publishing");
  const current = await call(
      client,
      "GET",
      `/v1/connections/${last.id}/detail`,
      undefined,
      tenant,
    ),
    asset = current.snapshots[0].asset_id;
  await system.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [asset],
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".connector-snapshot").length === 0,
  );
  await system.db.control.query(
    "UPDATE assets SET state='active',moderation_version=moderation_version+1 WHERE id=$1",
    [asset],
  );
  await page
    .getByRole("button", { name: "Inspect facts & limits", exact: true })
    .first()
    .waitFor();
  pass(
    "current source quarantine removes download/facts actions and restoration retains original immutable history",
  );
  stage = "responsive bilingual workbench";
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await page.reload();
  await page.getByRole("heading", { name: "連接應用", exact: true }).waitFor();
  await fit(page);
  await shot(page, "web", "workspace-zh-dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await fit(page);
  await page
    .getByRole("button", { name: "檢查數據與限制", exact: true })
    .first()
    .click();
  await fit(page);
  await shot(page, "web", "facts-zh-narrow");
  await page.keyboard.press("Escape");
  pass(
    "Traditional Chinese dark and 390-pixel workbench/facts fit the viewport with bounded inner tables",
  );
  stage = "actual Admin login and connection metadata";
  const operatorPage = await operator();
  await operatorPage.goto(admin + "/connections");
  await operatorPage
    .locator('button[title="Connection details"]')
    .first()
    .waitFor();
  await operatorPage
    .locator('button[title="Connection details"]')
    .first()
    .click();
  let modal = operatorPage.getByRole("dialog", {
    name: "Connection & sync history",
    exact: true,
  });
  await modal.getByText("Not supplied by provider", { exact: true }).waitFor();
  assert.ok(
    !/access_token|refresh_token|encrypted_secret/.test(
      await modal.innerText(),
    ),
  );
  await fit(operatorPage);
  await shot(operatorPage, "admin", "connection-detail-en");
  await operatorPage.keyboard.press("Escape");
  pass(
    "actual Admin mailbox/TOTP sign-in and scoped metadata separate credentials and content-body permissions",
  );
  const meta = connected.find((c) => c.provider === "meta_ads");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => localStorage.setItem("cp_locale", "en"));
  await page.goto(web + "/app/connections?connected=" + meta.id);
  await page
    .getByRole("button", { name: "Create snapshot", exact: true })
    .waitFor();
  const pending = await response(
    page,
    "POST",
    `/v1/connections/${meta.id}/syncs`,
    () =>
      page
        .getByRole("button", { name: "Create snapshot", exact: true })
        .click(),
    "ConnectorSync",
    202,
  );
  const row = operatorPage.locator("tbody tr").filter({ hasText: meta.id });
  await row.locator('button[title="Revoke"]').click();
  modal = operatorPage.getByRole("dialog", {
    name: "Revoke access",
    exact: true,
  });
  await modal
    .locator('textarea[name="reason"]')
    .fill("Customer requested that future reads stop");
  const operation = await response(
    operatorPage,
    "POST",
    `/v1/admin/connections/${meta.id}/revocations`,
    () => modal.locator('button[type="submit"]').click(),
    "AdminOperation",
    202,
  );
  assert.equal(operation.state, "succeeded");
  assert.deepEqual(operation.result_ids, [meta.id]);
  await page
    .getByRole("button", { name: "Create snapshot", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      !!document
        .querySelector(".connector-scope .badge")
        ?.textContent?.includes("Revoked"),
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state FROM connector_jobs WHERE id=$1",
        [pending.id],
      )
    ).rows[0].state,
    "cancelled",
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT encrypted_secret FROM connections WHERE id=$1",
        [meta.id],
      )
    ).rows[0].encrypted_secret,
    null,
  );
  pass(
    "actual Admin canonical 202 revocation records its operation, cancels queued reads, clears credentials and updates the customer view",
  );
  stage = "metadata-only Admin permission controls";
  const reader = await operator(true);
  assert.equal(await reader.locator('button[title="Revoke"]').count(), 0);
  await reader.locator('button[title="Connection details"]').first().click();
  await reader
    .getByRole("dialog")
    .getByText("Not supplied by provider", { exact: true })
    .waitFor();
  assert.equal(
    await reader
      .getByRole("dialog")
      .getByRole("link", {
        name: "Review source content in the content panel",
        exact: true,
      })
      .count(),
    0,
  );
  await reader.keyboard.press("Escape");
  pass(
    "metadata-only Admin sees connection scope but has no revoke or source-body controls",
  );
  await operatorPage.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await operatorPage.reload();
  await operatorPage
    .locator('button[title="Connection details"]')
    .first()
    .click();
  await operatorPage
    .getByRole("dialog", { name: "連接與同步記錄", exact: true })
    .getByText("供應商未提供", { exact: true })
    .waitFor();
  await fit(operatorPage);
  await shot(operatorPage, "admin", "connection-zh-dark");
  await operatorPage.setViewportSize({ width: 390, height: 844 });
  await fit(operatorPage);
  await shot(operatorPage, "admin", "connection-zh-narrow");
  await operatorPage.keyboard.press("Escape");
  pass(
    "Traditional Chinese dark/narrow Admin metadata is readable and closes with Escape",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
} catch (error) {
  errors.push(stage + ": " + (error as Error).message);
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
    path.join(
      delivery,
      `evidence/marketing-connector-ui-${attempt}-journey.json`,
    ),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope:
          "Actual built Web/Admin with protocol-shaped synthetic HTTP suppliers and native PostgreSQL; no live provider account or whole-product qualification",
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
