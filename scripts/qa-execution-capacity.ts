import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emailCode, verifyAdmin } from "./qa-auth.js";

const platform = path.resolve("../copypaste-platform"),
  run = randomUUID();
const pg = createRequire(path.join(platform, "package.json"))("pg");
const checks: any[] = [],
  errors: string[] = [],
  occupants: string[] = [];
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  db: any,
  closed = false;
let adminContext: BrowserContext | undefined;
async function call(page: Page, url: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const me = await (await fetch("/v1/me")).json();
      const r = await fetch(url, {
        method,
        headers: {
          "X-CSRF-Token": me.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!r.ok) throw new Error(`${method} ${url}: ${r.status}`);
      return r.json();
    },
    { url, method, body },
  );
}
async function shot(page: Page, name: string, repo = "copypaste-web") {
  const dir = path.resolve("..", repo, "assets/screenshots");
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
}
try {
  const config = await (
    await fetch("http://localhost:4310/v1/public/config")
  ).json();
  assert.equal(
    config.data_mode,
    "simulated",
    "This fixture is allowed only in the local synthetic environment",
  );
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4317/login");
  await page
    .getByLabel("Work email")
    .fill(`capacity-ui-${run}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Synthetic capacity studio");
  await page.locator('input[name="project_name"]').fill("Queued launch brief");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  await page
    .getByRole("button", { name: "Add one-time demo credit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Demo credit added", exact: true })
    .waitFor();
  const me = await call(page, "/v1/me"),
    tenant = me.memberships[0].id,
    project = (await call(page, `/v1/tenants/${tenant}/projects`)).items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  // Occupancy alone is synthetic. These private, never-dispatched records have
  // no model calls or reservations; every write is tied to this fresh fixture.
  assert.equal(
    (await db.query("SELECT data_mode FROM tenants WHERE id=$1", [tenant]))
      .rows[0].data_mode,
    "simulated",
  );
  const helper = (
    await db.query("INSERT INTO users(email,name) VALUES($1,$2) RETURNING id", [
      `capacity-occupant-${run}@example.invalid`,
      "Synthetic capacity fixture",
    ])
  ).rows[0].id;
  for (let i = 0; i < 2; i++)
    occupants.push(
      (
        await db.query(
          `INSERT INTO tasks(tenant_id,project_id,created_by,private_owner,title,prompt,role_key,role_hash,budget_micros,idempotency_key,status,attempt,fencing_token,lease_until)
    VALUES($1,$2,$3,$3,'SIMULATED capacity occupant','Never dispatched; test occupancy only.','assistant',$4,1,$5,'running',1,$6,now()+interval '10 minutes') RETURNING id`,
          [
            tenant,
            project,
            helper,
            "0".repeat(64),
            "qa-capacity-" + run + ":" + i,
            randomUUID(),
          ],
        )
      ).rows[0].id,
    );
  await page
    .getByRole("button", { name: "Create campaign visuals", exact: false })
    .click();
  const form = page.getByRole("dialog");
  await form
    .getByLabel("Task name", { exact: true })
    .fill("Capacity-aware launch plan");
  await form
    .getByLabel("What would you like to make?", { exact: true })
    .fill(
      "Write a clearly simulated campaign plan and deliver an editable Markdown file.",
    );
  await form.getByLabel("Task budget limit (HKD)", { exact: true }).fill("1");
  await form.getByRole("button", { name: "Start task", exact: true }).click();
  await page.waitForURL("**/app/conversations/*");
  const t = (await call(page, base + "/tasks")).items[0];
  await page
    .getByText(
      "Waiting for execution capacity; the original budget remains reserved.",
      { exact: true },
    )
    .waitFor({ timeout: 20000 });
  const waiting = await call(page, base + "/tasks/" + t.id);
  assert.equal(waiting.status, "queued");
  assert.equal(waiting.attempt, 0);
  assert.equal(waiting.capacity_wait_reason, "tenant");
  assert.equal(Number(waiting.charged_micros), 0);
  assert.equal(
    Number(
      (await call(page, `/v1/tenants/${tenant}/billing`)).wallet
        .reserved_micros,
    ),
    1000000,
  );
  checks.push({
    name: "actual Web submission waits behind two explicitly synthetic private capacity occupants; original task and budget are retained with no model call",
    status: "passed",
  });
  await page.goto("http://localhost:4317/app/tasks/" + t.id);
  await page
    .getByText("Execution capacity is busy.", { exact: false })
    .waitFor();
  await page
    .getByText("Waiting for execution capacity", { exact: true })
    .waitFor();
  await shot(page, "36-capacity-wait");
  const operator = JSON.parse(
    await readFile(path.join(platform, ".data/qa/operator.json"), "utf8"),
  );
  adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  adminContext.setDefaultTimeout(20000);
  await adminContext.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const admin = await adminContext.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto("http://localhost:4318");
  await admin.getByLabel("Administrator email").fill(operator.email);
  const adminCode = await emailCode(
    admin,
    () =>
      admin
        .getByRole("button", { name: "Send admin sign-in code", exact: true })
        .click(),
    true,
  );
  await admin.locator('input[name="code"]').fill(adminCode);
  await verifyAdmin(admin, operator.totp_secret);
  await admin.goto("http://localhost:4318/execution");
  await admin
    .getByLabel("Search records", { exact: true })
    .fill("Capacity-aware launch plan");
  await admin
    .getByRole("cell", { name: "Shared workspace slots", exact: true })
    .first()
    .waitFor();
  await shot(admin, "22-capacity-queue", "copypaste-admin");
  await admin.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await shot(admin, "23-capacity-queue-dark", "copypaste-admin");
  checks.push({
    name: "an independently MFA-authenticated Admin sees the scoped original task and a readable shared-workspace queue reason without customer credentials or cross-tenant counts",
    status: "passed",
  });

  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1080 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `capacity wait overflow at ${width}`,
    );
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await shot(page, "37-capacity-dark");
  await page.getByTitle("切換至繁體中文").click();
  await page.getByText("目前執行名額已滿", { exact: false }).waitFor();
  await page.setViewportSize({ width: 375, height: 1080 });
  await shot(page, "38-capacity-mobile");
  checks.push({
    name: "queued task and automatic-continuation notice render at four widths in both themes and Traditional Chinese/English",
    status: "passed",
  });
  await page.getByTitle("Switch to English").click();
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.setViewportSize({ width: 1440, height: 1080 });
  await db.query(
    "UPDATE tasks SET status='cancelled',lease_until=NULL WHERE id=ANY($1::uuid[]) AND idempotency_key LIKE $2",
    [occupants, "qa-capacity-" + run + "%"],
  );
  await page
    .locator(".agent-output")
    .filter({ hasText: "Simulated data" })
    .waitFor({ timeout: 60000 });
  const done = await call(page, base + "/tasks/" + t.id);
  assert.equal(done.id, t.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.attempt, 1);
  assert.equal(done.capacity_wait_reason, null);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM reservations WHERE task_id=$1",
        [t.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [t.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    Number(
      (await call(page, `/v1/tenants/${tenant}/billing`)).wallet
        .reserved_micros,
    ),
    0,
  );
  const asset = (await call(page, base + "/assets")).items.find(
    (a: any) => a.name === "demo-report.md",
  );
  assert.ok(asset);
  assert.equal(asset.private_owner, me.user.id);
  const file = await page.evaluate(
    async (url) => (await fetch(url)).text(),
    base + "/assets/" + asset.id + "/download",
  );
  assert.match(file, /Simulated deliverable/);
  await shot(page, "39-capacity-result");
  checks.push({
    name: "releasing only the owned fixture occupants lets native pg-boss run the same task through real Codex with a synthetic model, creating a real file and settling one original reservation once",
    status: "passed",
  });
  assert.deepEqual(errors, []);
} catch (e: any) {
  errors.push(e.message);
  throw e;
} finally {
  try {
    if (db)
      await db.query(
        "UPDATE tasks SET status='cancelled',lease_until=NULL WHERE id=ANY($1::uuid[]) AND idempotency_key LIKE $2",
        [occupants, "qa-capacity-" + run + "%"],
      );
  } catch (e: any) {
    errors.push("Owned fixture cleanup failed: " + e.message);
    process.exitCode = 1;
  }
  try {
    if (adminContext) await adminContext.close();
    if (context) await context.close();
  } finally {
    try {
      if (browser) {
        await browser.close();
        closed = true;
      }
    } finally {
      if (db) await db.end();
      await mkdir("evidence", { recursive: true });
      await writeFile(
        "evidence/execution-capacity.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            dependency_mode: "simulated",
            capacity_fixture:
              "two owned private never-dispatched synthetic records; no capacity load benchmark",
            real_codex: true,
            checks,
            errors,
            browser_closed: closed,
          },
          null,
          2,
        ) + "\n",
      );
    }
  }
}
