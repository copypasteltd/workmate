import assert from "node:assert/strict";
import {
  chromium,
  type Browser,
  type Page,
} from "../../copypaste-delivery/node_modules/playwright/index.mjs";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  WorkmateRecording,
  saveWorkmateScreenshot,
} from "../../copypaste-delivery/scripts/record-workmate-media.ts";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform-content-124"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.join(delivery, ".data/admin-profile-ui-" + attempt),
  checks: string[] = [],
  errors: string[] = [],
  screenshots: any[] = [],
  recordings: any[] = [],
  layouts: any[] = [];
let browser: Browser | undefined,
  system: any,
  isolated: any,
  recording: WorkmateRecording | undefined;
let stage = "setup",
  browserClosed = false,
  apiClosed = false,
  fixtureClosed = false;
// Playwright screenshots may restore the viewport when they finish. Serialize
// both operations so a recording frame cannot undo a responsive-layout resize.
let viewportTask: Promise<unknown> = Promise.resolve();
function withViewport<T>(action: () => Promise<T>): Promise<T> {
  const result = viewportTask.then(action);
  viewportTask = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
function capture(page: Page, options?: any) {
  return withViewport(() => page.screenshot(options));
}
function resize(page: Page, size: { width: number; height: number }) {
  return withViewport(() => page.setViewportSize(size));
}
const load = (file: string) =>
  import(pathToFileURL(path.join(platform, file)).href);
const pass = (name: string) => {
  checks.push(name);
  console.log("PASS: " + name);
};
async function shot(page: Page, name: string, description: string) {
  screenshots.push(
    await saveWorkmateScreenshot(
      "admin-content-124",
      "admin-profiles-" + attempt,
      name,
      await capture(page),
      description,
      delivery,
    ),
  );
}
async function finish() {
  if (recording) {
    const current = recording;
    recording = undefined;
    recordings.push(await current.stop());
  }
}
async function fit(page: Page) {
  const expectedWidth = page.viewportSize()!.width;
  try {
    await page.waitForFunction((width) => {
      const modal = document.querySelector<HTMLElement>(".modal");
      if (!modal || innerWidth !== width) return false;
      const box = modal.getBoundingClientRect();
      return box.left >= -1 && box.right <= innerWidth + 1;
    }, expectedWidth);
  } catch (error) {
    console.error(
      "LAYOUT_FAILURE",
      JSON.stringify(
        await page.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          nodes: [
            ...document.querySelectorAll<HTMLElement>(
              ".modal,.modal-backdrop,.revision-layout,.revision-form,.revision-profile-section,.field",
            ),
          ].map((e) => ({
            tag: e.tagName,
            class: e.className,
            left: e.getBoundingClientRect().left,
            right: e.getBoundingClientRect().right,
            width: e.getBoundingClientRect().width,
            scroll: e.scrollWidth,
            min: getComputedStyle(e).minWidth,
            grid: getComputedStyle(e).gridTemplateColumns,
          })),
        })),
      ),
    );
    throw error;
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  const observed = await page.locator(".modal").evaluate((modal) => {
    const box = modal.getBoundingClientRect();
    const fields = [
      ...modal.querySelectorAll<HTMLElement>(
        "input:not([type=checkbox]),select,textarea",
      ),
    ].filter((field) => field.getClientRects().length > 0);
    return {
      viewport_width: innerWidth,
      viewport_height: innerHeight,
      dialog_left: box.left,
      dialog_right: box.right,
      dialog_width: box.width,
      page_fits: document.documentElement.scrollWidth <= innerWidth,
      dialog_content_fits: modal.scrollWidth <= modal.clientWidth,
      visible_fields: fields.length,
      fields_inside_viewport: fields.every((field) => {
        const rect = field.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= innerWidth + 1;
      }),
    };
  });
  assert.equal(observed.viewport_width, expectedWidth);
  assert.ok(
    observed.dialog_left >= -1 && observed.dialog_right <= expectedWidth + 1,
    "The whole dialog must fit the viewport, not merely hide its overflow",
  );
  assert.equal(observed.page_fits, true, "No page horizontal overflow");
  assert.equal(
    observed.dialog_content_fits,
    true,
    "No dialog horizontal overflow",
  );
  assert.ok(
    observed.visible_fields > 0 && observed.fields_inside_viewport,
    "Every form field must fit horizontally",
  );
  layouts.push(observed);
}
try {
  const [
    { isolatedTestEnvironment },
    { buildApp },
    { loadConfig },
    { seal },
    { defaults },
  ] = await Promise.all([
    load("tests/native-test-environment.ts"),
    load("src/server.ts"),
    load("src/config.ts"),
    load("src/lib.ts"),
    load("src/plans.ts"),
  ]);
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
      API_ORIGIN: "http://localhost:4310",
      WEB_ORIGIN: "http://localhost:4317",
      ADMIN_ORIGIN: "http://localhost:4318",
    }),
    { worker: false },
  );
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const OTP = createRequire(path.join(platform, "package.json"))("otpauth"),
    secret = new OTP.Secret({ size: 20 }),
    email = `admin-content-ui-${randomUUID()}@example.invalid`;
  async function inject(client: any, method: string, url: string, body?: any) {
    const response = await system.app.inject({
      method,
      url,
      headers: {
        origin: "http://localhost:4317",
        ...(client
          ? { cookie: client.cookie, "x-csrf-token": client.csrf }
          : {}),
        ...(client?.tenant ? { "x-tenant-id": client.tenant } : {}),
        "idempotency-key": randomUUID(),
      },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.ok(
      response.statusCode >= 200 && response.statusCode < 300,
      `${method} ${url}: ${response.statusCode} ${response.body}`,
    );
    return { data: response.json(), raw: response };
  }
  const customerEmail = `content-customer-${randomUUID()}@example.invalid`,
    challenge = (
      await inject(null, "POST", "/v1/auth/challenge", { email: customerEmail })
    ).data;
  const customerMail = JSON.parse(
    await readFile(
      path.join(
        isolated.directory,
        "mailbox",
        challenge.challenge_id + ".json",
      ),
      "utf8",
    ),
  );
  const verified = await inject(null, "POST", "/v1/auth/verify", {
    challenge_id: challenge.challenge_id,
    code: customerMail.text.match(/\b\d{6}\b/)[0],
  });
  const cookie = verified.raw.cookies.find((c: any) => c.name === "cp_session"),
    customer: any = {
      id: verified.data.user.id,
      cookie: cookie.name + "=" + cookie.value,
      csrf: verified.data.csrf_token,
    };
  const workspace = (
    await inject(customer, "POST", "/v1/tenants", {
      name: "Harbour content studio · Explicit demo",
      project_name: "Hong Kong launch",
    })
  ).data;
  const tenant = workspace.tenant.id,
    project = workspace.project.id,
    userBase = `/v1/tenants/${tenant}/projects/${project}`;
  customer.tenant = tenant;
  await inject(customer, "POST", `/v1/tenants/${tenant}/demo-credit`, {});
  await system.db.control.query(
    "INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic UI fixture; no payment received',$2)",
    [tenant, defaults.business],
  );
  const brand = (
    await inject(customer, "POST", userBase + "/brand/definitions", {
      schema_version: 2,
      name: "Harbour approved brand",
      colors: ["#1F5EFF"],
      tone: "Clear bilingual Hong Kong copy",
      approved_copy: "Use verified customer facts",
      fonts: [],
      logos: [],
      facts: [],
      font_bindings: [
        {
          key: "headline",
          label: "Noto Sans TC",
          source: { builtin: "noto-sans-tc" },
          rights: {
            source: "Bundled Google Noto font",
            license: "SIL Open Font License 1.1",
            channels: ["social"],
            valid_until: null,
          },
        },
      ],
      locales: ["zh-Hant-HK", "en-HK"],
      channels: ["social"],
      restrictions: "Use approved facts only",
    })
  ).data;
  const agent = (
    await inject(customer, "POST", userBase + "/agents", {
      name: "Harbour campaign specialist",
      role_key: "assistant",
      instructions: "Use approved campaign evidence and company tools",
      brand_id: brand.id,
    })
  ).data;
  const conversation = (
    await inject(customer, "POST", userBase + "/conversations", {
      name: "Pinned customer conversation",
      agent_id: agent.id,
    })
  ).data;
  const memory = (
    await inject(customer, "POST", userBase + "/memories", {
      name: "Harbour private campaign memory",
      scope: "conversation",
      conversation_id: conversation.id,
      content: "Original private customer notes",
      expires_at: null,
    })
  ).data;
  const [{ projectAccess }, { saveAsset }] = await Promise.all([
    load("src/access.ts"),
    load("src/storage.ts"),
  ]);
  const logo = await system.db.tx(async (tx: any) => {
    await projectAccess(
      tx,
      { id: customer.id, authVersion: 1, admin: false },
      tenant,
      project,
      "write",
    );
    return saveAsset(tx, system.storage, {
      tenant,
      project,
      user: customer.id,
      name: "Harbour approved logo.png",
      mime: "image/png",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  }, tenant);
  const admin = (
    await system.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Harbour content administrator',$2) RETURNING id",
      [email, seal(system.db.config.MASTER_KEY, secret.base32)],
    )
  ).rows[0];
  const role = "content_ui_" + randomUUID();
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Scoped UI content revision',$2)",
    [
      role,
      JSON.stringify([
        "admin.content.read",
        "admin.content.body.read",
        "admin.content.version.create",
      ]),
    ],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)",
    [admin.id, role, project],
  );
  const originalCounts = (
    await system.db.control.query(
      "SELECT (SELECT count(*) FROM tasks)::text AS tasks,(SELECT count(*) FROM reservations)::text AS reservations,(SELECT count(*) FROM ai_gateway_requests)::text AS gateway",
    )
  ).rows[0];
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
      timezoneId: "Asia/Hong_Kong",
    }),
    page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  stage = "real administrator email and MFA";
  await page.goto("http://localhost:4318/login");
  await page.locator('input[name="email"]').fill(email);
  const [ch] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/admin/auth/challenge",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(ch.ok(), true);
  const mail = JSON.parse(
    await readFile(
      path.join(
        isolated.directory,
        "mailbox",
        (await ch.json()).challenge_id + ".json",
      ),
      "utf8",
    ),
  );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('input[name="totp"]').fill(
    new OTP.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  );
  await page.locator('form button[type="submit"]').click();
  await page.locator(".admin-shell").waitFor();
  await page.goto("http://localhost:4318/content");
  await page
    .getByRole("row")
    .filter({ hasText: "Harbour campaign specialist" })
    .waitFor();
  pass(
    "Real email challenge and replay-protected MFA open a project-scoped content workspace",
  );
  async function openContent(name: string) {
    await page.goto("http://localhost:4318/content");
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: /^Revise$|^修訂$/ })
      .click();
    await page.locator(".revision-form").waitFor();
  }
  async function previewChanges() {
    await page
      .locator(".content-revision")
      .getByRole("button", { name: /Preview changes|預覽修訂差異/ })
      .click();
    await page.locator(".revision-diff").first().waitFor();
    await page.waitForFunction(() =>
      document.activeElement?.classList.contains("revision-review"),
    );
    assert.equal(
      await page.locator(".revision-review .button.primary").isDisabled(),
      true,
    );
  }
  async function confirm() {
    await page.locator(".revision-consent input").check();
    await page.locator(".revision-review .button.primary").click();
    await page.locator(".revision-success").waitFor();
    await page.waitForFunction(() =>
      document.activeElement?.classList.contains("revision-success"),
    );
  }
  async function sizes() {
    for (const width of [1440, 1024, 768, 375]) {
      await resize(page, { width, height: 1000 });
      await fit(page);
    }
    await resize(page, { width: 1440, height: 1080 });
  }
  function record(name: string, source: string) {
    recording = new WorkmateRecording(
      "admin-content-124",
      name,
      "admin-profiles-" + attempt,
      () => capture(page, { type: "jpeg", quality: 78 }),
      source,
      delivery,
    );
    return recording.start();
  }
  const reason = () =>
    page.getByLabel(/修訂原因|Reason for revision/, { exact: true });
  const name = () => page.getByLabel(/名稱|Name/, { exact: true });

  stage = "actual specialist revision with pinned dependencies";
  await openContent(agent.name);
  await record(
    "specialist-revision",
    "Actual specialist instructions, fixed tool subset, review and explicit consent",
  );
  await name().fill("Harbour specialist · approved revision");
  await page
    .getByLabel("Instructions", { exact: true })
    .fill(
      "Use approved Hong Kong brand facts. Return editable source files and evidence.",
    );
  await reason().fill("Customer confirmed updated specialist instructions");
  await sizes();
  await shot(
    page,
    "specialist-form-en",
    "Structured specialist editing retains Codex, model, skill and brand bindings",
  );
  await previewChanges();
  await confirm();
  await shot(
    page,
    "specialist-receipt-en",
    "Actual committed specialist revision with administrator attribution",
  );
  await finish();
  const specialistVersions = (
    await inject(customer, "GET", userBase + `/agents/${agent.id}/versions`)
  ).data.items;
  assert.equal(specialistVersions[0].origin, "administrator");
  assert.equal(specialistVersions[0].version, 2);
  for (const field of [
    "runtime_profile_id",
    "runtime_version",
    "capability_version_ids",
    "role_key",
    "role_hash",
    "skills",
    "brand",
    "template_version_id",
  ])
    assert.deepEqual(
      specialistVersions[0].body[field],
      specialistVersions[1].body[field],
      field,
    );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT agent_version FROM conversations WHERE id=$1",
        [conversation.id],
      )
    ).rows[0].agent_version,
    1,
  );
  pass(
    "Actual specialist revision preserves every pinned dependency and the original customer conversation",
  );
  await page.keyboard.press("Escape");

  stage = "structured brand revision with exact price and source";
  await openContent(brand.name);
  await record(
    "brand-revision",
    "Actual approved brand color, exact HKD price and shared PNG source selection, difference review and save",
  );
  await name().fill("Harbour approved brand · updated");
  await page
    .getByLabel("Tone and style", { exact: true })
    .fill(
      "繁中為主，英文配合；清晰可靠。Clear and precise Hong Kong bilingual copy.",
    );
  await page.getByRole("button", { name: "Add fact", exact: true }).click();
  await page.getByLabel("Fact key", { exact: true }).fill("launch-price");
  await page.getByLabel("Type", { exact: true }).selectOption("price");
  await page
    .getByLabel("Approved fact text", { exact: true })
    .fill("Hong Kong launch price HK$128.90");
  await page.getByLabel("Currency", { exact: true }).selectOption("HKD");
  await page.getByLabel("Amount", { exact: true }).fill("128.901");
  assert.equal(
    await page
      .getByLabel("Amount", { exact: true })
      .evaluate((input: HTMLInputElement) => input.validity.valid),
    false,
  );
  await page.getByLabel("Amount", { exact: true }).fill("128.90");
  await page.getByRole("button", { name: "Add Logo", exact: true }).click();
  await page
    .getByLabel("Logo asset", { exact: true })
    .selectOption(logo.id + ":1");
  await page
    .getByLabel("Usage", { exact: true })
    .fill("Approved shared customer logo for social campaigns");
  await reason().fill("Customer approved exact price and shared logo source");
  await sizes();
  await page.getByLabel("Amount", { exact: true }).scrollIntoViewIfNeeded();
  await shot(
    page,
    "brand-price-and-sources-en",
    "Real exact decimal price field and selected immutable shared PNG source",
  );
  await previewChanges();
  await fit(page);
  await shot(
    page,
    "brand-review-en",
    "Actual brand differences and unchecked explicit confirmation",
  );
  await confirm();
  await shot(
    page,
    "brand-receipt-en",
    "Brand version two committed atomically with distinct administrator source",
  );
  await finish();
  const brandVersions = (
    await inject(customer, "GET", userBase + `/brand/${brand.id}/versions`)
  ).data.items;
  assert.equal(brandVersions[0].origin, "administrator");
  assert.equal(brandVersions[0].body.facts[0].amount_minor, 12890);
  assert.equal(brandVersions[0].body.logos[0].asset_id, logo.id);
  assert.equal(brandVersions[1].body.facts.length, 0);
  assert.equal(specialistVersions[0].body.brand.version, 1);
  pass(
    "Structured brand fields retain previous guidance and pin actual PNG bytes, font rights and an exact HKD price",
  );
  await page.keyboard.press("Escape");

  stage = "Traditional Chinese private scoped memory revision";
  await page.evaluate(() => localStorage.setItem("cp_locale", "zh-HK"));
  await page.reload();
  await openContent(memory.name);
  await record(
    "private-memory-revision",
    "Actual Chinese scoped private memory, Hong Kong local expiry and explicit review at desktop and narrow widths",
  );
  await name().fill("香港活動私人記憶 · 已核准");
  await page
    .getByLabel("記憶內容", { exact: true })
    .fill(
      "只使用客戶已核准的香港活動資料。PRIVATE CUSTOMER CONTENT: preserve exact conversation scope.",
    );
  await page.getByLabel(/到期時間（本機時區/).fill("2027-11-15T18:30");
  await reason().fill("客戶已確認活動資料及記憶到期時間。");
  await sizes();
  await previewChanges();
  await resize(page, { width: 375, height: 1000 });
  await fit(page);
  await page.locator(".revision-review").scrollIntoViewIfNeeded();
  await shot(
    page,
    "memory-review-zh-375",
    "Actual Chinese memory review at 375px preserves private conversation scope and Hong Kong local expiry",
  );
  await resize(page, { width: 1440, height: 1080 });
  await confirm();
  await finish();
  const updatedMemory = (
    await system.db.control.query("SELECT * FROM memories WHERE id=$1", [
      memory.id,
    ])
  ).rows[0];
  assert.equal(updatedMemory.scope, "conversation");
  assert.equal(updatedMemory.private_owner, customer.id);
  assert.equal(updatedMemory.conversation_id, conversation.id);
  assert.equal(
    updatedMemory.expires_at.toISOString(),
    "2027-11-15T10:30:00.000Z",
  );
  const memories = (await inject(customer, "GET", userBase + "/memories")).data
    .items;
  assert.equal(
    memories.find((m: any) => m.id === memory.id).origin,
    "administrator",
  );
  pass(
    "Actual Chinese private memory editing preserves scope, customer ownership, conversation and exact selected local expiry",
  );
  pass(
    "All three structured profile forms fit 375, 768, 1024 and 1440px without horizontal overflow",
  );
  await page.keyboard.press("Escape");

  stage = "lost committed memory response and refresh recovery";
  await openContent("香港活動私人記憶 · 已核准");
  await name().fill("香港活動私人記憶 · 核對原提交");
  await reason().fill("PRIVATE RECOVERY REASON: customer approved correction");
  await previewChanges();
  let deliveredApplies = 0;
  const pattern = "**/v1/admin/content-revisions/memories/*/apply";
  await page.route(pattern, async (route) => {
    deliveredApplies++;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort("failed");
  });
  await page.locator(".revision-consent input").check();
  await page.locator(".revision-review .button.primary").click();
  await page.locator(".revision-pending").waitFor();
  const storage = await page.evaluate(() =>
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("cp_admin_content_revision:"))
      .map((k) => sessionStorage.getItem(k)),
  );
  assert.equal(storage.length, 1);
  for (const privateText of [
    "PRIVATE RECOVERY REASON",
    "PRIVATE CUSTOMER CONTENT",
    "核對原提交",
  ])
    assert.equal(storage[0]!.includes(privateText), false);
  await shot(
    page,
    "memory-lost-response",
    "A real committed response is dropped; recovery stores signed metadata only",
  );
  await page.unroute(pattern);
  await page.reload();
  await page.locator(".revision-recovery").getByRole("button").click();
  await page
    .locator(".revision-pending")
    .getByRole("button", { name: /核對原提交結果|Check original outcome/ })
    .click();
  await page.locator(".revision-success").waitFor();
  assert.equal(deliveredApplies, 1);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT version FROM memories WHERE id=$1",
        [memory.id],
      )
    ).rows[0].version,
    3,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.startsWith("cp_admin_content_revision:"),
      ),
    ),
    [],
  );
  pass(
    "A genuinely lost committed memory response recovers after reload without storing private content or mutating twice",
  );
  await page.keyboard.press("Escape");

  stage = "live permission withdrawal clears private memory";
  await openContent("香港活動私人記憶 · 核對原提交");
  await page
    .getByLabel("記憶內容", { exact: true })
    .fill("PRIVATE UNSAVED NOTE: remove after withdrawal");
  await reason().fill("PRIVATE UNSAVED REASON: remove after withdrawal");
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",
    [admin.id, role, project],
  );
  await page
    .locator(".revision-form")
    .waitFor({ state: "detached", timeout: 25000 });
  const visible = await page.locator(".content-revision").innerText();
  for (const privateText of [
    "PRIVATE UNSAVED NOTE",
    "PRIVATE UNSAVED REASON",
    "PRIVATE CUSTOMER CONTENT",
  ])
    assert.equal(visible.includes(privateText), false);
  await shot(
    page,
    "memory-authority-withdrawn",
    "Actual live project deny clears private memory body, reason, preview and history",
  );
  pass(
    "Actual project permission withdrawal clears open private content during live authorization revalidation",
  );
  const finalCounts = (
    await system.db.control.query(
      "SELECT (SELECT count(*) FROM tasks)::text AS tasks,(SELECT count(*) FROM reservations)::text AS reservations,(SELECT count(*) FROM ai_gateway_requests)::text AS gateway",
    )
  ).rows[0];
  assert.deepEqual(finalCounts, originalCounts);
  assert.equal(finalCounts.gateway, "0");
  pass(
    "All profile revisions create no tasks, reserve no budget and call no AI gateway",
  );
} catch (e) {
  errors.push(stage + ": " + String(e));
  console.error(stage, e);
} finally {
  if (recording)
    try {
      await finish();
    } catch (e) {
      errors.push("recording cleanup: " + String(e));
    }
  if (browser)
    try {
      await browser.close();
      browserClosed = true;
    } catch (e) {
      errors.push("browser cleanup: " + String(e));
    }
  if (system)
    try {
      await system.app.close();
      apiClosed = true;
    } catch (e) {
      errors.push("API cleanup: " + String(e));
    }
  if (isolated)
    try {
      await isolated.cleanup();
      fixtureClosed = true;
    } catch (e) {
      errors.push("fixture cleanup: " + String(e));
    }
  const status =
    errors.length === 0 &&
    checks.length === 8 &&
    screenshots.length === 8 &&
    recordings.length === 3 &&
    browserClosed &&
    apiClosed &&
    fixtureClosed
      ? "passed"
      : "failed";
  await writeFile(
    prefix + "-journey.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status,
        stage,
        checks,
        errors,
        screenshots,
        recordings,
        layout_checks: layouts,
        browser_closed: browserClosed,
        api_closed: apiClosed,
        fixture_closed: fixtureClosed,
        model_calls: 0,
        simulation_scope:
          "Model/media data are authorized synthetic fixtures. UI, email/MFA, PostgreSQL revisions and dropped HTTP response use the actual implementation.",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status,
      checks: checks.length,
      errors,
      browser_closed: browserClosed,
    }),
  );
  if (status !== "passed") process.exitCode = 1;
}
