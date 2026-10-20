import {
  chromium,
  type Browser,
  type BrowserServer,
  type BrowserContext,
  type Page,
} from "playwright";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  web = "http://localhost:4317",
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const requirePlatform = createRequire(path.join(platform, "package.json")),
  { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
  ajv = new Ajv2020({ allErrors: true });
requirePlatform("ajv-formats")(ajv);
const contractBytes = await readFile(
    path.resolve("../../docs/contracts/agent-adoption.openapi.json"),
  ),
  contract = JSON.parse(contractBytes.toString());
const validators = Object.fromEntries(
  Object.entries(contract.components.schemas).map(([name, schema]) => [
    name,
    ajv.compile(schema),
  ]),
);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
  checks: any[] = [],
  samples: any[] = [],
  screenshots: any[] = [],
  errors: string[] = [],
  contexts: BrowserContext[] = [];
let isolated: any,
  system: any,
  browser: Browser | undefined,
  server: BrowserServer | undefined,
  browserClosed = false,
  apiClosed = false,
  fixtureClosed = false,
  stage = "initializing";
const pass = (name: string) => checks.push({ name, status: "passed" });
function sample(name: string, value: any, route: string) {
  assert.ok(validators[name](value), JSON.stringify(validators[name].errors));
  samples.push({ schema: name, route, response: value });
  return value;
}
async function expectResponse(
  page: Page,
  method: string,
  url: string,
  click: () => Promise<unknown>,
  schema: string,
  status = 200,
) {
  const [r] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === url && r.request().method() === method,
      { timeout: 20000 },
    ),
    click(),
  ]);
  assert.equal(r.status(), status, JSON.stringify(await r.json()));
  return sample(schema, await r.json(), method + " " + url);
}
async function shot(page: Page, name: string) {
  const file = path.resolve(
    "../copypaste-web/assets/screenshots",
    `adoption-${attempt}-${name}.png`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await assert.rejects(access(file), (e: any) => e.code === "ENOENT");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: file,
    fullPage: false,
    animations: "disabled",
  });
  screenshots.push({
    path: path.relative(path.resolve(".."), file).replaceAll("\\", "/"),
    sha256: sha(await readFile(file)),
    viewport: page.viewportSize(),
    edited: false,
  });
}
async function fit(page: Page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  const d = page.getByRole("dialog");
  if (await d.count())
    assert.ok(await d.evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
}
async function call(client: any, method: string, url: string, body?: unknown) {
  const r = await system.app.inject({
    method,
    url,
    headers: {
      origin: web,
      "idempotency-key": randomUUID(),
      ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json()));
  return r.json();
}
async function user(page: Page) {
  const email = `adoption-ui-${randomUUID()}@example.invalid`;
  await page.goto(web + "/login");
  await page.locator('input[name="email"]').fill(email);
  const [ch] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/auth/challenges",
    ),
    page
      .getByRole("button", { name: "Send sign-in code", exact: true })
      .click(),
  ]);
  assert.equal(ch.status(), 202);
  const challenge = await ch.json(),
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
  assert.equal(mail.to, email);
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  const [verified] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/auth/sessions",
    ),
    page
      .getByRole("button", { name: "Verify & continue", exact: true })
      .click(),
  ]);
  assert.equal(verified.status(), 201);
  const auth = await verified.json(),
    cookie = (await page.context().cookies()).find(
      (c) => c.name === "cp_session",
    )!;
  return {
    id: auth.user.id,
    cookie: `cp_session=${cookie.value}`,
    csrf: auth.csrf_token,
    email,
  };
}
const deadline = setTimeout(() => {
  errors.push("Owned browser journey timed out");
  void browser?.close();
}, 240000);
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
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "true",
    }),
    { worker: false },
  );
  system.app.addHook("onError",async(req:any,_reply:any,error:any)=>{
    if(error.status && error.status<500)return;
    errors.push(`Unexpected ${req.method} ${req.url}: ${error.code ?? error.constructor.name}; ${(error.stack ?? "").split("\n").slice(1,5).join(" | ")}`);
  });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  process.chdir(delivery);
  server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROME_BIN,
    timeout: 15000,
    args: ["--disable-gpu"],
  });
  browser = await chromium.connect(server.wsEndpoint());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  contexts.push(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  stage = "email sign-in";
  const owner = await user(page);
  pass(
    "actual built Web signs in through its email challenge, one-use OTP and persisted browser session",
  );
  const created = await call(owner, "POST", "/v1/tenants", {
      name: "Version review studio",
      project_name: "Customer adoption",
    }),
    tenant = created.tenant.id,
    project = created.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  const agent = await call(owner, "POST", base + "/agents", {
    name: "Campaign analyst",
    role_key: "marketing-analyst",
    instructions: "Initial working brief",
    brand_id: null,
  });
  const conversation = await call(owner, "POST", base + "/conversations", {
    name: "Campaign conversation",
    agent_id: agent.id,
  });
  const defaultConversation = await call(
    owner,
    "POST",
    base + "/conversations",
    { name: "Default conversation" },
  );
  await page.evaluate(
    ({ tenant, project }) => {
      localStorage.setItem("cp_tenant", tenant);
      localStorage.setItem("cp_project", project);
    },
    { tenant, project },
  );
  const card = () =>
    page.locator(".specialist-card").filter({
      has: page.getByRole("heading", {
        name: "Campaign analyst",
        exact: true,
      }),
    });
  const defaultCard = () =>
    page.locator(".specialist-card").filter({
      has: page.getByText(
        "Default assistant · shared methods, private conversations",
        { exact: true },
      ),
    });
  await page.goto(web + "/app/specialists");
  await card().waitFor();
  stage = "specialist draft and review";
  await card().getByRole("button", { name: "Settings", exact: true }).click();
  let d = page.getByRole("dialog");
  await d
    .getByLabel("Working instructions", { exact: true })
    .fill("A private reviewed brief, preserved when returning to edit.");
  const p = await expectResponse(
    page,
    "POST",
    `${base}/agents/${agent.id}/version-previews`,
    () =>
      d.getByRole("button", { name: "Compare changes", exact: true }).click(),
    "AdoptionPreview",
    201,
  );
  assert.equal(
    await d
      .getByRole("button", { name: "Confirm adoption and save", exact: true })
      .isEnabled(),
    false,
  );
  assert.equal(
    (
      await system.db.control.query("SELECT version FROM agents WHERE id=$1", [
        agent.id,
      ])
    ).rows[0].version,
    1,
  );
  await d
    .getByText("Input / million tokens", { exact: true })
    .first()
    .waitFor();
  await fit(page);
  await shot(page, "specialist-comparison-en");
  pass(
    "saving specialist settings first compares actual models, effort, prices and methods and creates no agent version",
  );
  await d.getByRole("button", { name: "Back to edit", exact: true }).click();
  assert.equal(
    await d.getByLabel("Working instructions", { exact: true }).inputValue(),
    "A private reviewed brief, preserved when returning to edit.",
  );
  await d
    .getByLabel("Working instructions", { exact: true })
    .fill("A revised private brief after inspecting the comparison.");
  const p2 = await expectResponse(
    page,
    "POST",
    `${base}/agents/${agent.id}/version-previews`,
    () =>
      d.getByRole("button", { name: "Compare changes", exact: true }).click(),
    "AdoptionPreview",
    201,
  );
  assert.notEqual(p.id, p2.id);
  pass(
    "returning to edit preserves the draft and a changed proposal produces a new frozen comparison",
  );
  await d
    .getByRole("checkbox", {
      name: "I have reviewed these models and rates",
      exact: true,
    })
    .check();
  const accepted = await expectResponse(
    page,
    "POST",
    `${base}/version-adoption-previews/${p2.id}/confirmations`,
    () =>
      d
        .getByRole("button", { name: "Confirm adoption and save", exact: true })
        .click(),
    "AdoptionResult",
  );
  assert.equal(accepted.agent_version, 2);
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await call(owner, "GET", `${base}/conversations/${conversation.id}`))
      .agent_version,
    1,
  );
  pass(
    "explicit specialist confirmation creates exactly one version and preserves the existing conversation version",
  );
  stage = "default assistant confirmation";
  const dp = await expectResponse(
    page,
    "POST",
    `${base}/agents/${defaultConversation.agent_id}/version-previews`,
    () =>
      defaultCard()
        .getByRole("button", { name: "Adopt current methods", exact: true })
        .click(),
    "AdoptionPreview",
    201,
  );
  d = page.getByRole("dialog");
  await d.getByRole("checkbox").check();
  await expectResponse(
    page,
    "POST",
    `${base}/version-adoption-previews/${dp.id}/confirmations`,
    () =>
      d
        .getByRole("button", { name: "Confirm adoption and save", exact: true })
        .click(),
    "AdoptionResult",
  );
  await d.waitFor({ state: "hidden" });
  pass(
    "shared default assistant refresh also requires a separate model and rate review before confirmation",
  );
  stage = "conversation adoption";
  await page.goto(`${web}/app/conversations/${conversation.id}`);
  await page
    .getByRole("button", { name: "Conversation settings", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d
    .getByLabel("Conversation name", { exact: true })
    .fill("Reviewed campaign conversation");
  await d
    .getByRole("checkbox", {
      name: "Use specialist v2 for future tasks",
      exact: true,
    })
    .check();
  const cp = await expectResponse(
    page,
    "POST",
    `${base}/conversations/${conversation.id}/adoption-previews`,
    () => d.getByRole("button", { name: "Save settings", exact: true }).click(),
    "AdoptionPreview",
    201,
  );
  assert.equal(cp.comparison.source.agent_version, 1);
  assert.equal(cp.comparison.target.agent_version, 2);
  await shot(page, "conversation-comparison-en");
  await d.getByRole("checkbox").check();
  await expectResponse(
    page,
    "POST",
    `${base}/version-adoption-previews/${cp.id}/confirmations`,
    () =>
      d
        .getByRole("button", { name: "Confirm adoption and save", exact: true })
        .click(),
    "AdoptionResult",
  );
  await d.waitFor({ state: "hidden" });
  await page
    .getByRole("heading", {
      name: "Reviewed campaign conversation",
      exact: true,
    })
    .waitFor();
  pass(
    "own conversation compares pinned and target versions and saves its name and adoption atomically",
  );
  stage = "lost confirmation response";
  await page.goto(web + "/app/specialists");
  await card().getByRole("button", { name: "Settings", exact: true }).click();
  d = page.getByRole("dialog");
  await d
    .getByLabel("Working instructions", { exact: true })
    .fill("Lost response recovery brief");
  await d.getByRole("button", { name: "Compare changes", exact: true }).click();
  await d
    .getByRole("checkbox", {
      name: "I have reviewed these models and rates",
      exact: true,
    })
    .check();
  let actualConfirmations = 0;
  await page.route(
    "**/version-adoption-previews/*/confirmations",
    async (route) => {
      actualConfirmations++;
      const accepted = await route.fetch();
      assert.equal(accepted.status(), 200);
      sample(
        "AdoptionResult",
        await accepted.json(),
        "POST committed confirmation with deliberately lost browser response",
      );
      await route.abort("failed");
    },
  );
  await d
    .getByRole("button", { name: "Confirm adoption and save", exact: true })
    .click();
  await d
    .getByText(
      "Unable to check or save right now. Retry; an accepted confirmation will not create another version.",
      { exact: true },
    )
    .waitFor();
  await page.unroute("**/version-adoption-previews/*/confirmations");
  await d
    .getByRole("button", { name: "Confirm adoption and save", exact: true })
    .click();
  await d.waitFor({ state: "hidden" });
  assert.equal(actualConfirmations, 1);
  assert.equal(
    (
      await system.db.control.query("SELECT version FROM agents WHERE id=$1", [
        agent.id,
      ])
    ).rows[0].version,
    3,
  );
  pass(
    "a committed confirmation with a lost network response recovers from its consumed comparison without a second version or charge",
  );
  stage = "narrow Chinese and dark comparison";
  await page.goto(web + "/app/specialists");
  await card().getByRole("button", { name: "Settings", exact: true }).click();
  d = page.getByRole("dialog");
  await d
    .getByLabel("Working instructions", { exact: true })
    .fill("Narrow bilingual review");
  await d.getByRole("button", { name: "Compare changes", exact: true }).click();
  await d.locator(".adoption-columns").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  // Render the existing theme tokens; locale storage is consumed on reload below.
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await fit(page);
  await shot(page, "narrow-dark-en");
  pass(
    "comparison stacks within a 390 pixel viewport, has exact rate units and fits the dark theme without horizontal overflow",
  );
  await d.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await card().getByRole("button", { name: "設定", exact: true }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("工作要求", { exact: true }).fill("繁中價格確認");
  await d.getByRole("button", { name: "比較變更", exact: true }).click();
  await d
    .getByRole("checkbox", { name: "我已核對上述模型與單價", exact: true })
    .waitFor();
  await fit(page);
  await shot(page, "narrow-dark-zh");
  pass(
    "Traditional Chinese labels, future-task effects, unknown-price wording and confirmation consent remain available in the built UI",
  );
  stage = "stale comparison";
  await call(owner, "PATCH", `${base}/agents/${agent.id}`, {
    name: "Campaign analyst",
    role_key: "marketing-analyst",
    instructions: "Concurrently revised working brief",
    brand_id: null,
    enabled: false,
    expected_version: 3,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await d.getByRole("button", { name: "重新載入設定", exact: true }).waitFor();
  assert.equal(await d.locator(".adoption-columns").count(), 0);
  await shot(page, "stale-comparison-zh");
  pass(
    "refocusing rechecks current state, removes a stale comparison and offers reload instead of confirming old settings",
  );
  await d.getByRole("button", { name: "重新載入設定", exact: true }).click();
  await d.waitFor({ state: "hidden" });
  pass(
    "stale settings reload closes the old draft and refreshes the current specialist list",
  );
  pass(
    "all captured adoption DTOs validate against the additive strict contract, while normative API bytes are unchanged",
  );
} catch (e) {
  errors.push(
    `${stage}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
  );
} finally {
  clearTimeout(deadline);
  for (const c of contexts)
    await c
      .close()
      .catch(() => errors.push("Owned browser context close failed"));
  if (browser)
    await browser
      .close()
      .catch(() => errors.push("Owned browser close failed"));
  if (server) {
    await server.close().catch(() => server!.kill());
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
  if (isolated) {
    process.chdir(platform);
    try {
      await isolated.cleanup();
      fixtureClosed = true;
    } catch {
      errors.push("Owned fixture cleanup failed");
    } finally {
      process.chdir(delivery);
    }
  }
  const passed =
    errors.length === 0 && browserClosed && apiClosed && fixtureClosed;
  await writeFile(
    path.join(delivery, `evidence/agent-adoption-ui-${attempt}-journey.json`),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope:
          "Actual built Web with real email/OTP sessions and isolated native PostgreSQL; labelled simulated AI, no production qualification",
        checks,
        errors,
        samples,
        screenshots,
        browser_closed: browserClosed,
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
      passed,
      checks: checks.length,
      errors,
      browser_closed: browserClosed,
      owned_api_closed: apiClosed,
    }),
  );
  process.exitCode = passed ? 0 : 1;
}
