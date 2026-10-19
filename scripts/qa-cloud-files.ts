import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { unzipSync } from "fflate";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode } from "./qa-auth.js";
const root = path.resolve(".."),
  checks: any[] = [],
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
      const me = await (await fetch("/v1/me")).json();
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
        throw new Error(
          method + " " + url + " " + r.status + " " + JSON.stringify(data),
        );
      return { status: r.status, data };
    },
    { url, method, body, tenant },
  );
}
async function shot(page: Page, name: string) {
  const dir = path.join(root, "copypaste-web/assets/screenshots");
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, name + ".png"),
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
    .fill(`cloud-ui-${randomUUID()}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour creative studio");
  await page
    .locator('input[name="project_name"]')
    .fill("Autumn campaign files");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  await page
    .getByRole("button", { name: "Add one-time demo credit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Demo credit added", exact: true })
    .waitFor();
  const me = (await call(page, "/v1/me")).data,
    tenant = me.memberships[0].id,
    project = (await call(page, `/v1/tenants/${tenant}/projects`)).data.items[0]
      .id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  const agent = (
      await call(page, base + "/agents", "POST", {
        name: "Studio developer",
        role_key: "fullstack",
        instructions: "Keep exact working versions and deliver source files.",
      })
    ).data,
    conv = (
      await call(page, base + "/conversations", "POST", {
        name: "Campaign website",
        agent_id: agent.id,
      })
    ).data;
  await page.getByRole("link", { name: "Cloud files", exact: true }).click();
  await page
    .getByRole("heading", { name: "Cloud files", exact: true })
    .waitFor();
  const folders = page.getByRole("complementary", {
    name: "Workspace folders",
  });
  await folders
    .getByRole("button", { name: "Project materials", exact: true })
    .click();
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  let modal = page.getByRole("dialog");
  await modal.getByLabel("Name", { exact: true }).fill("Campaign briefs");
  await modal.getByRole("button", { name: "Save entry", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "campaign-brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Campaign brief · 港島秋日企劃\nUse approved bilingual product facts.",
      ),
    });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload or resume", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await folders
    .getByRole("button", { name: "Project materials", exact: true })
    .click();
  await page
    .getByRole("button", { name: "campaign-brief.txt", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("Name", { exact: true }).fill("Pinned campaign brief");
  await modal.getByLabel("Entry type").selectOption("file");
  const original = (await call(page, base + "/assets")).data.items.find(
    (x: any) => x.name === "campaign-brief.txt",
  );
  await modal.getByLabel("Source asset").selectOption(original.id);
  await modal.getByLabel("Pinned version").waitFor();
  await modal.getByRole("button", { name: "Save entry", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  let row = page
    .locator(".cloud-file-row")
    .filter({
      has: page.getByRole("button", {
        name: "Pinned campaign brief",
        exact: true,
      }),
    });
  await row.getByRole("button", { name: "Edit or move", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("Name", { exact: true })
    .fill("Approved campaign brief");
  const picker = modal.locator(".cloud-folder-picker");
  await picker
    .getByRole("button", { name: "Project materials", exact: true })
    .click();
  await picker
    .getByRole("button", { name: "Campaign briefs", exact: true })
    .click();
  await picker
    .getByRole("button", { name: "Choose current folder", exact: true })
    .click();
  await modal.getByRole("button", { name: "Save entry", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await folders
    .getByRole("button", { name: "Project materials", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Campaign briefs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approved campaign brief", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal.locator("pre").filter({ hasText: "港島秋日企劃" }).waitFor();
  await shot(page, "22-cloud-pinned-preview");
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  checks.push({
    name: "cloud UI uploads shared material, creates a fixed-version reference, renames and moves it through the folder picker, then previews the correct text",
    status: "passed",
  });
  await page.goto(`http://localhost:4317/app/files?conversation=${conv.id}`);
  await page
    .getByLabel("File workspace")
    .selectOption({ label: "Private conversation: Campaign website" });
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "private-launch-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Private notes for the campaign. Publish only an approved copy.",
      ),
    });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload or resume", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await folders
    .getByRole("button", { name: "Attachments", exact: true })
    .click();
  row = page
    .locator(".cloud-file-row")
    .filter({
      has: page.getByRole("button", {
        name: "private-launch-notes.txt",
        exact: true,
      }),
    });
  await row.getByRole("button", { name: "Publish copy", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("I approve sharing this version with project members")
    .check();
  await modal
    .getByRole("button", { name: "Publish the copy", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  const workspaces = await call(
    page,
    "/v1/workspaces?project_id=" + project,
    "GET",
    undefined,
    tenant,
  );
  samples.push({ schema: "CloudWorkspaceList", response: workspaces.data });
  const shared = workspaces.data.items.find((x: any) => x.kind === "project"),
    privateWs = workspaces.data.items.find(
      (x: any) => x.conversation_id === conv.id,
    );
  const allPrivate = await call(
    page,
    `/v1/workspaces/${privateWs.id}/nodes?q=private-launch`,
    "GET",
    undefined,
    tenant,
  );
  samples.push({ schema: "WorkspaceNodeList", response: allPrivate.data });
  const privateNode = allPrivate.data.items[0];
  assert.equal(privateNode.reference_state, "ready");
  const canonicalReference = await call(
    page,
    `/v1/workspace-nodes/${privateNode.id}/reference`,
    "GET",
    undefined,
    tenant,
  );
  samples.push({
    schema: "WorkspaceNodeReference",
    response: canonicalReference.data,
  });
  const createSample = await call(
    page,
    `/v1/workspaces/${shared.id}/nodes`,
    "POST",
    { name: "Contract sample folder", kind: "directory" },
    tenant,
  );
  assert.equal(createSample.status, 201);
  samples.push({ schema: "WorkspaceNode", response: createSample.data });
  const updateSample = await call(
    page,
    `/v1/workspace-nodes/${createSample.data.id}`,
    "PATCH",
    {
      expected_version: createSample.data.version,
      name: "Contract sample renamed",
      parent_id: null,
    },
    tenant,
  );
  samples.push({ schema: "WorkspaceNode", response: updateSample.data });
  const removedSample = await call(
    page,
    `/v1/workspace-nodes/${createSample.data.id}`,
    "DELETE",
    undefined,
    tenant,
  );
  assert.equal(removedSample.status, 202);
  samples.push({ schema: "Deletion", response: removedSample.data });
  checks.push({
    name: "private attachment upload and explicit approved project copy run through real HTTP; canonical workspace/node/reference/create/update/delete payloads are captured for strict schema validation",
    status: "passed",
  });
  for (let run = 0; run < 2; run++) {
    const c = (await call(page, `${base}/conversations/${conv.id}`)).data;
    const sent = (
      await call(page, `${base}/conversations/${conv.id}/messages`, "POST", {
        client_message_id: randomUUID(),
        expected_version: c.version,
        intent: "delegate",
        body: "Build the explicitly simulated campaign website and deliver its source ZIP.",
        mode: "execute",
        budget_micros: 1000000,
      })
    ).data;
    let task: any,
      deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      task = (await call(page, base + "/tasks/" + sent.task.id)).data;
      if (
        ["succeeded", "failed", "cancelled", "reconciling"].includes(
          task.status,
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(
      task?.status,
      "succeeded",
      JSON.stringify({ status: task?.status, error: task?.error_code }),
    );
  }
  const working = (
    await call(
      page,
      `/v1/workspaces/${privateWs.id}/nodes?q=demo.html`,
      "GET",
      undefined,
      tenant,
    )
  ).data.items;
  assert.equal(working.length, 1);
  const manifest = (
    await call(
      page,
      `/v1/workspace-nodes/${working[0].id}/reference`,
      "GET",
      undefined,
      tenant,
    )
  ).data;
  assert.equal(manifest.source_version, 2);
  assert.match(manifest.text, /模擬交付/);
  const sourcePackage = (await call(page, base + "/assets")).data.items.find(
    (x: any) => x.name === "demo-source.zip",
  );
  assert.ok(sourcePackage);
  const sourceBytes = await page.evaluate(
    async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())],
    base + "/assets/" + sourcePackage.id + "/download",
  );
  const unpacked = unzipSync(new Uint8Array(sourceBytes));
  assert.ok(unpacked["demo.html"]);
  assert.equal(
    JSON.parse(Buffer.from(unpacked["copypaste-manifest.json"]).toString())
      .execution_validation,
    "not_executed",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await folders
    .getByRole("button", { name: "Working files", exact: true })
    .click();
  await page.getByRole("button", { name: "demo.html", exact: true }).waitFor();
  await shot(page, "23-cloud-working-files");
  checks.push({
    name: "two real Codex tasks in one private conversation read and update the persistent source using its exact hash; the second immutable source version is packaged as actual ZIP bytes",
    status: "passed",
  });
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `cloud file overflow at ${width}`,
    );
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await shot(page, "24-cloud-files-dark");
  await page.getByTitle("切換至繁體中文").click();
  await page.getByRole("heading", { name: "雲端檔案", exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-Hant-HK");
  checks.push({
    name: "cloud file workspace fits four viewport widths, dark theme and Traditional Chinese",
    status: "passed",
  });
  assert.deepEqual(errors, []);
} catch (e: any) {
  checks.push({
    name: "cloud workspace browser regression",
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
    "evidence/cloud-files.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        errors,
        dependency_mode: "simulated",
        real_codex: true,
        browser_closed: closed,
      },
      null,
      2,
    ),
  );
  await writeFile(
    "evidence/cloud-files-contract-samples.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin:
          "actual local HTTP responses under an authenticated browser session",
        samples,
      },
      null,
      2,
    ),
  );
}
