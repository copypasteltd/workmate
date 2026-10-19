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
import { defaults } from "../src/plans.js";
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
    email: `skill-${randomUUID()}@example.invalid`,
  });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return {
    id: r.data.user.id,
    csrf: r.data.csrf_token,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
  };
}
async function fixture() {
  const owner = await user(),
    member = await user();
  const w = await ok(owner, "POST", "/v1/tenants", {
    name: "Methods studio",
    project_name: "Work",
  });
  const tenant = w.tenant.id,
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
  // Isolated test credit is not recorded as a customer payment.
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=1000000000 WHERE tenant_id=$1",
    [tenant],
  );
  const agent = await ok(owner, "POST", base + "/agents", {
    name: "Method-bound engineer",
    role_key: "fullstack",
  });
  const versions = await ok(
    owner,
    "GET",
    "/v1/skill-versions?project_id=" + project,
    undefined,
    tenant,
  );
  const installed = await ok(owner, "GET", base + "/skill-installations");
  return {
    owner,
    member,
    tenant,
    project,
    base,
    agent,
    versions: versions.items,
    installed: installed.items,
  };
}
async function task(f: any) {
  return ok(f.owner, "POST", f.base + "/tasks", {
    title: "Bound work",
    prompt: "Read the current authorized project files.",
    role_key: "fullstack",
    budget_micros: 1000000,
  });
}
class ControlledRuntime extends CodexRuntimeAdapter {
  calls = 0;
  constructor(private act: (ctx: RuntimeContext) => Promise<void>) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls++;
    await this.act(ctx);
    return {
      status: "completed",
      text: "Controlled method-bound output",
      inputTokens: 10,
      outputTokens: 5,
      usageKnown: true,
      accepted: true,
      thread: "skill-test",
      turn: "skill-test",
    };
  }
}
before(async () => {
  const env = { ...process.env };
  for (const k of [
    "DATABASE_URL",
    "CONTROL_DATABASE_URL",
    "QUEUE_DATABASE_URL",
  ]) {
    const u = new URL(env[k]!);
    u.pathname = "/copypaste_test";
    env[k] = u.href;
  }
  s = await buildApp(
    loadConfig({
      ...env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DATA_DIR: ".data/test",
      DEMO_MODE: "false",
      AI_BASE_URL: "http://127.0.0.1:9/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "synthetic-test-key",
      AI_MODEL: "controlled-skill-test",
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

test("preset installation and version bindings are project-scoped, idempotent and cannot be managed by a member", async () => {
  const f = await fixture();
  assert.equal(f.versions.length, 28);
  assert.equal(f.installed.length, 5);
  const effective = await ok(
    f.owner,
    "GET",
    `/v1/agents/${f.agent.id}/effective-capabilities`,
    undefined,
    f.tenant,
  );
  assert.equal(effective.skill_version_ids.length, 5);
  assert.deepEqual(effective.missing_dependencies, []);
  assert.ok(effective.tool_ids.includes("code.patch"));
  const skill = f.versions.find(
    (v: any) => !f.installed.some((i: any) => i.skill_version_id === v.id),
  );
  const key = randomUUID(),
    body = { project_id: f.project, skill_version_id: skill.id, enabled: true };
  const a = await ok(
      f.owner,
      "POST",
      "/v1/skill-installations",
      body,
      f.tenant,
      key,
    ),
    b = await ok(
      f.owner,
      "POST",
      "/v1/skill-installations",
      body,
      f.tenant,
      key,
    );
  assert.equal(a.id, b.id);
  assert.equal(
    (
      await call(
        f.member,
        "PATCH",
        `/v1/skill-installations/${a.id}`,
        { expected_version: a.version, enabled: false },
        f.tenant,
      )
    ).status,
    403,
  );
  const outsider = await user(),
    other = await ok(outsider, "POST", "/v1/tenants", {
      name: "Other",
      project_name: "Other",
    });
  assert.equal(
    (
      await call(
        outsider,
        "PATCH",
        `/v1/skill-installations/${a.id}`,
        { expected_version: a.version, enabled: false },
        other.tenant.id,
      )
    ).status,
    404,
  );
  const p = await ok(f.owner, "POST", `/v1/tenants/${f.tenant}/projects`, {
    name: "Unbound",
  });
  assert.equal(
    (
      await call(
        f.owner,
        "PATCH",
        `/v1/tenants/${f.tenant}/projects/${p.id}/skill-installations/${a.id}`,
        { expected_version: a.version, enabled: false },
      )
    ).status,
    404,
  );
  const results = await Promise.all(
    [true, false].map((enabled) =>
      call(
        f.owner,
        "PATCH",
        `/v1/skill-installations/${a.id}`,
        { expected_version: a.version, enabled },
        f.tenant,
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});
test("ordinary disable blocks new work without changing the exact methods of an accepted task", async () => {
  const f = await fixture(),
    t = await task(f),
    i = f.installed[0];
  await ok(f.owner, "PATCH", f.base + "/skill-installations/" + i.id, {
    expected_version: i.version,
    enabled: false,
  });
  const before = (
    await s.db.control.query(
      "SELECT * FROM task_skill_bindings WHERE task_id=$1",
      [t.id],
    )
  ).rows;
  const runtime = new ControlledRuntime(async (ctx) => {
    assert.equal(ctx.skills.length, 5);
    await ctx.tools
      .find((x) => x.name === "project_assets")!
      .run({}, randomUUID());
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, t.id);
  assert.equal(runtime.calls, 1);
  assert.equal(
    (await s.db.control.query("SELECT status FROM tasks WHERE id=$1", [t.id]))
      .rows[0].status,
    "succeeded",
  );
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT * FROM task_skill_bindings WHERE task_id=$1",
        [t.id],
      )
    ).rows,
    before,
  );
  const rejected = await call(f.owner, "POST", f.base + "/tasks", {
    title: "New work",
    prompt: "Read authorized project files.",
    role_key: "fullstack",
    budget_micros: 1000000,
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.error.code, "SKILL_INSTALLATION_REQUIRED");
  const effective = await ok(
    f.owner,
    "GET",
    f.base + `/agents/${f.agent.id}/effective-capabilities`,
  );
  assert.equal(effective.tool_ids.length, 0);
  assert.equal(effective.missing_dependencies.length, 1);
  await ok(f.owner, "PATCH", f.base + "/skill-installations/" + i.id, {
    expected_version: i.version + 1,
    enabled: true,
  });
  const next = await task(f);
  assert.equal(next.status, "queued");
});
test("security revocation blocks the next tool and final output in an already running task, then permanently blocks reinstall", async () => {
  const f = await fixture(),
    t = await task(f),
    i = f.installed[0];
  const runtime = new ControlledRuntime(async (ctx) => {
    await ctx.tools
      .find((x) => x.name === "project_assets")!
      .run({}, randomUUID());
    await ok(f.owner, "PATCH", f.base + "/skill-installations/" + i.id, {
      expected_version: i.version,
      security_revoke: true,
    });
    await assert.rejects(
      ctx.tools
        .find((x) => x.name === "deliver_text")!
        .run(
          {
            filename: "forbidden.txt",
            content: "Must not persist",
            mime_type: "text/plain",
          },
          randomUUID(),
        ),
      (e: any) => e.code === "SKILL_REVOKED",
    );
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, t.id);
  const terminal = (
    await s.db.control.query("SELECT status,output FROM tasks WHERE id=$1", [
      t.id,
    ])
  ).rows[0];
  assert.equal(terminal.status, "cancelled");
  assert.equal(terminal.output, "");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM assets WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await call(f.owner, "POST", f.base + "/skill-installations", {
        skill_version_id: i.skill_version_id,
        enabled: true,
      })
    ).status,
    403,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE skill_installations SET state='installed' WHERE id=$1",
      [i.id],
    ),
    (e: any) => e.code === "23514",
  );
});
test("uninstall and explicit reinstall create a new identity without reviving queued work or silently rebinding an old specialist version", async () => {
  const f = await fixture(),
    t = await task(f),
    i = f.installed[0],
    key = randomUUID();
  await ok(
    f.owner,
    "DELETE",
    f.base + "/skill-installations/" + i.id,
    undefined,
    undefined,
    key,
  );
  await ok(
    f.owner,
    "DELETE",
    f.base + "/skill-installations/" + i.id,
    undefined,
    undefined,
    key,
  );
  const replacement = await ok(
    f.owner,
    "POST",
    f.base + "/skill-installations",
    { skill_version_id: i.skill_version_id, enabled: true },
  );
  assert.notEqual(replacement.id, i.id);
  const runtime = new ControlledRuntime(async () => {});
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, t.id);
  assert.equal(runtime.calls, 0);
  const conv = await ok(f.owner, "POST", f.base + "/conversations", {
    name: "Old binding",
    agent_id: f.agent.id,
  });
  const body = {
    client_message_id: randomUUID(),
    expected_version: 1,
    intent: "delegate",
    mode: "execute",
    body: "Read the project files.",
    budget_micros: 1000000,
  };
  const old = await call(
    f.owner,
    "POST",
    f.base + `/conversations/${conv.id}/messages`,
    body,
  );
  assert.equal(old.status, 409);
  assert.equal(old.data.error.code, "AGENT_SKILL_BINDING_CHANGED");
  const updated = await ok(f.owner, "PATCH", f.base + "/agents/" + f.agent.id, {
    name: f.agent.name,
    role_key: "fullstack",
    expected_version: 1,
  });
  assert.equal(updated.version, 2);
  const fresh = await ok(f.owner, "POST", f.base + "/conversations", {
    name: "New binding",
    agent_id: f.agent.id,
  });
  const accepted = await ok(
    f.owner,
    "POST",
    f.base + `/conversations/${fresh.id}/messages`,
    { ...body, client_message_id: randomUUID() },
  );
  assert.equal(accepted.task.status, "queued");
});
test("current plan capabilities are rechecked at the next tool and completion while the original reservation is settled once", async () => {
  const f = await fixture();
  const grant = (
    await s.db.control.query(
      "INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Controlled test entitlement',$2) RETURNING id",
      [f.tenant, defaults.business],
    )
  ).rows[0];
  const t = await task(f);
  const runtime = new ControlledRuntime(async (ctx) => {
    await s.db.control.query(
      "UPDATE entitlements SET plan_body=jsonb_set(plan_body,'{capabilities}','[]') WHERE id=$1",
      [grant.id],
    );
    await assert.rejects(
      ctx.tools
        .find((x) => x.name === "deliver_text")!
        .run(
          {
            filename: "forbidden.txt",
            content: "No longer allowed",
            mime_type: "text/plain",
          },
          randomUUID(),
        ),
      (e: any) => e.code === "PLAN_CAPABILITY_REQUIRED",
    );
  });
  const runner = new Worker(s.db, s.catalog, s.storage, runtime);
  await runner.run(f.tenant, t.id);
  await runner.run(f.tenant, t.id);
  assert.equal(runtime.calls, 1);
  const terminal = (
    await s.db.control.query(
      "SELECT status,output,plan_snapshot FROM tasks WHERE id=$1",
      [t.id],
    )
  ).rows[0];
  assert.equal(terminal.status, "cancelled");
  assert.equal(terminal.output, "");
  assert.ok(terminal.plan_snapshot.body.capabilities.includes("text"));
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [t.id],
      )
    ).rows[0].status,
    "settled",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [t.id],
      )
    ).rows[0].n,
    1,
  );
});
