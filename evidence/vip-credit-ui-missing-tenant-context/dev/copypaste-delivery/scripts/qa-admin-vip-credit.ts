import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
} from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  origin = "http://localhost:4310",
  admin = "http://localhost:4318",
  web = "http://localhost:4317",
  requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth"),
  sha = (data: string | Buffer) =>
    createHash("sha256").update(data).digest("hex");
type Client = { id: string; cookie: string; csrf: string; user?: boolean };
const clients: Client[] = [],
  principals: string[] = [],
  contexts: BrowserContext[] = [],
  samples: any[] = [],
  checks: any[] = [],
  errors: string[] = [],
  screenshots: string[] = [],
  screenshotFacts: any[] = [];
let db: any,
  browser: Browser | undefined,
  server: BrowserServer | undefined,
  stage = "initializing",
  closed = false,
  sessionsClosed = false,
  adminsDisabled = false,
  check: (schema: string, data: unknown) => void;
const pass = (name: string) => checks.push({ name, status: "passed" });
async function sourceSnapshot() {
  const files: string[] = [];
  for (const repo of [
    "copypaste-platform",
    "copypaste-admin",
    "copypaste-web",
    "copypaste-desktop",
    "copypaste-extension",
  ]) {
    const list = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: path.resolve("..", repo), encoding: "utf8", windowsHide: true },
    ).split("\0");
    for (const f of list)
      if (
        /^(src|renderer|migrations|catalog|contracts|public)\//.test(f) ||
        /^(package(-lock)?|tsconfig)\.json$/.test(f)
      )
        files.push(`${repo}/${f}`);
  }
  files.push("copypaste-delivery/scripts/qa-admin-vip-credit.ts");
  return Object.fromEntries(
    await Promise.all(
      files
        .sort()
        .map(async (f) => [f, sha(await readFile(path.resolve("..", f)))]),
    ),
  );
}
const beforeSources = await sourceSnapshot();
const deadline = setTimeout(() => {
  errors.push("Owned VIP QA exceeded 360 seconds at " + stage);
  void server?.kill();
}, 360000);
async function call(
  c: Client | undefined,
  method: string,
  endpoint: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await fetch(origin + endpoint, {
    method,
    headers: {
      Origin:
        c?.user ||
        endpoint.startsWith("/v1/auth/") ||
        endpoint === "/v1/tenants" ||
        endpoint.startsWith("/v1/effective-entitlements") ||
        endpoint.startsWith("/v1/plans")
          ? web
          : admin,
      "Idempotency-Key": randomUUID(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(c ? { Cookie: c.cookie, "X-CSRF-Token": c.csrf } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
function sample(
  name: string,
  operation: string,
  schema: string,
  data: unknown,
  status = 200,
) {
  check(schema, data);
  samples.push({ name, operation, schema, status, response: data });
}
async function login(email: string, secret: any) {
  const challenge = await call(undefined, "POST", "/v1/admin/auth/challenge", {
    email,
  });
  assert.equal(challenge.status, 200);
  const until = Date.now() + 15000;
  let mail: any;
  while (Date.now() < until) {
    try {
      mail = JSON.parse(
        await readFile(
          path.join(
            platform,
            ".data/mailbox",
            challenge.data.challenge_id + ".json",
          ),
          "utf8",
        ),
      );
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.equal(mail?.to, email);
  const result = await call(undefined, "POST", "/v1/admin/auth/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    totp: new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const c = {
    id: "",
    cookie: result.headers
      .getSetCookie()
      .find((v) => v.startsWith("cp_admin_session="))!
      .split(";")[0],
    csrf: result.data.csrf_token,
  };
  clients.push(c);
  const me = await call(c, "GET", "/v1/admin/me");
  assert.equal(me.status, 200);
  c.id = me.data.user.id;
  c.csrf = me.data.csrf_token;
  return c;
}
async function pageFor(
  c: Client,
  width = 1440,
  locale = "en",
  theme = "light",
) {
  const context = await browser!.newContext({
    viewport: { width, height: 1080 },
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  const i = c.cookie.indexOf("=");
  await context.addCookies([
    {
      name: c.cookie.slice(0, i),
      value: c.cookie.slice(i + 1),
      url: c.user ? web : admin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(
    ({ locale, theme }) => {
      localStorage.setItem("cp_locale", locale);
      localStorage.setItem("cp_theme", theme);
    },
    { locale, theme },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function capture(page: Page, name: string, repo = "copypaste-admin") {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    document
      .querySelectorAll(".modal-backdrop")
      .forEach((e) => (e.scrollTop = 0));
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page must not overflow horizontally",
  );
  const folder = path.resolve("..", repo, "assets/screenshots");
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, name);
  await page.screenshot({
    path: file,
    fullPage: (await page.locator(".modal-backdrop").count()) === 0,
  });
  screenshots.push(name);
  screenshotFacts.push({
    file: "dev/" + repo + "/assets/screenshots/" + name,
    sha256: sha(await readFile(file)),
    url: page.url(),
    viewport: page.viewportSize(),
    locale: await page.evaluate(() => document.documentElement.lang),
    theme: await page.evaluate(() => document.documentElement.dataset.theme),
  });
}
async function waitResponse(
  page: Page,
  suffix: string,
  click: () => Promise<unknown>,
) {
  const pending = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith(suffix),
  );
  await click();
  return pending;
}
try {
  const configured = await (await fetch(origin + "/v1/public/config")).json();
  assert.equal(configured.data_mode, "simulated");
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const fixture = JSON.parse(
      await readFile(
        path.join(platform, "contracts/admin-vip-credit-schemas.json"),
        "utf8",
      ),
    ),
    specBytes = await readFile("../../docs/contracts/openapi.json"),
    spec = JSON.parse(specBytes.toString());
  assert.equal(fixture.normative_source_sha256, sha(specBytes));
  for (const [name, schema] of Object.entries(fixture.schemas))
    if (name !== "VipCreditCommand")
      assert.deepEqual(schema, spec.components.schemas[name]);
  const { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
    ajv = new Ajv2020({ allErrors: true });
  requirePlatform("ajv-formats")(ajv);
  const defs = JSON.parse(
    JSON.stringify({
      ...fixture.schemas,
      EffectiveEntitlements: spec.components.schemas.EffectiveEntitlements,
    }).replaceAll("#/components/schemas/", "#/$defs/"),
  );
  check = (schema, data) => {
    const v = ajv.compile({ $defs: defs, $ref: "#/$defs/" + schema });
    assert.ok(v(data), schema + JSON.stringify(v.errors));
  };
  const { seal } = await import(
    pathToFileURL(path.join(platform, "src/lib.ts")).href
  );
  for (let n = 0; n < 2; n++) {
    const secret = new OTPAuth.Secret({ size: 20 }),
      email = `vip-ui-${randomUUID()}@example.invalid`,
      p = (
        await db.query(
          "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
          [
            email,
            n ? "Synthetic VIP reviewer" : "Synthetic VIP operator",
            seal(env.MASTER_KEY!, secret.base32),
          ],
        )
      ).rows[0];
    principals.push(p.id);
    await db.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
      [p.id],
    );
    await login(email, secret);
  }
  const [operator, reviewer] = clients;

  stage = "owned user sign-in";
  const email = "vip-user-" + randomUUID() + "@example.invalid";
  const challenge = await call(undefined, "POST", "/v1/auth/challenge", {
    email,
  });
  assert.equal(challenge.status, 200);
  let mail: any;
  const mailboxDeadline = Date.now() + 15000;
  while (Date.now() < mailboxDeadline) {
    try {
      mail = JSON.parse(
        await readFile(
          path.join(
            platform,
            ".data/mailbox",
            challenge.data.challenge_id + ".json",
          ),
          "utf8",
        ),
      );
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.equal(mail?.to, email);
  const signedIn = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(signedIn.status, 200);
  const user: Client = {
    id: signedIn.data.user.id,
    user: true,
    cookie: signedIn.headers
      .getSetCookie()
      .find((v) => v.startsWith("cp_session="))!
      .split(";")[0],
    csrf: signedIn.data.csrf_token,
  };
  clients.push(user);
  const workspace = await call(user, "POST", "/v1/tenants", {
    name: "Synthetic VIP UI workspace",
    project_name: "Campaign",
  });
  assert.equal(workspace.status, 200, JSON.stringify(workspace.data));
  const tenant = workspace.data.tenant.id;
  const fixedPlan = (
    await db.query(
      "SELECT published_version_id AS id FROM commercial_plans WHERE legacy_key='pro'",
    )
  ).rows[0].id;
  const walletBefore = (
    await db.query(
      "SELECT id,balance_micros,reserved_micros,version FROM wallets WHERE user_id=$1 ORDER BY id",
      [user.id],
    )
  ).rows;
  pass(
    "real email user session and independent email/TOTP administrators; no model or external payment",
  );
  stage = "owned Chromium";
  server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
    args: ["--disable-gpu"],
    timeout: 15000,
  });
  browser = await chromium.connect(server.wsEndpoint());
  const localDate = (value: Date) =>
    new Date(value.getTime() - value.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  const comboRoot = "/v1/admin/vip-credit-combinations",
    pvRoot = "/v1/admin/vip-credit-previews";
  const wallet = walletBefore.find((w: any) => true);
  const actualWallet = (
    await call(
      operator,
      "GET",
      "/v1/admin/billing/accounts?subject_id=" + user.id,
    )
  ).data.items.find((a: any) => a.subject.kind === "user");
  assert.ok(actualWallet);
  const page = await pageFor(operator);
  await page.goto(admin + "/entitlements", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Grant VIP", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Grant VIP", exact: true });
  await dialog.getByLabel("Subject ID", { exact: true }).fill(user.id);
  await dialog
    .getByLabel("Published fixed plan version", { exact: true })
    .selectOption(fixedPlan);
  await dialog
    .getByLabel("Ends (local time)", { exact: true })
    .fill(localDate(new Date(Date.now() + 86400000)));
  await dialog
    .getByLabel("Include explicit credit with this VIP grant", { exact: true })
    .check();
  await dialog
    .getByLabel("Credit amount (HKD)", { exact: true })
    .fill("1.0000001");
  await dialog
    .getByLabel("Credit reason", { exact: true })
    .fill("Explicit synthetic welcome credit");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic VIP and gift atomic acceptance");
  await dialog
    .getByRole("button", { name: "Preview entitlement change", exact: true })
    .click();
  const alert = dialog.locator('[tabindex="-1"][role="alert"]');
  await alert.waitFor();
  assert.ok(await alert.evaluate((e) => e === document.activeElement));
  assert.equal(
    await dialog
      .getByLabel("Credit amount (HKD)", { exact: true })
      .inputValue(),
    "1.0000001",
  );
  await capture(page, "75-vip-credit-validation.png");
  pass(
    "exact HKD validation retains both commands, focuses error summary and exposes an inline input error",
  );
  await dialog
    .getByLabel("Credit amount (HKD)", { exact: true })
    .fill("12.500001");
  const previewResponse = await waitResponse(page, pvRoot, () =>
    dialog
      .getByRole("button", { name: "Preview entitlement change", exact: true })
      .click(),
  );
  assert.equal(previewResponse.status(), 200);
  const pv = await previewResponse.json();
  sample(
    "combined-preview",
    "supplemental:previewVipCredit",
    "AdminPreview",
    pv,
  );
  const frozenCommand = previewResponse.request().postDataJSON();
  check("VipCreditCommand", frozenCommand);
  await dialog
    .getByRole("heading", { name: "Explicit promotional credit", exact: true })
    .waitFor();
  await capture(page, "76-vip-credit-frozen.png");
  const before = await call(
    operator,
    "GET",
    comboRoot.replace("vip-credit-combinations", "billing/accounts") +
      "/" +
      frozenCommand.billing_account_id,
  );
  assert.equal(before.status, 200);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM vip_grants g JOIN entitlement_subjects s ON s.id=g.subject_id WHERE s.user_id=$1",
        [user.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query("SELECT balance_micros FROM wallets WHERE id=$1", [
        frozenCommand.billing_account_id,
      ])
    ).rows[0].balance_micros,
    "0",
  );
  pass(
    "one side-effect-free preview freezes exact original VIP and gift inputs, subject and wallet revisions",
  );
  stage = "stale wallet comparison";
  const penny = {
    action: "gift",
    expected_version: frozenCommand.gift.expected_version,
    reason: "Synthetic real version change before confirmation",
    amount: { currency: "HKD", amount_micros: "1" },
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  const pennyPreview = await call(
    operator,
    "POST",
    `/v1/admin/billing/accounts/${frozenCommand.billing_account_id}/previews`,
    penny,
  );
  const pennyResult = await call(
    operator,
    "POST",
    `/v1/admin/billing/accounts/${frozenCommand.billing_account_id}/gift`,
    penny,
    { "X-Admin-Preview-ID": pennyPreview.data.preview_id },
  );
  assert.equal(pennyResult.status, 202);
  await dialog.getByRole("checkbox").check();
  const stale = await waitResponse(page, comboRoot, () =>
    dialog
      .getByRole("button", { name: "Confirm submission", exact: true })
      .click(),
  );
  assert.equal(stale.status(), 409);
  await dialog.getByRole("alert").waitFor();
  await capture(page, "77-vip-credit-stale-confirmation.png");
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM vip_grants g JOIN entitlement_subjects s ON s.id=g.subject_id WHERE s.user_id=$1",
        [user.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query("SELECT balance_micros FROM wallets WHERE id=$1", [
        frozenCommand.billing_account_id,
      ])
    ).rows[0].balance_micros,
    "1",
  );
  await dialog
    .getByRole("button", {
      name: "Edit and create a fresh preview",
      exact: true,
    })
    .click();
  assert.equal(
    await dialog
      .getByLabel("Credit amount (HKD)", { exact: true })
      .inputValue(),
    "12.500001",
  );
  pass(
    "an actual wallet change rejects confirmation, preserves fields and creates neither requested effect",
  );
  const fresh = await waitResponse(page, pvRoot, () =>
    dialog
      .getByRole("button", { name: "Preview entitlement change", exact: true })
      .click(),
  );
  assert.equal(fresh.status(), 200);
  await dialog
    .getByRole("heading", { name: "Explicit promotional credit", exact: true })
    .waitFor();
  await dialog.getByRole("checkbox").check();
  const committed = await waitResponse(page, comboRoot, () =>
    dialog
      .getByRole("button", { name: "Confirm submission", exact: true })
      .click(),
  );
  assert.equal(committed.status(), 202);
  const done = await committed.json();
  assert.equal(done.state, "succeeded");
  sample(
    "combined-success",
    "supplemental:commitVipCredit",
    "AdminOperation",
    done,
    202,
  );
  await dialog
    .getByText("VIP and promotional credit both completed.", { exact: true })
    .waitFor();
  await capture(page, "78-vip-credit-both-completed.png");
  const detail = await call(operator, "GET", comboRoot + "/" + done.id);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.children.length, 2);
  for (const c of detail.data.children) {
    check("AdminOperation", c.operation);
    assert.equal(c.operation.state, "succeeded");
  }
  assert.equal(
    (
      await db.query("SELECT balance_micros FROM wallets WHERE id=$1", [
        frozenCommand.billing_account_id,
      ])
    ).rows[0].balance_micros,
    "12500002",
  );
  assert.equal(
    detail.data.result.credit_reference,
    "admin:" + detail.data.result.gift_operation_id,
  );
  pass(
    "one form confirmation returns one parent, two successful canonical children and exactly one explicit gift reference",
  );
  const rights = await call(user, "GET", "/v1/effective-entitlements");
  assert.equal(rights.status, 200);
  check("EffectiveEntitlements", rights.data);
  const ownBilling = await call(user, "GET", "/v1/me/billing-accounts");
  assert.equal(ownBilling.status, 200);
  const own = ownBilling.data.items.find(
    (a: any) => a.id === frozenCommand.billing_account_id,
  );
  assert.ok(own);
  assert.equal(own.promotional_balance.amount_micros, "12500002");
  const userPage = await pageFor(user);
  await userPage.goto(web + "/app/settings", { waitUntil: "domcontentloaded" });
  await userPage
    .getByRole("heading", { name: "Current entitlements", exact: true })
    .waitFor();
  await capture(userPage, "79-vip-credit-user-rights.png", "copypaste-web");
  pass(
    "the same real user reads effective rights and the exact promotional balance after the combined commit",
  );
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  stage = "combined independent review";
  await page.getByRole("button", { name: "Grant VIP", exact: true }).click();
  await dialog
    .getByLabel("Subject type", { exact: true })
    .selectOption("tenant");
  await dialog.getByLabel("Subject ID", { exact: true }).fill(tenant);
  await dialog
    .getByLabel("Published fixed plan version", { exact: true })
    .selectOption(fixedPlan);
  await dialog
    .getByLabel("Include explicit credit with this VIP grant", { exact: true })
    .check();
  await dialog.getByLabel("Credit amount (HKD)", { exact: true }).fill("10000");
  await dialog
    .getByLabel("Credit reason", { exact: true })
    .fill("Explicit high-value synthetic gift requiring review");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Combined workspace grant with independent approval");
  const pp = await waitResponse(page, pvRoot, () =>
    dialog
      .getByRole("button", { name: "Preview entitlement change", exact: true })
      .click(),
  );
  assert.equal(pp.status(), 200);
  assert.equal((await pp.json()).decision, "independent_approval");
  await dialog
    .getByRole("heading", { name: "Explicit promotional credit", exact: true })
    .waitFor();
  await dialog.getByRole("checkbox").check();
  const pendingResponse = await waitResponse(page, comboRoot, () =>
    dialog
      .getByRole("button", { name: "Confirm submission", exact: true })
      .click(),
  );
  const pending = await pendingResponse.json();
  assert.equal(pendingResponse.status(), 202);
  assert.equal(pending.state, "pending_approval");
  const empty = await call(operator, "GET", comboRoot + "/" + pending.id);
  assert.equal(empty.data.children.length, 0);
  await capture(page, "80-vip-credit-pending.png");
  const reviewPage = await pageFor(reviewer);
  await reviewPage.goto(admin + "/audit?view=approvals&search=" + pending.id, {
    waitUntil: "domcontentloaded",
  });
  await reviewPage
    .getByRole("button", { name: "Review operation", exact: true })
    .click();
  const review = reviewPage.getByRole("dialog", {
    name: "Independent review",
    exact: true,
  });
  await review
    .getByRole("heading", { name: "Explicit promotional credit", exact: true })
    .waitFor();
  await capture(reviewPage, "81-vip-credit-independent-review.png");
  await review.getByLabel("Decision", { exact: true }).selectOption("approve");
  await review
    .getByLabel("Review reason", { exact: true })
    .fill("Independently verify exact VIP and credit effects");
  const decided = await waitResponse(reviewPage, "/decisions", () =>
    review
      .getByRole("button", { name: "Confirm review decision", exact: true })
      .click(),
  );
  assert.equal(decided.status(), 202);
  const approved = await decided.json();
  assert.equal(approved.state, "succeeded");
  sample(
    "combined-independent-decision",
    "decideAdminApproval",
    "AdminOperation",
    approved,
    202,
  );
  await dialog
    .getByText("VIP and promotional credit both completed.", { exact: true })
    .waitFor();
  const reviewed = await call(operator, "GET", comboRoot + "/" + pending.id);
  assert.equal(reviewed.data.children.length, 2);
  pass(
    "one independent request freezes both commands; another real MFA administrator approves them together without pending effects",
  );
  stage = "responsive combined form";
  const small = await pageFor(operator, 375, "zh-HK", "dark");
  await small.goto(admin + "/entitlements", { waitUntil: "domcontentloaded" });
  await small.getByRole("button", { name: "開通 VIP", exact: true }).click();
  await small.getByLabel("歸屬 ID", { exact: true }).fill(user.id);
  await small
    .getByLabel("已發佈的固定方案版本", { exact: true })
    .selectOption(fixedPlan);
  await small
    .getByLabel("開始時間（本機時區）", { exact: true })
    .fill(localDate(new Date(Date.now() + 60 * 86400000)));
  await small
    .getByLabel("截止時間（本機時區）", { exact: true })
    .fill(localDate(new Date(Date.now() + 61 * 86400000)));
  await small.getByLabel("與 VIP 一併贈送明確額度", { exact: true }).check();
  await small.getByLabel("贈送金額（HKD）", { exact: true }).fill("0.000001");
  await small
    .getByLabel("贈額原因", { exact: true })
    .fill("Preview-only responsive synthetic credit");
  await small
    .getByLabel("操作原因", { exact: true })
    .fill("Preview-only responsive synthetic grant");
  await capture(small, "82-vip-credit-mobile-dark-form.png");
  const mobile = await waitResponse(small, pvRoot, () =>
    small.getByRole("button", { name: "預覽權益變更", exact: true }).click(),
  );
  assert.equal(mobile.status(), 200);
  await small
    .getByRole("heading", { name: "獨立贈送額度", exact: true })
    .waitFor();
  await capture(small, "83-vip-credit-mobile-dark-frozen.png");
  pass(
    "existing CopyPaste form and frozen review work in Traditional Chinese dark mode at 375px without horizontal overflow",
  );
  stage = "late permission withdrawal";
  await db.query("DELETE FROM admin_bindings WHERE principal_id=$1", [
    operator.id,
  ]);
  const denied = await call(operator, "GET", comboRoot + "/" + done.id);
  assert.equal(denied.status, 403);
  await small.getByRole("checkbox").check();
  const withdrawn = await waitResponse(small, comboRoot, () =>
    small.getByRole("button", { name: "確認提交", exact: true }).click(),
  );
  assert.equal(withdrawn.status(), 403);
  await small.getByRole("alert").waitFor();
  await capture(small, "84-vip-credit-permission-withdrawn.png");
  pass(
    "late authority withdrawal blocks an already-frozen confirmation and parent read without a partial business effect",
  );
} catch (e) {
  errors.push(stage + ": " + (e instanceof Error ? e.message : String(e)));
} finally {
  try {
    for (const c of contexts) await c.close();
    await browser?.close();
    await server?.close();
    closed = true;
  } catch {
    await server?.kill();
    closed = true;
  }
  clearTimeout(deadline);
  if (
    server &&
    server.process().exitCode === null &&
    server.process().signalCode === null
  ) {
    closed = false;
    errors.push("Owned Chromium process did not exit");
  }
  if (db && clients.length > 1)
    try {
      const pending = (
        await db.query(
          "SELECT r.* FROM admin_approval_requests r JOIN admin_operations o ON o.id=r.operation_id WHERE o.principal_id=ANY($1::uuid[]) AND r.state='pending' AND o.state='pending_approval'",
          [principals],
        )
      ).rows;
      for (const request of pending) {
        const reviewer = clients.find((c) => c.id !== request.requester_id)!;
        assert.equal(
          (
            await call(
              reviewer,
              "POST",
              `/v1/admin/approvals/${request.id}/decisions`,
              {
                expected_version: request.version,
                payload_hash: request.payload_hash,
                decision: "reject",
                reason: "Close unexecuted synthetic VIP QA request",
              },
            )
          ).status,
          202,
        );
      }
    } catch {
      errors.push("Owned pending VIP request cleanup failed");
    }
  for (const c of clients)
    try {
      if (
        (
          await call(
            c,
            "POST",
            c.user ? "/v1/auth/logout" : "/v1/admin/auth/logout",
          )
        ).status !== 200
      )
        errors.push("Owned logout failed");
    } catch {
      errors.push("Owned logout failed");
    }
  if (db)
    try {
      await db.query(
        "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE admin_id=ANY($1::uuid[])",
        [principals],
      );
      await db.query(
        "UPDATE admin_principals SET status='suspended',auth_version=auth_version+1,version=version+1 WHERE id=ANY($1::uuid[])",
        [principals],
      );
      sessionsClosed =
        Number(
          (
            await db.query(
              "SELECT count(*) AS n FROM sessions WHERE (admin_id=ANY($1::uuid[]) OR user_id=ANY($2::uuid[])) AND revoked_at IS NULL",
              [principals, clients.filter((c) => c.user).map((c) => c.id)],
            )
          ).rows[0].n,
        ) === 0;
      adminsDisabled =
        Number(
          (
            await db.query(
              "SELECT count(*) AS n FROM admin_principals WHERE id=ANY($1::uuid[]) AND status='active'",
              [principals],
            )
          ).rows[0].n,
        ) === 0;
    } catch {
      errors.push("Owned Admin cleanup failed");
    } finally {
      await db.end();
    }
  const afterSources = await sourceSnapshot(),
    unchanged = JSON.stringify(beforeSources) === JSON.stringify(afterSources);
  if (!unchanged) errors.push("VIP source changed during QA");
  const at = new Date().toISOString();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/admin-vip-credit.json",
    JSON.stringify(
      {
        at,
        status: errors.length ? "failed" : "passed",
        scope:
          "Atomic explicit VIP plus gift in the actual Admin form and shared independent review; local simulated dependencies, real authentication and database. Not complete production, installation, commercial or full acceptance coverage",
        checks,
        errors,
        screenshots,
        browser_closed: closed,
        user_browser_tabs_touched: false,
        owned_sessions_closed: sessionsClosed,
        owned_admin_principals_disabled: adminsDisabled,
        source_unchanged: unchanged,
        source_files: beforeSources,
        model_calls: 0,
        external_payments: 0,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/admin-vip-credit-contract-samples.json",
    JSON.stringify(
      {
        at,
        origin,
        scope:
          "Actual local HTTP from supplemental combined Admin forms and original shared approval; original embedded DTOs remain unchanged",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/admin-vip-credit-screenshots.json",
    JSON.stringify(
      {
        at,
        scope:
          "Actual owned Chromium page screenshots; unedited, no synthetic UI",
        screenshots: screenshotFacts,
        source_files: beforeSources,
        browser_closed: closed,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      checks: checks.length,
      samples: samples.length,
      errors,
      browser_closed: closed,
      screenshots,
    }),
  );
  if (errors.length) process.exitCode = 1;
}
