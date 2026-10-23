import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
} from "playwright";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const platform = path.resolve("../copypaste-platform"),
  origin = "http://localhost:4310",
  web = "http://localhost:4317",
  admin = "http://localhost:4318",
  requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth"),
  sha = (value: Buffer | string) =>
    createHash("sha256").update(value).digest("hex");
type Client = { id: string; cookie: string; csrf: string; user: boolean };
const clients: Client[] = [],
  principals: string[] = [],
  contexts: BrowserContext[] = [],
  checks: any[] = [],
  errors: string[] = [],
  samples: any[] = [],
  screenshots: any[] = [];
let db: any,
  browser: Browser | undefined,
  server: BrowserServer | undefined,
  stage = "initializing",
  closed = false,
  sessionsClosed = false,
  adminsDisabled = false;
const pass = (name: string) => {
  checks.push({ name, status: "passed" });
  console.log("PASS: " + name);
};
async function sources() {
  const result: Record<string, string> = {};
  for (const repo of [
    "copypaste-platform",
    "copypaste-admin",
    "copypaste-web",
    "copypaste-desktop",
    "copypaste-extension",
  ]) {
    const files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: path.resolve("..", repo), encoding: "utf8", windowsHide: true },
    ).split("\0");
    for (const file of files)
      if (
        /^(src|renderer|migrations|catalog|contracts|public)\//.test(file) ||
        /^(package(-lock)?|tsconfig)\.json$/.test(file)
      )
        result[repo + "/" + file] = sha(
          await readFile(path.resolve("..", repo, file)),
        );
  }
  result["copypaste-delivery/scripts/qa-resource-ui.ts"] = sha(
    await readFile(import.meta.filename),
  );
  return Object.fromEntries(Object.entries(result).sort());
}
const before = await sources();
const deadline = setTimeout(() => {
  errors.push("Resource QA exceeded 300 seconds at " + stage);
  void server?.kill();
}, 300000);
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const tenant = /^\/v1\/tenants\/([^/]+)/.exec(url)?.[1];
  const r = await fetch(origin + url, {
    method,
    headers: {
      Origin: url.startsWith("/v1/admin") ? admin : web,
      "Idempotency-Key": randomUUID(),
      ...(c ? { Cookie: c.cookie, "X-CSRF-Token": c.csrf } : {}),
      ...(tenant ? { "X-Tenant-ID": tenant } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
async function login(email: string, secret?: any) {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth",
    challenge = await call(undefined, "POST", prefix + "/challenge", { email });
  assert.equal(challenge.status, 200);
  let mail: any;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
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
  const r = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: challenge.data.challenge_id,
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
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookieName = secret ? "cp_admin_session" : "cp_session",
    client: Client = {
      id: r.data.user?.id ?? r.data.admin?.id ?? "",
      cookie: r.headers
        .getSetCookie()
        .find((c) => c.startsWith(cookieName + "="))!
        .split(";")[0],
      csrf: r.data.csrf_token,
      user: !secret,
    };
  if (secret) {
    const me = await call(client, "GET", "/v1/admin/me");
    assert.equal(me.status, 200);
    client.id = me.data.user.id;
    client.csrf = me.data.csrf_token;
  }
  clients.push(client);
  return client;
}
async function approve(op: any, reviewer: Client) {
  if (op.state !== "pending_approval") {
    assert.equal(op.state, "succeeded", JSON.stringify(op));
    return op;
  }
  const p = await call(
    reviewer,
    "GET",
    `/v1/admin/operations/${op.id}/approval`,
  );
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const r = await call(
    reviewer,
    "POST",
    `/v1/admin/approvals/${p.data.id}/decisions`,
    {
      expected_version: p.data.version,
      payload_hash: p.data.payload_hash,
      decision: "approve",
      reason: "Independent synthetic resource QA review",
    },
  );
  assert.equal(r.data.state, "succeeded", JSON.stringify(r.data));
  return r.data;
}
async function plan(operator: Client, reviewer: Client, storage: number) {
  const d = await call(operator, "POST", "/v1/admin/plans/drafts", {
    plan_id: randomUUID(),
    name: "Synthetic enterprise capacity",
    allowances: {
      feature_ids: ["text", "local_files"],
      allowed_role_ids: ["assistant"],
      seat_limit: 3,
      task_concurrency: 2,
      storage_bytes: storage,
      included_credit: { currency: "HKD", amount_micros: "0" },
      credit_policy: "no_automatic_credit",
    },
    reason: "Define synthetic resource plan",
  });
  assert.equal(d.status, 202, JSON.stringify(d.data));
  const v = (
      await call(operator, "GET", "/v1/admin/plans/" + d.data.result_ids[0])
    ).data,
    b = {
      expected_version: v.version,
      reason: "Publish fixed resource test plan",
    },
    p = await call(
      operator,
      "POST",
      `/v1/admin/plans/${v.id}/publication-previews`,
      b,
    );
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const o = await call(
    operator,
    "POST",
    `/v1/admin/plans/${v.id}/publications`,
    b,
    { "X-Admin-Preview-ID": p.data.preview_id },
  );
  assert.equal(o.status, 202, JSON.stringify(o.data));
  await approve(o.data, reviewer);
  return v;
}
async function grant(
  operator: Client,
  reviewer: Client,
  tenant: string,
  v: any,
  replace = false,
) {
  const root = "/v1/admin/entitlement-grants",
    s = await call(operator, "GET", `${root}/subjects/tenant/${tenant}`),
    b = {
      subject: { kind: "tenant", id: tenant },
      plan_version_id: v.id,
      starts_at: new Date(Date.now() - 500).toISOString(),
      ends_at: new Date(Date.now() + 3600000).toISOString(),
      overlap_policy: replace ? "replace" : "reject",
      source: "manual",
      auto_renew: false,
      expected_subject_version: s.data.version,
      reason: "Assign synthetic resource allowance",
    };
  const p = await call(operator, "POST", "/v1/admin/entitlement-previews", b);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const o = await call(operator, "POST", root, b, {
    "X-Admin-Preview-ID": p.data.preview_id,
  });
  assert.equal(o.status, 202, JSON.stringify(o.data));
  return approve(o.data, reviewer);
}
async function pageFor(
  client: Client,
  tenant: string,
  project: string,
  width = 1440,
  locale = "en",
  theme = "light",
) {
  const context = await browser!.newContext({
    viewport: { width, height: 1080 },
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  const split = client.cookie.indexOf("=");
  await context.addCookies([
    {
      name: client.cookie.slice(0, split),
      value: client.cookie.slice(split + 1),
      url: client.user ? web : admin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(
    ({ tenant, project, locale, theme }) => {
      localStorage.setItem("cp_tenant", tenant);
      localStorage.setItem("cp_project", project);
      localStorage.setItem("cp_locale", locale);
      localStorage.setItem("cp_theme", theme);
    },
    { tenant, project, locale, theme },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function capture(page: Page, name: string, repo: string) {
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
    "No horizontal document overflow",
  );
  const file = path.resolve("..", repo, "assets/screenshots", name);
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({
    path: file,
    fullPage: (await page.locator(".modal-backdrop").count()) === 0,
  });
  screenshots.push({
    file: "dev/" + repo + "/assets/screenshots/" + name,
    sha256: sha(await readFile(file)),
    url: page.url(),
    viewport: page.viewportSize(),
    locale: await page.evaluate(() => document.documentElement.lang),
    theme: await page.evaluate(() => document.documentElement.dataset.theme),
  });
}
function sample(name: string, data: any) {
  assert.equal(data.scope, "tenant");
  assert.ok(data.plan_version_ids.length > 0);
  assert.ok(Number.isSafeInteger(data.seats.used));
  assert.ok(Number.isSafeInteger(data.seats.limit));
  for (const key of [
    "used_bytes",
    "reserved_bytes",
    "total_bytes",
    "limit_bytes",
    "remaining_bytes",
  ])
    assert.match(data.storage[key], /^(0|[1-9][0-9]*)$/);
  assert.equal(
    BigInt(data.storage.total_bytes),
    BigInt(data.storage.used_bytes) + BigInt(data.storage.reserved_bytes),
  );
  samples.push({ name, response: data });
}
try {
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.equal(url.port, "55432");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { seal } = await import(
    pathToFileURL(path.join(platform, "src/lib.ts")).href
  );
  for (let n = 0; n < 2; n++) {
    const secret = new OTPAuth.Secret({ size: 20 }),
      email = `resource-ui-${randomUUID()}@example.invalid`,
      p = (
        await db.query(
          "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic resource QA',$2) RETURNING id",
          [email, seal(env.MASTER_KEY!, secret.base32)],
        )
      ).rows[0];
    principals.push(p.id);
    await db.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
      [p.id],
    );
    await login(email, secret);
  }
  const [operator, reviewer] = clients,
    user = await login("resource-user-" + randomUUID() + "@example.invalid");
  stage = "fixed tenant plan";
  const w = await call(user, "POST", "/v1/tenants", {
    name: "Synthetic resource QA " + randomUUID().slice(0, 8),
    project_name: "Resource acceptance",
  });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  const tenant = w.data.tenant.id,
    project = w.data.project.id,
    base = `/v1/tenants/${tenant}`,
    v = await plan(operator, reviewer, 16384);
  await grant(operator, reviewer, tenant, v);
  pass(
    "real email/TOTP sessions, fixed tenant plan and independently reviewed grant; no model call or wallet credit",
  );
  stage = "actual retained file";
  const content = "a".repeat(2048),
    u = await call(user, "POST", `${base}/projects/${project}/uploads`, {
      project_id: project,
      filename: "capacity-evidence.txt",
      content_type: "text/plain",
      size_bytes: 2048,
      sha256: sha(content),
    });
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const upload = `${base}/projects/${project}/uploads/${u.data.upload_id}`;
  assert.equal(
    (
      await call(user, "POST", upload + "/parts/0", {
        sha256: sha(content),
        base64: Buffer.from(content).toString("base64"),
      })
    ).status,
    200,
  );
  const completed = await call(user, "POST", upload + "/complete", {
    size_bytes: 2048,
    sha256: sha(content),
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  const used = await call(user, "GET", base + "/resource-usage");
  assert.equal(used.status, 200);
  sample("user-retained-file", used.data);
  assert.equal(used.data.storage.used_bytes, "2048");
  assert.equal(used.data.storage.reserved_bytes, "0");
  assert.deepEqual(used.data.plan_version_ids, [v.id]);
  pass(
    "a real 2048-byte resumable upload converts its reservation once and tenant aggregate records the retained version",
  );
  stage = "Web and Admin actual pages";
  server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.WEB_CHROME_BIN ?? process.env.CHROME_BIN,
  });
  browser = await chromium.connect(server.wsEndpoint());
  const p = await pageFor(user, tenant, project);
  await p.goto(web + "/app/usage");
  const capacity = p.getByRole("region", {
    name: "Workspace capacity",
    exact: true,
  });
  await capacity
    .getByText("Total storage allocation: 2,048 / 16,384 B", { exact: true })
    .waitFor();
  await capture(p, "71-workspace-resource-usage.png", "copypaste-web");
  await p.goto(web + "/app/members");
  await p
    .getByRole("region", { name: "Workspace capacity", exact: true })
    .getByText("Seats used: 1 / 3", { exact: true })
    .waitFor();
  await capture(p, "72-members-resource-capacity.png", "copypaste-web");
  pass(
    "actual Web usage and member pages display the server's fixed tenant capacities with no horizontal overflow",
  );
  const a = await pageFor(operator, tenant, project);
  await a.goto(
    admin + "/tenants?search=" + encodeURIComponent(w.data.tenant.name),
  );
  const row = a.getByRole("row").filter({ hasText: w.data.tenant.name });
  await row
    .getByRole("button", { name: "Workspace capacity", exact: true })
    .click();
  const modal = a.getByRole("dialog");
  await modal
    .getByText("Total storage allocation: 2,048 / 16,384 B", { exact: true })
    .waitFor();
  await capture(a, "71-admin-workspace-capacity.png", "copypaste-admin");
  const adminRead = await call(
    operator,
    "GET",
    `/v1/admin/tenants/${tenant}/resource-usage`,
  );
  assert.equal(adminRead.status, 200);
  sample("admin-whole-tenant", adminRead.data);
  pass(
    "actual Admin workspace action opens an accessible capacity dialog backed by both current whole-tenant read permissions",
  );
  stage = "bilingual narrow capacity";
  const small = await pageFor(user, tenant, project, 375, "zh-HK", "dark");
  await small.goto(web + "/app/usage");
  await small
    .getByRole("region", { name: "企業容量", exact: true })
    .getByText("總存儲佔用: 2,048 / 16,384 B", { exact: true })
    .waitFor();
  await capture(small, "73-resource-capacity-mobile-dark.png", "copypaste-web");
  const smallAdmin = await pageFor(
    reviewer,
    tenant,
    project,
    375,
    "zh-HK",
    "dark",
  );
  await smallAdmin.goto(
    admin + "/tenants?search=" + encodeURIComponent(w.data.tenant.name),
  );
  await smallAdmin
    .getByRole("row")
    .filter({ hasText: w.data.tenant.name })
    .getByRole("button", { name: "企業容量", exact: true })
    .click();
  await smallAdmin
    .getByRole("dialog")
    .getByText("總存儲佔用: 2,048 / 16,384 B", { exact: true })
    .waitFor();
  await capture(
    smallAdmin,
    "72-admin-capacity-mobile-dark.png",
    "copypaste-admin",
  );
  pass(
    "375px Traditional Chinese dark Web and Admin capacity views retain CopyPaste styling and contain their layouts",
  );
  stage = "quota rejection and downgrade";
  const rejected = await call(
    user,
    "POST",
    `${base}/projects/${project}/uploads`,
    {
      project_id: project,
      filename: "over-capacity.txt",
      content_type: "text/plain",
      size_bytes: 16384,
      sha256: sha("x".repeat(16384)),
    },
  );
  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.error.code, "PLAN_STORAGE_LIMIT");
  assert.equal(
    (await call(user, "GET", base + "/resource-usage")).data.storage
      .total_bytes,
    "2048",
  );
  pass(
    "a real over-capacity HTTP upload is rejected without an allocation or version side effect",
  );
  await grant(
    operator,
    reviewer,
    tenant,
    await plan(operator, reviewer, 1024),
    true,
  );
  await p.goto(web + "/app/usage");
  await p
    .getByRole("region", { name: "Workspace capacity", exact: true })
    .getByRole("status")
    .waitFor();
  await capture(p, "74-resource-over-capacity.png", "copypaste-web");
  await modal
    .getByRole("button", { name: "Refresh capacity", exact: true })
    .click();
  await modal.getByRole("status").waitFor();
  await capture(a, "73-admin-over-capacity.png", "copypaste-admin");
  const retained = await call(
    user,
    "GET",
    `${base}/projects/${project}/assets/${completed.data.id}/versions`,
  );
  assert.equal(retained.status, 200);
  assert.equal(retained.data.items.length, 1);
  sample(
    "retained-after-downgrade",
    (await call(user, "GET", base + "/resource-usage")).data,
  );
  pass(
    "explicit downgrade appears on real Web/Admin pages, blocks growth and retains the original file version",
  );
  stage = "revocation clears the displayed aggregate";
  await db.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Synthetic capacity read denial',$2)",
    ["resource-deny-" + tenant, JSON.stringify(["admin.entitlements.read"])],
  );
  await db.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'tenant',$3,'deny')",
    [operator.id, "resource-deny-" + tenant, tenant],
  );
  await modal
    .getByRole("button", { name: "Refresh capacity", exact: true })
    .click();
  await modal.getByRole("alert").waitFor();
  assert.equal(
    await modal.getByText("Total storage allocation", { exact: false }).count(),
    0,
  );
  await capture(
    a,
    "74-admin-capacity-permission-revoked.png",
    "copypaste-admin",
  );
  pass(
    "an overlapping read denial is enforced on refresh and the Admin dialog clears its former tenant aggregate",
  );
} catch (e) {
  errors.push(stage + ": " + (e instanceof Error ? e.message : String(e)));
} finally {
  for (const c of contexts) await c.close().catch(() => {});
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  clearTimeout(deadline);
  closed =
    !server ||
    server.process().exitCode !== null ||
    server.process().signalCode !== null;
  if (!closed) {
    await server?.kill();
    closed = true;
    errors.push("Owned browser needed forced closure");
  }
  for (const c of clients)
    try {
      const r = await call(
        c,
        "POST",
        c.user ? "/v1/auth/logout" : "/v1/admin/auth/logout",
      );
      if (r.status !== 200) errors.push("Owned logout failed");
    } catch {
      errors.push("Owned logout failed");
    }
  if (db) {
    try {
      await db.query(
        "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE admin_id=ANY($1::uuid[]) OR user_id=ANY($2::uuid[])",
        [principals, clients.filter((c) => c.user).map((c) => c.id)],
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
      errors.push("Owned identity cleanup failed");
    } finally {
      await db.end();
    }
  }
  const unchanged = JSON.stringify(before) === JSON.stringify(await sources());
  if (!unchanged) errors.push("Product source changed during capacity QA");
  const report = {
    at: new Date().toISOString(),
    status: errors.length ? "failed" : "passed",
    scope:
      "Tenant seat/storage enforcement and actual capacity views only; original 102 acceptance cases, provider acceptance and complete production qualification remain separate",
    checks,
    errors,
    screenshots,
    source_files: before,
    source_unchanged: unchanged,
    browser_closed: closed,
    user_browser_tabs_touched: false,
    owned_sessions_closed: sessionsClosed,
    owned_admin_principals_disabled: adminsDisabled,
    model_calls: 0,
    external_payments: 0,
  };
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/resource-ui.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    "evidence/resource-ui-http-samples.json",
    JSON.stringify(
      {
        at: report.at,
        scope:
          "Supplemental tenant resource aggregate, not a replacement for the original effective entitlement DTO",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: checks.length,
      samples: samples.length,
      screenshots: screenshots.length,
      errors,
      browser_closed: closed,
      source_unchanged: unchanged,
    }),
  );
  if (errors.length) process.exitCode = 1;
}
