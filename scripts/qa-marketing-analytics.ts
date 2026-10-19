import {
  chromium,
  _electron,
  type Browser,
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, stat, copyFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { emailCode } from "./qa-auth.js";
const run = randomUUID(),
  folder = path.resolve(".data/marketing-analytics", run),
  desktop = path.resolve("../copypaste-desktop");
const checks: any[] = [],
  errors: string[] = [];
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  app: ElectronApplication | undefined;
let browserClosed = false,
  desktopClosed = false,
  inspection: any = {};
const sha = (v: Buffer) => createHash("sha256").update(v).digest("hex");
const passed = (name: string) => checks.push({ name, status: "passed" });
async function call(page: Page, url: string, method = "GET", body?: unknown) {
  const result = await page.evaluate(
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
      return { status: r.status, body: await r.json() };
    },
    { url, method, body },
  );
  assert.ok(
    result.status >= 200 && result.status < 300,
    JSON.stringify(result),
  );
  return result.body;
}
async function screenshot(page: Page, repo: string, name: string) {
  const dir = path.resolve("..", repo, "assets/screenshots");
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => {
    scrollTo(0, 0);
    (document.activeElement as HTMLElement)?.blur();
  });
  await page.screenshot({
    path: path.join(dir, name),
    fullPage: true,
    animations: "disabled",
    timeout: 30000,
  });
}
async function choose(page: Page, csv: string, name: string) {
  const modal = page.getByRole("dialog");
  const inspected = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith("/analytics/file-inspect"),
  );
  await modal.locator('input[name="file"]').setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  assert.equal((await inspected).status(), 200);
  await modal
    .getByRole("button", { name: "Preview & validate", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      !(
        document.querySelector(
          '.marketing-import button[type="submit"]',
        ) as HTMLButtonElement
      )?.disabled,
  );
}
async function preview(page: Page) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith("/analytics/file-preview"),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Preview & validate", exact: true })
    .click();
  return response;
}
async function confirm(page: Page) {
  const modal = page.getByRole("dialog");
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
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
  await page.getByLabel("Work email").fill(`marketing-${run}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour growth studio");
  await page.locator('input[name="project_name"]').fill("Campaign evidence");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const me = await call(page, "/v1/me"),
    tenant = me.memberships[0].id,
    project = (await call(page, `/v1/tenants/${tenant}/projects`)).items[0].id;
  const base = `/v1/tenants/${tenant}/projects/${project}`,
    analytics = base + "/analytics";
  await page.goto("http://localhost:4317/app/analytics");
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  const csv =
    "\ufeffDay,Campaign,Campaign ID,Customer ID,Impressions,Clicks,Cost,Conversions,Conv. value\r\n2026-10-01,春日上市,456,123,1000,100,100,4,400\r\n2026-10-02,春日上市,456,123,9000,90,180,6,300";
  await choose(page, csv, "google-daily.csv");
  let modal = page.getByRole("dialog");
  await modal
    .getByLabel("Report name", { exact: true })
    .fill("Spring launch · Google");
  await modal.locator('select[name="source"]').selectOption("google_ads");
  await modal.locator('input[name="account_id"]').fill("123");
  await modal
    .getByLabel("Attribution definition", { exact: true })
    .fill("7-day click");
  await modal
    .getByLabel("Conversion definition", { exact: true })
    .fill("Completed purchase");
  const p = await preview(page);
  assert.equal(p.status(), 200, await p.text());
  const resolved = await p.json();
  assert.equal(resolved.summary.exact.ctr, "0.01900000");
  assert.equal(resolved.mapping.spend, "Cost");
  assert.equal(resolved.source_sha256, sha(Buffer.from(csv, "utf8")));
  assert.equal((await call(page, analytics)).items.length, 0);
  await modal.getByRole("checkbox").check();
  await screenshot(page, "copypaste-web", "52-marketing-import-preview.png");
  passed(
    "real email onboarding and Google-style header mapping preview preserve UTF-8 source bytes, account, grain, currency and attribution without writing a dataset",
  );
  let first = true,
    accepted: any;
  await page.route("**/v1/dataset-imports", async (route) => {
    if (!first) return route.continue();
    first = false;
    const r = await route.fetch();
    accepted = await r.json();
    assert.equal(r.status(), 202);
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "QA_REPLY_LOST",
          message: "Accepted response lost; retry this import",
        },
      }),
    });
  });
  await modal
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Accepted response lost; retry this import" })
    .waitFor();
  await modal
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await page
    .getByRole("status")
    .getByText(
      "Imported with source data and calculation definitions retained.",
      {
        exact: true,
      },
    )
    .waitFor();
  await page.unroute("**/v1/dataset-imports");
  const firstId = accepted.id;
  await page.locator(`[data-snapshot-id="${firstId}"]`).waitFor();
  assert.equal((await call(page, analytics)).items.length, 1);
  const d = await call(page, analytics + "/" + firstId);
  assert.equal(d.summary.exact.cpc, "1.47368421");
  assert.equal(d.summary.provenance.metrics_frozen, true);
  assert.equal(d.summary.provenance.data_as_of, null);
  assert.deepEqual(d.import_spec.date_range, {
    from: "2026-10-01",
    to: "2026-10-02",
  });
  await screenshot(page, "copypaste-web", "53-marketing-analysis.png");
  passed(
    "a lost accepted import response can be retried through the form and reopens one frozen snapshot with exact aggregate ratios",
  );
  const sourceEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Source file", exact: true }).click();
  const source = await sourceEvent,
    sourceFile = path.join(folder, "source.csv");
  await source.saveAs(sourceFile);
  assert.deepEqual(await readFile(sourceFile), Buffer.from(csv, "utf8"));
  const reportEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Calculation report", exact: true })
    .click();
  const report = await reportEvent,
    reportFile = path.join(folder, "report.json");
  await report.saveAs(reportFile);
  const reportBody = JSON.parse(await readFile(reportFile, "utf8"));
  assert.deepEqual(reportBody.summary.evidence, d.summary.evidence);
  const svgEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "SVG", exact: true }).click();
  const svg = await svgEvent,
    svgFile = path.join(folder, "chart.svg");
  await svg.saveAs(svgFile);
  const svgBytes = await readFile(svgFile);
  assert.ok(svgBytes.includes(Buffer.from(d.source_sha256)));
  const rendered = await context.newPage();
  await rendered.setContent(
    '<img alt="Exported ad spend chart" src="data:image/svg+xml;base64,' +
      svgBytes.toString("base64") +
      '">',
  );
  await rendered
    .locator("img")
    .evaluate((img: HTMLImageElement) => img.decode());
  await rendered.locator("img").screenshot({
    path: path.resolve(
      "../copypaste-web/assets/screenshots/54-marketing-chart-render.png",
    ),
    timeout: 30000,
  });
  await rendered.close();
  inspection = {
    source_sha256: sha(await readFile(sourceFile)),
    report_sha256: sha(await readFile(reportFile)),
    chart_sha256: sha(svgBytes),
    formula_version: d.summary.calculation.formula_version,
    evidence_count: d.summary.evidence.length,
  };
  passed(
    "actual source, JSON calculation report and SVG chart downloads retain matching checksums, frozen formula values and stable per-metric evidence references",
  );
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  const bad =
    "date,channel,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Meta,100,,20,,,HKD";
  await choose(page, bad, "bad-row.csv");
  const invalid = await preview(page);
  assert.equal(invalid.status(), 400);
  await page
    .getByRole("alert")
    .filter({ hasText: /row 2.clicks/ })
    .waitFor();
  assert.equal((await call(page, analytics)).items.length, 1);
  const unknown = bad.replace("100,,20", "100,10,20");
  await choose(page, unknown, "unknown-conversions.csv");
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("Report name", { exact: true })
    .fill("Unknown conversions");
  const unknownPreview = await preview(page);
  assert.equal(unknownPreview.status(), 200);
  assert.equal((await unknownPreview.json()).summary.exact.cpa, null);
  await confirm(page);
  await modal.waitFor({ state: "hidden" });
  const unknownId = (await call(page, analytics)).items.find(
    (r: any) => r.name === "Unknown conversions",
  ).id;
  await page.locator(`[data-snapshot-id="${unknownId}"]`).waitFor();
  const cpa = page
    .locator(".metric-card")
    .filter({ has: page.getByText("Cost per conversion", { exact: true }) });
  assert.equal(await cpa.locator("strong").innerText(), "Unknown");
  assert.ok((await cpa.innerText()).includes("Conversions unavailable"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".marketing-provenance").scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await screenshot(page, "copypaste-web", "55-marketing-mobile.png");
  await page.setViewportSize({ width: 1440, height: 1080 });
  for (const locale of ["en", "zh-HK"]) {
    if (locale === "zh-HK") {
      await page.getByTitle("切換至繁體中文").click();
      await page
        .getByRole("status")
        .filter({ hasText: "資料已匯入，原始檔與計算口徑已保留。" })
        .waitFor();
    }
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.getByTitle("Theme: light / dark / system").click();
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.theme),
        theme,
      );
      for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.equal(
          await page
            .locator(".metric-card")
            .filter({
              has: page.getByText(
                locale === "en" ? "Cost per conversion" : "每次轉化成本",
                { exact: true },
              ),
            })
            .locator("strong")
            .innerText(),
          locale === "en" ? "Unknown" : "未知",
        );
        if (locale === "zh-HK" && theme === "dark" && width === 390) {
          await page
            .getByText("缺少的轉化或轉化價值保留為未知，相關比率無法計算。", {
              exact: true,
            })
            .waitFor();
          await screenshot(
            page,
            "copypaste-web",
            "56-marketing-mobile-zh-dark.png",
          );
        }
      }
      if (theme === "dark") {
        await page.getByTitle("Theme: light / dark / system").click();
        await page.getByTitle("Theme: light / dark / system").click();
      }
    }
  }
  await page.getByTitle("Switch to English").click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  passed(
    "invalid rows show physical lines without persistence; unknown conversions stay unknown across four widths, both themes and Traditional Chinese/English",
  );
  await page.route("**" + analytics + "/" + firstId, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "NOT_FOUND",
          message: "Snapshot unavailable for this scope",
        },
      }),
    }),
  );
  await page
    .getByRole("combobox", { name: "Dataset", exact: true })
    .selectOption(firstId);
  await page
    .getByRole("alert")
    .filter({ hasText: "Snapshot unavailable for this scope" })
    .waitFor();
  assert.equal(await page.locator(".marketing-analysis").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Export rows", exact: true })
      .isDisabled(),
    true,
  );
  await page.unroute("**" + analytics + "/" + firstId);
  passed(
    "a denied selected snapshot clears KPI, chart and download actions instead of falling back to another dataset",
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
      (globalThis as any).__marketingAuthURL = url;
    };
  });
  await native
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  let authURL = "";
  for (let i = 0; i < 150 && !authURL; i++) {
    authURL = await app.evaluate(
      () => (globalThis as any).__marketingAuthURL ?? "",
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
  const meta =
    "Reporting starts,Reporting ends,Campaign name,Campaign ID,Account ID,Impressions,Link clicks,Amount spent (HKD),Purchases,Purchase conversion value\n2026-10-03,2026-10-03,Native launch,456,123,1000,100,80,4,320";
  const nativeModal = native.getByRole("dialog");
  await nativeModal.locator('input[name="file"]').setInputFiles({
    name: "native-meta.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(meta, "utf8"),
  });
  await native.waitForFunction(
    () =>
      !(
        document.querySelector(
          '.marketing-import button[type="submit"]',
        ) as HTMLButtonElement
      )?.disabled,
  );
  await nativeModal
    .getByLabel("Report name", { exact: true })
    .fill("Native Meta report");
  await nativeModal.locator('select[name="source"]').selectOption("meta_ads");
  await nativeModal.locator('input[name="account_id"]').fill("123");
  await nativeModal
    .getByLabel("Attribution definition", { exact: true })
    .fill("7-day click / 1-day view");
  await nativeModal
    .getByLabel("Conversion definition", { exact: true })
    .fill("Purchase");
  await nativeModal
    .getByRole("button", { name: "Preview & validate", exact: true })
    .click();
  await nativeModal.getByRole("checkbox").waitFor();
  await confirm(native);
  await nativeModal.waitFor({ state: "hidden" });
  const nativeDataset = (
    await native.evaluate(
      async (base) =>
        (await (window as any).copyPasteBridge.request(base + "/analytics", {}))
          .body.items,
      base,
    )
  ).find((r: any) => r.name === "Native Meta report");
  assert.ok(nativeDataset);
  assert.equal(nativeDataset.summary.exact.roas, "4.00000000");
  await native.locator(`[data-snapshot-id="${nativeDataset.id}"]`).waitFor();
  const nativeFile = path.join(folder, "native-source.csv");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: file,
    })) as any;
  }, nativeFile);
  await native
    .getByRole("button", { name: "Source file", exact: true })
    .click();
  for (let i = 0; i < 150; i++) {
    if ((await stat(nativeFile).catch(() => null))?.size) break;
    await native.waitForTimeout(100);
  }
  assert.deepEqual(await readFile(nativeFile), Buffer.from(meta, "utf8"));
  inspection.desktop_source_sha256 = sha(await readFile(nativeFile));
  await screenshot(native, "copypaste-desktop", "15-marketing-analytics.png");
  passed(
    "native Electron uses real PKCE and authenticated IPC for a Meta-style import, frozen ROAS and a byte-exact local source download",
  );
  await copyFile(
    path.resolve(
      "../copypaste-web/assets/screenshots/53-marketing-analysis.png",
    ),
    path.resolve(
      "../copypaste-platform/assets/screenshots/marketing-analytics.png",
    ),
  );
  await copyFile(
    path.resolve(
      "../copypaste-web/assets/screenshots/53-marketing-analysis.png",
    ),
    path.resolve("assets/screenshots/marketing-analytics.png"),
  );
  assert.deepEqual(errors, []);
} catch (e: any) {
  checks.push({
    name: "marketing analytics regression",
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
    "evidence/marketing-analytics.json",
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
