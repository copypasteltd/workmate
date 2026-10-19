import { chromium, type Browser, type Page } from "playwright";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode } from "./qa-auth.js";
const origin = "http://localhost:4310",
  web = "http://localhost:4317",
  email = "auth-navigation-" + randomUUID() + "@example.invalid";
const checks: { name: string; status: string }[] = [],
  errors: string[] = [];
const observed: { method: string; path: string; status: number }[] = [];
const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  scope:
    "Real canonical Web email sign-in and user-activated cross-origin S256 consent to an owned loopback callback; actual token exchange and sign-out. Does not replace current Electron/MV3 first-exchange acceptance.",
  model_calls: 0,
};
let browser: Browser | undefined,
  page: Page | undefined,
  tokens: any,
  closed = false;
const state = randomBytes(32).toString("base64url"),
  verifier = randomBytes(32).toString("base64url");
let callbackResolve!: (code: string) => void;
const callback = new Promise<string>((resolve) => (callbackResolve = resolve));
const listener = createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  if (
    u.pathname !== "/callback" ||
    u.searchParams.get("state") !== state ||
    !u.searchParams.get("code")
  ) {
    res.writeHead(400).end();
    return;
  }
  callbackResolve(u.searchParams.get("code")!);
  res
    .writeHead(200, {
      "content-type": "text/plain",
      "content-security-policy": "default-src 'none'",
    })
    .end("Owned authentication check completed.");
});
const pass = (name: string) => {
  checks.push({ name, status: "passed" });
  console.log("PASS: " + name);
};
try {
  assert.equal(
    (await (await fetch(origin + "/v1/public/config")).json()).data_mode,
    "simulated",
  );
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  const redirect = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/callback`;
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.WEB_CHROME_BIN ??
      process.env.CHROME_BIN ??
      chromium.executablePath(),
    args: ["--disable-gpu"],
  });
  report.browser_version = browser.version();
  report.executable =
    process.env.WEB_CHROME_BIN ??
    process.env.CHROME_BIN ??
    chromium.executablePath();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (response) => {
    const u = new URL(response.url());
    if (
      [
        "/v1/auth/challenges",
        "/v1/auth/sessions",
        "/v1/auth/authorize",
        "/v1/me",
        "/v1/session/context",
        "/v1/me/sessions",
      ].includes(u.pathname)
    )
      observed.push({
        method: response.request().method(),
        path: u.pathname,
        status: response.status(),
      });
  });
  await page.goto(
    web +
      "/login?next=" +
      encodeURIComponent("https://external.example.invalid/"),
    { waitUntil: "domcontentloaded" },
  );
  await page.locator('input[name="email"]').fill(email);
  const otp = await emailCode(page, () =>
    page!.locator('form button[type="submit"]').click(),
  );
  await page.locator('input[name="code"]').fill(otp);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  assert.equal(new URL(page.url()).origin, web);
  assert.ok(
    observed.some((r) => r.path === "/v1/auth/challenges" && r.status === 202),
  );
  assert.ok(
    observed.some((r) => r.path === "/v1/auth/sessions" && r.status === 201),
  );
  pass(
    "real canonical 202/201 email login stays inside the product when given an external return target",
  );
  const query = new URLSearchParams({
    client_id: "desktop",
    redirect_uri: redirect,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
  });
  await page.goto(web + "/authorize?" + query, {
    waitUntil: "domcontentloaded",
  });
  const link = page.getByRole("link", {
    name: "Authorize & return",
    exact: true,
  });
  await link.waitFor();
  const target = new URL((await link.getAttribute("href"))!, web);
  assert.equal(target.pathname, "/v1/auth/authorize");
  assert.equal(target.searchParams.get("code_challenge_method"), "S256");
  assert.equal(await link.getAttribute("referrerpolicy"), "origin");
  await page.screenshot({
    path: path.resolve(
      "../copypaste-web/assets/screenshots/52-native-authorization.png",
    ),
    fullPage: true,
    animations: "disabled",
  });
  await link.click();
  const code = await Promise.race([
    callback,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Owned loopback callback timed out")),
        15000,
      );
      timer.unref();
    }),
  ]);
  const exchange = await fetch(origin + "/v1/auth/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: "desktop",
      redirect_uri: redirect,
      code,
      code_verifier: verifier,
    }),
  });
  assert.equal(exchange.status, 201);
  tokens = await exchange.json();
  assert.equal(tokens.token_type, "Bearer");
  assert.ok(
    observed.some((r) => r.path === "/v1/auth/authorize" && r.status === 302),
  );
  pass(
    "a normal user click navigates to canonical GET consent, reaches the owned loopback with matching state and exchanges its S256 code for real 201 tokens",
  );
  await page.goto(web + "/welcome", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="name"]').fill("Synthetic profile workspace");
  await page
    .locator('input[name="project_name"]')
    .fill("Profile contract checks");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  await page.goto(web + "/app/settings", { waitUntil: "domcontentloaded" });
  await page.locator('.session-row[data-client="web"]').waitFor();
  const profileResponse = await context.request.get(origin + "/v1/me");
  assert.equal(profileResponse.status(), 200);
  const profile = await profileResponse.json();
  assert.deepEqual(Object.keys(profile).sort(), [
    "display_name",
    "email",
    "id",
  ]);
  assert.equal(profile.email, email);
  const nativeProfileResponse = await context.request.get(origin + "/v1/me", {
    headers: { Authorization: "Bearer " + tokens.access_token },
  });
  assert.equal(nativeProfileResponse.status(), 200);
  const nativeProfile = await nativeProfileResponse.json();
  assert.deepEqual(nativeProfile, profile);
  const meResponse = await context.request.get(origin + "/v1/session/context");
  assert.equal(meResponse.status(), 200);
  const me = await meResponse.json();
  assert.equal(me.user.id, profile.id);
  assert.ok(me.csrf_token);
  await writeFile(
    "evidence/auth-profile-contract-samples.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin,
        scope:
          "Actual HTTP User responses from canonical GET /v1/me; only synthetic account profile fields, no session credentials",
        samples: [
          {
            schema: "User",
            method: "GET",
            path: "/v1/me",
            credential: "browser",
            response: profile,
          },
          {
            schema: "User",
            method: "GET",
            path: "/v1/me",
            credential: "native",
            response: nativeProfile,
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  pass(
    "canonical browser and native current-user responses expose only User fields; workspace bootstrap loads separately with browser CSRF",
  );
  const signout = await context.request.delete(origin + "/v1/auth/session", {
    headers: { "X-CSRF-Token": me.csrf_token, "Idempotency-Key": randomUUID() },
  });
  assert.equal(signout.status(), 200);
  const repeated = await context.request.delete(origin + "/v1/auth/session", {
    headers: { "Idempotency-Key": randomUUID() },
  });
  assert.equal(repeated.status(), 200);
  assert.equal(
    (await context.cookies(origin + "/v1/auth/session")).some((c) =>
      ["cp_session", "cp_auth_flow"].includes(c.name),
    ),
    false,
  );
  pass(
    "canonical browser sign-out clears both product cookies and safely accepts a repeated signed-out request",
  );
} catch (error) {
  if (page && !page.isClosed()) {
    report.failure_page_path = new URL(page.url()).pathname;
    try {
      await page.screenshot({
        path: "evidence/auth-context-failure.png",
        fullPage: true,
        timeout: 5000,
      });
      report.failure_screenshot = "auth-context-failure.png";
    } catch {
      report.failure_screenshot = "unavailable";
    }
  }
  errors.push(error instanceof Error ? error.stack! : String(error));
  process.exitCode = 1;
} finally {
  if (tokens)
    await fetch(origin + "/v1/auth/native/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: "desktop",
        refresh_token: tokens.refresh_token,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => errors.push("Owned native fixture revocation failed"));
  if (browser) {
    await browser.close();
    closed = true;
  }
  listener.closeAllConnections();
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  Object.assign(report, { checks, errors, observed, browser_closed: closed });
  await writeFile(
    "evidence/auth-navigation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({ checks: checks.length, errors, browser_closed: closed }),
  );
  if (errors.length) process.exitCode = 1;
}
