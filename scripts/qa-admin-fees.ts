import {
  chromium,
  type BrowserServer,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const origin = "http://localhost:4310",
  platform = path.resolve("../copypaste-platform");
const requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth");
type Client = { admin: boolean; cookies: Map<string, string>; csrf: string };
const clients: Client[] = [],
  principals: string[] = [],
  users: string[] = [],
  checks: any[] = [],
  samples: any[] = [],
  errors: string[] = [];
let db: any,
  closed = true;
function client(admin = false) {
  const c = { admin, cookies: new Map<string, string>(), csrf: "" };
  clients.push(c);
  return c;
}
async function call(
  c: Client,
  method: string,
  endpoint: string,
  body?: unknown,
  options: { key?: string; headers?: Record<string, string> } = {},
) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(endpoint)?.[1];
  const r = await fetch(origin + endpoint, {
    method,
    headers: {
      Origin: c.admin ? "http://localhost:4318" : "http://localhost:4317",
      "Idempotency-Key": options.key ?? randomUUID(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(tenant ? { "X-Tenant-ID": tenant } : {}),
      ...(c.csrf ? { "X-CSRF-Token": c.csrf } : {}),
      ...(c.cookies.size
        ? { Cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
        : {}),
      ...options.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  for (const cookie of r.headers.getSetCookie()) {
    const [pair] = cookie.split(";"),
      i = pair.indexOf("="),
      k = pair.slice(0, i);
    if (/max-age=0(?:;|$)/i.test(cookie)) c.cookies.delete(k);
    else c.cookies.set(k, pair.slice(i + 1));
  }
  return { status: r.status, data: await r.json() };
}
async function mailbox(id: string) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try {
      return JSON.parse(
        await readFile(
          path.join(platform, ".data/mailbox", id + ".json"),
          "utf8",
        ),
      );
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("Owned email delivery did not arrive");
}
async function login(c: Client, email: string, secret?: any) {
  const ch = await call(
    c,
    "POST",
    c.admin ? "/v1/admin/auth/challenge" : "/v1/auth/challenges",
    { email },
  );
  assert.equal(ch.status, c.admin ? 200 : 202, JSON.stringify(ch.data));
  const mail = await mailbox(ch.data.challenge_id);
  assert.equal(mail.to, email);
  const r = await call(
    c,
    "POST",
    c.admin ? "/v1/admin/auth/verify" : "/v1/auth/sessions",
    {
      challenge_id: ch.data.challenge_id,
      code: mail.text.match(/\b\d{6}\b/)[0],
      ...(secret
        ? {
            totp: new OTPAuth.TOTP({
              secret,
              digits: 6,
              period: 30,
              algorithm: "SHA1",
            }).generate(),
          }
        : {}),
    },
  );
  assert.equal(r.status, c.admin ? 200 : 201, JSON.stringify(r.data));
  const context = await call(
    c,
    "GET",
    c.admin ? "/v1/admin/me" : "/v1/session/context",
  );
  assert.equal(context.status, 200);
  c.csrf = context.data.csrf_token;
  return context.data.user;
}

let server: BrowserServer | undefined,
  browser: Browser | undefined,
  stage = "initializing";
const contexts: BrowserContext[] = [],
  screenshots: string[] = [];
const admins: { c: Client; id: string }[] = [];
const sourcePaths = [
  "copypaste-platform/src/admin-approvals.ts",
  "copypaste-platform/src/admin-approval-storage.ts",
  "copypaste-platform/src/admin-accounts.ts",
  "copypaste-platform/src/admin-memberships.ts",
  "copypaste-platform/src/admin-directory.ts",
  "copypaste-platform/src/admin-operation-policy.ts",
  "copypaste-platform/src/worker.ts",
  "copypaste-platform/src/auth.ts",
  "copypaste-platform/migrations/048-unified-admin-approvals.sql",
  "copypaste-platform/src/admin-fees.ts",
  "copypaste-platform/src/admin-billing.ts",
  "copypaste-platform/src/admin-operations.ts",
  "copypaste-platform/src/admin-access.ts",
  "copypaste-platform/src/admin.ts",
  "copypaste-platform/src/billing.ts",
  "copypaste-platform/src/server.ts",
  "copypaste-platform/migrations/045-frozen-financial-commands.sql",
  "copypaste-platform/migrations/046-financial-preview-intent-repair.sql",
  "copypaste-platform/migrations/047-financial-approval-requests.sql",
  "copypaste-admin/src/fees.tsx",
  "copypaste-admin/src/approvals.tsx",
  "copypaste-admin/src/financial-money.ts",
  "copypaste-admin/src/main.tsx",
  "copypaste-admin/src/ui.tsx",
  "copypaste-admin/src/api.ts",
  "copypaste-admin/src/operation-key.ts",
  "copypaste-admin/src/admin-identities.tsx",
  "copypaste-admin/src/style.css",
  "copypaste-admin/src/admin.css",
  "copypaste-delivery/scripts/qa-admin-fees.ts",
];
async function sourceHashes() {
  return Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (p) => [
        p,
        createHash("sha256")
          .update(await readFile(path.resolve("..", p)))
          .digest("hex"),
      ]),
    ),
  );
}
const beforeSources = await sourceHashes();
const pass = (name: string) => checks.push({ name, status: "passed" });
const deadline = setTimeout(() => {
  errors.push("Owned fee QA exceeded 240 seconds at " + stage);
  void server?.kill();
}, 240000);
const accountRoot = "/v1/admin/billing/accounts";
let check: (name: string, value: unknown) => void;
function sample(
  name: string,
  operation: string,
  schema: string,
  r: any,
  status = 200,
) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  check(schema, r.data);
  samples.push({ name, operation, schema, status, response: r.data });
}
async function capture(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const folder = path.resolve("../copypaste-admin/assets/screenshots");
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, name), fullPage: true });
  screenshots.push(name);
}
async function browserClient(c: Client) {
  const context = await browser!.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  await context.addCookies(
    [...c.cookies].map(([name, value]) => ({
      name,
      value,
      url: "http://localhost:4318",
      httpOnly: true,
      sameSite: "Lax",
    })),
  );
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function perform(
  page: Page,
  account: string,
  action: string,
  amount: string,
  source?: string,
) {
  const title =
    action === "gift"
      ? "Gift credit"
      : action === "debit"
        ? "Debit original credit"
        : "Change credit limit";
  const row = page
    .getByRole("row")
    .filter({ has: page.locator("code").filter({ hasText: account }) });
  await row.getByRole("button", { name: title, exact: true }).click();
  const d = page.getByRole("dialog", { name: title, exact: true });
  await d
    .getByLabel(
      action === "credit_limit" ? "New credit limit (HKD)" : "Amount (HKD)",
      { exact: true },
    )
    .fill(amount);
  if (action === "gift")
    await d
      .getByLabel("Promotional credit expiry", { exact: true })
      .fill("2027-12-31T18:00");
  if (source)
    await d
      .getByLabel("Original funding entry ID", { exact: true })
      .fill(source);
  await d
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic browser fee verification; no external payment");
  const before = (
    await db.query("SELECT * FROM wallets WHERE id=$1", [account])
  ).rows[0];
  const [pv] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `${accountRoot}/${account}/previews` &&
        r.request().method() === "POST",
    ),
    d.getByRole("button", { name: "Preview change", exact: true }).click(),
  ]);
  const preview = await pv.json();
  check("AdminFeePreview", pv.request().postDataJSON());
  sample(`ui-${action}-preview`, "previewAdminFee", "AdminPreview", {
    status: pv.status(),
    data: preview,
  });
  assert.deepEqual(
    (await db.query("SELECT * FROM wallets WHERE id=$1", [account])).rows[0],
    before,
  );
  await d.getByText(preview.policy_version_id, { exact: true }).waitFor();
  if (action === "gift" && amount === "15.123456") {
    await d.getByText("HK$15.123456", { exact: true }).waitFor();
    await capture(page, "25-fee-preview.png");
  }
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          `${accountRoot}/${account}/${action === "credit_limit" ? "credit-limit" : action}` &&
        r.request().method() === "POST",
    ),
    d
      .getByRole("button", {
        name:
          preview.decision === "independent_approval"
            ? "Submit for independent review"
            : "Confirm change",
        exact: true,
      })
      .click(),
  ]);
  const operation = await response.json();
  sample(
    `ui-${action}-${amount}-operation`,
    action === "gift"
      ? "createAdminFeeGift"
      : action === "debit"
        ? "createAdminFeeDebit"
        : "createAdminFeeCreditLimit",
    "AdminOperation",
    { status: response.status(), data: operation },
    202,
  );
  await d.getByTestId("fee-operation-id").waitFor();
  assert.equal(
    await d.getByTestId("fee-operation-id").innerText(),
    operation.id,
  );
  await d.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("heading", { name: "Billing accounts", exact: true })
    .waitFor();
  return {
    operation,
    body: response.request().postDataJSON(),
    key: response.request().headers()["idempotency-key"],
    preview,
  };
}
try {
  const config = await (await fetch(origin + "/v1/public/config")).json();
  assert.equal(config.data_mode, "simulated");
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const normative = await readFile("../../docs/contracts/openapi.json"),
    fixture = JSON.parse(
      await readFile(
        path.join(platform, "contracts/admin-fee-schemas.json"),
        "utf8",
      ),
    ),
    spec = JSON.parse(normative.toString("utf8"));
  assert.equal(
    createHash("sha256").update(normative).digest("hex"),
    fixture.source_sha256,
  );
  for (const [name, schema] of Object.entries(fixture.schemas))
    assert.deepEqual(schema, spec.components.schemas[name]);
  const { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
    ajv = new Ajv2020({ allErrors: true });
  requirePlatform("ajv-formats")(ajv);
  const defs = JSON.parse(
    JSON.stringify(fixture.schemas).replaceAll(
      "#/components/schemas/",
      "#/$defs/",
    ),
  );
  const validators = new Map<string, any>();
  check = (name, value) => {
    if (!validators.has(name))
      validators.set(
        name,
        ajv.compile({ $defs: defs, $ref: "#/$defs/" + name }),
      );
    const v = validators.get(name);
    assert.ok(v(value), name + JSON.stringify(v.errors));
  };
  const u = client(),
    user = await login(u, `fee-ui-user-${randomUUID()}@example.invalid`);
  users.push(user.id);
  const { seal } = await import(
    pathToFileURL(path.join(platform, "src/lib.ts")).href
  );
  for (let n = 0; n < 2; n++) {
    const email = `fee-ui-admin-${randomUUID()}@example.invalid`,
      secret = new OTPAuth.Secret({ size: 20 });
    const p = (
      await db.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
        [
          email,
          n ? "Synthetic financial reviewer" : "Synthetic financial operator",
          seal(env.MASTER_KEY!, secret.base32),
        ],
      )
    ).rows[0];
    principals.push(p.id);
    await db.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
      [p.id],
    );
    const c = client(true);
    await login(c, email, secret);
    admins.push({ c, id: p.id });
  }
  const account = (
    await db.query(
      "SELECT * FROM wallets WHERE user_id=$1 AND data_mode='simulated'",
      [user.id],
    )
  ).rows[0];
  pass(
    "real email and TOTP HTTP sessions, real personal account, original immutable OpenAPI schema snapshots; no AI or payment-provider call",
  );
  stage = "owned software-rendered Chromium";
  server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
    args: ["--disable-gpu"],
    timeout: 15000,
  });
  browser = await chromium.connect(server.wsEndpoint());
  const page = await browserClient(admins[0].c);
  await page.goto("http://localhost:4318/billing", {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("User / workspace ID", { exact: true }).fill(user.id);
  await page.getByRole("button", { name: "Apply filter", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ has: page.locator("code").filter({ hasText: account.id }) })
    .waitFor();
  stage = "actual financial preview and write forms";
  const gift = await perform(page, account.id, "gift", "15.123456");
  assert.equal(gift.operation.state, "succeeded");
  const same = await call(
    admins[0].c,
    "POST",
    `${accountRoot}/${account.id}/gift`,
    gift.body,
    { key: gift.key },
  );
  sample(
    "lost-receipt-replay-without-preview-header",
    "createAdminFeeGift",
    "AdminOperation",
    same,
    202,
  );
  assert.equal(same.data.id, gift.operation.id);
  const invalid = await call(
    admins[0].c,
    "POST",
    `${accountRoot}/${account.id}/gift`,
    { ...gift.body, amount: { currency: "HKD", amount_micros: "1" } },
  );
  assert.equal(invalid.status, 409);
  await perform(
    page,
    account.id,
    "debit",
    "0.123456",
    gift.operation.result_ids[0],
  );
  assert.equal(
    (
      await db.query("SELECT balance_micros FROM wallets WHERE id=$1", [
        account.id,
      ])
    ).rows[0].balance_micros,
    "15000000",
  );
  await perform(page, account.id, "credit_limit", "25");
  assert.equal(
    (
      await db.query("SELECT credit_limit_micros FROM wallets WHERE id=$1", [
        account.id,
      ])
    ).rows[0].credit_limit_micros,
    "25000000",
  );
  pass(
    "actual browser gift, original-source debit and credit-limit forms retain exact decimal amounts, pure previews and single-credit receipt recovery",
  );
  await capture(page, "24-billing-accounts.png");
  stage = "frozen independent approval";
  const pending = await perform(page, account.id, "gift", "10000");
  assert.equal(pending.operation.state, "pending_approval");
  assert.equal(
    (
      await db.query("SELECT balance_micros FROM wallets WHERE id=$1", [
        account.id,
      ])
    ).rows[0].balance_micros,
    "15000000",
  );
  const decision = {
    expected_version: pending.operation.version,
    reason: "Synthetic independent review",
    decision: "approve",
    payload_hash: pending.operation.payload_hash,
  };
  const frozenReview = await call(
    admins[0].c,
    "GET",
    `/v1/admin/billing/operations/${pending.operation.id}/review`,
  );
  assert.equal(frozenReview.status, 200, JSON.stringify(frozenReview.data));
  check("AdminApproval", frozenReview.data.approval);
  assert.notEqual(frozenReview.data.approval.id, pending.operation.id);
  const approvalId = frozenReview.data.approval.id;
  assert.equal(
    (
      await call(
        admins[0].c,
        "POST",
        `/v1/admin/approvals/${approvalId}/decisions`,
        decision,
      )
    ).data.error.code,
    "SELF_APPROVAL_FORBIDDEN",
  );
  const reviewer = await browserClient(admins[1].c);
  await reviewer.goto("http://localhost:4318/billing", {
    waitUntil: "domcontentloaded",
  });
  await reviewer
    .getByLabel("Financial operation ID", { exact: true })
    .fill(pending.operation.id);
  await reviewer
    .getByRole("button", { name: "Open operation review", exact: true })
    .click();
  const d = reviewer.getByRole("dialog", {
    name: "Financial operation review",
    exact: true,
  });
  await d.getByText(pending.operation.payload_hash, { exact: true }).waitFor();
  await capture(reviewer, "26-financial-independent-review.png");
  await d.getByLabel("Decision", { exact: true }).selectOption("approve");
  await d
    .getByLabel("Review reason", { exact: true })
    .fill("Synthetic second-operator review of the frozen command");
  const [approved] = await Promise.all([
    reviewer.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          `/v1/admin/approvals/${approvalId}/decisions` &&
        r.request().method() === "POST",
    ),
    d
      .getByRole("button", { name: "Confirm review decision", exact: true })
      .click(),
  ]);
  check("AdminApprovalDecision", approved.request().postDataJSON());
  sample(
    "ui-independent-financial-decision",
    "decideAdminApproval",
    "AdminOperation",
    { status: approved.status(), data: await approved.json() },
    202,
  );
  await d.getByText("Completed", { exact: true }).waitFor();
  const ledger = (
    await db.query("SELECT * FROM billing_journal WHERE operation_id=$1", [
      pending.operation.id,
    ])
  ).rows;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].actor_id, admins[0].id);
  assert.equal(
    (
      await db.query("SELECT approved_by FROM admin_operations WHERE id=$1", [
        pending.operation.id,
      ])
    ).rows[0].approved_by,
    admins[1].id,
  );
  pass(
    "a distinct real administrator approves the frozen amount/version/hash in the browser; self approval is rejected and journal attribution retains the original actor",
  );
  stage = "responsive account and ledger UI";
  await d.getByRole("button", { name: "Close", exact: true }).click();
  const ownRow = page
    .getByRole("row")
    .filter({ has: page.locator("code").filter({ hasText: account.id }) });
  await ownRow.getByRole("button", { name: "Ledger", exact: true }).click();
  const ledgerDialog = page.getByRole("dialog", {
    name: "Account ledger",
    exact: true,
  });
  await ledgerDialog
    .getByRole("cell")
    .filter({
      hasText: "Synthetic browser fee verification; no external payment",
    })
    .first()
    .waitFor();
  await capture(page, "27-billing-ledger.png");
  await ledgerDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "費用與帳務", exact: true })
    .waitFor();
  await page.getByLabel("用戶 / 企業 ID", { exact: true }).fill(user.id);
  await page.getByRole("button", { name: "套用篩選", exact: true }).click();
  await page.locator("code").filter({ hasText: account.id }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await capture(page, "28-billing-mobile-dark.png");
  pass(
    "actual canonical ledger, English light and Traditional Chinese dark/mobile pages render without page-width overflow",
  );
} catch (e) {
  errors.push(`${stage}: ${(e as Error).message}`);
  for (const [index, context] of contexts.entries()) {
    const page = context.pages()[0];
    if (page && !page.isClosed())
      try {
        await capture(page, `fee-failure-${index}.png`);
        await writeFile(
          `evidence/admin-fees-failure-${index}.txt`,
          (await page.locator("body").innerText()).slice(0, 20000),
        );
      } catch {
        /* The owned deadline may already have closed the browser. */
      }
  }
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
    errors.push("Owned Chromium did not exit");
  }
  if (db && principals.length)
    try {
      const pending = (
        await db.query(
          "SELECT r.* FROM admin_approval_requests r JOIN admin_operations o ON o.id=r.operation_id WHERE o.principal_id=ANY($1::uuid[]) AND o.state='pending_approval' AND r.state='pending'",
          [principals],
        )
      ).rows;
      for (const r of pending) {
        const reviewer = admins.find((a) => a.id !== r.requester_id);
        if (!reviewer)
          throw new Error("No owned independent reviewer for fixture cleanup");
        const result = await call(
          reviewer.c,
          "POST",
          `/v1/admin/approvals/${r.id}/decisions`,
          {
            expected_version: r.version,
            payload_hash: r.payload_hash,
            decision: "reject",
            reason: "Close unexecuted synthetic QA request",
          },
        );
        assert.equal(result.status, 202, JSON.stringify(result.data));
      }
    } catch {
      errors.push("Owned financial approval cleanup failed");
    }
  for (const c of clients)
    if (c.csrf)
      try {
        const r = await call(
          c,
          c.admin ? "POST" : "DELETE",
          c.admin ? "/v1/admin/auth/logout" : "/v1/auth/session",
        );
        if (r.status !== 200) errors.push("Owned logout failed");
      } catch {
        errors.push("Owned logout failed");
      }
  if (db)
    try {
      await db.query(
        "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=ANY($1::uuid[]) OR admin_id=ANY($2::uuid[])",
        [users, principals],
      );
      await db.query(
        "UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await db.query(
        "UPDATE admin_principals SET status='suspended',auth_version=auth_version+1,version=version+1 WHERE id=ANY($1::uuid[])",
        [principals],
      );
    } catch {
      errors.push("Owned fixture cleanup failed");
    } finally {
      await db.end();
    }
  const at = new Date().toISOString();
  const afterSources = await sourceHashes();
  if (JSON.stringify(beforeSources) !== JSON.stringify(afterSources))
    errors.push("Financial runtime or verifier source changed during QA");
  await writeFile(
    "evidence/admin-fees.json",
    JSON.stringify(
      {
        at,
        status: errors.length ? "failed" : "passed",
        scope:
          "Three canonical financial commands only: current local HTTP and owned Chromium UI with real email/TOTP sessions and simulated financial fixtures; no external payment, complete payment/refund/VIP, native or production acceptance",
        checks,
        errors,
        screenshots,
        browser_closed: closed,
        user_browser_tabs_touched: false,
        model_calls: 0,
        external_payments: 0,
        source_unchanged:
          JSON.stringify(beforeSources) === JSON.stringify(afterSources),
        source_files: beforeSources,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/admin-fee-contract-samples.json",
    JSON.stringify(
      {
        at,
        origin,
        scope:
          "Actual local canonical fee previews, writes, lost-receipt replay and independent approval HTTP responses from the current Admin forms",
        samples,
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
