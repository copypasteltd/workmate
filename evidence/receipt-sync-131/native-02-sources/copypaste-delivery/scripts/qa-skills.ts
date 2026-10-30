import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
import { emailCode } from "./qa-auth.js";
const checks: any[] = [],
  errors: string[] = [],
  samples: any[] = [];
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  closed = false;
async function call(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
  tenant?: string,
) {
  return page.evaluate(
    async ({ url, method, body, tenant }) => {
      const me = await (await fetch("/v1/session/context")).json();
      const r = await fetch(url, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          "X-CSRF-Token": me.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
          ...(tenant ? { "X-Tenant-ID": tenant } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(`${method} ${url} ${r.status} ${JSON.stringify(data)}`);
      return data;
    },
    { url, method, body, tenant },
  );
}
async function shot(page: Page, name: string) {
  const folder = path.resolve("../copypaste-web/assets/screenshots");
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
}
try {
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
    .fill(`methods-ui-${randomUUID()}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour methods studio");
  await page
    .locator('input[name="project_name"]')
    .fill("Reusable campaign methods");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const me = await call(page, "/v1/session/context"),
    tenant = me.memberships[0].id,
    project = (await call(page, `/v1/tenants/${tenant}/projects`)).items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  const agent = await call(page, base + "/agents", "POST", {
    name: "Studio developer",
    role_key: "fullstack",
  });
  const versions = await call(
      page,
      "/v1/skill-versions?project_id=" + project,
      "GET",
      undefined,
      tenant,
    ),
    installed = await call(
      page,
      "/v1/skill-installations?project_id=" + project,
      "GET",
      undefined,
      tenant,
    );
  samples.push(
    { schema: "SkillVersionList", response: versions },
    { schema: "SkillInstallationList", response: installed },
  );
  assert.equal(versions.items.length, 28);
  assert.equal(installed.items.length, 5);
  await page
    .getByRole("link", { name: "Project methods", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Project methods", exact: true })
    .waitFor();
  const version = installed.items[0].skill_version_id,
    card = page.locator(`[data-skill-version="${version}"]`);
  await card
    .getByRole("button", { name: "Inspect method", exact: true })
    .click();
  let modal = page.getByRole("dialog");
  await modal.getByText("SHA-256", { exact: false }).waitFor();
  assert.ok((await modal.locator("pre").last().innerText()).length > 200);
  await modal.getByRole("button", { name: /Close|關閉/ }).click();
  await modal.waitFor({ state: "hidden" });
  await card
    .getByRole("button", { name: "Disable for new work", exact: true })
    .click();
  await card.getByRole("button", { name: "Enable", exact: true }).waitFor();
  const changed = (
    await call(
      page,
      "/v1/skill-installations?project_id=" + project,
      "GET",
      undefined,
      tenant,
    )
  ).items.find(
    (i: any) => i.skill_version_id === version && i.state === "installed",
  );
  samples.push({ schema: "SkillInstallation", response: changed });
  assert.equal(changed.enabled, false);
  const unavailable = await call(
    page,
    `/v1/agents/${agent.id}/effective-capabilities`,
    "GET",
    undefined,
    tenant,
  );
  assert.equal(unavailable.tool_ids.length, 0);
  assert.equal(unavailable.missing_dependencies.length, 1);
  samples.push({ schema: "EffectiveCapabilities", response: unavailable });
  await card.getByRole("button", { name: "Enable", exact: true }).click();
  await card
    .getByRole("button", { name: "Disable for new work", exact: true })
    .waitFor();
  checks.push({
    name: "owner inspects exact packaged methods and manages ordinary disable/enable; effective capabilities reflect the current project installation",
    status: "passed",
  });
  await card.getByRole("button", { name: "Uninstall", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await card.getByRole("button", { name: "Install", exact: true }).click();
  await card
    .getByRole("button", { name: "Disable for new work", exact: true })
    .waitFor();
  const replacement = (
    await call(page, base + "/skill-installations")
  ).items.find(
    (i: any) => i.skill_version_id === version && i.state === "installed",
  );
  assert.notEqual(replacement.id, changed.id);
  await card
    .getByRole("button", { name: "Security revoke", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await card.getByText("Security revoked", { exact: true }).waitFor();
  assert.equal(
    await card
      .getByRole("button", { name: "Install", exact: true })
      .isDisabled(),
    true,
  );
  checks.push({
    name: "uninstall requires explicit acknowledgement; reinstall gets a new identity; security revocation is permanent and cannot be toggled back in the UI",
    status: "passed",
  });
  await shot(page, "25-project-methods");
  await page
    .getByLabel("Search methods", { exact: true })
    .fill("zz-no-such-method");
  await page
    .getByRole("heading", { name: "No methods found", exact: true })
    .waitFor();
  await page.getByLabel("Search methods", { exact: true }).fill("");
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `methods page overflow at ${width}`,
    );
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await shot(page, "26-project-methods-dark");
  await page.getByTitle("切換至繁體中文").click();
  await page.getByRole("heading", { name: "專案技能", exact: true }).waitFor();
  checks.push({
    name: "project methods page supports search/empty state, four widths, both themes and Traditional Chinese/English",
    status: "passed",
  });
  assert.deepEqual(errors, []);
} catch (e: any) {
  checks.push({
    name: "project method browser regression",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  if (context) await context.close();
  if (browser) {
    await browser.close();
    closed = true;
  }
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/skills.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dependency_mode: "simulated",
        checks,
        errors,
        browser_closed: closed,
      },
      null,
      2,
    ),
  );
  await writeFile(
    "evidence/skills-contract-samples.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin: "actual authenticated local browser HTTP responses",
        samples,
      },
      null,
      2,
    ),
  );
}
