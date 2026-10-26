import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const origin = "http://localhost:4310",
  web = "http://localhost:4317";
type Client = { cookies: Map<string, string>; csrf: string };
const clients: Client[] = [],
  samples: unknown[] = [],
  checks: { name: string; status: string }[] = [],
  errors: string[] = [];
function client() {
  const c = { cookies: new Map<string, string>(), csrf: "" };
  clients.push(c);
  return c;
}
async function call(
  c: Client,
  method: string,
  endpoint: string,
  body?: unknown,
  tenant?: string,
  key = randomUUID(),
) {
  const r = await fetch(origin + endpoint, {
    method,
    headers: {
      Origin: web,
      "Idempotency-Key": key,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(tenant ? { "X-Tenant-ID": tenant } : {}),
      ...(c.csrf ? { "X-CSRF-Token": c.csrf } : {}),
      ...(c.cookies.size
        ? { Cookie: [...c.cookies].map(([k, v]) => k + "=" + v).join("; ") }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  for (const cookie of r.headers.getSetCookie()) {
    const [pair] = cookie.split(";"),
      split = pair.indexOf("="),
      k = pair.slice(0, split),
      v = pair.slice(split + 1);
    if (/max-age=0(?:;|$)/i.test(cookie)) c.cookies.delete(k);
    else c.cookies.set(k, v);
  }
  return { status: r.status, data: await r.json() };
}
async function mailbox(id: string) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try {
      return JSON.parse(
        await readFile(
          path.resolve("../copypaste-platform/.data/mailbox", id + ".json"),
          "utf8",
        ),
      );
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("Owned mailbox delivery did not arrive");
}
async function login(c: Client, email: string) {
  const ch = await call(c, "POST", "/v1/auth/challenges", { email });
  assert.equal(ch.status, 202);
  const mail = await mailbox(ch.data.challenge_id);
  assert.equal(mail.to, email);
  const s = await call(c, "POST", "/v1/auth/sessions", {
    challenge_id: ch.data.challenge_id,
    code: mail.text.match(/code is (\d{6})/)[1],
  });
  assert.equal(s.status, 201);
  const context = await call(c, "GET", "/v1/session/context");
  assert.equal(context.status, 200);
  c.csrf = context.data.csrf_token;
  return context.data.user;
}
function pass(name: string) {
  checks.push({ name, status: "passed" });
}
function sample(
  name: string,
  operation: string,
  schema: string,
  r: { status: number; data: unknown },
) {
  samples.push({ name, operation, schema, status: r.status, response: r.data });
}
try {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  const owner = client(),
    recipient = client();
  await login(owner, `wire-owner-${randomUUID()}@example.invalid`);
  const member = await login(
    recipient,
    `wire-member-${randomUUID()}@example.invalid`,
  );
  pass(
    "current canonical 202/201 email flows establish two independent real HTTP sessions",
  );
  const created = await call(owner, "POST", "/v1/tenants", {
    name: "Synthetic HTTP invitation workspace",
    project_name: "Current source wire checks",
  });
  assert.equal(created.status, 200);
  const tenant = created.data.tenant.id,
    base = `/v1/tenants/${tenant}`;
  const invitationBody = {
      email: member.email,
      role: "viewer",
      project_ids: [created.data.project.id],
    },
    createKey = randomUUID();
  const invitation = await call(
    owner,
    "POST",
    base + "/invites",
    invitationBody,
    tenant,
    createKey,
  );
  assert.equal(invitation.status, 201);
  assert.equal(invitation.data.invite_url, undefined);
  sample(
    "invitation-create",
    "POST /v1/tenants/{tenant_id}/invites",
    "Invite",
    invitation,
  );
  const repeated = await call(
    owner,
    "POST",
    base + "/invites",
    invitationBody,
    tenant,
    createKey,
  );
  assert.equal(repeated.status, 201);
  assert.equal(repeated.data.id, invitation.data.id);
  const mail = await mailbox(invitation.data.id);
  assert.equal(mail.to, member.email);
  const token = new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get(
      "token",
    ),
    acceptKey = randomUUID();
  pass(
    "current 201 Invite has no delivery credential; same-key retry preserves its ID and the worker delivers its own mailbox message",
  );
  const accepted = await call(
    recipient,
    "POST",
    "/v1/invites/accept",
    { token },
    undefined,
    acceptKey,
  );
  assert.equal(accepted.status, 201);
  assert.equal(accepted.data.role, "viewer");
  assert.equal(accepted.data.user_id, member.id);
  sample("invitation-accept", "POST /v1/invites/accept", "Member", accepted);
  assert.deepEqual(
    (
      await call(
        recipient,
        "POST",
        "/v1/invites/accept",
        { token },
        undefined,
        acceptKey,
      )
    ).data,
    accepted.data,
  );
  pass(
    "current canonical 201 Member and a repeated acceptance recover the same single viewer grant",
  );
  const list = await call(owner, "GET", base + "/members", undefined, tenant);
  assert.equal(list.status, 200);
  assert.ok(list.data.items.some((m: any) => m.id === accepted.data.id));
  assert.equal(list.data.next_cursor, null);
  sample(
    "members-list",
    "GET /v1/tenants/{tenant_id}/members",
    "MemberList",
    list,
  );
  assert.equal(
    (
      await call(
        recipient,
        "GET",
        base + "/member-directory",
        undefined,
        tenant,
      )
    ).status,
    403,
  );
  pass(
    "canonical member list uses member IDs and cursor fields; the real viewer session cannot read the management directory",
  );
  const removed = await call(
    owner,
    "DELETE",
    "/v1/members/" + accepted.data.id,
    undefined,
    tenant,
  );
  assert.equal(removed.status, 200);
  sample("member-remove", "DELETE /v1/members/{member_id}", "Ack", removed);
  assert.equal((await call(recipient, "GET", base + "/projects")).status, 404);
  assert.equal(
    (
      await call(
        recipient,
        "POST",
        "/v1/invites/accept",
        { token },
        undefined,
        acceptKey,
      )
    ).data.error.code,
    "MEMBERSHIP_CHANGED",
  );
  pass(
    "canonical removal immediately denies the existing recipient session and an old successful acceptance cannot restore access",
  );
} catch (e) {
  errors.push(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  for (const c of clients)
    if (c.csrf) {
      try {
        const r = await call(c, "DELETE", "/v1/auth/session");
        assert.equal(r.status, 200);
      } catch {
        errors.push("Owned HTTP session cleanup failed");
      }
    }
  await writeFile(
    "evidence/membership-wire.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope:
          "Real HTTP requests against current source with synthetic email identities; no browser or native UI acceptance claim",
        model_calls: 0,
        checks,
        errors,
        owned_sessions_closed: errors.every(
          (e) => e !== "Owned HTTP session cleanup failed",
        ),
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/membership-contract-samples.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin,
        scope:
          "Current source real HTTP canonical response shapes using synthetic accounts only",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ checks: checks.length, errors }));
  if (errors.length) process.exitCode = 1;
}
