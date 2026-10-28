import { randomUUID } from "node:crypto";
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
const pass = (name: string) => checks.push({ name, status: "passed" });
function sample(
  name: string,
  operation: string,
  r: { status: number; data: unknown },
) {
  samples.push({
    name,
    operation,
    schema: "AdminOperation",
    status: r.status,
    response: r.data,
  });
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
  const owner = client(),
    recipient = client(),
    u = await login(
      owner,
      `account-wire-owner-${randomUUID()}@example.invalid`,
    ),
    r = await login(
      recipient,
      `account-wire-user-${randomUUID()}@example.invalid`,
    );
  users.push(u.id, r.id);
  const w = await call(owner, "POST", "/v1/tenants", {
    name: "Synthetic account controls",
    project_name: "HTTP control checks",
  });
  assert.equal(w.status, 200);
  const other = await call(owner, "POST", "/v1/tenants", {
    name: "Other synthetic workspace",
    project_name: "Scope isolation",
  });
  assert.equal(other.status, 200);
  const admins: Client[] = [];
  for (let i = 0; i < 2; i++) {
    const email = `account-wire-admin-${randomUUID()}@example.invalid`,
      secret = new OTPAuth.Secret({ size: 20 });
    const p = (
      await db.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic account control operator',$2) RETURNING id",
        [email, seal(env.MASTER_KEY!, secret.base32)],
      )
    ).rows[0];
    principals.push(p.id);
    await db.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
      [p.id],
    );
    const c = client(true);
    await login(c, email, secret);
    admins.push(c);
  }
  const [a, reviewer] = admins,
    base = `/v1/admin/users/${r.id}`;
  pass(
    "real canonical user email sessions and two owned global Admin email/TOTP sessions",
  );
  const context = await call(a, "GET", base + "/account-control");
  assert.equal(context.status, 200);
  assert.equal(context.data.version, 1);
  const profile = {
    expected_version: 1,
    display_name: "Synthetic marketing pilot",
    labels: ["synthetic", "marketing"],
    reason: "Verified support profile correction",
  };
  const preview = await call(a, "POST", base + "/profile/preview", profile);
  assert.equal(preview.status, 200);
  const k = randomUUID(),
    p = await call(a, "POST", base + "/profile", profile, {
      key: k,
      headers: { "X-Admin-Preview-ID": preview.data.id },
    });
  assert.equal(p.status, 202, JSON.stringify(p.data));
  assert.equal(p.data.state, "succeeded");
  sample("profile-changed", "changeAdminUserProfile", p);
  assert.deepEqual(
    (
      await call(a, "POST", base + "/profile", profile, {
        key: k,
        headers: { "X-Admin-Preview-ID": preview.data.id },
      })
    ).data,
    p.data,
  );
  sample(
    "profile-operation-read",
    "getAdminOperation",
    await call(a, "GET", `/v1/admin/operations/${p.data.id}`),
  );
  assert.equal(
    (await call(a, "GET", base + "/account-control")).data.version,
    2,
  );
  pass(
    "canonical profile preview, strict 202 operation, immutable policy, lost-response replay and current read",
  );
  const revocation = await call(a, "POST", base + "/session-revocations", {
    reason: "User requested global sign-out",
  });
  assert.equal(revocation.status, 202);
  sample("sessions-revoked", "revokeAdminUserSessions", revocation);
  assert.equal(
    (await call(recipient, "GET", "/v1/session/context")).status,
    401,
  );
  const command = (state: string, version: number) => ({
    expected_version: version,
    state,
    inflight_policy: "stop_new",
    reason: "Synthetic customer account control",
  });
  const freeze = await call(a, "POST", base + "/status", command("frozen", 3));
  assert.equal(freeze.status, 202);
  sample("user-frozen", "changeAdminUserStatus", freeze);
  assert.equal(
    (await call(a, "GET", base + "/account-control")).data.state,
    "frozen",
  );
  pass(
    "global session revocation and user freeze immediately reject the old browser session",
  );
  const tenant = w.data.tenant.id,
    tpath = `/v1/admin/tenants/${tenant}/status`;
  const suspended = await call(a, "POST", tpath, command("suspended", 1));
  assert.equal(suspended.status, 202);
  sample("tenant-suspended", "changeAdminTenantStatus", suspended);
  assert.equal(
    (await call(owner, "GET", `/v1/tenants/${tenant}/members`)).status,
    404,
  );
  assert.equal(
    (await call(owner, "GET", `/v1/tenants/${other.data.tenant.id}/members`))
      .status,
    200,
  );
  const restored = await call(a, "POST", tpath, command("active", 2));
  assert.equal(restored.status, 202);
  sample("tenant-restored", "changeAdminTenantStatus", restored);
  assert.equal(
    (await call(owner, "GET", `/v1/tenants/${tenant}/members`)).status,
    200,
  );
  assert.equal(
    (
      await call(a, "PATCH", `/v1/admin/tenants/${tenant}`, {
        status: "active",
        reason: "Obsolete mutation route",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(a, "PATCH", base, {
        status: "active",
        reason: "Obsolete mutation route",
      })
    ).status,
    404,
  );
  pass(
    "workspace-only suspension and restoration preserve the other workspace; both unsafe legacy PATCH routes are absent",
  );
  const pending = await call(a, "POST", base + "/status", command("closed", 4));
  assert.equal(pending.status, 202);
  assert.equal(pending.data.state, "pending_approval");
  sample("closure-pending", "changeAdminUserStatus", pending);
  const decision = {
    decision: "approve",
    reason: "Independent account closure review",
  };
  assert.equal(
    (
      await call(
        a,
        "POST",
        `/v1/admin/operations/${pending.data.id}/decision`,
        decision,
      )
    ).status,
    403,
  );
  const review = await call(
    reviewer,
    "GET",
    `/v1/admin/operations/${pending.data.id}/account-review`,
  );
  assert.equal(review.status, 200);
  assert.equal(review.data.command.state, "closed");
  const approved = await call(
    reviewer,
    "POST",
    `/v1/admin/operations/${pending.data.id}/decision`,
    decision,
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.state, "succeeded");
  sample(
    "closure-approved-read",
    "getAdminOperation",
    await call(reviewer, "GET", `/v1/admin/operations/${pending.data.id}`),
  );
  assert.equal(
    (await call(reviewer, "GET", base + "/account-control")).data.state,
    "closed",
  );
  pass(
    "account closure remains pending until another administrator reviews the frozen command and approves",
  );
  await db.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [principals[0]],
  );
  const stale = await call(a, "POST", base + "/profile", profile, { key: k });
  assert.equal(stale.status, 403);
  assert.equal(stale.data.error.code, "MFA_REQUIRED");
  pass(
    "current MFA is required even to recover an already committed operation",
  );
} catch (e) {
  errors.push((e as Error).message);
} finally {
  for (const c of clients)
    if (c.csrf) {
      try {
        const result = await call(
          c,
          c.admin ? "POST" : "DELETE",
          c.admin ? "/v1/admin/auth/logout" : "/v1/auth/session",
          c.admin ? {} : undefined,
        );
        assert.ok([200, 401].includes(result.status));
      } catch {
        closed = false;
        errors.push("Owned HTTP logout failed");
      }
    }
  if (db) {
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
  }
  const at = new Date().toISOString();
  await writeFile(
    "evidence/admin-account-wire.json",
    JSON.stringify(
      {
        at,
        scope:
          "Current-source HTTP account lifecycle with synthetic identities; no native or browser UI acceptance claim",
        model_calls: 0,
        checks,
        errors,
        owned_sessions_closed: closed,
        owned_admin_principals_disabled:
          principals.length === 2 &&
          !errors.includes("Owned fixture credential cleanup failed"),
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/admin-account-contract-samples.json",
    JSON.stringify(
      {
        at,
        origin,
        scope:
          "Actual canonical account AdminOperation responses from current local HTTP",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      checks: checks.length,
      errors,
      owned_sessions_closed: closed,
    }),
  );
  if (errors.length) process.exitCode = 1;
}
