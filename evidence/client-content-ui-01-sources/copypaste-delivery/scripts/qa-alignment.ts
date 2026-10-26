import { chromium, type BrowserContext, type Page } from "playwright";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { emailCode, verifyAdmin } from "./qa-auth.js";
const root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform");
const checks: Array<{ name: string; status: string; detail?: string }> = [],
  errors: string[] = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
});
const contexts: BrowserContext[] = [];
async function request(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const me = await (await fetch("/v1/session/context")).json();
      const r = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      return data;
    },
    { url, method, body },
  );
}
async function shot(page: Page, repo: string, name: string) {
  const dir = path.join(root, repo, "assets/screenshots");
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, name + ".png"),
    fullPage: true,
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
    "Run npm run demo before this journey",
  );
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  contexts.push(ctx);
  ctx.setDefaultTimeout(15000);
  ctx.setDefaultNavigationTimeout(20000);
  await ctx.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4317/login");
  await page
    .getByText("Demo environment · simulated data", { exact: true })
    .waitFor();
  await page
    .getByLabel("Work email")
    .fill(`alignment-${randomUUID()}@example.invalid`);
  const otp = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(otp);
  await page
    .getByRole("button", { name: /Verify.*|Sign in.*|Open workspace/ })
    .last()
    .click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Demonstration studio");
  await page.locator('input[name="project_name"]').fill("Deletion workflow");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  await page
    .getByRole("button", { name: "Add one-time demo credit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Demo credit added", exact: true })
    .waitFor();
  checks.push({
    name: "normal email onboarding displays synthetic mode and owner receives one-time mock credit",
    status: "passed",
  });
  const me = await request(page, "/v1/session/context"),
    tenant = me.memberships[0].id;
  const project = (await request(page, `/v1/tenants/${tenant}/projects`))
    .items[0].id;
  const base = `/v1/tenants/${tenant}/projects/${project}`;
  await page.goto("http://localhost:4317/app/assets");
  await page
    .getByRole("button", { name: "Upload material", exact: true })
    .first()
    .click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "customer-erasure-fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Explicit fixture. Remove these bytes after deletion."),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload or resume", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "customer-erasure-fixture.txt", exact: true })
    .waitFor();
  const asset = (await request(page, base + "/assets")).items.find(
    (a: any) => a.name === "customer-erasure-fixture.txt",
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator('textarea[name="reason"]')
    .fill("Customer requests permanent erasure of this fixture");
  await page.getByLabel("I understand this action cannot be undone.").check();
  await page
    .getByRole("button", { name: "Confirm permanent deletion", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Deletion progress", exact: true })
    .waitFor();
  await page
    .getByText("Cleanup completed", { exact: true })
    .waitFor({ timeout: 20000 });
  await shot(page, "copypaste-web", "17-erasure-progress");
  assert.equal(
    await page
      .getByRole("heading", {
        name: "customer-erasure-fixture.txt",
        exact: true,
      })
      .count(),
    0,
  );
  checks.push({
    name: "user confirms irreversible deletion, disappears from assets and sees worker cleanup completion",
    status: "passed",
  });
  const resumeBytes = Buffer.alloc(9 * 1024 * 1024 + 7, 97),
    parts: number[] = [];
  let creates = 0,
    interrupt = true;
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    const pathname = new URL(r.url()).pathname;
    if (pathname === base + "/uploads") creates++;
    const part = pathname.match(/\/uploads\/[^/]+\/parts\/(\d+)$/);
    if (part) parts.push(Number(part[1]));
  });
  await page.route("**/uploads/*/parts/1", (route) =>
    interrupt ? route.abort("internetdisconnected") : route.continue(),
  );
  await page
    .getByRole("button", { name: "Upload material", exact: true })
    .first()
    .click();
  const resumeFile = {
    name: "resume-after-disconnect.txt",
    mimeType: "text/plain",
    buffer: resumeBytes,
  };
  await page.locator('input[type="file"]').setInputFiles(resumeFile);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload or resume", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: /Failed to fetch|NetworkError/ })
    .waitFor();
  assert.deepEqual(parts, [0, 1]);
  assert.equal(creates, 1);
  await shot(page, "copypaste-web", "19-upload-interrupted");
  interrupt = false;
  await page.reload();
  await page
    .getByRole("button", { name: "Upload material", exact: true })
    .first()
    .click();
  await page.locator('input[type="file"]').setInputFiles(resumeFile);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload or resume", exact: true })
    .click();
  await page
    .getByRole("heading", { name: resumeFile.name, exact: true })
    .waitFor();
  assert.equal(creates, 1, "reconnect must reuse the upload session");
  assert.deepEqual(
    parts,
    [0, 1, 1, 2],
    "verified part zero must not be sent again",
  );
  const resumed = (await request(page, base + "/assets")).items.find(
    (a: any) => a.name === resumeFile.name,
  );
  const binary = await page.request.get(
    `http://localhost:4317${base}/assets/${resumed.id}/download`,
  );
  assert.equal(binary.status(), 200);
  assert.equal(
    createHash("sha256")
      .update(await binary.body())
      .digest("hex"),
    createHash("sha256").update(resumeBytes).digest("hex"),
  );
  await shot(page, "copypaste-web", "20-upload-resumed");
  checks.push({
    name: "9 MiB browser upload survives a lost connection and reload, skips the verified part and downloads identical bytes",
    status: "passed",
  });
  const task = await request(page, base + "/tasks", "POST", {
    title: "Live activity demonstration",
    prompt:
      "Create a small sample website with explicitly simulated content and deliver the source ZIP.",
    role_key: "fullstack",
    budget_micros: 1000000,
  });
  let streams = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === `/v1/tasks/${task.id}/events`) streams++;
  });
  await page.goto(`http://localhost:4317/app/tasks/${task.id}`);
  await page.getByText("Live updates", { exact: true }).waitFor();
  await page
    .getByText("Simulated data", { exact: false })
    .last()
    .waitFor({ timeout: 30000 });
  await page
    .getByText("Completed", { exact: true })
    .first()
    .waitFor({ timeout: 30000 });
  await page
    .getByText("Usage settled", { exact: true })
    .waitFor({ timeout: 10000 });
  const observed = await request(page, base + "/tasks/" + task.id);
  assert.equal(observed.status, "succeeded");
  assert.ok(Number(observed.last_event_seq) > 0);
  assert.ok(streams >= 1);
  await shot(page, "copypaste-web", "21-live-task-events");
  checks.push({
    name: "Web task activity receives the canonical SSE stream while real Codex completes an explicitly simulated software task",
    status: "passed",
  });
  await page.goto("http://localhost:4317/app/assets");
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Horizontal overflow at ${width}`,
    );
  }
  await page.evaluate(() => localStorage.setItem("cp_theme", "dark"));
  await page.reload();
  await page
    .getByRole("heading", { name: "Deletion progress", exact: true })
    .waitFor();
  await shot(page, "copypaste-web", "18-erasure-dark");
  checks.push({
    name: "cleanup panel and demo notice fit 375/768/1024/1440 viewports and dark theme",
    status: "passed",
  });
  execFileSync(
    process.execPath,
    ["--env-file=.env", "--import", "tsx", "scripts/qa-fixture.ts"],
    { cwd: platform, stdio: "pipe" },
  );
  const operator = JSON.parse(
    await readFile(path.join(platform, ".data/qa/operator.json"), "utf8"),
  );
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  contexts.push(adminContext);
  adminContext.setDefaultTimeout(15000);
  adminContext.setDefaultNavigationTimeout(20000);
  await adminContext.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const admin = await adminContext.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto("http://localhost:4318");
  await admin.getByLabel("Administrator email").fill(operator.email);
  const adminOtp = await emailCode(
    admin,
    () =>
      admin
        .getByRole("button", { name: "Send admin sign-in code", exact: true })
        .click(),
    true,
  );
  await admin.locator('input[name="code"]').fill(adminOtp);
  await verifyAdmin(admin, operator.totp_secret);
  await admin.goto("http://localhost:4318/content");
  await admin
    .getByRole("heading", {
      name: "Permanent deletion and cleanup",
      exact: true,
    })
    .waitFor();
  await admin.getByText(asset.id, { exact: false }).first().waitFor();
  await shot(admin, "copypaste-admin", "18-erasure-journal");
  await admin.evaluate(() => localStorage.setItem("cp_theme", "dark"));
  await admin.reload();
  await admin
    .getByRole("heading", {
      name: "Permanent deletion and cleanup",
      exact: true,
    })
    .waitFor();
  await shot(admin, "copypaste-admin", "19-erasure-dark");
  checks.push({
    name: "independent administrator MFA session sees durable cleanup journal within content management",
    status: "passed",
  });
  assert.deepEqual(errors, []);
} catch (e: any) {
  checks.push({
    name: "alignment browser regression",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/alignment.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        errors,
        dependency_mode: "simulated",
        browser_closed: true,
      },
      null,
      2,
    ),
  );
}
