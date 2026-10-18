import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { Worker } from "../src/worker.js";
import { projectAccess } from "../src/access.js";
import { resolveWorkContext } from "../src/persistent-work.js";
import type { Principal } from "../src/auth.js";
import * as OTPAuth from "otpauth";
import { seal } from "../src/lib.js";
let system: Awaited<ReturnType<typeof buildApp>>;
interface Client {
  cookie: string;
  csrf: string;
  id: string;
  email: string;
  admin?: boolean;
}
const origin = "http://localhost:4317";
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  payload?: unknown,
  idempotency = randomUUID(),
) {
  const raw = await system.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? "http://localhost:4318" : origin,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": idempotency,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  let data: any;
  try {
    data = raw.json();
  } catch {
    data = raw.body;
  }
  return { status: raw.statusCode, data, raw };
}
async function ok(c: Client, method: string, url: string, body?: unknown) {
  const r = await call(c, method, url, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const email = `persistent-${randomUUID()}@example.invalid`;
  const challenge = await call(undefined, "POST", "/v1/auth/challenge", {
    email,
  });
  const mail = JSON.parse(
    await readFile(
      `${system.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const response = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return {
    id: response.data.user.id,
    email,
    csrf: response.data.csrf_token,
    cookie: response.raw.cookies[0].name + "=" + response.raw.cookies[0].value,
  };
}
async function operator(role: string, tenant?: string): Promise<Client> {
  const email = `persistent-admin-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  const p = (
    await system.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
      [email, role, seal(system.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, tenant ? "tenant" : "global", tenant ?? null],
  );
  const challenge = await call(undefined, "POST", "/v1/admin/auth/challenge", {
    email,
  });
  const mail = JSON.parse(
    await readFile(
      `${system.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const response = await call(undefined, "POST", "/v1/admin/auth/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    totp: new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return {
    id: p.id,
    email,
    csrf: response.data.csrf_token,
    cookie: response.raw.cookies[0].name + "=" + response.raw.cookies[0].value,
    admin: true,
  };
}
const principal = (u: Client): Principal => ({
  id: u.id,
  email: u.email,
  name: u.email,
  audience: "user",
  authVersion: 1,
  sessionId: "",
  sessionHash: "",
});
async function fixture() {
  const owner = await user(),
    member = await user();
  const w = await ok(owner, "POST", "/v1/tenants", {
    name: "Persistent fixture",
    project_name: "Private campaign",
  });
  const tenant = w.tenant.id,
    project = w.project.id;
  await system.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [tenant, member.id],
  );
  await system.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, member.id],
  );
  // Explicit test credit only; this fixture is not recorded as a real customer payment.
  await system.db.control.query(
    "UPDATE wallets SET credit_limit_micros=1000000000 WHERE tenant_id=$1",
    [tenant],
  );
  const base = `/v1/tenants/${tenant}/projects/${project}`;
  const definition = {
    name: "Campaign analyst",
    role_key: "marketing-analyst",
    instructions: "Use verified metrics and preserve the requested language.",
  };
  const agent = await ok(owner, "POST", base + "/agents", definition);
  const conversation = await ok(owner, "POST", base + "/conversations", {
    name: "Autumn analysis",
    agent_id: agent.id,
  });
  return {
    owner,
    member,
    tenant,
    project,
    base,
    agent,
    conversation,
    definition,
  };
}
class ControlledRuntime extends CodexRuntimeAdapter {
  calls: RuntimeContext[] = [];
  constructor(private act?: (ctx: RuntimeContext) => Promise<void>) {
    super(system.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls.push(ctx);
    await this.act?.(ctx);
    return {
      text: "Controlled worker fixture answer.",
      inputTokens: 10,
      outputTokens: 5,
      usageKnown: true,
      accepted: true,
      thread: "fixture-thread",
      turn: "fixture-turn",
      status: "completed",
    };
  }
}
function runner(runtime: ControlledRuntime) {
  return new Worker(system.db, system.catalog, system.storage, runtime);
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
  system = await buildApp(
    loadConfig({
      ...env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DATA_DIR: ".data/test",
      AI_BASE_URL: "http://127.0.0.1:9/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "controlled-test-provider-not-a-real-key",
      AI_MODEL: "controlled-fixture",
      AI_VERIFIED: "true",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
    }),
    { worker: false },
  );
});
after(async () => {
  if (system) await system.app.close();
});

test("persistent specialists freeze versions, reject enlarged tools and require CAS editing authority", async () => {
  const f = await fixture();
  const next = await ok(f.owner, "PATCH", f.base + "/agents/" + f.agent.id, {
    ...f.definition,
    expected_version: 1,
    instructions: "Use the new workflow.",
  });
  assert.equal(next.version, 2);
  const versions = await ok(
    f.member,
    "GET",
    f.base + "/agents/" + f.agent.id + "/versions",
  );
  assert.equal(versions.items.length, 2);
  assert.equal(versions.items[1].body.instructions, f.definition.instructions);
  assert.equal(
    (
      await call(f.owner, "PATCH", f.base + "/agents/" + f.agent.id, {
        ...f.definition,
        expected_version: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(f.member, "PATCH", f.base + "/agents/" + f.agent.id, {
        ...f.definition,
        expected_version: 2,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(f.owner, "POST", f.base + "/agents", {
        ...f.definition,
        tool_ids: ["shell.unrestricted"],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(f.owner, "POST", f.base + "/agents", {
        ...f.definition,
        kernel: "other",
      })
    ).status,
    400,
  );
  const pinned = await ok(
    f.owner,
    "GET",
    f.base + "/conversations/" + f.conversation.id,
  );
  assert.equal(pinned.agent_version, 1);
});

test("private conversation delegation deduplicates concurrent messages and reserves only one task", async () => {
  const f = await fixture();
  const message = {
    client_message_id: randomUUID(),
    expected_version: 1,
    intent: "delegate",
    body: "Analyse the approved campaign data.",
    budget_micros: 1_000_000,
    mode: "ask",
  };
  const results = await Promise.all([
    call(
      f.owner,
      "POST",
      `${f.base}/conversations/${f.conversation.id}/messages`,
      message,
    ),
    call(
      f.owner,
      "POST",
      `${f.base}/conversations/${f.conversation.id}/messages`,
      message,
    ),
  ]);
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(results[0].data.task.id, results[1].data.task.id);
  const task = results[0].data.task;
  assert.equal(task.private_owner, f.owner.id);
  assert.equal(task.input_context.agent_version, 1);
  const detached = await call(f.owner, "POST", f.base + "/tasks", {
    title: "Continue privately",
    prompt: "Continue the analysis from this original task.",
    role_key: "marketing-analyst",
    budget_micros: 1_000_000,
    mode: "ask",
    parent_id: task.id,
  });
  assert.equal(detached.status, 409, JSON.stringify(detached.data));
  assert.equal(detached.data.error.code, "CONVERSATION_CONTEXT_REQUIRED");
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [task.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        `${f.base}/conversations/${f.conversation.id}/messages`,
        { ...message, body: "Changed input under the same message ID" },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        `${f.base}/conversations/${f.conversation.id}/messages`,
        { ...message, client_message_id: randomUUID(), expected_version: 2 },
      )
    ).data.error.code,
    "CONVERSATION_BUSY",
  );
  assert.equal(
    (
      await call(
        f.member,
        "GET",
        `${f.base}/conversations/${f.conversation.id}`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await ok(f.member, "GET", f.base + "/conversations")).items.length,
    0,
  );
  assert.equal(
    (await call(f.member, "GET", f.base + "/tasks/" + task.id)).status,
    404,
  );
  assert.equal((await ok(f.member, "GET", f.base + "/tasks")).items.length, 0);
  assert.equal(
    (await call(f.member, "GET", f.base + "/tasks/" + task.id + "/events"))
      .status,
    404,
  );
  await system.db.tx(async (tx) => {
    await projectAccess(tx, principal(f.member), f.tenant, f.project);
    assert.equal(
      (await tx.query("SELECT id FROM tasks WHERE id=$1", [task.id])).rowCount,
      0,
    );
    assert.equal(
      (
        await tx.query("SELECT id FROM conversations WHERE id=$1", [
          f.conversation.id,
        ])
      ).rowCount,
      0,
    );
  }, f.tenant);
});

test("memory scopes and immutable versions apply to worker input; deletion stops subsequent tools", async () => {
  const f = await fixture();
  const projectMemory = await ok(f.owner, "POST", f.base + "/memories", {
    name: "Tone",
    scope: "project",
    content: "Original approved wording",
  });
  const personal = await ok(f.owner, "POST", f.base + "/memories", {
    name: "Personal preference",
    scope: "personal",
    content: "Private author preference",
  });
  await ok(f.owner, "POST", f.base + "/memories", {
    name: "Workspace terms",
    scope: "tenant",
    content: "Use HKD",
  });
  await ok(f.owner, "POST", f.base + "/memories", {
    name: "Conversation preference",
    scope: "conversation",
    conversation_id: f.conversation.id,
    content: "This private conversation only",
  });
  const visible = await ok(f.member, "GET", f.base + "/memories");
  assert.equal(visible.items.length, 2);
  assert.ok(!visible.items.some((m: any) => m.id === personal.id));
  assert.equal(
    (
      await call(f.member, "POST", f.base + "/memories", {
        name: "Unauthorized rules",
        scope: "tenant",
        content: "Must be denied",
      })
    ).status,
    403,
  );
  const sent = await ok(
    f.owner,
    "POST",
    `${f.base}/conversations/${f.conversation.id}/messages`,
    {
      client_message_id: randomUUID(),
      expected_version: 1,
      intent: "delegate",
      mode: "ask",
      body: "Apply the approved campaign instructions.",
      budget_micros: 1_000_000,
    },
  );
  await ok(f.owner, "PATCH", f.base + "/memories/" + projectMemory.id, {
    expected_version: 1,
    name: "Tone",
    scope: "project",
    content: "Changed after task acceptance",
  });
  const runtime = new ControlledRuntime(async (ctx) => {
    assert.match(ctx.prompt, /Original approved wording/);
    assert.doesNotMatch(ctx.prompt, /Changed after task acceptance/);
    assert.ok(
      !ctx.tools.some((t) =>
        [
          "deliver_text",
          "image2_generate",
          "design_render",
          "code_write",
        ].includes(t.name),
      ),
    );
    await ok(f.owner, "DELETE", f.base + "/memories/" + personal.id, {
      expected_version: 1,
    });
    const read = ctx.tools.find((t) => t.name === "project_assets")!;
    await assert.rejects(
      read.run({}, randomUUID()),
      (e: any) => e.code === "CONTEXT_REVOKED",
    );
  });
  await runner(runtime).run(f.tenant, sent.task.id);
  assert.equal(runtime.calls.length, 1);
  const finished = await ok(f.owner, "GET", f.base + "/tasks/" + sent.task.id);
  assert.equal(finished.status, "cancelled");
  assert.equal(finished.output, "");
  assert.equal(finished.error_code, "CONTEXT_REVOKED");
  assert.equal(
    (
      await system.db.control.query(
        "SELECT content FROM memory_versions WHERE memory_id=$1",
        [personal.id],
      )
    ).rows[0].content,
    null,
  );
});

test("private tool artifacts cannot be read or rendered by another member and publication copies only the selected file", async () => {
  const f = await fixture();
  const sent = await ok(
    f.owner,
    "POST",
    `${f.base}/conversations/${f.conversation.id}/messages`,
    {
      client_message_id: randomUUID(),
      expected_version: 1,
      intent: "delegate",
      mode: "execute",
      body: "Deliver an approved text report.",
      budget_micros: 1_000_000,
    },
  );
  let asset: any;
  await runner(
    new ControlledRuntime(async (ctx) => {
      asset = await ctx.tools
        .find((t) => t.name === "deliver_text")!
        .run(
          {
            filename: "report.txt",
            content: "Private report body",
            mime_type: "text/plain",
          },
          randomUUID(),
        );
    }),
  ).run(f.tenant, sent.task.id);
  assert.equal(asset.private_owner, f.owner.id);
  assert.equal(
    (await call(f.member, "GET", `${f.base}/assets/${asset.id}/download`))
      .status,
    404,
  );
  assert.equal(
    (await call(f.member, "GET", `${f.base}/assets/${asset.id}/versions`))
      .status,
    404,
  );
  assert.equal((await ok(f.member, "GET", f.base + "/assets")).items.length, 0);
  assert.equal(
    (await call(f.owner, "POST", `${f.base}/assets/${asset.id}/shares`, {}))
      .status,
    404,
  );
  const key = randomUUID();
  const body = { name: "Approved public report", expected_version: 1 };
  const one = await call(
    f.owner,
    "POST",
    `${f.base}/assets/${asset.id}/publish`,
    body,
    key,
  );
  const two = await call(
    f.owner,
    "POST",
    `${f.base}/assets/${asset.id}/publish`,
    body,
    key,
  );
  assert.equal(one.status, 200, JSON.stringify(one.data));
  assert.equal(one.data.id, two.data.id);
  assert.equal(one.data.private_owner, null);
  const download = await call(
    f.member,
    "GET",
    `${f.base}/assets/${one.data.id}/download`,
  );
  assert.equal(download.status, 200);
  assert.equal(download.data, "Private report body");
  const deleted = await call(
    f.owner,
    "DELETE",
    `${f.base}/conversations/${f.conversation.id}`,
    { expected_version: 3 },
  );
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/assets/${asset.id}/download`))
      .status,
    404,
  );
  assert.equal(
    (await call(f.member, "GET", `${f.base}/assets/${one.data.id}/download`))
      .status,
    200,
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT prompt,output FROM tasks WHERE id=$1",
        [sent.task.id],
      )
    ).rows[0].prompt,
    "[deleted]",
  );
});

test("archive preserves in-flight work; deleting active conversations fails, notes and titles use version checks", async () => {
  const f = await fixture();
  const sent = await ok(
    f.owner,
    "POST",
    `${f.base}/conversations/${f.conversation.id}/messages`,
    {
      client_message_id: randomUUID(),
      expected_version: 1,
      intent: "delegate",
      mode: "ask",
      body: "Read and discuss campaign scope.",
      budget_micros: 1_000_000,
    },
  );
  const archived = await ok(
    f.owner,
    "PATCH",
    `${f.base}/conversations/${f.conversation.id}`,
    {
      expected_version: 2,
      archived: true,
      pinned: true,
      name: "Archived campaign",
    },
  );
  assert.equal(
    (
      await ok(
        f.owner,
        "GET",
        f.base + "/conversations?archived=true&q=campaign",
      )
    ).items.length,
    1,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "DELETE",
        `${f.base}/conversations/${f.conversation.id}`,
        { expected_version: archived.version },
      )
    ).data.error.code,
    "ACTIVE_TASKS",
  );
  await runner(new ControlledRuntime()).run(f.tenant, sent.task.id);
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + sent.task.id)).status,
    "succeeded",
  );
  assert.equal(
    (
      await call(
        f.owner,
        "PATCH",
        `${f.base}/conversations/${f.conversation.id}`,
        { expected_version: 1, name: "Stale edit" },
      )
    ).status,
    409,
  );
  const current = await ok(
    f.owner,
    "GET",
    `${f.base}/conversations/${f.conversation.id}`,
  );
  assert.equal(current.messages.length, 2);
  await ok(f.owner, "DELETE", `${f.base}/conversations/${f.conversation.id}`, {
    expected_version: current.version,
  });
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/conversations/${f.conversation.id}`))
      .status,
    404,
  );
});

test("plan approval rejects changed memory and produces one explicitly approved execution", async () => {
  const f = await fixture();
  const memory = await ok(f.owner, "POST", f.base + "/memories", {
    name: "Brief",
    scope: "project",
    content: "Original brief",
  });
  const sent = await ok(
    f.owner,
    "POST",
    `${f.base}/conversations/${f.conversation.id}/messages`,
    {
      client_message_id: randomUUID(),
      expected_version: 1,
      intent: "delegate",
      mode: "plan",
      body: "Plan the campaign analysis workflow.",
      budget_micros: 1_000_000,
    },
  );
  await runner(
    new ControlledRuntime((ctx) => {
      assert.ok(!ctx.tools.some((t) => t.name === "deliver_text"));
      return Promise.resolve();
    }),
  ).run(f.tenant, sent.task.id);
  const task = await ok(f.owner, "GET", f.base + "/tasks/" + sent.task.id);
  const plan = await ok(f.owner, "GET", f.base + "/tasks/" + task.id + "/plan");
  const approve = {
    expected_task_version: task.version,
    plan_version: plan.version,
    input_hash: plan.input_hash,
    budget_micros: 2_000_000,
  };
  assert.equal(
    (
      await call(
        f.member,
        "POST",
        f.base + "/tasks/" + task.id + "/plan/approve",
        approve,
      )
    ).status,
    404,
  );
  const [a, b] = await Promise.all([
    call(
      f.owner,
      "POST",
      f.base + "/tasks/" + task.id + "/plan/approve",
      approve,
    ),
    call(
      f.owner,
      "POST",
      f.base + "/tasks/" + task.id + "/plan/approve",
      approve,
    ),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.equal(a.data.id, b.data.id);
  assert.equal(a.data.mode, "execute");
  await ok(f.owner, "POST", f.base + "/tasks/" + a.data.id + "/cancel");
  const conv = await ok(
    f.owner,
    "GET",
    `${f.base}/conversations/${f.conversation.id}`,
  );
  const second = await ok(
    f.owner,
    "POST",
    `${f.base}/conversations/${f.conversation.id}/messages`,
    {
      client_message_id: randomUUID(),
      expected_version: conv.version,
      intent: "delegate",
      mode: "plan",
      body: "Plan with the latest approved brief.",
      budget_micros: 1_000_000,
    },
  );
  await runner(new ControlledRuntime()).run(f.tenant, second.task.id);
  const secondTask = await ok(
    f.owner,
    "GET",
    f.base + "/tasks/" + second.task.id,
  );
  const secondPlan = await ok(
    f.owner,
    "GET",
    f.base + "/tasks/" + second.task.id + "/plan",
  );
  await ok(f.owner, "PATCH", f.base + "/memories/" + memory.id, {
    expected_version: 1,
    name: "Brief",
    scope: "project",
    content: "New scope requiring fresh planning",
  });
  const stale = await call(
    f.owner,
    "POST",
    f.base + "/tasks/" + second.task.id + "/plan/approve",
    {
      ...approve,
      expected_task_version: secondTask.version,
      input_hash: secondPlan.input_hash,
    },
  );
  assert.equal(stale.status, 409, JSON.stringify(stale.data));
  assert.equal(stale.data.error.code, "PLAN_STALE");
});

test("expiry, missing brand and revoked project membership cannot be used as frozen context", async () => {
  const f = await fixture();
  assert.equal(
    (
      await call(f.owner, "POST", f.base + "/agents", {
        ...f.definition,
        brand_id: randomUUID(),
      })
    ).status,
    404,
  );
  const m = await ok(f.owner, "POST", f.base + "/memories", {
    name: "Temporary",
    scope: "project",
    content: "Expires before execution",
  });
  const task = await ok(f.owner, "POST", f.base + "/tasks", {
    title: "Expired context",
    prompt: "Review the approved temporary brief.",
    role_key: "marketing-analyst",
    agent_id: f.agent.id,
    mode: "ask",
    budget_micros: 1_000_000,
  });
  await system.db.control.query(
    "UPDATE memories SET expires_at=now()-interval '1 second' WHERE id=$1",
    [m.id],
  );
  const runtime = new ControlledRuntime();
  await runner(runtime).run(f.tenant, task.id);
  assert.equal(runtime.calls.length, 0);
  const current = await ok(f.owner, "GET", f.base + "/tasks/" + task.id);
  assert.equal(current.status, "cancelled");
  await assert.rejects(
    system.db.tx(async (tx) => {
      await projectAccess(tx, principal(f.owner), f.tenant, f.project);
      await resolveWorkContext(
        tx,
        principal(f.owner),
        f.tenant,
        f.project,
        task.input_context,
      );
    }, f.tenant),
    (e: any) => e.code === "CONTEXT_REVOKED",
  );
  const memberConversation = await ok(
    f.member,
    "POST",
    f.base + "/conversations",
    { name: "Member work", agent_id: f.agent.id },
  );
  const queued = await ok(
    f.member,
    "POST",
    `${f.base}/conversations/${memberConversation.id}/messages`,
    {
      client_message_id: randomUUID(),
      expected_version: 1,
      intent: "delegate",
      mode: "ask",
      body: "Review the approved member campaign.",
      budget_micros: 1_000_000,
    },
  );
  await system.db.control.query(
    "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
    [f.project, f.member.id],
  );
  await runner(runtime).run(f.tenant, queued.task.id);
  assert.equal(runtime.calls.length, 0);
  assert.equal(
    (
      await system.db.control.query("SELECT status FROM tasks WHERE id=$1", [
        queued.task.id,
      ])
    ).rows[0].status,
    "cancelled",
  );
  assert.equal(
    (
      await call(
        f.member,
        "GET",
        f.base + "/conversations/" + memberConversation.id,
      )
    ).status,
    404,
  );
});

test("shared tasks cannot read private files even when their owner can; deleted content cannot replay cached responses", async () => {
  const f = await fixture();
  const message = {
    client_message_id: randomUUID(),
    expected_version: 1,
    intent: "delegate",
    mode: "execute",
    body: "Create a confidential report file.",
    budget_micros: 1_000_000,
  };
  const sent = await ok(
    f.owner,
    "POST",
    `${f.base}/conversations/${f.conversation.id}/messages`,
    message,
  );
  let asset: any;
  await runner(
    new ControlledRuntime(async (ctx) => {
      asset = await ctx.tools
        .find((t) => t.name === "deliver_text")!
        .run(
          {
            filename: "private.txt",
            content: "Do not share this report",
            mime_type: "text/plain",
          },
          randomUUID(),
        );
    }),
  ).run(f.tenant, sent.task.id);
  const shared = await ok(f.owner, "POST", f.base + "/tasks", {
    title: "Shared task",
    prompt: "List only project shared files.",
    role_key: "marketing-analyst",
    mode: "ask",
    budget_micros: 1_000_000,
  });
  await runner(
    new ControlledRuntime(async (ctx) => {
      const list: any = await ctx.tools
        .find((t) => t.name === "project_assets")!
        .run({}, randomUUID());
      assert.ok(!list.items.some((a: any) => a.id === asset.id));
      await assert.rejects(
        ctx.tools
          .find((t) => t.name === "asset_text_read")!
          .run({ asset_id: asset.id }, randomUUID()),
      );
    }),
  ).run(f.tenant, shared.id);
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + shared.id)).status,
    "succeeded",
  );
  const c = await ok(
    f.owner,
    "GET",
    `${f.base}/conversations/${f.conversation.id}`,
  );
  await ok(f.owner, "DELETE", `${f.base}/conversations/${f.conversation.id}`, {
    expected_version: c.version,
  });
  const replay = await call(
    f.owner,
    "POST",
    `${f.base}/conversations/${f.conversation.id}/messages`,
    message,
  );
  assert.equal(replay.status, 410, JSON.stringify(replay.data));
  const cached = (
    await system.db.control.query(
      "SELECT response,revoked_at FROM request_replays WHERE actor_id=$1 AND action=$2 AND key=$3",
      [
        f.owner.id,
        `conversation.message:${f.conversation.id}`,
        message.client_message_id,
      ],
    )
  ).rows[0];
  assert.deepEqual(cached.response, {});
  assert.ok(cached.revoked_at);
});

test("a plan becomes stale when a memory is added during planning or a note arrives while it runs", async () => {
  for (const change of ["memory", "note"]) {
    const f = await fixture();
    const sent = await ok(
      f.owner,
      "POST",
      `${f.base}/conversations/${f.conversation.id}/messages`,
      {
        client_message_id: randomUUID(),
        expected_version: 1,
        intent: "delegate",
        mode: "plan",
        body: "Plan the next approved campaign.",
        budget_micros: 1_000_000,
      },
    );
    await runner(
      new ControlledRuntime(async () => {
        if (change === "memory")
          await ok(f.owner, "POST", f.base + "/memories", {
            name: "New constraints",
            scope: "project",
            content: "Added while the old plan was being generated",
          });
        else
          await ok(
            f.owner,
            "POST",
            `${f.base}/conversations/${f.conversation.id}/messages`,
            {
              client_message_id: randomUUID(),
              expected_version: 2,
              intent: "note",
              body: "New requirements for the next approved plan",
            },
          );
      }),
    ).run(f.tenant, sent.task.id);
    const task = await ok(f.owner, "GET", f.base + "/tasks/" + sent.task.id),
      plan = await ok(
        f.owner,
        "GET",
        f.base + "/tasks/" + sent.task.id + "/plan",
      );
    const result = await call(
      f.owner,
      "POST",
      f.base + "/tasks/" + sent.task.id + "/plan/approve",
      {
        expected_task_version: task.version,
        plan_version: plan.version,
        input_hash: plan.input_hash,
        budget_micros: 1_000_000,
      },
    );
    assert.equal(result.status, 409, JSON.stringify(result.data));
    assert.equal(result.data.error.code, "PLAN_STALE");
  }
});

test("admin body access and quarantine apply to private conversations and memories; retries preserve private ownership", async () => {
  const f = await fixture(),
    a = await operator("super_admin", f.tenant),
    outside = await operator("super_admin", randomUUID());
  const sent = await ok(
    f.owner,
    "POST",
    `${f.base}/conversations/${f.conversation.id}/messages`,
    {
      client_message_id: randomUUID(),
      expected_version: 1,
      intent: "delegate",
      mode: "ask",
      body: "A private campaign brief to keep isolated.",
      budget_micros: 1_000_000,
    },
  );
  const body = await ok(
    a,
    "GET",
    "/v1/admin/content/" + f.conversation.id + "/body",
  );
  assert.match(body.text, /private campaign brief/);
  assert.equal(
    (
      await call(
        outside,
        "GET",
        "/v1/admin/content/" + f.conversation.id + "/body",
      )
    ).status,
    403,
  );
  const support = await operator("support_agent", f.tenant);
  assert.equal(
    (
      await call(
        support,
        "GET",
        "/v1/admin/content/" + f.conversation.id + "/body",
      )
    ).status,
    403,
  );
  await runner(
    new ControlledRuntime(async () => {
      throw new Error("Controlled runtime failure before a response");
    }),
  ).run(f.tenant, sent.task.id);
  // Administrative retries retain the original audience, mode and context.
  const retried = await ok(
    a,
    "POST",
    "/v1/admin/execution/" + sent.task.id + "/action",
    {
      action: "retry",
      version: (await ok(f.owner, "GET", f.base + "/tasks/" + sent.task.id))
        .version,
      reason: "Verify privacy-preserving retry",
    },
  );
  const retriedRow = (
    await system.db.control.query(
      "SELECT private_owner,conversation_id,mode,input_context FROM tasks WHERE id=$1",
      [retried.id],
    )
  ).rows[0];
  assert.equal(retriedRow.private_owner, f.owner.id);
  assert.equal(retriedRow.conversation_id, f.conversation.id);
  assert.equal(retriedRow.mode, "ask");
  assert.equal(retriedRow.input_context.agent_id, f.agent.id);
  assert.equal(
    (await call(f.member, "GET", f.base + "/tasks/" + retried.id)).status,
    404,
  );
  await ok(a, "POST", "/v1/admin/content/" + f.conversation.id + "/action", {
    action: "quarantine",
    version: 1,
    reason: "Quarantine private content fixture",
  });
  const runtime = new ControlledRuntime();
  await runner(runtime).run(f.tenant, retried.id);
  assert.equal(runtime.calls.length, 0);
  assert.equal(
    (await call(f.owner, "GET", f.base + "/conversations/" + f.conversation.id))
      .status,
    404,
  );
  const memory = await ok(f.owner, "POST", f.base + "/memories", {
    name: "Private instruction",
    scope: "personal",
    content: "Erase all versions of this private instruction",
  });
  await ok(a, "POST", "/v1/admin/content/" + memory.id + "/action", {
    action: "delete",
    version: 1,
    reason: "Erase private memory fixture",
  });
  assert.equal(
    (
      await system.db.control.query(
        "SELECT content FROM memory_versions WHERE memory_id=$1",
        [memory.id],
      )
    ).rows[0].content,
    null,
  );
});
