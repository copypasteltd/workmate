import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import {
  randomUUID,
  randomBytes,
  createHash,
  generateKeyPairSync,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { hash } from "../src/lib.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
type Client =
  | { id: string; email: string; cookie: string; csrf: string }
  | { access: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      "idempotency-key": randomUUID(),
      ...(c && "cookie" in c
        ? { cookie: c.cookie, "x-csrf-token": c.csrf }
        : {}),
      ...(c && "access" in c ? { authorization: "Bearer " + c.access } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
) {
  const r = await call(c, method, url, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function challenge(email: string) {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", { email });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`,
      "utf8",
    ),
  );
  return {
    challenge_id: ch.challenge_id,
    code: mail.text.match(/code is (\d{6})/)[1],
  };
}
async function user(): Promise<Extract<Client, { cookie: string }>> {
  const email = `sessions-${randomUUID()}@example.invalid`;
  const r = await call(
    undefined,
    "POST",
    "/v1/auth/verify",
    await challenge(email),
  );
  assert.equal(r.status, 200);
  return {
    id: r.data.user.id,
    email,
    cookie: "cp_session=" + r.raw.cookies[0].value,
    csrf: r.data.csrf_token,
  };
}
async function grant(
  u: Client,
  client_id: "desktop" | "extension" = "desktop",
) {
  const code_verifier = randomBytes(32).toString("base64url");
  const redirect_uri =
    client_id === "desktop"
      ? "http://127.0.0.1:40555/callback"
      : `https://${s.db.config.EXTENSION_ID}.chromiumapp.org/callback`;
  const data = await ok(u, "POST", "/v1/auth/native/authorize", {
    client_id,
    redirect_uri,
    code_challenge: createHash("sha256")
      .update(code_verifier)
      .digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  });
  return {
    client_id,
    redirect_uri,
    code_verifier,
    code: new URL(data.redirect).searchParams.get("code")!,
  };
}
async function native(
  u: Client,
  client_id: "desktop" | "extension" = "desktop",
) {
  return ok(
    undefined,
    "POST",
    "/v1/auth/native/token",
    await grant(u, client_id),
  );
}
const renew = (t: any, client_id = "desktop") =>
  call(undefined, "POST", "/v1/auth/native/refresh", {
    client_id,
    refresh_token: t.refresh_token,
  });
const revoke = (t: any, client_id = "desktop") =>
  ok(undefined, "POST", "/v1/auth/native/revoke", {
    client_id,
    refresh_token: t.refresh_token,
  });
const sessionId = async (access: string) =>
  (
    await s.db.control.query("SELECT id FROM sessions WHERE token_hash=$1", [
      hash(access),
    ])
  ).rows[0].id;
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
      EXTENSION_ID: "a".repeat(32),
    }),
    { worker: false },
  );
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

test("session inventory distinguishes all clients/current session, retains refreshable expired access, and exposes no credentials", async () => {
  const u = await user(),
    d = await native(u),
    e = await native(u, "extension");
  const desktop = await sessionId(d.access_token);
  await s.db.control.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
    [desktop],
  );
  const list = await ok(u, "GET", "/v1/me/sessions");
  assert.deepEqual(list.items.map((i: any) => i.client_id).sort(), [
    "desktop",
    "extension",
    "web",
  ]);
  assert.equal(list.items.filter((i: any) => i.current).length, 1);
  assert.equal(list.items.find((i: any) => i.current).client_id, "web");
  assert.ok(list.items.find((i: any) => i.id === desktop).refresh_expires_at);
  const panelList = await ok(
    { access: e.access_token },
    "GET",
    "/v1/me/sessions",
  );
  assert.equal(
    panelList.items.find((i: any) => i.current).client_id,
    "extension",
  );
  for (const item of list.items)
    assert.deepEqual(
      Object.keys(item).sort(),
      [
        "id",
        "audience",
        "client_id",
        "current",
        "created_at",
        "expires_at",
        "refresh_expires_at",
      ].sort(),
    );
  const text = JSON.stringify(list);
  for (const secret of [
    d.access_token,
    d.refresh_token,
    e.access_token,
    e.refresh_token,
    u.csrf,
  ])
    assert.ok(!text.includes(secret));
});
test("native sign-out revokes an expired access token's family without rotation; repeat/unknown/client mismatch are non-enumerating", async () => {
  const u = await user(),
    d = await native(u),
    e = await native(u, "extension");
  await s.db.control.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [hash(d.access_token)],
  );
  await revoke(d, "extension"); // A different client cannot revoke the credential.
  const rotated = await renew(d);
  assert.equal(rotated.status, 200);
  await s.db.control.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [hash(rotated.data.access_token)],
  );
  assert.deepEqual(await revoke(d), { ok: true }); // Consumed credential still identifies the original family.
  assert.deepEqual(await revoke(rotated.data), { ok: true });
  assert.deepEqual(
    await revoke({ refresh_token: randomBytes(32).toString("base64url") }),
    { ok: true },
  );
  assert.equal((await renew(rotated.data)).status, 401);
  assert.equal(
    (await call({ access: rotated.data.access_token }, "GET", "/v1/me")).status,
    401,
  );
  assert.equal(
    (await call({ access: e.access_token }, "GET", "/v1/me")).status,
    200,
  );
  assert.equal((await call(u, "GET", "/v1/me")).status, 200);
  const audit = (
    await s.db.control.query(
      "SELECT detail FROM audit_log WHERE principal_id=$1 AND action='session.native_revoke'",
      [u.id],
    )
  ).rows;
  assert.ok(audit.length >= 1);
  assert.ok(
    audit.every(
      (a) =>
        JSON.stringify(a.detail) === JSON.stringify({ client_id: "desktop" }),
    ),
  );
});
test("actual concurrent refresh/revocation always ends the whole family and cannot mint surviving rotated access", async () => {
  const u = await user();
  for (let attempt = 0; attempt < 6; attempt++) {
    const d = await native(u);
    const [rotated, result] = await Promise.all([renew(d), revoke(d)]);
    assert.deepEqual(result, { ok: true });
    assert.ok([200, 401].includes(rotated.status));
    if (rotated.status === 200) {
      assert.equal(
        (await call({ access: rotated.data.access_token }, "GET", "/v1/me"))
          .status,
        401,
      );
      assert.equal((await renew(rotated.data)).status, 401);
    }
    assert.equal((await renew(d)).status, 401);
    assert.equal(
      (await call({ access: d.access_token }, "GET", "/v1/me")).status,
      401,
    );
  }
});
test("device revocation is owner-scoped, CSRF-protected and follows an older listed ID across refresh rotation", async () => {
  const u = await user(),
    outsider = await user(),
    d = await native(u),
    id = await sessionId(d.access_token);
  await ok(outsider, "DELETE", "/v1/me/sessions/" + id);
  assert.equal(
    (await call({ access: d.access_token }, "GET", "/v1/me")).status,
    200,
  );
  const csrf = await s.app.inject({
    method: "DELETE",
    url: "/v1/me/sessions/" + id,
    headers: { cookie: u.cookie, origin: s.db.config.WEB_ORIGIN },
  });
  assert.equal(csrf.statusCode, 403);
  const rotated = await renew(d);
  assert.equal(rotated.status, 200);
  await ok(u, "DELETE", "/v1/me/sessions/" + id);
  assert.equal(
    (await call({ access: rotated.data.access_token }, "GET", "/v1/me")).status,
    401,
  );
  assert.equal((await renew(rotated.data)).status, 401);
  const current = (await ok(u, "GET", "/v1/me/sessions")).items.find(
    (i: any) => i.current,
  );
  const signedOut = await call(u, "DELETE", "/v1/me/sessions/" + current.id);
  assert.equal(signedOut.status, 200);
  assert.ok(
    signedOut.raw.cookies.some(
      (c: any) => c.name === "cp_session" && c.value === "",
    ),
  );
  assert.equal((await call(u, "GET", "/v1/me")).status, 401);
});
test("email and PKCE codes reject expiration/replay; browser logout invalidates outstanding native authorization", async () => {
  const otp = await challenge(`otp-${randomUUID()}@example.invalid`);
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/verify", otp)).status,
    200,
  );
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/verify", otp)).status,
    401,
  );
  const expired = await challenge(`expired-${randomUUID()}@example.invalid`);
  await s.db.control.query(
    "UPDATE auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.challenge_id],
  );
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/verify", expired)).status,
    401,
  );
  const u = await user(),
    first = await grant(u);
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/native/token", first)).status,
    200,
  );
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/native/token", first)).status,
    401,
  );
  const late = await grant(u);
  await s.db.control.query(
    "UPDATE native_auth_codes SET expires_at=now()-interval '1 second' WHERE digest=$1",
    [hash(late.code)],
  );
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/native/token", late)).status,
    401,
  );
  const outstanding = await grant(u);
  await ok(u, "POST", "/v1/auth/logout");
  assert.equal(
    (await call(undefined, "POST", "/v1/auth/native/token", outstanding))
      .status,
    401,
  );
});
test("expired/wrong-email/replayed invitations fail and removed members cannot use browser, rotated native, or device ingress", async () => {
  const owner = await user(),
    member = await user(),
    stranger = await user();
  const w = await ok(owner, "POST", "/v1/tenants", {
    name: "Session authority",
    project_name: "Marketing",
  });
  const invite = async () => {
    const i = await ok(owner, "POST", `/v1/tenants/${w.tenant.id}/invites`, {
      email: member.email,
      role: "member",
      project_ids: [w.project.id],
    });
    return {
      id: i.id,
      token: new URL(i.invite_url).searchParams.get("token")!,
    };
  };
  const old = await invite();
  await s.db.control.query(
    "UPDATE invites SET expires_at=now()-interval '1 second' WHERE id=$1",
    [old.id],
  );
  assert.equal(
    (await call(member, "POST", "/v1/invites/accept", { token: old.token }))
      .status,
    409,
  );
  const fresh = await invite();
  assert.equal(
    (await call(stranger, "POST", "/v1/invites/accept", { token: fresh.token }))
      .status,
    409,
  );
  await ok(member, "POST", "/v1/invites/accept", { token: fresh.token });
  assert.equal(
    (await call(member, "POST", "/v1/invites/accept", { token: fresh.token }))
      .status,
    409,
  );
  const d = await native(member),
    e = await native(member, "extension");
  const public_key = generateKeyPairSync("ed25519")
    .publicKey.export({ format: "pem", type: "spki" })
    .toString();
  const device = await ok(
    { access: d.access_token },
    "POST",
    `/v1/tenants/${w.tenant.id}/devices`,
    { name: "Owned device", client: "desktop", public_key, grants: [] },
  );
  const base = `/v1/tenants/${w.tenant.id}`;
  const memberships = await ok(owner, "GET", base + "/members");
  const m = memberships.items.find((i: any) => i.id === member.id);
  await ok(owner, "PATCH", base + "/members/" + member.id, {
    version: m.version,
    role: "member",
    status: "removed",
    project_ids: [],
  });
  for (const c of [
    member,
    { access: d.access_token },
    { access: e.access_token },
  ]) {
    assert.equal((await call(c, "GET", base + "/projects")).status, 404);
    assert.equal(
      (await call(c, "GET", base + `/devices/${device.id}/commands`)).status,
      404,
    );
  }
  const rotated = await renew(d); // Account may belong to other companies; a token grants no removed membership.
  assert.equal(rotated.status, 200);
  assert.equal(
    (
      await call(
        { access: rotated.data.access_token },
        "GET",
        base + "/projects",
      )
    ).status,
    404,
  );
  assert.ok(
    !(await ok(member, "GET", "/v1/me")).memberships.some(
      (i: any) => i.id === w.tenant.id,
    ),
  );
});
