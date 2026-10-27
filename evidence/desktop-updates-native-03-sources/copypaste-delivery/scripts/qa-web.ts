import { emailCode, verifyAdmin } from "./qa-auth.js";
import { chromium, type Page, type BrowserContext } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
const root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform");
const binary = process.env.CHROME_BIN ?? chromium.executablePath();
const evidence: { name: string; status: string; detail?: string }[] = [];
const errors: string[] = [];
async function screenshot(page: Page, repo: string, name: string) {
  const dir = path.join(root, repo, "assets/screenshots");
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
}
async function json(page: Page, url: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const me = await (
        await fetch("/v1/session/context", { credentials: "include" })
      ).json();
      const r = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body:
          body === undefined
            ? method === "GET"
              ? undefined
              : "{}"
            : JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      return data;
    },
    { url, method, body },
  );
}
const { execFileSync } = await import("node:child_process");
execFileSync(
  process.execPath,
  ["--env-file=.env", "--import", "tsx", "scripts/qa-fixture.ts"],
  { cwd: platform, stdio: "pipe" },
);
const browser = await chromium.launch({
  executablePath: binary,
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
  await page.goto("http://localhost:4317");
  await page.getByRole("heading", { name: "Good ideas. Made real." }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await screenshot(page, "copypaste-web", "01-landing");
  await page.getByRole("link", { name: "Get started", exact: true }).click();
  await page.getByLabel("Work email").waitFor();
  await screenshot(page, "copypaste-web", "02-login");
  const email = `avery-${randomUUID().slice(0, 8)}@example.invalid`;
  await page.getByLabel("Work email").fill(email);
  const userCode = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(userCode);
  await page
    .getByRole("button", { name: /Verify.*|Sign in.*|Open workspace/ })
    .last()
    .click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour Studio");
  await page.locator('input[name="project_name"]').fill("Autumn campaign");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  await page.getByRole("heading").first().waitFor();
  await json(page, "/v1/me", "PATCH", { name: "Avery Chan" });
  const me = await json(page, "/v1/session/context");
  const tenant = me.memberships[0].id;
  const projects = await json(page, `/v1/tenants/${tenant}/projects`);
  const base = `/v1/tenants/${tenant}/projects/${projects.items[0].id}`;
  const imageAsset = await page.evaluate(async (base) => {
    const me = await (await fetch("/v1/session/context")).json();
    const bytes = await (await fetch("/copypaste-folds.png")).blob();
    const form = new FormData();
    form.append("file", bytes, "Blue folds · reference.png");
    const r = await fetch(base + "/assets", {
      method: "POST",
      headers: {
        "X-CSRF-Token": me.csrf_token,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: form,
    });
    const body = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(body));
    return body;
  }, base);
  await json(page, base + "/brand", "POST", {
    name: "Harbour Studio",
    colors: ["#1F5EFF", "#F6F6F4"],
    tone: "Warm, clear and thoughtful",
    approved_copy: "為每個好想法，留一點空間。",
    fonts: [],
  });
  const dataset = await json(page, base + "/analytics/import", "POST", {
    name: "Autumn launch · Google & Meta",
    timezone: "Asia/Hong_Kong",
    csv: "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Autumn Search,25000,1750,3500.00,75,16500.00,HKD\n2026-10-01,Meta,Autumn Social,42000,2100,2800.00,62,12400.00,HKD\n2026-10-02,Google,Autumn Search,28000,2100,4200.00,96,21120.00,HKD\n2026-10-02,Meta,Autumn Social,39000,2028,2636.40,58,11600.00,HKD",
  });
  const creative = await json(page, base + "/creative", "POST", {
    name: "Make room · brand poster",
    body: {
      width: 1080,
      height: 1350,
      background: "#F6F6F4",
      layers: [
        {
          type: "image",
          asset_id: imageAsset.id,
          version: imageAsset.current_version,
          x: 410,
          y: 80,
          width: 590,
          height: 430,
        },
        {
          type: "rect",
          x: 80,
          y: 90,
          width: 120,
          height: 8,
          color: "#1F5EFF",
          radius: 4,
        },
        {
          type: "text",
          text: "HARBOUR STUDIO · HONG KONG",
          x: 80,
          y: 190,
          font_size: 25,
          color: "#15171A",
          font_family: "sans",
          weight: "normal",
        },
        {
          type: "text",
          text: "Make room for",
          x: 80,
          y: 570,
          font_size: 76,
          color: "#15171A",
          font_family: "serif",
          weight: "normal",
        },
        {
          type: "text",
          text: "possibility.",
          x: 80,
          y: 675,
          font_size: 100,
          color: "#1F5EFF",
          font_family: "serif",
          weight: "normal",
        },
        {
          type: "text",
          text: "為每個好想法，留一點空間。",
          x: 80,
          y: 1170,
          font_size: 32,
          color: "#15171A",
          font_family: "sans",
          weight: "normal",
        },
      ],
    },
  });
  await json(page, base + "/creative/" + creative.id + "/render", "POST", {
    format: "svg",
  });
  await json(page, base + "/creative/" + creative.id + "/render", "POST", {
    format: "png",
  });
  const motion = await json(
    page,
    base + "/creative/" + creative.id + "/render",
    "POST",
    { format: "mp4", duration: 3, effect: "fade" },
  );
  if (motion.kind !== "motion_creative")
    throw new Error("No actual motion artifact");
  const workflow = await json(page, base + "/workflows", "POST", {
    name: "Campaign review · weekly",
    definition: {
      steps: [
        { kind: "analytics.summary", dataset_id: dataset.id },
        {
          kind: "approval",
          message: "Review campaign metrics before distribution",
        },
      ],
    },
  });
  await json(page, base + "/workflows/" + workflow.id + "/publish", "POST");
  await json(page, base + "/workflows/" + workflow.id + "/run", "POST");
  const routes = [
    "",
    "roles",
    "projects",
    "creative",
    "assets",
    "analytics",
    "workflows",
    "brand",
    "members",
    "connections",
    "devices",
    "usage",
    "settings",
  ];
  for (const route of routes) {
    await page.goto("http://localhost:4317/app" + (route ? "/" + route : ""));
    await page.waitForLoadState("networkidle");
    if (route === "assets")
      await page.locator(".thumbnail-mount img").first().waitFor();
    await screenshot(page, "copypaste-web", "03-" + (route || "workspace"));
    evidence.push({ name: "web:" + (route || "workspace"), status: "passed" });
    if (await page.locator('[role="alert"]').count())
      errors.push(
        "Web alert on " +
          route +
          ": " +
          (await page.locator('[role="alert"]').first().innerText()),
      );
  }
  await page.goto("http://localhost:4317/app/analytics");
  await page.evaluate(() => {
    localStorage.setItem("cp_theme", "dark");
    location.reload();
  });
  await page.waitForLoadState("networkidle");
  await screenshot(page, "copypaste-web", "04-analytics-dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:4317/app");
  await page.waitForLoadState("networkidle");
  await screenshot(page, "copypaste-web", "05-mobile");
  await page.setViewportSize({ width: 1440, height: 1080 });
  const operator = JSON.parse(
    await readFile(path.join(platform, ".data/qa/operator.json"), "utf8"),
  );
  const admin = await context.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto("http://localhost:4318");
  await admin.getByLabel("Administrator email").fill(operator.email);
  const adminCode = await emailCode(
    admin,
    () =>
      admin.getByRole("button", { name: "Send admin sign-in code" }).click(),
    true,
  );
  await admin.locator('input[name="code"]').fill(adminCode);
  await verifyAdmin(admin, operator.totp_secret);
  await admin.waitForURL("**/overview");
  const adminRequest = async (url: string, body: any) =>
    admin.evaluate(
      async ({ url, body }) => {
        const me = await (await fetch("/v1/admin/me")).json();
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": me.csrf_token,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(JSON.stringify(data));
        return data;
      },
      { url, body },
    );
  for (const command of [
    {
      action: "billing.top_up",
      tenant_id: tenant,
      amount_micros: 800_000_000,
      reference: "QA-DEMO-" + randomUUID(),
      reason: "Confirmed pilot subscription payment",
    },
    {
      action: "entitlements.grant",
      tenant_id: tenant,
      plan: "business",
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      reason: "Pilot marketing team access",
    },
  ]) {
    const p = await adminRequest("/v1/admin/operations/preview", command);
    const done = await adminRequest("/v1/admin/operations/commit", {
      preview_id: p.id,
      payload_hash: p.payload_hash,
    });
    if (done.state !== "succeeded")
      throw new Error("Admin grant did not commit");
  }
  for (const route of [
    "overview",
    "users",
    "tenants",
    "usage",
    "billing",
    "entitlements",
    "content",
    "execution",
    "catalog",
    "connections",
    "access",
    "support",
    "audit",
    "jobs",
    "plans",
    "policy",
  ]) {
    await admin.goto("http://localhost:4318/" + route);
    await admin.waitForLoadState("networkidle");
    await screenshot(admin, "copypaste-admin", "01-" + route);
    if (await admin.locator('[role="alert"]').count())
      errors.push(
        "Admin alert " +
          route +
          ": " +
          (await admin.locator('[role="alert"]').first().innerText()),
      );
    evidence.push({ name: "admin:" + route, status: "passed" });
  }
  await admin.goto("http://localhost:4318/users/" + me.user.id);
  await admin.waitForLoadState("networkidle");
  await screenshot(admin, "copypaste-admin", "02-user-detail");
  await mkdir(".data", { recursive: true });
  await writeFile(
    ".data/qa-user.json",
    JSON.stringify({ email, tenant, project: projects.items[0].id }),
  );
  evidence.push({
    name: "email login, onboarding, assets, analytics, workflow, billing, VIP",
    status: "passed",
  });
  if (errors.length) throw new Error(errors.join("\n"));
} catch (e: any) {
  evidence.push({ name: "journey", status: "failed", detail: e.message });
  throw e;
} finally {
  await context?.close();
  await browser.close();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/web-admin.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks: evidence,
        errors,
        browser_closed: true,
      },
      null,
      2,
    ),
  );
}
