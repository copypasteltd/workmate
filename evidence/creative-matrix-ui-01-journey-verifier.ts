import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
} from "playwright";
import assert from "node:assert/strict";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

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
    path.resolve("../../docs/contracts/creative-matrix-openapi.json"),
  ),
  contract = JSON.parse(contractBytes.toString()),
  defs = contract.components.schemas;
const validators = Object.fromEntries(
  Object.keys(defs).map((name) => [
    name,
    ajv.compile({ $defs: defs, $ref: "#/$defs/" + name }),
  ]),
);
const checks: any[] = [],
  errors: string[] = [],
  samples: any[] = [],
  screenshots: any[] = [],
  owned = path.resolve(".data/creative-matrix-ui", randomUUID());
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex"),
  pass = (name: string) => {
    checks.push({ name, status: "passed" });
    console.log("PASS: " + name);
  };
let isolated: any,
  system: any,
  server: BrowserServer | undefined,
  browser: Browser | undefined,
  context: BrowserContext | undefined,
  stage = "initializing",
  browserClosed = false,
  appClosed = false,
  databaseClosed = false;
let advance: any, saveAsset: any, browserRuntime: any;
function sample(name: string, value: any, route: string) {
  assert.ok(validators[name](value), JSON.stringify(validators[name].errors));
  samples.push({ schema: name, route, response: value });
  return value;
}
async function call(
  c: { cookie: string; csrf: string },
  method: string,
  url: string,
  body?: unknown,
) {
  const raw = await system.app.inject({
    method,
    url,
    headers: {
      origin: web,
      cookie: c.cookie,
      "x-csrf-token": c.csrf,
      "idempotency-key": randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  assert.equal(raw.statusCode, 200, method + " " + url + " " + raw.body);
  return raw.json();
}
async function operation(
  page: Page,
  method: string,
  url: string,
  action: () => Promise<unknown>,
  schema: string,
) {
  const [r] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === method && new URL(r.url()).pathname === url,
    ),
    action(),
  ]);
  assert.equal(r.status(), 200, await r.text());
  return sample(schema, await r.json(), method + " " + url);
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const file = path.resolve(
    "../copypaste-web/assets/screenshots",
    `creative-matrix-${attempt}-${name}.png`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await assert.rejects(access(file), (e: any) => e.code === "ENOENT");
  await page.screenshot({
    path: file,
    fullPage: false,
    animations: "disabled",
  });
  screenshots.push({
    path: path.relative(path.resolve(".."), file).replaceAll("\\", "/"),
    sha256: sha(await readFile(file)),
  });
}
async function fit(page: Page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page fits viewport",
  );
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    assert.ok(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "Dialog fits viewport",
    );
}
async function finish() {
  for (let i = 0; i < 80; i++) {
    if (!(await advance(system.db, system.storage))) return;
  }
  throw new Error("Matrix did not finish within its queue bound");
}
async function created(page: Page) {
  return page.getByRole("dialog", { name: "New batch design", exact: true });
}
const deadline = setTimeout(() => {
  errors.push("UI deadline at " + stage);
  void server?.kill();
}, 480000);
try {
  const load = async (file: string) =>
      import(pathToFileURL(path.join(platform, file)).href),
    { isolatedTestEnvironment } = await load(
      "tests/native-test-environment.ts",
    ),
    { buildApp } = await load("src/server.ts"),
    { loadConfig } = await load("src/config.ts");
  ({ advanceCreativeMatrices: advance } = await load(
    "src/creative-matrices.ts",
  ));
  ({ saveAsset } = await load("src/storage.ts"));
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
  context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    acceptDownloads: true,
  });
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  stage = "real customer email login and onboarding";
  await page.goto(web + "/login");
  await page
    .getByLabel("Work email")
    .fill(`matrix-ui-${randomUUID()}@example.invalid`);
  const [challengeResponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/auth/challenges" &&
        r.request().method() === "POST",
    ),
    page
      .getByRole("button", { name: "Send sign-in code", exact: true })
      .click(),
  ]);
  assert.equal(challengeResponse.status(), 202);
  const challenge = await challengeResponse.json();
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
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour campaign studio");
  await page.locator('input[name="project_name"]').fill("Campaign formats");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const cookie = (await context.cookies()).find(
    (c) => c.name === "cp_session",
  )!;
  const me = await page.evaluate(
      async () => await (await fetch("/v1/session/context")).json(),
    ),
    client = { cookie: "cp_session=" + cookie.value, csrf: me.csrf_token },
    tenant = me.memberships[0].id,
    project = (await call(client, "GET", `/v1/tenants/${tenant}/projects`))
      .items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  pass("actual email sign-in, user session and enterprise/project onboarding");
  const { createCanvas } = requirePlatform("@napi-rs/canvas"),
    canvas = createCanvas(400, 280),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8f0ff";
  ctx.fillRect(0, 0, 400, 280);
  ctx.fillStyle = "#1f5eff";
  ctx.fillRect(128, 45, 144, 190);
  ctx.fillStyle = "#fff";
  ctx.font = "26px Arial";
  ctx.fillText("IDEA", 164, 154);
  const image = await system.db.tx(
    (tx: any) =>
      saveAsset(tx, system.storage, {
        tenant,
        project,
        user: me.user.id,
        name: "Campaign source.png",
        mime: "image/png",
        bytes: canvas.toBuffer("image/png"),
        metadata: { fixture: "local_composition_source" },
      }),
    tenant,
    true,
    me.user.id,
  );
  await page.goto(web + "/app/creative");
  await page
    .getByRole("button", { name: "New batch design", exact: true })
    .click();
  let modal = await created(page);
  await modal
    .getByLabel("Batch name", { exact: true })
    .fill("Harbour studio · 18 formats");
  for (let i = 0; i < 2; i++)
    await modal
      .getByRole("button", { name: "Add creative", exact: true })
      .click();
  for (let i = 0; i < 3; i++) {
    const c = modal.locator(".matrix-creative").nth(i);
    await c
      .getByLabel("Fixed project PNG version", { exact: true })
      .selectOption(image.id + ":1");
    for (const locale of ["zh-HK", "en"]) {
      const area = c.locator(
        `section[aria-label="Creative ${i + 1} ${locale}"]`,
      );
      await area
        .getByLabel("Brand line", { exact: true })
        .fill(locale === "en" ? "COPYPASTE / HONG KONG" : "COPYPASTE / 香港");
      await area
        .getByLabel("Headline", { exact: true })
        .fill(
          locale === "en"
            ? [
                "Room for a new idea",
                "Made for your next move",
                "Every format. One direction.",
              ][i]
            : [
                "為下一個創意騰出空間",
                "讓下一步更有想像",
                "同一方向，每個版位",
              ][i],
        );
      await area
        .getByLabel("Body copy", { exact: true })
        .fill(
          locale === "en"
            ? "Independent creative work for ambitious teams."
            : "為企業團隊，做好每一份創意。",
        );
      await area
        .getByLabel("Call to action", { exact: true })
        .fill(locale === "en" ? "Discover more" : "立即了解");
    }
  }
  await fit(page);
  await screenshot(page, "create-en");
  const batch = await operation(
    page,
    "POST",
    base + "/creative-batches",
    () =>
      modal
        .getByRole("button", { name: "Create 18 delivery units", exact: true })
        .click(),
    "MatrixCreated",
  );
  await modal.waitFor({ state: "hidden" });
  pass(
    "actual form creates 3 creatives × 2 languages × 3 sizes with fixed PNG references",
  );
  stage = "independent partial failure";
  const get = system.storage.get.bind(system.storage);
  let failOnce = true;
  system.storage.get = async (key: string) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("Controlled one-time source read failure");
    }
    return get(key);
  };
  try {
    await finish();
  } finally {
    system.storage.get = get;
  }
  let initial = sample(
    "MatrixDetail",
    await call(client, "GET", base + "/creative-batches/" + batch.id),
    "GET detail after partial failure",
  );
  assert.equal(initial.units.length, 18);
  assert.equal(initial.counts.failed, 1);
  assert.equal(initial.counts.succeeded, 17);
  await page.waitForFunction(() =>
    document.querySelector(".matrix-summary")?.textContent?.includes("17/18"),
  );
  assert.equal(await page.locator(".matrix-unit").count(), 18);
  await page.locator(".creative-matrices").scrollIntoViewIfNeeded();
  await screenshot(page, "matrix-18-en");
  await page
    .locator(".matrix-filters")
    .getByLabel("Status", { exact: true })
    .selectOption("failed");
  assert.equal(await page.locator(".matrix-unit").count(), 1);
  const failed = initial.units.find((u: any) => u.state === "failed");
  await page
    .locator(".matrix-unit")
    .getByRole("button", { name: /Open unit/ })
    .click();
  modal = page.getByRole("dialog", {
    name: "Unit copy and outputs",
    exact: true,
  });
  await modal.getByText("RENDER_FAILED", { exact: true }).first().waitFor();
  await screenshot(page, "failed-unit-en");
  pass(
    "one real execution failure leaves 17 completed cells available and filterable",
  );
  stage = "explicit failed-cell retry";
  await operation(
    page,
    "POST",
    `${base}/creative-batches/${batch.id}/units/${failed.id}/retry`,
    () =>
      modal
        .getByRole("button", {
          name: "Retry original copy and image",
          exact: true,
        })
        .click(),
    "MatrixUpdated",
  );
  await finish();
  await page
    .locator(".matrix-filters")
    .getByLabel("Status", { exact: true })
    .selectOption("all");
  await page.waitForFunction(() =>
    document.querySelector(".matrix-summary")?.textContent?.includes("18/18"),
  );
  const changed = initial.units.find((u: any) => u.state === "succeeded");
  await page
    .locator(`[data-unit-id="${changed.id}"]`)
    .getByRole("button", { name: /Open unit/ })
    .click();
  modal = page.getByRole("dialog", {
    name: "Unit copy and outputs",
    exact: true,
  });
  await modal
    .getByLabel("Headline", { exact: true })
    .fill("A new direction · 只改此格");
  const editPath = `${base}/creative-batches/${batch.id}/units/${changed.id}/edit`;
  await operation(
    page,
    "POST",
    editPath,
    () =>
      modal
        .getByRole("button", { name: "Render only this unit", exact: true })
        .click(),
    "MatrixUpdated",
  );
  await finish();
  let final = sample(
    "MatrixDetail",
    await call(client, "GET", base + "/creative-batches/" + batch.id),
    "GET detail after local edit and retry",
  );
  for (const sibling of initial.units.filter(
    (u: any) => u.id !== failed.id && u.id !== changed.id,
  ))
    assert.deepEqual(
      final.units.find((u: any) => u.id === sibling.id),
      sibling,
    );
  assert.equal(
    final.units.find((u: any) => u.id === changed.id).attempts.length,
    2,
  );
  assert.equal(
    final.units.find((u: any) => u.id === failed.id).attempts.length,
    2,
  );
  assert.equal(final.cost.ai_cost_micros, "0");
  pass(
    "actual retry and unchanged-image edit affect only two cells; 16 siblings remain byte-for-byte identical and AI cost is zero",
  );
  stage = "actual output downloads";
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-unit-id="${id}"] footer small`)
        ?.textContent?.includes("r2"),
    changed.id,
  );
  await page
    .locator(`[data-unit-id="${changed.id}"]`)
    .getByRole("button", { name: /Open unit/ })
    .click();
  modal = page.getByRole("dialog", {
    name: "Unit copy and outputs",
    exact: true,
  });
  const output = modal.locator(".matrix-history article").first(),
    downloaded: any[] = [];
  for (const label of ["PNG", "SVG", "Editable source"]) {
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      output.getByRole("button", { name: label, exact: true }).click(),
    ]);
    const destination = path.join(owned, file.suggestedFilename());
    await file.saveAs(destination);
    const bytes = await readFile(destination);
    downloaded.push({
      name: file.suggestedFilename(),
      bytes: bytes.length,
      sha256: sha(bytes),
    });
    if (label === "PNG") {
      const png = requirePlatform("pngjs").PNG.sync.read(bytes);
      assert.equal(png.width, changed.input.size.width);
      assert.equal(png.height, changed.input.size.height);
    } else if (label === "SVG") assert.ok(bytes.toString().includes("<svg"));
    else
      assert.equal(
        JSON.parse(bytes.toString()).input.copy.headline,
        "A new direction · 只改此格",
      );
  }
  await writeFile(
    path.join(owned, "download-receipts.json"),
    JSON.stringify(downloaded, null, 2),
  );
  await screenshot(page, "outputs-en");
  pass(
    "browser downloads actual PNG, SVG and editable JSON, with decoded dimensions and current revision text",
  );
  stage = "concurrent revision warning";
  await modal
    .getByLabel("Headline", { exact: true })
    .fill("Keep this unsaved draft");
  const u = final.units.find((u: any) => u.id === changed.id);
  sample(
    "MatrixUpdated",
    await call(client, "POST", editPath, {
      expected_revision: 2,
      copy: { ...u.input.copy, headline: "Another editor saved this" },
    }),
    "POST concurrent edit",
  );
  await modal.getByText(/Another action saved r3/).waitFor();
  assert.equal(
    await modal.getByLabel("Headline", { exact: true }).inputValue(),
    "Keep this unsaved draft",
  );
  await screenshot(page, "revision-conflict-en");
  await modal
    .getByRole("button", {
      name: "Discard this draft and load new revision",
      exact: true,
    })
    .click();
  assert.equal(
    await modal.getByLabel("Headline", { exact: true }).inputValue(),
    "Another editor saved this",
  );
  await page.keyboard.press("Escape");
  await finish();
  pass(
    "current revision conflicts preserve the unsaved draft and require explicit reload",
  );
  stage = "preflight 60-unit bound and custom sizes";
  await page
    .getByRole("button", { name: "New batch design", exact: true })
    .click();
  modal = await created(page);
  for (let i = 0; i < 10; i++)
    await modal
      .getByRole("button", { name: "Add creative", exact: true })
      .click();
  assert.ok(
    (await modal.locator(".matrix-unit-count").textContent())?.includes("66"),
  );
  let posts = 0;
  const record = (req: any) => {
    if (
      req.method() === "POST" &&
      new URL(req.url()).pathname === base + "/creative-batches"
    )
      posts++;
  };
  page.on("request", record);
  await modal.locator("form").evaluate((form) => {
    (form as HTMLFormElement).noValidate = true;
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await modal
    .getByText(
      "Choose between 1 and 60 units by adjusting creatives, languages or sizes.",
      { exact: true },
    )
    .waitFor();
  assert.equal(posts, 0);
  page.off("request", record);
  await screenshot(page, "limit-en");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "New batch design", exact: true })
    .click();
  modal = await created(page);
  await modal
    .getByRole("button", { name: "Custom size · 256–2048 px", exact: true })
    .click();
  await modal.getByLabel("Width px", { exact: true }).fill("800");
  await modal.getByLabel("Height px", { exact: true }).fill("1200");
  await fit(page);
  await screenshot(page, "custom-size-en");
  await page.keyboard.press("Escape");
  pass(
    "66 units are rejected in the browser before any request; custom dimensions are editable",
  );
  stage = "source quarantine immediately removes preview and download controls";
  await system.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [image.id],
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".matrix-unit img").length === 0,
  );
  await page
    .locator(`[data-unit-id="${changed.id}"]`)
    .getByRole("button", { name: /Open unit/ })
    .click();
  modal = page.getByRole("dialog", {
    name: "Unit copy and outputs",
    exact: true,
  });
  await modal
    .getByText(
      "The source image is unavailable. Choose another image or use text and shapes.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await modal.locator(".matrix-downloads button").count(), 0);
  await screenshot(page, "source-unavailable-en");
  await page.keyboard.press("Escape");
  await system.db.control.query(
    "UPDATE assets SET state='active',moderation_version=moderation_version+1 WHERE id=$1",
    [image.id],
  );
  pass(
    "quarantined sources remove stale visible previews and all derived download controls on the next detail refresh",
  );
  stage = "cancel through actual UI";
  const cancellation = await call(client, "POST", base + "/creative-batches", {
    name: "Stopped delivery",
    locales: ["en"],
    sizes: [{ key: "square", name: "Square", width: 512, height: 512 }],
    creatives: [
      {
        key: "stop",
        name: "Stop me",
        theme: { background: "#f6f6f4", ink: "#15171a", accent: "#1f5eff" },
        image: null,
        copy: [
          {
            locale: "en",
            text: {
              brand_line: "",
              headline: "Pending work",
              body: "",
              action: "",
            },
          },
        ],
      },
    ],
  });
  await page.reload();
  await page
    .locator(".matrix-list")
    .getByLabel("Choose batch", { exact: true })
    .selectOption(cancellation.id);
  await operation(
    page,
    "POST",
    `${base}/creative-batches/${cancellation.id}/cancel`,
    () =>
      page
        .getByRole("button", { name: "Stop unfinished units", exact: true })
        .click(),
    "MatrixCancelled",
  );
  await page.getByText("Stopped", { exact: true }).first().waitFor();
  assert.equal(await advance(system.db, system.storage), null);
  pass(
    "actual stop action cancels persistent pending cells and prevents background publication",
  );
  stage = "bilingual dark and narrow layout";
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await page.reload();
  await page
    .getByRole("button", { name: "新建批量設計", exact: true })
    .waitFor();
  await page
    .locator(".matrix-list")
    .getByLabel("選擇批次", { exact: true })
    .selectOption(batch.id);
  await page.locator(".creative-matrices").scrollIntoViewIfNeeded();
  await fit(page);
  await screenshot(page, "matrix-zh-dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await fit(page);
  await screenshot(page, "matrix-zh-narrow");
  await page.getByRole("button", { name: "新建批量設計", exact: true }).click();
  modal = page.getByRole("dialog", { name: "新建批量設計", exact: true });
  await fit(page);
  await screenshot(page, "create-zh-narrow");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  sample(
    "MatrixList",
    await call(client, "GET", base + "/creative-batches"),
    "GET project batch list",
  );
  pass(
    "Traditional Chinese dark and 390-pixel matrix/create dialogs fit the viewport and close with Escape",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
} catch (e) {
  errors.push(stage + ": " + (e as Error).message);
} finally {
  clearTimeout(deadline);
  if (context) await context.close().catch(() => {});
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
      appClosed = true;
    } catch {
      errors.push("Owned API close failed");
    }
  if (isolated)
    try {
      process.chdir(platform);
      await isolated.cleanup();
      databaseClosed = true;
    } catch {
      errors.push("Owned fixture cleanup failed");
    }
  const passed =
    errors.length === 0 && browserClosed && appClosed && databaseClosed;
  await writeFile(
    path.join(delivery, `evidence/creative-matrix-ui-${attempt}-journey.json`),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope:
          "Built Web and actual API/native PostgreSQL; deterministic composition only, no AI or live-provider qualification",
        checks,
        errors,
        samples,
        screenshots,
        browser_closed: browserClosed,
        browser_runtime: browserRuntime,
        owned_api_closed: appClosed,
        isolated_database_dropped_or_deferred_fixture_queued: databaseClosed,
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
