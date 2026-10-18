import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import * as OTPAuth from "otpauth";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, hash } from "../src/lib.js";
import { reserve, settle, tokenCharge, wallet } from "../src/billing.js";
import { metrics, parseMetricsCSV } from "../src/analytics.js";
import { renderPoster } from "../src/business.js";
let system: Awaited<ReturnType<typeof buildApp>>;
const origin = "http://localhost:4317",
  adminOrigin = "http://localhost:4318";
interface Client {
  cookie: string;
  csrf: string;
  id: string;
  email: string;
  admin?: boolean;
}
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  idempotency = randomUUID(),
) {
  const r = await system.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? adminOrigin : origin,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": idempotency,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
    ...(body !== undefined
      ? {
          headers: {
            origin: c?.admin ? adminOrigin : origin,
            ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
            "idempotency-key": idempotency,
            "content-type": "application/json",
          },
        }
      : {}),
  });
  let data: any;
  try {
    data = r.json();
  } catch {
    data = r.body;
  }
  return { status: r.statusCode, data, raw: r };
}
async function code(address: string, admin = false) {
  const prefix = admin ? "/v1/admin/auth" : "/v1/auth";
  const c = await call(undefined, "POST", prefix + "/challenge", {
    email: address,
  });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const m = JSON.parse(
    await readFile(
      `${system.db.config.DATA_DIR}/mailbox/${c.data.challenge_id}.json`,
      "utf8",
    ),
  );
  return {
    challenge_id: c.data.challenge_id,
    code: m.text.match(/\b\d{6}\b/)[0],
  };
}
async function user() {
  const address = `test-${randomUUID()}@example.invalid`;
  const c = await code(address);
  const v = await call(undefined, "POST", "/v1/auth/verify", c);
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return {
    cookie: v.raw.cookies[0].name + "=" + v.raw.cookies[0].value,
    csrf: v.data.csrf_token,
    id: v.data.user.id,
    email: address,
  } as Client;
}
async function admin(role = "super_admin", scope?: string) {
  const address = `admin-${randomUUID()}@example.invalid`;
  const secret = new OTPAuth.Secret({ size: 20 });
  const p = (
    await system.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
      [address, role, seal(system.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, scope ? "tenant" : "global", scope ?? null],
  );
  const c = await code(address, true);
  const otp = new OTPAuth.TOTP({
    secret,
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  }).generate();
  const v = await call(undefined, "POST", "/v1/admin/auth/verify", {
    ...c,
    totp: otp,
  });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return {
    cookie: v.raw.cookies[0].name + "=" + v.raw.cookies[0].value,
    csrf: v.data.csrf_token,
    id: p.id,
    email: address,
    admin: true,
  } as Client;
}
async function workspace(c: Client) {
  const r = await call(c, "POST", "/v1/tenants", {
    name: "QA workspace",
    project_name: "QA campaign",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function money(a: Client, b: unknown, k = randomUUID()) {
  const p = await call(a, "POST", "/v1/admin/operations/preview", b);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  return call(
    a,
    "POST",
    "/v1/admin/operations/commit",
    { preview_id: p.data.id, payload_hash: p.data.payload_hash },
    k,
  );
}
before(async () => {
  const env = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "CONTROL_DATABASE_URL",
    "QUEUE_DATABASE_URL",
  ]) {
    const u = new URL(env[key]!);
    u.pathname = "/copypaste_test";
    env[key] = u.href;
  }
  env.DATA_DIR = ".data/test";
  const c = loadConfig({ ...env, NODE_ENV: "test", WORKER_ENABLED: "false" });
  system = await buildApp(c, { worker: false });
});
after(async () => {
  await system.app.close();
});

test("email OTP has one atomic consumer and never authenticates the admin audience", async () => {
  const address = `otp-${randomUUID()}@example.invalid`,
    c = await code(address);
  const results = await Promise.all([
    call(undefined, "POST", "/v1/auth/verify", c),
    call(undefined, "POST", "/v1/auth/verify", c),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const chosen = results.find((r) => r.status === 200)!;
  const adminMe = await system.app.inject({
    url: "/v1/admin/me",
    headers: {
      cookie: chosen.raw.cookies[0].name + "=" + chosen.raw.cookies[0].value,
    },
  });
  assert.equal(adminMe.statusCode, 401);
});
test("five invalid OTP attempts exhaust a challenge; expired and consumed codes fail", async () => {
  const c = await code(`brute-${randomUUID()}@example.invalid`);
  const wrong = c.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await call(undefined, "POST", "/v1/auth/verify", { ...c, code: wrong }))
        .status,
      401,
    );
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/verify", c)).status,
    401,
  );
  const expired = await code(`expired-${randomUUID()}@example.invalid`);
  await system.db.control.query(
    "UPDATE auth_challenges SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [expired.challenge_id],
  );
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/verify", expired)).status,
    401,
  );
});
test("CSRF, foreign origin and revoked sessions prevent writes", async () => {
  const u = await user();
  const r = await system.app.inject({
    method: "PATCH",
    url: "/v1/me",
    headers: { cookie: u.cookie, "content-type": "application/json", origin },
    payload: { name: "untrusted" },
  });
  assert.equal(r.statusCode, 403);
  assert.equal(
    (
      await system.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: u.cookie, origin: "https://evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal((await call(u, "POST", "/v1/auth/logout")).status, 200);
  assert.equal((await call(u, "GET", "/v1/me")).status, 401);
});
test("tenant bootstrap is idempotent and project access is isolated at API and PostgreSQL levels", async () => {
  const u = await user(),
    v = await user(),
    k = randomUUID();
  const b = { name: "Idempotent Ltd", project_name: "Launch" };
  const a = await call(u, "POST", "/v1/tenants", b, k),
    duplicate = await call(u, "POST", "/v1/tenants", b, k);
  assert.equal(a.status, 200);
  assert.equal(a.data.tenant.id, duplicate.data.tenant.id);
  assert.equal(
    (await call(u, "POST", "/v1/tenants", { ...b, name: "Changed" }, k)).status,
    409,
  );
  const base = `/v1/tenants/${a.data.tenant.id}/projects/${a.data.project.id}`;
  assert.equal((await call(v, "GET", base + "/assets")).status, 404);
  const unscoped = await system.db.app.query(
    "SELECT id FROM projects WHERE id=$1",
    [a.data.project.id],
  );
  assert.equal(unscoped.rowCount, 0);
  const ident = (
    await system.db.app.query(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  assert.equal(ident.rolsuper, false);
  assert.equal(ident.rolbypassrls, false);
});
test("single-use invitation binds email and project, protects the last owner", async () => {
  const owner = await user(),
    member = await user(),
    other = await user(),
    w = await workspace(owner);
  const path = `/v1/tenants/${w.tenant.id}`;
  const invite = await call(owner, "POST", path + "/invites", {
    email: member.email,
    role: "viewer",
    project_ids: [w.project.id],
  });
  assert.equal(invite.status, 200, JSON.stringify(invite.data));
  const token = new URL(invite.data.invite_url).searchParams.get("token");
  assert.equal(
    (await call(other, "POST", "/v1/invites/accept", { token })).status,
    409,
  );
  assert.equal(
    (await call(member, "POST", "/v1/invites/accept", { token })).status,
    200,
  );
  assert.equal(
    (await call(member, "POST", "/v1/invites/accept", { token })).status,
    409,
  );
  assert.equal(
    (await call(member, "GET", path + `/projects/${w.project.id}/assets`))
      .status,
    200,
  );
  assert.equal(
    (
      await call(member, "POST", path + `/projects/${w.project.id}/creative`, {
        name: "bad",
        body: { width: 1080, height: 1350, background: "#FFFFFF", layers: [] },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(owner, "PATCH", path + "/members/" + owner.id, {
        role: "member",
        status: "active",
        version: 1,
        project_ids: [],
      })
    ).data.error.code,
    "LAST_OWNER",
  );
});
test("PKCE requires exact verifier and callback, refresh rotation detects replay", async () => {
  const u = await user();
  const verifier = randomBytes(32).toString("base64url"),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = "http://127.0.0.1:41234/callback";
  const a = await call(u, "POST", "/v1/auth/native/authorize", {
    client_id: "desktop",
    redirect_uri: redirect,
    code_challenge: challenge,
    state: randomBytes(32).toString("base64url"),
  });
  assert.equal(a.status, 200);
  const code = new URL(a.data.redirect).searchParams.get("code");
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/token", {
        client_id: "desktop",
        redirect_uri: redirect,
        code,
        code_verifier: randomBytes(32).toString("base64url"),
      })
    ).status,
    401,
  );
  const issued = await call(undefined, "POST", "/v1/auth/native/token", {
    client_id: "desktop",
    redirect_uri: redirect,
    code,
    code_verifier: verifier,
  });
  assert.equal(issued.status, 200);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/token", {
        client_id: "desktop",
        redirect_uri: redirect,
        code,
        code_verifier: verifier,
      })
    ).status,
    401,
  );
  const rotated = await call(undefined, "POST", "/v1/auth/native/refresh", {
    client_id: "desktop",
    refresh_token: issued.data.refresh_token,
  });
  assert.equal(rotated.status, 200);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/refresh", {
        client_id: "desktop",
        refresh_token: issued.data.refresh_token,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await system.app.inject({
        url: "/v1/me",
        headers: { authorization: "Bearer " + rotated.data.access_token },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await call(u, "POST", "/v1/auth/native/authorize", {
        client_id: "desktop",
        redirect_uri: "http://evil.example/callback",
        code_challenge: challenge,
        state: randomBytes(32).toString("base64url"),
      })
    ).status,
    400,
  );
});
test("admin authentication requires MFA, separate audience and explicit content permission", async () => {
  const a = await admin("support_agent"),
    u = await user(),
    w = await workspace(u);
  assert.equal((await call(a, "GET", "/v1/admin/users")).status, 200);
  assert.equal((await call(a, "GET", "/v1/me")).status, 401);
  const noMfa = await code(a.email, true);
  assert.equal(
    (await call(undefined, "POST", "/v1/admin/auth/verify", noMfa)).status,
    401,
  );
  const metadata = await system.db.tx(async (tx) => {
    const r = (
      await tx.query(
        "INSERT INTO assets(tenant_id,project_id,name,kind,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [w.tenant.id, w.project.id, "private.txt", "file", u.id],
      )
    ).rows[0];
    const key = await system.storage.put(Buffer.from("private"), "text/plain");
    await tx.query(
      "INSERT INTO asset_versions(tenant_id,asset_id,version,storage_key,mime_type,bytes,sha256) VALUES($1,$2,1,$3,$4,7,$5)",
      [w.tenant.id, r.id, key, "text/plain", hash("private")],
    );
    return r;
  }, w.tenant.id);
  assert.equal(
    (await call(a, "GET", "/v1/admin/content/" + metadata.id + "/body")).status,
    403,
  );
  const content = await admin("content_admin");
  assert.equal(
    (await call(content, "GET", "/v1/admin/content/" + metadata.id + "/body"))
      .data.text,
    "private",
  );
  const q = await call(
    content,
    "POST",
    "/v1/admin/content/" + metadata.id + "/action",
    { action: "quarantine", version: 1, reason: "QA quarantine" },
  );
  assert.equal(q.status, 200);
  assert.equal(
    (
      await call(
        u,
        "GET",
        `/v1/tenants/${w.tenant.id}/projects/${w.project.id}/assets`,
      )
    ).data.items.length,
    0,
  );
});
test("admin funding preview is side-effect-free, commit replays once, concurrent spending preserves holds", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin();
  const base = {
    action: "billing.top_up",
    tenant_id: w.tenant.id,
    amount_micros: 100_000_000,
    reference: "QA-" + randomUUID(),
    reason: "QA confirmed payment",
  };
  const preview = await call(a, "POST", "/v1/admin/operations/preview", base);
  assert.equal(preview.status, 200);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT balance_micros FROM wallets WHERE tenant_id=$1",
        [w.tenant.id],
      )
    ).rows[0].balance_micros,
    "0",
  );
  const k = randomUUID(),
    payload = {
      preview_id: preview.data.id,
      payload_hash: preview.data.payload_hash,
    };
  const first = await call(
      a,
      "POST",
      "/v1/admin/operations/commit",
      payload,
      k,
    ),
    again = await call(a, "POST", "/v1/admin/operations/commit", payload, k);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.id, again.data.id);
  const tasks = await system.db.tx(async (tx) => {
    const out = [];
    for (let i = 0; i < 2; i++)
      out.push(
        (
          await tx.query(
            "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
            [
              w.tenant.id,
              w.project.id,
              u.id,
              "QA reserve",
              "test prompt",
              "fullstack",
              "hash",
              80_000_000,
              randomUUID(),
            ],
          )
        ).rows[0].id,
      );
    return out;
  }, w.tenant.id);
  const holds = await Promise.allSettled(
    tasks.map((id) =>
      system.db.tx(
        (tx) => reserve(tx, w.tenant.id, id, 80_000_000),
        w.tenant.id,
      ),
    ),
  );
  assert.equal(holds.filter((r) => r.status === "fulfilled").length, 1);
  const held = tasks[holds.findIndex((r) => r.status === "fulfilled")];
  await system.db.tx(
    (tx) => settle(tx, w.tenant.id, held, 15_000_000, u.id),
    w.tenant.id,
  );
  await system.db.tx(
    (tx) => settle(tx, w.tenant.id, held, 15_000_000, u.id),
    w.tenant.id,
  );
  const balance = (
    await system.db.control.query("SELECT * FROM wallets WHERE tenant_id=$1", [
      w.tenant.id,
    ])
  ).rows[0];
  assert.equal(balance.balance_micros, "85000000");
  assert.equal(balance.reserved_micros, "0");
  assert.equal(balance.spent_micros, "15000000");
});
test("VIP validity uses real timestamps and financial limits/independent approval are enforced", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin(),
    b = await admin("finance_admin");
  const vip = await money(a, {
    action: "entitlements.grant",
    tenant_id: w.tenant.id,
    plan: "pro",
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: new Date(Date.now() + 86400000).toISOString(),
    reason: "QA VIP grant",
  });
  assert.equal(vip.status, 200, JSON.stringify(vip.data));
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${w.tenant.id}/billing`)).data
      .entitlements.length,
    1,
  );
  await system.db.control.query(
    "UPDATE entitlements SET ends_at=now()-interval '1 second',starts_at=now()-interval '2 days' WHERE id=$1",
    [vip.data.result.id],
  );
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${w.tenant.id}/billing`)).data
      .entitlements.length,
    0,
  );
  const high = await money(a, {
    action: "billing.gift",
    tenant_id: w.tenant.id,
    amount_micros: 10_000_000_000,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    reason: "QA high value grant",
  });
  assert.equal(high.data.state, "pending_approval");
  assert.equal(
    (
      await call(
        a,
        "POST",
        "/v1/admin/operations/" + high.data.id + "/decision",
        { decision: "approve", reason: "QA self approval" },
      )
    ).data.error.code,
    "SELF_APPROVAL_FORBIDDEN",
  );
  const s = await admin("security_admin");
  assert.equal(
    (
      await call(
        s,
        "POST",
        "/v1/admin/operations/" + high.data.id + "/decision",
        { decision: "approve", reason: "QA independent review" },
      )
    ).status,
    200,
  );
  await system.db.control.query(
    "UPDATE admin_bindings SET limits=$2 WHERE principal_id=$1",
    [b.id, { max_amount_micros: 1000000 }],
  );
  const denied = await call(b, "POST", "/v1/admin/operations/preview", {
    action: "billing.gift",
    tenant_id: w.tenant.id,
    amount_micros: 2000000,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    reason: "QA exceeded scope",
  });
  assert.equal(denied.status, 403);
});
test("undefined ratios are null and totals divide after aggregation; CSV protects currency and exact amounts", () => {
  const csv =
    "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Launch,100,10,0.10,2,1.00,HKD\n2026-10-02,Google,Launch,1000,20,0.20,1,2.00,HKD";
  const d = parseMetricsCSV(csv);
  const m = metrics(d.rows);
  assert.equal(m.ctr, 30 / 1100);
  assert.equal(m.spend_micros, 300000);
  assert.equal(m.roas, 10);
  assert.equal(metrics([]).ctr, null);
  assert.equal(metrics([]).roas, null);
  assert.equal(tokenCharge(1, 1, 1000000, 1000000), 2);
  assert.throws(() => parseMetricsCSV(csv.replace(/,HKD$/, " ,USD")));
});
test("editable poster escapes script injection and preserves exact Traditional Chinese copy", () => {
  const svg = renderPoster({
    width: 1080,
    height: 1350,
    background: "#FFFFFF",
    layers: [
      {
        type: "text",
        text: "優惠 HK$128 <script>alert(1)</script>",
        x: 40,
        y: 100,
        font_size: 30,
        color: "#15171A",
      },
    ],
  });
  assert.ok(svg.includes("優惠 HK$128"));
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
});
test("task request cannot override kernel/provider and unavailable AI cannot fake success", async () => {
  const u = await user(),
    w = await workspace(u),
    url = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}/tasks`;
  const b = {
    title: "Build site",
    prompt: "Build a complete business website",
    role_key: "fullstack",
    budget_micros: 1000000,
  };
  assert.equal(
    (await call(u, "POST", url, { ...b, kernel: "untrusted" })).status,
    400,
  );
  const r = await call(u, "POST", url, b);
  assert.equal(r.status, 503);
  assert.equal(r.data.error.code, "AI_SETUP_REQUIRED");
});

test("native logout revokes the refresh family and a browser cookie cannot become a bearer token", async () => {
  const u = await user();
  const cookie = u.cookie.split("=")[1];
  const invalid = await system.app.inject({
    url: "/v1/me",
    headers: { authorization: `Bearer ${cookie}` },
  });
  assert.equal(invalid.statusCode, 401);
  const verifier = randomBytes(32).toString("base64url"),
    redirect = "http://127.0.0.1:46661/callback";
  const a = await call(u, "POST", "/v1/auth/native/authorize", {
    client_id: "desktop",
    redirect_uri: redirect,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  });
  const code = new URL(a.data.redirect).searchParams.get("code");
  const issued = await call(undefined, "POST", "/v1/auth/native/token", {
    client_id: "desktop",
    redirect_uri: redirect,
    code,
    code_verifier: verifier,
  });
  assert.equal(issued.status, 200);
  const out = await system.app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: { authorization: `Bearer ${issued.data.access_token}` },
  });
  assert.equal(out.statusCode, 200);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/refresh", {
        client_id: "desktop",
        refresh_token: issued.data.refresh_token,
      })
    ).status,
    401,
  );
});
test("confirmed payment references cannot credit a second workspace, including with a new idempotency key", async () => {
  const u = await user(),
    w = await workspace(u),
    w2 = await workspace(u),
    a = await admin();
  const reference = "QA-PAY-" + randomUUID();
  assert.equal(
    (
      await money(a, {
        action: "billing.top_up",
        tenant_id: w.tenant.id,
        amount_micros: 2_000_000,
        reference,
        reason: "Confirmed payment test",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await money(a, {
        action: "billing.top_up",
        tenant_id: w2.tenant.id,
        amount_micros: 2_000_000,
        reference,
        reason: "Duplicate payment test",
      })
    ).status,
    409,
  );
  const balance = (
    await system.db.control.query(
      "SELECT balance_micros FROM wallets WHERE tenant_id=$1",
      [w2.tenant.id],
    )
  ).rows[0];
  assert.equal(Number(balance.balance_micros), 0);
});
test("admin workspace lists redact money without billing permission and user usage honors its own scope", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin("user_operator");
  const r = await call(a, "GET", "/v1/admin/tenants");
  assert.equal(r.status, 200);
  const row = r.data.items.find((x: any) => x.id === w.tenant.id);
  assert.ok(row);
  assert.equal(row.balance_micros, undefined);
  assert.equal(row.credit_limit_micros, undefined);
  const deny = "no_usage_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [deny, JSON.stringify(["admin.usage.read"])],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,effect) VALUES($1,$2,'global','deny')",
    [a.id, deny],
  );
  const users = await call(
    a,
    "GET",
    "/v1/admin/users?search=" + encodeURIComponent(u.email),
  );
  assert.equal(users.status, 200);
  assert.equal(users.data.items[0].charged_micros, undefined);
});
test("quarantining a dataset removes it at the API and restricted PostgreSQL layer; restore requires its new version", async () => {
  const u = await user(),
    w = await workspace(u),
    a = await admin("content_admin");
  const base = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`;
  const d = await call(u, "POST", base + "/analytics/import", {
    name: "Private campaign",
    csv: "date,channel,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,100,8,10.00,2,30.00,HKD",
  });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/content/${d.data.id}/action`, {
        action: "quarantine",
        version: 1,
        reason: "Investigating incorrect source",
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(u, "GET", base + "/analytics/" + d.data.id)).status,
    404,
  );
  assert.equal(
    (
      await system.db.tx(
        (tx) =>
          tx.query("SELECT id FROM analytics_datasets WHERE id=$1", [
            d.data.id,
          ]),
        w.tenant.id,
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/content/${d.data.id}/action`, {
        action: "restore",
        version: 1,
        reason: "Stale restore request",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/content/${d.data.id}/action`, {
        action: "restore",
        version: 2,
        reason: "Source verified correct",
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(u, "GET", base + "/analytics/" + d.data.id)).status,
    200,
  );
});
test("exports recheck source authorization at download and batch status changes revoke all sessions", async () => {
  const u = await user(),
    a = await admin();
  const e = await call(a, "POST", "/v1/admin/exports", { source: "users" });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  const csv = await call(a, "GET", `/v1/admin/exports/${e.data.id}/download`);
  assert.equal(csv.status, 200);
  assert.ok(csv.raw.headers["content-type"]?.includes("text/csv"));
  const binding = (
    await system.db.control.query(
      "SELECT id FROM admin_bindings WHERE principal_id=$1",
      [a.id],
    )
  ).rows[0];
  await system.db.control.query("DELETE FROM admin_bindings WHERE id=$1", [
    binding.id,
  ]);
  assert.equal(
    (await call(a, "GET", `/v1/admin/exports/${e.data.id}/download`)).status,
    403,
  );
  const b = await admin();
  const batch = await call(b, "POST", "/v1/admin/jobs/preview", {
    action: "users.status",
    ids: [u.id],
    status: "suspended",
    reason: "QA suspension batch",
  });
  assert.equal(batch.status, 200, JSON.stringify(batch.data));
  assert.equal((await call(u, "GET", "/v1/me")).status, 200);
  const changed = await call(b, "POST", "/v1/admin/jobs", {
    preview_id: batch.data.id,
    payload_hash: batch.data.payload_hash,
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.state, "succeeded");
  assert.equal((await call(u, "GET", "/v1/me")).status, 401);
});

test("personal VIP freezes its policy, enforces concurrent quotas, expires without crediting the wallet", async () => {
  const { authorizeTaskPlan } = await import("../src/plans.js");
  const u = await user(),
    w = await workspace(u),
    a = await admin();
  const grant = {
    action: "entitlements.grant",
    user_id: u.id,
    plan: "pro",
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: new Date(Date.now() + 86400000).toISOString(),
    reason: "QA personal entitlement",
  };
  const g = await money(a, grant);
  assert.equal(g.status, 200, JSON.stringify(g.data));
  const duplicate = await money(a, grant);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error.code, "ENTITLEMENT_OVERLAP");
  const effective = await call(u, "GET", `/v1/tenants/${w.tenant.id}/plan`);
  assert.equal(effective.status, 200, JSON.stringify(effective.data));
  assert.equal(effective.data.plan, "pro");
  assert.equal(effective.data.subject, "user");
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${w.tenant.id}/billing`)).data.wallet
      .balance_micros,
    "0",
  );
  const role = system.catalog.role("fullstack");
  const add = () =>
    system.db.tx(async (tx) => {
      const plan = await authorizeTaskPlan(
        tx,
        w.tenant.id,
        u.id,
        role,
        1_000_000,
      );
      await tx.query(
        "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,actor_auth_version,plan_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)",
        [
          w.tenant.id,
          w.project.id,
          u.id,
          "Quota fixture",
          "Build a tool",
          "fullstack",
          "qa",
          1_000_000,
          randomUUID(),
          plan,
        ],
      );
    }, w.tenant.id);
  const attempts = await Promise.allSettled([
    add(),
    add(),
    add(),
    add(),
    add(),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 3);
  for (const r of attempts.filter((r) => r.status === "rejected"))
    assert.equal((r as PromiseRejectedResult).reason.code, "PLAN_TASK_LIMIT");
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM entitlement_events WHERE entitlement_id=$1",
        [g.data.result.id],
      )
    ).rows[0].n,
    1,
  );
  await system.db.control.query(
    "UPDATE entitlements SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE id=$1",
    [g.data.result.id],
  );
  assert.equal(
    (await call(u, "GET", `/v1/tenants/${w.tenant.id}/plan`)).data.plan,
    "starter",
  );
});

test("scoped usage never inherits broader user visibility and explicit project deny constrains aggregates", async () => {
  const u = await user(),
    one = await workspace(u),
    two = await workspace(u),
    a = await admin();
  const role = "qa_usage_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(["admin.usage.read", "admin.overview.read"])],
  );
  await system.db.control.query(
    "DELETE FROM admin_bindings WHERE principal_id=$1",
    [a.id],
  );
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role + "_users", JSON.stringify(["admin.users.read"])],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'global',NULL)",
    [a.id, role + "_users"],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)",
    [a.id, role, one.tenant.id],
  );
  for (const w of [one, two])
    await system.db.control.query(
      "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key,actor_auth_version,status,charged_micros) VALUES($1,$2,$3,'Scope fixture','Report','fullstack','qa',1000000,$4,1,'succeeded',100)",
      [w.tenant.id, w.project.id, u.id, randomUUID()],
    );
  const detail = await call(a, "GET", "/v1/admin/users/" + u.id);
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.deepEqual(
    detail.data.usage.map((r: any) => r.tenant_id),
    [one.tenant.id],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",
    [a.id, role, one.project.id],
  );
  const usage = await call(a, "GET", "/v1/admin/usage");
  assert.equal(usage.status, 200, JSON.stringify(usage.data));
  assert.equal(usage.data.total, 0);
  const summary = await call(a, "GET", "/v1/admin/overview");
  assert.equal(summary.status, 200, JSON.stringify(summary.data));
  assert.equal(summary.data.summary.tasks, 0);
});

test("admin publishes client content and role presentation without accepting executable overrides; metadata mutations reject stale versions", async () => {
  const a = await admin(),
    u = await user(),
    w = await workspace(u);
  const draft = await call(a, "POST", "/v1/admin/catalog", {
    kind: "announcement",
    key: "qa-" + randomUUID(),
    body: {
      title: "QA release",
      text: "Ready for review",
      title_en: "QA release",
      text_en: "Ready for review",
    },
  });
  assert.equal(draft.status, 200);
  assert.equal(
    (await call(a, "POST", `/v1/admin/catalog/${draft.data.id}/publish`))
      .status,
    200,
  );
  assert.ok(
    (await call(undefined, "GET", "/v1/public/content")).data.items.some(
      (r: any) => r.id === draft.data.id,
    ),
  );
  const evil = await call(a, "POST", "/v1/admin/catalog", {
    kind: "role",
    key: "fullstack",
    body: { enabled: true, engine: "other-runtime" },
  });
  assert.equal(
    (await call(a, "POST", `/v1/admin/catalog/${evil.data.id}/publish`)).status,
    400,
  );
  const asset = await system.db.tx(async (tx) => {
    const { saveAsset } = await import("../src/storage.js");
    return saveAsset(tx, system.storage, {
      tenant: w.tenant.id,
      project: w.project.id,
      user: u.id,
      name: "draft.txt",
      mime: "text/plain",
      bytes: Buffer.from("Draft"),
    });
  }, w.tenant.id);
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/content/${asset.id}/action`, {
        action: "metadata",
        version: 1,
        name: "renamed.txt",
        reason: "QA rename",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(a, "POST", `/v1/admin/content/${asset.id}/action`, {
        action: "metadata",
        version: 1,
        name: "stale.txt",
        reason: "QA stale rename",
      })
    ).status,
    409,
  );
  const list = await call(a, "GET", "/v1/admin/content?page_size=1");
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.items.length, 1);
  assert.ok(list.data.total > 1);
});

test("native design compositions pin authorized image versions and reject foreign project assets", async () => {
  const u = await user(),
    w = await workspace(u),
    other = await workspace(u);
  const { pngFromSVG } = await import("../src/render.js");
  const { saveAsset } = await import("../src/storage.js");
  const image = await system.db.tx(
    (tx) =>
      saveAsset(tx, system.storage, {
        tenant: w.tenant.id,
        project: w.project.id,
        user: u.id,
        name: "approved.png",
        mime: "image/png",
        bytes: Buffer.from(
          pngFromSVG(
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1F5EFF"/></svg>',
          ),
        ),
      }),
    w.tenant.id,
  );
  const body = {
    width: 512,
    height: 512,
    background: "#FFFFFF",
    layers: [
      {
        type: "image",
        asset_id: image.id,
        version: 1,
        x: 20,
        y: 20,
        width: 472,
        height: 472,
      },
    ],
  };
  const base = `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`;
  const creative = await call(u, "POST", base + "/creative", {
    name: "Composed image",
    body,
  });
  assert.equal(creative.status, 200);
  const rendered = await call(
    u,
    "POST",
    base + "/creative/" + creative.data.id + "/render",
    { format: "png" },
  );
  assert.equal(rendered.status, 200, JSON.stringify(rendered.data));
  const thumbnail = await call(
    u,
    "GET",
    base + "/assets/" + image.id + "/thumbnail",
  );
  assert.equal(thumbnail.status, 200);
  assert.ok(thumbnail.data.base64.length < 100000);
  const foreignBase = `/v1/tenants/${other.tenant.id}/projects/${other.project.id}`;
  const foreign = await call(u, "POST", foreignBase + "/creative", {
    name: "Wrong project",
    body,
  });
  assert.equal(foreign.status, 200);
  const refused = await call(
    u,
    "POST",
    foreignBase + "/creative/" + foreign.data.id + "/render",
    { format: "svg" },
  );
  assert.equal(refused.status, 400);
  assert.equal(refused.data.error.code, "IMAGE_SOURCE_INVALID");
});

test("admin delegation cannot widen financial limits or outlive the source grant", async () => {
  await admin();
  const suffix = randomUUID().replaceAll("-", ""),
    delegator = "delegate_" + suffix,
    child = "gift_" + suffix;
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2),($3,$3,$4)",
    [
      delegator,
      JSON.stringify(["admin.access.bindings.write", "admin.billing.gift"]),
      child,
      JSON.stringify(["admin.billing.gift"]),
    ],
  );
  const a = await admin(delegator),
    recipient = await admin("user_operator");
  const expires = new Date(Date.now() + 3600000).toISOString();
  await system.db.control.query(
    "UPDATE admin_bindings SET limits=$2,expires_at=$3 WHERE principal_id=$1",
    [a.id, { max_amount_micros: 1000000, max_batch: 5 }, expires],
  );
  const payload = {
    principal_id: recipient.id,
    role_key: child,
    scope_kind: "global",
    reason: "Delegate bounded pilot support",
  };
  for (const patch of [
    {},
    {
      limits: { max_amount_micros: 1000001, max_batch: 5 },
      expires_at: expires,
    },
    {
      limits: { max_amount_micros: 500000, max_batch: 5 },
      expires_at: new Date(Date.now() + 7200000).toISOString(),
    },
  ]) {
    const denied = await call(a, "POST", "/v1/admin/access/bindings", {
      ...payload,
      ...patch,
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.data));
    assert.equal(denied.data.error.code, "DELEGATION_LIMIT");
  }
  const good = await call(a, "POST", "/v1/admin/access/bindings", {
    ...payload,
    limits: { max_amount_micros: 500000, max_batch: 3 },
    expires_at: new Date(Date.now() + 1800000).toISOString(),
  });
  assert.equal(good.status, 200, JSON.stringify(good.data));
  const own = await call(a, "POST", "/v1/admin/access/bindings", {
    ...payload,
    principal_id: a.id,
    limits: { max_amount_micros: 500000, max_batch: 3 },
    expires_at: new Date(Date.now() + 1800000).toISOString(),
  });
  assert.equal(own.status, 403);
  assert.equal(own.data.error.code, "SELF_BINDING_FORBIDDEN");
});

test("the last permanent recovery administrator cannot be revoked or disabled by a deny binding", async () => {
  const a = await admin(),
    b = await admin();
  const prior = (
    await system.db.control.query(
      "SELECT id,expires_at FROM admin_bindings WHERE role_key='super_admin' AND effect='allow' AND scope_kind='global' AND principal_id<>$1",
      [b.id],
    )
  ).rows;
  try {
    await system.db.control.query(
      "UPDATE admin_bindings SET expires_at=now()+interval '1 hour' WHERE role_key='super_admin' AND effect='allow' AND scope_kind='global' AND principal_id<>$1",
      [b.id],
    );
    const binding = (
      await system.db.control.query(
        "SELECT id FROM admin_bindings WHERE principal_id=$1 AND role_key='super_admin'",
        [b.id],
      )
    ).rows[0];
    const revoked = await call(
      a,
      "DELETE",
      "/v1/admin/access/bindings/" + binding.id,
    );
    assert.equal(revoked.status, 409, JSON.stringify(revoked.data));
    assert.equal(revoked.data.error.code, "LAST_SUPER_ADMIN");
    const denied = await call(a, "POST", "/v1/admin/access/bindings", {
      principal_id: b.id,
      role_key: "super_admin",
      scope_kind: "global",
      effect: "deny",
      reason: "Test recovery protection",
    });
    assert.equal(denied.status, 409, JSON.stringify(denied.data));
    assert.equal(denied.data.error.code, "LAST_SUPER_ADMIN");
    assert.equal(
      (
        await system.db.control.query(
          "SELECT count(*)::int AS n FROM admin_bindings WHERE principal_id=$1 AND effect='deny'",
          [b.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    for (const row of prior)
      await system.db.control.query(
        "UPDATE admin_bindings SET expires_at=$2 WHERE id=$1",
        [row.id, row.expires_at],
      );
  }
});
