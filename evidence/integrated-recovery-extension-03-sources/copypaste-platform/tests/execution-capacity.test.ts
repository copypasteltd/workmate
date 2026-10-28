import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { defaults } from "../src/plans.js";
import { Worker } from "../src/worker.js";
import { readyOutbox } from "../src/execution-capacity.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { runMigrations } from "../scripts/migration-runner.js";

let s: Awaited<ReturnType<typeof buildApp>>;
const suffix = randomUUID().replaceAll("-", ""),
  database = "copypaste_capacity_" + suffix;
const dataDir = path.resolve(".data/test/capacity-" + suffix);
let created = false;
const adminUrl = new URL(process.env.OWNER_DATABASE_URL!);
adminUrl.pathname = "/postgres";
type Client = { id: string; cookie: string; csrf: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
) {
  const r = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(
    r.statusCode >= 200 && r.statusCode < 300,
    `${r.statusCode} ${r.body}`,
  );
  return { data: r.json(), r };
}
async function user(): Promise<Client> {
  const { data: ch } = await call(undefined, "POST", "/v1/auth/challenge", {
    email: `capacity-${randomUUID()}@example.invalid`,
  });
  const mail = JSON.parse(
    await readFile(
      path.join(dataDir, "mailbox", ch.challenge_id + ".json"),
      "utf8",
    ),
  );
  const { data, r } = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: ch.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  return {
    id: data.user.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: data.csrf_token,
  };
}
async function fixture() {
  const owner = await user(),
    { data: f } = await call(owner, "POST", "/v1/tenants", {
      name: "Isolated capacity test",
      project_name: "Campaigns",
    });
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [f.tenant.id],
  );
  await s.db.control.query(
    `INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body)
    VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Controlled capacity test',$2)`,
    [f.tenant.id, defaults.business],
  );
  return {
    owner,
    tenant: f.tenant.id as string,
    project: f.project.id as string,
    base: `/v1/tenants/${f.tenant.id}/projects/${f.project.id}`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function task(f: Fixture, role = "assistant", mode = "execute") {
  if (role === "assistant")
    return (
      await call(f.owner, "POST", f.base + "/delegations", {
        title: "Capacity test",
        prompt: "Write a brief.",
        mode,
        budget_micros: 1000000,
        client_message_id: randomUUID(),
      })
    ).data.task;
  return (
    await call(f.owner, "POST", f.base + "/tasks", {
      title: "Capacity test",
      prompt: "Make the deliverable.",
      role_key: role,
      mode,
      budget_micros: 1000000,
    })
  ).data;
}
async function admitted(f: Fixture, t: any, kind = "text", limit = 8) {
  return s.db.tx(
    async (tx) =>
      (
        await tx.query(
          "SELECT claim_execution_capacity($1,$2,$3,$4) AS reason",
          [t.id, kind, limit, randomUUID()],
        )
      ).rows[0].reason as string | null,
    f.tenant,
    false,
    f.owner.id,
  );
}
async function row(t: any) {
  return (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [t.id]))
    .rows[0];
}
async function until(
  check: () => Promise<boolean>,
  description: string,
  timeout = 10000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(description);
}
class HeldRuntime extends CodexRuntimeAdapter {
  calls: string[] = [];
  releases: Array<() => void> = [];
  hold = true;
  constructor() {
    super(s.db.config);
  }
  release() {
    this.hold = false;
    for (const r of this.releases.splice(0)) r();
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls.push(ctx.taskId);
    if (this.hold)
      await new Promise<void>((resolve) => this.releases.push(resolve));
    await ctx.tools
      .find((t) => t.name === "deliver_text")
      ?.run(
        {
          filename: "capacity-result.md",
          mime_type: "text/markdown",
          content: "Controlled synthetic capacity result.",
        },
        randomUUID(),
      );
    return {
      text: "Controlled capacity result.",
      inputTokens: 10,
      outputTokens: 20,
      usageKnown: true,
      accepted: true,
      thread: randomUUID(),
      turn: randomUUID(),
      status: "completed",
    };
  }
}
before(async () => {
  const owner = new pg.Client({ connectionString: adminUrl.href });
  await owner.connect();
  try {
    assert.match(database, /^copypaste_capacity_[a-f0-9]{32}$/);
    await owner.query(`CREATE DATABASE "${database}"`);
    created = true;
    await owner.query(
      `GRANT CONNECT,CREATE ON DATABASE "${database}" TO cp_queue`,
    );
  } finally {
    await owner.end();
  }
  const url = new URL(process.env.OWNER_DATABASE_URL!);
  url.pathname = "/" + database;
  const setup = new pg.Client({ connectionString: url.href });
  await setup.connect();
  try {
    await runMigrations(setup, "isolated execution-capacity database");
  } finally {
    await setup.end();
  }
  const env = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "CONTROL_DATABASE_URL",
    "QUEUE_DATABASE_URL",
  ]) {
    const u = new URL(env[key]!);
    u.pathname = "/" + database;
    env[key] = u.href;
  }
  s = await buildApp(
    loadConfig({
      ...env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      WORKER_CONCURRENCY: "4",
      DEMO_MODE: "false",
      DATA_DIR: dataDir,
      AI_BASE_URL: "http://127.0.0.1:9/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "controlled-fixture",
      AI_MODEL: "controlled-fixture",
      AI_VERIFIED: "true",
      AI_IMAGE_MODEL: "controlled-image",
      AI_IMAGE_VERIFIED: "true",
      AI_IMAGE_HKD_MICROS_PER_IMAGE: "100",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
    }),
    { worker: false },
  );
});
afterEach(async () => {
  if (!s) return;
  await s.db.control.query(
    "UPDATE tasks SET status='cancelled',lease_until=NULL WHERE status IN ('queued','running','reconciling','needs_input')",
  );
  await s.db.control.query(
    "UPDATE outbox SET dispatched_at=now() WHERE dispatched_at IS NULL",
  );
  await s.db.control.query(
    "UPDATE execution_capacity_policy SET agent_slots=10,tenant_slots=2,image_slots=2,media_slots=2,tenant_media_slots=1",
  );
});
after(async () => {
  if (s) await s.app.close();
  if (created) {
    const owner = new pg.Client({ connectionString: adminUrl.href });
    await owner.connect();
    try {
      assert.match(database, /^copypaste_capacity_[a-f0-9]{32}$/);
      await owner.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    } finally {
      await owner.end();
    }
  }
  const relative = path.relative(path.resolve(".data/test"), dataDir);
  assert.match(relative, /^capacity-[a-f0-9]{32}$/);
  await rm(dataDir, { recursive: true, force: true });
});

test("restricted admission rejects another tenant, another actor and direct policy access without exposing counts", async () => {
  const a = await fixture(),
    b = await fixture(),
    t = await task(a);
  for (const [tenant, actor] of [
    [b.tenant, b.owner.id],
    [a.tenant, b.owner.id],
    [a.tenant, undefined],
  ]) {
    await assert.rejects(
      s.db.tx(
        (tx) =>
          tx.query("SELECT claim_execution_capacity($1,$2,8,$3)", [
            t.id,
            "text",
            randomUUID(),
          ]),
        tenant,
        false,
        actor,
      ),
      { code: "42501" },
    );
  }
  await assert.rejects(
    s.db.tx(
      (tx) => tx.query("SELECT * FROM execution_capacity_policy"),
      a.tenant,
      false,
      a.owner.id,
    ),
    { code: "42501" },
  );
  await assert.rejects(
    s.db.tx(
      (tx) => tx.query("UPDATE execution_capacity_policy SET agent_slots=100"),
      a.tenant,
      false,
      a.owner.id,
    ),
    { code: "42501" },
  );
  assert.equal((await row(t)).attempt, 0);
  assert.equal(await admitted(a, t), null);
  await assert.rejects(admitted(a, t), { code: "42501" });
  assert.equal((await row(t)).attempt, 1);
});

test("two workers enforce the shared enterprise cap, leave one original hold queued, allow a second enterprise and settle each task once", async () => {
  const a = await fixture(),
    b = await fixture(),
    tasks = await Promise.all([task(a), task(a), task(a)]),
    other = await task(b);
  const runtime = new HeldRuntime(),
    one = new Worker(s.db, s.catalog, s.storage, runtime),
    two = new Worker(s.db, s.catalog, s.storage, runtime);
  const running = tasks.map((t, i) => (i % 2 ? one : two).run(a.tenant, t.id));
  let outsider: Promise<void> | undefined;
  try {
    await until(
      async () => runtime.calls.length === 2,
      "two original tasks did not start",
    );
    await until(
      async () =>
        (
          await s.db.control.query(
            "SELECT count(*)::int n FROM tasks WHERE tenant_id=$1 AND capacity_wait_reason='tenant'",
            [a.tenant],
          )
        ).rows[0].n === 1,
      "third task did not defer",
    );
    const waiting = (await Promise.all(tasks.map(row))).find(
      (t) => t.status === "queued",
    )!;
    assert.equal(waiting.attempt, 0);
    assert.equal(waiting.capacity_wait_reason, "tenant");
    await Promise.all([
      one.run(a.tenant, waiting.id),
      two.run(a.tenant, waiting.id),
    ]);
    assert.equal(runtime.calls.length, 2);
    const outbox = await s.db.control.query(
      "SELECT count(*)::int n FROM outbox WHERE payload->>'task_id'=$1 AND dispatched_at IS NULL",
      [waiting.id],
    );
    assert.equal(outbox.rows[0].n, 1);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int n FROM task_events WHERE task_id=$1 AND kind='task.capacity_wait'",
          [waiting.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int n FROM reservations WHERE task_id=$1",
          [waiting.id],
        )
      ).rows[0].n,
      1,
    );
    outsider = one.run(b.tenant, other.id);
    await until(
      async () => runtime.calls.includes(other.id),
      "busy enterprise blocked another enterprise",
    );
    const start = performance.now();
    await call(a.owner, "GET", a.base + "/tasks/" + waiting.id);
    assert.ok(performance.now() - start < 1000);
    runtime.release();
    await Promise.all([...running, outsider]);
    await one.run(a.tenant, waiting.id);
    for (const t of [...tasks, other]) {
      const done = await row(t);
      assert.equal(done.status, "succeeded");
      assert.equal(done.attempt, 1);
      assert.equal(Number(done.charged_micros), 30);
    }
    assert.equal(runtime.calls.length, 4);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT reserved_micros FROM wallets WHERE tenant_id=$1",
          [a.tenant],
        )
      ).rows[0].reserved_micros,
      "0",
    );
  } finally {
    runtime.release();
    await Promise.allSettled([...running, ...(outsider ? [outsider] : [])]);
  }
});

test("current user downgrade limits queued work even when the original business reservation allowed more active tasks", async () => {
  const f = await fixture(),
    tasks = [await task(f), await task(f)];
  await s.db.control.query(
    "UPDATE entitlements SET state='revoked' WHERE tenant_id=$1",
    [f.tenant],
  );
  const runtime = new HeldRuntime(),
    worker = new Worker(s.db, s.catalog, s.storage, runtime),
    first = worker.run(f.tenant, tasks[0].id);
  try {
    await until(
      async () => runtime.calls.length === 1,
      "first task did not start",
    );
    await worker.run(f.tenant, tasks[1].id);
    assert.equal((await row(tasks[1])).capacity_wait_reason, "user");
    assert.equal(runtime.calls.length, 1);
    runtime.release();
    await first;
    await worker.run(f.tenant, tasks[1].id);
    assert.equal(runtime.calls.length, 2);
    assert.equal((await row(tasks[1])).status, "succeeded");
  } finally {
    runtime.release();
    await Promise.allSettled([first]);
  }
});

test("platform, image and per-enterprise media limits coordinate across transactions while read-only work uses the text class", async () => {
  const a = await fixture(),
    b = await fixture(),
    c = await fixture();
  await s.db.control.query(
    "UPDATE execution_capacity_policy SET image_slots=1 WHERE data_mode='configured_services'",
  );
  const imageA = await task(a, "designer"),
    imageB = await task(b, "designer"),
    readOnly = await task(b, "designer", "ask");
  assert.equal(await admitted(a, imageA, "image"), null);
  assert.equal(await admitted(b, imageB, "image"), "capability");
  const runtime = new HeldRuntime();
  runtime.release();
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    b.tenant,
    readOnly.id,
  );
  assert.equal((await row(readOnly)).execution_class, "text");
  assert.equal((await row(readOnly)).status, "succeeded");
  const mediaA = await task(a),
    mediaB = await task(a),
    mediaC = await task(c);
  await s.db.control.query("UPDATE tasks SET status='cancelled' WHERE id=$1", [
    imageA.id,
  ]);
  assert.equal(await admitted(a, mediaA, "media"), null);
  assert.equal(await admitted(a, mediaB, "media"), "tenant_media");
  assert.equal(await admitted(c, mediaC, "media"), null);
  await s.db.control.query(
    "UPDATE execution_capacity_policy SET agent_slots=2 WHERE data_mode='configured_services'",
  );
  assert.equal(await admitted(b, imageB, "image"), "platform");
  assert.equal((await row(imageB)).attempt, 0);
});

test("uncertain paid execution keeps its slot, while an unclaimed input wait occupies no execution slot", async () => {
  const f = await fixture(),
    g = await fixture();
  const unknown = await task(f),
    waiting = await task(f);
  assert.equal(await admitted(f, unknown), null);
  await s.db.control.query(
    "UPDATE tasks SET status='reconciling',lease_until=now()-interval '1 minute' WHERE id=$1",
    [unknown.id],
  );
  assert.equal(await admitted(f, waiting, "text", 1), "user");
  await s.db.control.query("UPDATE tasks SET status='cancelled' WHERE id=$1", [
    unknown.id,
  ]);
  const input = (
    await call(g.owner, "POST", g.base + "/delegations", {
      title: "Explicit missing file",
      prompt: "Use the approved material.",
      budget_micros: 1000000,
      client_message_id: randomUUID(),
      dependencies: [{ kind: "file", description: "Approved source" }],
    })
  ).data.task;
  assert.equal(input.status, "needs_input");
  assert.equal(input.attempt, 0);
  assert.equal(await admitted(f, waiting, "text", 1), null);
});

test("fair outbox dispatch includes the other enterprise before an older flood and excludes deferred or wrong-mode tasks", async () => {
  const a = await fixture(),
    b = await fixture(),
    ta = await task(a),
    tb = await task(b);
  await s.db.control.query(
    `INSERT INTO outbox(tenant_id,topic,payload,created_at)
    SELECT $1,'task.run',jsonb_build_object('task_id',$2::text),now()-interval '1 hour' FROM generate_series(1,25)`,
    [a.tenant, ta.id],
  );
  const ready = await s.db.tx(
    (tx) => readyOutbox(tx, "configured_services"),
    undefined,
    true,
  );
  assert.equal(ready.length, 20);
  assert.equal(ready[0].tenant_id, a.tenant);
  assert.equal(ready[1].tenant_id, b.tenant);
  assert.equal(ready[1].payload.task_id, tb.id);
  await s.db.control.query(
    "UPDATE tasks SET capacity_retry_at=now()+interval '1 hour' WHERE id=$1",
    [ta.id],
  );
  const deferred = await s.db.tx(
    (tx) => readyOutbox(tx, "configured_services"),
    undefined,
    true,
  );
  assert.deepEqual(
    deferred.map((x) => x.payload.task_id),
    [tb.id],
  );
  assert.equal(
    (await s.db.tx((tx) => readyOutbox(tx, "simulated"), undefined, true))
      .length,
    0,
  );
});

test("native pg-boss starts multiple handlers and automatically resumes the original deferred task without a second reservation", async () => {
  const f = await fixture(),
    tasks = [await task(f), await task(f), await task(f)],
    runtime = new HeldRuntime(),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  try {
    await worker.start();
    await until(
      async () => runtime.calls.length === 2,
      "native queue did not use independent handlers",
      15000,
    );
    await until(
      async () =>
        (
          await s.db.control.query(
            "SELECT count(*)::int n FROM tasks WHERE tenant_id=$1 AND capacity_wait_reason='tenant'",
            [f.tenant],
          )
        ).rows[0].n === 1,
      "native queue did not defer its third task",
      15000,
    );
    runtime.release();
    await until(
      async () =>
        (
          await s.db.control.query(
            "SELECT count(*)::int n FROM tasks WHERE tenant_id=$1 AND status='succeeded'",
            [f.tenant],
          )
        ).rows[0].n === 3,
      "native queue did not resume the same task",
      20000,
    );
    assert.equal(runtime.calls.length, 3);
    assert.equal(new Set(runtime.calls).size, 3);
    for (const t of tasks) {
      assert.equal((await row(t)).attempt, 1);
      assert.equal(
        (
          await s.db.control.query(
            "SELECT count(*)::int n FROM reservations WHERE task_id=$1",
            [t.id],
          )
        ).rows[0].n,
        1,
      );
    }
  } finally {
    runtime.release();
    await worker.stop();
  }
});
