import {
  chromium,
  _electron,
  type Browser,
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from "playwright";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat, copyFile } from "node:fs/promises";
import path from "node:path";
import { emailCode } from "./qa-auth.js";
import { campaignWorkbook } from "./qa-campaign-workbook.js";
const run = randomUUID(),
  folder = path.resolve(".data/file-imports", run),
  desktop = path.resolve("../copypaste-desktop"),
  checks: any[] = [],
  samples: any[] = [],
  errors: string[] = [];
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  app: ElectronApplication | undefined,
  browserClosed = false,
  desktopClosed = false,
  inspection: any = {};
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
  passed = (name: string) => checks.push({ name, status: "passed" });
async function call(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
  tenant?: string,
) {
  const r = await page.evaluate(
    async ({ url, method, body, tenant }) => {
      const me = await (await fetch("/v1/me")).json();
      const response = await fetch(url, {
        method,
        headers: {
          "X-CSRF-Token": me.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
          ...(tenant ? { "X-Tenant-ID": tenant } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { url, method, body, tenant },
  );
  assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r));
  return r.body;
}
async function screen(page: Page, repo: string, name: string) {
  await mkdir(path.resolve("..", repo, "assets/screenshots"), {
    recursive: true,
  });
  const viewportOnly = /^(61-|63-|17-)/.test(name);
  if (viewportOnly) {
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      window.scrollTo(0, 0);
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog instanceof HTMLElement) {
        dialog.scrollTop = 0;
        const backdrop = dialog.closest(".modal-backdrop");
        if (backdrop instanceof HTMLElement) backdrop.scrollTop = 0;
      }
    });
  }
  await page.screenshot({
    path: path.resolve("..", repo, "assets/screenshots", name),
    fullPage: !viewportOnly,
    animations: "disabled",
  });
}
async function idle(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelector(".marketing-import")?.getAttribute("aria-busy") ===
      "false",
  );
}
async function file(page: Page, bytes: Buffer, name: string) {
  await page.getByRole("dialog").locator('input[name="file"]').setInputFiles({
    name,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: bytes,
  });
  await idle(page);
  await page.getByRole("dialog").locator('select[name="sheet_name"]').waitFor();
}
async function table(page: Page) {
  const modal = page.getByRole("dialog");
  await modal.locator('input[name="header_row"]').fill("3");
  await modal
    .getByRole("button", { name: "Apply header row", exact: true })
    .click();
  await idle(page);
  await modal
    .locator('select[name="sheet_name"]')
    .selectOption("Campaign facts");
  await idle(page);
  await page.waitForFunction(
    () =>
      !(
        document.querySelector(
          '.marketing-import button[type="submit"]',
        ) as HTMLButtonElement
      )?.disabled,
  );
}
async function definitions(page: Page, name: string, source = "google_ads") {
  const modal = page.getByRole("dialog");
  await modal.locator('input[name="name"]').fill(name);
  await modal.locator('select[name="source"]').selectOption(source);
  await modal.locator('input[name="account_id"]').fill("123");
  await modal
    .locator('input[name="attribution_definition"]')
    .fill("7-day click");
  await modal.locator('input[name="conversion_definition"]').fill("Purchase");
}
async function preview(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Preview & validate", exact: true })
    .click();
  await page.getByRole("dialog").getByRole("checkbox").waitFor();
}
async function confirm(page: Page) {
  const modal = page.getByRole("dialog");
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  try {
    await modal.waitFor({ state: "hidden" });
  } catch (e) {
    throw new Error(
      "Import confirmation did not finish: " +
        (await page.getByRole("alert").allTextContents()).join("; "),
      { cause: e },
    );
  }
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
  context.setDefaultTimeout(20000);
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4317/login");
  await page.getByLabel("Work email").fill(`files-${run}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour file studio");
  await page
    .locator('input[name="project_name"]')
    .fill("Frozen campaign files");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const me = await call(page, "/v1/me"),
    tenant = me.memberships[0].id,
    project = (await call(page, `/v1/tenants/${tenant}/projects`)).items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`,
    analytics = base + "/analytics";
  await page.goto("http://localhost:4317/app/analytics");
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  const original = campaignWorkbook();
  let completionCount = 0,
    firstUpload = true;
  const allocationKeys: string[] = [];
  await page.route("**/uploads", async (route) => {
    if (route.request().method() === "POST")
      allocationKeys.push(route.request().headers()["idempotency-key"]);
    await route.continue();
  });
  await page.route("**/uploads/*/complete", async (route) => {
    completionCount++;
    if (!firstUpload) return route.continue();
    firstUpload = false;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "QA_UPLOAD_REPLY_LOST",
          message: "Upload accepted; retry the same file",
        },
      }),
    });
  });
  await page.getByRole("dialog").locator('input[name="file"]').setInputFiles({
    name: "google-workbook.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: original,
  });
  await page
    .getByRole("alert")
    .filter({ hasText: "Upload accepted; retry the same file" })
    .waitFor();
  await page
    .getByRole("button", { name: "Retry file upload", exact: true })
    .click();
  await idle(page);
  assert.equal(allocationKeys.length, 1);
  assert.equal(completionCount, 2);
  await page.unroute("**/uploads");
  await page.unroute("**/uploads/*/complete");
  const assets = (await call(page, base + "/assets")).items;
  assert.equal(
    assets.filter((a: any) => a.name === "google-workbook.xlsx").length,
    1,
  );
  assert.equal(
    await page
      .getByRole("dialog")
      .locator('select[name="sheet_name"]')
      .inputValue(),
    "",
  );
  await table(page);
  await definitions(page, "Google workbook");
  const previewResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith("/analytics/file-preview"),
  );
  await preview(page);
  const p = await (await previewResponse).json();
  assert.equal(p.summary.exact.spend, "100.12500000");
  assert.equal(p.sample[0].campaign, "Harbour launch · 香港");
  assert.equal(p.source_sha256, sha(original));
  assert.equal((await call(page, analytics)).items.length, 0);
  const capture = async () => {
    const response = await page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith("/v1/dataset-imports"),
    );
    assert.equal(response.status(), 202, await response.text());
    const result = await response.json();
    samples.push(
      {
        schema: "ImportCreate",
        response: response.request().postDataJSON(),
        kind: "actual HTTP request",
      },
      { schema: "Snapshot", response: result, kind: "actual HTTP response" },
    );
    return result;
  };
  const accepted = capture();
  await confirm(page);
  const first = await accepted;
  await page.locator(`[data-snapshot-id="${first.id}"]`).waitFor();
  const detail = await call(page, analytics + "/" + first.id);
  assert.ok(detail.source_asset_version_id);
  assert.equal(detail.import_spec.file.header_row, 3);
  assert.equal(detail.import_spec.file.worksheet, "Campaign facts");
  assert.equal(detail.summary.exact.roas, "4.49438202");
  const snapshot = await call(
    page,
    "/v1/snapshots/" + first.id,
    "GET",
    undefined,
    tenant,
  );
  samples.push({ schema: "Snapshot", response: snapshot });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Source file", exact: true }).click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), "campaign-source.xlsx");
  const originalPath = path.join(folder, "original.xlsx");
  await download.saveAs(originalPath);
  assert.deepEqual(await readFile(originalPath), original);
  passed(
    "real mailbox onboarding, resumable XLSX completion replay, one source asset, explicit sheet/header selection, decoded Unicode labels, frozen exact metrics, canonical ImportCreate/Snapshot payloads and byte-identical XLSX download",
  );
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  const corrected = campaignWorkbook("200");
  await file(page, corrected, "google-correction.xlsx");
  await table(page);
  await definitions(page, "Corrected Google workbook");
  await page
    .getByRole("dialog")
    .locator('select[name="supersedes_id"]')
    .selectOption(first.id);
  await preview(page);
  await screen(page, "copypaste-web", "61-xlsx-correction-preview.png");
  const correctedAccepted = capture();
  await confirm(page);
  const second = await correctedAccepted;
  await page.locator(`[data-snapshot-id="${second.id}"]`).waitFor();
  const newDetail = await call(page, analytics + "/" + second.id);
  assert.equal(newDetail.supersedes_id, first.id);
  assert.deepEqual(newDetail.correction_ancestors, [first.id]);
  assert.equal(newDetail.summary.exact.spend, "200.00000000");
  assert.equal(
    (await call(page, analytics + "/" + first.id)).summary.exact.spend,
    "100.12500000",
  );
  await screen(page, "copypaste-web", "62-xlsx-source-and-lineage.png");
  passed(
    "an explicit correction creates new immutable metrics and lineage while the earlier snapshot retains its original values",
  );
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await file(page, campaignWorkbook("2", true), "formula.xlsx");
  const modal = page.getByRole("dialog");
  await modal.locator('input[name="header_row"]').fill("3");
  await modal
    .getByRole("button", { name: "Apply header row", exact: true })
    .click();
  await idle(page);
  await modal
    .locator('select[name="sheet_name"]')
    .selectOption("Campaign facts");
  await idle(page);
  await page
    .getByRole("alert")
    .filter({ hasText: "Campaign facts!F7" })
    .waitFor();
  assert.equal(await modal.locator('button[type="submit"]').isDisabled(), true);
  assert.equal((await call(page, analytics)).items.length, 2);
  await modal.getByRole("button", { name: /Close|關閉/ }).click();
  for (const locale of ["en", "zh-HK"]) {
    if (locale === "zh-HK") await page.getByTitle("切換至繁體中文").click();
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.getByTitle("Theme: light / dark / system").click();
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.theme),
        theme,
      );
      await page
        .getByRole("button", {
          name: locale === "en" ? "Import data" : "匯入數據",
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog");
      await page
        .getByLabel(locale === "en" ? "CSV / XLSX file" : "CSV／XLSX 檔案", {
          exact: true,
        })
        .waitFor();
      await file(page, campaignWorkbook(), "layout.xlsx");
      for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const box = await dialog.boundingBox();
        assert.ok(box && box.width <= width);
        if (locale === "zh-HK" && theme === "dark" && width === 390)
          await screen(page, "copypaste-web", "63-xlsx-mobile-zh-dark.png");
      }
      await dialog.getByRole("button", { name: /Close|關閉/ }).click();
      if (theme === "dark") {
        await page.getByTitle("Theme: light / dark / system").click();
        await page.getByTitle("Theme: light / dark / system").click();
      }
    }
  }
  await page.getByTitle("Switch to English").click();
  passed(
    "formula exports show the original worksheet cell and cannot be confirmed; import dialog fits four widths and both themes and actual Traditional Chinese and English (16 combinations)",
  );
  await page.setViewportSize({ width: 1440, height: 1080 });
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
      (globalThis as any).__fileImportAuth = url;
    };
  });
  await native
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  let authURL = "";
  for (let i = 0; i < 150 && !authURL; i++) {
    authURL = await app.evaluate(
      () => (globalThis as any).__fileImportAuth ?? "",
    );
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
    location.hash = "/app/analytics";
  });
  await native
    .getByRole("button", { name: "Import data", exact: true })
    .click();
  const meta = campaignWorkbook("80");
  await file(native, meta, "native-meta.xlsx");
  await table(native);
  await definitions(native, "Native Meta workbook", "meta_ads");
  await preview(native);
  await confirm(native);
  const nativeDataset = (
    await native.evaluate(
      async (base) =>
        (await (window as any).copyPasteBridge.request(base + "/analytics", {}))
          .body.items,
      base,
    )
  ).find((d: any) => d.name === "Native Meta workbook");
  assert.ok(nativeDataset);
  assert.equal(nativeDataset.source, "meta_ads");
  assert.equal(nativeDataset.summary.exact.roas, "5.62500000");
  await native.locator(`[data-snapshot-id="${nativeDataset.id}"]`).waitFor();
  const nativePath = path.join(folder, "native-source.xlsx");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: file,
    })) as any;
  }, nativePath);
  await native
    .getByRole("button", { name: "Source file", exact: true })
    .click();
  for (let i = 0; i < 150; i++) {
    if ((await stat(nativePath).catch(() => null))?.size) break;
    await native.waitForTimeout(100);
  }
  assert.deepEqual(await readFile(nativePath), meta);
  await screen(native, "copypaste-desktop", "17-xlsx-import.png");
  passed(
    "source Electron performs real browser PKCE, shared upload parts and canonical Meta XLSX import through authenticated IPC, then saves the original bytes locally",
  );
  inspection = {
    source_sha256: sha(original),
    correction_sha256: sha(corrected),
    desktop_source_sha256: sha(meta),
    first_snapshot_id: first.id,
    correction_snapshot_id: second.id,
    allocation_requests: allocationKeys.length,
    completion_requests: completionCount,
    canonical_samples: samples.length,
  };
  assert.deepEqual(errors, []);
  await copyFile(
    path.resolve(
      "../copypaste-web/assets/screenshots/62-xlsx-source-and-lineage.png",
    ),
    path.resolve("assets/screenshots/file-imports.png"),
  );
} catch (e: any) {
  checks.push({
    name: "file import journey",
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
        await context?.close();
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
      errors.push("Failed to close owned " + name);
    }
  }
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/file-imports.json",
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
  if (checks.every((c) => c.status === "passed") && !errors.length)
    await writeFile(
      "evidence/file-imports-contract-samples.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          origin:
            "actual authenticated local HTTP requests and responses; real uploaded XLSX and simulated AI dependency",
          samples,
        },
        null,
        2,
      ) + "\n",
    );
}
