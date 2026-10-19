import { isolatedTestEnvironment } from "./native-test-environment.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { hash, seal } from "../src/lib.js";
import { totp } from "../src/auth.js";
import { expireFederationAttempts } from "../src/federation-session.js";
import { startIdentityFixture, type IdentityMode } from "./helpers/oidc-idp.js";

let system: Awaited<ReturnType<typeof buildApp>>,
  idp: Awaited<ReturnType<typeof startIdentityFixture>>;
type Client = {
  id?: string;
  email?: string;
  cookie: string;
  csrf?: string;
  admin?: boolean;
};
const why = "Enterprise federation integration acceptance";
const body = (raw: any) =>
  raw.headers["content-type"]?.includes("application/json") ? raw.json() : null;
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  payload?: unknown,
  key: string = randomUUID(),
) {
  const raw = await system.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? "http://localhost:4318" : "http://localhost:4317",
      "idempotency-key": key,
      ...(c?.cookie ? { cookie: c.cookie } : {}),
      ...(c?.csrf ? { "x-csrf-token": c.csrf } : {}),
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: raw.statusCode, data: body(raw), raw };
}
async function ok(
  c: Client | undefined,
  method: string,
  url: string,
  payload?: unknown,
  key?: string,
) {
  const r = await call(c, method, url, payload, key);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r;
}
function cookie(raw: any, name: string) {
  const c = raw.cookies.find((c: any) => c.name === name && c.value);
  assert.ok(c, "Expected " + name);
  return name + "=" + c.value;
}
async function mailCode(id: string) {
  return JSON.parse(
    await readFile(`${system.db.config.DATA_DIR}/mailbox/${id}.json`, "utf8"),
  ).text.match(/code is (\d{6})/)[1];
}
async function account(role?: string): Promise<Client> {
  const email = `sso-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 }).base32;
  if (role) {
    const p = (
      await system.db.control.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'SSO operator',$2) RETURNING id",
        [email, seal(system.db.config.MASTER_KEY!, secret)],
      )
    ).rows[0];
    await system.db.control.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",
      [p.id, role],
    );
  }
  const base = role ? "/v1/admin/auth" : "/v1/auth",
    c = { cookie: "", admin: !!role };
  const ch = (await ok(c, "POST", base + "/challenge", { email })).data;
  const r = await ok(c, "POST", base + "/verify", {
    challenge_id: ch.challenge_id,
    code: await mailCode(ch.challenge_id),
    ...(role ? { totp: totp(secret).generate() } : {}),
  });
  return {
    email,
    id: r.data.user.id,
    cookie: cookie(r.raw, role ? "cp_admin_session" : "cp_session"),
    csrf: r.data.csrf_token,
    admin: !!role,
  };
}
async function setup(
  options: {
    mode?: string;
    method?: string;
    enable?: boolean;
    alg?: "RS256" | "ES256";
  } = {},
) {
  const owner = await account(),
    admin = await account("super_admin");
  const w = (
    await ok(owner, "POST", "/v1/tenants", {
      name: "SSO enterprise",
      project_name: "Marketing",
    })
  ).data;
  const base = `/v1/admin/tenants/${w.tenant.id}/sso`,
    login_key = "sso-" + randomUUID();
  const input = {
    expected_version: 0,
    reason: why,
    login_key,
    name: "Company identity",
    issuer: idp.issuer,
    client_id: idp.clientId,
    client_secret: idp.secret,
    domains: ["example.invalid"],
    token_auth_method: options.method ?? "client_secret_post",
    signing_alg: options.alg ?? "RS256",
    email_mode: options.mode ?? "verified_email",
  };
  let connection = (await ok(admin, "POST", base, input)).data;
  if (options.enable !== false) {
    connection = (
      await ok(admin, "POST", base + "/probe", {
        expected_version: connection.version,
        reason: why,
      })
    ).data;
    connection = (
      await ok(admin, "POST", base + "/status", {
        expected_version: connection.version,
        action: "enable",
        reason: why,
      })
    ).data;
  }
  return { owner, admin, w, base, input, connection, login_key };
}
type Setup = Awaited<ReturnType<typeof setup>>;
async function start(
  f: Setup,
  address = f.owner.email!,
  next = "/app/settings",
) {
  const r = await ok(undefined, "POST", "/v1/auth/sso/start", {
    login_key: f.login_key,
    email: address,
    next,
  });
  return { cookie: cookie(r.raw, "cp_sso_attempt"), url: r.data.redirect };
}
async function callback(
  a: { cookie: string; url: string },
  mode: IdentityMode = {},
) {
  idp.state.mode = mode;
  const redirect = await fetch(a.url + "&approve=1", { redirect: "manual" });
  assert.equal(redirect.status, 302);
  const u = new URL(redirect.headers.get("location")!);
  return {
    ...(await call(a, "GET", u.pathname + u.search)),
    callback: u.pathname + u.search,
  };
}
async function link(f: Setup, a: { cookie: string; url: string }) {
  const pending = await ok(a, "GET", "/v1/auth/sso/pending");
  assert.equal(pending.data.email, f.owner.email);
  const ch = (await ok(a, "POST", "/v1/auth/sso/link/challenge", {})).data;
  const r = await ok(a, "POST", "/v1/auth/sso/link", {
    challenge_id: ch.challenge_id,
    code: await mailCode(ch.challenge_id),
  });
  const c = { cookie: cookie(r.raw, "cp_session") };
  const me = (await ok(c, "GET", "/v1/session/context")).data;
  return { ...c, id: me.user.id, csrf: me.csrf_token, email: me.user.email };
}
async function linked(f: Setup) {
  const a = await start(f);
  const r = await callback(a);
  assert.equal(r.raw.headers.location, "http://localhost:4317/sso/confirm");
  return link(f, a);
}
async function native(c: Client, exchange = true) {
  const verifier = randomBytes(32).toString("base64url"),
    redirect_uri = "http://127.0.0.1:49152/callback";
  const result = (
    await ok(c, "POST", "/v1/auth/native/authorize", {
      client_id: "desktop",
      redirect_uri,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      state: randomBytes(32).toString("base64url"),
    })
  ).data;
  const payload = {
    client_id: "desktop",
    redirect_uri,
    code: new URL(result.redirect).searchParams.get("code"),
    code_verifier: verifier,
  };
  return {
    payload,
    tokens: exchange
      ? (await ok(undefined, "POST", "/v1/auth/native/token", payload)).data
      : null,
  };
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  idp = await startIdentityFixture();
  const env: any = {
    ...isolated.env,
    NODE_ENV: "test",
    WORKER_ENABLED: "false",
    SSO_ALLOW_LOCALHOST: "true",
    SSO_ALLOWED_ORIGINS: "",
  };
  system = await buildApp(loadConfig(env), { worker: false });
});
after(async () => {
  try {
    try {
      await system?.app.close();
    } finally {
      await idp?.close();
    }
  } finally {
    await isolated?.cleanup();
  }
});

test("SSO configuration has global permission, current MFA, CAS, secret redaction and a probe-before-enable gate", async () => {
  const f = await setup({ enable: false }),
    denied = await account("user_operator");
  assert.equal((await call(denied, "POST", f.base, f.input)).status, 403);
  assert.equal(
    (
      await call(f.admin, "POST", f.base + "/status", {
        expected_version: f.connection.version,
        action: "enable",
        reason: why,
      })
    ).status,
    409,
  );
  const result = (await ok(f.admin, "GET", f.base)).data;
  assert.equal(JSON.stringify(result).includes(idp.secret), false);
  assert.equal(result.connection.client_secret, undefined);
  assert.equal(
    result.callback_uri,
    "http://localhost:4317/v1/auth/sso/callback",
  );
  const row = (
    await system.db.control.query(
      "SELECT client_secret FROM sso_connections WHERE id=$1",
      [f.connection.id],
    )
  ).rows[0];
  assert.notEqual(row.client_secret, idp.secret);
  const key = randomUUID(),
    payload = { expected_version: f.connection.version, reason: why };
  const first = (await ok(f.admin, "POST", f.base + "/probe", payload, key))
    .data;
  assert.deepEqual(
    (await ok(f.admin, "POST", f.base + "/probe", payload, key)).data,
    first,
  );
  assert.equal(
    (
      await call(
        f.admin,
        "POST",
        f.base + "/probe",
        { ...payload, reason: "different request body" },
        key,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(f.admin, "POST", f.base, {
        ...f.input,
        client_secret: undefined,
      })
    ).status,
    409,
  );
  await system.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [f.admin.id],
  );
  assert.equal(
    (
      await call(f.admin, "POST", f.base + "/status", {
        expected_version: first.version,
        action: "enable",
        reason: why,
      })
    ).data.error.code,
    "MFA_REQUIRED",
  );
});
test("discovery enforces origins, redirects and advertised PKCE without changing an unverified connection", async () => {
  const f = await setup({ enable: false });
  assert.equal(
    (
      await call(f.admin, "POST", f.base, {
        ...f.input,
        expected_version: f.connection.version,
        issuer: "https://unapproved.example.invalid/oidc",
      })
    ).data.error.code,
    "SSO_NETWORK_DENIED",
  );
  idp.state.metadataPatch = { code_challenge_methods_supported: ["plain"] };
  assert.equal(
    (
      await call(f.admin, "POST", f.base + "/probe", {
        expected_version: f.connection.version,
        reason: why,
      })
    ).status,
    400,
  );
  idp.state.metadataPatch = {};
  idp.state.redirectKeys = true;
  assert.equal(
    (
      await call(f.admin, "POST", f.base + "/probe", {
        expected_version: f.connection.version,
        reason: why,
      })
    ).status,
    502,
  );
  idp.state.redirectKeys = false;
  assert.equal(
    (await ok(f.admin, "GET", f.base)).data.connection.verified_revision,
    null,
  );
  assert.throws(
    () =>
      loadConfig({
        ...process.env,
        NODE_ENV: "test",
        SSO_ALLOWED_ORIGINS: "https://identity.example/path",
      }),
    /exact HTTPS/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...process.env,
        NODE_ENV: "test",
        SSO_CALLBACK_ORIGIN: "https://evil.example",
      }),
    /callback origin/,
  );
});
test("first binding requires independent email proof, scoped OTP purpose and single atomic consumption", async () => {
  const f = await setup(),
    a = await start(f);
  const r = await callback(a);
  assert.equal(r.status, 302);
  assert.equal((await call(a, "GET", "/v1/me")).status, 401);
  const ch = (await ok(a, "POST", "/v1/auth/sso/link/challenge", {})).data,
    code = await mailCode(ch.challenge_id);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/verify", {
        challenge_id: ch.challenge_id,
        code,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(a, "POST", "/v1/auth/sso/link", {
        challenge_id: ch.challenge_id,
        code: code === "999999" ? "111111" : "999999",
      })
    ).status,
    401,
  );
  const replies = await Promise.all([
    call(a, "POST", "/v1/auth/sso/link", {
      challenge_id: ch.challenge_id,
      code,
    }),
    call(a, "POST", "/v1/auth/sso/link", {
      challenge_id: ch.challenge_id,
      code,
    }),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 401]);
  const issued = replies.find((r) => r.status === 200)!;
  assert.equal(
    (await ok({ cookie: cookie(issued.raw, "cp_session") }, "GET", "/v1/me"))
      .data.id,
    f.owner.id,
  );
  const persisted = (
    await system.db.control.query(
      "SELECT * FROM federation_attempts WHERE browser_hash=$1",
      [hash(a.cookie.split("=")[1])],
    )
  ).rows[0];
  assert.equal(persisted.phase, "complete");
  assert.equal(persisted.secrets, null);
});
test("a known issuer/subject signs in again without re-linking and client_secret_basic also completes", async () => {
  const f = await setup({ method: "client_secret_basic" });
  await linked(f);
  const a = await start(f),
    r = await callback(a);
  assert.equal(r.raw.headers.location, "http://localhost:4317/app/settings");
  assert.equal(
    (await ok({ cookie: cookie(r.raw, "cp_session") }, "GET", "/v1/me")).data
      .id,
    f.owner.id,
  );
  assert.equal((await call(a, "GET", r.callback)).status, 302);
  assert.equal((await call(a, "GET", "/v1/auth/sso/pending")).status, 401);
});
test("wrong signature, audience, issuer, nonce, expiry or email claims never create a binding", async () => {
  const f = await setup();
  for (const mode of [
    { badSignature: true },
    { audience: "another-client" },
    { issuer: "https://evil.invalid" },
    { nonce: "wrong-nonce" },
    { expired: true },
    { verified: false },
    { email: "someone-else@example.invalid" },
  ] satisfies IdentityMode[]) {
    await system.db.control.query(
      "UPDATE federation_attempts SET created_at=now()-interval '2 minutes' WHERE email=$1",
      [f.owner.email],
    );
    const r = await callback(await start(f), mode);
    assert.equal(
      r.raw.headers.location,
      "http://localhost:4317/sso/confirm?error=SSO_SIGN_IN_FAILED",
      JSON.stringify(mode),
    );
    assert.equal(
      r.raw.cookies.some((c: any) => c.name === "cp_session" && !!c.value),
      false,
    );
  }
  assert.equal(
    (
      await system.db.control.query(
        "SELECT 1 FROM federated_identities WHERE connection_id=$1",
        [f.connection.id],
      )
    ).rowCount,
    0,
  );
});
test("state and browser capability must match; callbacks exchange exactly once", async () => {
  const f = await setup(),
    a = await start(f);
  idp.state.mode = {};
  const r = await fetch(a.url + "&approve=1", { redirect: "manual" }),
    url = new URL(r.headers.get("location")!);
  const count = idp.state.tokenCalls;
  assert.equal(
    (await call(undefined, "GET", url.pathname + url.search)).raw.headers
      .location,
    "http://localhost:4317/sso/confirm?error=SSO_SIGN_IN_FAILED",
  );
  const forged = new URL(url);
  forged.searchParams.set("state", randomBytes(32).toString("base64url"));
  await call(a, "GET", forged.pathname + forged.search);
  assert.equal(idp.state.tokenCalls, count);
  const replies = await Promise.all([
    call(a, "GET", url.pathname + url.search),
    call(a, "GET", url.pathname + url.search),
  ]);
  assert.equal(idp.state.tokenCalls, count + 1);
  assert.equal(
    replies.filter(
      (r) => r.raw.headers.location === "http://localhost:4317/sso/confirm",
    ).length,
    1,
  );
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/sso/start", {
        email: f.owner.email,
        login_key: f.login_key,
        next: "//evil.example",
      })
    ).status,
    400,
  );
  const noOrigin = await system.app.inject({
    method: "POST",
    url: "/v1/auth/sso/start",
    payload: { email: f.owner.email, login_key: f.login_key },
  });
  assert.equal(noOrigin.statusCode, 403);
});
test("domain equality cannot enroll a stranger or bypass a removed membership", async () => {
  const f = await setup(),
    stranger = `not-a-member-${randomUUID()}@example.invalid`;
  const r = await callback(await start(f, stranger));
  assert.match(String(r.raw.headers.location), /SSO_SIGN_IN_FAILED/);
  assert.equal(
    (
      await system.db.control.query("SELECT 1 FROM users WHERE email=$1", [
        stranger,
      ])
    ).rowCount,
    0,
  );
  await system.db.control.query(
    "UPDATE memberships SET status='removed' WHERE tenant_id=$1 AND user_id=$2",
    [f.w.tenant.id, f.owner.id],
  );
  const suspended = await callback(await start(f));
  assert.match(String(suspended.raw.headers.location), /SSO_SIGN_IN_FAILED/);
});
test("subject-with-proof accepts no email claim only after the independent work mailbox is proved", async () => {
  const f = await setup({ mode: "subject_with_proof" }),
    a = await start(f);
  const r = await callback(a, {
    noEmail: true,
    subject: "idp-employee-" + randomUUID(),
  });
  assert.equal(r.raw.headers.location, "http://localhost:4317/sso/confirm");
  const c = await link(f, a);
  assert.equal(c.id, f.owner.id);
});
test("five incorrect link codes exhaust that proof; another browser cannot consume it", async () => {
  const f = await setup(),
    a = await start(f);
  await callback(a);
  const ch = (await ok(a, "POST", "/v1/auth/sso/link/challenge", {})).data,
    code = await mailCode(ch.challenge_id);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/sso/link", {
        challenge_id: ch.challenge_id,
        code,
      })
    ).status,
    401,
  );
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await call(a, "POST", "/v1/auth/sso/link", {
          challenge_id: ch.challenge_id,
          code: code === "999999" ? "111111" : "999999",
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await call(a, "POST", "/v1/auth/sso/link", {
        challenge_id: ch.challenge_id,
        code,
      })
    ).status,
    401,
  );
});
test("disabling a connection revokes linked browser/native/refresh credentials and outstanding native grants", async () => {
  const f = await setup(),
    c = await linked(f),
    n = await native(c),
    pending = await native(c, false);
  const before = (
    await system.db.control.query(
      "SELECT auth_version FROM users WHERE id=$1",
      [f.owner.id],
    )
  ).rows[0].auth_version;
  const refreshed = (
    await ok(undefined, "POST", "/v1/auth/native/refresh", {
      client_id: "desktop",
      refresh_token: n.tokens.refresh_token,
    })
  ).data;
  const row = (
    await system.db.control.query(
      "SELECT federation_identity_id,federation_revision FROM sessions WHERE token_hash=$1",
      [hash(refreshed.access_token)],
    )
  ).rows[0];
  assert.ok(row.federation_identity_id);
  assert.equal(row.federation_revision, f.connection.revision);
  await ok(f.admin, "POST", f.base + "/status", {
    expected_version: f.connection.version,
    action: "disable",
    reason: why,
  });
  assert.equal((await call(c, "GET", "/v1/me")).status, 401);
  assert.equal((await call(f.owner, "GET", "/v1/me")).status, 401);
  const api = await system.app.inject({
    url: "/v1/me",
    headers: { authorization: "Bearer " + refreshed.access_token },
  });
  assert.equal(api.statusCode, 401);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/refresh", {
        client_id: "desktop",
        refresh_token: refreshed.refresh_token,
      })
    ).status,
    401,
  );
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/native/token", pending.payload))
      .status,
    401,
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT auth_version FROM users WHERE id=$1",
        [f.owner.id],
      )
    ).rows[0].auth_version,
    before + 1,
  );
});
test("configuration changes revoke old attempts and require metadata validation and fresh identity binding", async () => {
  const f = await setup(),
    a = await start(f);
  const key = randomUUID(),
    p = {
      ...f.input,
      client_secret: undefined,
      expected_version: f.connection.version,
    };
  const changed = (await ok(f.admin, "POST", f.base, p, key)).data;
  assert.equal(changed.enabled, false);
  assert.equal(changed.metadata, null);
  assert.equal(changed.revision, f.connection.revision + 1);
  assert.deepEqual((await ok(f.admin, "POST", f.base, p, key)).data, changed);
  assert.match(
    String((await callback(a)).raw.headers.location),
    /SSO_SIGN_IN_FAILED/,
  );
});
test("unlink is owner-only, checks CAS, invalidates all sessions and never exposes external subjects", async () => {
  const f = await setup(),
    c = await linked(f),
    other = await account();
  const list = (await ok(c, "GET", "/v1/me/sso-identities")).data.items;
  assert.equal(list.length, 1);
  assert.equal(list[0].subject, undefined);
  const base = "/v1/me/sso-identities/" + list[0].id + "/revoke";
  assert.equal(
    (await call(other, "POST", base, { expected_version: list[0].version }))
      .status,
    404,
  );
  assert.equal(
    (await call(c, "POST", base, { expected_version: list[0].version + 1 }))
      .status,
    409,
  );
  await ok(c, "POST", base, { expected_version: list[0].version });
  assert.equal((await call(c, "GET", "/v1/me")).status, 401);
});
test("email login logout and account revision changes invalidate unexchanged native authorization codes", async () => {
  const a = await account(),
    first = await native(a, false);
  await ok(a, "POST", "/v1/auth/logout", {});
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/native/token", first.payload))
      .status,
    401,
  );
  const b = await account(),
    second = await native(b, false);
  await system.db.control.query(
    "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
    [b.id],
  );
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/native/token", second.payload))
      .status,
    401,
  );
});
test("expired attempts scrub PKCE secrets and the app identity cannot read SSO control tables", async () => {
  const f = await setup(),
    a = await start(f);
  await system.db.control.query(
    "UPDATE federation_attempts SET expires_at=now()-interval '1 second' WHERE browser_hash=$1",
    [hash(a.cookie.split("=")[1])],
  );
  await expireFederationAttempts(system.db.control);
  const row = (
    await system.db.control.query(
      "SELECT phase,secrets FROM federation_attempts WHERE browser_hash=$1",
      [hash(a.cookie.split("=")[1])],
    )
  ).rows[0];
  assert.deepEqual(row, { phase: "failed", secrets: null });
  for (const table of [
    "sso_connections",
    "federated_identities",
    "federation_attempts",
  ])
    await assert.rejects(
      system.db.app.query("SELECT * FROM " + table),
      /permission denied/,
    );
});
test("replacing an active external subject requires new proof and revokes prior browser/native sessions", async () => {
  const f = await setup(),
    old = await linked(f),
    n = await native(old);
  await system.db.control.query(
    "UPDATE auth_challenges SET created_at=now()-interval '2 minutes' WHERE email=$1",
    [f.owner.email],
  );
  const a = await start(f),
    r = await callback(a, { subject: "replacement-" + randomUUID() });
  assert.equal(r.raw.headers.location, "http://localhost:4317/sso/confirm");
  const current = await link(f, a);
  assert.equal((await call(current, "GET", "/v1/me")).status, 200);
  assert.equal((await call(old, "GET", "/v1/me")).status, 401);
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/refresh", {
        client_id: "desktop",
        refresh_token: n.tokens.refresh_token,
      })
    ).status,
    401,
  );
});
test("a replacement issuer may reuse a raw subject without inheriting or colliding with the old issuer's account", async () => {
  const f = await setup(),
    a = await start(f);
  await callback(a, { subject: "reused-external-id" });
  await link(f, a);
  const original = idp,
    replacement = await startIdentityFixture();
  try {
    let connection = (
      await ok(f.admin, "POST", f.base, {
        ...f.input,
        expected_version: f.connection.version,
        issuer: replacement.issuer,
        client_id: replacement.clientId,
        client_secret: replacement.secret,
      })
    ).data;
    connection = (
      await ok(f.admin, "POST", f.base + "/probe", {
        expected_version: connection.version,
        reason: why,
      })
    ).data;
    await ok(f.admin, "POST", f.base + "/status", {
      expected_version: connection.version,
      action: "enable",
      reason: why,
    });
    const newcomer = await account();
    await system.db.control.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
      [f.w.tenant.id, newcomer.id],
    );
    idp = replacement;
    const next = { ...f, owner: newcomer },
      attempt = await start(next),
      r = await callback(attempt, { subject: "reused-external-id" });
    assert.equal(r.raw.headers.location, "http://localhost:4317/sso/confirm");
    const linked = await link(next, attempt);
    assert.equal(linked.id, newcomer.id);
    const rows = (
      await system.db.control.query(
        "SELECT subject FROM federated_identities WHERE connection_id=$1",
        [f.connection.id],
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].subject, rows[1].subject);
  } finally {
    idp = original;
    await replacement.close();
  }
});
test("ES256 verifies a real P-256 signature and rejects a token signed by another EC key", async () => {
  const original = idp;
  idp = await startIdentityFixture(0, "ES256");
  try {
    const f = await setup({ alg: "ES256" }),
      c = await linked(f);
    assert.equal(c.id, f.owner.id);
    const r = await callback(await start(f), { badSignature: true });
    assert.match(String(r.raw.headers.location), /SSO_SIGN_IN_FAILED/);
  } finally {
    await idp.close();
    idp = original;
  }
});
test("revoking a listed native session also revokes its rotated access token and refresh family", async () => {
  const invalid = await account();
  assert.equal(
    (
      await call(invalid, "POST", "/v1/auth/native/authorize", {
        client_id: "desktop",
        redirect_uri: "http://user:password@127.0.0.1:49152/callback",
        code_challenge: randomBytes(32).toString("base64url"),
        state: randomBytes(32).toString("base64url"),
      })
    ).status,
    400,
  );
  const c = await account(),
    n = await native(c);
  const id = (
    await system.db.control.query(
      "SELECT id FROM sessions WHERE token_hash=$1",
      [hash(n.tokens.access_token)],
    )
  ).rows[0].id;
  const rotated = (
    await ok(undefined, "POST", "/v1/auth/native/refresh", {
      client_id: "desktop",
      refresh_token: n.tokens.refresh_token,
    })
  ).data;
  await ok(c, "DELETE", "/v1/me/sessions/" + id);
  assert.equal(
    (
      await system.app.inject({
        url: "/v1/me",
        headers: { authorization: "Bearer " + rotated.access_token },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await call(undefined, "POST", "/v1/auth/native/refresh", {
        client_id: "desktop",
        refresh_token: rotated.refresh_token,
      })
    ).status,
    401,
  );
});
test("concurrent connection revocation and native exchange/rotation serialize without deadlock or surviving credentials", async () => {
  const f = await setup(),
    c = await linked(f),
    n = await native(c),
    pending = await native(c, false);
  const replies = await Promise.all([
    call(f.admin, "POST", f.base + "/status", {
      expected_version: f.connection.version,
      action: "disable",
      reason: why,
    }),
    call(undefined, "POST", "/v1/auth/native/token", pending.payload),
    call(undefined, "POST", "/v1/auth/native/refresh", {
      client_id: "desktop",
      refresh_token: n.tokens.refresh_token,
    }),
  ]);
  assert.equal(replies[0].status, 200);
  for (const r of replies.slice(1)) {
    assert.ok([200, 401].includes(r.status), JSON.stringify(r.data));
    if (r.status === 200)
      assert.equal(
        (
          await system.app.inject({
            url: "/v1/me",
            headers: { authorization: "Bearer " + r.data.access_token },
          })
        ).statusCode,
        401,
      );
  }
});
