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
const prefix = path.join(delivery, "evidence/editable-design-ui-" + attempt);
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
  await page.goto("http://localhost:4317/login");
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
      "editable-design-" + attempt,
      name,
      await page.screenshot({ fullPage: false, animations: "disabled" }),
      "Actual built Web or downloaded fixed-source vector/slide review; native Codex and explicitly synthetic model",
      delivery,
    ),
  );
}
const timeout = setTimeout(() => {
  errors.push("Owned analysis UI deadline exceeded");
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
    "analysis-" + randomUUID() + "@example.invalid",
  );
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour campaign studio");
  await page
    .locator('input[name="project_name"]')
    .fill("Evidence and creative review");
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
    "DESIGN-01 actual email sign-in, first workspace and demo credit prepare an authenticated synthetic customer without direct wallet mutation",
  );
  await page.goto("http://localhost:4317/app/roles");
  await page.locator('[data-template-role="brand-visual"]').waitFor();
  await shot(page, "directory-en");
  const directory = await call(
    page,
    "GET",
    "/v1/agent-templates?project_id=" + project,
    undefined,
    tenant,
  );
  for (const role of ["brand-visual", "presentation"]) {
    const template = directory.items.find((t: any) => t.role_key === role);
    assert.equal(template.qualification_state, "unverified");
    const preflight = await call(
      page,
      "POST",
      `/v1/agent-templates/${template.id}/preflights`,
      { project_id: project, template_version: template.version },
      tenant,
    );
    assert.equal(preflight.state, "ready", JSON.stringify(preflight));
  }
  pass(
    "DESIGN-02 both fixed-version design templates pass real dependency preflights while retaining unverified professional qualification",
  );
  const { CodexRuntimeAdapter } = await load("src/runtime.ts"),
    { Worker } = await load("src/worker.ts");
  let currentCalls: string[] = [],
    activePage = page;
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
  const conversations: Record<string, string> = {},
    originals: Record<string, any> = {},
    reviews: Record<string, string> = {};
  const openSpecialist = async (role: string, label: string) => {
    await page.goto("http://localhost:4317/app/roles");
    await page.locator(`[data-template-role="${role}"]`).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Specialist name", { exact: true }).fill(label);
    await modal
      .getByRole("button", { name: "Check availability", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "Create this specialist", exact: true })
      .waitFor();
    await shot(page, role + "-ready");
    await modal
      .getByRole("button", { name: "Create this specialist", exact: true })
      .click();
    await page.waitForURL("**/app/specialists");
    await page
      .locator(".specialist-card")
      .filter({ has: page.getByRole("heading", { name: label, exact: true }) })
      .getByRole("button", { name: "Start conversation", exact: true })
      .click();
    await page.waitForURL("**/app/conversations/*");
    conversations[role] = page.url().split("/").at(-1)!;
  };
  const runTask = async (role: string, prompt: string) => {
    currentCalls = [];
    const conversation = conversations[role];
    await page.goto("http://localhost:4317/app/conversations/" + conversation);
    await page.locator('select[name="mode"]').selectOption("execute");
    await page.getByLabel("Your message", { exact: true }).fill(prompt);
    const [sent] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname ===
            base + `/conversations/${conversation}/messages` &&
          r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Delegate task", exact: true }).click(),
    ]);
    assert.equal(sent.status(), 200);
    const accepted = await sent.json();
    await new Worker(
      system.db,
      system.catalog,
      system.storage,
      new CapturedCodex(system.db.config),
    ).run(tenant, accepted.task.id);
    const task = await call(
      page,
      "GET",
      base + "/tasks/" + accepted.task.id,
      undefined,
      tenant,
    );
    assert.equal(task.status, "succeeded", JSON.stringify(task));
    const rows = (
      await system.db.control.query(
        "SELECT result,output_version_ids FROM task_tool_receipts WHERE task_id=$1 AND tool_name=$2",
        [task.id, role === "brand-visual" ? "vector_render" : "slides_render"],
      )
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].result.state, "delivered");
    const reservations = (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [task.id],
      )
    ).rows[0].n;
    assert.equal(reservations, 1);
    assert.ok(Number(task.charged_micros) > 0);
    assert.equal(rows[0].result.provider_calls, 0);
    const execution = {
      task_id: task.id,
      role,
      native_codex: true,
      synthetic_model: true,
      tools: [...currentCalls],
      charged_micros: task.charged_micros,
      reservation_count: reservations,
      output: rows[0].result,
    };
    executions.push(execution);
    return execution;
  };
  const persist = async (label: string, filename: string, bytes: Buffer) => {
    const destination = prefix + "-" + label + "-" + filename;
    await writeFile(destination, bytes, { flag: "wx" });
    outputFiles.push({
      path: path.relative(delivery, destination).replaceAll("\\", "/"),
      sha256: sha(bytes),
      bytes: bytes.length,
    });
    return destination;
  };
  recording = new WorkmateRecording(
    "web",
    "editable-design-work",
    "editable-design-" + attempt,
    () => activePage.screenshot({ type: "jpeg", quality: 72 }),
    "Actual role selection, customer messages, native Codex vector/PPTX tools and real downloads; model content is synthetic",
    delivery,
  );
  await recording.start();
  for (const [role, label] of [
    ["brand-visual", "Harbour brand designer"],
    ["presentation", "Harbour presentation designer"],
  ]) {
    await openSpecialist(role, label);
    const execution = await runTask(
      role,
      "Create the explicitly synthetic coordinated editable design and actual review/source files. Keep the content marked as simulated.",
    );
    originals[role] = execution;
    assert.deepEqual(
      execution.tools,
      role === "brand-visual"
        ? ["vector_render"]
        : ["slides_build", "slides_render"],
    );
    await page.reload();
    await page.getByLabel("Your message", { exact: true }).waitFor();
    await shot(page, role + "-conversation");
    await page
      .getByRole("link", { name: "Assets & deliverables", exact: true })
      .click();
    const filename =
      role === "brand-visual" ? "brand-vector.svg" : "presentation.pptx";
    await page.getByText(filename, { exact: true }).waitFor();
    await shot(page, role + "-deliverables");
    const names =
      role === "brand-visual"
        ? [
            "brand-vector.svg",
            "vector.source.json",
            "review.html",
            "editable-design.zip",
          ]
        : [
            "presentation.pptx",
            "presentation.source.json",
            "review.html",
            "review.pdf",
            "editable-design.zip",
          ];
    for (const name of names) {
      const file = execution.output.files.find((f: any) => f.filename === name),
        card = page
          .locator(".asset-card")
          .filter({ has: page.getByText(name, { exact: true }) });
      await page.goto(
        "http://localhost:4317/app/conversations/" + conversations[role],
      );
      await page
        .getByRole("link", { name: "Assets & deliverables", exact: true })
        .click();
      const selected = card.filter({
        has: page.getByRole("button", { name: "Download", exact: true }),
      });
      let bytes: Buffer;
      if ((await selected.count()) === 1) {
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          selected
            .getByRole("button", { name: "Download", exact: true })
            .click(),
        ]);
        bytes = await readFile((await download.path())!);
      } else {
        const response = await page.request.get(
          "http://localhost:4317" + base + `/assets/${file.asset_id}/download`,
        );
        assert.equal(response.status(), 200);
        bytes = await response.body();
      }
      assert.equal(sha(bytes), file.sha256);
      const saved = await persist(role, name, bytes);
      if (name === "review.html") reviews[role] = saved;
      if (name.endsWith(".pptx") || name.endsWith(".zip"))
        assert.equal(bytes.subarray(0, 2).toString(), "PK");
      if (name.endsWith(".svg")) {
        assert.match(bytes.toString(), /<text/);
        assert.match(bytes.toString(), /<path/);
      }
    }
    pass(
      role === "brand-visual"
        ? "DESIGN-03 a real native Codex vector tool delivers editable SVG, outlined appearance, immutable source and authorized browser downloads under one reservation"
        : "DESIGN-04 a real native Codex build/render flow delivers editable PPTX, source-based PDF, per-page files and private browser downloads under one reservation",
    );
  }
  media.push(await recording.stop());
  recording = undefined;
  const reviewPage = await context.newPage();
  reviewPage.on("pageerror", (e) => errors.push(e.message));
  activePage = reviewPage;
  await reviewPage.goto(pathToFileURL(reviews["brand-visual"]).href);
  await reviewPage.locator("figure img").first().waitFor();
  await shot(reviewPage, "vector-review");
  recording = new WorkmateRecording(
    "web",
    "editable-design-review",
    "editable-design-" + attempt,
    () => activePage.screenshot({ type: "jpeg", quality: 72 }),
    "Actual downloaded review navigation and immutable revision response; source-based previews, not PowerPoint renders",
    delivery,
  );
  await recording.start();
  await reviewPage.goto(pathToFileURL(reviews.presentation).href);
  for (let index = 1; index <= 3; index++) {
    assert.equal(
      await reviewPage.locator("[data-position]").textContent(),
      `${index} / 3`,
    );
    assert.equal(await reviewPage.locator("figure:visible").count(), 1);
    await shot(reviewPage, "slide-review-" + index);
    if (index < 3)
      await reviewPage
        .getByRole("button", { name: "下一頁", exact: true })
        .click();
  }
  await reviewPage.keyboard.press("ArrowLeft");
  assert.equal(
    await reviewPage.locator("[data-position]").textContent(),
    "2 / 3",
  );
  pass(
    "DESIGN-05 actual downloaded self-contained reviews display all three source-rendered pages and support button/keyboard navigation with the PowerPoint-review limitation visible",
  );
  for (const role of ["brand-visual", "presentation"]) {
    activePage = page;
    const old = originals[role];
    const revised = await runTask(
      role,
      `Revise the actual saved design with the requested wording change, preserving old files. design_revision_source_version=${old.output.editable_source.asset_version_id}`,
    );
    assert.deepEqual(
      revised.tools,
      role === "brand-visual"
        ? ["design_source_read", "vector_render"]
        : ["design_source_read", "slides_build", "slides_render"],
    );
    assert.equal(
      revised.output.revision_of.source_version_id,
      old.output.editable_source.asset_version_id,
    );
    const oldFile = old.output.files.find(
        (f: any) => f.filename === "review.html",
      ),
      retained = await page.request.get(
        "http://localhost:4317" + base + `/assets/${oldFile.asset_id}/download`,
      );
    assert.equal(sha(await retained.body()), oldFile.sha256);
    const newFile = revised.output.files.find(
        (f: any) => f.filename === "review.html",
      ),
      response = await page.request.get(
        "http://localhost:4317" + base + `/assets/${newFile.asset_id}/download`,
      );
    assert.equal(response.status(), 200);
    const bytes = await response.body();
    assert.equal(sha(bytes), newFile.sha256);
    assert.notEqual(newFile.sha256, oldFile.sha256);
    const saved = await persist(role + "-revised", "review.html", bytes);
    activePage = reviewPage;
    await reviewPage.goto(pathToFileURL(saved).href);
    await shot(reviewPage, role + "-revised");
    reviews[role] = saved;
  }
  pass(
    "DESIGN-06 actual second customer messages revise both fixed sources, create separately reserved new files and preserve every original download byte",
  );
  media.push(await recording.stop());
  recording = undefined;
  const otherContext = await browser.newContext(),
    otherPage = await otherContext.newPage();
  const outsider = await signIn(
    otherPage,
    "design-other-" + randomUUID() + "@example.invalid",
  );
  await system.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [tenant, outsider.user.id],
  );
  await system.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, outsider.user.id],
  );
  for (const execution of executions)
    for (const file of execution.output.files)
      assert.equal(
        (
          await otherPage.request.get(
            "http://localhost:4317" +
              base +
              `/assets/${file.asset_id}/download`,
          )
        ).status(),
        404,
      );
  const visible = await call(
    otherPage,
    "GET",
    base + "/assets",
    undefined,
    tenant,
  );
  assert.equal(visible.items.length, 0);
  await otherContext.close();
  pass(
    "DESIGN-07 another verified project editor cannot list or download either conversation's private original or revised design files",
  );
  await reviewPage.goto(pathToFileURL(reviews.presentation).href);
  // A concurrent screenshot capture can race Playwright viewport emulation.
  // Recording has fully stopped before changing page dimensions.
  for (const width of [375, 800]) {
    await reviewPage.setViewportSize({ width, height: 812 });
    assert.equal(await reviewPage.evaluate(() => innerWidth), width);
    const bounds = await reviewPage.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(bounds.scroll <= bounds.client + 1);
    await reviewPage
      .getByRole("button", { name: "下一頁", exact: true })
      .focus();
    assert.ok(
      await reviewPage
        .getByRole("button", { name: "下一頁", exact: true })
        .evaluate((e) => e === document.activeElement),
    );
    await reviewPage.keyboard.press("Enter");
    assert.equal(
      await reviewPage.locator("[data-position]").textContent(),
      "2 / 3",
    );
    await reviewPage.keyboard.press("ArrowLeft");
    const image = await reviewPage.locator("figure:visible img").boundingBox();
    assert.ok(image && image.x >= 0 && image.x + image.width <= width + 1);
    await shot(reviewPage, "review-" + width);
  }
  await reviewPage.close();
  activePage = page;
  // Withdraw the exact original sources, then check transitive descendants.
  for (const role of ["brand-visual", "presentation"]) {
    const original = originals[role],
      source = original.output.files.find(
        (f: any) =>
          f.asset_version_id ===
          original.output.editable_source.asset_version_id,
      );
    await system.db.control.query(
      "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
      [source.asset_id],
    );
    const revision = executions.find(
      (e) => e.role === role && e.task_id !== original.task_id,
    )!;
    for (const file of revision.output.files)
      assert.equal(
        (
          await page.request.get(
            "http://localhost:4317" +
              base +
              `/assets/${file.asset_id}/download`,
          )
        ).status(),
        404,
      );
  }
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=ANY($1::uuid[])",
        [executions.map((e) => e.task_id)],
      )
    ).rows[0].n,
    4,
  );
  await page.goto("http://localhost:4317/app/assets");
  await page
    .getByRole("heading", {
      name: "Assets & deliverables",
      exact: true,
    })
    .waitFor();
  await shot(page, "withdrawn-source");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL("**/login");
  pass(
    "DESIGN-08 actual reviews work at 375/800px without horizontal overflow; withdrawing each original source blocks its revised descendants while keeping four financial reservations, and the customer signs out",
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
