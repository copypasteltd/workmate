import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
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
let financialDb: any;
const pass = (name: string) => checks.push({ name, status: "passed" });
function sample(
  name: string,
  operation: string,
  schema: string,
  r: { status: number; data: unknown },
) {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  samples.push({ name, operation, schema, status: r.status, response: r.data });
}
try {
  const config = await (
    await fetch(origin + "/v1/public/config", {
      signal: AbortSignal.timeout(10000),
    })
  ).json();
  assert.equal(config.data_mode, "simulated");
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { seal } = await import(
    pathToFileURL(path.join(platform, "src/lib.ts")).href
  );
  const { Database } = await import(
    pathToFileURL(path.join(platform, "src/db.ts")).href
  );
  const { loadConfig } = await import(
    pathToFileURL(path.join(platform, "src/config.ts")).href
  );
  const { fund, reserve, settle } = await import(
    pathToFileURL(path.join(platform, "src/billing.ts")).href
  );
  financialDb = new Database(loadConfig({ ...env, DEMO_MODE: "true" }));
  const u = client(),
    user = await login(u, `billing-wire-user-${randomUUID()}@example.invalid`);
  users.push(user.id);
  const email = `billing-wire-admin-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  const admin = (
    await db.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic billing read operator',$2) RETURNING id",
      [email, seal(env.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  principals.push(admin.id);
  await db.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
    [admin.id],
  );
  const a = client(true);
  await login(a, email, secret);
  pass(
    "real canonical user email session and owned administrator email/TOTP session on the restarted current API",
  );
  const self = await call(u, "GET", "/v1/me/billing-accounts");
  assert.equal(self.status, 200);
  assert.equal(self.data.items.length, 1);
  const account = self.data.items[0];
  assert.deepEqual(account.subject, { kind: "user", id: user.id });
  const base = "/v1/admin/billing/accounts",
    filtered = await call(a, "GET", base + "?subject_id=" + user.id);
  sample(
    "personal-subject-list",
    "listAdminBillingAccounts",
    "AdminBillingAccountList",
    filtered,
  );
  assert.equal(filtered.data.items.length, 1);
  assert.equal(filtered.data.items[0].id, account.id);
  sample(
    "personal-account",
    "getAdminBillingAccount",
    "AdminBillingAccount",
    await call(a, "GET", base + "/" + account.id),
  );
  assert.equal((await call(u, "GET", base)).status, 401);
  pass(
    "strict canonical personal account/list reads expose the true current-mode subject and retain Admin versus user isolation",
  );
  const w = await call(u, "POST", "/v1/tenants", {
    name: "Synthetic billing wire workspace",
    project_name: "Controlled financial reads",
  });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  const enterprise = (
    await db.query("SELECT id FROM wallets WHERE tenant_id=$1", [
      w.data.tenant.id,
    ])
  ).rows[0].id;
  sample(
    "enterprise-subject-list",
    "listAdminBillingAccounts",
    "AdminBillingAccountList",
    await call(a, "GET", base + "?subject_id=" + w.data.tenant.id),
  );
  await financialDb.tx(
    async (tx: any) => {
      await fund(
        tx,
        {
          billing_account_id: account.id,
          action: "gift",
          amount_micros: "100",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          reason:
            "Synthetic internal fixture gift; no payment or administrator fee command",
        },
        randomUUID(),
      );
      const t = (
        await tx.query(
          "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,billing_account_id) VALUES($1,$2,$3,'Synthetic unexecuted task','No model invocation','assistant','fixture',40,$4,$5) RETURNING id",
          [
            w.data.tenant.id,
            w.data.project.id,
            user.id,
            randomUUID(),
            account.id,
          ],
        )
      ).rows[0];
      await reserve(tx, w.data.tenant.id, t.id, 40);
      await settle(tx, w.data.tenant.id, t.id, 15, user.id);
      await tx.query("UPDATE tasks SET status='cancelled' WHERE id=$1", [t.id]);
    },
    undefined,
    true,
  );
  const ledger = await call(a, "GET", base + "/" + account.id + "/ledger");
  sample(
    "personal-funded-task-ledger",
    "listAdminLedgerEntries",
    "AdminLedgerEntryList",
    ledger,
  );
  const hold = ledger.data.items.find((e: any) => e.kind === "reserve"),
    consume = ledger.data.items.find((e: any) => e.kind === "consume"),
    release = ledger.data.items.find((e: any) => e.kind === "release");
  assert.equal(hold.actor_id, user.id);
  assert.equal(consume.actor_id, user.id);
  assert.equal(consume.source_entry_id, hold.id);
  assert.equal(release.amount.amount_micros, "25");
  const balance = await call(a, "GET", base + "/" + account.id);
  sample(
    "personal-after-settlement",
    "getAdminBillingAccount",
    "AdminBillingAccount",
    balance,
  );
  assert.equal(balance.data.promotional_balance.amount_micros, "85");
  assert.equal(balance.data.reserved.amount_micros, "0");
  const enterpriseLedger = await call(
    a,
    "GET",
    base + "/" + enterprise + "/ledger",
  );
  sample(
    "enterprise-without-personal-consumption",
    "listAdminLedgerEntries",
    "AdminLedgerEntryList",
    enterpriseLedger,
  );
  assert.ok(
    !enterpriseLedger.data.items.some((e: any) => e.kind === "consume"),
  );
  pass(
    "actual internal fixture funding and settlement produce persistent actor/operation/source identities while enterprise finance excludes personal consumption; models and external payments are not called",
  );
  const page = await call(a, "GET", base + "?limit=1");
  sample(
    "account-cursor-page",
    "listAdminBillingAccounts",
    "AdminBillingAccountList",
    page,
  );
  assert.ok(page.data.next_cursor);
  const next = await call(
    a,
    "GET",
    base + "?limit=1&cursor=" + encodeURIComponent(page.data.next_cursor),
  );
  sample(
    "account-cursor-next",
    "listAdminBillingAccounts",
    "AdminBillingAccountList",
    next,
  );
  assert.notEqual(page.data.items[0].id, next.data.items[0].id);
  assert.equal(
    (
      await call(
        a,
        "GET",
        base +
          "?limit=1&subject_id=" +
          user.id +
          "&cursor=" +
          encodeURIComponent(page.data.next_cursor),
      )
    ).status,
    400,
  );
  const blocked = await call(
    u,
    "POST",
    "/v1/tenants",
    { name: "Must not be created", project_name: "Unsupported selection" },
    { headers: { "X-Billing-Account-ID": account.id } },
  );
  assert.equal(blocked.status, 400);
  assert.equal(blocked.data.error.code, "BILLING_SELECTION_UNSUPPORTED");
  const preflight = await fetch(
    origin +
      `/v1/tenants/${w.data.tenant.id}/projects/${w.data.project.id}/tasks`,
    {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:4317",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-billing-account-id,x-csrf-token",
      },
      signal: AbortSignal.timeout(10000),
    },
  );
  assert.equal(preflight.status, 204);
  assert.ok(
    preflight.headers
      .get("access-control-allow-headers")
      ?.toLowerCase()
      .includes("x-billing-account-id"),
  );
  pass(
    "signed account pagination rejects changed subject filters, unsupported workflows reject payer selection and the real browser CORS preflight admits the supported header",
  );
  const normative = await readFile(
      path.resolve("../../docs/contracts/openapi.json"),
    ),
    fixture = JSON.parse(
      await readFile(
        path.join(platform, "contracts/admin-billing-schemas.json"),
        "utf8",
      ),
    ),
    spec = JSON.parse(normative.toString("utf8"));
  assert.equal(
    fixture.source_sha256,
    createHash("sha256").update(normative).digest("hex"),
  );
  assert.equal(Object.keys(fixture.schemas).length, 5);
  for (const [name, schema] of Object.entries(fixture.schemas))
    assert.deepEqual(schema, spec.components.schemas[name]);
  await db.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [admin.id],
  );
  const stale = await call(a, "GET", base + "/" + account.id);
  assert.equal(stale.status, 403);
  assert.equal(stale.data.error.code, "MFA_REQUIRED");
  pass(
    "the five fixture schemas retain the original OpenAPI bytes and current MFA is rechecked even for known financial accounts",
  );
} catch (e) {
  errors.push((e as Error).message);
} finally {
  for (const c of clients)
    if (c.csrf)
      try {
        const r = await call(
          c,
          c.admin ? "POST" : "DELETE",
          c.admin ? "/v1/admin/auth/logout" : "/v1/auth/session",
        );
        if (r.status !== 200) {
          closed = false;
          errors.push("Owned logout failed");
        }
      } catch {
        closed = false;
        errors.push("Owned logout failed");
      }
  if (financialDb) await financialDb.close();
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
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM sessions WHERE (user_id=ANY($1::uuid[]) OR admin_id=ANY($2::uuid[])) AND revoked_at IS NULL",
            [users, principals],
          )
        ).rows[0].n,
        0,
      );
    } catch {
      closed = false;
      errors.push("Owned fixture credential cleanup failed");
    } finally {
      await db.end();
    }
  const at = new Date().toISOString();
  await writeFile(
    "evidence/admin-billing-wire.json",
    JSON.stringify(
      {
        at,
        status: errors.length ? "failed" : "passed",
        scope:
          "Current local HTTP canonical billing reads with synthetic internal financial fixtures; not a fee/payment/VIP command, browser, native or production acceptance",
        checks,
        errors,
        model_calls: 0,
        external_payments: 0,
        browser_used: false,
        owned_sessions_closed: closed,
        owned_admin_principals_disabled:
          principals.length === 1 &&
          !errors.includes("Owned fixture credential cleanup failed"),
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/admin-billing-contract-samples.json",
    JSON.stringify(
      {
        at,
        origin,
        scope:
          "Actual current local HTTP billing-account and ledger responses; controlled fixtures only",
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
      owned_sessions_closed: closed,
    }),
  );
  if (errors.length) process.exitCode = 1;
}
