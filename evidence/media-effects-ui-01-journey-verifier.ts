import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  WorkmateRecording,
  saveWorkmateScreenshot,
} from "./record-workmate-media.js";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.join(delivery, "evidence/media-effects-ui-" + attempt);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const checks: string[] = [],
  errors: string[] = [],
  screenshots: any[] = [],
  media: any[] = [],
  executions: any[] = [],
  outputFiles: any[] = [];
let isolated: any,
  system: any,
  browser: Browser | undefined,
  recording: WorkmateRecording | undefined;
let browserClosed = false,
  apiClosed = false,
  fixtureClosed = false,
  funding: any;
const pass = (name: string) => {
  checks.push(name);
  console.log("PASS: " + name);
};
const load = (file: string) =>
  import(pathToFileURL(path.join(platform, file)).href);
let captureQueue = Promise.resolve();
async function coordinateCapture<T>(action: () => Promise<T>): Promise<T> {
  const previous = captureQueue;
  let release!: () => void;
  captureQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}
const go = (page: Page, url: string) => coordinateCapture(() => page.goto(url));
async function call(
  page: Page,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
) {
  const result = await page.evaluate(
    async ({ method, url, body, tenant }) => {
      const session = await (await fetch("/v1/session/context")).json();
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
          ...(tenant ? { "X-Tenant-ID": tenant } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { method, url, body, tenant },
  );
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${method} ${url}: ${result.status} ${JSON.stringify(result.body)}`,
  );
  return result.body;
}
async function signIn(page: Page, email: string) {
  await go(page, "http://localhost:4317/login");
  await page.locator('input[name="email"]').fill(email);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/auth/challenges",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(response.status(), 202);
  const challenge = await response.json(),
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
  const [verified] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/auth/sessions" &&
        r.request().method() === "POST",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(verified.status(), 201);
  return verified.json();
}
async function shot(page: Page, name: string) {
  screenshots.push(
    await saveWorkmateScreenshot(
      "web",
      "media-effects-" + attempt,
      name,
      await coordinateCapture(() =>
        page.screenshot({ fullPage: false, animations: "disabled" }),
      ),
      "Actual built motion studio and fixed-source native effect media; native Codex and explicitly synthetic model",
      delivery,
    ),
  );
}
const timeout = setTimeout(() => {
  errors.push("Owned effects UI deadline exceeded");
  void browser?.close();
}, 600000);
try {
  const { isolatedTestEnvironment } = await load(
      "tests/native-test-environment.ts",
    ),
    { buildApp } = await load("src/server.ts"),
    { loadConfig } = await load("src/config.ts");
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
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  const signed = await signIn(
    page,
    "effects-" + randomUUID() + "@example.invalid",
  );
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour campaign studio");
  await page
    .locator('input[name="project_name"]')
    .fill("Motion & creative production");
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/tenants" &&
        r.request().method() === "POST",
    ),
    page
      .getByRole("button", { name: "Create workspace & continue", exact: true })
      .click(),
  ]);
  assert.equal(created.status(), 200);
  const workspace = await created.json(),
    tenant = workspace.tenant.id,
    project = workspace.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await page.waitForURL("**/app");
  await call(page, "POST", `/v1/tenants/${tenant}/demo-credit`, {}, tenant);
  funding = {
    actual_demo_credit_endpoint: true,
    no_direct_wallet_mutation: true,
    cash_received: false,
  };
  pass(
    "EFFECT-01 actual email sign-in, workspace onboarding and demo-credit funding prepare the authenticated customer without direct wallet mutation",
  );
  const { effectDemoSources } = await load("src/media-effects-demo.ts"),
    artwork = effectDemoSources();
  await go(page, "http://localhost:4317/app/assets");
  for (const [index, name] of ["campaign-a.png", "campaign-b.png"].entries()) {
    await page
      .getByRole("button", { name: "Upload material", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: "image/png",
      buffer: artwork[index].bytes,
    });
    await dialog
      .getByRole("button", { name: "Upload or resume", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("heading", { name, exact: true }).waitFor();
  }
  const assets = (await call(page, "GET", base + "/assets")).items;
  assert.equal(
    assets.filter((a: any) => a.name.startsWith("campaign-")).length,
    2,
  );
  const inputA = assets.find((a: any) => a.name === "campaign-a.png");
  pass(
    "EFFECT-02 two original PNG fixtures upload through real resumable browser upload, hash verification and shared-project assets",
  );
  await go(page, "http://localhost:4317/app/effects");
  await page.locator('[data-effect-id="transition.crossfade"]').waitFor();
  assert.equal(await page.locator(".effect-card").count(), 10);
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLImageElement>(".effect-card img")].every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  await shot(page, "directory-en");
  await page.getByRole("button", { name: "Text motion", exact: true }).click();
  assert.equal(await page.locator(".effect-card").count(), 2);
  await shot(page, "text-filter-en");
  await page.getByRole("button", { name: "All effects", exact: true }).click();
  const sampleVideo = page.locator(".effect-preview video");
  await sampleVideo.evaluate((v: HTMLVideoElement) => v.play());
  await page.waitForFunction(
    () =>
      (document.querySelector(".effect-preview video") as HTMLVideoElement)
        ?.currentTime > 0.2,
  );
  await sampleVideo.evaluate((v: HTMLVideoElement) => v.pause());
  const catalog = await call(page, "GET", base + "/effects/catalog");
  assert.equal(catalog.items.length, 10);
  assert.equal(catalog.role_version, "1.5.0");
  pass(
    "EFFECT-03 the built directory exposes ten independent presets and filters, loads rendered examples and plays a real H.264 sample",
  );
  const pageCapture = await context.newCDPSession(page);
  const captureActivePage = () =>
    coordinateCapture(async () =>
      Buffer.from(
        (
          await pageCapture.send("Page.captureScreenshot", {
            format: "jpeg",
            quality: 72,
            fromSurface: true,
            captureBeyondViewport: false,
          })
        ).data,
        "base64",
      ),
    );
  const { CodexRuntimeAdapter } = await load("src/runtime.ts"),
    { Worker } = await load("src/worker.ts");
  let currentCalls: string[] = [];
  class CapturedCodex extends CodexRuntimeAdapter {
    constructor(config: any) {
      super(config);
    }
    async start(ctx: any) {
      return super.start({
        ...ctx,
        tools: ctx.tools.map((t: any) => ({
          ...t,
          run: async (a: any, id: string) => {
            currentCalls.push(t.name);
            return t.run(a, id);
          },
        })),
      });
    }
  }
  recording = new WorkmateRecording(
    "web",
    "effect-review-retry",
    "media-effects-" + attempt,
    captureActivePage,
    "Actual effect review and intentionally lost acknowledgement followed by the same original request",
  );
  await recording.start();
  await page
    .getByRole("textbox", { name: "Task name", exact: true })
    .fill("Harbour launch · crossfade");
  await page
    .getByRole("combobox", { name: /^Source 1/ })
    .selectOption({ label: "campaign-a.png · v1" });
  await page
    .getByRole("combobox", { name: /^Source 2/ })
    .selectOption({ label: "campaign-b.png · v1" });
  await page
    .getByRole("combobox", { name: "Output size", exact: true })
    .selectOption("640x360");
  await page
    .getByRole("spinbutton", { name: "Task budget limit (HKD)", exact: true })
    .fill("2");
  await page.getByRole("checkbox").check();
  await page.locator(".effect-studio form").scrollIntoViewIfNeeded();
  await shot(page, "reviewed-en");
  let lost: any,
    requestKey = "",
    requestBody = "",
    sent = 0;
  await page.route("**" + base + "/effects/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent++;
    if (sent === 1) {
      requestKey = route.request().headers()["idempotency-key"];
      requestBody = route.request().postData()!;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      lost = await response.json();
      await route.abort("failed");
    } else {
      assert.equal(route.request().headers()["idempotency-key"], requestKey);
      assert.equal(route.request().postData(), requestBody);
      await route.continue();
    }
  });
  await page
    .getByRole("button", { name: "Confirm & create", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry original submission", exact: true })
    .waitFor();
  assert.ok(lost?.id);
  await page.locator(".effect-saved-request summary").click();
  await shot(page, "pending-retry");
  await coordinateCapture(() => page.reload());
  await page
    .getByRole("button", { name: "Retry original submission", exact: true })
    .click();
  await page.waitForURL("**/app/effects?task=" + lost.id);
  await page.unroute("**" + base + "/effects/tasks");
  const taskCount = (
    await system.db.control.query(
      "SELECT count(*)::int AS n FROM tasks WHERE project_id=$1",
      [project],
    )
  ).rows[0].n;
  assert.equal(taskCount, 1);
  assert.equal(sent, 2);
  media.push(await recording.stop());
  recording = undefined;
  pass(
    "EFFECT-04 lost admission acknowledgement survives reload and retries identical input and request ID, creating exactly one task and hold",
  );
  const persist = async (label: string, file: any, bytes: Buffer) => {
    const target = prefix + "-" + label + "-" + file.name;
    await writeFile(target, bytes, { flag: "wx" });
    outputFiles.push({
      path: path.relative(delivery, target).replaceAll("\\", "/"),
      sha256: sha(bytes),
      bytes: bytes.length,
    });
  };
  const execute = async (id: string, label: string) => {
    currentCalls = [];
    await new Worker(
      system.db,
      system.catalog,
      system.storage,
      new CapturedCodex(system.db.config),
    ).run(tenant, id);
    const task = await call(page, "GET", base + "/tasks/" + id),
      result = await call(page, "GET", base + "/effects/tasks/" + id);
    assert.equal(task.status, "succeeded", JSON.stringify(task));
    assert.equal(result.delivery.files.length, 4);
    assert.equal(result.delivery.provider_calls, 0);
    assert.deepEqual(currentCalls, ["effects_catalog", "effect_render"]);
    const count = (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [id],
      )
    ).rows[0].n;
    assert.equal(count, 1);
    assert.ok(Number(task.charged_micros) > 0);
    executions.push({
      task_id: id,
      native_codex: true,
      synthetic_model: true,
      reservation_count: count,
      charged_micros: task.charged_micros,
      tools: [...currentCalls],
      output: result.delivery,
    });
    await page
      .getByRole("button", { name: "effect.delivery.zip", exact: true })
      .waitFor();
    const player = page.locator(".effect-delivery video");
    await player.evaluate((v: HTMLVideoElement) => v.play());
    await page.waitForFunction(
      () =>
        (document.querySelector(".effect-delivery video") as HTMLVideoElement)
          ?.currentTime > 0.2,
    );
    await player.evaluate((v: HTMLVideoElement) => v.pause());
    for (const file of result.delivery.files) {
      const [received] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: file.name, exact: true }).click(),
      ]);
      const bytes = await readFile((await received.path())!);
      assert.equal(sha(bytes), file.sha256);
      await persist(label, file, bytes);
      if (file.name === "effect.source.json") {
        const source = JSON.parse(bytes.toString());
        assert.deepEqual(source.request, result.request);
        assert.equal(source.probe.full_decode, true);
      }
    }
    return result;
  };
  recording = new WorkmateRecording(
    "web",
    "effect-delivery-revision",
    "media-effects-" + attempt,
    captureActivePage,
    "Actual native Codex tools, MP4 playback, downloads and a separately approved text-motion revision",
  );
  await recording.start();
  const first = await execute(lost.id, "first");
  await page.locator(".effect-delivery").scrollIntoViewIfNeeded();
  await shot(page, "first-delivery");
  pass(
    "EFFECT-05 actual native Codex reads the frozen request and delivers decoded MP4, preview, source and ZIP, with verified browser downloads and measured settlement",
  );
  await page.locator('[data-effect-id="text.slide-up"]').click();
  await page
    .getByRole("textbox", { name: "Task name", exact: true })
    .fill("Harbour launch · text motion");
  await page
    .getByRole("combobox", { name: /^Source 1/ })
    .selectOption({ label: "campaign-a.png · v1" });
  await page
    .getByRole("textbox", { name: "Display text", exact: true })
    .fill("下一個好點子");
  await page
    .getByRole("spinbutton", { name: "Duration in seconds", exact: true })
    .fill("3");
  await page.getByRole("checkbox").check();
  await page.locator(".effect-studio form").scrollIntoViewIfNeeded();
  await shot(page, "revision-brief");
  const [revised] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === base + "/effects/tasks" &&
        r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Confirm & create", exact: true }).click(),
  ]);
  assert.equal(revised.status(), 200);
  const secondTask = await revised.json();
  assert.notEqual(secondTask.id, lost.id);
  await page.waitForURL("**/app/effects?task=" + secondTask.id);
  const second = await execute(secondTask.id, "revision");
  assert.equal(second.request.effect_id, "text.slide-up");
  assert.equal(second.request.parameters.text, "下一個好點子");
  await page.locator(".effect-delivery").scrollIntoViewIfNeeded();
  await shot(page, "revision-delivery");
  media.push(await recording.stop());
  recording = undefined;
  pass(
    "EFFECT-06 a newly approved Chinese text-motion revision executes a second native Codex kernel with new media and independent usage, preserving originals",
  );
  const peerContext = await browser.newContext({
    viewport: { width: 1440, height: 980 },
  });
  await peerContext.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const peerPage = await peerContext.newPage();
  const peer = await signIn(
    peerPage,
    "effects-peer-" + randomUUID() + "@example.invalid",
  );
  await system.db.tx(
    async (tx: any) => {
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
        [tenant, peer.user.id],
      );
      await tx.query(
        "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
        [tenant, project, peer.user.id],
      );
    },
    tenant,
    true,
  );
  await go(peerPage, "http://localhost:4317/app/effects?task=" + secondTask.id);
  assert.equal(
    (
      await peerPage.request.get(
        "http://localhost:4317" + base + "/effects/tasks/" + secondTask.id,
      )
    ).status(),
    404,
  );
  for (const file of [...first.delivery.files, ...second.delivery.files])
    assert.equal(
      (
        await peerPage.request.get(
          "http://localhost:4317" +
            base +
            `/assets/${file.asset_id}/download?version=${file.version}`,
        )
      ).status(),
      404,
    );
  await peerPage.locator(".effect-delivery .notice.error").waitFor();
  await shot(peerPage, "private-boundary");
  await peerContext.close();
  pass(
    "EFFECT-07 another authenticated project editor cannot read the private reviewed tasks, previews or any of eight exact output versions",
  );
  for (const width of [375, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".effect-studio").scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await shot(page, "responsive-" + width);
    await page
      .getByRole("button", { name: "Confirm & create", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() => document.activeElement !== document.body),
    );
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  await page
    .getByRole("button", { name: "切換至繁體中文", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Theme: light / dark / system", exact: true })
    .click();
  await page.locator(".effects-filter").scrollIntoViewIfNeeded();
  await shot(page, "directory-zh-dark");
  await system.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [inputA.id],
  );
  await page.locator(".effect-delivery .notice.error").waitFor();
  assert.equal(await page.locator(".effect-delivery video").count(), 0);
  await page.locator(".effect-delivery").scrollIntoViewIfNeeded();
  await shot(page, "withdrawn-source");
  for (const file of [...first.delivery.files, ...second.delivery.files])
    assert.equal(
      (
        await page.request.get(
          "http://localhost:4317" +
            base +
            `/assets/${file.asset_id}/download?version=${file.version}`,
        )
      ).status(),
      404,
    );
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page.waitForURL("**/login");
  assert.equal(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((key) =>
        key.startsWith("cp_work_selection_v1:effects:"),
      ),
    ),
    false,
  );
  pass(
    "EFFECT-08 responsive and Chinese dark pages avoid horizontal overflow, keyboard navigation works, source withdrawal removes previews and fences outputs, and sign-out clears saved attempts",
  );
} catch (error) {
  errors.push(String(error));
  console.error(error);
} finally {
  clearTimeout(timeout);
  if (recording)
    await recording
      .stop()
      .then((v) => media.push(v))
      .catch((e) => errors.push(String(e)));
  if (browser)
    await browser
      .close()
      .then(() => (browserClosed = true))
      .catch((e) => errors.push(String(e)));
  if (system)
    await system.app
      .close()
      .then(() => (apiClosed = true))
      .catch((e: any) => errors.push(String(e)));
  if (isolated) {
    process.chdir(platform);
    await isolated
      .cleanup()
      .then(() => (fixtureClosed = true))
      .catch((e: any) => errors.push(String(e)));
  }
  process.chdir(delivery);
  const result = {
    at: new Date().toISOString(),
    status:
      !errors.length &&
      browserClosed &&
      apiClosed &&
      fixtureClosed &&
      checks.length === 8
        ? "passed"
        : "failed",
    checks,
    errors,
    funding,
    executions,
    output_files: outputFiles,
    screenshots,
    media,
    browser_closed: browserClosed,
    api_closed: apiClosed,
    fixture_closed: fixtureClosed,
    not_validated: [
      "Live model or media quality; this gateway is explicitly synthetic",
      "full professional role qualification",
      "complete product acceptance or all original 102 requirements",
    ],
  };
  await writeFile(
    prefix + "-journey.json",
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({ status: result.status, checks: checks.length, errors }),
  );
  process.exitCode = result.status === "passed" ? 0 : 1;
}
