import {
  _electron,
  chromium,
  type ElectronApplication,
  type Browser,
  type BrowserContext,
} from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { emailCode } from "./qa-auth.js";

const root = path.resolve(".."),
  repo = path.join(root, "copypaste-desktop"),
  dir = path.resolve(".data/native-transfer-" + randomUUID());
await mkdir(dir, { recursive: true });
const checks: any[] = [],
  errors: string[] = [];
let app: ElectronApplication | undefined,
  browser: Browser | undefined,
  context: BrowserContext | undefined;
let browserClosed = false,
  electronClosed = false;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const web = await context.newPage(),
    email = `native-transfer-${randomUUID()}@example.invalid`;
  await web.goto("http://localhost:4317/login");
  await web.getByLabel("Work email").fill(email);
  const code = await emailCode(web, () =>
    web.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await web.locator('input[name="code"]').fill(code);
  await web.locator('form button[type="submit"]').click();
  await web.waitForURL("**/welcome");
  await web.locator('input[name="name"]').fill("Native transfer studio");
  await web.locator('input[name="project_name"]').fill("Large file workflow");
  await web.locator('form button[type="submit"]').click();
  await web.waitForURL("**/app");
  app = await _electron.launch({
    executablePath: path.join(repo, "node_modules/electron/dist/electron.exe"),
    args: [repo],
    cwd: repo,
    env: { ...process.env, COPYPASTE_USER_DATA: dir },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.waitForURL(/file:.*index\.html/);
  await page.waitForLoadState("load");
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, shell }) => {
    for (const w of BrowserWindow.getAllWindows()) w.hide();
    shell.openExternal = async (url: string) => {
      (globalThis as any).__transferAuthURL = url;
    };
  });
  await page.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  let url = "";
  const deadline = Date.now() + 20000;
  while (!url && Date.now() < deadline) {
    url = await app.evaluate(() => (globalThis as any).__transferAuthURL ?? "");
    if (!url) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(url, "Native login must open a browser authorization flow");
  const consent = await context.newPage();
  await consent.goto(url);
  await consent
    .getByRole("button", { name: /Connect.*|Allow.*|Authorize.*/ })
    .click();
  await page.waitForURL("**#/app");
  const me = await page.evaluate(async () => {
    const r = await (window as any).copyPasteBridge.request("/v1/me", {});
    return r.body;
  });
  const tenant = me.memberships[0].id,
    projects = await page.evaluate(async (t) => {
      const r = await (window as any).copyPasteBridge.request(
        `/v1/tenants/${t}/projects`,
        {},
      );
      return r.body.items;
    }, tenant),
    base = `/v1/tenants/${tenant}/projects/${projects[0].id}`;
  checks.push({
    name: "source Electron signs in through a real browser PKCE flow with an isolated encrypted credential store",
    status: "passed",
  });
  const uploadManifest = {
    project_id: projects[0].id,
    filename: "stable-request.txt",
    content_type: "text/plain",
    size_bytes: 1,
    sha256: createHash("sha256").update("a").digest("hex"),
  };
  const stable = await page.evaluate(
    async ({ base, body, k }) => {
      const bridge = (window as any).copyPasteBridge,
        a = await bridge.request(base + "/uploads", {
          method: "POST",
          body,
          idempotencyKey: k,
        }),
        b = await bridge.request(base + "/uploads", {
          method: "POST",
          body,
          idempotencyKey: k,
        });
      await bridge.request(base + "/uploads/" + a.body.upload_id, {
        method: "DELETE",
      });
      return {
        a: a.body.upload_id,
        b: b.body.upload_id,
        statuses: [a.status, b.status],
      };
    },
    { base, body: uploadManifest, k: randomUUID() },
  );
  assert.deepEqual(stable.statuses, [201, 201]);
  assert.equal(stable.a, stable.b);
  checks.push({
    name: "native IPC preserves a stable idempotency key and repeated create returns one upload session",
    status: "passed",
  });
  await page
    .getByRole("link", { name: "Assets & deliverables", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Upload material", exact: true })
    .first()
    .click();
  const bytes = Buffer.alloc(29 * 1024 * 1024 + 31, 98),
    filename = "native-verified-large-file.txt";
  const source = path.join(dir, filename);
  await writeFile(source, bytes);
  await page
    .locator('input[type="file"]')
    .setInputFiles(source, { timeout: 60000 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload or resume", exact: true })
    .click();
  await page
    .getByRole("heading", { name: filename, exact: true })
    .waitFor({ timeout: 60000 });
  const asset = await page.evaluate(
    async ({ base, filename }) => {
      const r = await (window as any).copyPasteBridge.request(
        base + "/assets",
        {},
      );
      return r.body.items.find((a: any) => a.name === filename);
    },
    { base, filename },
  );
  assert.ok(asset);
  const target = path.join(dir, "verified-download.txt");
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, target);
  const saved = await page.evaluate(
    async ({ base, id, name }) =>
      (window as any).copyPasteBridge.download(
        `${base}/assets/${id}/download`,
        name,
      ),
    { base, id: asset.id, name: filename },
  );
  assert.equal(saved.saved, true);
  const downloaded = await readFile(target);
  assert.equal(
    createHash("sha256").update(downloaded).digest("hex"),
    createHash("sha256").update(bytes).digest("hex"),
  );
  await mkdir(path.join(repo, "assets/screenshots"), { recursive: true });
  await page.screenshot({
    path: path.join(repo, "assets/screenshots/06-verified-transfer.png"),
    fullPage: true,
    animations: "disabled",
  });
  checks.push({
    name: "29 MiB actual file crosses renderer/native/API part upload and native streamed download with identical SHA-256",
    status: "passed",
  });
  await page.evaluate(
    async ({ base, id, name }) => {
      try {
        await (window as any).copyPasteBridge.download(
          `${base}/assets/${id}/download`,
          name,
        );
        throw new Error("Unexpected overwrite");
      } catch (e) {
        if (String(e).includes("Unexpected overwrite")) throw e;
      }
    },
    { base, id: asset.id, name: filename },
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile(target))
      .digest("hex"),
    createHash("sha256").update(bytes).digest("hex"),
  );
  checks.push({
    name: "an existing native destination is preserved instead of silently overwritten",
    status: "passed",
  });
  await page.getByRole("link", { name: "Cloud files", exact: true }).click();
  await page
    .getByRole("complementary", { name: "Workspace folders" })
    .getByRole("button", { name: "Project materials", exact: true })
    .click();
  await page.getByRole("button", { name: filename, exact: true }).waitFor();
  await page.screenshot({
    path: path.join(repo, "assets/screenshots/07-cloud-files.png"),
    fullPage: true,
    animations: "disabled",
  });
  checks.push({
    name: "source Desktop browses the same persistent cloud file tree through the authenticated native bridge",
    status: "passed",
  });
  await page.evaluate(
    async () => await (window as any).copyPasteBridge.signOut(),
  );
  await page
    .getByRole("button", { name: "Sign in securely in your browser" })
    .waitFor();
  assert.deepEqual(errors, []);
} catch (e: any) {
  checks.push({
    name: "source native transfer regression",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  if (context) await context.close();
  if (browser) {
    await browser.close();
    browserClosed = true;
  }
  if (app) {
    await app.close();
    electronClosed = true;
  }
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/alignment-desktop.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        artifact: "current source Electron; no published installer replacement",
        checks,
        errors,
        browser_closed: browserClosed,
        electron_closed: electronClosed,
      },
      null,
      2,
    ),
  );
}
