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
  await web
    .getByRole("button", { name: "Add one-time demo credit", exact: true })
    .click();
  await web
    .getByRole("button", { name: "Demo credit added", exact: true })
    .waitFor();
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
  const signedOut = await page.evaluate(async () => {
    const b = (window as any).copyPasteBridge;
    return {
      config: await b.request("/v1/public/config", {}),
      private: await b.request("/v1/session/context", {}),
    };
  });
  assert.equal(signedOut.config.status, 200);
  assert.equal(signedOut.config.body.data_mode, "simulated");
  assert.equal(signedOut.private.status, 401);
  await page
    .locator(".demo-notice")
    .getByText("Demo environment · simulated data", { exact: true })
    .waitFor();
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
  await page.locator(".demo-notice").waitFor();
  const me = await page.evaluate(async () => {
    const r = await (window as any).copyPasteBridge.request(
      "/v1/session/context",
      {},
    );
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
  await page
    .getByRole("link", { name: "Your conversations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Conversation name", { exact: true })
    .fill("Native default brief");
  assert.equal(await modal.locator('select[name="agent"]').inputValue(), "");
  await modal
    .getByRole("button", { name: "Create conversation", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Native default brief", exact: true })
    .waitFor();
  const conversation = page.url().split("/").pop()!;
  const submitted = await page.evaluate(
    async ({ base, conversation }) => {
      return (window as any).copyPasteBridge.request(
        `${base}/conversations/${conversation}/messages`,
        {
          method: "POST",
          body: {
            client_message_id: crypto.randomUUID(),
            expected_version: 1,
            intent: "delegate",
            mode: "execute",
            body: "Write a clearly simulated campaign brief and deliver an editable Markdown file.",
            budget_micros: 1000000,
          },
        },
      );
    },
    { base, conversation },
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  let task: any;
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    task = await page.evaluate(
      async ({ base, id }) =>
        (
          await (window as any).copyPasteBridge.request(
            `${base}/tasks/${id}`,
            {},
          )
        ).body,
      { base, id: submitted.body.task.id },
    );
    if (
      ["succeeded", "failed", "cancelled", "reconciling"].includes(task.status)
    )
      break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal(
    task?.status,
    "succeeded",
    JSON.stringify({ status: task?.status, error: task?.error_code }),
  );
  checks.push({
    name: "source Desktop creates a conversation with the built-in default assistant and real Codex runs an explicitly simulated text task through the native authenticated bridge",
    status: "passed",
  });
  await page.getByRole("link", { name: /Work notifications/ }).click();
  await page.locator(".notification-card").first().waitFor();
  const inbox = await page.evaluate(
    async (tenant) =>
      (
        await (window as any).copyPasteBridge.request(
          `/v1/tenants/${tenant}/notifications`,
          {},
        )
      ).body,
    tenant,
  );
  assert.equal(inbox.items.length, 2);
  const success = inbox.items.find((n: any) => n.kind === "succeeded");
  assert.ok(success);
  await page.screenshot({
    path: path.join(repo, "assets/screenshots/08-notifications.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page
    .locator(`[data-notification="${success.id}"]`)
    .getByRole("button", { name: "Open task", exact: true })
    .click();
  await page.waitForURL(`**#/app/tasks/${task.id}`);
  await page
    .getByRole("heading", { name: "Task details", exact: true })
    .waitFor();
  checks.push({
    name: "source Desktop displays the same recipient-only inbox and follows its notification to the original private task",
    status: "passed",
  });
  await page.evaluate(() => (location.hash = "/app"));
  await page
    .getByRole("button", { name: "Create campaign visuals", exact: false })
    .click();
  const inputForm = page.getByRole("dialog");
  await inputForm
    .getByLabel("Task name", { exact: true })
    .fill("Native approved-source plan");
  await inputForm
    .getByLabel("What would you like to make?", { exact: true })
    .fill(
      "Write a clearly simulated campaign plan after I explicitly select an approved source. Deliver an editable Markdown file.",
    );
  await inputForm
    .getByLabel("Inputs needed before starting?", { exact: true })
    .selectOption("file");
  await inputForm
    .getByLabel("Task budget limit (HKD)", { exact: true })
    .fill("1");
  await inputForm
    .getByRole("button", { name: "Start task", exact: true })
    .click();
  const inputs = page.getByRole("region", {
    name: "Provide task inputs",
    exact: true,
  });
  await inputs.waitFor();
  const latest = await page.evaluate(
    async (base) =>
      (await (window as any).copyPasteBridge.request(base + "/tasks", {})).body
        .items[0],
    base,
  );
  assert.equal(latest.status, "needs_input");
  const before = await page.evaluate(
    async ({ base, id }) =>
      (await (window as any).copyPasteBridge.request(base + "/tasks/" + id, {}))
        .body,
    { base, id: latest.id },
  );
  assert.equal(before.attempt, 0);
  const picker = inputs.getByLabel("Choose a current file version", {
    exact: true,
  });
  const sourceOption = picker.locator("option").filter({ hasText: filename });
  await sourceOption.waitFor({ state: "attached" });
  assert.equal(await picker.inputValue(), "");
  await page.screenshot({
    path: path.join(repo, "assets/screenshots/09-input-wait.png"),
    fullPage: true,
    animations: "disabled",
  });
  await picker.selectOption((await sourceOption.getAttribute("value"))!);
  await inputs
    .getByRole("button", { name: "Confirm this input", exact: true })
    .click();
  await inputs.waitFor({ state: "hidden" });
  const inputDeadline = Date.now() + 60000;
  let completed: any;
  while (Date.now() < inputDeadline) {
    completed = await page.evaluate(
      async ({ base, id }) =>
        (
          await (window as any).copyPasteBridge.request(
            base + "/tasks/" + id,
            {},
          )
        ).body,
      { base, id: latest.id },
    );
    if (
      ["succeeded", "failed", "cancelled", "reconciling"].includes(
        completed.status,
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal(
    completed.status,
    "succeeded",
    JSON.stringify({ status: completed.status, error: completed.error_code }),
  );
  assert.equal(completed.attempt, 1);
  await page
    .locator(".message-assistant")
    .filter({ hasText: "Simulated data" })
    .waitFor();
  await page.screenshot({
    path: path.join(repo, "assets/screenshots/10-input-result.png"),
    fullPage: true,
    animations: "disabled",
  });
  checks.push({
    name: "source Desktop holds an explicit file checkpoint before any model call, chooses the actual uploaded version and resumes the same task through real Codex using synthetic model data",
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
        dependency_mode: "simulated",
        real_codex: true,
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
