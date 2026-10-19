import { isolatedTestEnvironment } from "./native-test-environment.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, unseal } from "../src/lib.js";
import { totp } from "../src/auth.js";
import * as OTPAuth from "otpauth";

let system: Awaited<ReturnType<typeof buildApp>>;
type Client = {
  id: string;
  email: string;
  cookie: string;
  csrf: string;
  secret?: string;
};
const base = "/v1/admin/access/principals",
  why = "Identity lifecycle integration test";
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  payload?: unknown,
  idempotency: string = randomUUID(),
) {
  const raw = await system.app.inject({
    method: method as any,
    url,
    headers: {
      origin: "http://localhost:4318",
      "idempotency-key": idempotency,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  key?: string,
) {
  const r = await call(c, method, url, body, key);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r;
}
const client = (r: Awaited<ReturnType<typeof call>>): Client => ({
  id: r.data.user.id,
  email: r.data.user.email,
  cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
  csrf: r.data.csrf_token,
});
async function code(email: string) {
  const r = await ok(undefined, "POST", "/v1/admin/auth/challenge", { email });
  const mail = JSON.parse(
    await readFile(
      `${system.db.config.DATA_DIR}/mailbox/${r.data.challenge_id}.json`,
      "utf8",
    ),
  );
  return {
    challenge_id: r.data.challenge_id,
    code: mail.text.match(/code is (\d{6})/)[1],
  };
}
async function operator(permissions?: string[], limits = {}, expiry?: string) {
  const email = `identity-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 }).base32;
  const p = (
    await system.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Identity test operator',$2) RETURNING id",
      [email, seal(system.db.config.MASTER_KEY!, secret)],
    )
  ).rows[0];
  let role = "super_admin";
  if (permissions) {
    role = "identity_" + randomUUID().replaceAll("-", "");
    await system.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Restricted test operator',$2)",
      [role, JSON.stringify(permissions)],
    );
  }
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,limits,expires_at) VALUES($1,$2,'global',$3,$4)",
    [p.id, role, limits, expiry ?? null],
  );
  const c = await code(email),
    r = await ok(undefined, "POST", "/v1/admin/auth/verify", {
      ...c,
      totp: totp(secret).generate(),
    });
  return { ...client(r), secret };
}
async function invite(a: Client, binding?: unknown) {
  const email = `invited-${randomUUID()}@example.invalid`;
  const body = {
      email,
      name: "Invited operator",
      reason: why,
      ...(binding ? { binding } : {}),
    },
    key = randomUUID();
  const r = await ok(a, "POST", base, body, key);
  const mail = JSON.parse(
    await readFile(
      `${system.db.config.DATA_DIR}/mailbox/${r.data.invitation_id}.json`,
      "utf8",
    ),
  );
  const url = mail.text.match(/http[^\s]+/)[0];
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
  return { ...r.data, email, token, body, key };
}
async function begin(i: { email: string; token: string }) {
  return (
    await ok(undefined, "POST", "/v1/admin/auth/enrollment/setup", {
      token: i.token,
      ...(await code(i.email)),
    })
  ).data;
}
async function complete(s: { setup_token: string; setup_key: string }) {
  return ok(undefined, "POST", "/v1/admin/auth/enrollment/complete", {
    setup_token: s.setup_token,
    totp: totp(s.setup_key).generate(),
  });
}
const detail = async (a: Client, id: string) =>
  (await ok(a, "GET", base + "/" + id)).data;
async function restrictUsage(target: Client, kind = "global", scope?: string) {
  const role = "deny_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Usage restriction',$2)",
    [role, JSON.stringify(["admin.usage.read"])],
  );
  return (
    await system.db.control.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,$3,$4,'deny') RETURNING *",
      [target.id, role, kind, scope ?? null],
    )
  ).rows[0];
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  const env = {
    ...isolated.env,
    NODE_ENV: "test",
    WORKER_ENABLED: "false",
  };
  system = await buildApp(loadConfig(env), { worker: false });
});
after(async () => {
  try {
    await system?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

test("admin invitation atomically assigns a delegable role, is idempotent and never returns an MFA secret or capability", async () => {
  const a = await operator(),
    i = await invite(a, { role_key: "super_admin", scope_kind: "global" });
  assert.equal(i.delivery, "sent");
  assert.equal(i.principal.enrollment_state, "pending");
  const again = await ok(a, "POST", base, i.body, i.key);
  assert.equal(again.data.principal.id, i.principal.id);
  const d = await detail(a, i.principal.id);
  assert.equal(d.bindings.length, 1);
  assert.equal(d.bindings[0].role_key, "super_admin");
  const text = JSON.stringify([
    again.data,
    d,
    (await ok(a, "GET", base + "?search=" + encodeURIComponent(i.email))).data,
  ]);
  for (const value of [
    "totp_secret",
    "setup_secret",
    "token_hash",
    "token_ciphertext",
    "setup_hash",
    "setup_key",
    i.token,
  ])
    assert.equal(text.includes(value), false, value);
  const pending = await system.db.control.query(
    "SELECT totp_secret,enrollment_state FROM admin_principals WHERE id=$1",
    [i.principal.id],
  );
  assert.equal(pending.rows[0].totp_secret, null);
  const c = await code(i.email);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/verify", {
        ...c,
        totp: "000000",
      })
    ).status,
    401,
  );
  assert.equal(
    (await call(a, "POST", base, { email: a.email, name: "Self", reason: why }))
      .status,
    403,
  );
});

test("principal enrollment requires the recipient's fresh email proof; OTP failures persist and there is one setup consumer", async () => {
  const a = await operator(),
    i = await invite(a),
    c = await code(i.email);
  const wrong = c.code === "000000" ? "000001" : "000000";
  for (let n = 0; n < 5; n++)
    assert.equal(
      (
        await call(undefined, "POST", "/v1/admin/auth/enrollment/setup", {
          token: i.token,
          ...c,
          code: wrong,
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/enrollment/setup", {
        token: i.token,
        ...c,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT attempts FROM auth_challenges WHERE id=$1",
        [c.challenge_id],
      )
    ).rows[0].attempts,
    5,
  );
  const other = await code(a.email);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/enrollment/setup", {
        token: i.token,
        ...other,
      })
    ).status,
    401,
  );
  const fresh = await code(i.email);
  const results = await Promise.all(
    [1, 2].map(() =>
      call(undefined, "POST", "/v1/admin/auth/enrollment/setup", {
        token: i.token,
        ...fresh,
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const s = results.find((r) => r.status === 200)!.data;
  assert.ok(s.setup_key);
  assert.ok(s.otpauth_uri.startsWith("otpauth://totp/"));
  const stored = (
    await system.db.control.query(
      "SELECT * FROM admin_enrollments WHERE id=$1",
      [i.invitation_id],
    )
  ).rows[0];
  assert.notEqual(stored.setup_secret, s.setup_key);
  assert.equal(
    unseal(system.db.config.MASTER_KEY!, stored.setup_secret),
    s.setup_key,
  );
  assert.equal(stored.token_ciphertext, null);
});

test("real TOTP enrollment is single use, scrubs setup material and issues an admin-only session with replay protection", async () => {
  const a = await operator(),
    i = await invite(a),
    s = await begin(i);
  const results = await Promise.all(
    [1, 2].map(() =>
      call(undefined, "POST", "/v1/admin/auth/enrollment/complete", {
        setup_token: s.setup_token,
        totp: totp(s.setup_key).generate(),
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const r = results.find((r) => r.status === 200)!,
    c = client(r);
  assert.ok(r.raw.cookies[0].httpOnly);
  assert.equal(r.raw.cookies[0].path, "/v1/admin");
  assert.equal((await ok(c, "GET", "/v1/admin/me")).data.permissions.length, 0);
  assert.equal((await call(c, "GET", "/v1/me")).status, 401);
  assert.equal((await call(c, "GET", base)).status, 403);
  const e = (
    await system.db.control.query(
      "SELECT * FROM admin_enrollments WHERE id=$1",
      [i.invitation_id],
    )
  ).rows[0];
  assert.ok(e.consumed_at);
  assert.equal(e.setup_secret, null);
  assert.equal(e.token_ciphertext, null);
  const second = await code(i.email);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/verify", {
        ...second,
        totp: totp(s.setup_key).generate(),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/enrollment/inspect", {
        token: i.token,
      })
    ).status,
    401,
  );
});

test("MFA confirmation limits survive errors; expired or replaced setups cannot enroll", async () => {
  const a = await operator(),
    i = await invite(a),
    s = await begin(i);
  let wrong = "000000";
  while (totp(s.setup_key).validate({ token: wrong, window: 1 }) !== null)
    wrong = String(Number(wrong) + 1).padStart(6, "0");
  for (let n = 0; n < 5; n++)
    assert.equal(
      (
        await call(undefined, "POST", "/v1/admin/auth/enrollment/complete", {
          setup_token: s.setup_token,
          totp: wrong,
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/enrollment/complete", {
        setup_token: s.setup_token,
        totp: totp(s.setup_key).generate(),
      })
    ).status,
    401,
  );
  const e = (
    await system.db.control.query(
      "SELECT setup_attempts FROM admin_enrollments WHERE id=$1",
      [i.invitation_id],
    )
  ).rows[0];
  assert.equal(e.setup_attempts, 5);
  const j = await invite(a),
    expired = await begin(j);
  await system.db.control.query(
    "UPDATE admin_enrollments SET setup_expires_at=now()-interval '1 second' WHERE id=$1",
    [j.invitation_id],
  );
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/enrollment/complete", {
        setup_token: expired.setup_token,
        totp: totp(expired.setup_key).generate(),
      })
    ).status,
    401,
  );
});

test("changing delegated roles revokes sessions and restarts pending MFA setup while retaining the invitation for its recipient", async () => {
  const a = await operator(),
    i = await invite(a),
    s = await begin(i);
  const binding = (
    await ok(a, "POST", "/v1/admin/access/bindings", {
      principal_id: i.principal.id,
      role_key: "super_admin",
      scope_kind: "global",
      reason: why,
    })
  ).data;
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/enrollment/complete", {
        setup_token: s.setup_token,
        totp: totp(s.setup_key).generate(),
      })
    ).status,
    401,
  );
  await ok(undefined, "POST", "/v1/admin/auth/enrollment/inspect", {
    token: i.token,
  });
  const current = await begin(i),
    enrolled = client(await complete(current));
  await ok(enrolled, "GET", base);
  await ok(a, "DELETE", "/v1/admin/access/bindings/" + binding.id);
  assert.equal((await call(enrolled, "GET", "/v1/admin/me")).status, 401);
});

test("suspension and resumption use CAS, revoke all old sessions and never restore old invitations", async () => {
  const a = await operator(),
    i = await invite(a),
    target = client(await complete(await begin(i)));
  const p = (await detail(a, target.id)).principal;
  const body = { expected_version: p.version, state: "suspended", reason: why },
    k = randomUUID();
  await ok(a, "POST", base + "/" + target.id + "/status", body, k);
  await ok(a, "POST", base + "/" + target.id + "/status", body, k);
  assert.equal((await call(target, "GET", "/v1/admin/me")).status, 401);
  const stale = await call(a, "PATCH", base + "/" + target.id, {
    expected_version: p.version,
    name: "Stale overwrite",
    reason: why,
  });
  assert.equal(stale.data.error.code, "VERSION_CONFLICT");
  const current = (await detail(a, target.id)).principal;
  await ok(a, "POST", base + "/" + target.id + "/status", {
    expected_version: current.version,
    state: "active",
    reason: why,
  });
  assert.equal((await call(target, "GET", "/v1/admin/me")).status, 401);
  const pending = await invite(a),
    pp = (await detail(a, pending.principal.id)).principal;
  const suspended = (
    await ok(a, "POST", base + "/" + pp.id + "/status", {
      expected_version: pp.version,
      state: "suspended",
      reason: why,
    })
  ).data;
  await ok(a, "POST", base + "/" + pp.id + "/status", {
    expected_version: suspended.version,
    state: "active",
    reason: why,
  });
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/enrollment/inspect", {
        token: pending.token,
      })
    ).status,
    401,
  );
});

test("mail failure is explicit and retrying an invite neither duplicates a principal nor exposes its emailed capability", async () => {
  const a = await operator(),
    config = system.db.config,
    original = { DEV_MAILBOX: config.DEV_MAILBOX, SMTP_URL: config.SMTP_URL };
  const body = {
      email: `failed-${randomUUID()}@example.invalid`,
      name: "Undelivered invitation",
      reason: why,
    },
    k = randomUUID();
  let failed: any;
  try {
    config.DEV_MAILBOX = false;
    config.SMTP_URL = undefined;
    failed = (await ok(a, "POST", base, body, k)).data;
    assert.equal(failed.delivery, "failed");
  } finally {
    Object.assign(config, original);
  }
  const p = (await detail(a, failed.principal.id)).principal;
  assert.equal(p.invitation.delivery_state, "failed");
  const sent = (await ok(a, "POST", base, body, k)).data;
  assert.equal(sent.delivery, "sent");
  assert.equal(sent.principal.id, failed.principal.id);
  const mail = JSON.parse(
    await readFile(
      `${config.DATA_DIR}/mailbox/${sent.invitation_id}.json`,
      "utf8",
    ),
  );
  assert.equal(mail.to, body.email);
  const current = (await detail(a, failed.principal.id)).principal;
  const resent = (
    await ok(a, "POST", base + "/" + current.id + "/enrollment", {
      expected_version: current.version,
      reason: why,
    })
  ).data;
  assert.notEqual(resent.invitation_id, sent.invitation_id);
  const oldToken = new URL(mail.text.match(/http[^\s]+/)[0]).hash.slice(7);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/enrollment/inspect", {
        token: oldToken,
      })
    ).status,
    401,
  );
});

test("self MFA replacement needs current-session and email proof, preserves the old key until confirmation, then revokes it", async () => {
  const a = await operator(),
    proof = await code(a.email);
  const s = (await ok(a, "POST", "/v1/admin/auth/mfa/setup", proof)).data;
  const old = (
    await system.db.control.query(
      "SELECT totp_secret FROM admin_principals WHERE id=$1",
      [a.id],
    )
  ).rows[0];
  assert.equal(unseal(system.db.config.MASTER_KEY!, old.totp_secret), a.secret);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/admin/auth/enrollment/complete", {
        setup_token: s.setup_token,
        totp: totp(s.setup_key).generate(),
      })
    ).status,
    401,
  );
  const r = await ok(a, "POST", "/v1/admin/auth/mfa/complete", {
    setup_token: s.setup_token,
    totp: totp(s.setup_key).generate(),
  });
  assert.equal((await call(a, "GET", "/v1/admin/me")).status, 401);
  await ok(client(r), "GET", "/v1/admin/me");
  const updated = (
    await system.db.control.query(
      "SELECT totp_secret FROM admin_principals WHERE id=$1",
      [a.id],
    )
  ).rows[0];
  assert.equal(
    unseal(system.db.config.MASTER_KEY!, updated.totp_secret),
    s.setup_key,
  );
  const b = await operator(),
    d = (await detail(b, b.id)).principal;
  assert.equal(
    (
      await call(b, "POST", base + "/" + b.id + "/reset-mfa", {
        expected_version: d.version,
        reason: why,
      })
    ).status,
    403,
  );
});

test("read-only, expired-MFA and bounded operators cannot invite or delegate broader grants; rejected invites roll back", async () => {
  const a = await operator(["admin.access.read"]),
    body = {
      email: `forbidden-${randomUUID()}@example.invalid`,
      name: "Forbidden invite",
      reason: why,
    };
  assert.equal((await call(a, "POST", base, body)).status, 403);
  const b = await operator();
  await system.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [b.id],
  );
  assert.equal(
    (await call(b, "POST", base, body)).data.error.code,
    "MFA_REQUIRED",
  );
  const expires = new Date(Date.now() + 3600000).toISOString();
  const limited = await operator(
    [
      "admin.access.read",
      "admin.access.principals.write",
      "admin.access.bindings.write",
    ],
    { max_batch: 2 },
    expires,
  );
  const role = "delegate_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Delegable',$2)",
    [role, JSON.stringify(["admin.access.read"])],
  );
  const bad = await call(limited, "POST", base, {
    ...body,
    binding: { role_key: role, scope_kind: "global" },
  });
  assert.equal(bad.data.error.code, "DELEGATION_LIMIT");
  assert.equal(
    (
      await system.db.control.query(
        "SELECT 1 FROM admin_principals WHERE email=$1",
        [body.email],
      )
    ).rowCount,
    0,
  );
  const good = await invite(limited, {
    role_key: role,
    scope_kind: "global",
    limits: { max_batch: 1 },
    expires_at: expires,
  });
  assert.equal(good.delivery, "sent");
});

test("another authorized administrator can reset MFA and revoke sessions with version checks without receiving the new secret", async () => {
  const a = await operator(),
    i = await invite(a),
    s = await begin(i),
    target = client(await complete(s));
  const p = (await detail(a, target.id)).principal;
  const reset = (
    await ok(a, "POST", base + "/" + target.id + "/reset-mfa", {
      expected_version: p.version,
      reason: why,
    })
  ).data;
  assert.equal(reset.principal.enrollment_state, "pending");
  assert.equal((await call(target, "GET", "/v1/admin/me")).status, 401);
  assert.equal(
    (
      await call(a, "POST", base + "/" + target.id + "/session-revocations", {
        expected_version: p.version,
        reason: why,
      })
    ).data.error.code,
    "VERSION_CONFLICT",
  );
  const mail = JSON.parse(
    await readFile(
      `${system.db.config.DATA_DIR}/mailbox/${reset.invitation_id}.json`,
      "utf8",
    ),
  );
  const token = new URLSearchParams(
    new URL(mail.text.match(/http[^\s]+/)[0]).hash.slice(1),
  ).get("token")!;
  const newSetup = await begin({ email: i.email, token });
  const newClient = client(await complete(newSetup));
  await ok(newClient, "GET", "/v1/admin/me");
  const d = await detail(a, target.id);
  assert.equal(d.sessions.filter((row: any) => row.active).length, 1);
  await ok(a, "POST", base + "/" + target.id + "/session-revocations", {
    expected_version: d.principal.version,
    reason: why,
  });
  assert.equal((await call(newClient, "GET", "/v1/admin/me")).status, 401);
  const legacy = base + "/" + target.id + "/revoke-sessions";
  assert.equal((await call(a, "POST", legacy, {})).status, 400);
  assert.equal(
    (
      await call(a, "POST", legacy, {
        expected_version: d.principal.version,
        reason: why,
      })
    ).data.error.code,
    "VERSION_CONFLICT",
  );
  const latest = (await detail(a, target.id)).principal;
  await ok(a, "POST", legacy, {
    expected_version: latest.version,
    reason: why,
  });
  await assert.rejects(
    system.db.app.query("SELECT * FROM admin_enrollments LIMIT 1"),
    { code: "42501" },
  );
  const audit = (
    await system.db.control.query(
      "SELECT detail FROM audit_log WHERE target=$1",
      [reset.invitation_id],
    )
  ).rows;
  assert.equal(JSON.stringify(audit).includes(newSetup.setup_key), false);
});

test("an administrator cannot remove their own deny; another fully authorized operator can restore access", async () => {
  const target = await operator([
    "admin.access.read",
    "admin.access.bindings.write",
    "admin.access.bindings.revoke",
    "admin.usage.read",
  ]);
  const denied = await restrictUsage(target);
  assert.equal(
    (await call(target, "DELETE", "/v1/admin/access/bindings/" + denied.id))
      .data.error.code,
    "SELF_BINDING_FORBIDDEN",
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT 1 FROM admin_bindings WHERE id=$1",
        [denied.id],
      )
    ).rowCount,
    1,
  );
  const a = await operator();
  const key = randomUUID(),
    first = await ok(
      a,
      "DELETE",
      "/v1/admin/access/bindings/" + denied.id,
      undefined,
      key,
    ),
    again = await ok(
      a,
      "DELETE",
      "/v1/admin/access/bindings/" + denied.id,
      undefined,
      key,
    );
  assert.deepEqual(again.data, first.data);
  assert.equal((await call(target, "GET", "/v1/admin/me")).status, 401);
});

test("lifting another account's deny requires delegated permissions, limits and expiry rather than revocation permission alone", async () => {
  const target = await operator(["admin.usage.read"]),
    denied = await restrictUsage(target);
  const revokeOnly = await operator([
    "admin.access.bindings.revoke",
    "admin.usage.read",
  ]);
  assert.equal(
    (await call(revokeOnly, "DELETE", "/v1/admin/access/bindings/" + denied.id))
      .data.error.code,
    "ADMIN_FORBIDDEN",
  );
  const noUsage = await operator([
    "admin.access.bindings.revoke",
    "admin.access.bindings.write",
  ]);
  assert.equal(
    (await call(noUsage, "DELETE", "/v1/admin/access/bindings/" + denied.id))
      .data.error.code,
    "ADMIN_FORBIDDEN",
  );
  const expires = new Date(Date.now() + 3600000).toISOString();
  const bounded = await operator(
    [
      "admin.access.bindings.revoke",
      "admin.access.bindings.write",
      "admin.usage.read",
    ],
    { max_batch: 2 },
    expires,
  );
  assert.equal(
    (await call(bounded, "DELETE", "/v1/admin/access/bindings/" + denied.id))
      .data.error.code,
    "DELEGATION_LIMIT",
  );
  await system.db.control.query(
    "UPDATE admin_bindings SET limits=$2 WHERE principal_id=$1 AND effect='allow'",
    [target.id, { max_batch: 1 }],
  );
  assert.equal(
    (await call(bounded, "DELETE", "/v1/admin/access/bindings/" + denied.id))
      .data.error.code,
    "DELEGATION_LIMIT",
  );
  await system.db.control.query(
    "UPDATE admin_bindings SET expires_at=$2 WHERE principal_id=$1 AND effect='allow'",
    [target.id, expires],
  );
  await ok(bounded, "DELETE", "/v1/admin/access/bindings/" + denied.id);
});

test("deny removal checks intersecting global, workspace and project scope without requiring unrelated permissions", async () => {
  const t = (
    await system.db.control.query(
      "INSERT INTO tenants(name) VALUES('Deny overlap test') RETURNING id",
    )
  ).rows[0].id;
  const p = (
    await system.db.control.query(
      "INSERT INTO projects(tenant_id,name) VALUES($1,'Scoped restriction') RETURNING id",
      [t],
    )
  ).rows[0].id;
  const other = (
    await system.db.control.query(
      "INSERT INTO tenants(name) VALUES('Other restriction scope') RETURNING id",
    )
  ).rows[0].id;
  const a = await operator([
    "admin.access.bindings.revoke",
    "admin.access.bindings.write",
  ]);
  const usageRole = "usage_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Scoped usage reader',$2)",
    [usageRole, JSON.stringify(["admin.usage.read"])],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)",
    [a.id, usageRole, t],
  );
  const target = await operator(["admin.usage.read", "admin.billing.read"]);
  const projectDeny = await restrictUsage(target, "project", p);
  await ok(a, "DELETE", "/v1/admin/access/bindings/" + projectDeny.id);
  const tenantDeny = await restrictUsage(target, "tenant", t);
  await ok(a, "DELETE", "/v1/admin/access/bindings/" + tenantDeny.id);
  const otherDeny = await restrictUsage(target, "tenant", other);
  assert.equal(
    (await call(a, "DELETE", "/v1/admin/access/bindings/" + otherDeny.id)).data
      .error.code,
    "ADMIN_FORBIDDEN",
  );
  const globalDeny = await restrictUsage(target);
  assert.equal(
    (await call(a, "DELETE", "/v1/admin/access/bindings/" + globalDeny.id)).data
      .error.code,
    "ADMIN_FORBIDDEN",
  );
  const projectTarget = await operator([]);
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)",
    [projectTarget.id, usageRole, p],
  );
  const broadDeny = await restrictUsage(projectTarget);
  await ok(a, "DELETE", "/v1/admin/access/bindings/" + broadDeny.id);

  const restricted = await operator([
    "admin.access.principals.write",
    "admin.access.bindings.revoke",
    "admin.access.bindings.write",
    "admin.usage.read",
  ]);
  await restrictUsage(restricted, "project", p);
  for (const binding of [
    { role_key: usageRole, scope_kind: "global" },
    { role_key: usageRole, scope_kind: "tenant", scope_id: t },
  ]) {
    const email = `blocked-delegation-${randomUUID()}@example.invalid`;
    const rejected = await call(restricted, "POST", base, {
      email,
      name: "Scope bypass attempt",
      reason: why,
      binding,
    });
    assert.equal(rejected.data.error.code, "ADMIN_FORBIDDEN");
    assert.equal(
      (
        await system.db.control.query(
          "SELECT 1 FROM admin_principals WHERE email=$1",
          [email],
        )
      ).rowCount,
      0,
    );
  }
  assert.equal(
    (
      await call(
        restricted,
        "DELETE",
        "/v1/admin/access/bindings/" + globalDeny.id,
      )
    ).data.error.code,
    "ADMIN_FORBIDDEN",
  );
  // A restriction in one project does not prevent delegation outside its workspace.
  await invite(restricted, {
    role_key: usageRole,
    scope_kind: "tenant",
    scope_id: other,
  });
});

test("last effective super protection excludes pending invitations and serializes concurrent account suspension", async () => {
  const a = await operator(),
    b = await operator();
  const pending = await invite(a, {
    role_key: "super_admin",
    scope_kind: "global",
  });
  assert.equal(pending.principal.enrollment_state, "pending");
  const prior = (
    await system.db.control.query(
      "SELECT id FROM admin_bindings WHERE role_key='super_admin' AND effect='allow' AND scope_kind='global' AND expires_at IS NULL AND principal_id<>ALL($1::uuid[])",
      [[a.id, b.id]],
    )
  ).rows.map((r) => r.id);
  try {
    await system.db.control.query(
      "UPDATE admin_bindings SET expires_at=now()+interval '1 hour' WHERE id=ANY($1::uuid[])",
      [prior],
    );
    const manager = await operator([
      "admin.access.read",
      "admin.access.principals.write",
    ]);
    const da = (await detail(manager, a.id)).principal,
      db = (await detail(manager, b.id)).principal;
    const results = await Promise.all(
      [da, db].map((p) =>
        call(manager, "POST", base + "/" + p.id + "/status", {
          expected_version: p.version,
          state: "suspended",
          reason: why,
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      results.find((r) => r.status === 409)!.data.error.code,
      "LAST_SUPER_ADMIN",
    );
    const live = results[0].status === 409 ? da : db;
    const reset = await call(
      manager,
      "POST",
      base + "/" + live.id + "/reset-mfa",
      { expected_version: live.version, reason: why },
    );
    assert.equal(reset.data.error.code, "LAST_SUPER_ADMIN");
    const p = (
      await system.db.control.query(
        "SELECT * FROM admin_principals WHERE id=$1",
        [live.id],
      )
    ).rows[0];
    assert.equal(p.enrollment_state, "enrolled");
    assert.equal(p.status, "active");
  } finally {
    await system.db.control.query(
      "UPDATE admin_bindings SET expires_at=NULL WHERE id=ANY($1::uuid[])",
      [prior],
    );
  }
});
