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
    recipient = client();
  await login(owner, `admin-wire-owner-${randomUUID()}@example.invalid`);
  const r = await login(
    recipient,
    `admin-wire-member-${randomUUID()}@example.invalid`,
  );
  const w = await call(owner, "POST", "/v1/tenants", {
    name: "Synthetic admin HTTP workspace",
    project_name: "Member controls",
  });
  assert.equal(w.status, 200);
  const tenant = w.data.tenant.id,
    project = w.data.project.id,
    base = `/v1/admin/tenants/${tenant}/memberships`;
  const admins: Client[] = [];
  for (let i = 0; i < 2; i++) {
    const email = `admin-wire-operator-${randomUUID()}@example.invalid`,
      secret = new OTPAuth.Secret({ size: 20 });
    const p = (
      await db.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic scoped membership operator',$2) RETURNING id",
        [email, seal(env.MASTER_KEY!, secret.base32)],
      )
    ).rows[0];
    principals.push(p.id);
    await db.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,'super_admin','tenant',$2)",
      [p.id, tenant],
    );
    const c = client(true);
    await login(c, email, secret);
    admins.push(c);
  }
  const [a, reviewer] = admins;
  pass(
    "two real canonical user email sessions and two owned scoped legacy admin sessions with actual email and TOTP",
  );
  const b = {
      user_id: r.id,
      expected_version: 1,
      role: "member",
      state: "active",
      project_ids: [project],
      reason: "Synthetic customer membership correction",
    },
    k = randomUUID();
  const preview = await call(a, "POST", base + "/preview", b);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.before.id, null);
  assert.equal(preview.data.approval, false);
  const created = await call(a, "POST", base, b, {
    key: k,
    headers: { "X-Admin-Preview-ID": preview.data.id },
  });
  assert.equal(created.status, 202, JSON.stringify(created.data));
  assert.equal(created.data.state, "succeeded");
  sample("member-create", "changeAdminMembership", created);
  assert.deepEqual(
    (await call(a, "POST", base, b, { key: k })).data,
    created.data,
  );
  const read = await call(a, "GET", `/v1/admin/operations/${created.data.id}`);
  assert.equal(read.status, 200);
  sample("operation-read", "getAdminOperation", read);
  assert.deepEqual(read.data, created.data);
  pass(
    "strict canonical 202 member grant persists a real policy ID and recovers the same operation; current GET returns its state",
  );
  const suspension = await call(a, "POST", base, {
    ...b,
    expected_version: 2,
    state: "suspended",
  });
  assert.equal(suspension.status, 202);
  assert.equal(suspension.data.state, "succeeded");
  sample("member-suspend", "changeAdminMembership", suspension);
  assert.equal(
    (await call(recipient, "GET", `/v1/tenants/${tenant}/projects`)).status,
    404,
  );
  const dir = await call(
      owner,
      "GET",
      `/v1/tenants/${tenant}/member-directory`,
    ),
    m = dir.data.items.find((x: any) => x.user_id === r.id);
  assert.equal(m.management_state, "suspended");
  const bypass = await call(
    owner,
    "PATCH",
    `/v1/tenants/${tenant}/members/${r.id}`,
    {
      role: "member",
      status: "active",
      version: m.auth_version,
      project_ids: [project],
    },
  );
  assert.equal(bypass.data.error.code, "ADMIN_MEMBERSHIP_SUSPENDED");
  const resume = await call(a, "POST", base, { ...b, expected_version: 3 });
  assert.equal(resume.status, 202);
  sample("member-resume", "changeAdminMembership", resume);
  assert.equal(
    (await call(recipient, "GET", `/v1/tenants/${tenant}/projects`)).status,
    200,
  );
  pass(
    "suspension denies already signed-in users and blocks owner bypass; explicit admin restoration enables project access",
  );
  const elevated = { ...b, expected_version: 4, role: "admin" },
    pending = await call(a, "POST", base, elevated);
  assert.equal(pending.status, 202);
  assert.equal(pending.data.state, "pending_approval");
  sample("privileged-grant-pending", "changeAdminMembership", pending);
  const review = await call(
    reviewer,
    "GET",
    `/v1/admin/operations/${pending.data.id}/membership-review`,
  );
  assert.equal(review.status, 200);
  assert.deepEqual(review.data.command, elevated);
  assert.equal(review.data.actor_session_id, undefined);
  const decisionPath = `/v1/admin/operations/${pending.data.id}/decision`;
  assert.equal(
    (
      await call(a, "POST", decisionPath, {
        decision: "approve",
        reason: "Self approval must fail",
      })
    ).data.error.code,
    "SELF_APPROVAL_FORBIDDEN",
  );
  const approved = await call(reviewer, "POST", decisionPath, {
    decision: "approve",
    reason: "Independent scope and role review",
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.state, "succeeded");
  sample(
    "privileged-grant-approved-read",
    "getAdminOperation",
    await call(reviewer, "GET", `/v1/admin/operations/${pending.data.id}`),
  );
  pass(
    "privileged access remains pending until a different scoped administrator reviews the frozen payload and approves",
  );
  const removal = await call(a, "POST", base, {
    ...b,
    expected_version: 5,
    state: "removed",
  });
  assert.equal(removal.data.state, "pending_approval");
  await db.query("DELETE FROM admin_bindings WHERE principal_id=$1", [
    principals[0],
  ]);
  const revoked = await call(
    reviewer,
    "POST",
    `/v1/admin/operations/${removal.data.id}/decision`,
    { decision: "approve", reason: "Original scope was revoked" },
  );
  assert.equal(revoked.status, 403);
  assert.equal((await call(a, "POST", base, b, { key: k })).status, 403);
  assert.equal(
    (await call(a, "GET", `/v1/admin/operations/${created.data.id}`)).status,
    403,
  );
  assert.equal(
    (
      await call(
        reviewer,
        "POST",
        `/v1/admin/operations/${removal.data.id}/decision`,
        { decision: "reject", reason: "Cancel stale membership request" },
      )
    ).data.state,
    "cancelled",
  );
  pass(
    "revoked original scope prevents approval, old operation recovery and operation reads; a reviewer can cancel the stale request",
  );
} catch (e) {
  errors.push((e as Error).message);
} finally {
  for (const c of clients)
    if (c.csrf) {
      try {
        assert.equal(
          (
            await call(
              c,
              c.admin ? "POST" : "DELETE",
              c.admin ? "/v1/admin/auth/logout" : "/v1/auth/session",
              c.admin ? {} : undefined,
            )
          ).status,
          200,
        );
      } catch {
        closed = false;
        errors.push("Owned HTTP session cleanup failed");
      }
    }
  if (db) {
    try {
      if (principals.length) {
        await db.query(
          "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE admin_id=ANY($1::uuid[])",
          [principals],
        );
        await db.query(
          "UPDATE admin_principals SET status='suspended',auth_version=auth_version+1,version=version+1 WHERE id=ANY($1::uuid[])",
          [principals],
        );
      }
    } catch {
      errors.push("Owned synthetic admin cleanup failed");
    } finally {
      await db.end();
    }
  }
  const at = new Date().toISOString();
  await writeFile(
    "evidence/admin-membership-wire.json",
    JSON.stringify(
      {
        at,
        scope:
          "Current source real HTTP with synthetic identities and scoped admin fixtures; no browser or native UI acceptance claim",
        model_calls: 0,
        checks,
        errors,
        owned_sessions_closed: closed,
        owned_admin_principals_disabled:
          principals.length === 2 &&
          !errors.includes("Owned synthetic admin cleanup failed"),
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/admin-membership-contract-samples.json",
    JSON.stringify(
      {
        at,
        origin,
        scope:
          "Actual current-source HTTP canonical operation responses for synthetic accounts",
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
