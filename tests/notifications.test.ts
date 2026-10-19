import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { RetentionService } from "../src/retention.js";
let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  k: string = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: "http://localhost:4317",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      "idempotency-key": k,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(
  c: Client,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  k?: string,
) {
  const r = await call(c, method, url, body, tenant, k);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const challenge = await call(undefined, "POST", "/v1/auth/challenge", {
      email: `notice-${randomUUID()}@example.invalid`,
    }),
    mail = JSON.parse(
      await readFile(
        `${s.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`,
        "utf8",
      ),
    );
  const r = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(r.status, 200);
  return {
    id: r.data.user.id,
    csrf: r.data.csrf_token,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
  };
}
async function fixture() {
  const owner = await user(),
    member = await user(),
    w = await ok(owner, "POST", "/v1/tenants", {
      name: "Notification studio",
      project_name: "First project",
    }),
    tenant = w.tenant.id,
    project = w.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [tenant, member.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, member.id],
  );
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=1000000000 WHERE tenant_id=$1",
    [tenant],
  );
  const agent = await ok(owner, "POST", base + "/agents", {
      name: "Engineer",
      role_key: "fullstack",
    }),
    conv = await ok(owner, "POST", base + "/conversations", {
      name: "Private work",
      agent_id: agent.id,
    });
  const response = await ok(
    owner,
    "POST",
    base + `/conversations/${conv.id}/messages`,
    {
      client_message_id: randomUUID(),
      expected_version: 1,
      intent: "delegate",
      mode: "execute",
      body: "Read the current project files.",
      budget_micros: 1000000,
    },
  );
  return { owner, member, tenant, project, base, conv, task: response.task };
}
class ControlledRuntime extends CodexRuntimeAdapter {
  constructor(private unknown = false) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    await ctx.onEvent("message.delta", { text: "Controlled fixture answer" });
    return {
      status: "completed",
      text: "Controlled fixture answer",
      inputTokens: 10,
      outputTokens: 5,
      usageKnown: !this.unknown,
      accepted: true,
      thread: "notice-test",
      turn: "notice-test",
    };
  }
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
  s = await buildApp(
    loadConfig({
      ...env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
      DATA_DIR: ".data/test",
      AI_BASE_URL: "http://127.0.0.1:9/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "controlled-fixture",
      AI_MODEL: "controlled-fixture",
      AI_VERIFIED: "true",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
    }),
    { worker: false },
  );
});
after(async () => {
  if (s) await s.app.close();
});
test("worker notifications persist with exact task/conversation identity, deduplicate heartbeats and isolate recipients", async () => {
  const f = await fixture();
  await new Worker(s.db, s.catalog, s.storage, new ControlledRuntime()).run(
    f.tenant,
    f.task.id,
  );
  const first = await ok(
    f.owner,
    "GET",
    "/v1/notifications",
    undefined,
    f.tenant,
  );
  assert.deepEqual(first.items.map((n: any) => n.kind).sort(), [
    "running",
    "succeeded",
  ]);
  assert.equal(first.next_cursor, null);
  assert.ok(first.items.every((n: any) => n.task_title === "Private work"));
  assert.ok(
    first.items.every(
      (n: any) =>
        n.task_id === f.task.id && n.conversation_id === f.conv.id && !n.read,
    ),
  );
  await s.db.control.query(
    "UPDATE tasks SET lease_until=NULL,version=version+1 WHERE id=$1",
    [f.task.id],
  );
  assert.equal(
    (await ok(f.owner, "GET", `/v1/tenants/${f.tenant}/notifications`)).items
      .length,
    2,
  );
  assert.equal(
    (await ok(f.member, "GET", "/v1/notifications", undefined, f.tenant)).items
      .length,
    0,
  );
  assert.equal(
    (
      await call(
        f.member,
        "PATCH",
        "/v1/notifications/" + first.items[0].id,
        { read: true },
        f.tenant,
      )
    ).status,
    404,
  );
  const other = await user(),
    w = await ok(other, "POST", "/v1/tenants", {
      name: "Other",
      project_name: "Other",
    });
  assert.equal(
    (
      await call(
        other,
        "PATCH",
        "/v1/notifications/" + first.items[0].id,
        { read: true },
        w.tenant.id,
      )
    ).status,
    404,
  );
  const id = first.items[0].id,
    key = randomUUID();
  await ok(
    f.owner,
    "PATCH",
    "/v1/notifications/" + id,
    { read: true },
    f.tenant,
    key,
  );
  await ok(
    f.owner,
    "PATCH",
    "/v1/notifications/" + id,
    { read: true },
    f.tenant,
    key,
  );
  assert.equal(
    (
      await ok(
        f.owner,
        "GET",
        "/v1/notifications?unread=true",
        undefined,
        f.tenant,
      )
    ).items.length,
    1,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "PATCH",
        "/v1/notifications/" + id,
        { read: true, recipient_id: f.member.id },
        f.tenant,
      )
    ).status,
    400,
  );
});
test("unknown usage only emits reconciling rather than a false successful-completion notification", async () => {
  const f = await fixture();
  await new Worker(s.db, s.catalog, s.storage, new ControlledRuntime(true)).run(
    f.tenant,
    f.task.id,
  );
  const items = (
    await ok(f.owner, "GET", "/v1/notifications", undefined, f.tenant)
  ).items;
  assert.deepEqual(items.map((n: any) => n.kind).sort(), [
    "reconciling",
    "running",
  ]);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].status,
    "reconciling",
  );
});
test("notification pagination preserves PostgreSQL microseconds; deletion, quarantine and expired rows cannot retain access", async () => {
  const f = await fixture();
  // Synthetic historical notification fixtures exercise same-millisecond pages;
  // these are not claimed as real task execution attempts.
  await s.db.control.query(
    `INSERT INTO notifications(tenant_id,project_id,recipient_id,task_id,conversation_id,kind,attempt,created_at)
  SELECT $1,$2,$3,$4,$5,'failed',i,now()-interval '1 hour'+i*interval '1 microsecond' FROM generate_series(1,55) i`,
    [f.tenant, f.project, f.owner.id, f.task.id, f.conv.id],
  );
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await ok(
      f.owner,
      "GET",
      "/v1/notifications?limit=7" + (cursor ? "&cursor=" + cursor : ""),
      undefined,
      f.tenant,
    );
    ids.push(...page.items.map((n: any) => n.id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(ids.length, 55);
  assert.equal(new Set(ids).size, 55);
  await s.db.control.query(
    "UPDATE tasks SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [f.task.id],
  );
  assert.equal(
    (await ok(f.owner, "GET", "/v1/notifications", undefined, f.tenant)).items
      .length,
    0,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "PATCH",
        "/v1/notifications/" + ids[0],
        { read: true },
        f.tenant,
      )
    ).status,
    404,
  );
  await s.db.control.query(
    "UPDATE tasks SET content_state='active',moderation_version=moderation_version+1 WHERE id=$1",
    [f.task.id],
  );
  await s.db.control.query(
    "UPDATE notifications SET created_at=now()-interval '31 days' WHERE id=$1",
    [ids[0]],
  );
  await new RetentionService(s.db, s.storage).expireContent(100);
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        "/v1/notifications?cursor=" + ids[0],
        undefined,
        f.tenant,
      )
    ).status,
    410,
  );
  await s.db.control.query(
    "UPDATE tasks SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1",
    [f.task.id],
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM notifications WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].n,
    0,
  );
});
test("revoked project and tenant membership remove notifications immediately, even for their original recipient", async () => {
  const f = await fixture();
  const t = await ok(f.member, "POST", f.base + "/tasks", {
    title: "Member work",
    prompt: "Read authorized project files.",
    role_key: "fullstack",
    budget_micros: 1000000,
  });
  await new Worker(s.db, s.catalog, s.storage, new ControlledRuntime()).run(
    f.tenant,
    t.id,
  );
  const items = (
    await ok(f.member, "GET", "/v1/notifications", undefined, f.tenant)
  ).items;
  assert.equal(items.length, 2);
  assert.ok(items.every((n: any) => !n.conversation_id));
  await s.db.control.query(
    "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
    [f.project, f.member.id],
  );
  assert.equal(
    (await ok(f.member, "GET", "/v1/notifications", undefined, f.tenant)).items
      .length,
    0,
  );
  assert.equal(
    (
      await call(
        f.member,
        "PATCH",
        "/v1/notifications/" + items[0].id,
        { read: true },
        f.tenant,
      )
    ).status,
    404,
  );
  await s.db.control.query(
    "UPDATE memberships SET status='removed',version=version+1 WHERE tenant_id=$1 AND user_id=$2",
    [f.tenant, f.member.id],
  );
  assert.equal(
    (await call(f.member, "GET", "/v1/notifications", undefined, f.tenant))
      .status,
    404,
  );
});
