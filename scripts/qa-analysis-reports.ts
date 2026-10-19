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
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { emailCode } from "./qa-auth.js";
const run = randomUUID(),
  folder = path.resolve(".data/analysis-reports", run),
  desktop = path.resolve("../copypaste-desktop");
const checks: any[] = [],
  errors: string[] = [],
  samples: any[] = [];
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  app: ElectronApplication | undefined,
  browserClosed = false,
  desktopClosed = false,
  inspection: any = {};
const passed = (name: string) => checks.push({ name, status: "passed" });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
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
async function screenshot(
  page: Page,
  repo: string,
  name: string,
  viewportOnly = false,
) {
  const dir = path.resolve("..", repo, "assets/screenshots");
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, name),
    fullPage: !viewportOnly,
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
  context.setDefaultTimeout(20000);
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4317/login");
  await page.getByLabel("Work email").fill(`reports-${run}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour campaign studio");
  await page.locator('input[name="project_name"]').fill("Source to decision");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const me = await call(page, "/v1/me"),
    tenant = me.memberships[0].id,
    project = (await call(page, `/v1/tenants/${tenant}/projects`)).items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await call(page, `/v1/tenants/${tenant}/demo-credit`, "POST", {});
  const datasets: any[] = [];
  for (const [source, currency, current, previous] of [
    ["google_ads", "HKD", "100", "80"],
    ["google_ads", "USD", "30", "20"],
    ["meta_ads", "HKD", "50", "0"],
  ]) {
    datasets.push(
      await call(page, base + "/analytics/import", "POST", {
        name: `${source} ${currency} campaign`,
        source,
        currency,
        account_id: "account-a",
        entity_level: "campaign",
        attribution_definition: "7d click",
        conversion_definition: "Purchase",
        csv: `date,channel,campaign,entity_id,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,${source},Launch,campaign-a,1000,100,${current},4,400,${currency}\n2026-09-01,${source},Launch,campaign-a,1000,100,${previous},2,200,${currency}`,
      }),
    );
  }
  await page.goto("http://localhost:4317/app/analytics");
  await page
    .getByRole("button", { name: "Create analysis report", exact: true })
    .click();
  let modal = page.getByRole("dialog");
  await modal
    .getByLabel("Business question", { exact: true })
    .fill("Compare campaign performance and propose the next test.");
  const sourceChecks = modal
    .getByRole("group", { name: "Source snapshots (up to ten)" })
    .getByRole("checkbox");
  for (let i = 0; i < 3; i++) await sourceChecks.nth(i).check();
  await modal.getByLabel("Start date", { exact: true }).fill("2026-10-01");
  await modal.getByLabel("End date", { exact: true }).fill("2026-10-02");
  await modal.getByLabel("Add comparison period", { exact: true }).check();
  await modal
    .getByLabel("Comparison start", { exact: true })
    .fill("2026-09-01");
  await modal.getByLabel("Comparison end", { exact: true }).fill("2026-09-02");
  const previewResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && r.url().endsWith("/analysis/preview"),
  );
  await modal
    .getByRole("button", { name: "Preview report scope", exact: true })
    .click();
  const preview = await (await previewResponse).json();
  assert.equal(preview.coverage.groups, 3);
  assert.equal((await call(page, base + "/tasks")).items.length, 0);
  assert.equal(
    (await call(page, `/v1/tenants/${tenant}/billing`)).wallet.reserved_micros,
    "0",
  );
  await modal
    .getByLabel("I confirm the sources, dates and maximum budget.", {
      exact: true,
    })
    .check();
  await screenshot(
    page,
    "copypaste-web",
    "57-analysis-report-preview.png",
    true,
  );
  passed(
    "real onboarding and multi-source preview separate currencies and platforms, confirm comparison dates and create no task or model reservation",
  );
  let first = true,
    accepted: any;
  await page.route("**/v1/reports", async (route) => {
    if (!first || route.request().method() !== "POST") return route.continue();
    first = false;
    const r = await route.fetch();
    accepted = await r.json();
    samples.push({
      schema: "Report",
      method: "POST",
      path: "/v1/reports",
      status: r.status(),
      response: accepted,
    });
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "QA_LOST_RECEIPT",
          message: "Reply was lost; retry the same request.",
        },
      }),
    });
  });
  await modal
    .getByRole("button", { name: "Confirm & create report", exact: true })
    .click();
  await modal
    .getByRole("alert")
    .filter({ hasText: "Reply was lost" })
    .waitFor();
  assert.equal(accepted.state, "queued");
  await modal
    .getByRole("button", { name: "Confirm & create report", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await page.unroute("**/v1/reports");
  const result = page.locator(`[data-analysis-report="${accepted.id}"]`);
  await result.waitFor();
  await page.waitForFunction(
    (id) => {
      const b = document.querySelector(
        `[data-analysis-report="${id}"] .row-actions button`,
      ) as HTMLButtonElement;
      const failed =
        document.querySelector(`[data-analysis-report="${id}"] .status`)
          ?.textContent === "Failed";
      return (b && !b.disabled) || failed;
    },
    accepted.id,
    { timeout: 60000 },
  );
  const ready = await call(
    page,
    "/v1/reports/" + accepted.id,
    "GET",
    undefined,
    tenant,
  );
  assert.equal(ready.state, "ready");
  assert.equal((await call(page, base + "/analysis/reports")).items.length, 1);
  assert.equal((await call(page, base + "/tasks")).items.length, 1);
  samples.push({
    schema: "Report",
    method: "GET",
    path: "/v1/reports/{report_id}",
    status: 200,
    response: ready,
  });
  passed(
    "a lost accepted response retries into one private Codex task and persisted report, then the UI polls through to a checked ready artifact",
  );
  const detail = await call(page, base + "/analysis/reports/" + ready.id);
  assert.equal(detail.validation.state, "passed");
  assert.equal(detail.calculation.groups.length, 3);
  const newChange = detail.calculation.evidence.find(
    (e: any) => e.metric_id === "spend.change" && e.null_reason === "new_value",
  );
  assert.ok(newChange);
  assert.equal(newChange.value, null);
  await result.locator(".report-evidence-link").first().click();
  modal = page.getByRole("dialog");
  await modal
    .getByRole("heading", { name: "Evidence reference", exact: true })
    .waitFor();
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  const evidence = await call(
      page,
      "/v1/evidence/" + ready.evidence_ids[0],
      "GET",
      undefined,
      tenant,
    ),
    snapshot = await call(
      page,
      "/v1/snapshots/" + ready.snapshot_ids[0],
      "GET",
      undefined,
      tenant,
    ),
    sourceSnapshot = await call(
      page,
      "/v1/snapshots/" + datasets[0].id,
      "GET",
      undefined,
      tenant,
    );
  samples.push(
    {
      schema: "Evidence",
      method: "GET",
      path: "/v1/evidence/{evidence_id}",
      status: 200,
      response: evidence,
    },
    {
      schema: "Snapshot",
      method: "GET",
      path: "/v1/snapshots/{snapshot_id}",
      status: 200,
      response: snapshot,
    },
    {
      schema: "Snapshot",
      method: "GET",
      path: "/v1/snapshots/{snapshot_id}",
      status: 200,
      response: sourceSnapshot,
    },
  );
  assert.equal(snapshot.data_as_of, null);
  assert.equal(sourceSnapshot.data_as_of, null);
  const htmlDownload = page.waitForEvent("download");
  await result
    .getByRole("button", { name: "Download HTML report", exact: true })
    .click();
  const htmlFile = path.join(folder, "report.html");
  await (await htmlDownload).saveAs(htmlFile);
  const jsonDownload = page.waitForEvent("download");
  await result
    .getByRole("button", {
      name: "Download calculation & evidence",
      exact: true,
    })
    .click();
  const jsonFile = path.join(folder, "report.json");
  await (await jsonDownload).saveAs(jsonFile);
  const json = JSON.parse(await readFile(jsonFile, "utf8")),
    html = await readFile(htmlFile);
  assert.equal(json.report.asset_version_id, ready.asset_version_id);
  assert.ok(html.toString().includes(evidence.id));
  assert.ok(!html.toString().includes("{{"));
  inspection = {
    report_id: ready.id,
    task_id: ready.task_id,
    asset_version_id: ready.asset_version_id,
    spec_hash: json.spec_hash,
    evidence_count: ready.evidence_ids.length,
    html_sha256: sha(html),
  };
  await result.scrollIntoViewIfNeeded();
  await screenshot(page, "copypaste-web", "58-analysis-report-ready.png");
  const exported = await context.newPage();
  await exported.goto(pathToFileURL(htmlFile).href);
  await screenshot(exported, "copypaste-web", "59-analysis-report-html.png");
  await exported.close();
  passed(
    "canonical Report, Snapshot and Evidence reads and real HTML/JSON downloads retain checked references, independent scopes and unknown extraction cutoff",
  );
  for (const width of [1440, 1024, 768, 390])
    for (const theme of ["light", "dark"])
      for (const locale of ["en", "zh-HK"]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(
          ({ theme, locale }) => {
            localStorage.setItem("cp_theme", theme);
            localStorage.setItem("cp_locale", locale);
          },
          { theme, locale },
        );
        await page.reload();
        await page.locator(`[data-analysis-report="${ready.id}"]`).waitFor();
        assert.equal(
          await page.locator("html").getAttribute("data-theme"),
          theme,
        );
        assert.equal(
          await page.locator("html").getAttribute("lang"),
          locale === "en" ? "en" : "zh-Hant-HK",
        );
        const fits = await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        );
        if (!fits) {
          inspection.overflow = await page.evaluate(() =>
            Array.from(document.querySelectorAll("body *"))
              .map((e) => ({
                tag: e.tagName,
                cls: e.className,
                left: e.getBoundingClientRect().left,
                right: e.getBoundingClientRect().right,
              }))
              .filter((e) => e.left < 0 || e.right > innerWidth)
              .slice(0, 30),
          );
          await screenshot(
            page,
            "copypaste-web",
            "analysis-reports-overflow-failure.png",
            true,
          );
        }
        assert.ok(fits, `${width}/${theme}/${locale}`);
      }
  await page.locator(".analysis-reports").scrollIntoViewIfNeeded();
  await screenshot(
    page,
    "copypaste-web",
    "60-analysis-report-mobile-zh-dark.png",
  );
  passed(
    "saved reports work at four widths, both themes and Traditional Chinese/English without horizontal page overflow",
  );
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await page.reload();
  await page.route("**" + base + "/analysis/reports/" + ready.id, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "NOT_FOUND", message: "Report source unavailable" },
      }),
    }),
  );
  await page.reload();
  await page
    .getByRole("alert")
    .filter({ hasText: "Report source unavailable" })
    .waitFor();
  assert.equal(await page.locator(".report-result").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Download HTML report", exact: true })
      .count(),
    0,
  );
  await page.unroute("**" + base + "/analysis/reports/" + ready.id);
  passed(
    "a denied report read clears previous prose, figures and download controls",
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
      (globalThis as any).__analysisAuthURL = url;
    };
  });
  await native
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  let authURL = "";
  for (let i = 0; i < 150 && !authURL; i++) {
    authURL = await app.evaluate(
      () => (globalThis as any).__analysisAuthURL ?? "",
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
  await native.locator(`[data-analysis-report="${ready.id}"]`).waitFor();
  await native
    .getByRole("link", { name: "View original task", exact: true })
    .click();
  await native.waitForURL(`**#/app/tasks/${ready.task_id}`);
  await native.evaluate(() => {
    location.hash = "/app/analytics";
  });
  await native.locator(`[data-analysis-report="${ready.id}"]`).waitFor();
  const nativeFile = path.join(folder, "native-report.html");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: file,
    })) as any;
  }, nativeFile);
  await native
    .getByRole("button", { name: "Download HTML report", exact: true })
    .click();
  for (let i = 0; i < 150; i++) {
    if ((await stat(nativeFile).catch(() => null))?.size) break;
    await native.waitForTimeout(100);
  }
  assert.equal(sha(await readFile(nativeFile)), sha(html));
  await native.locator(".analysis-reports").scrollIntoViewIfNeeded();
  await screenshot(native, "copypaste-desktop", "16-analysis-report.png");
  passed(
    "Electron uses real browser PKCE and authenticated IPC to read the same private report and save byte-identical HTML locally",
  );
  assert.deepEqual(errors, []);
  await copyFile(
    path.resolve(
      "../copypaste-web/assets/screenshots/58-analysis-report-ready.png",
    ),
    path.resolve("assets/screenshots/analysis-reports.png"),
  );
} catch (e: any) {
  checks.push({
    name: "analysis report journey",
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
    "evidence/analysis-reports.json",
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
      "evidence/analysis-reports-contract-samples.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          origin:
            "actual local authenticated HTTP responses; simulated model dependency",
          samples,
        },
        null,
        2,
      ) + "\n",
    );
}
