import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/membership-schemas.json" with { type: "json" };
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { dispatchInvitationMail } from "../src/invitation-delivery.js";
import { hash, unseal } from "../src/lib.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type User = { id: string; email: string; cookie: string; csrf: string };
const ajv = new Ajv2020({ allErrors: true });
createRequire(import.meta.url)("ajv-formats")(ajv);
const defs = JSON.parse(
  JSON.stringify(contract.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
function schema(name: string, value: unknown) {
  const validate = ajv.compile({ $defs: defs, $ref: "#/$defs/" + name });
  assert.ok(validate(value), JSON.stringify(validate.errors));
}
async function call(
  u: User | undefined,
  method: string,
  url: string,
  body?: unknown,
  opts: { key?: string | null; tenant?: string | null } = {},
) {
  const tenant =
    opts.tenant === undefined
      ? /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1]
      : opts.tenant;
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...(opts.key !== null
        ? { "idempotency-key": opts.key ?? randomUUID() }
        : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function user(): Promise<User> {
  const email = `members-${randomUUID()}@example.invalid`;
  const ch = await call(undefined, "POST", "/v1/auth/challenge", { email });
  assert.equal(ch.status, 200);
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: ch.data.challenge_id,
    code: mail.text.match(/code is (\d{6})/)[1],
  });
  assert.equal(r.status, 200);
  return {
    id: r.data.user.id,
    email,
    cookie:
      "cp_session=" + r.raw.cookies.find((c) => c.name === "cp_session")!.value,
    csrf: r.data.csrf_token,
  };
}
async function workspace(owner: User) {
  const r = await call(owner, "POST", "/v1/tenants", {
    name: "Invitation authority",
    project_name: "Marketing",
  });
  assert.equal(r.status, 200);
  return { ...r.data, base: `/v1/tenants/${r.data.tenant.id}` };
}
async function invite(
  owner: User,
  w: any,
  recipient: User,
  role = "member",
  key = randomUUID(),
) {
  const body = { email: recipient.email, role, project_ids: [w.project.id] };
  schema("InviteCreate", body);
  const r = await call(owner, "POST", w.base + "/invites", body, { key });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  schema("Invite", r.data);
  const d = (
    await s.db.control.query(
      "SELECT * FROM invitation_deliveries WHERE invite_id=$1",
      [r.data.id],
    )
  ).rows[0];
  return {
    ...r.data,
    token: unseal(s.db.config.MASTER_KEY!, d.token_cipher),
    body,
    key,
  };
}
async function accept(u: User, i: any, key = randomUUID()) {
  return call(u, "POST", "/v1/invites/accept", { token: i.token }, { key });
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
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

test("original strict invitation contract, required matching tenant header, stable retry and no delivery secrets", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    i = await invite(o, w, r);
  const again = await call(o, "POST", w.base + "/invites", i.body, {
    key: i.key,
  });
  assert.equal(again.status, 201);
  assert.equal(again.data.id, i.id);
  assert.equal(
    (
      await call(
        o,
        "POST",
        w.base + "/invites",
        { ...i.body, role: "viewer" },
        { key: i.key },
      )
    ).data.error.code,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.ok(
    (await call(o, "POST", w.base + "/invites", i.body, { tenant: null }))
      .status >= 400,
  );
  assert.equal(
    (
      await call(o, "POST", w.base + "/invites", i.body, {
        tenant: randomUUID(),
      })
    ).data.error.code,
    "TENANT_MISMATCH",
  );
  assert.ok(
    (await call(o, "POST", w.base + "/invites", i.body, { key: null }))
      .status >= 400,
  );
  const receipts = (
    await s.db.control.query(
      "SELECT response::text FROM request_replays WHERE actor_id=$1 AND action=$2",
      [o.id, `invite:${w.tenant.id}`],
    )
  ).rows;
  assert.equal(receipts.length, 1);
  assert.ok(!JSON.stringify(receipts).includes(i.token));
  assert.ok(!JSON.stringify(receipts).includes("invite_url"));
});
test("acceptance is email-bound, concurrent same-key retries recover one original Member, other keys cannot reuse it", async () => {
  const o = await user(),
    r = await user(),
    wrong = await user(),
    w = await workspace(o),
    i = await invite(o, w, r);
  assert.equal((await accept(wrong, i)).status, 409);
  const key = randomUUID(),
    results = await Promise.all([accept(r, i, key), accept(r, i, key)]);
  for (const result of results) {
    assert.equal(result.status, 201, JSON.stringify(result.data));
    schema("Member", result.data);
  }
  assert.deepEqual(results[0].data, results[1].data);
  assert.notEqual(results[0].data.id, r.id);
  assert.deepEqual(results[0].data.project_ids, [w.project.id]);
  assert.equal((await accept(r, i)).status, 409);
  const w2 = await workspace(o),
    other = await invite(o, w2, r);
  assert.equal(
    (await accept(r, other, key)).data.error.code,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal((await accept(r, other)).status, 201);
});
test("stable MemberList pagination exposes no directory fields and rejects foreign cursors and headers", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    w2 = await workspace(o),
    i = await invite(o, w, r);
  assert.equal((await accept(r, i)).status, 201);
  const a = await call(o, "GET", w.base + "/members?limit=1");
  schema("MemberList", a.data);
  assert.equal(a.data.items.length, 1);
  assert.ok(a.data.next_cursor);
  const b = await call(
    o,
    "GET",
    w.base + "/members?limit=1&cursor=" + a.data.next_cursor,
  );
  schema("MemberList", b.data);
  assert.equal(b.data.items.length, 1);
  assert.equal(b.data.next_cursor, null);
  assert.notEqual(a.data.items[0].id, b.data.items[0].id);
  assert.equal(
    (await call(o, "GET", w2.base + "/members?cursor=" + a.data.next_cursor))
      .status,
    410,
  );
  assert.ok(
    (await call(o, "GET", w.base + "/members?limit=101")).status >= 400,
  );
  assert.ok(
    (await call(o, "GET", w.base + "/members", undefined, { tenant: null }))
      .status >= 400,
  );
  assert.equal(
    (await call(r, "GET", w.base + "/member-directory")).status,
    403,
  );
  assert.equal(
    (await call(o, "GET", w.base + "/member-directory")).data.items.find(
      (m: any) => m.user_id === r.id,
    ).email,
    r.email,
  );
});
test("removed membership immediately denies access and stale acceptance cannot restore it; old removal replay cannot delete a fresh grant", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    i = await invite(o, w, r),
    acceptKey = randomUUID();
  const joined = await accept(r, i, acceptKey);
  assert.equal(joined.status, 201);
  const removeKey = randomUUID(),
    url = "/v1/members/" + joined.data.id;
  const removed = await call(o, "DELETE", url, undefined, {
    tenant: w.tenant.id,
    key: removeKey,
  });
  assert.equal(removed.status, 200);
  schema("Ack", removed.data);
  assert.equal((await call(r, "GET", w.base + "/projects")).status, 404);
  assert.equal(
    (await accept(r, i, acceptKey)).data.error.code,
    "MEMBERSHIP_CHANGED",
  );
  const fresh = await invite(o, w, r),
    rejoined = await accept(r, fresh);
  assert.equal(rejoined.status, 201);
  assert.equal(rejoined.data.id, joined.data.id);
  assert.ok(rejoined.data.auth_version > joined.data.auth_version);
  assert.equal(
    (
      await call(o, "DELETE", url, undefined, {
        tenant: w.tenant.id,
        key: removeKey,
      })
    ).status,
    200,
  );
  assert.equal((await call(r, "GET", w.base + "/projects")).status, 200);
  assert.equal(
    (await call(o, "DELETE", url, undefined, { tenant: randomUUID() })).status,
    404,
  );
});
test("a changed issuer membership revision invalidates pending permissions and cancels queued mail", async () => {
  const o = await user(),
    admin = await user(),
    r = await user(),
    w = await workspace(o),
    ai = await invite(o, w, admin, "admin");
  const joined = await accept(admin, ai);
  assert.equal(joined.status, 201);
  const i = await invite(admin, w, r, "viewer");
  const changed = await call(o, "PATCH", w.base + "/members/" + admin.id, {
    role: "member",
    status: "active",
    version: joined.data.auth_version,
    project_ids: [w.project.id],
  });
  assert.equal(changed.status, 200);
  assert.equal((await accept(r, i)).status, 409);
  const out = await dispatchInvitationMail(s.db, { limit: 20 });
  assert.ok(out.cancelled >= 1);
  const d = (
    await s.db.control.query(
      "SELECT state,token_cipher FROM invitation_deliveries WHERE invite_id=$1",
      [i.id],
    )
  ).rows[0];
  assert.equal(d.state, "cancelled");
  assert.equal(d.token_cipher, null);
});
test("owner invitations work; admins cannot grant or remove privileged roles; cross-workspace projects are rejected", async () => {
  const o = await user(),
    admin = await user(),
    r = await user(),
    w = await workspace(o),
    w2 = await workspace(o),
    ai = await invite(o, w, admin, "admin");
  assert.equal((await accept(admin, ai)).status, 201);
  for (const role of ["owner", "admin"])
    assert.equal(
      (
        await call(admin, "POST", w.base + "/invites", {
          email: r.email,
          role,
          project_ids: [],
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await call(o, "POST", w.base + "/invites", {
        email: r.email,
        role: "member",
        project_ids: [w2.project.id],
      })
    ).status,
    404,
  );
  const oi = await invite(o, w, r, "owner"),
    joined = await accept(r, oi);
  assert.equal(joined.status, 201);
  assert.equal(joined.data.role, "owner");
  assert.equal(
    (
      await call(admin, "DELETE", "/v1/members/" + joined.data.id, undefined, {
        tenant: w.tenant.id,
      })
    ).status,
    403,
  );
});
test("concurrent owners cannot remove each other to leave an ownerless workspace", async () => {
  const o = await user(),
    other = await user(),
    w = await workspace(o),
    i = await invite(o, w, other, "owner"),
    joined = await accept(other, i);
  assert.equal(joined.status, 201);
  const own = (await call(o, "GET", w.base + "/members")).data.items.find(
    (m: any) => m.user_id === o.id,
  );
  const rs = await Promise.all([
    call(o, "DELETE", "/v1/members/" + joined.data.id, undefined, {
      tenant: w.tenant.id,
    }),
    call(other, "DELETE", "/v1/members/" + own.id, undefined, {
      tenant: w.tenant.id,
    }),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 404]);
  const owners = (
    await s.db.control.query(
      "SELECT * FROM memberships WHERE tenant_id=$1 AND role='owner' AND status='active'",
      [w.tenant.id],
    )
  ).rows;
  assert.equal(owners.length, 1);
  const remaining = owners[0].user_id === o.id ? o : other;
  assert.equal(
    (
      await call(
        remaining,
        "DELETE",
        "/v1/members/" + owners[0].id,
        undefined,
        { tenant: w.tenant.id },
      )
    ).data.error.code,
    "LAST_OWNER",
  );
});
test("delivery failure is durable and retryable; queued secrets are encrypted and erased after actual mailbox delivery", async () => {
  await dispatchInvitationMail(s.db, { limit: 20 });
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    i = await invite(o, w, r);
  const row = (
    await s.db.control.query(
      "SELECT * FROM invitation_deliveries WHERE invite_id=$1",
      [i.id],
    )
  ).rows[0];
  assert.ok(!row.token_cipher.includes(i.token));
  const fail = await dispatchInvitationMail(s.db, {
    limit: 1,
    send: async () => {
      throw new Error("sensitive upstream failure");
    },
  });
  assert.equal(fail.failed, 1);
  const failed = (
    await s.db.control.query(
      "SELECT * FROM invitation_deliveries WHERE invite_id=$1",
      [i.id],
    )
  ).rows[0];
  assert.equal(failed.last_error, "MAIL_UNAVAILABLE");
  assert.equal(failed.attempts, 1);
  assert.ok(failed.token_cipher);
  await s.db.control.query(
    "UPDATE invitation_deliveries SET next_attempt_at=now() WHERE invite_id=$1",
    [i.id],
  );
  assert.equal((await dispatchInvitationMail(s.db, { limit: 1 })).delivered, 1);
  const mail = JSON.parse(
    await readFile(`${s.db.config.DATA_DIR}/mailbox/${i.id}.json`, "utf8"),
  );
  assert.equal(mail.to, r.email);
  const link = new URL(mail.text.match(/https?:\/\/\S+/)[0]);
  assert.equal(link.searchParams.get("token"), i.token);
  assert.equal(link.searchParams.get("workspace"), w.tenant.id);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT token_cipher FROM invitation_deliveries WHERE invite_id=$1",
        [i.id],
      )
    ).rows[0].token_cipher,
    null,
  );
});
test("resend rotates the single-use secret; stale delivery completion cannot overwrite its newer generation", async () => {
  await dispatchInvitationMail(s.db, { limit: 20 });
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    i = await invite(o, w, r);
  let release!: () => void, started!: () => void;
  const startedPromise = new Promise<void>((r) => (started = r)),
    barrier = new Promise<void>((r) => (release = r));
  const pending = dispatchInvitationMail(s.db, {
    limit: 1,
    send: async () => {
      started();
      await barrier;
    },
  });
  await startedPromise;
  const k = randomUUID(),
    resend = await call(
      o,
      "POST",
      w.base + `/invites/${i.id}/resend`,
      { version: 1 },
      { key: k },
    );
  assert.equal(resend.status, 200);
  schema("Invite", resend.data);
  release();
  assert.equal((await pending).delivered, 0);
  assert.equal(
    (
      await call(
        o,
        "POST",
        w.base + `/invites/${i.id}/resend`,
        { version: 1 },
        { key: k },
      )
    ).status,
    200,
  );
  const d = (
    await s.db.control.query(
      "SELECT * FROM invitation_deliveries WHERE invite_id=$1",
      [i.id],
    )
  ).rows[0];
  assert.equal(d.state, "queued");
  assert.equal(d.version, 2);
  assert.equal((await accept(r, i)).status, 404);
  const freshToken = unseal(s.db.config.MASTER_KEY!, d.token_cipher);
  assert.notEqual(freshToken, i.token);
  assert.equal((await accept(r, { token: freshToken })).status, 201);
});
test("revoke and expiry erase queued credentials and never grant membership", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    i = await invite(o, w, r);
  const rev = await call(o, "POST", w.base + `/invites/${i.id}/revoke`, {
    version: 1,
  });
  assert.equal(rev.status, 200);
  assert.equal(rev.data.state, "revoked");
  assert.equal((await accept(r, i)).status, 409);
  const expired = await invite(o, w, r);
  await s.db.control.query(
    "UPDATE invites SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.id],
  );
  assert.equal((await accept(r, expired)).status, 409);
  await dispatchInvitationMail(s.db, { limit: 20 });
  const rows = (
    await s.db.control.query(
      "SELECT state,token_cipher FROM invitation_deliveries WHERE invite_id=ANY($1::uuid[])",
      [[i.id, expired.id]],
    )
  ).rows;
  assert.ok(
    rows.every((d) => d.state === "cancelled" && d.token_cipher === null),
  );
  const list = await call(o, "GET", w.base + "/invites");
  assert.ok(
    list.data.items.every((x: any) => !JSON.stringify(x).includes(i.token)),
  );
  assert.equal(
    list.data.items.find((x: any) => x.id === expired.id).state,
    "expired",
  );
});
test("archived projects invalidate pending invitations and active membership is never silently overwritten", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    i = await invite(o, w, r);
  await s.db.control.query("UPDATE projects SET archived=true WHERE id=$1", [
    w.project.id,
  ]);
  assert.equal((await accept(r, i)).status, 409);
  await s.db.control.query("UPDATE projects SET archived=false WHERE id=$1", [
    w.project.id,
  ]);
  assert.equal((await accept(r, i)).status, 201);
  const elevated = await invite(o, w, r, "admin");
  assert.equal((await accept(r, elevated)).data.error.code, "ALREADY_MEMBER");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
        [w.tenant.id, r.id],
      )
    ).rows[0].role,
    "member",
  );
  assert.equal(
    (await s.db.control.query("SELECT digest FROM invites WHERE id=$1", [i.id]))
      .rows[0].digest,
    hash(i.token),
  );
});

test("an exhausted abandoned delivery lease becomes a visible failure; explicit resend starts a new bounded generation", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o),
    i = await invite(o, w, r);
  await s.db.control.query(
    "UPDATE invitation_deliveries SET state='sending',attempts=8,lease_id=$2,lease_until=now()-interval '1 second' WHERE invite_id=$1",
    [i.id, randomUUID()],
  );
  await dispatchInvitationMail(s.db, { limit: 0 });
  const d = (
    await s.db.control.query(
      "SELECT * FROM invitation_deliveries WHERE invite_id=$1",
      [i.id],
    )
  ).rows[0];
  assert.equal(d.state, "failed");
  assert.equal(d.last_error, "MAIL_UNAVAILABLE");
  assert.equal(d.lease_id, null);
  assert.equal(
    (await call(o, "POST", w.base + `/invites/${i.id}/resend`, { version: 1 }))
      .status,
    200,
  );
  const fresh = (
    await s.db.control.query(
      "SELECT * FROM invitation_deliveries WHERE invite_id=$1",
      [i.id],
    )
  ).rows[0];
  assert.equal(fresh.attempts, 0);
  assert.equal(fresh.state, "queued");
  assert.equal(fresh.version, 2);
});

test("unused older invitations cannot bypass member removal through either member-management endpoint", async () => {
  const o = await user(),
    r = await user(),
    w = await workspace(o);
  const first = await invite(o, w, r),
    duplicate = await invite(o, w, r);
  const joined = await accept(r, first);
  assert.equal(joined.status, 201);
  assert.equal((await accept(r, duplicate)).status, 409);
  const activePending = await invite(o, w, r);
  assert.equal(
    (
      await call(o, "DELETE", "/v1/members/" + joined.data.id, undefined, {
        tenant: w.tenant.id,
      })
    ).status,
    200,
  );
  assert.equal((await accept(r, activePending)).status, 409);
  assert.equal((await call(r, "GET", w.base + "/projects")).status, 404);
  const fresh = await invite(o, w, r),
    rejoined = await accept(r, fresh);
  assert.equal(rejoined.status, 201);
  const beforeLegacyRemoval = await invite(o, w, r);
  assert.equal(
    (
      await call(o, "PATCH", w.base + "/members/" + r.id, {
        role: "member",
        status: "removed",
        version: rejoined.data.auth_version,
        project_ids: [],
      })
    ).status,
    200,
  );
  assert.equal((await accept(r, beforeLegacyRemoval)).status, 409);
  const deliveries = (
    await s.db.control.query(
      "SELECT token_cipher,state FROM invitation_deliveries WHERE invite_id=ANY($1::uuid[])",
      [[duplicate.id, activePending.id, beforeLegacyRemoval.id]],
    )
  ).rows;
  assert.ok(
    deliveries.every((d) => d.token_cipher === null && d.state === "cancelled"),
  );
});
