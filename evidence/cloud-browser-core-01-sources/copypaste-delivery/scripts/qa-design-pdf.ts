import {
  chromium,
  _electron,
  type Browser,
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { emailCode } from "./qa-auth.js";
const exec = promisify(execFile),
  run = randomUUID(),
  desktop = path.resolve("../copypaste-desktop"),
  folder = path.resolve(".data/design-pdf", run);
const checks: any[] = [],
  errors: string[] = [];
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  app: ElectronApplication | undefined,
  browserClosed = false,
  desktopClosed = false,
  inspection: any;
const passed = (name: string) => checks.push({ name, status: "passed" });
async function request(
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
          "X-CSRF-Token": me.csrf_token ?? "",
          "Idempotency-Key": crypto.randomUUID(),
          ...(tenant ? { "X-Tenant-ID": tenant } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: await r.json() };
    },
    { url, method, body, tenant },
  );
}
async function call(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
  tenant?: string,
) {
  const r = await request(page, url, method, body, tenant);
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${method} ${url}: ${r.status} ${JSON.stringify(r.body)}`,
  );
  return r.body;
}
async function screenshot(page: Page, repo: string, filename: string) {
  const directory = path.resolve("..", repo, "assets/screenshots");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, filename),
    fullPage: false,
    animations: "disabled",
  });
}
try {
  await mkdir(folder, { recursive: true });
  assert.equal(
    (await (await fetch("http://localhost:4310/v1/public/config")).json())
      .data_mode,
    "simulated",
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    acceptDownloads: true,
  });
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4317/login");
  await page.getByLabel("Work email").fill(`pdf-${run}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour design studio");
  await page.locator('input[name="project_name"]').fill("Spring review");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const me = await call(page, "/v1/session/context"),
    tenant = me.memberships[0].id,
    project = (await call(page, `/v1/tenants/${tenant}/projects`)).items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await page.goto("http://localhost:4317/app/creative");
  await page.getByRole("button", { name: "New design", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Design name", { exact: true })
    .fill("Harbour brand review");
  await modal
    .getByLabel("Headline", { exact: true })
    .fill("春日新章 · Brand in bloom");
  const createdResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === base + "/creative",
  );
  await modal.getByRole("button", { name: "Save design", exact: true }).click();
  const design = await (await createdResponse).json();
  const card = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Harbour brand review",
      exact: true,
    }),
  });
  await card.waitFor();
  passed(
    "real email sign-in and onboarding create a persisted bilingual layered design through the Web form",
  );

  const renderPath = base + `/creative/${design.id}/render`,
    keys: string[] = [];
  let first = true,
    accepted: any;
  await page.route("**" + renderPath, async (route) => {
    if (route.request().postDataJSON().format !== "pdf")
      return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    if (!first) return route.continue();
    first = false;
    const r = await route.fetch();
    assert.equal(r.status(), 200);
    accepted = await r.json();
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "CONTROLLED_LOST_REPLY",
          message: "Controlled lost export reply; retry the same export.",
        },
      }),
    });
  });
  await card
    .getByRole("button", { name: "PDF review copy", exact: true })
    .click();
  await card
    .getByRole("alert")
    .filter({ hasText: "Controlled lost export reply" })
    .waitFor();
  await card
    .getByRole("button", { name: "PDF review copy", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Download export", exact: true })
    .waitFor();
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(
    (await call(page, base + "/assets")).items.filter(
      (a: any) => a.mime_type === "application/pdf",
    ).length,
    1,
  );
  await page.unroute("**" + renderPath);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByRole("button", { name: "Download export", exact: true }).click(),
  ]);
  const pdfFile = path.join(folder, "web-review.pdf");
  await download.saveAs(pdfFile);
  assert.ok(
    (await readFile(pdfFile)).subarray(0, 5).equals(Buffer.from("%PDF-")),
  );
  const versions = (await call(page, base + `/assets/${accepted.id}/versions`))
    .items;
  assert.equal(versions[0].mime_type, "application/pdf");
  assert.equal(versions[0].metadata.version, 1);
  assert.equal(versions[0].metadata.probe.editable_text, false);
  assert.deepEqual(versions[0].metadata.source, design.body);
  await screenshot(page, "copypaste-web", "49-design-pdf-export.png");
  passed(
    "a genuinely accepted but lost PDF reply retries with the same key, creates one asset and downloads real bytes with the exact source version",
  );

  const pngResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === renderPath &&
      r.request().postDataJSON().format === "png",
  );
  await card.getByRole("button", { name: "PNG", exact: true }).click();
  const png = await (await pngResponse).json();
  const reference = await context.request.get(
    "http://localhost:4317" + base + `/assets/${png.id}/download`,
  );
  assert.equal(reference.status(), 200);
  const referenceFile = path.join(folder, "reference.png"),
    rasterPrefix = path.join(folder, "pdf-review");
  await writeFile(referenceFile, await reference.body());
  await exec(
    process.env.PDFTOPPM_BIN ?? "pdftoppm",
    ["-r", "96", "-singlefile", "-png", pdfFile, rasterPrefix],
    { windowsHide: true, timeout: 30000, maxBuffer: 1000000 },
  );
  const inspected = await exec(
    process.env.PDF_QA_PYTHON ?? "python",
    [
      "scripts/inspect-design-pdf.py",
      pdfFile,
      rasterPrefix + ".png",
      referenceFile,
      "1080",
      "1350",
    ],
    { windowsHide: true, timeout: 30000, maxBuffer: 1000000 },
  );
  inspection = JSON.parse(inspected.stdout);
  await copyFile(
    rasterPrefix + ".png",
    path.resolve(
      "../copypaste-web/assets/screenshots/50-design-pdf-render.png",
    ),
  );
  passed(
    "independent pypdf parsing and native Poppler rendering verify one 810×1012.5-point page, its 1080×1350 raster, no active actions and close pixel agreement with the PNG export",
  );

  const changed = structuredClone(design.body);
  changed.layers.find(
    (l: any) => l.type === "text" && l.text.includes("Brand in bloom"),
  ).text = "Approved spring edition";
  await call(page, base + `/creative/${design.id}`, "PUT", {
    name: design.name,
    body: changed,
    version: 1,
  });
  await card
    .getByRole("button", { name: "PDF review copy", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Refresh design version", exact: true })
    .waitFor();
  assert.equal(
    (await call(page, base + "/assets")).items.filter(
      (a: any) => a.mime_type === "application/pdf",
    ).length,
    1,
  );
  await card
    .getByRole("button", { name: "Refresh design version", exact: true })
    .click();
  await card.getByText("1080 × 1350 · v2", { exact: true }).waitFor();
  await card
    .getByRole("button", { name: "PDF review copy", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Download export", exact: true })
    .waitFor();
  assert.deepEqual(
    (await call(page, base + `/assets/${accepted.id}/versions`)).items[0]
      .metadata.source,
    design.body,
  );
  passed(
    "a concurrent source edit refuses stale export without an asset, offers a version refresh and preserves the original review's source snapshot",
  );
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  await page.getByTitle("Theme: light / dark / system").click();
  await page.getByTitle("切換至繁體中文").click();
  await card.getByRole("button", { name: "PDF 審閱稿", exact: true }).waitFor();
  await screenshot(page, "copypaste-web", "51-design-pdf-mobile.png");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByTitle("Switch to English").click();
  passed(
    "PDF controls and the flattened-copy explanation fit four widths and both language/theme variants",
  );

  await page.goto("http://localhost:4317/app/roles");
  await page.locator('[data-template-role="designer"]').click();
  const templateModal = page.getByRole("dialog");
  await templateModal
    .getByLabel("Specialist name", { exact: true })
    .fill("Harbour visual designer");
  await templateModal
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await templateModal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .click();
  await page.waitForURL("**/app/specialists");
  await page
    .getByRole("heading", { name: "Harbour visual designer", exact: true })
    .waitFor();
  const directory = await call(
      page,
      "/v1/agent-templates?project_id=" + project,
      "GET",
      undefined,
      tenant,
    ),
    designer = directory.items.find((row: any) => row.role_key === "designer");
  assert.equal(designer.available, true);
  assert.equal(designer.qualification_state, "unverified");
  assert.equal(designer.data_mode, "simulated");
  passed(
    "the designer's real document tool allows the template flow while retaining unverified and simulated qualification labels",
  );

  const profile = path.join(folder, "desktop-profile");
  await mkdir(profile, { recursive: true });
  app = await _electron.launch({
    executablePath: path.join(
      desktop,
      "node_modules/electron/dist/electron.exe",
    ),
    args: [desktop],
    env: { ...process.env, COPYPASTE_USER_DATA: profile },
  });
  const native = await app.firstWindow({ timeout: 30000 });
  native.on("pageerror", (e) => errors.push(e.message));
  await native.waitForURL(/file:.*index\.html/);
  await native.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await native.reload();
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      (globalThis as any).__pdfAuthURL = url;
    };
  });
  await native
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  let authURL = "";
  for (let n = 0; n < 150 && !authURL; n++) {
    authURL = await app.evaluate(() => (globalThis as any).__pdfAuthURL ?? "");
    if (!authURL) await native.waitForTimeout(100);
  }
  assert.ok(authURL);
  const auth = await context.newPage();
  await auth.goto(authURL);
  await auth
    .getByRole("button", { name: /Connect.*|Allow.*|Authorize.*/ })
    .click();
  await native.waitForURL("**#/app");
  await auth.close();
  await native.evaluate(() => {
    location.hash = "/app/creative";
  });
  const nativeCard = native.locator("article").filter({
    has: native.getByRole("heading", { name: design.name, exact: true }),
  });
  await nativeCard
    .getByRole("button", { name: "PDF review copy", exact: true })
    .click();
  await nativeCard
    .getByRole("button", { name: "Download export", exact: true })
    .waitFor();
  const nativeFile = path.join(folder, "desktop-review.pdf");
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: target,
    })) as any;
  }, nativeFile);
  await nativeCard
    .getByRole("button", { name: "Download export", exact: true })
    .click();
  for (let n = 0; n < 150; n++) {
    if ((await stat(nativeFile).catch(() => null))?.size) break;
    await native.waitForTimeout(100);
  }
  const nativeBytes = await readFile(nativeFile);
  assert.equal(nativeBytes.subarray(0, 5).toString(), "%PDF-");
  const nativeAssets = await native.evaluate(
    async (base) =>
      (await (window as any).copyPasteBridge.request(base + "/assets", {})).body
        .items,
    base,
  );
  const nativePDF = nativeAssets
    .filter((a: any) => a.mime_type === "application/pdf")
    .sort(
      (a: any, b: any) => Date.parse(b.created_at) - Date.parse(a.created_at),
    )[0];
  const nativeVersion = (
    await call(page, base + `/assets/${nativePDF.id}/versions`)
  ).items[0];
  assert.equal(
    createHash("sha256").update(nativeBytes).digest("hex"),
    nativeVersion.sha256,
  );
  await screenshot(native, "copypaste-desktop", "14-design-pdf-export.png");
  passed(
    "the current native Electron source uses real PKCE and authenticated IPC to export the Web design and save a PDF whose SHA-256 matches the immutable server version",
  );
  assert.deepEqual(errors, []);
} catch (e: any) {
  checks.push({
    name: "PDF delivery regression",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  for (const [name, close] of [
    [
      "Electron",
      async () => {
        if (app) {
          await app.close();
          desktopClosed = true;
        }
      },
    ],
    [
      "browser context",
      async () => {
        if (context) await context.close();
      },
    ],
    [
      "browser",
      async () => {
        if (browser) {
          await browser.close();
          browserClosed = true;
        }
      },
    ],
  ] as const) {
    try {
      await close();
    } catch {
      errors.push(`Failed to close this run's ${name}`);
      checks.push({ name: "owned resource cleanup", status: "failed" });
    }
  }
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/design-pdf.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dependency_mode: "simulated",
        qualification_state: "unverified",
        checks,
        inspection,
        errors,
        browser_closed: browserClosed,
        desktop_closed: desktopClosed,
      },
      null,
      2,
    ) + "\n",
  );
  if (errors.length) throw new Error(errors.join("; "));
}
