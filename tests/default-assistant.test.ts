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
let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  key = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: "http://localhost:4317",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      "idempotency-key": key,
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
  tenant?: string,
) {
  const r = await call(c, method, url, body, tenant);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", {
    email: `default-${randomUUID()}@example.invalid`,
  });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: ch.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(r.status, 200);
  return {
    id: r.data.user.id,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
    csrf: r.data.csrf_token,
  };
}
async function fixture(credit = true) {
  const owner = await user(),
    member = await user(),
    created = await ok(owner, "POST", "/v1/tenants", {
      name: "Default assistant studio",
      project_name: "Unconfigured project",
    });
  const tenant = created.tenant.id,
    project = created.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [tenant, member.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, member.id],
  );
  if (credit)
    await s.db.control.query(
      "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
      [tenant],
    );
  return { owner, member, tenant, project, base };
}
const brief = (extra: Record<string, unknown> = {}) => ({
  title: "Launch brief",
  prompt: "Write a campaign plan from the information I provide.",
  mode: "execute",
  budget_micros: 1000000,
  client_message_id: randomUUID(),
  ...extra,
});
class ControlledRuntime extends CodexRuntimeAdapter {
  constructor(private write = true) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    const names = ctx.tools.map((t) => t.name);
    assert.ok(names.includes("project_assets"));
    assert.ok(!names.includes("image2_generate"));
    assert.ok(!names.includes("code_write"));
    if (this.write) {
      assert.ok(names.includes("deliver_text"));
      await ctx.tools
        .find((t) => t.name === "deliver_text")!
        .run(
          {
            filename: "campaign-plan.md",
            content:
              "# Controlled test plan\nExplicitly synthetic task result.",
            mime_type: "text/markdown",
          },
          randomUUID(),
        );
    } else assert.ok(!names.includes("deliver_text"));
    return {
      status: "completed",
      text: "Explicitly synthetic answer.",
      inputTokens: 20,
      outputTokens: 10,
      usageKnown: true,
      accepted: true,
      thread: "default-fixture",
      turn: "default-fixture",
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
test("an unconfigured project starts private conversations without a customer-created specialist and races create only one immutable default", async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([
    ok(f.owner, "POST", f.base + "/conversations", {
      name: "Owner conversation",
    }),
    ok(f.member, "POST", f.base + "/conversations", {
      name: "Member conversation",
    }),
  ]);
  assert.equal(a.agent_id, b.agent_id);
  assert.equal(a.agent_version, 1);
  assert.notEqual(a.id, b.id);
  assert.equal(
    (await call(f.owner, "GET", f.base + "/conversations/" + b.id)).status,
    404,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM agents WHERE project_id=$1 AND builtin_default",
        [f.project],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM tasks WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    0,
  );
  const info = await ok(undefined, "GET", "/v1/catalog/default-assistant");
  assert.equal(info.role_key, "assistant");
  assert.equal(info.runtime_profile, "codex-internal-v1");
  assert.equal(
    (await ok(undefined, "GET", "/v1/catalog/roles")).items.length,
    18,
    "the default assistant must not inflate the professional role count",
  );
});
test("one-action default delegation atomically binds a private conversation, message, task, method and budget, including duplicate retries", async () => {
  const f = await fixture(),
    body = brief();
  const [a, b] = await Promise.all([
    ok(f.owner, "POST", f.base + "/delegations", body),
    ok(f.owner, "POST", f.base + "/delegations", body),
  ]);
  assert.equal(a.task.id, b.task.id);
  assert.equal(a.conversation.id, b.conversation.id);
  assert.equal(a.message.id, b.message.id);
  assert.equal(a.task.conversation_id, a.conversation.id);
  assert.equal(a.task.private_owner, f.owner.id);
  assert.equal(a.task.role_key, "assistant");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [a.task.id],
      )
    ).rows[0].n,
    1,
  );
  await new Worker(s.db, s.catalog, s.storage, new ControlledRuntime()).run(
    f.tenant,
    a.task.id,
  );
  const task = await ok(f.owner, "GET", f.base + "/tasks/" + a.task.id);
  assert.equal(task.status, "succeeded", JSON.stringify(task));
  assert.equal(Number(task.charged_micros), 30);
  assert.equal(
    (await call(f.member, "GET", f.base + "/tasks/" + a.task.id)).status,
    404,
  );
  const assets = await ok(f.owner, "GET", f.base + "/assets"),
    asset = assets.items.find((a: any) => a.name === "campaign-plan.md");
  assert.ok(asset);
  assert.equal(asset.private_owner, f.owner.id);
  assert.equal(
    (await call(f.member, "GET", f.base + "/assets/" + asset.id + "/download"))
      .status,
    404,
  );
  assert.equal(
    (
      await call(f.owner, "POST", f.base + "/delegations", {
        ...body,
        prompt: "A changed request using the same identity.",
      })
    ).status,
    409,
  );
});
test("rejected budget and forged configuration leave no orphan default, conversation, task or budget reservation", async () => {
  const f = await fixture(false),
    r = await call(f.owner, "POST", f.base + "/delegations", brief());
  assert.equal(r.status, 402, JSON.stringify(r.data));
  for (const table of ["agents", "conversations", "tasks"])
    assert.equal(
      (
        await s.db.control.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE project_id=$1`,
          [f.project],
        )
      ).rows[0].n,
      0,
    );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        f.base + "/delegations",
        brief({ kernel: "other" }),
      )
    ).status,
    400,
  );
  await s.db.control.query(
    "UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2",
    [f.project, f.member.id],
  );
  assert.equal(
    (
      await call(f.member, "POST", f.base + "/conversations", {
        name: "Unauthorized",
      })
    ).status,
    403,
  );
});
test("customers cannot alter or delete the shared default, and moderation cannot be bypassed by asking for a fresh one", async () => {
  const f = await fixture(),
    c = await ok(f.owner, "POST", f.base + "/conversations", {
      name: "Default",
    });
  assert.equal(
    (
      await call(f.owner, "PATCH", f.base + "/agents/" + c.agent_id, {
        name: "Changed",
        role_key: "assistant",
        expected_version: 1,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(f.owner, "POST", f.base + "/deletions", {
        target_type: "agent",
        target_id: c.agent_id,
        reason: "Remove shared default",
      })
    ).status,
    403,
  );
  await assert.rejects(
    s.db.tx(
      (tx) =>
        tx.query("UPDATE agents SET name='Changed' WHERE id=$1", [c.agent_id]),
      f.tenant,
    ),
    /DEFAULT_ASSISTANT_IMMUTABLE/,
  );
  await s.db.control.query(
    "UPDATE agents SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [c.agent_id],
  );
  assert.equal(
    (
      await call(f.owner, "POST", f.base + "/conversations", {
        name: "Cannot evade moderation",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM agents WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    1,
  );
});
test("reinstalled methods need an explicit managed default version, while previous conversations and queued work keep their old bindings", async () => {
  const f = await fixture(),
    old = await ok(f.owner, "POST", f.base + "/delegations", brief());
  const installed = (await ok(f.owner, "GET", f.base + "/skill-installations"))
    .items[0];
  await ok(f.owner, "DELETE", f.base + "/skill-installations/" + installed.id);
  const replacement = await call(
    f.owner,
    "POST",
    f.base + "/skill-installations",
    { skill_version_id: installed.skill_version_id, enabled: true },
  );
  assert.equal(replacement.status, 200);
  await new Worker(s.db, s.catalog, s.storage, new ControlledRuntime()).run(
    f.tenant,
    old.task.id,
  );
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + old.task.id)).status,
    "cancelled",
  );
  const failed = await call(f.owner, "POST", f.base + "/delegations", brief());
  assert.equal(failed.status, 409);
  assert.equal(failed.data.error.code, "AGENT_SKILL_BINDING_CHANGED");
  assert.equal(
    (
      await call(f.member, "POST", f.base + "/default-assistant/versions", {
        expected_version: 1,
      })
    ).status,
    403,
  );
  const adopted = await ok(
    f.owner,
    "POST",
    f.base + "/default-assistant/versions",
    { expected_version: 1 },
  );
  assert.equal(adopted.version, 2);
  assert.equal(
    (
      await call(f.owner, "POST", f.base + "/default-assistant/versions", {
        expected_version: 1,
      })
    ).status,
    409,
  );
  const current = await ok(f.owner, "POST", f.base + "/delegations", brief());
  assert.equal(current.conversation.agent_version, 2);
  await new Worker(s.db, s.catalog, s.storage, new ControlledRuntime()).run(
    f.tenant,
    current.task.id,
  );
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + current.task.id)).status,
    "succeeded",
  );
  const original = await ok(
    f.owner,
    "GET",
    f.base + "/conversations/" + old.conversation.id,
  );
  assert.equal(original.agent_version, 1);
});
test("the default assistant obeys read-only ask mode and retains no fabricated generated file", async () => {
  const f = await fixture(),
    accepted = await ok(
      f.owner,
      "POST",
      f.base + "/delegations",
      brief({ mode: "ask" }),
    );
  await new Worker(
    s.db,
    s.catalog,
    s.storage,
    new ControlledRuntime(false),
  ).run(f.tenant, accepted.task.id);
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + accepted.task.id)).status,
    "succeeded",
  );
  assert.equal((await ok(f.owner, "GET", f.base + "/assets")).items.length, 0);
});
