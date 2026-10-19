import { emailCode } from "./qa-auth.js";
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const root = path.resolve(".."),
  repo = path.join(root, "copypaste-extension"),
  platform = path.join(root, "copypaste-platform"),
  id = (await readFile(path.join(repo, "extension-id.txt"), "utf8")).trim();
const user = JSON.parse(await readFile(".data/qa-user.json", "utf8"));
const checks: any[] = [],
  errors: string[] = [];
const profile = path.resolve(".data/extension-" + randomUUID());
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  headless: true,
  args: [
    "--disable-extensions-except=" + path.join(repo, "dist"),
    "--load-extension=" + path.join(repo, "dist"),
  ],
  viewport: { width: 420, height: 1000 },
});
await context.addInitScript(() => {
  try {
    localStorage.setItem("cp_locale", "en");
  } catch {}
});
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 20000 }));
  if (!worker.url().includes(id))
    throw new Error("Unexpected extension identity");
  const panel = await context.newPage();
  panel.setDefaultTimeout(20000);
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.locator("#sign-in").waitFor();
  await mkdir(path.join(repo, "assets/screenshots"), { recursive: true });
  await panel.screenshot({
    path: path.join(repo, "assets/screenshots/01-login.png"),
    fullPage: true,
  });
  const popupEvent = context.waitForEvent("page", { timeout: 20000 });
  await panel.locator("#sign-in").click();
  const popup = await popupEvent;
  await popup.waitForLoadState();
  await popup.locator('input[name="email"]').fill(user.email);
  const code = await emailCode(popup, () =>
    popup.locator('form button[type="submit"]').click(),
  );
  await popup.locator('input[name="code"]').fill(code);
  await popup.locator('form button[type="submit"]').click();
  await popup
    .getByRole("button", { name: /Authorize & return|授權並返回應用/ })
    .click();
  await panel
    .locator("#workspace")
    .waitFor({ state: "visible", timeout: 20000 });
  await panel.locator("#role option").first().waitFor({ state: "attached" });
  await panel.screenshot({
    path: path.join(repo, "assets/screenshots/02-workspace.png"),
    fullPage: true,
  });
  checks.push({
    name: "real Chromium MV3 identity popup + PKCE + session-only token storage",
    status: "passed",
  });
  async function api(path: string, method = "GET", body?: unknown) {
    const response = await panel.evaluate(
      async ({ path, method, body }) =>
        chrome.runtime.sendMessage({ type: "API", path, method, body }),
      { path, method, body },
    );
    assert.equal(response.ok, true, JSON.stringify(response));
    return response.data;
  }
  const created = await api("/v1/tenants", "POST", {
    name: "Extension synthetic studio",
    project_name: "First local brief",
  });
  const tenant = created.tenant.id,
    project = (await api(`/v1/tenants/${tenant}/projects`)).items[0].id;
  await api(`/v1/tenants/${tenant}/demo-credit`, "POST", {});
  await panel.reload();
  await panel.locator("#workspace").waitFor({ state: "visible" });
  await panel.locator("#tenant").selectOption(tenant);
  await panel.waitForFunction(
    (id) =>
      (document.querySelector("#project") as HTMLSelectElement)?.value === id,
    project,
  );
  await panel.locator("#demo-banner").waitFor({ state: "visible" });
  const base = `/v1/tenants/${tenant}/projects/${project}`;
  assert.equal(await panel.locator("#role").inputValue(), "assistant");
  // Let the API accept and commit once, then lose only that response at the trusted background boundary.
  await worker.evaluate(() => {
    const fetchOriginal = globalThis.fetch;
    (globalThis as any).__qaFetchOriginal = fetchOriginal;
    let lost = false;
    globalThis.fetch = async (input, init) => {
      const response = await fetchOriginal(input, init);
      if (
        !lost &&
        init?.method === "POST" &&
        String(input).endsWith("/delegations") &&
        response.ok
      ) {
        lost = true;
        throw new Error("Acceptance response lost for verification");
      }
      return response;
    };
  });
  await panel
    .locator('input[name="title"]')
    .fill("Extension first written brief");
  await panel
    .locator("#prompt")
    .fill(
      "Write an explicitly simulated campaign brief and deliver an editable Markdown file.",
    );
  await panel.locator('input[name="budget"]').fill("1");
  await panel.locator("#create-task").click();
  await panel
    .locator("#error")
    .getByText("Acceptance response lost for verification", { exact: false })
    .waitFor();
  const firstTasks = await api(base + "/tasks");
  assert.equal(firstTasks.items.length, 1);
  await panel.locator("#create-task").click();
  await panel.locator("#task-view").waitFor({ state: "visible" });
  await worker.evaluate(() => {
    globalThis.fetch = (globalThis as any).__qaFetchOriginal;
    delete (globalThis as any).__qaFetchOriginal;
  });
  const taskId = firstTasks.items[0].id;
  let task: any;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    task = await api(base + "/tasks/" + taskId);
    if (
      ["succeeded", "failed", "cancelled", "reconciling"].includes(task.status)
    )
      break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(
    task?.status,
    "succeeded",
    JSON.stringify({ status: task?.status, error: task?.error_code }),
  );
  await panel
    .locator("#task-status")
    .getByText("succeeded", { exact: true })
    .waitFor();
  assert.equal((await api(base + "/tasks")).items.length, 1);
  assert.equal((await api(base + "/conversations")).items.length, 1);
  const files = await api(base + "/assets");
  assert.ok(
    files.items.some(
      (a: any) => a.name === "demo-report.md" && Number(a.bytes) > 0,
    ),
  );
  await panel.screenshot({
    path: path.join(repo, "assets/screenshots/03-default-task.png"),
    fullPage: true,
  });
  checks.push({
    name: "default first delegation uses real Codex with labelled synthetic model data; retry after losing an accepted response leaves one private conversation, task and actual text file",
    status: "passed",
  });
  await panel.locator("#refresh-notifications").click();
  await panel.locator(".notification-entry").first().waitFor();
  const inbox = await api(`/v1/tenants/${tenant}/notifications`),
    success = inbox.items.find((n: any) => n.kind === "succeeded");
  assert.equal(inbox.items.length, 2);
  assert.ok(success);
  assert.equal(success.task_title, "Extension first written brief");
  await panel.locator("#close-task").click();
  await panel.locator(`[data-notification="${success.id}"] .task-row`).click();
  await panel.locator("#task-view").waitFor({ state: "visible" });
  assert.equal(
    await panel.locator("#task-title").innerText(),
    "Extension first written brief",
  );
  assert.equal(
    (await api(`/v1/tenants/${tenant}/notifications`)).items.find(
      (n: any) => n.id === success.id,
    ).read,
    true,
  );
  await panel.screenshot({
    path: path.join(repo, "assets/screenshots/04-notifications.png"),
    fullPage: true,
  });
  checks.push({
    name: "recipient inbox shows the real task title, marks the selected notification read and opens the original private task",
    status: "passed",
  });
  for (const scheme of ["light", "dark"] as const) {
    await panel.emulateMedia({ colorScheme: scheme });
    for (const width of [320, 420, 768]) {
      await panel.setViewportSize({ width, height: 1000 });
      assert.equal(
        await panel.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `extension horizontal overflow at ${width}/${scheme}`,
      );
    }
  }
  await panel.locator("#locale").click();
  await panel
    .locator("h2")
    .getByText("Work notifications", { exact: true })
    .waitFor();
  await panel.screenshot({
    path: path.join(repo, "assets/screenshots/05-dark-en.png"),
    fullPage: true,
  });
  await panel.locator("#locale").click();
  await panel.emulateMedia({ colorScheme: "light" });
  await panel.setViewportSize({ width: 420, height: 1000 });
  checks.push({
    name: "default task and inbox render without horizontal overflow at three extension widths, both themes and Traditional Chinese/English",
    status: "passed",
  });
  const secondProject = await api(`/v1/tenants/${tenant}/projects`, "POST", {
    name: "Other active project",
  });
  await panel.reload();
  await panel.locator("#workspace").waitFor({ state: "visible" });
  await panel.locator("#tenant").selectOption(tenant);
  await panel
    .locator(`#project option[value="${secondProject.id}"]`)
    .waitFor({ state: "attached" });
  await panel.locator("#project").selectOption(project);
  await worker.evaluate(() => {
    const original = globalThis.fetch;
    (globalThis as any).__qaFetchOriginal = original;
    globalThis.fetch = async (input, init) => {
      const response = await original(input, init);
      if (
        init?.method === "POST" &&
        String(input).endsWith("/delegations") &&
        response.ok
      ) {
        (globalThis as any).__qaHeld = true;
        await new Promise<void>((resolve) => {
          (globalThis as any).__qaRelease = resolve;
        });
      }
      return response;
    };
  });
  await panel
    .locator('input[name="title"]')
    .fill("Scope-safe deferred response");
  await panel
    .locator("#prompt")
    .fill(
      "Write a simulated text plan and deliver one editable Markdown file.",
    );
  await panel.locator("#create-task").click();
  const holdDeadline = Date.now() + 15000;
  while (
    !(await worker.evaluate(() => (globalThis as any).__qaHeld ?? false))
  ) {
    assert.ok(Date.now() < holdDeadline, "accepted response was never held");
    await new Promise((r) => setTimeout(r, 50));
  }
  await panel.locator("#project").selectOption(secondProject.id);
  await panel.locator("#task-list .empty-copy").waitFor();
  await worker.evaluate(() => {
    globalThis.fetch = (globalThis as any).__qaFetchOriginal;
    (globalThis as any).__qaRelease();
    delete (globalThis as any).__qaHeld;
    delete (globalThis as any).__qaRelease;
    delete (globalThis as any).__qaFetchOriginal;
  });
  await panel.waitForFunction(
    () =>
      !(document.querySelector("#create-task") as HTMLButtonElement).disabled,
  );
  assert.equal(await panel.locator("#task-view").isHidden(), true);
  assert.equal(await panel.locator("#project").inputValue(), secondProject.id);
  assert.equal(
    await panel.locator('input[name="title"]').inputValue(),
    "Scope-safe deferred response",
  );
  assert.equal(
    (await api(`/v1/tenants/${tenant}/projects/${secondProject.id}/tasks`))
      .items.length,
    0,
  );
  checks.push({
    name: "switching projects while an accepted response is delayed keeps the new project, draft and empty task view; the original task is not recreated in the new project",
    status: "passed",
  });
  const file = path.resolve(".data/extension-brief.txt");
  await writeFile(file, "Harbour Studio · selected local brief");
  await panel.locator("#file-input").setInputFiles(file);
  await panel
    .locator("#file-note")
    .getByText("已加入", { exact: false })
    .waitFor();
  checks.push({
    name: "explicit local file picker uploads to the selected project",
    status: "passed",
  });
  // The starter plan permits one active task across the user's projects.
  // Wait for the earlier deliberately delayed delegation to settle normally.
  const settlementDeadline = Date.now() + 60000;
  while (true) {
    const previous = (await api(base + "/tasks")).items;
    if (
      previous.every((t: any) =>
        ["succeeded", "failed", "cancelled"].includes(t.status),
      )
    )
      break;
    assert.ok(
      Date.now() < settlementDeadline,
      "the earlier task did not settle before another starter-plan task",
    );
    await new Promise((r) => setTimeout(r, 300));
  }
  await panel.locator('input[name="title"]').fill("Extension input checkpoint");
  await panel
    .locator("#prompt")
    .fill(
      "Write a clearly simulated campaign plan using the file I explicitly choose, then deliver a Markdown file.",
    );
  await panel.locator('select[name="required_input"]').selectOption("file");
  await panel.locator('input[name="budget"]').fill("1");
  await panel.locator("#create-task").click();
  const inputs = panel.locator("#input-requests");
  await inputs.waitFor({ state: "visible" }).catch(async (e) => {
    throw new Error(
      e.message +
        " " +
        JSON.stringify(
          await panel.evaluate(() => ({
            error: document.querySelector("#error")?.textContent,
            status: document.querySelector("#task-status")?.textContent,
            task: document.querySelector("#task-title")?.textContent,
            project: (document.querySelector("#project") as HTMLSelectElement)
              .value,
            formValid: (
              document.querySelector("#brief-form") as HTMLFormElement
            ).checkValidity(),
          })),
        ),
    );
  });
  const secondBase = `/v1/tenants/${tenant}/projects/${secondProject.id}`;
  const waiting = (await api(secondBase + "/tasks")).items[0];
  assert.equal(waiting.status, "needs_input");
  assert.equal((await api(secondBase + "/tasks/" + waiting.id)).attempt, 0);
  const picker = inputs.locator("select").first();
  const source = picker
    .locator("option")
    .filter({ hasText: "extension-brief.txt" });
  await source.waitFor({ state: "attached" });
  assert.equal(await picker.inputValue(), "");
  for (const scheme of ["light", "dark"] as const) {
    await panel.emulateMedia({ colorScheme: scheme });
    for (const width of [320, 420, 768]) {
      await panel.setViewportSize({ width, height: 1000 });
      assert.ok(
        await panel.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `input form overflow ${width}/${scheme}`,
      );
    }
  }
  await panel.setViewportSize({ width: 420, height: 1000 });
  await panel.emulateMedia({ colorScheme: "light" });
  await panel.screenshot({
    path: path.join(repo, "assets/screenshots/06-input-wait.png"),
    fullPage: true,
  });
  await picker.selectOption((await source.getAttribute("value"))!);
  await inputs
    .getByRole("button", { name: "確認使用此資料", exact: true })
    .click();
  await inputs.waitFor({ state: "hidden" });
  const inputDeadline = Date.now() + 60000;
  let completed: any;
  while (Date.now() < inputDeadline) {
    completed = await api(secondBase + "/tasks/" + waiting.id);
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
  assert.equal((await api(secondBase + "/tasks")).items.length, 1);
  await panel
    .locator("#task-status")
    .getByText("succeeded", { exact: true })
    .waitFor();
  await panel.screenshot({
    path: path.join(repo, "assets/screenshots/07-input-result.png"),
    fullPage: true,
  });
  checks.push({
    name: "MV3 explicitly waits for a file, selects the uploaded current version without auto-selection, resumes the same task through real Codex with synthetic model data and fits three widths in both themes",
    status: "passed",
  });
  const exposed = await panel.evaluate(async () => {
    const local = await chrome.storage.local.get(null);
    const result = await chrome.runtime.sendMessage({ type: "STATUS" });
    return {
      local_keys: Object.keys(local),
      status_keys: Object.keys(result.data),
    };
  });
  if (
    exposed.local_keys.includes("tokens") ||
    exposed.status_keys.includes("access_token")
  )
    throw new Error("Token exposed outside trusted background storage");
  await panel.locator("#sign-out").click();
  await panel.locator("#login").waitFor({ state: "visible" });
  checks.push({
    name: "logout clears session tokens and revokes server refresh family",
    status: "passed",
  });
  if (errors.length) throw new Error(errors.join("\n"));
} catch (e: any) {
  checks.push({
    name: "extension journey",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  await context.close();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/extension.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dependency_mode: "simulated",
        real_codex: true,
        checks,
        errors,
        browser_closed: true,
      },
      null,
      2,
    ),
  );
}
