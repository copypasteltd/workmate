import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
  type Locator,
  type Response,
} from "playwright";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  admin = "http://localhost:4318",
  origin = "http://localhost:4310",
  root = "/v1/admin/ai",
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const requirePlatform = createRequire(path.join(platform, "package.json")),
  OTPAuth = requirePlatform("otpauth"),
  { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
  ajv = new Ajv2020({ allErrors: true });
requirePlatform("ajv-formats")(ajv);
const contractPath = path.resolve(
    "../../docs/contracts/provider-admin-openapi.json",
  ),
  contractBytes = await readFile(contractPath),
  contract = JSON.parse(contractBytes.toString()),
  defs = JSON.parse(
    JSON.stringify(contract.components.schemas).replaceAll(
      "#/components/schemas/",
      "#/$defs/",
    ),
  );
const validators = Object.fromEntries(
  Object.keys(defs).map((name) => [
    name,
    ajv.compile({ $defs: defs, $ref: "#/$defs/" + name }),
  ]),
);
const checks: any[] = [],
  samples: any[] = [],
  screenshots: any[] = [],
  errors: string[] = [],
  contexts: BrowserContext[] = [];
let isolated: any,
  system: any,
  server: BrowserServer | undefined,
  browser: Browser | undefined,
  stage = "initializing",
  browserClosed = false,
  appClosed = false,
  databaseDropped = false;
let browserRuntime: {
  executable: string;
  sha256: string;
  version: string;
} | null = null;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex"),
  pass = (name: string) => checks.push({ name, status: "passed" });
function sample(schema: string, value: any, route: string) {
  const validator = validators[schema];
  assert.ok(validator(value), JSON.stringify(validator.errors));
  samples.push({ schema, route, response: value });
  return value;
}
async function response(
  page: Page,
  method: string,
  endpoint: string,
  click: () => Promise<unknown>,
  schema: string,
  status = 200,
) {
  const [r] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === endpoint &&
        r.request().method() === method,
      { timeout: 90000 },
    ),
    click(),
  ]);
  assert.equal(r.status(), status, endpoint);
  return sample(schema, await r.json(), method + " " + endpoint);
}
async function screenshot(page: Page, name: string) {
  const directory = path.resolve("../copypaste-admin/assets/screenshots");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `provider-admin-${attempt}-${name}.png`);
  await assert.rejects(access(file), (error: any) => error.code === "ENOENT");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({
    path: file,
    fullPage: !(await page.getByRole("dialog").count()),
    animations: "disabled",
    timeout: 10000,
  });
  screenshots.push({
    path: path.relative(path.resolve(".."), file).replaceAll("\\", "/"),
    sha256: sha(await readFile(file)),
    viewport: page.viewportSize(),
    edited: false,
  });
}
async function fit(page: Page) {
  if (
    (page.viewportSize()?.width ?? Infinity) <= 740 &&
    !(await page.locator(".admin-shell.mobile-open").count())
  )
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar")!.getBoundingClientRect().right <= 1,
    );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page must fit the viewport",
  );
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    assert.ok(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "Dialog must fit its viewport",
    );
}
async function call(
  c: { cookie: string; csrf: string } | undefined,
  method: string,
  url: string,
  body?: unknown,
  headers = {},
) {
  const raw = await system.app.inject({
    method,
    url,
    headers: {
      origin: url.startsWith("/v1/admin") ? admin : "http://localhost:4317",
      "idempotency-key": randomUUID(),
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    payload: body ? JSON.stringify(body) : undefined,
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function login(name: string, readonly = false) {
  const email = `provider-ui-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 }),
    { seal } = await import(
      pathToFileURL(path.join(platform, "src/lib.ts")).href
    ),
    principal = (
      await system.db.control.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
        [email, name, seal(system.db.config.MASTER_KEY, secret.base32)],
      )
    ).rows[0].id;
  let role = "super_admin";
  if (readonly) {
    role = "capability-read-" + randomUUID();
    await system.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
      [role, JSON.stringify(["admin.ai.requests.read"])],
    );
  }
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",
    [principal, role],
  );
  const context = await browser!.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  await context.addInitScript((origin) => {
    if (location.origin !== origin) return;
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  }, admin);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(admin, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Administrator email").fill(email);
  const [challenge] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/admin/auth/challenge",
    ),
    page
      .getByRole("button", { name: "Send admin sign-in code", exact: true })
      .click(),
  ]);
  assert.equal(challenge.status(), 200);
  const mail = JSON.parse(
    await readFile(
      path.join(
        isolated.directory,
        "mailbox",
        (await challenge.json()).challenge_id + ".json",
      ),
      "utf8",
    ),
  );
  assert.equal(mail.to, email);
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('input[name="totp"]').fill(
    new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  );
  const [verified] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/admin/auth/verify",
    ),
    page
      .getByRole("button", { name: "Verify & open dashboard", exact: true })
      .click(),
  ]);
  assert.equal(verified.status(), 200);
  const auth = await verified.json();
  await page.waitForURL(readonly ? "**/provider-control" : "**/overview");
  const cookie = (await context.cookies()).find(
    (c) => c.name === "cp_admin_session",
  );
  assert.ok(cookie);
  return {
    page,
    principal,
    role,
    cookie: `cp_admin_session=${cookie.value}`,
    csrf: auth.csrf_token,
  };
}

async function fixture(
  options: {
    image?: boolean;
    budget?: number;
    known?: boolean;
    countOnly?: boolean;
  } = {},
) {
  const s = system;
  const user = await customerLogin(),
    w = ok(
      await call(user, "POST", "/v1/tenants", {
        name: "Provider admin customer",
        project_name: "Scoped reconciliation",
      }),
    );
  const tenant = w.tenant.id,
    project = w.project.id;
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [tenant],
  );
  const t = ok(
    await call(
      user,
      "POST",
      `/v1/tenants/${tenant}/projects/${project}/tasks`,
      {
        title: "Evidence controlled task",
        prompt: "Only explicitly simulated responses",
        role_key: options.image ? "designer" : "marketing-analyst",
        budget_micros: options.budget ?? 1000000,
      },
    ),
  );
  const fence = randomUUID(),
    task = (
      await s.db.control.query(
        "UPDATE tasks SET status='running',attempt=1,fencing_token=$2,lease_until=now()+interval '5 minutes' WHERE id=$1 RETURNING *",
        [t.id, fence],
      )
    ).rows[0];
  const actor = (
    await s.db.control.query(
      "SELECT name,email,auth_version FROM users WHERE id=$1",
      [user.id],
    )
  ).rows[0];
  const principal = {
    id: user.id,
    audience: "user",
    authVersion: actor.auth_version,
    name: actor.name,
    email: actor.email,
    sessionId: "",
    sessionHash: "",
  };
  const cap = await s.db.tx(
    (tx) => taskCapabilities(tx, s.db.config, s.catalog, task),
    tenant,
    true,
    user.id,
  );
  const worker = new Worker(s.db, s.catalog, s.storage);
  const genId = randomUUID(),
    common = {
      taskId: task.id,
      tenantId: tenant,
      projectId: project,
      actorId: user.id,
      capabilityVersionId: options.image ? cap.image!.id : cap.text.id,
      attempt: 1,
      fencingToken: fence,
    };
  const finalize = async (channel: string, id: string | undefined) => {
    await s.db.control.query(
      "UPDATE tasks SET status='reconciling',lease_until=NULL WHERE id=$1",
      [task.id],
    );
    await s.db.control.query(
      "UPDATE reservations SET status='reconciling' WHERE task_id=$1",
      [task.id],
    );
    const row = (
      await s.db.control.query(
        "SELECT * FROM current_ai_provider_requests WHERE channel=$1 AND id=$2",
        [channel, id],
      )
    ).rows[0];
    return { task, user, tenant, project, row };
  };
  let countId: string | undefined;
  if (!options.image) {
    const ci: any = {
      ...common,
      requestId: randomUUID(),
      operation: "responses.input_tokens",
      model: cap.text.body.model_alias,
      requestHash: hash("count fixture"),
      requestBytes: 10,
      generationOperationId: genId,
      generationHash: hash("generation fixture"),
    };
    const count = (await (worker as any).authorizeInference(
      task,
      principal,
      fence,
      ci,
    )) as any;
    await count.dispatch();
    if (options.countOnly) {
      await count.finish({
        state: "unknown",
        code: "SIMULATED_COUNT_RESULT_LOST",
      });
      return finalize("input_count", count.requestId);
    }
    await count.finish({
      state: "completed",
      countedInputTokens: 100,
      httpStatus: 200,
    });
    countId = count.requestId;
  }
  const info: any = {
    ...common,
    requestId: genId,
    operation: options.image ? "images.generate" : "responses",
    model: options.image
      ? cap.image!.body.model_alias
      : cap.text.body.model_alias,
    requestHash: hash("generation fixture"),
    requestBytes: 20,
    ...(options.image ? {} : { inputCountId: countId, maxOutputTokens: 32 }),
  };
  const permit = (await (worker as any).authorizeInference(
    task,
    principal,
    fence,
    info,
  )) as any;
  await permit.dispatch();
  if (options.known)
    await permit.finish({
      state: "completed",
      inputTokens: 100,
      outputTokens: 11,
      httpStatus: 200,
    });
  else
    await permit.finish({ state: "unknown", code: "SIMULATED_RESPONSE_LOST" });
  return finalize("generation", permit.requestId);
}

let Worker: any, taskCapabilities: any, hash: any;
function ok(r: any, status = 200) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}
async function customerLogin() {
  const email = `provider-customer-${randomUUID()}@example.invalid`,
    challenge = ok(await call(undefined, "POST", "/v1/auth/challenge", { email })),
    mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.challenge_id + ".json"), "utf8")),
    result = await call(undefined, "POST", "/v1/auth/verify", {
      challenge_id: challenge.challenge_id,
      code: mail.text.match(/\b\d{6}\b/)[0],
    }),
    auth = ok(result),
    cookie = result.raw.cookies.find((c: any) => c.name === "cp_session");
  return { id: auth.user.id, cookie: `cp_session=${cookie.value}`, csrf: auth.csrf_token };
}
async function providers(page: Page) {
  await response(page, "GET", root + "/requests", () => page.goto(admin + "/provider-control"), "ProviderRequestList");
  await page.getByRole("heading", {name:"Provider controls", exact:true}).waitFor();
}
async function detail(page: Page, id: string) {
  await providers(page);
  const row = page.getByRole("row").filter({hasText:id});
  await response(page, "GET", root + "/requests/generation/" + id,
    () => row.getByRole("button", {name:"View request", exact:true}).click(), "ProviderRequestDetail");
  return page.getByRole("dialog", {name:"Provider request and reconciliation", exact:true});
}
async function submitCommand(page: Page) {
  const d = page.getByRole("dialog", {name:"Preview and independent review", exact:true}),
    preview = await response(page, "POST", root + "/previews", () => d.getByRole("button", {name:"Get current preview", exact:true}).click(), "ProviderPreview");
  assert.equal(preview.creates_business_effect, false);
  const op = await response(page, "POST", root + "/operations", () => d.getByRole("button", {name:"Submit for independent review", exact:true}).click(), "AdminOperation", 202);
  assert.equal(op.state, "pending_approval");
  await d.getByRole("link", {name:"View approvals", exact:true}).click();
  await page.waitForURL(`**/audit?view=approvals&search=${op.id}`);
  return op;
}
let reviews = 0;
async function review(page: Page, op: any, own = false) {
  await page.goto(`${admin}/audit?view=approvals&search=${op.id}`);
  await page.getByRole("button", {name:"Review operation", exact:true}).click();
  const d = page.getByRole("dialog", {name:"Independent review", exact:true});
  if (own) {
    await d.getByText("Another administrator must review this operation.", {exact:true}).waitFor();
    assert.equal(await d.getByRole("button", {name:"Confirm review decision", exact:true}).count(), 0);
    await d.getByRole("button", {name:"Close", exact:true}).click();
    return;
  }
  await screenshot(page, `independent-review-${++reviews}-en`);
  await fit(page);
  await d.getByLabel("Decision", {exact:true}).selectOption("approve");
  await d.getByLabel("Review reason", {exact:true}).fill("Independent verification of synthetic provider source facts");
  const [r] = await Promise.all([
    page.waitForResponse(r => /\/v1\/admin\/approvals\/[^/]+\/decisions$/.test(new URL(r.url()).pathname) && r.request().method()==="POST"),
    d.getByRole("button", {name:"Confirm review decision", exact:true}).click(),
  ]);
  assert.equal(r.status(), 202);
  assert.equal(sample("AdminOperation", await r.json(), "POST independent approval").state, "succeeded");
  await d.waitFor({state:"hidden"});
}
const deadline = setTimeout(() => {
  errors.push("UI verification deadline at " + stage);
  void server?.kill();
}, 480000);
try {
  const load = async (file: string) => import(pathToFileURL(path.join(platform, file)).href),
    { isolatedTestEnvironment } = await load("tests/native-test-environment.ts"),
    { buildApp } = await load("src/server.ts"),
    { loadConfig } = await load("src/config.ts"),
    { installIsolatedProviderPolicy } = await load("tests/provider-policy-fixture.ts");
  ({Worker} = await load("src/worker.ts"));
  ({taskCapabilities} = await load("src/capability-bindings.ts"));
  ({hash} = await load("src/lib.ts"));
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({...isolated.env, NODE_ENV:"test", DEV_MAILBOX:"true", WORKER_ENABLED:"false", DEMO_MODE:"true"}), {worker:false});
  await installIsolatedProviderPolicy(system.db);
  await system.app.listen({host:"127.0.0.1", port:4310});
  const executable = process.env.CHROME_BIN ?? chromium.executablePath();
  server = await chromium.launchServer({headless:true, executablePath:executable, args:["--disable-gpu"], timeout:15000});
  browser = await chromium.connect(server.wsEndpoint(), {timeout:15000});
  browserRuntime = {executable, sha256:sha(await readFile(executable)), version:browser.version()};
  stage = "independent real Admin sessions";
  const operator = await login("Synthetic provider operator"),
    reviewer = await login("Synthetic independent provider reviewer"),
    page = operator.page;
  pass("two independent actual email and TOTP browser sessions");
  stage = "typed policy draft";
  await providers(page);
  const currentResponse = page.waitForResponse(r => new URL(r.url()).pathname===root+"/policy");
  await page.getByRole("button", {name:"Policy versions", exact:true}).click();
  const initial = sample("ProviderCurrentPolicy", await (await currentResponse).json(), "GET current policy before publication");
  sample("ProviderPolicyList", ok(await call(operator, "GET", root+"/policies")), "GET immutable policy directory");
  await page.getByRole("button", {name:"New draft", exact:true}).click();
  const editor = page.getByRole("dialog", {name:"New policy draft", exact:true});
  await editor.locator('[name="count_price_micros"]').fill("0.000003");
  await editor.locator('[name="verification_run_micros"]').fill("1.000000");
  await editor.locator('[name="verification_daily_micros"]').fill("10.000000");
  await editor.locator('[name="counting_daily_micros"]').fill("10.000000");
  await editor.locator('[name="verified"]').check();
  await editor.getByLabel("Contract source reference", {exact:true}).fill("Synthetic internal counting contract");
  await editor.getByLabel("Contract terms and verification statement", {exact:true}).fill("Synthetic counting fee: HKD 0.000003 per call. No live service qualification.");
  await editor.getByLabel("Contract effective time", {exact:true}).fill("2026-01-01T00:00");
  await editor.getByLabel("Reason", {exact:true}).fill("Synthetic independent provider policy browser verification");
  const draft = await response(page, "POST", root+"/policies/drafts", () => editor.getByRole("button", {name:"Save draft", exact:true}).click(), "AdminOperation", 202);
  assert.equal(draft.state, "succeeded");
  assert.equal(ok(await call(operator,"GET",root+"/policy")).revision, initial.revision);
  await editor.waitFor({state:"hidden"});
  await screenshot(page,"policy-draft-en");
  pass("typed policy fields retain a three-micro HKD counting fee and an immutable draft has no live effect");
  stage = "policy independent publication";
  await page.getByRole("button", {name:"Preview publication", exact:true}).click();
  const publication = await submitCommand(page);
  await review(page, publication, true);
  assert.equal(ok(await call(operator,"GET",root+"/policy")).revision, initial.revision);
  await review(reviewer.page, publication);
  const published = sample("ProviderCurrentPolicy", ok(await call(operator,"GET",root+"/policy")), "GET independently published policy");
  assert.equal(published.revision, initial.revision+1);
  assert.equal(published.budget.count_price_micros,"3");
  pass("actual policy preview and review reject self-approval and update the published head only after a second Admin approves");
  stage = "simulated original unknown provider request";
  const f = await fixture(), r = f.row;
  let d = await detail(page, r.id);
  await screenshot(page,"unknown-request-en");
  await fit(page);
  assert.ok(await d.getByText("Capacity held",{exact:true}).count());
  pass("request directory and detail retain an actual persisted unknown observation and a held shared capacity slot");
  stage = "human source registration and canonical download";
  await d.getByText("Register provider usage or termination evidence",{exact:true}).click();
  await d.getByLabel("Provider reference",{exact:true}).fill("Synthetic invoice reference");
  await d.getByLabel("Source document reference",{exact:true}).fill("Synthetic retained usage statement");
  await d.getByLabel("Inspectable source statement",{exact:true}).fill("Human-entered simulated provider record for independent browser review; no authenticated callback.");
  const localTime = new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,19);
  await d.getByLabel("Source observation time",{exact:true}).fill(localTime.endsWith(":00") ? localTime.slice(0,-3) : localTime);
  await d.getByLabel("Actual input tokens",{exact:true}).fill("100");
  await d.getByLabel("Actual output tokens",{exact:true}).fill("11");
  const amount = (100n*BigInt(r.rate_snapshot[0])+11n*BigInt(r.rate_snapshot[1])+999999n)/1000000n;
  await d.getByLabel("Source invoice amount (HKD)",{exact:true}).fill(`${amount/1000000n}.${(amount%1000000n).toString().padStart(6,"0")}`);
  await d.getByLabel("Reason",{exact:true}).fill("Retain synthetic source facts for independent reconciliation");
  const evidence = await response(page,"POST",`${root}/requests/generation/${r.id}/evidence`,() => d.getByRole("button",{name:"Register immutable evidence",exact:true}).click(),"AdminOperation",202);
  await d.getByRole("button",{name:"Inspect source",exact:true}).click();
  const proof = page.getByRole("dialog",{name:"Human-submitted source statement",exact:true}),
    record = sample("ProviderEvidenceRecord",ok(await call(operator,"GET",root+"/evidence/"+evidence.result_ids[0])),"GET immutable source evidence");
  const [download] = await Promise.all([page.waitForEvent("download"),proof.getByRole("button",{name:"Download source record",exact:true}).click()]);
  const downloadedFile = path.join(delivery, `evidence/provider-admin-ui-${attempt}-source-download.json`);
  await assert.rejects(access(downloadedFile), (error: any) => error.code === "ENOENT");
  await download.saveAs(downloadedFile);
  assert.equal(sha(await readFile(downloadedFile)),record.document_hash);
  await screenshot(page,"source-evidence-en");
  await proof.getByRole("button",{name:"Close",exact:true}).click();
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ai_provider_cost_confirmations")).rows[0].n,0);
  pass("human source registration is inspectable and canonical download matches its SHA-256 without confirming fees or capacity");
  stage = "independent cost confirmation";
  await d.getByRole("button",{name:"Preview cost confirmation",exact:true}).click();
  const cost = await submitCommand(page);
  await review(reviewer.page,cost);
  const costRow = sample("ProviderRequestDetail",ok(await call(operator,"GET",`${root}/requests/generation/${r.id}`)),"GET cost-confirmed original request");
  assert.equal(costRow.state,"unknown");
  assert.equal(costRow.cost.state,"manually_confirmed");
  assert.equal(costRow.capacity_held,true);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",[f.task.id])).rows[0].n,0);
  pass("independent cost confirmation retains the original unknown observation, keeps capacity held and creates no customer debit");
  stage = "independent capacity release";
  d = await detail(page,r.id);
  await d.getByRole("button",{name:"Preview capacity release",exact:true}).click();
  const capacity = await submitCommand(page);
  await review(reviewer.page,capacity);
  assert.equal(ok(await call(operator,"GET",`${root}/requests/generation/${r.id}`)).capacity_held,false);
  pass("a separately previewed and approved termination fact releases shared capacity");
  stage = "original task settlement";
  d = await detail(page,r.id);
  await d.getByText("Settle original task costs",{exact:true}).click();
  await d.getByLabel("Settlement reason",{exact:true}).fill("Settle confirmed original usage without retrying the business task");
  await d.getByLabel("Acknowledge historical budget violations, if any",{exact:true}).check();
  sample("ProviderTaskSettlementFacts",ok(await call(operator,"GET",`${root}/tasks/${f.task.id}/settlement`)),"GET original task settlement facts");
  await d.getByRole("button",{name:"Check task and preview settlement",exact:true}).click();
  const settlement = await submitCommand(page);
  await review(reviewer.page,settlement);
  const task = (await system.db.control.query("SELECT status,charged_micros FROM tasks WHERE id=$1",[f.task.id])).rows[0];
  assert.equal(task.status,"failed");
  assert.equal(task.charged_micros,amount.toString());
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",[f.task.id])).rows[0].n,1);
  pass("independent settlement derives exactly one original customer debit, excludes platform counting fees and retains a failed business result");
  stage = "read-only permission redaction";
  const readonly = await login("Synthetic provider read-only observer",true);
  await readonly.page.getByRole("row").filter({hasText:r.id}).getByRole("button",{name:"View request",exact:true}).click();
  const rd = readonly.page.getByRole("dialog",{name:"Provider request and reconciliation",exact:true});
  await rd.getByText("Internal cost permission required",{exact:true}).waitFor();
  assert.equal(await rd.getByRole("button",{name:"Preview cost confirmation",exact:true}).count(),0);
  const redacted = sample("ProviderRequestDetail",ok(await call(readonly,"GET",`${root}/requests/generation/${r.id}`)),"GET redacted request detail");
  assert.equal("cost" in redacted,false);
  assert.equal((await call(readonly,"POST",root+"/previews",{action:"ai.capacity.release",channel:"generation",request_id:r.id,evidence_id:evidence.result_ids[0],reason:"Synthetic forced forbidden mutation"})).status,403);
  await screenshot(readonly.page,"read-only-en");
  pass("read-only UI and actual DTO omit all cost and evidence fields and the server rejects a forced mutation");
  stage = "bilingual responsive dark interface";
  await providers(page);
  await page.evaluate(() => {localStorage.setItem("cp_locale","zh-HK");localStorage.setItem("cp_theme","dark");});
  await page.reload();
  await page.getByRole("heading",{name:"調用管理",exact:true}).waitFor();
  await screenshot(page,"requests-zh-dark");
  await fit(page);
  await page.setViewportSize({width:390,height:844});
  await fit(page);
  await screenshot(page,"requests-zh-mobile");
  await page.getByRole("row").filter({hasText:r.id}).getByRole("button",{name:"查看請求",exact:true}).click();
  await page.getByRole("dialog",{name:"逐次調用與核對",exact:true}).waitFor();
  await fit(page);
  await screenshot(page,"detail-zh-mobile");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(),0);
  pass("Chinese dark desktop and 390-pixel layouts fit their viewport and request dialogs close with Escape");
  assert.equal(errors.length,0,errors.join("\n"));
} catch (error) {
  errors.push(stage + ": " + (error as Error).message);
} finally {
  clearTimeout(deadline);
  for (const context of contexts) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) {
    await server.close().catch(async () => server!.kill());
    browserClosed =
      server.process().exitCode !== null ||
      server.process().signalCode !== null;
  }
  if (system) {
    try {
      await system.app.close();
      appClosed = true;
    } catch {
      errors.push("Owned API close failed");
    }
  }
  if (isolated) {
    const previous = process.cwd();
    process.chdir(platform);
    try {
      await isolated.cleanup();
      databaseDropped = true;
    } catch {
      errors.push("Owned fixture/database cleanup failed");
    } finally {
      process.chdir(previous);
    }
  }
  const passed =
    errors.length === 0 && browserClosed && appClosed && databaseDropped;
  await writeFile(
    path.join(
      delivery,
      `evidence/provider-admin-ui-${attempt}-journey.json`,
    ),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope:
          "Actual built Admin, real email/TOTP sessions, isolated native PostgreSQL and labelled simulated provider observations; no live service qualification or original end-to-end acceptance claim",
        checks,
        errors,
        samples,
        screenshots,
        browser_closed: browserClosed,
        browser_runtime: browserRuntime,
        owned_api_closed: appClosed,
        isolated_database_dropped_or_deferred_fixture_queued: databaseDropped,
        supplemental_contract_sha256: sha(contractBytes),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: passed ? "passed" : "failed",
      checks: checks.length,
      errors,
      browser_closed: browserClosed,
      owned_api_closed: appClosed,
    }),
  );
  process.exitCode = passed ? 0 : 1;
}
