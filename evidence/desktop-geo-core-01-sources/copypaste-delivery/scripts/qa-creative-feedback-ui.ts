import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { exerciseCreativeFeedback } from "./creative-feedback-ui.js";
const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const checks: string[] = [],
  errors: string[] = [],
  screenshots: any[] = [],
  media: any[] = [];
let isolated: any,
  system: any,
  browser: Browser | undefined,
  browserClosed = false,
  apiClosed = false,
  fixtureClosed = false;
const pass = (s: string) => {
  checks.push(s);
  console.log("PASS: " + s);
};
async function signIn(
  page: Page,
  address: string,
  admin = false,
  secret?: any,
) {
  const prefix = admin ? "/v1/admin/auth" : "/v1/auth",
    origin = admin ? "http://localhost:4318" : "http://localhost:4317";
  await page.goto(origin + (admin ? "" : "/login"));
  await page.locator('input[name="email"]').fill(address);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
        prefix + (admin ? "/challenge" : "/challenges"),
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(response.status(), admin ? 200 : 202);
  const ch = await response.json(),
    mail = JSON.parse(
      await readFile(
        path.join(isolated.directory, "mailbox", ch.challenge_id + ".json"),
        "utf8",
      ),
    );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  if (admin) await page.locator('input[name="totp"]').fill(secret.generate());
  const [verified] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          prefix + (admin ? "/verify" : "/sessions") &&
        r.request().method() === "POST",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(verified.status(), admin ? 200 : 201, await verified.text());
}

const deadline = setTimeout(() => {
  errors.push("Owned creative feedback UI deadline exceeded");
  void browser?.close();
}, 240000);
try {
  const load = async (file: string) =>
    import(pathToFileURL(path.join(platform, file)).href);
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
    viewport: { width: 1360, height: 1000 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, `creative-feedback-ui-${randomUUID()}@example.invalid`);
  const created = await page.evaluate(async () => {
    const session = await (await fetch("/v1/session/context")).json();
    const response = await fetch("/v1/tenants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf_token,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        name: "Actual creative feedback UI fixture",
        project_name: "Isolated creative feedback",
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  await page.evaluate((w) => {
    localStorage.setItem("cp_tenant", w.tenant.id);
    localStorage.setItem("cp_project", w.project.id);
  }, created.body);
  media.push(
    await exerciseCreativeFeedback({
      page,
      system,
      repo: "web",
      delivery,
      attempt,
      pass,
      screenshots,
      resize: async (width, height) => page.setViewportSize({ width, height }),
    }),
  );
} catch (e) {
  errors.push(String(e));
  console.error(e);
} finally {
  clearTimeout(deadline);
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
      !errors.length && browserClosed && apiClosed && fixtureClosed
        ? "passed"
        : "failed",
    checks,
    errors,
    screenshots,
    media,
    browser_closed: browserClosed,
    api_closed: apiClosed,
    fixture_closed: fixtureClosed,
    route_inventory: system ? { contract: "actual_fastify_route_inventory", not_full_design_openapi: true, data_mode: "configured_services", routes: [...system.routes].sort((a: any, b: any) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)) } : null,
    not_validated: [
      "Live provider creative identity verification",
      "Causal attribution and complete original TC acceptance",
      "Full product acceptance",
    ],
  };
  await writeFile(
    `evidence/creative-feedback-ui-${attempt}-journey.json`,
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  assert.equal(result.status, "passed", JSON.stringify(errors));
}
