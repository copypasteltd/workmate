import { chromium, type Page, type BrowserContext } from "playwright";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
const root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform");
const checks: { name: string; status: string; detail?: string }[] = [],
  errors: string[] = [];
async function code(email: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    for (const f of await readdir(path.join(platform, ".data/mailbox"))) {
      const item = JSON.parse(
        await readFile(path.join(platform, ".data/mailbox", f), "utf8"),
      );
      if (item.to === email && Date.now() - Date.parse(item.at) < 120000)
        return item.text.match(/\b\d{6}\b/)[0];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Local sign-in email not delivered");
}
async function request(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const me = await (
        await fetch(url.startsWith("/v1/admin") ? "/v1/admin/me" : "/v1/me")
      ).json();
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { url, method, body },
  );
}
async function screenshot(page: Page, repo: string, name: string) {
  const dir = path.join(root, repo, "assets/screenshots");
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
}
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((v) => parseInt(v, 2))),
    counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest(),
    offset = digest[19] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  headless: true,
});
let context: BrowserContext | undefined;
try {
  context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    locale: "en-HK",
  });
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const email = `conversation-${randomUUID().slice(0, 8)}@example.invalid`;
  await page.goto("http://localhost:4317/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await page.locator('input[name="code"]').fill(await code(email));
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour Creative");
  await page.locator('input[name="project_name"]').fill("Autumn campaign");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const me = await request(page, "/v1/me"),
    tenant = me.body.memberships[0].id,
    projects = await request(page, `/v1/tenants/${tenant}/projects`),
    base = `/v1/tenants/${tenant}/projects/${projects.body.items[0].id}`;
  checks.push({
    name: "first-party email sign-in and project onboarding",
    status: "passed",
  });
  await page.goto("http://localhost:4317/app/specialists");
  await page
    .getByRole("button", { name: "Create specialist", exact: true })
    .click();
  await page
    .getByLabel("Specialist name", { exact: true })
    .fill("Campaign partner");
  await page
    .getByLabel("Working instructions")
    .fill(
      "Use Traditional Chinese and English. Cite verified campaign metrics and keep brand wording exact.",
    );
  await page.getByRole("button", { name: "Save specialist" }).click();
  await page
    .getByRole("heading", { name: "Campaign partner", exact: true })
    .waitFor();
  await screenshot(page, "copypaste-web", "06-persistent-specialists");
  const agents = await request(page, base + "/agents");
  assert.equal(agents.body.items.length, 1);
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await page.waitForURL("**/app/conversations/*");
  const conversation = page.url().split("/").pop()!;
  await page.getByLabel("Message purpose").selectOption("note");
  await page
    .getByLabel("Your message", { exact: true })
    .fill(
      "Autumn campaign: compare Google and Meta performance. Keep all recommendations grounded in imported data.",
    );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page.locator(".work-message").first().waitFor();
  await page.reload();
  await page.locator(".work-message").first().waitFor();
  assert.match(
    await page.locator(".work-message").first().innerText(),
    /compare Google and Meta/,
  );
  await screenshot(page, "copypaste-web", "07-private-conversation");
  checks.push({
    name: "specialist creation and persistent private conversation note across reload",
    status: "passed",
  });
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await page.getByRole("button", { name: "Unpin", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Conversation settings", exact: true })
    .click();
  await page
    .getByLabel("Conversation name", { exact: true })
    .fill("Autumn campaign review");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Autumn campaign review", exact: true })
    .waitFor();
  const config = await (
    await page.request.get("http://localhost:4317/v1/public/config")
  ).json();
  if (!config.services.text) {
    await page.getByLabel("Message purpose").selectOption("delegate");
    await page
      .getByLabel("Your message", { exact: true })
      .fill("Review the autumn marketing campaign using approved data.");
    await page
      .getByRole("button", { name: "Delegate task", exact: true })
      .click();
    await page.getByRole("alert").waitFor();
    const c = await request(page, `${base}/conversations/${conversation}`);
    assert.equal(c.body.tasks.length, 0);
    assert.equal(c.body.messages.length, 1);
    checks.push({
      name: "unconfigured company AI fails explicitly and creates no task or phantom reply",
      status: "passed",
    });
  }
  await page.goto("http://localhost:4317/app/memories");
  await page.getByRole("button", { name: "Add memory", exact: true }).first().click();
  await page
    .getByLabel("Memory name", { exact: true })
    .fill("Preferred reporting language");
  await page
    .getByLabel("Approved content", { exact: true })
    .fill(
      "Write executive summaries in Traditional Chinese. Preserve HKD amounts and all source dates.",
    );
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await page
    .getByRole("heading", { name: "Preferred reporting language", exact: true })
    .waitFor();
  await screenshot(page, "copypaste-web", "08-memory-preferences");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Approved content", { exact: true })
    .fill(
      "Write bilingual executive summaries. Preserve HKD amounts and cite every source date.",
    );
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await page
    .getByText(
      "Write bilingual executive summaries. Preserve HKD amounts and cite every source date.",
      { exact: true },
    )
    .waitFor();
  const memory = (await request(page, base + "/memories")).body.items[0];
  assert.equal(memory.version, 2);
  checks.push({
    name: "personal memory creates an immutable new content version",
    status: "passed",
  });
  await page.goto("http://localhost:4317/app/conversations");
  await page
    .getByPlaceholder("Search conversations…")
    .fill("Autumn campaign review");
  await page
    .getByRole("heading", { name: "Autumn campaign review", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Autumn campaign review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Conversation settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Archive conversation", exact: true })
    .click();
  await page.getByRole("button", { name: "Unarchive", exact: true }).waitFor();
  await page.getByRole("button", { name: "Unarchive", exact: true }).click();
  await page.getByLabel("Message purpose").waitFor();
  checks.push({
    name: "pin, rename, search, archive and unarchive conversation",
    status: "passed",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Message purpose").waitFor();
  await page.waitForFunction(() => document.querySelector(".sidebar")!.getBoundingClientRect().right <= 0);
  assert.equal(await page.locator(".sidebar").getAttribute("inert"), "");
  await screenshot(page, "copypaste-web", "09-conversation-mobile");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => {
    localStorage.setItem("cp_theme", "dark");
    location.reload();
  });
  await page.getByLabel("Message purpose").waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await screenshot(page, "copypaste-web", "10-conversation-dark");
  checks.push({
    name: "responsive private conversation at 390px and dark theme",
    status: "passed",
  });
  const operator = JSON.parse(
    await readFile(path.join(platform, ".data/qa/operator.json"), "utf8"),
  );
  const admin = await context.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto("http://localhost:4318");
  await admin.getByLabel("Administrator email").fill(operator.email);
  await admin.getByRole("button", { name: "Send admin sign-in code" }).click();
  await admin
    .getByLabel("Email code", { exact: true })
    .fill(await code(operator.email));
  await admin
    .getByLabel("Authenticator MFA code")
    .fill(totp(operator.totp_secret));
  await admin
    .getByRole("button", { name: "Verify & open dashboard", exact: true })
    .click();
  await admin.waitForURL("**/overview");
  const adminBody = await request(
    admin,
    "/v1/admin/content/" + conversation + "/body",
  );
  assert.equal(adminBody.status, 200);
  assert.match(adminBody.body.text, /compare Google and Meta/);
  await admin.goto("http://localhost:4318/content");
  await admin.waitForLoadState("networkidle");
  await screenshot(admin, "copypaste-admin", "03-private-content-governance");
  const quarantine = await request(
    admin,
    "/v1/admin/content/" + conversation + "/action",
    "POST",
    {
      action: "quarantine",
      version: 1,
      reason: "Controlled private conversation browser QA",
    },
  );
  assert.equal(quarantine.status, 200);
  assert.equal(
    (await request(page, base + "/conversations/" + conversation)).status,
    404,
  );
  checks.push({
    name: "separate admin email and MFA; authorized private body read and immediate quarantine",
    status: "passed",
  });
  // Close out the test's own content using normal authorized routes.
  await request(
    admin,
    "/v1/admin/content/" + conversation + "/action",
    "POST",
    {
      action: "restore",
      version: 2,
      reason: "Restore controlled browser QA content",
    },
  );
  await page.goto("http://localhost:4317/app/memories");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByLabel("I understand and confirm deletion").check();
  await page
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Keep the details that matter.",
      exact: true,
    })
    .waitFor();
  await page.goto("http://localhost:4317/app/conversations/" + conversation);
  await page
    .getByRole("button", { name: "Conversation settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await page.getByLabel("I understand and confirm deletion").check();
  await page
    .getByRole("button", {
      name: "Permanently delete conversation content",
      exact: true,
    })
    .click();
  await page.waitForURL("**/app/conversations");
  assert.equal(
    (await request(page, base + "/conversations/" + conversation)).status,
    404,
  );
  assert.equal((await request(page, base + "/memories")).body.items.length, 0);
  checks.push({
    name: "explicit destructive confirmation deletes owned memory and conversation",
    status: "passed",
  });
  if (errors.length) throw new Error(errors.join("\n"));
} catch (e: any) {
  checks.push({
    name: "persistent work browser journey",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  await context?.close();
  await browser.close();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/persistent-work.json",
    JSON.stringify(
      { at: new Date().toISOString(), checks, errors, browser_closed: true },
      null,
      2,
    ),
  );
}
