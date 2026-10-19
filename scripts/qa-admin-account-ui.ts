import {
  chromium,
  type BrowserServer,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode, verifyAdmin } from "./qa-auth.js";

const platform = path.resolve("../copypaste-platform"),
  requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth");
const checks: any[] = [],
  errors: string[] = [],
  screenshots: string[] = [],
  contexts: BrowserContext[] = [];
let server: BrowserServer | undefined,
  browser: Browser | undefined,
  db: any,
  principal: string | undefined,
  user: string | undefined,
  closed = false,
  stage = "initializing";
const pass = (name: string) => checks.push({ name, status: "passed" });
const deadline = setTimeout(() => {
  errors.push(
    "Owned browser verification exceeded its 150 second bound at " + stage,
  );
  void server?.kill();
}, 150000);
async function screenshot(page: Page, name: string) {
  const folder = path.resolve("../copypaste-admin/assets/screenshots");
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, name),
    fullPage: true,
    timeout: 10000,
  });
  screenshots.push(name);
}
async function manage(page: Page) {
  await page
    .getByRole("button", { name: "Manage account", exact: true })
    .click();
  const d = page.getByRole("dialog", {
    name: "Manage user account",
    exact: true,
  });
  await d.getByLabel("Action", { exact: true }).waitFor();
  return d;
}
try {
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { seal } = await import(
      pathToFileURL(path.join(platform, "src/lib.ts")).href
    ),
    email = `account-ui-admin-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  principal = (
    await db.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic UI account operator',$2) RETURNING id",
      [email, seal(env.MASTER_KEY!, secret.base32)],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
    [principal],
  );
  user = (
    await db.query(
      "INSERT INTO users(email,name) VALUES($1,'Synthetic UI customer') RETURNING id",
      [`account-ui-user-${randomUUID()}@example.invalid`],
    )
  ).rows[0].id;
  stage = "owned Chromium launch";
  server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
    args: ["--disable-gpu"],
    timeout: 15000,
  });
  browser = await chromium.connect(server.wsEndpoint(), { timeout: 15000 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  stage = "Admin email and TOTP login";
  await page.goto("http://localhost:4318", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  await page.getByLabel("Administrator email").fill(email);
  const otp = await emailCode(
    page,
    () =>
      page
        .getByRole("button", { name: "Send admin sign-in code", exact: true })
        .click(),
    true,
  );
  await page.locator('input[name="code"]').fill(otp);
  await verifyAdmin(page, secret.base32);
  await page.waitForURL("**/overview");
  pass("actual email and TOTP Admin sign-in into the current built dashboard");
  stage = "profile preview and confirmation";
  await page.goto(`http://localhost:4318/users/${user}`, {
    waitUntil: "domcontentloaded",
  });
  let d = await manage(page);
  await d
    .getByLabel("Action", { exact: true })
    .selectOption("users.profile.write");
  await d
    .getByLabel("Display name", { exact: true })
    .fill("Marketing account UI pilot");
  await d
    .getByLabel("Labels (comma separated)", { exact: true })
    .fill("marketing, pilot");
  await d
    .getByLabel("Reason", { exact: true })
    .fill("Confirmed customer profile correction");
  await d.getByRole("button", { name: "Preview changes", exact: true }).click();
  await d
    .getByText("Synthetic UI customer → Marketing account UI pilot", {
      exact: true,
    })
    .waitFor();
  await screenshot(page, "54-account-profile-preview.png");
  await d.getByRole("button", { name: "Confirm change", exact: true }).click();
  await d
    .getByText("The operation is complete and recorded in the audit log.", {
      exact: true,
    })
    .waitFor();
  const row = (
    await db.query("SELECT name,labels,version FROM users WHERE id=$1", [user])
  ).rows[0];
  assert.equal(row.name, "Marketing account UI pilot");
  assert.deepEqual(row.labels, ["marketing", "pilot"]);
  assert.equal(row.version, 2);
  await d.getByRole("button", { name: "Done", exact: true }).click();
  pass(
    "profile labels and name use frozen before/after preview and explicit confirmation; success remains visible until dismissed",
  );
  stage = "account freeze";
  d = await manage(page);
  await d.getByLabel("Requested state", { exact: true }).selectOption("frozen");
  await d
    .getByLabel("Reason", { exact: true })
    .fill("Customer requested temporary suspension");
  await d.getByRole("button", { name: "Preview changes", exact: true }).click();
  await d.getByRole("button", { name: "Confirm change", exact: true }).click();
  await d.getByRole("button", { name: "Done", exact: true }).waitFor();
  assert.equal(
    (await db.query("SELECT status FROM users WHERE id=$1", [user])).rows[0]
      .status,
    "suspended",
  );
  await d.getByRole("button", { name: "Done", exact: true }).click();
  pass("user freeze is confirmed through the canonical status command");
  stage = "closure and frozen review";
  d = await manage(page);
  await d.getByLabel("Requested state", { exact: true }).selectOption("closed");
  await d
    .getByLabel("Reason", { exact: true })
    .fill("Customer requested reviewed account closure");
  await d.getByRole("button", { name: "Preview changes", exact: true }).click();
  await d
    .getByRole("button", { name: "Submit for independent review", exact: true })
    .click();
  await d
    .getByText(
      "Saved for independent review. Account state has not changed yet.",
      { exact: true },
    )
    .waitFor();
  const pending = (
    await db.query(
      "SELECT id FROM admin_operations WHERE principal_id=$1 AND state='pending_approval' ORDER BY created_at DESC LIMIT 1",
      [principal],
    )
  ).rows[0];
  assert.ok(pending);
  await d
    .getByRole("link", { name: "View operation records", exact: true })
    .click();
  await page.waitForURL(
    (u) =>
      u.pathname === "/audit" &&
      u.searchParams.get("view") === "approvals" &&
      u.searchParams.get("search") === pending.id,
  );
  await page.getByTitle("Review operation", { exact: true }).click();
  const review = page.getByRole("dialog", {
    name: "Independent review",
    exact: true,
  });
  await review
    .getByText("Customer requested reviewed account closure", { exact: true })
    .waitFor();
  await review.getByText("Requested state", { exact: true }).waitFor();
  await screenshot(page, "55-account-closure-review.png");
  await review
    .getByLabel("Reason", { exact: true })
    .fill("Self-review must be refused");
  await review
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await review.getByRole("alert").waitFor();
  assert.equal(
    (
      await db.query("SELECT state FROM admin_operations WHERE id=$1", [
        pending.id,
      ])
    ).rows[0].state,
    "pending_approval",
  );
  pass(
    "closure stays pending, review renders the exact frozen command and self-approval is rejected visibly",
  );
  await page.keyboard.press("Escape");
  stage = "responsive themes and labels";
  for (const [locale, theme] of [
    ["en", "light"],
    ["zh-HK", "dark"],
  ]) {
    await page.evaluate(
      ({ locale, theme }) => {
        localStorage.setItem("cp_locale", locale);
        localStorage.setItem("cp_theme", theme);
      },
      { locale, theme },
    );
    await page.goto(`http://localhost:4318/users/${user}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", {
        name: locale === "en" ? "Manage account" : "編輯帳戶",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").first().waitFor();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const overflow = await dialog.evaluate(
        (el) => el.scrollWidth > el.clientWidth + 1,
      );
      assert.equal(overflow, false, `${locale}/${theme}/${width}`);
    }
    if (theme === "dark")
      await screenshot(page, "56-account-control-dark-zh.png");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
  }
  pass(
    "account controls fit three viewport widths, English/light and Traditional Chinese/dark, with keyboard dismissal",
  );
} catch (e) {
  errors.push(stage + ": " + (e as Error).message);
} finally {
  try {
    await Promise.race([
      Promise.all(contexts.map((c) => c.close())),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("context close timeout")), 5000),
      ),
    ]);
    await Promise.race([
      browser?.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("browser close timeout")), 5000),
      ),
    ]);
    await server?.close();
    closed = true;
  } catch {
    await server?.kill();
    closed = true;
  }
  clearTimeout(deadline);
  if (db) {
    try {
      if (principal) {
        await db.query(
          "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE admin_id=$1",
          [principal],
        );
        await db.query(
          "UPDATE admin_principals SET status='suspended',auth_version=auth_version+1,version=version+1 WHERE id=$1",
          [principal],
        );
        await db.query(
          "UPDATE admin_operations SET state='cancelled',version=version+1 WHERE principal_id=$1 AND state='pending_approval'",
          [principal],
        );
      }
    } catch {
      errors.push("Owned fixture cleanup failed");
    } finally {
      await db.end();
    }
  }
  await writeFile(
    "evidence/admin-account-ui.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope:
          "New current-source Admin account form only, owned software-rendered headless Chromium; no full native/client acceptance",
        checks,
        errors,
        screenshots,
        closed,
        model_calls: 0,
        user_browser_tabs_touched: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ checks: checks.length, errors, closed, screenshots }),
  );
  if (errors.length) process.exitCode = 1;
}
