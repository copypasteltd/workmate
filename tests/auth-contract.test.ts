import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { hash, unseal } from "../src/lib.js";
import { cleanAuthReceipts } from "../src/auth-receipts.js";
import contract from "../contracts/auth-schemas.json" with { type: "json" };

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
type Browser = { cookies: Map<string, string>; csrf?: string; id?: string };
const ajv = new Ajv2020({ allErrors: true });
const addFormats = createRequire(import.meta.url)("ajv-formats") as (
  instance: Ajv2020,
) => void;
addFormats(ajv);
const definitions = JSON.parse(
  JSON.stringify(contract.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function schema(name: string, value: unknown) {
  let validate = validators.get(name);
  if (!validate) {
    validate = ajv.compile({ $defs: definitions, $ref: "#/$defs/" + name });
    validators.set(name, validate);
  }
  assert.ok(validate(value), JSON.stringify(validate.errors));
}
async function call(
  method: string,
  url: string,
  body?: unknown,
  browser?: Browser,
  options: {
    key?: string | null;
    headers?: Record<string, string>;
    bearer?: string;
  } = {},
) {
  const headers: Record<string, string> = { origin: s.db.config.WEB_ORIGIN };
  if (options.key !== null)
    headers["idempotency-key"] = options.key ?? randomUUID();
  if (browser?.cookies.size)
    headers.cookie = [...browser.cookies]
      .map(([k, v]) => k + "=" + v)
      .join("; ");
  if (browser?.csrf) headers["x-csrf-token"] = browser.csrf;
  if (options.bearer) headers.authorization = "Bearer " + options.bearer;
  Object.assign(headers, options.headers);
  if (body !== undefined) headers["content-type"] = "application/json";
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers,
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = raw.statusCode === 302 ? null : raw.json();
  if (browser)
    for (const cookie of raw.cookies) {
      if (cookie.maxAge === 0) browser.cookies.delete(cookie.name);
      else browser.cookies.set(cookie.name, cookie.value);
    }
  return { status: raw.statusCode, data, raw };
}
async function expected(
  status: number,
  method: string,
  url: string,
  body?: unknown,
  browser?: Browser,
  options: Parameters<typeof call>[4] = {},
) {
  const r = await call(method, url, body, browser, options);
  assert.equal(r.status, status, r.data?.error?.code);
  return r;
}
const fresh = (): Browser => ({ cookies: new Map() });
async function challenge(
  browser: Browser,
  email = "auth-contract-" + randomUUID() + "@example.invalid",
  key = randomUUID(),
) {
  const r = await expected(
    202,
    "POST",
    "/v1/auth/challenges",
    { email },
    browser,
    { key },
  );
  schema("AuthChallenge", r.data);
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${r.data.challenge_id}.json`,
      "utf8",
    ),
  );
  return {
    email,
    key,
    body: {
      challenge_id: r.data.challenge_id,
      code: mail.text.match(/code is (\d{6})/)[1],
    },
    expires: r.data.expires_at,
  };
}
async function user() {
  const browser = fresh(),
    c = await challenge(browser);
  const key = randomUUID(),
    r = await expected(201, "POST", "/v1/auth/sessions", c.body, browser, {
      key,
    });
  schema("UserSession", r.data);
  browser.csrf = r.data.csrf_token;
  browser.id = r.data.user.id;
  return { browser, challenge: c, sessionKey: key, session: r.data };
}
async function grant(
  browser: Browser,
  client_id: "desktop" | "extension" = "desktop",
) {
  const verifier = randomBytes(32).toString("base64url"),
    state = randomBytes(32).toString("base64url");
  const redirect_uri =
    client_id === "desktop"
      ? "http://127.0.0.1:40555/callback"
      : `https://${s.db.config.EXTENSION_ID}.chromiumapp.org/callback`;
  const query = {
    client_id,
    redirect_uri,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
  };
  const r = await expected(
    302,
    "GET",
    "/v1/auth/authorize?" + new URLSearchParams(query),
    undefined,
    browser,
  );
  const redirect = new URL(r.raw.headers.location as string);
  assert.equal(redirect.origin + redirect.pathname, redirect_uri);
  assert.equal(redirect.searchParams.get("state"), state);
  assert.deepEqual([...redirect.searchParams.keys()].sort(), ["code", "state"]);
  return {
    grant_type: "authorization_code",
    client_id,
    redirect_uri,
    code: redirect.searchParams.get("code")!,
    code_verifier: verifier,
  };
}
async function native(
  browser: Browser,
  client: "desktop" | "extension" = "desktop",
) {
  const body = await grant(browser, client),
    key = randomUUID(),
    r = await expected(201, "POST", "/v1/auth/token", body, undefined, { key });
  schema("Tokens", r.data);
  return { body, key, tokens: r.data };
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "false",
      DEV_MAILBOX: "true",
      SSO_ALLOW_LOCALHOST: "false",
    }),
    { worker: false },
  );
});
after(async () => {
  await s?.app.close();
  await isolated?.cleanup();
});

test("canonical challenge is strict 202/UTC, deduplicates concurrent requests and binds its HTTP-only browser flow", async () => {
  const b = fresh(),
    email = "auth-contract-" + randomUUID() + "@example.invalid",
    key = randomUUID();
  const all = await Promise.all(
    Array.from({ length: 12 }, () =>
      call("POST", "/v1/auth/challenges", { email }, undefined, { key }),
    ),
  );
  for (const r of all) {
    assert.equal(r.status, 202);
    schema("AuthChallenge", r.data);
    assert.equal(r.data.challenge_id, all[0].data.challenge_id);
    assert.match(String(r.raw.headers["set-cookie"]), /HttpOnly/);
  }
  assert.equal(
    (
      await s.db.app.query(
        "SELECT count(*)::int AS n FROM auth_challenges WHERE email=$1",
        [email],
      )
    ).rows[0].n,
    1,
  );
  await expected(
    409,
    "POST",
    "/v1/auth/challenges",
    { email: "different@example.invalid" },
    b,
    { key },
  );
  await expected(400, "POST", "/v1/auth/challenges", { email }, b, {
    key: null,
  });
  await expected(
    400,
    "POST",
    "/v1/auth/challenges",
    { email, role: "admin" },
    b,
  );
  const c = await challenge(b);
  const row = (
    await s.db.app.query(
      "SELECT expires_at,client_flow_hash FROM auth_challenges WHERE id=$1",
      [c.body.challenge_id],
    )
  ).rows[0];
  assert.equal(c.expires, row.expires_at.toISOString());
  assert.equal(row.client_flow_hash, hash(b.cookies.get("cp_auth_flow")!));
  assert.match(
    String(
      (await call("GET", "/v1/public/config")).raw.headers["cache-control"],
    ),
    /no-store/,
  );
});

test("canonical session strictly returns 201/UserSession and only its original browser can retry the consumed OTP", async () => {
  const u = await user(),
    original = u.browser.cookies.get("cp_session");
  const replay = await expected(
    201,
    "POST",
    "/v1/auth/sessions",
    u.challenge.body,
    u.browser,
    { key: u.sessionKey },
  );
  schema("UserSession", replay.data);
  assert.equal(u.browser.cookies.get("cp_session"), original);
  assert.equal(
    (
      await s.db.app.query(
        "SELECT count(*)::int AS n FROM sessions WHERE user_id=$1",
        [u.browser.id],
      )
    ).rows[0].n,
    1,
  );
  await expected(401, "POST", "/v1/auth/sessions", u.challenge.body, fresh(), {
    key: u.sessionKey,
  });
  await expected(401, "POST", "/v1/auth/sessions", u.challenge.body, u.browser);
  await expected(
    409,
    "POST",
    "/v1/auth/sessions",
    {
      ...u.challenge.body,
      code: "000000" === u.challenge.body.code ? "111111" : "000000",
    },
    u.browser,
    { key: u.sessionKey },
  );
  await expected(
    400,
    "POST",
    "/v1/auth/sessions",
    { ...u.challenge.body, name: "injected" },
    u.browser,
  );
  const expiry = (
    await s.db.app.query(
      "SELECT expires_at FROM sessions WHERE token_hash=$1",
      [hash(original!)],
    )
  ).rows[0].expires_at;
  assert.equal(u.session.expires_at, expiry.toISOString());
  assert.deepEqual(Object.keys(u.session.user).sort(), [
    "display_name",
    "email",
    "id",
  ]);
});

test("a canonical challenge cannot bypass flow binding through legacy verify; failed attempts and expiry remain one-use", async () => {
  const b = fresh(),
    c = await challenge(b);
  await expected(401, "POST", "/v1/auth/verify", c.body, fresh());
  assert.equal(
    (
      await s.db.app.query("SELECT attempts FROM auth_challenges WHERE id=$1", [
        c.body.challenge_id,
      ])
    ).rows[0].attempts,
    0,
  );
  for (let i = 0; i < 5; i++)
    await expected(
      401,
      "POST",
      "/v1/auth/sessions",
      { ...c.body, code: c.body.code === "000000" ? "111111" : "000000" },
      b,
    );
  await expected(401, "POST", "/v1/auth/sessions", c.body, b);
  const expired = await challenge(b);
  await s.db.app.query(
    "UPDATE auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.body.challenge_id],
  );
  await expected(401, "POST", "/v1/auth/sessions", expired.body, b);
});

test("canonical logout enforces CSRF for a live cookie, clears flow/session cookies and remains safe to repeat", async () => {
  const u = await user(),
    other = await native(u.browser),
    oldCookies = new Map(u.browser.cookies);
  await expected(403, "DELETE", "/v1/auth/session", undefined, u.browser, {
    headers: { "x-csrf-token": "" },
  });
  const r = await expected(
    200,
    "DELETE",
    "/v1/auth/session",
    undefined,
    u.browser,
  );
  schema("Ack", r.data);
  assert.equal(u.browser.cookies.has("cp_session"), false);
  assert.equal(u.browser.cookies.has("cp_auth_flow"), false);
  await expected(200, "DELETE", "/v1/auth/session", undefined, u.browser);
  await expected(
    401,
    "POST",
    "/v1/auth/sessions",
    u.challenge.body,
    { cookies: oldCookies },
    { key: u.sessionKey },
  );
  await expected(200, "GET", "/v1/me", undefined, undefined, {
    bearer: other.tokens.access_token,
  });
});

test("canonical authorize requires explicit S256, a browser session and consent proof before minting any code", async () => {
  const u = await user(),
    v = randomBytes(32).toString("base64url");
  const good = {
    client_id: "desktop",
    redirect_uri: "http://127.0.0.1:40555/callback",
    code_challenge: createHash("sha256").update(v).digest("base64url"),
    code_challenge_method: "S256",
    state: randomBytes(32).toString("base64url"),
  };
  const url = (query: Record<string, string>) =>
    "/v1/auth/authorize?" + new URLSearchParams(query);
  for (const bad of [
    { ...good, code_challenge_method: "plain" },
    { ...good, code_challenge_method: "" },
    { ...good, redirect_uri: "https://outside.invalid/callback" },
    { ...good, redirect_uri: good.redirect_uri + "?unregistered=true" },
    { ...good, extra: "ignored?" },
  ])
    await expected(400, "GET", url(bad), undefined, u.browser);
  const without = { cookies: u.browser.cookies };
  await expected(403, "GET", url(good), undefined, without);
  await expected(403, "GET", url(good), undefined, without, {
    headers: {
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "sec-fetch-user": "?1",
      "sec-fetch-site": "cross-site",
      referer: "https://outside.invalid/",
    },
  });
  await expected(403, "GET", url(good), undefined, without, {
    headers: {
      "sec-fetch-mode": "no-cors",
      "sec-fetch-dest": "image",
      "sec-fetch-user": "?1",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(
    (
      await s.db.app.query(
        "SELECT count(*)::int AS n FROM native_auth_codes WHERE user_id=$1",
        [u.browser.id],
      )
    ).rows[0].n,
    0,
  );
  await expected(302, "GET", url(good), undefined, without, {
    headers: {
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "sec-fetch-user": "?1",
      "sec-fetch-site": "same-origin",
    },
  });
  await expected(302, "GET", url(good), undefined, without, {
    headers: {
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "sec-fetch-user": "?1",
      "sec-fetch-site": "cross-site",
      referer: s.db.config.WEB_ORIGIN + "/authorize",
    },
  });
  const n = await native(u.browser);
  await expected(403, "GET", url(good), undefined, u.browser, {
    bearer: n.tokens.access_token,
  });
  await expected(
    403,
    "POST",
    "/v1/auth/native/authorize",
    {
      client_id: good.client_id,
      redirect_uri: good.redirect_uri,
      code_challenge: good.code_challenge,
      state: good.state,
    },
    undefined,
    { bearer: n.tokens.access_token },
  );
});

test("canonical code exchange commits one family under concurrent retries; a different key cannot replay the code", async () => {
  const u = await user(),
    body = await grant(u.browser),
    key = randomUUID();
  schema("CodeExchange", body);
  const all = await Promise.all(
    Array.from({ length: 10 }, () =>
      call("POST", "/v1/auth/token", body, undefined, { key }),
    ),
  );
  for (const r of all) {
    assert.equal(r.status, 201, r.data?.error?.code);
    schema("Tokens", r.data);
    assert.equal(r.data.access_token, all[0].data.access_token);
    assert.equal(r.data.refresh_token, all[0].data.refresh_token);
    assert.ok(r.data.expires_in <= all[0].data.expires_in);
  }
  assert.equal(
    (
      await s.db.app.query(
        "SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id=$1",
        [u.browser.id],
      )
    ).rows[0].n,
    1,
  );
  await expected(401, "POST", "/v1/auth/token", body);
  await expected(400, "POST", "/v1/auth/token", {
    ...body,
    grant_type: "password",
  });
  await expected(400, "POST", "/v1/auth/token", {
    ...body,
    code_verifier: "x",
  });
  await expected(400, "POST", "/v1/auth/token", {
    ...body,
    client_secret: "not-permitted",
  });
  await expected(400, "POST", "/v1/auth/token", body, undefined, { key: null });
  await s.db.app.query(
    "UPDATE sessions SET expires_at=now()+interval '50 seconds' WHERE token_hash=$1",
    [hash(all[0].data.access_token)],
  );
  const replay = await expected(
    201,
    "POST",
    "/v1/auth/token",
    body,
    undefined,
    { key },
  );
  schema("Tokens", replay.data);
  assert.equal(replay.data.access_token, all[0].data.access_token);
  assert.ok(replay.data.expires_in > 0 && replay.data.expires_in <= 50);
});

test("canonical refresh deduplicates response loss; rotated-family reuse with another key still revokes every credential", async () => {
  const u = await user(),
    n = await native(u.browser),
    body = {
      grant_type: "refresh_token",
      client_id: "desktop",
      refresh_token: n.tokens.refresh_token,
    },
    key = randomUUID();
  schema("RefreshExchange", body);
  const all = await Promise.all(
    Array.from({ length: 12 }, () =>
      call("POST", "/v1/auth/token", body, undefined, { key }),
    ),
  );
  for (const r of all) {
    assert.equal(r.status, 201);
    schema("Tokens", r.data);
    assert.equal(r.data.access_token, all[0].data.access_token);
    assert.equal(r.data.refresh_token, all[0].data.refresh_token);
    assert.ok(r.data.expires_in <= all[0].data.expires_in);
  }
  assert.equal(
    (
      await s.db.app.query(
        "SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id=$1",
        [u.browser.id],
      )
    ).rows[0].n,
    2,
  );
  await expected(
    409,
    "POST",
    "/v1/auth/token",
    { ...body, client_id: "extension" },
    undefined,
    { key },
  );
  await expected(401, "POST", "/v1/auth/token", body);
  await expected(401, "GET", "/v1/me", undefined, undefined, {
    bearer: all[0].data.access_token,
  });
  await expected(401, "POST", "/v1/auth/token", body, undefined, { key });
  await expected(401, "POST", "/v1/auth/token", n.body, undefined, {
    key: n.key,
  });
});

test("expired refresh receipts cannot reissue or revoke a later rotation when an old request is retried", async () => {
  const u = await user(),
    n = await native(u.browser),
    b1 = {
      grant_type: "refresh_token",
      client_id: "desktop",
      refresh_token: n.tokens.refresh_token,
    },
    k1 = randomUUID();
  const first = await expected(201, "POST", "/v1/auth/token", b1, undefined, {
    key: k1,
  });
  const next = await expected(201, "POST", "/v1/auth/token", {
    ...b1,
    refresh_token: first.data.refresh_token,
  });
  await expected(401, "POST", "/v1/auth/token", b1, undefined, { key: k1 });
  await expected(200, "GET", "/v1/me", undefined, undefined, {
    bearer: next.data.access_token,
  });
});

test("encrypted receipts are non-readable at rest and freezing/revocation prevents retrieving their secrets again", async () => {
  const u = await user(),
    n = await native(u.browser);
  const receipts = (
    await s.db.app.query(
      "SELECT * FROM auth_request_receipts WHERE session_id IN (SELECT id FROM sessions WHERE user_id=$1)",
      [u.browser.id],
    )
  ).rows;
  assert.equal(receipts.length, 2);
  for (const receipt of receipts) {
    assert.ok(!receipt.response_cipher.includes(n.tokens.access_token));
    assert.ok(!receipt.response_cipher.includes(n.tokens.refresh_token));
    assert.throws(() => unseal("wrong-key", receipt.response_cipher));
    assert.ok(
      JSON.parse(unseal(s.db.config.MASTER_KEY!, receipt.response_cipher)),
    );
  }
  await s.db.control.query("UPDATE users SET status='suspended' WHERE id=$1", [
    u.browser.id,
  ]);
  await expected(401, "POST", "/v1/auth/token", n.body, undefined, {
    key: n.key,
  });
  await expected(
    401,
    "POST",
    "/v1/auth/sessions",
    u.challenge.body,
    u.browser,
    { key: u.sessionKey },
  );
  await s.db.control.query(
    "UPDATE users SET status='active',auth_version=auth_version+1 WHERE id=$1",
    [u.browser.id],
  );
  await expected(401, "POST", "/v1/auth/token", n.body, undefined, {
    key: n.key,
  });
});

test("a temporary mail failure retries the same encrypted challenge without spending another rate-limit slot", async () => {
  const b = fresh(),
    email = "auth-contract-" + randomUUID() + "@example.invalid",
    key = randomUUID();
  const original = {
    DEV_MAILBOX: s.db.config.DEV_MAILBOX,
    SMTP_URL: s.db.config.SMTP_URL,
  };
  let failedId = "";
  try {
    s.db.config.DEV_MAILBOX = false;
    s.db.config.SMTP_URL = undefined;
    await expected(503, "POST", "/v1/auth/challenges", { email }, b, { key });
    failedId = (
      await s.db.app.query("SELECT id FROM auth_challenges WHERE email=$1", [
        email,
      ])
    ).rows[0].id;
  } finally {
    Object.assign(s.db.config, original);
  }
  const c = await challenge(b, email, key);
  assert.equal(c.body.challenge_id, failedId);
  assert.equal(
    (
      await s.db.app.query(
        "SELECT count(*)::int AS n FROM auth_challenges WHERE email=$1",
        [email],
      )
    ).rows[0].n,
    1,
  );
  await expected(201, "POST", "/v1/auth/sessions", c.body, b);
});

test("legacy clients still share the same one-use codes, rotation family and user-session boundaries", async () => {
  const u = await user(),
    body = await grant(u.browser);
  const { grant_type: _, ...legacyBody } = body;
  const r = await expected(200, "POST", "/v1/auth/native/token", legacyBody);
  schema("Tokens", r.data);
  await expected(401, "POST", "/v1/auth/token", body);
  const rotated = await expected(201, "POST", "/v1/auth/token", {
    grant_type: "refresh_token",
    client_id: "desktop",
    refresh_token: r.data.refresh_token,
  });
  await expected(200, "POST", "/v1/auth/native/revoke", {
    client_id: "desktop",
    refresh_token: rotated.data.refresh_token,
  });
  await expected(401, "GET", "/v1/me", undefined, undefined, {
    bearer: rotated.data.access_token,
  });
});

test("receipt retention removes at most 100 expired rows per sweep and preserves active receipts and live sessions", async () => {
  const active = await user();
  await s.db.app.query(
    `INSERT INTO auth_request_receipts(operation,key_hash,request_hash,response_cipher,expires_at) SELECT 'challenge',encode(digest('cleanup-'||n::text,'sha256'),'hex'),repeat('a',64),'expired-fixture',now()-interval '1 second' FROM generate_series(1,101) n`,
  );
  await cleanAuthReceipts(s.db);
  assert.equal(
    (
      await s.db.app.query(
        "SELECT count(*)::int AS n FROM auth_request_receipts WHERE expires_at<=now()",
      )
    ).rows[0].n,
    1,
  );
  await cleanAuthReceipts(s.db);
  assert.equal(
    (
      await s.db.app.query(
        "SELECT count(*)::int AS n FROM auth_request_receipts WHERE expires_at<=now()",
      )
    ).rows[0].n,
    0,
  );
  await expected(200, "GET", "/v1/me", undefined, active.browser);
});
