import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import {
  WorkmateRecording,
  saveWorkmateScreenshot,
} from "./record-workmate-media.js";
import { openEventSidePanel } from "./client-event-sidepanel-ui.js";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2],
  prefix = path.resolve("evidence/cloud-events-ui-" + attempt);
assert.match(attempt ?? "", /^\d{2}$/);
const apiOrigin = process.env.COPYPASTE_RECOVERY_API_ORIGIN!,
  webOrigin = process.env.COPYPASTE_RECOVERY_WEB_ORIGIN!,
  adminOrigin = process.env.COPYPASTE_RECOVERY_ADMIN_ORIGIN!;
const load = (file: string): Promise<any> =>
  import(pathToFileURL(path.join(platform, file)).href);
const checks: string[] = [],
  screenshots: any[] = [],
  recordings: any[] = [],
  layouts: any[] = [],
  errors: string[] = [],
  executions: any[] = [];
let system: any,
  isolated: any,
  browser: Browser | undefined,
  panel: Awaited<ReturnType<typeof openEventSidePanel>> | undefined,
  recording: WorkmateRecording | undefined,
  web: Page | undefined,
  admin: Page | undefined;
let browserClosed = false,
  panelClosed = false,
  apiClosed = false,
  fixtureClosed = false,
  stage = "setup";
const pass = (text: string) => {
  checks.push(text);
  console.log("PASS: " + text);
};
async function until<T>(
  read: () => Promise<T>,
  accept: (v: T) => boolean,
  label: string,
) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const v = await read();
    if (accept(v)) return v;
    await new Promise((r) => setTimeout(r, 180));
  }
  throw new Error("Timeout: " + label);
}
async function request(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
) {
  const r = await page.evaluate(
    async ({ url, method, body, apiOrigin, adminOrigin }) => {
      const admin = location.origin === adminOrigin;
      const auth = await (
        await fetch(
          apiOrigin + (admin ? "/v1/admin/me" : "/v1/session/context"),
          { credentials: "include" },
        )
      ).json();
      const r = await fetch(apiOrigin + url, {
        method,
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": auth.csrf_token,
          "idempotency-key": crypto.randomUUID(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: await r.json() };
    },
    { url, method, body, apiOrigin, adminOrigin },
  );
  assert.ok(
    r.status >= 200 && r.status < 300,
    url + " " + r.status + " " + JSON.stringify(r.body),
  );
  return r.body;
}
async function signIn(page: Page, email: string, otp?: any) {
  await page.goto((otp ? adminOrigin : webOrigin) + "/login");
  await page.locator('input[name="email"]').fill(email);
  const [challenge] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          (otp ? "/v1/admin/auth/challenge" : "/v1/auth/challenges") &&
        r.request().method() === "POST",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.ok(challenge.ok());
  const ch = await challenge.json(),
    mail = JSON.parse(
      await readFile(
        path.join(isolated.directory, "mailbox", ch.challenge_id + ".json"),
        "utf8",
      ),
    );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  if (otp) await page.locator('input[name="totp"]').fill(otp.generate());
  await page.locator('form button[type="submit"]').click();
}
async function shot(
  repo: string,
  name: string,
  bytes: Buffer,
  description: string,
) {
  screenshots.push(
    await saveWorkmateScreenshot(
      repo,
      "cloud-events-" + attempt,
      name,
      bytes,
      description,
      delivery,
    ),
  );
}
async function stopMovie() {
  if (recording) {
    const r = recording;
    recording = undefined;
    recordings.push(await r.stop());
  }
}
async function fits(page: Page, name: string) {
  await page.waitForFunction(
    () =>
      !matchMedia("(max-width:740px)").matches ||
      document.querySelector(".sidebar")!.getBoundingClientRect().right <= 1,
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const v = await page.evaluate(() => ({
    width: innerWidth,
    zoom: document.documentElement.style.zoom || "1",
    overflow: document.documentElement.scrollWidth > innerWidth + 2,
    viewport_bounds: Array.from(
      document.querySelectorAll<HTMLElement>(
        ".cloud-events,.event-card,.admin-event-card,.main-shell",
      ),
    ).map((e) => {
      const r = e.getBoundingClientRect();
      return { tag: e.className, left: r.left, right: r.right };
    }),
    navigation_obscures_content:
      matchMedia("(max-width:740px)").matches &&
      document.querySelector(".sidebar")!.getBoundingClientRect().right > 1,
  }));
  layouts.push({ name, ...v });
  assert.ok(
    !v.overflow &&
      !v.navigation_obscures_content &&
      v.viewport_bounds.every((r) => r.left >= -2 && r.right <= v.width + 2),
    name + JSON.stringify(v),
  );
}
const deadline = setTimeout(() => {
  errors.push("Owned UI deadline exceeded");
  void panel?.close();
  void browser?.close();
}, 600000);
try {
  const [
    { isolatedTestEnvironment },
    { buildApp },
    { loadConfig },
    { CodexRuntimeAdapter },
    { Worker },
    { advanceCloudWorkflows },
    { advanceCloudEvents },
    { eventSignature },
    { seal },
  ] = await Promise.all([
    load("tests/native-test-environment.ts"),
    load("src/server.ts"),
    load("src/config.ts"),
    load("src/runtime.ts"),
    load("src/worker.ts"),
    load("src/cloud-workflows.ts"),
    load("src/cloud-events.ts"),
    load("src/cloud-event-model.ts"),
    load("src/lib.ts"),
  ]);
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
      DEV_MAILBOX: "true",
      API_ORIGIN: apiOrigin,
      WEB_ORIGIN: webOrigin,
      ADMIN_ORIGIN: adminOrigin,
      CODEX_BIN: process.env.CODEX_BIN,
      CODEX_VERSION: process.env.CODEX_VERSION,
    }),
    { worker: false },
  );
  await system.app.listen({
    host: "127.0.0.1",
    port: Number(new URL(apiOrigin).port),
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
    args: ["--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
  });
  await context.addInitScript((origin) => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    document.addEventListener(
      "DOMContentLoaded",
      () => (document.documentElement.dataset.qaAdminOrigin = origin),
    );
  }, adminOrigin);
  web = await context.newPage();
  web.setDefaultTimeout(30000);
  web.on("pageerror", (e) => errors.push(e.message));
  stage = "customer onboarding";
  await signIn(web, "event-ui-" + randomUUID() + "@example.invalid");
  await web.waitForURL("**/welcome");
  await web.locator('input[name="name"]').fill("Harbour campaign studio");
  await web
    .locator('input[name="project_name"]')
    .fill("Event campaign reviews");
  const [created] = await Promise.all([
    web.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/tenants" &&
        r.request().method() === "POST",
    ),
    web
      .getByRole("button", { name: "Create workspace & continue", exact: true })
      .click(),
  ]);
  assert.ok(created.ok());
  const workspace = await created.json();
  await web.waitForURL("**/app");
  const tenant = workspace.tenant.id,
    project = workspace.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`,
    endpoint = base + "/cloud-workflow-events";
  await request(web, `/v1/tenants/${tenant}/demo-credit`, "POST", {});
  const me = await request(web, "/v1/me");
  const dataset = await request(web, base + "/analytics/import", "POST", {
    name: "Owned campaign evidence",
    currency: "HKD",
    account_id: "Google-HK",
    attribution_definition: "7d click",
    conversion_definition: "Purchase",
    csv: "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Harbour,100,10,10,1,20,HKD\n2026-10-02,Google,Harbour,1000,200,90,3,180,HKD",
  });
  await web.goto(webOrigin + "/app/roles");
  await web.locator('[data-template-role="workflow-consultant"]').click();
  let modal = web.getByRole("dialog");
  await modal
    .getByLabel("Specialist name", { exact: true })
    .fill("Harbour event consultant");
  await modal
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .click();
  await web.waitForURL("**/app/specialists");
  await web
    .locator(".specialist-card")
    .filter({
      has: web.getByRole("heading", {
        name: "Harbour event consultant",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await web.waitForURL("**/app/conversations/*");
  const conversation = web.url().split("/").at(-1)!;
  let calls: string[] = [];
  class CapturedCodex extends CodexRuntimeAdapter {
    constructor(config: any) {
      super(config);
    }
    async start(ctx: any) {
      return super.start({
        ...ctx,
        tools: ctx.tools.map((tool: any) => ({
          ...tool,
          run: async (args: any, id: string) => {
            calls.push(tool.name);
            return tool.run(args, id);
          },
        })),
      });
    }
  }
  async function execute(id: string) {
    calls = [];
    await new Worker(
      system.db,
      system.catalog,
      system.storage,
      new CapturedCodex(system.db.config),
    ).run(tenant, id);
    const t = await request(web!, base + "/tasks/" + id);
    assert.equal(t.status, "succeeded", JSON.stringify(t));
    const count = Number(
      (
        await system.db.control.query(
          "SELECT count(*) AS n FROM reservations WHERE task_id=$1",
          [id],
        )
      ).rows[0].n,
    );
    assert.equal(count, 1);
    assert.ok(Number(t.charged_micros) > 0);
    executions.push({
      task_id: id,
      native_codex: true,
      synthetic_model: true,
      tools: [...calls],
      reservation_count: count,
      charged_micros: t.charged_micros,
    });
    return t;
  }
  stage = "native Codex event proposal";
  await web.locator('select[name="mode"]').selectOption("execute");
  await web
    .getByLabel("Your message", { exact: true })
    .fill(
      "event_demo=confirmed. Prepare a private campaign.ready event workflow. Use the fixed authorized campaign evidence, wait for my human review and then produce a private note. Asia/Hong_Kong, latest only, minimum interval 10 seconds, three runs per day, event age 3600 seconds, ends in one day. Request my explicit customer confirmation before activating future cloud work.",
    );
  const [acceptedResponse] = await Promise.all([
    web.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          base + `/conversations/${conversation}/messages` &&
        r.request().method() === "POST",
    ),
    web.getByRole("button", { name: "Delegate task", exact: true }).click(),
  ]);
  assert.ok(acceptedResponse.ok());
  const accepted = await acceptedResponse.json();
  await execute(accepted.task.id);
  assert.deepEqual(calls, [
    "analysis_sources",
    "workflow_validate",
    "workflow_save",
    "workflow_publish",
    "workflow_event_preview",
    "workflow_event_request",
  ]);
  let data = await request(web, endpoint),
    proposal = data.requests[0];
  assert.equal(data.triggers.length, 0);
  assert.ok(proposal.origin_ready);
  pass(
    "Actual email onboarding, workspace, specialist and conversation lead to a pending event proposal through pinned native Codex and real company tools; model data is synthetic",
  );
  await web.goto(webOrigin + "/app/workflows");
  const proposalCard = () =>
    web!.locator(`[data-event-request="${proposal.id}"]`);
  await proposalCard()
    .getByRole("button", { name: "Review event and costs", exact: true })
    .click();
  modal = web.getByRole("dialog");
  await modal.locator("[data-event-review]").waitFor();
  assert.ok(
    await modal
      .getByRole("button", { name: "Activate confirmed work", exact: true })
      .isDisabled(),
  );
  await shot(
    "web",
    "review-en",
    await web.screenshot(),
    "Actual customer event and recurring budget review with unchecked consent",
  );
  recording = new WorkmateRecording(
    "web",
    "cloud-events-confirmation",
    attempt,
    () => web!.screenshot({ type: "jpeg", quality: 80 }),
    "Actual proposal review, exact customer activation, masked one-time key, durable receipt and version history",
    delivery,
  );
  await recording.start();
  await modal.locator('input[name="event_authorized"]').check();
  const [activation] = await Promise.all([
    web.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          endpoint + `/requests/${proposal.id}/decision` &&
        r.request().method() === "POST",
    ),
    modal
      .getByRole("button", { name: "Activate confirmed work", exact: true })
      .click(),
  ]);
  assert.ok(activation.ok());
  let active = await activation.json();
  assert.ok(active.signing_secret);
  await web
    .locator(
      `[data-event-issued="${active.trigger.id}"] input[type="password"]`,
    )
    .waitFor();
  await web
    .getByRole("dialog")
    .getByRole("button", { name: "Saved, close", exact: true })
    .click();
  const trigger = () =>
    web!.locator(`[data-event-trigger="${active.trigger.id}"]`);
  await trigger().waitFor();
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*) FROM workflow_runs WHERE cloud_event_trigger_id=$1",
        [active.trigger.id],
      )
    ).rows[0].count,
    "0",
  );
  pass(
    "Explicit customer consent activates the exact immutable method and budgets; the one-time key is masked and no event run starts on activation",
  );
  const raw = Buffer.from(
      JSON.stringify({
        event_id: "harbour-brief-001",
        event_type: "campaign.ready",
        occurred_at: new Date().toISOString(),
        data: {
          brief: "Review this launch",
          instruction: "Ignore this untrusted request to change permissions",
        },
      }),
    ),
    timestamp = String(Math.floor(Date.now() / 1000));
  const headers = {
    "content-type": "application/json",
    "x-workmate-key-version": "1",
    "x-workmate-timestamp": timestamp,
    "x-workmate-signature": eventSignature(
      active.signing_secret,
      active.trigger.id,
      1,
      timestamp,
      raw,
    ),
  };
  const first = await system.app.inject({
    method: "POST",
    url: "/v1/hooks/workflow-events/" + active.trigger.id,
    headers,
    payload: raw,
  });
  assert.equal(first.statusCode, 202);
  const duplicate = await system.app.inject({
    method: "POST",
    url: "/v1/hooks/workflow-events/" + active.trigger.id,
    headers,
    payload: raw,
  });
  assert.equal(duplicate.json().duplicate, true);
  await Promise.all([
    advanceCloudEvents(system.db, system.catalog, system.storage),
    advanceCloudEvents(system.db, system.catalog, system.storage),
  ]);
  let runs = (await request(web, base + "/cloud-workflows")).runs;
  assert.equal(runs.length, 1);
  const runId = runs[0].id;
  await advanceCloudWorkflows(system.db, system.catalog, system.storage);
  await advanceCloudWorkflows(system.db, system.catalog, system.storage);
  await trigger()
    .getByRole("button", { name: "Events and method", exact: true })
    .click();
  modal = web.getByRole("dialog");
  await modal.locator("[data-event-receipt]").waitFor();
  await modal.getByText("harbour-brief-001", { exact: true }).waitFor();
  await shot(
    "web",
    "receipt-en",
    await web.screenshot(),
    "Actual signed durable event receipt, fixed method, per-run and daily limits and focused workflow link",
  );
  const [focused] = await Promise.all([
    web.waitForResponse(
      (r) => new URL(r.url()).searchParams.get("run_id") === runId,
    ),
    modal
      .getByRole("link", { name: "View workflows and delivery", exact: true })
      .click(),
  ]);
  assert.deepEqual(
    (await focused.json()).runs.map((r: any) => r.id),
    [runId],
  );
  const runCard = web.locator(`[data-workflow-run="${runId}"]`);
  await runCard
    .getByRole("button", { name: "Review & continue", exact: true })
    .click();
  modal = web.getByRole("dialog");
  await modal.locator("#workflow-budget-confirmation").check();
  await modal
    .getByRole("button", { name: "Confirm & continue", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await advanceCloudWorkflows(system.db, system.catalog, system.storage);
  let run = (await request(web, base + "/cloud-workflows")).runs.find(
    (r: any) => r.id === runId,
  );
  assert.ok(run.active_task);
  await execute(run.active_task);
  assert.deepEqual(calls, ["deliver_text"]);
  await advanceCloudWorkflows(system.db, system.catalog, system.storage);
  assert.equal(
    (await request(web, base + "/cloud-workflows")).runs.find(
      (r: any) => r.id === runId,
    ).state,
    "succeeded",
  );
  pass(
    "Signed retries yield one persisted inbox and one private run; actual customer step approval precedes a pinned native Codex child and settled usage",
  );
  await stopMovie();
  stage = "customer event editor";
  await web.goto(webOrigin + "/app/workflows#cloud-run-" + runId);
  await runCard
    .getByRole("button", { name: "Start from an event", exact: true })
    .click();
  modal = web.getByRole("dialog");
  await modal.locator('input[name="name"]').fill("Harbour side panel briefs");
  await modal.locator('input[name="event_type"]').fill("campaign.ready");
  await modal
    .locator('textarea[name="expected_output"]')
    .fill(
      "Review the confirmed private campaign evidence after a signed brief.",
    );
  await modal
    .getByRole("button", { name: "Save proposal for review", exact: true })
    .click();
  await web.locator("[data-event-review]").waitFor();
  await web
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  data = await request(web, endpoint);
  proposal = data.requests.find(
    (r: any) => r.body.name === "Harbour side panel briefs",
  );
  assert.ok(proposal);
  pass(
    "Customer event editor creates a separately reviewed proposal from the actual delivered workflow version",
  );
  stage = "native right Side Panel";
  panel = await openEventSidePanel(
    delivery,
    await context.cookies(),
    webOrigin,
  );
  assert.equal(panel.native.context_type, "SIDE_PANEL");
  assert.equal(panel.native.side, "right");
  await panel.evaluate("document.querySelector('#workspace-tools').open=true");
  await until(
    () =>
      panel!.evaluate(
        `Boolean(document.querySelector('.task-row[data-task="${accepted.task.id}"]'))`,
      ),
    Boolean,
    "source consultant in native panel",
  );
  await panel.evaluate(
    `document.querySelector('.task-row[data-task="${accepted.task.id}"]').click()`,
  );
  await until(
    () =>
      panel!.evaluate(
        `Boolean(document.querySelector('[data-event-request="${proposal.id}"]'))`,
      ),
    Boolean,
    "actual native event proposal",
  );
  await panel.evaluate(
    `document.querySelector('[data-event-request="${proposal.id}"] details:last-child').open=true;document.querySelector('[data-event-request="${proposal.id}"]').scrollIntoView({block:'start'})`,
  );
  assert.equal(
    await panel.evaluate(
      `document.querySelector('[data-event-request="${proposal.id}"] input[name="event_authorized"]').checked`,
    ),
    false,
  );
  await shot(
    "extension",
    "review-en",
    await panel.capture(),
    "Actual docked right Chrome SIDE_PANEL showing a private event proposal with explicit unchecked customer authorization",
  );
  recording = new WorkmateRecording(
    "extension",
    "cloud-events-sidepanel",
    attempt,
    () => panel!.capture(),
    "Actual native Side Panel confirmation, masked one-time key and customer pause of future event work",
    delivery,
  );
  await recording.start();
  await panel.evaluate(
    `(()=>{const c=document.querySelector('[data-event-request="${proposal.id}"] input[name="event_authorized"]');c.checked=true;c.dispatchEvent(new Event('change'));Array.from(document.querySelectorAll('[data-event-request="${proposal.id}"] button')).find(b=>b.textContent==='Activate confirmed work').click()})()`,
  );
  await until(
    () =>
      panel!.evaluate(
        "Boolean(document.querySelector('#cloud-events [data-event-issued] input[type=password]'))",
      ),
    Boolean,
    "native one-time key",
  );
  await panel.evaluate(
    "Array.from(document.querySelectorAll('#cloud-events button')).find(b=>b.textContent==='Saved, close').click()",
  );
  const second = (await request(web, endpoint)).triggers.find(
    (r: any) => r.name === "Harbour side panel briefs",
  );
  assert.ok(second);
  await until(
    () =>
      panel!.evaluate(
        `Boolean(document.querySelector('[data-event-trigger="${second.id}"]'))`,
      ),
    Boolean,
    "native active trigger",
  );
  await panel.evaluate(
    `(()=>{const a=document.querySelector('[data-event-trigger="${second.id}"]');Array.from(a.querySelectorAll('details')).find(d=>d.querySelector('summary').textContent==='Manage future events').open=true;Array.from(a.querySelectorAll('button')).find(b=>b.textContent==='Confirm pause').click()})()`,
  );
  await until(
    async () =>
      (await request(web!, endpoint)).triggers.find(
        (r: any) => r.id === second.id,
      )?.state,
    (v) => v === "paused",
    "native customer pause",
  );
  const panelLayout = await panel.evaluate(
    "({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+2,local_agent:typeof window.copyPasteBridge!=='undefined'})",
  );
  assert.ok(!panelLayout.overflow && !panelLayout.local_agent);
  layouts.push({
    name: "Native right Side Panel",
    ...panelLayout,
    native: panel.native,
  });
  pass(
    "A genuine right SIDE_PANEL performs PKCE login, exact event consent, masked key issuance and customer pause, with cloud execution and no extra extension tab",
  );
  await stopMovie();
  stage = "scoped Admin controls";
  const OTPAuth = createRequire(path.join(platform, "package.json"))("otpauth"),
    secret = new OTPAuth.Secret({ size: 20 }),
    email = "event-admin-ui-" + randomUUID() + "@example.invalid";
  const operator = (
    await system.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Event control operator',$2) RETURNING id",
      [email, seal(system.db.config.MASTER_KEY, secret.base32)],
    )
  ).rows[0];
  const role = "event_ui_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(["admin.execution.read", "admin.execution.pause"])],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)",
    [operator.id, role, project],
  );
  admin = await context.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await signIn(admin, email, new OTPAuth.TOTP({ secret }));
  await admin.waitForURL((u) => u.pathname !== "/login");
  await admin.goto(adminOrigin + "/execution");
  const adminCard = admin.locator(`[data-admin-event="${active.trigger.id}"]`);
  await adminCard.waitFor();
  assert.equal(await admin.locator("[data-admin-event]").count(), 2);
  const metadata = await request(admin, "/v1/admin/private-cloud-events");
  for (const field of [
    "name",
    "event_type",
    "body",
    "data",
    "definition",
    "endpoint",
    "signing_secret",
  ])
    assert.ok(!(field in metadata.items[0]));
  await adminCard.scrollIntoViewIfNeeded();
  await fits(admin, "Admin English light 1440px");
  await shot(
    "admin",
    "controls-en",
    await admin.screenshot(),
    "Actual scoped recent-MFA Admin metadata, budget limits and pause action without private event content",
  );
  recording = new WorkmateRecording(
    "admin",
    "cloud-events-control",
    attempt,
    () => admin!.screenshot({ type: "jpeg", quality: 80 }),
    "Actual scoped Admin event state filtering, reasoned pause and stale MFA withdrawal",
    delivery,
  );
  await recording.start();
  await adminCard
    .getByRole("button", { name: "Pause future events", exact: true })
    .click();
  modal = admin.getByRole("dialog");
  await modal
    .locator('textarea[name="reason"]')
    .fill("Review future campaign brief work");
  await modal
    .getByRole("button", { name: "Confirm pause", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await until(
    async () =>
      (await request(web!, endpoint)).triggers.find(
        (r: any) => r.id === active.trigger.id,
      )?.state,
    (v) => v === "paused",
    "scoped admin pause",
  );
  await admin
    .getByLabel("Filter by state", { exact: true })
    .selectOption("paused");
  await admin.locator(`[data-admin-event="${active.trigger.id}"]`).waitFor();
  await system.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [operator.id],
  );
  await admin
    .getByRole("button", { name: "Refresh event administration", exact: true })
    .click();
  await until(
    () => admin!.locator("[data-admin-event]").count(),
    (v) => v === 0,
    "old admin metadata removed on MFA expiry",
  );
  pass(
    "Scoped Admin reads metadata only, filters state, pauses with a reason and loses stale content when current MFA expires; it cannot resume customer fees",
  );
  await stopMovie();
  stage = "responsive and private withdrawal";
  await web.goto(webOrigin + "/app/workflows");
  await trigger().waitFor();
  await fits(web, "Web English light 1440px");
  await web.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await fits(web, "Web English light 200 percent CSS zoom");
  await web.evaluate(() => {
    document.documentElement.style.zoom = "";
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await web.setViewportSize({ width: 375, height: 900 });
  await web.reload();
  await trigger().waitFor();
  await fits(web, "Web Chinese dark 375px");
  await trigger().scrollIntoViewIfNeeded();
  await shot(
    "web",
    "compact-zh-dark",
    await web.screenshot(),
    "Actual Chinese dark 375px event workflow cards after responsive layout settles, without horizontal overflow",
  );
  await trigger()
    .getByRole("button", { name: "事件與方法", exact: true })
    .click();
  await web.getByRole("dialog").locator("[data-event-receipt]").waitFor();
  await system.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
    [dataset.id],
  );
  await until(
    () => web!.getByRole("dialog").count(),
    (v) => v === 0,
    "withdrawn source clears open private history",
  );
  await until(
    () => web!.locator("[data-event-trigger]").count(),
    (v) => v === 0,
    "withdrawn private Web cards",
  );
  await until(
    () =>
      panel!.evaluate(
        "document.querySelector('#cloud-events').textContent.trim()===''",
      ),
    Boolean,
    "withdrawn native event cards",
  );
  await panel.evaluate("document.querySelector('#sign-out').click()");
  await until(
    () =>
      panel!.evaluate(
        "document.querySelector('#login').hidden===false && document.querySelector('#cloud-events').textContent===''",
      ),
    Boolean,
    "native sign-out clears private controls",
  );
  pass(
    "Bilingual dark/light and 200 percent layouts fit; actual source withdrawal clears open private history and both Web/native panel content, and sign-out clears native controls",
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*) FROM workflow_runs WHERE cloud_event_trigger_id=$1",
        [active.trigger.id],
      )
    ).rows[0].count,
    "1",
  );
  assert.ok(me.user?.id ?? me.id);
} catch (e) {
  errors.push(stage + ": " + String(e));
  for (const [name, page] of [
    ["web", web],
    ["admin", admin],
  ] as const)
    if (page) {
      await writeFile(
        prefix + "-failure-" + name + ".txt",
        await page.locator("body").innerText(),
      ).catch(() => {});
      await writeFile(
        prefix + "-failure-" + name + ".png",
        await page.screenshot(),
      ).catch(() => {});
    }
} finally {
  clearTimeout(deadline);
  if (recording)
    try {
      await stopMovie();
    } catch (e) {
      errors.push(String(e));
    }
  if (panel) {
    await panel.close();
    panelClosed = true;
  }
  if (browser) {
    await browser.close();
    browserClosed = true;
  }
  if (system) {
    await system.app.close();
    apiClosed = true;
  }
  if (isolated) {
    await isolated.cleanup();
    fixtureClosed = true;
  }
  const report = {
    at: new Date().toISOString(),
    status: errors.length ? "failed" : "passed",
    checks,
    errors,
    screenshots,
    recordings,
    layouts,
    executions,
    browser_closed: browserClosed,
    panel_closed: panelClosed,
    api_closed: apiClosed,
    fixture_closed: fixtureClosed,
    synthetic_model: true,
    live_provider_qualified: false,
  };
  await writeFile(
    prefix + "-journey.json",
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({ status: report.status, checks: checks.length, errors }),
  );
  assert.equal(report.status, "passed");
}
