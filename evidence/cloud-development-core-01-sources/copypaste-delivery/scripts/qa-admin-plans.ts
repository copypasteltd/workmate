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
  requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth"),
  sha = (data: string | Buffer) =>
    createHash("sha256").update(data).digest("hex");
type Client = { id: string; cookie: string; csrf: string };
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
  for (const repo of ["copypaste-platform", "copypaste-admin"]) {
    const list = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: path.resolve("..", repo), encoding: "utf8", windowsHide: true },
    ).split("\0");
    for (const f of list)
      if (
        /^(src|migrations|catalog|contracts)\//.test(f) ||
        /^(package(-lock)?|tsconfig)\.json$/.test(f)
      )
        files.push(`${repo}/${f}`);
  }
  files.push("copypaste-delivery/scripts/qa-admin-plans.ts");
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
  errors.push("Owned plan QA exceeded 240 seconds at " + stage);
  void server?.kill();
}, 240000);
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
      Origin: admin,
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
      url: admin,
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
async function capture(page: Page, name: string) {
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
  const folder = path.resolve("../copypaste-admin/assets/screenshots");
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, name);
  await page.screenshot({
    path: file,
    fullPage: (await page.locator(".modal-backdrop").count()) === 0,
  });
  screenshots.push(name);
  screenshotFacts.push({
    file: "dev/copypaste-admin/assets/screenshots/" + name,
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
        path.join(platform, "contracts/admin-plan-schemas.json"),
        "utf8",
      ),
    ),
    specBytes = await readFile("../../docs/contracts/openapi.json"),
    spec = JSON.parse(specBytes.toString());
  assert.equal(fixture.normative_source_sha256, sha(specBytes));
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
  check = (schema, data) => {
    const v = ajv.compile({ $defs: defs, $ref: "#/$defs/" + schema });
    assert.ok(v(data), schema + JSON.stringify(v.errors));
  };
  const { seal } = await import(
    pathToFileURL(path.join(platform, "src/lib.ts")).href
  );
  for (let n = 0; n < 2; n++) {
    const secret = new OTPAuth.Secret({ size: 20 }),
      email = `plan-ui-${randomUUID()}@example.invalid`,
      p = (
        await db.query(
          "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
          [
            email,
            n ? "Synthetic plan reviewer" : "Synthetic plan operator",
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
  assert.equal((await call(undefined, "GET", "/v1/admin/plans")).status, 401);
  pass(
    "original plan schemas and real email/TOTP Admin sessions, with anonymous access rejected; no model or payment call",
  );
  stage = "owned Chromium";
  server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
    args: ["--disable-gpu"],
    timeout: 15000,
  });
  browser = await chromium.connect(server.wsEndpoint());
  const page = await pageFor(operator);
  await page.goto(admin + "/plans", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Plans & access", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "View definition", exact: true })
    .first()
    .waitFor();
  const layout = await page.locator(".admin-plan-card").evaluateAll((cards) =>
    cards.map((card) => ({
      display: getComputedStyle(card).display,
      headingWidth: card.querySelector("h2")!.getBoundingClientRect().width,
      metricHeights: [...card.querySelectorAll("dd")].map(
        (e) => e.getBoundingClientRect().height,
      ),
    })),
  );
  assert.ok(layout.length > 0);
  assert.ok(
    layout.every(
      (card) =>
        card.display === "block" &&
        card.headingWidth > 200 &&
        card.metricHeights.every((height) => height < 50),
    ),
    "Admin plan cards must retain readable vertical layout independently of public pricing styles",
  );
  const list = await call(operator, "GET", "/v1/admin/plans?limit=12");
  assert.equal(list.status, 200);
  sample(
    "published-and-draft-plan-directory",
    "listAdminPlanVersions",
    "AdminPlanVersionList",
    list.data,
  );
  await capture(page, "50-plan-directory.png");
  stage = "structured draft";
  await page.getByRole("button", { name: "Create plan", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create plan", exact: true });
  const planName = "Campaign team " + randomUUID().slice(0, 8);
  await dialog.getByLabel("Plan name", { exact: true }).fill(planName);
  await dialog.getByLabel("Seat allowance", { exact: true }).fill("12");
  await dialog.getByLabel("Concurrent tasks", { exact: true }).fill("3");
  await dialog
    .getByLabel("Storage allowance (bytes)", { exact: true })
    .fill("1073741824");
  await dialog
    .getByLabel("Included credit (HKD)", { exact: true })
    .fill("9007199254.740993");
  await dialog
    .getByLabel("Credit policy", { exact: true })
    .selectOption("separate_idempotent_grant");
  for (const label of ["Images", "Design", "Analytics"])
    await dialog.getByRole("checkbox", { name: label, exact: true }).check();
  await dialog
    .getByLabel("Reason for creation", { exact: true })
    .fill("Synthetic plan UI review; no access or credit grant");
  // A recoverable local monetary error must preserve input and focus its summary.
  await dialog
    .getByLabel("Included credit (HKD)", { exact: true })
    .fill("1.1234567");
  await dialog
    .getByRole("button", { name: "Save new draft", exact: true })
    .click();
  await dialog.locator(".admin-plan-error-summary").waitFor();
  assert.ok(
    await dialog
      .locator(".admin-plan-error-summary")
      .evaluate((e) => e === document.activeElement),
  );
  assert.equal(
    await dialog.getByLabel("Plan name", { exact: true }).inputValue(),
    planName,
  );
  await dialog
    .getByLabel("Included credit (HKD)", { exact: true })
    .fill("9007199254.740993");
  await capture(page, "51-plan-draft-form.png");
  const created = await waitResponse(page, "/v1/admin/plans/drafts", () =>
    dialog.getByRole("button", { name: "Save new draft", exact: true }).click(),
  );
  assert.equal(created.status(), 202);
  const command = created.request().postDataJSON(),
    operation = await created.json();
  check("AdminPlanDraft", command);
  sample(
    "draft-created-from-actual-form",
    "createAdminPlanDraft",
    "AdminOperation",
    operation,
    202,
  );
  assert.equal(
    command.allowances.included_credit.amount_micros,
    "9007199254740993",
  );
  assert.equal(operation.state, "succeeded");
  await dialog.waitFor({ state: "hidden" });
  const card = page.locator(".admin-plan-card").filter({
    has: page.getByRole("heading", { name: planName, exact: true }),
  });
  await card.waitFor();
  await card
    .getByRole("button", { name: "View definition", exact: true })
    .click();
  const detail = page.getByRole("dialog", {
    name: "Plan version definition",
    exact: true,
  });
  assert.ok((await detail.textContent())?.includes("9,007,199,254.740993"));
  await capture(page, "52-plan-immutable-definition.png");
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  pass(
    "structured immutable draft form, exact credit beyond Number precision, retained validation inputs and focusable error summary",
  );
  stage = "publication preview";
  const walletBefore = (
    await db.query(
      "SELECT coalesce(sum(balance_micros),0)::text AS balance,coalesce(sum(reserved_micros),0)::text AS reserved FROM wallets",
    )
  ).rows;
  await card
    .getByRole("button", { name: "Review publication", exact: true })
    .click();
  const publication = page.getByRole("dialog", {
    name: "Publish plan version",
    exact: true,
  });
  await publication
    .getByLabel("Publication reason", { exact: true })
    .fill("Synthetic independently reviewed plan publication");
  const previewResponse = await waitResponse(
    page,
    "/publication-previews",
    () =>
      publication
        .getByRole("button", { name: "Preview publication", exact: true })
        .click(),
  );
  assert.equal(previewResponse.status(), 200);
  check("AdminVersionReason", previewResponse.request().postDataJSON());
  const preview = await previewResponse.json();
  sample(
    "actual-publication-preview",
    "supplementalPlanPublicationPreview",
    "AdminPreview",
    preview,
  );
  await publication
    .getByRole("button", { name: "Confirm and request review", exact: true })
    .waitFor();
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM commercial_plan_publications WHERE plan_version_id=$1",
        [operation.result_ids[0]],
      )
    ).rows[0].n,
    0,
  );
  await capture(page, "53-plan-publication-preview.png");
  await publication.getByRole("checkbox").check();
  const pendingResponse = await waitResponse(page, "/publications", () =>
    publication
      .getByRole("button", { name: "Confirm and request review", exact: true })
      .click(),
  );
  assert.equal(pendingResponse.status(), 202);
  const pending = await pendingResponse.json();
  sample(
    "publication-submitted-from-actual-form",
    "publishAdminPlanVersion",
    "AdminOperation",
    pending,
    202,
  );
  assert.equal(pending.state, "pending_approval");
  const replay = await call(
    operator,
    "POST",
    `/v1/admin/plans/${operation.result_ids[0]}/publications`,
    pendingResponse.request().postDataJSON(),
    {
      "Idempotency-Key": pendingResponse.request().headers()["idempotency-key"],
    },
  );
  assert.equal(replay.status, 202);
  assert.equal(replay.data.id, pending.id);
  sample(
    "durable-publication-receipt-replay",
    "publishAdminPlanVersion",
    "AdminOperation",
    replay.data,
    202,
  );
  await capture(page, "54-plan-awaiting-review.png");
  const approval = (
    await call(reviewer, "GET", `/v1/admin/operations/${pending.id}/approval`)
  ).data;
  const self = await call(
    operator,
    "POST",
    `/v1/admin/approvals/${approval.id}/decisions`,
    {
      expected_version: approval.version,
      payload_hash: approval.payload_hash,
      decision: "approve",
      reason: "Synthetic forbidden self approval",
    },
  );
  assert.equal(self.status, 403);
  assert.equal(self.data.error.code, "SELF_APPROVAL_FORBIDDEN");
  pass(
    "frozen preview and publication intent from real forms, no wallet side effect, durable replay and self approval rejected",
  );
  stage = "independent review";
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
    .getByRole("region", { name: "Proposed version" })
    .waitFor()
    .catch(async () => {
      await review
        .getByRole("heading", { name: "Proposed version", exact: true })
        .waitFor();
    });
  await capture(reviewPage, "55-plan-independent-review.png");
  await review.getByLabel("Decision", { exact: true }).selectOption("approve");
  await review
    .getByLabel("Review reason", { exact: true })
    .fill("Synthetic independent review of exact immutable version");
  const decision = await waitResponse(reviewPage, "/decisions", () =>
    review
      .getByRole("button", { name: "Confirm review decision", exact: true })
      .click(),
  );
  assert.equal(decision.status(), 202);
  const completed = await decision.json();
  assert.equal(completed.state, "succeeded");
  sample(
    "independently-published-plan",
    "decideAdminApproval",
    "AdminOperation",
    completed,
    202,
  );
  await review.waitFor({ state: "hidden" });
  const published = await call(
    operator,
    "GET",
    "/v1/admin/plans/" + operation.result_ids[0],
  );
  assert.equal(published.status, 200);
  assert.equal(published.data.state, "published");
  sample(
    "exact-published-plan-definition",
    "supplementalAdminPlanVersion",
    "AdminPlanVersion",
    published.data,
  );
  const facts = (
    await db.query(
      "SELECT * FROM commercial_plan_publications WHERE plan_version_id=$1",
      [operation.result_ids[0]],
    )
  ).rows;
  assert.equal(facts.length, 1);
  assert.equal(facts[0].operation_id, pending.id);
  assert.equal(facts[0].actor_id, operator.id);
  assert.deepEqual(
    (
      await db.query(
        "SELECT coalesce(sum(balance_micros),0)::text AS balance,coalesce(sum(reserved_micros),0)::text AS reserved FROM wallets",
      )
    ).rows,
    walletBefore,
  );
  pass(
    "shared approval UI compares actual frozen versions and records a single publication with original requester, independent decision and zero credit/payment effect",
  );
  stage = "new immutable version";
  await publication.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await card.getByRole("button", { name: "New version", exact: true }).click();
  const newVersion = page.getByRole("dialog", {
    name: "Create a new version",
    exact: true,
  });
  await newVersion
    .getByLabel("Plan name", { exact: true })
    .fill(planName + " revised");
  await newVersion
    .getByLabel("Reason for creation", { exact: true })
    .fill("Synthetic version increment without mutating original");
  const second = await waitResponse(page, "/v1/admin/plans/drafts", () =>
    newVersion
      .getByRole("button", { name: "Save new draft", exact: true })
      .click(),
  );
  assert.equal(second.status(), 202);
  const secondOp = await second.json();
  sample(
    "new-version-draft",
    "createAdminPlanDraft",
    "AdminOperation",
    secondOp,
    202,
  );
  const secondVersion = await call(
    operator,
    "GET",
    "/v1/admin/plans/" + secondOp.result_ids[0],
  );
  assert.equal(secondVersion.data.version, 2);
  assert.equal(secondVersion.data.plan_id, command.plan_id);
  assert.notEqual(secondVersion.data.id, published.data.id);
  assert.deepEqual(
    (await call(operator, "GET", "/v1/admin/plans/" + published.data.id)).data,
    published.data,
  );
  pass(
    "new version keeps family identity, increments version and cannot rewrite the original published definition",
  );
  stage = "mobile bilingual dark UI";
  const mobile = await pageFor(operator, 390, "zh-HK", "dark");
  await mobile.goto(admin + "/plans", { waitUntil: "domcontentloaded" });
  await mobile
    .getByRole("heading", { name: "方案與權限", exact: true })
    .waitFor();
  await mobile.locator(".admin-plan-card").first().waitFor();
  await capture(mobile, "56-plan-mobile-dark.png");
  await mobile
    .locator(".admin-plan-card")
    .filter({
      has: mobile.getByRole("heading", {
        name: planName + " revised",
        exact: true,
      }),
    })
    .getByRole("button", { name: "查看定義", exact: true })
    .click();
  await mobile
    .getByRole("dialog", { name: "方案版本定義", exact: true })
    .waitFor();
  await capture(mobile, "57-plan-mobile-definition.png");
  pass(
    "actual English/light desktop and Traditional Chinese/dark mobile plan flows have no page overflow and preserve readable exact amounts",
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
                reason: "Close unexecuted synthetic plan QA request",
              },
            )
          ).status,
          202,
        );
      }
    } catch {
      errors.push("Owned pending plan request cleanup failed");
    }
  for (const c of clients)
    try {
      if ((await call(c, "POST", "/v1/admin/auth/logout")).status !== 200)
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
              "SELECT count(*) AS n FROM sessions WHERE admin_id=ANY($1::uuid[]) AND revoked_at IS NULL",
              [principals],
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
  if (!unchanged) errors.push("Plan source changed during QA");
  const at = new Date().toISOString();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/admin-plans.json",
    JSON.stringify(
      {
        at,
        status: errors.length ? "failed" : "passed",
        scope:
          "Immutable plan definitions/publications, legacy binding foundation and actual Admin forms only; not complete VIP grants, seat/storage enforcement, native or production acceptance",
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
    "evidence/admin-plan-contract-samples.json",
    JSON.stringify(
      {
        at,
        origin,
        scope:
          "Actual local HTTP payloads from current Admin plan forms and shared independent approval; original schemas unchanged",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/admin-plan-screenshots.json",
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
