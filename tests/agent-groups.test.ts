import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { Worker } from "../src/worker.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { advanceAgentGroups } from "../src/agent-groups.js";
import { ErasureService } from "../src/erasure.js";
import { defaults } from "../src/plans.js";
import * as OTPAuth from "otpauth";
import { seal } from "../src/lib.js";
import { RetentionService } from "../src/retention.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin?: boolean };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  key: string = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? "http://localhost:4318" : "http://localhost:4317",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      "idempotency-key": key,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  return {
    status: raw.statusCode,
    data: raw.headers["content-type"]?.includes("application/json")
      ? raw.json()
      : raw.body,
    raw,
  };
}
async function ok(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  key?: string,
) {
  const r = await call(c, method, url, body, tenant, key);
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${r.status} ${JSON.stringify(r.data)}`,
  );
  return r.data;
}
async function user(): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", {
    email: `team-${randomUUID()}@example.invalid`,
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
    cookie:
      "cp_session=" + r.raw.cookies.find((c) => c.name === "cp_session")!.value,
    csrf: r.data.csrf_token,
  };
}
async function fixture(taskSlots = 8) {
  const owner = await user(),
    w = await ok(owner, "POST", "/v1/tenants", {
      name: "Team checks",
      project_name: "Private delivery",
    });
  const tenant = w.tenant.id,
    project = w.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await ok(owner, "POST", `/v1/tenants/${tenant}/demo-credit`, {});
  await s.db.control.query(
    "INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic team capacity fixture; no payment received',$2)",
    [tenant, { ...defaults.business, max_active_tasks: taskSlots }],
  );
  const agents = [];
  for (const name of ["Coordinator", "Copy specialist", "Review specialist"])
    agents.push(
      await ok(owner, "POST", base + "/agents", {
        name,
        role_key: "assistant",
        instructions:
          "Clearly synthetic fixture. Use actual company tools and preserve source references.",
      }),
    );
  const input = {
    project_id: project,
    name: "Launch delivery team",
    coordinator_agent_id: agents[0].id,
    members: agents.slice(1).map((a, i) => ({
      agent_id: a.id,
      role_description:
        i === 0
          ? "Prepare the first deliverable"
          : "Review the first deliverable",
    })),
  };
  const group = await ok(owner, "POST", "/v1/agent-groups", input, tenant),
    url = "/v1/agent-groups/" + group.id;
  return { owner, tenant, project, base, agents, input, group, url };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const plan = (f: Fixture, overrides = {}) => ({
  expected_version: f.group.version,
  brief:
    "Produce clearly simulated copy and a review based on actual predecessor deliverables.",
  nodes: [
    {
      key: "copy",
      agent_id: f.agents[1].id,
      title: "Write the copy",
      prompt: "Deliver a clearly simulated draft.",
      depends_on: [],
      budget_micros: 100000,
    },
    {
      key: "review",
      agent_id: f.agents[2].id,
      title: "Review the copy",
      prompt: "Read the actual copy and deliver a review.",
      depends_on: ["copy"],
      budget_micros: 100000,
    },
  ],
  coordinator_budget_micros: 100000,
  max_parallelism: 2,
  ...overrides,
});
async function review(f: Fixture, overrides = {}) {
  return ok(
    f.owner,
    "POST",
    f.url + "/preflight",
    plan(f, overrides),
    f.tenant,
  );
}
const approval = (p: any) => ({
  preflight_id: p.id,
  expected_version: p.version,
  definition_hash: p.definition_hash,
  approved_budget_micros: p.approved_budget_micros,
  confirm: true,
});
async function start(f: Fixture, overrides = {}) {
  const p = await review(f, overrides);
  return ok(f.owner, "POST", f.url + "/runs", approval(p), f.tenant);
}
async function get(f: Fixture, id: string) {
  return ok(f.owner, "GET", f.url + "/runs/" + id, undefined, f.tenant);
}
class FixtureRuntime extends CodexRuntimeAdapter {
  failure: unknown;
  constructor(private perform: (ctx: RuntimeContext) => Promise<unknown>) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    try {
      await this.perform(ctx);
    } catch (e) {
      this.failure = e;
      throw e;
    }
    return {
      status: "completed",
      text: "Clearly synthetic deliverable; actual team company tools were executed.",
      inputTokens: 20,
      outputTokens: 10,
      usageKnown: true,
      accepted: true,
      thread: "synthetic-team-thread",
      turn: randomUUID(),
    };
  }
}
const tool = (ctx: RuntimeContext, name: string) => {
  const t = ctx.tools.find((t) => t.name === name);
  assert.ok(t, "Missing actual tool " + name);
  return t;
};
async function execute(f: Fixture, task: string, expected: string[]) {
  let result: any;
  const runtime = new FixtureRuntime(async (ctx) => {
    result = await tool(ctx, "group_results").run({}, randomUUID());
    assert.deepEqual(
      result.items.map((r: any) => r.step_key),
      expected,
    );
    assert.ok(result.untrusted_source_data);
    await tool(ctx, "deliver_text").run(
      {
        filename: "team-delivery.md",
        content:
          "# Synthetic team delivery\n\nSource tasks: " +
          result.items.map((r: any) => r.task_id).join(", "),
        mime_type: "text/markdown",
      },
      randomUUID(),
    );
    assert.ok(
      !ctx.tools.some((t) => /group_(approve|run|create)/.test(t.name)),
    );
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, task);
  if (runtime.failure) throw runtime.failure;
  const actual = (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [task])
  ).rows[0];
  assert.equal(actual.status, "succeeded", actual.error_code);
  return { actual, result };
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
      DEV_MAILBOX: "true",
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

async function cancelledHistoryRun(f: Fixture) {
  const r = await start(f);
  const stopped = await ok(
    f.owner,
    "POST",
    f.url + `/runs/${r.id}/cancel`,
    { expected_revision: r.revision },
    f.tenant,
  );
  assert.equal(stopped.state, "cancelled");
  assert.equal(stopped.charged_micros, 0);
  assert.equal(stopped.reserved_micros, 0);
  return r;
}

test("private team history orders actual creation time and preserves exact PostgreSQL microseconds, ties and cursor stability", async () => {
  const f = await fixture(),
    runs = [];
  for (let i = 0; i < 10; i++) runs.push(await cancelledHistoryRun(f));
  const actual = await ok(
    f.owner,
    "GET",
    f.url + "/runs?limit=8",
    undefined,
    f.tenant,
  );
  assert.deepEqual(
    actual.items.map((r: any) => r.id),
    runs
      .slice(-8)
      .reverse()
      .map((r) => r.id),
  );
  assert.equal(actual.next_before, runs[2].id);
  assert.deepEqual(
    (
      await ok(
        f.owner,
        "GET",
        f.url + "/runs?limit=8&before=" + actual.next_before,
        undefined,
        f.tenant,
      )
    ).items.map((r: any) => r.id),
    runs
      .slice(0, 2)
      .reverse()
      .map((r) => r.id),
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE agent_group_runs SET created_at=now() WHERE id=$1",
      [runs[0].id],
    ),
    (e: any) => e.code === "23514",
  );
  const ids = runs.map((r) => r.id).sort(),
    fractions = [104, 101, 103, 102, 104, 102, 99, 98, 97, 96];
  // Isolated control-only timestamp fixtures exercise sub-millisecond and exact
  // ties. All runs above were really approved and cancelled, with released holds.
  await s.db.tx(
    async (tx) => {
      await tx.query("SELECT set_config('app.erasing_content','true',true)");
      for (const [i, id] of ids.entries())
        await tx.query(
          "UPDATE agent_group_runs SET created_at='2026-01-01T00:00:00Z'::timestamptz + $2::int * interval '1 microsecond' WHERE id=$1",
          [id, fractions[i]],
        );
    },
    undefined,
    true,
  );
  const expected = [
      ids[4],
      ids[0],
      ids[2],
      ids[5],
      ids[3],
      ids[1],
      ids[6],
      ids[7],
      ids[8],
      ids[9],
    ],
    seen: string[] = [];
  let before: string | null = null;
  do {
    const page: any = await ok(
      f.owner,
      "GET",
      f.url + "/runs?limit=2" + (before ? "&before=" + before : ""),
      undefined,
      f.tenant,
    );
    seen.push(...page.items.map((r: any) => r.id));
    before = page.next_before;
    if (seen.length === 2) await cancelledHistoryRun(f);
  } while (before);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, 10);
  const rows = (
    await s.db.control.query(
      "SELECT status,count(*)::int AS n FROM reservations WHERE task_id IN(SELECT id FROM tasks WHERE agent_group_run_id=ANY($1::uuid[])) GROUP BY status",
      [runs.map((r) => r.id)],
    )
  ).rows;
  assert.deepEqual(rows, [{ status: "released", n: 10 }]);
});

test("team history cursor anchors cannot disclose another owner, project, withdrawn or expired run", async () => {
  const f = await fixture(),
    other = await fixture(),
    peer = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [f.tenant, peer.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, peer.id],
  );
  const peerFixture = { ...f, owner: peer },
    peerRun = await cancelledHistoryRun(peerFixture),
    otherRun = await cancelledHistoryRun(other),
    hidden = await cancelledHistoryRun(f),
    expired = await cancelledHistoryRun(f);
  await s.db.control.query(
    "UPDATE agent_group_runs SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [hidden.id],
  );
  await s.db.tx(
    async (tx) => {
      await tx.query("SELECT set_config('app.erasing_content','true',true)");
      await tx.query(
        "UPDATE agent_group_runs SET retention_expires_at=now()-interval '1 minute' WHERE id=$1",
        [expired.id],
      );
    },
    undefined,
    true,
  );
  for (const id of [
    peerRun.id,
    otherRun.id,
    hidden.id,
    expired.id,
    randomUUID(),
  ]) {
    const r = await call(
      f.owner,
      "GET",
      f.url + "/runs?before=" + id,
      undefined,
      f.tenant,
    );
    assert.equal(r.status, 404, JSON.stringify(r.data));
  }
  const visible = await cancelledHistoryRun(f);
  assert.deepEqual(
    (await ok(f.owner, "GET", f.url + "/runs", undefined, f.tenant)).items.map(
      (r: any) => r.id,
    ),
    [visible.id],
  );
  assert.equal(
    (
      await call(
        peer,
        "GET",
        f.url + "/runs?before=" + visible.id,
        undefined,
        f.tenant,
      )
    ).status,
    404,
  );
});

test("project team and immutable version cursors traverse beyond one hundred teams and twenty versions", async () => {
  const f = await fixture(),
    ids = [f.group.id];
  for (let i = 0; i < 101; i++)
    ids.push(
      (
        await ok(
          f.owner,
          "POST",
          "/v1/agent-groups",
          { ...f.input, name: "History directory " + i },
          f.tenant,
        )
      ).id,
    );
  const first = await ok(
      f.owner,
      "GET",
      `/v1/agent-groups?project_id=${f.project}&limit=100`,
      undefined,
      f.tenant,
    ),
    second = await ok(
      f.owner,
      "GET",
      `/v1/agent-groups?project_id=${f.project}&limit=100&cursor=${first.next_cursor}`,
      undefined,
      f.tenant,
    );
  assert.equal(first.items.length, 100);
  assert.equal(second.items.length, 2);
  assert.equal(second.next_cursor, null);
  assert.deepEqual(
    [...first.items, ...second.items].map((g: any) => g.id),
    ids.sort(),
  );
  for (let version = 1; version < 23; version++)
    await ok(
      f.owner,
      "PATCH",
      f.url,
      { expected_version: version, name: "History version " + (version + 1) },
      f.tenant,
    );
  const newest = await ok(
      f.owner,
      "GET",
      f.url + "/versions?limit=20",
      undefined,
      f.tenant,
    ),
    oldest = await ok(
      f.owner,
      "GET",
      f.url + "/versions?limit=20&before=" + newest.next_before,
      undefined,
      f.tenant,
    );
  assert.equal(newest.items.length, 20);
  assert.equal(oldest.next_before, null);
  assert.deepEqual(
    [...newest.items, ...oldest.items].map((v: any) => v.version),
    Array.from({ length: 23 }, (_, i) => 23 - i),
  );
  assert.deepEqual(
    newest.items[0].body.bindings,
    oldest.items[2].body.bindings,
  );
});

test("canonical team CRUD keeps original response shape, immutable member versions and project boundaries", async () => {
  const f = await fixture(),
    other = await fixture();
  assert.deepEqual(
    Object.keys(f.group).sort(),
    [
      "coordinator_agent_id",
      "id",
      "members",
      "name",
      "project_id",
      "state",
      "version",
      "workspace_id",
    ].sort(),
  );
  assert.equal(
    (await call(other.owner, "GET", f.url, undefined, other.tenant)).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        "/v1/agent-groups",
        {
          ...f.input,
          members: [
            { agent_id: other.agents[1].id, role_description: "Other project" },
          ],
        },
        f.tenant,
      )
    ).status,
    404,
  );
  const dup = await call(
    f.owner,
    "POST",
    "/v1/agent-groups",
    {
      ...f.input,
      members: [{ agent_id: f.agents[0].id, role_description: "Duplicate" }],
    },
    f.tenant,
  );
  assert.equal(dup.data.error.code, "GROUP_DUPLICATE_MEMBER");
  const updated = await ok(
    f.owner,
    "PATCH",
    f.url,
    { expected_version: 1, name: "Renamed team" },
    f.tenant,
  );
  assert.equal(updated.version, 2);
  assert.equal(
    (
      await call(
        f.owner,
        "PATCH",
        f.url,
        { expected_version: 1, name: "Stale name" },
        f.tenant,
      )
    ).status,
    409,
  );
  const vs = await ok(f.owner, "GET", f.url + "/versions", undefined, f.tenant);
  assert.equal(vs.items.length, 2);
  assert.deepEqual(vs.items[0].body.bindings, vs.items[1].body.bindings);
  await assert.rejects(
    s.db.control.query(
      "UPDATE agent_group_versions SET body='{}' WHERE group_id=$1",
      [f.group.id],
    ),
    /immutable/,
  );
  const all = await ok(
    f.owner,
    "GET",
    "/v1/agent-groups?project_id=" + f.project,
    undefined,
    f.tenant,
  );
  assert.equal(all.items.length, 1);
});

test("cycles, duplicate keys, invalid dependencies, nonmembers and aggregate budgets fail before tasks or funds", async () => {
  const f = await fixture(),
    p = plan(f),
    checks = [
      { nodes: [{ ...p.nodes[0], depends_on: ["review"] }, p.nodes[1]] },
      { nodes: [p.nodes[0], { ...p.nodes[1], key: "copy" }] },
      { nodes: [{ ...p.nodes[0], depends_on: ["missing"] }] },
      { nodes: [{ ...p.nodes[0], agent_id: f.agents[0].id }] },
      {
        nodes: [{ ...p.nodes[0], budget_micros: 1e12 }],
        coordinator_budget_micros: 1e12,
      },
      { nodes: [{ ...p.nodes[0], depends_on: ["copy"] }] },
    ];
  for (const invalid of checks) {
    const r = await call(
      f.owner,
      "POST",
      f.url + "/preflight",
      { ...p, ...invalid },
      f.tenant,
    );
    assert.equal(r.status, 422, JSON.stringify(r.data));
  }
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM tasks WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].count,
    "0",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM agent_group_preflights WHERE group_id=$1",
        [f.group.id],
      )
    ).rows[0].count,
    "0",
  );
});

test("review is free, exact approval and retries create one paused coordinator and one reservation", async () => {
  const f = await fixture(),
    p = await review(f);
  assert.equal(p.funds_reserved_micros, 0);
  assert.equal(p.approved_budget_micros, 300000);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM tasks WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].count,
    "0",
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        f.url + "/runs",
        { ...approval(p), approved_budget_micros: 299999 },
        f.tenant,
      )
    ).status,
    409,
  );
  const k = randomUUID(),
    [a, b] = await Promise.all([
      ok(f.owner, "POST", f.url + "/runs", approval(p), f.tenant, k),
      ok(f.owner, "POST", f.url + "/runs", approval(p), f.tenant, k),
    ]);
  assert.equal(a.id, b.id);
  assert.equal(a.tasks.length, 1);
  assert.equal(a.tasks[0].status, "paused");
  assert.equal(a.reserved_micros, 100000);
  const paused = await call(
    f.owner,
    "POST",
    f.base + `/tasks/${a.coordinator_task_id}/controls`,
    { action: "resume", expected_version: 1 },
  );
  assert.equal(paused.status, 409, JSON.stringify(paused.data));
  assert.equal(
    (await call(f.owner, "POST", f.url + "/runs", approval(p), f.tenant))
      .status,
    409,
  );
  await ok(
    f.owner,
    "POST",
    f.url + `/runs/${a.id}/cancel`,
    { expected_revision: a.revision },
    f.tenant,
  );
});

test("concurrent dispatch executes a dependency graph once, reads real predecessor files and settles exact member fees", async () => {
  const f = await fixture(),
    r = await start(f);
  await Promise.all([
    advanceAgentGroups(s.db, s.catalog),
    advanceAgentGroups(s.db, s.catalog),
  ]);
  let current = await get(f, r.id);
  assert.equal(current.tasks.length, 2);
  assert.equal(current.nodes[1].task_id, null);
  const first = await execute(f, current.nodes[0].task_id, []);
  assert.ok(first.actual.charged_micros > 0);
  await advanceAgentGroups(s.db, s.catalog);
  current = await get(f, r.id);
  assert.equal(current.nodes[0].state, "succeeded");
  assert.ok(current.nodes[1].task_id);
  const second = await execute(f, current.nodes[1].task_id, ["copy"]);
  assert.equal(second.result.items[0].files.length, 1);
  await advanceAgentGroups(s.db, s.catalog);
  current = await get(f, r.id);
  assert.equal(
    current.tasks.find((t: any) => t.step_key === "coordinator").status,
    "queued",
  );
  await execute(f, current.coordinator_task_id, ["copy", "review"]);
  await advanceAgentGroups(s.db, s.catalog);
  current = await get(f, r.id);
  assert.equal(current.state, "succeeded");
  assert.equal(current.tasks.length, 3);
  assert.equal(current.reserved_micros, 0);
  assert.equal(
    current.charged_micros,
    current.tasks.reduce(
      (sum: number, t: any) => sum + Number(t.charged_micros),
      0,
    ),
  );
  assert.ok(
    current.charged_micros > 0 &&
      current.charged_micros <= current.approved_budget_micros,
  );
  await advanceAgentGroups(s.db, s.catalog);
  assert.equal((await get(f, r.id)).tasks.length, 3);
  const manifest = (
    await s.db.tx(
      (tx) =>
        tx.query("SELECT task_content_source_manifest($1) AS body", [
          current.coordinator_task_id,
        ]),
      f.tenant,
      false,
      f.owner.id,
    )
  ).rows[0].body;
  assert.ok(manifest);
  assert.ok(
    manifest.some((t: any) => t.kind === "agent_groups" && t.id === f.group.id),
  );
});

test("a single-slot plan fails review before reservations, while a two-slot plan progresses below its parallel cap", async () => {
  const single = await fixture(1);
  const blocked = await call(
    single.owner,
    "POST",
    single.url + "/preflight",
    plan(single),
    single.tenant,
  );
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error.code, "GROUP_CAPACITY_REQUIRED");
  const f = await fixture(2),
    p = plan(f),
    r = await start(f, {
      nodes: [p.nodes[0], { ...p.nodes[1], depends_on: [] }],
    });
  await advanceAgentGroups(s.db, s.catalog);
  let current = await get(f, r.id);
  assert.equal(current.state, "running");
  assert.equal(current.nodes.filter((n: any) => n.task_id).length, 1);
  await advanceAgentGroups(s.db, s.catalog);
  assert.equal(
    (await get(f, r.id)).nodes.filter((n: any) => n.task_id).length,
    1,
  );
  await execute(f, current.nodes[0].task_id, []);
  await advanceAgentGroups(s.db, s.catalog);
  current = await get(f, r.id);
  assert.ok(current.nodes[1].task_id);
  assert.equal(
    current.tasks.filter((t: any) =>
      ["paused", "queued", "running"].includes(t.status),
    ).length,
    2,
  );
  await ok(
    f.owner,
    "POST",
    f.url + `/runs/${r.id}/cancel`,
    { expected_revision: current.revision },
    f.tenant,
  );
});

test("application SQL cannot forge completed nodes, different task assignments or altered approved budgets", async () => {
  const f = await fixture(),
    r = await start(f);
  await assert.rejects(
    s.db.tx(
      async (tx) => {
        await tx.query("SELECT set_config('app.erasing_content','true',true)");
        await tx.query(
          "UPDATE agent_group_nodes SET state='succeeded' WHERE run_id=$1 AND step_key='copy'",
          [r.id],
        );
      },
      f.tenant,
      false,
      f.owner.id,
    ),
    /actual completed work/,
  );
  await assert.rejects(
    s.db.tx(
      (tx) =>
        tx.query(
          "UPDATE agent_group_nodes SET task_id=$2 WHERE run_id=$1 AND step_key='copy'",
          [r.id, r.coordinator_task_id],
        ),
      f.tenant,
      false,
      f.owner.id,
    ),
    /actual bound task/,
  );
  await assert.rejects(
    s.db.tx(
      (tx) =>
        tx.query(
          "UPDATE agent_group_runs SET approved_budget_micros=approved_budget_micros+1 WHERE id=$1",
          [r.id],
        ),
      f.tenant,
      false,
      f.owner.id,
    ),
    /immutable/,
  );
  await assert.rejects(
    s.db.tx(
      (tx) =>
        tx.query("UPDATE agent_group_runs SET state='succeeded' WHERE id=$1", [
          r.id,
        ]),
      f.tenant,
      false,
      f.owner.id,
    ),
    /actual coordinator/,
  );
  await ok(
    f.owner,
    "POST",
    f.url + `/runs/${r.id}/cancel`,
    { expected_revision: r.revision },
    f.tenant,
  );
});

test("insufficient remaining funds stop new admission and release the untouched coordinator hold without negative balances", async () => {
  const f = await fixture(),
    r = await start(f, { coordinator_budget_micros: 100000000 });
  assert.equal(r.reserved_micros, 100000000);
  await advanceAgentGroups(s.db, s.catalog);
  const actual = await get(f, r.id);
  assert.equal(actual.state, "failed");
  assert.equal(actual.tasks.length, 1);
  assert.equal(actual.reserved_micros, 0);
  assert.equal(actual.charged_micros, 0);
  const wallet = (
    await s.db.control.query(
      "SELECT balance_micros,reserved_micros FROM wallets WHERE tenant_id=$1",
      [f.tenant],
    )
  ).rows[0];
  assert.ok(BigInt(wallet.balance_micros) >= 0n);
  assert.equal(Number(wallet.reserved_micros), 0);
});

test("parallel admission respects approved slots while a dependent step waits for its own predecessors", async () => {
  const f = await fixture(),
    p = plan(f);
  const nodes = [
    p.nodes[0],
    { ...p.nodes[1], depends_on: [] },
    { ...p.nodes[0], key: "third", depends_on: ["copy"] },
  ];
  const r = await start(f, { nodes, max_parallelism: 2 });
  await advanceAgentGroups(s.db, s.catalog);
  let current = await get(f, r.id);
  assert.equal(current.nodes.filter((n: any) => n.task_id).length, 2);
  await execute(f, current.nodes[0].task_id, []);
  await advanceAgentGroups(s.db, s.catalog);
  current = await get(f, r.id);
  assert.ok(current.nodes[2].task_id);
  assert.equal(
    current.nodes.filter((n: any) => n.state === "active").length,
    2,
  );
  await ok(
    f.owner,
    "POST",
    f.url + `/runs/${r.id}/cancel`,
    { expected_revision: current.revision },
    f.tenant,
  );
  assert.equal((await get(f, r.id)).reserved_micros, 0);
});

test("cancellation releases unused holds, never dispatches pending members and keeps an idempotent stop", async () => {
  const f = await fixture(),
    r = await start(f),
    k = randomUUID(),
    input = { expected_revision: r.revision };
  const cancelled = await ok(
    f.owner,
    "POST",
    f.url + `/runs/${r.id}/cancel`,
    input,
    f.tenant,
    k,
  );
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.reserved_micros, 0);
  assert.equal(cancelled.charged_micros, 0);
  assert.equal(
    (
      await ok(
        f.owner,
        "POST",
        f.url + `/runs/${r.id}/cancel`,
        input,
        f.tenant,
        k,
      )
    ).id,
    r.id,
  );
  await advanceAgentGroups(s.db, s.catalog);
  assert.equal((await get(f, r.id)).tasks.length, 1);
});

test("an archived or changed version cannot start a stale review; already approved work retains its version", async () => {
  const f = await fixture(),
    p = await review(f),
    r = await start(f);
  await ok(
    f.owner,
    "PATCH",
    f.url,
    { expected_version: 1, name: "New definition", state: "archived" },
    f.tenant,
  );
  assert.equal(
    (await call(f.owner, "POST", f.url + "/runs", approval(p), f.tenant))
      .status,
    409,
  );
  await advanceAgentGroups(s.db, s.catalog);
  const current = await get(f, r.id);
  assert.equal(current.version, 1);
  assert.equal(current.tasks.length, 2);
  await ok(
    f.owner,
    "POST",
    f.url + `/runs/${r.id}/cancel`,
    { expected_revision: current.revision },
    f.tenant,
  );
});

test("disabled members and revoked actor permission stop queued work and release known unused reservations", async () => {
  for (const revoke of ["agent", "user"]) {
    const f = await fixture(),
      r = await start(f);
    if (revoke === "agent")
      await s.db.control.query(
        "UPDATE agents SET enabled=false,version=version+1 WHERE id=$1",
        [f.agents[1].id],
      );
    else
      await s.db.control.query(
        "UPDATE memberships SET status='removed',version=version+1 WHERE tenant_id=$1 AND user_id=$2",
        [f.tenant, f.owner.id],
      );
    await advanceAgentGroups(s.db, s.catalog);
    const actual = (
      await s.db.control.query("SELECT * FROM agent_group_runs WHERE id=$1", [
        r.id,
      ])
    ).rows[0];
    assert.equal(actual.state, "failed");
    const task = (
      await s.db.control.query("SELECT status FROM tasks WHERE id=$1", [
        r.coordinator_task_id,
      ])
    ).rows[0];
    assert.equal(task.status, "cancelled");
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*) FROM reservations WHERE task_id=$1 AND status='reserved'",
          [r.coordinator_task_id],
        )
      ).rows[0].count,
      "0",
    );
  }
});

test("private runs remain invisible to other project members at API and application SQL boundaries", async () => {
  const f = await fixture(),
    other = await user(),
    r = await start(f);
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')",
    [f.tenant, other.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, other.id],
  );
  assert.equal(
    (await ok(other, "GET", f.url, undefined, f.tenant)).id,
    f.group.id,
  );
  assert.equal(
    (await ok(other, "GET", f.url + "/runs", undefined, f.tenant)).items.length,
    0,
  );
  assert.equal(
    (await call(other, "GET", f.url + "/runs/" + r.id, undefined, f.tenant))
      .status,
    404,
  );
  assert.equal(
    (
      await s.db.tx(
        (tx) => tx.query("SELECT * FROM agent_group_runs WHERE id=$1", [r.id]),
        f.tenant,
        false,
        other.id,
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await s.db.tx(
        (tx) =>
          tx.query("SELECT * FROM agent_group_nodes WHERE run_id=$1", [r.id]),
        f.tenant,
        false,
        other.id,
      )
    ).rowCount,
    0,
  );
  await ok(
    f.owner,
    "POST",
    f.url + `/runs/${r.id}/cancel`,
    { expected_revision: r.revision },
    f.tenant,
  );
});

test("team source withdrawal immediately fences private deliverables and erases group context without erasing financial facts", async () => {
  const f = await fixture(),
    r = await start(f);
  await advanceAgentGroups(s.db, s.catalog);
  const active = await get(f, r.id);
  await execute(f, active.nodes[0].task_id, []);
  const asset = (
    await s.db.control.query(
      "SELECT a.id FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE v.metadata->>'task_id'=$1",
      [active.nodes[0].task_id],
    )
  ).rows[0];
  assert.equal(
    (await call(f.owner, "GET", f.base + `/assets/${asset.id}/download`))
      .status,
    200,
  );
  await s.db.control.query(
    "UPDATE agent_groups SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [f.group.id],
  );
  assert.equal(
    (await call(f.owner, "GET", f.base + `/assets/${asset.id}/download`))
      .status,
    404,
  );
  await advanceAgentGroups(s.db, s.catalog);
  await s.db.control.query(
    "UPDATE agent_groups SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1",
    [f.group.id],
  );
  const erasure = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) await erasure.advance(30);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT body FROM agent_group_versions WHERE group_id=$1 LIMIT 1",
        [f.group.id],
      )
    ).rows[0].body &&
      JSON.stringify(
        (
          await s.db.control.query(
            "SELECT body FROM agent_group_versions WHERE group_id=$1 LIMIT 1",
            [f.group.id],
          )
        ).rows[0].body,
      ),
    "{}",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT definition FROM agent_group_runs WHERE id=$1",
        [r.id],
      )
    ).rows[0].definition &&
      JSON.stringify(
        (
          await s.db.control.query(
            "SELECT definition FROM agent_group_runs WHERE id=$1",
            [r.id],
          )
        ).rows[0].definition,
      ),
    "{}",
  );
  assert.ok(
    (
      await s.db.control.query("SELECT charged_micros FROM tasks WHERE id=$1", [
        active.nodes[0].task_id,
      ])
    ).rows[0].charged_micros > 0,
  );
});

test("scoped Admin content permissions audit team body access, stop queued work and preserve terminal state after restoration", async () => {
  const f = await fixture(),
    other = await fixture(),
    r = await start(f);
  await advanceAgentGroups(s.db, s.catalog);
  const active = await get(f, r.id);
  assert.equal(active.tasks.length, 2);
  const email = `team-admin-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  const id = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Scoped team reviewer',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0].id;
  const grant = async (permissions: string[]) => {
    const role = "team_" + randomUUID();
    await s.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Team content control',$2)",
      [role, JSON.stringify(permissions)],
    );
    await s.db.control.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)",
      [id, role, f.project],
    );
  };
  await grant(["admin.content.read"]);
  const challenge = await ok(undefined, "POST", "/v1/admin/auth/challenge", {
    email,
  });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,
      "utf8",
    ),
  );
  const signed = await call(undefined, "POST", "/v1/admin/auth/verify", {
    challenge_id: challenge.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    totp: new OTPAuth.TOTP({ secret }).generate(),
  });
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  const cookie = signed.raw.cookies.find((c) => c.name === "cp_admin_session")!;
  const admin: Client = {
    id,
    cookie: cookie.name + "=" + cookie.value,
    csrf: signed.data.csrf_token,
    admin: true,
  };
  const list = await ok(admin, "GET", "/v1/admin/content?page_size=100");
  for (const [target, kind] of [
    [f.group.id, "agent_groups"],
    [r.id, "agent_group_runs"],
  ])
    assert.ok(
      list.items.some((item: any) => item.id === target && item.kind === kind),
    );
  assert.ok(!list.items.some((item: any) => item.id === other.group.id));
  assert.equal(
    (await call(admin, "GET", `/v1/admin/content/${f.group.id}/body`)).status,
    403,
  );
  assert.equal(
    (
      await call(admin, "POST", `/v1/admin/content/${f.group.id}/action`, {
        action: "quarantine",
        version: 1,
        reason: "No action permission",
      })
    ).status,
    403,
  );
  await grant([
    "admin.content.body.read",
    "admin.content.quarantine",
    "admin.content.restore",
    "admin.content.delete",
    "admin.content.metadata.write",
  ]);
  const body = JSON.parse(
    (await ok(admin, "GET", `/v1/admin/content/${f.group.id}/body`)).text,
  );
  assert.equal(body.versions[0].body.name, f.group.name);
  const runBody = JSON.parse(
    (await ok(admin, "GET", `/v1/admin/content/${r.id}/body`)).text,
  );
  assert.equal(runBody.definition_hash, r.definition_hash);
  assert.equal(runBody.nodes.length, 2);
  assert.equal(
    (await call(admin, "GET", `/v1/admin/content/${other.group.id}/body`))
      .status,
    403,
  );
  assert.equal(
    (
      await call(admin, "POST", `/v1/admin/content/${f.group.id}/action`, {
        action: "metadata",
        name: "Unversioned rename",
        version: 1,
        reason: "Cannot bypass immutable team versions",
      })
    ).status,
    400,
  );
  await ok(admin, "POST", `/v1/admin/content/${f.group.id}/action`, {
    action: "quarantine",
    version: 1,
    reason: "Stop actual queued team work",
  });
  let row = (
    await s.db.control.query("SELECT * FROM agent_group_runs WHERE id=$1", [
      r.id,
    ])
  ).rows[0];
  assert.equal(row.state, "cancelled");
  assert.equal(row.content_state, "quarantined");
  const holds = (
    await s.db.control.query(
      "SELECT status FROM reservations WHERE task_id=ANY($1::uuid[])",
      [active.tasks.map((t: any) => t.id)],
    )
  ).rows;
  assert.equal(holds.length, 2);
  assert.ok(holds.every((h) => h.status === "released"));
  assert.equal(
    (await call(f.owner, "GET", f.url, undefined, f.tenant)).status,
    404,
  );
  await ok(admin, "POST", `/v1/admin/content/${f.group.id}/action`, {
    action: "restore",
    version: 2,
    reason: "Restore configuration without restarting cancelled work",
  });
  row = (
    await s.db.control.query("SELECT * FROM agent_group_runs WHERE id=$1", [
      r.id,
    ])
  ).rows[0];
  assert.equal(row.state, "cancelled");
  assert.equal(row.content_state, "quarantined");
  await ok(admin, "POST", `/v1/admin/content/${r.id}/action`, {
    action: "restore",
    version: row.moderation_version,
    reason: "Restore historical run access only",
  });
  assert.equal((await get(f, r.id)).state, "cancelled");
  await advanceAgentGroups(s.db, s.catalog);
  assert.equal((await get(f, r.id)).tasks.length, 2);
  await ok(admin, "POST", `/v1/admin/content/${f.group.id}/action`, {
    action: "delete",
    version: 3,
    reason: "Erase actual shared team context",
  });
  const erasure = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) await erasure.advance(30);
  assert.equal(
    (await call(admin, "GET", `/v1/admin/content/${f.group.id}/body`)).status,
    410,
  );
  assert.equal(
    (
      await call(admin, "POST", `/v1/admin/content/${f.group.id}/action`, {
        action: "restore",
        version: 4,
        reason: "Must remain irreversibly deleted",
      })
    ).status,
    409,
  );
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT definition FROM agent_group_runs WHERE id=$1",
        [r.id],
      )
    ).rows[0].definition,
    {},
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE principal_id=$1 AND action='admin.content.body.read' AND target=ANY($2::text[])",
        [id, [f.group.id, r.id]],
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=ANY($1::uuid[])",
        [active.tasks.map((t: any) => t.id)],
      )
    ).rows[0].n,
    2,
  );
});

test("native retention scrubs only expired unused team reviews, then erases terminal run content while preserving accounting", async () => {
  const f = await fixture(),
    unused = await review(f),
    run = await start(f);
  const used = (
    await s.db.control.query(
      "SELECT preflight_id FROM agent_group_runs WHERE id=$1",
      [run.id],
    )
  ).rows[0].preflight_id;
  await s.db.tx(
    async (tx) => {
      await tx.query("SELECT set_config('app.erasing_content','true',true)");
      await tx.query(
        "UPDATE agent_group_preflights SET expires_at=now()-interval '26 hours' WHERE id=ANY($1::uuid[])",
        [[unused.id, used]],
      );
    },
    undefined,
    true,
  );
  const retention = new RetentionService(s.db, s.storage);
  const counts = await retention.expireContent();
  assert.equal(counts?.agent_group_reviews, 1);
  const reviews = (
    await s.db.control.query(
      "SELECT id,definition,erased_at FROM agent_group_preflights WHERE id=ANY($1::uuid[])",
      [[unused.id, used]],
    )
  ).rows;
  assert.deepEqual(reviews.find((p) => p.id === unused.id).definition, {});
  assert.ok(reviews.find((p) => p.id === unused.id).erased_at);
  assert.equal(
    reviews.find((p) => p.id === used).definition.brief,
    plan(f).brief,
  );
  assert.equal(reviews.find((p) => p.id === used).erased_at, null);
  assert.equal(
    (await call(f.owner, "POST", f.url + "/runs", approval(unused), f.tenant))
      .status,
    409,
  );
  await ok(
    f.owner,
    "POST",
    f.url + `/runs/${run.id}/cancel`,
    { expected_revision: run.revision },
    f.tenant,
  );
  await s.db.tx(
    async (tx) => {
      await tx.query("SELECT set_config('app.erasing_content','true',true)");
      await tx.query(
        "UPDATE agent_group_runs SET retention_expires_at=now()-interval '1 hour' WHERE id=$1",
        [run.id],
      );
    },
    undefined,
    true,
  );
  await retention.expireContent();
  assert.equal(
    (await call(f.owner, "GET", f.url + "/runs/" + run.id, undefined, f.tenant))
      .status,
    404,
  );
  const erasure = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) await erasure.advance(30);
  const ended = (
    await s.db.control.query(
      "SELECT content_state,definition FROM agent_group_runs WHERE id=$1",
      [run.id],
    )
  ).rows[0];
  assert.equal(ended.content_state, "deleted");
  assert.deepEqual(ended.definition, {});
  const hold = (
    await s.db.control.query(
      "SELECT status FROM reservations WHERE task_id=$1",
      [run.coordinator_task_id],
    )
  ).rows;
  assert.equal(hold.length, 1);
  assert.equal(hold[0].status, "released");
});
