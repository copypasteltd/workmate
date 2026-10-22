import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { hash } from "../src/lib.js";
import { Worker } from "../src/worker.js";
import { defaults } from "../src/plans.js";
import { saveAsset } from "../src/storage.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import contract from "../contracts/task-schemas.json" with { type: "json" };

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
const ajv = new Ajv2020({ allErrors: true, strict: false });
(createRequire(import.meta.url)("ajv-formats") as (a: Ajv2020) => void)(ajv);
const definitions = JSON.parse(
  JSON.stringify(contract.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
function check(name: string, value: unknown) {
  const validate = ajv.compile({ $defs: definitions, $ref: "#/$defs/" + name });
  assert.ok(validate(value), JSON.stringify(validate.errors));
}
async function call(
  c: Client | undefined,
  tenant: string | undefined,
  method: string,
  url: string,
  body?: unknown,
  options: { key?: string | null; headers?: Record<string, string> } = {},
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(options.key === null
        ? {}
        : { "idempotency-key": options.key ?? randomUUID() }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(
  c: Client | undefined,
  tenant: string | undefined,
  method: string,
  url: string,
  body?: unknown,
) {
  const r = await call(c, tenant, method, url, body);
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${r.status}: ${JSON.stringify(r.data)}`,
  );
  return r.data;
}
async function user(): Promise<Client> {
  const ch = await ok(undefined, undefined, "POST", "/v1/auth/challenge", {
    email: `task-contract-${randomUUID()}@example.invalid`,
  });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, undefined, "POST", "/v1/auth/verify", {
    challenge_id: ch.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(r.status, 200);
  return {
    id: r.data.user.id,
    csrf: r.data.csrf_token,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
  };
}
async function fixture(plan: "starter" | "business" = "business") {
  const owner = await user();
  const w = await ok(owner, undefined, "POST", "/v1/tenants", {
    name: "Canonical task fixture",
    project_name: "One actual task",
  });
  const tenant = w.tenant.id,
    project = w.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [tenant],
  );
  if (plan === "business")
    await s.db.control.query(
      "INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Controlled canonical task fixture',$2)",
      [tenant, defaults.business],
    );
  const agent = await ok(owner, tenant, "POST", base + "/agents", {
    name: "Fixture specialist",
    role_key: "assistant",
  });
  return { owner, tenant, project, base, agent };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(f: Fixture, overrides: any = {}) {
  return {
    project_id: f.project,
    agent_id: f.agent.id,
    type: "delegation",
    input: { prompt: "Write a clearly simulated campaign brief." },
    budget: { currency: "HKD", amount_micros: "1000000" },
    ...overrides,
  };
}
async function create(f: Fixture, overrides: any = {}) {
  const r = await call(
    f.owner,
    f.tenant,
    "POST",
    "/v1/tasks",
    input(f, overrides),
  );
  assert.equal(r.status, 202, JSON.stringify(r.data));
  check("TaskAccepted", r.data);
  assert.equal(r.raw.headers.location, r.data.location);
  return r.data;
}
async function task(f: Fixture, id: string) {
  const result = await ok(f.owner, f.tenant, "GET", `/v1/tasks/${id}`);
  check("Task", result);
  return result;
}
const row = async (id: string) =>
  (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [id])).rows[0];
async function file(f: Fixture, content = "Explicit user-selected source") {
  return s.db.tx(async (tx) => {
    await tx.query("SELECT set_config('app.actor_id',$1,true)", [f.owner.id]);
    return saveAsset(tx, s.storage, {
      tenant: f.tenant,
      project: f.project,
      user: f.owner.id,
      name: randomUUID() + ".txt",
      kind: "source",
      mime: "text/plain",
      bytes: Buffer.from(content),
    });
  }, f.tenant);
}
class FixtureRuntime extends CodexRuntimeAdapter {
  calls = 0;
  hold?: Promise<void>;
  entered?: () => void;
  uncertain = false;
  deliver = false;
  constructor() {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls++;
    this.entered?.();
    await this.hold;
    if (this.deliver)
      await ctx.tools
        .find((t) => t.name === "deliver_text")!
        .run(
          {
            filename: "canonical-result.md",
            content: "Clearly simulated result.",
            mime_type: "text/markdown",
          },
          "canonical-delivery",
        );
    return {
      text: "Clearly simulated completed brief.",
      inputTokens: 10,
      outputTokens: 20,
      accepted: true,
      usageKnown: !this.uncertain,
      status: "completed",
      thread: "canonical-fixture",
      turn: "turn-1",
    };
  }
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
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
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

test("task schema copies retain the immutable original conditions, Money, statuses and strict response fields", async () => {
  const raw = await readFile("../../docs/contracts/openapi.json"),
    original = JSON.parse(raw.toString());
  assert.equal(hash(raw), contract.source_sha256);
  for (const [name, value] of Object.entries(contract.schemas))
    assert.deepEqual(value, original.components.schemas[name]);
  assert.equal(Object.keys(contract.schemas).length, 20);
});

test("canonical create accepts once under concurrent retries, reserves exact HKD once, and exposes the same nested task", async () => {
  const f = await fixture(),
    body = input(f),
    key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(f.owner, f.tenant, "POST", "/v1/tasks", body, { key }),
    ),
  );
  for (const r of results) {
    assert.equal(r.status, 202, JSON.stringify(r.data));
    check("TaskAccepted", r.data);
    assert.deepEqual(r.data, results[0]!.data);
  }
  const id = results[0]!.data.task_id,
    dto = await task(f, id),
    nested = await ok(f.owner, f.tenant, "GET", f.base + "/tasks/" + id);
  assert.equal(dto.id, nested.id);
  assert.equal(dto.agent_id, f.agent.id);
  assert.equal(dto.type, "delegation");
  assert.deepEqual(dto.input, body.input);
  assert.equal(dto.confirmed_cost.amount_micros, "0");
  assert.equal(dto.attempt_id, nested.initial_attempt_id);
  assert.equal(dto.last_seq, Number(nested.last_event_seq));
  for (const field of [
    "runtime_thread",
    "fencing_token",
    "actor_auth_version",
    "input_context",
    "role_hash",
    "billing_account_id",
  ])
    assert.equal(field in dto, false);
  const holds = (
    await s.db.control.query("SELECT * FROM reservations WHERE task_id=$1", [
      id,
    ])
  ).rows;
  assert.equal(holds.length, 1);
  assert.equal(String(holds[0].amount_micros), "1000000");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT reserved_micros FROM wallets WHERE tenant_id=$1",
        [f.tenant],
      )
    ).rows[0].reserved_micros,
    "1000000",
  );
  assert.equal(
    (
      await call(
        f.owner,
        f.tenant,
        "POST",
        "/v1/tasks",
        { ...body, budget: { currency: "HKD", amount_micros: "1000001" } },
        { key },
      )
    ).status,
    409,
  );
});

test("strict canonical commands reject malformed Money, unsupported specialized semantics, invalid references and unknown fields before reservation", async () => {
  const f = await fixture();
  for (const budget of [
    { currency: "USD", amount_micros: "1" },
    { currency: "HKD", amount_micros: 1000 },
    { currency: "HKD", amount_micros: "01" },
    { currency: "HKD", amount_micros: "1e6" },
    { currency: "HKD", amount_micros: "-1" },
    { currency: "HKD", amount_micros: "1", extra: true },
  ])
    assert.equal(
      (await call(f.owner, f.tenant, "POST", "/v1/tasks", input(f, { budget })))
        .status,
      400,
    );
  for (const amount of [
    "0",
    "1000000000001",
    "9007199254740993",
    "9".repeat(500),
  ])
    assert.equal(
      (
        await call(
          f.owner,
          f.tenant,
          "POST",
          "/v1/tasks",
          input(f, { budget: { currency: "HKD", amount_micros: amount } }),
        )
      ).status,
      422,
    );
  for (const change of [
    { extra: true },
    { agent_id: undefined },
    { agent_group_id: randomUUID() },
    { type: "creative_image", input: { prompt: "Incomplete creative input" } },
  ])
    assert.equal(
      (await call(f.owner, f.tenant, "POST", "/v1/tasks", input(f, change)))
        .status,
      400,
    );
  for (const change of [
    { workspace_id: randomUUID() },
    { confirmed_plan_id: randomUUID() },
    { device_id: randomUUID() },
    { source_cell_ids: [] },
    {
      type: "workflow",
      input: { prompt: "Run workflow", workflow_version_id: randomUUID() },
    },
    {
      type: "creative_image",
      input: {
        prompt: "Draw",
        locales: ["zh-HK"],
        sizes: [{ width: 1024, height: 1024 }],
      },
    },
  ]) {
    const r = await call(
      f.owner,
      f.tenant,
      "POST",
      "/v1/tasks",
      input(f, change),
    );
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data.error.code, "TASK_CONTRACT_CAPABILITY_UNAVAILABLE");
  }
  assert.equal(
    (
      await call(
        f.owner,
        f.tenant,
        "POST",
        "/v1/tasks",
        input(f, { agent_id: randomUUID() }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM tasks WHERE tenant_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT reserved_micros FROM wallets WHERE tenant_id=$1",
        [f.tenant],
      )
    ).rows[0].reserved_micros,
    "0",
  );
});

test("canonical create requires current authentication, CSRF, selected tenant and idempotency; explicit unsupported payer cannot slip through", async () => {
  const f = await fixture(),
    body = input(f);
  assert.equal(
    (await call(undefined, f.tenant, "POST", "/v1/tasks", body)).status,
    401,
  );
  assert.equal(
    (
      await call(f.owner, f.tenant, "POST", "/v1/tasks", body, {
        headers: { "x-csrf-token": "wrong" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(f.owner, undefined, "POST", "/v1/tasks", body)).status,
    400,
  );
  assert.equal(
    (await call(f.owner, f.tenant, "POST", "/v1/tasks", body, { key: null }))
      .status,
    400,
  );
  assert.equal(
    (await call(f.owner, randomUUID(), "POST", "/v1/tasks", body)).status,
    404,
  );
  assert.equal(
    (
      await call(f.owner, f.tenant, "POST", "/v1/tasks", body, {
        headers: { "x-billing-account-id": randomUUID() },
      })
    ).status,
    400,
  );
});

test("canonical ask, plan and execute preserve the selected mode without inferring a different business task type", async () => {
  const f = await fixture();
  for (const mode of ["ask", "plan", "execute"]) {
    const a = await create(f, { mode, input: { prompt: "Hi" } }),
      dto = await task(f, a.task_id);
    assert.equal(dto.mode, mode);
    assert.equal(dto.type, "delegation");
    assert.equal(dto.status, "queued");
  }
});

test("a canonical delegation executes through the real worker, returns actual artifact identities and one settled charge", async () => {
  const f = await fixture(),
    a = await create(f),
    runtime = new FixtureRuntime();
  runtime.deliver = true;
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    a.task_id,
  );
  const dto = await task(f, a.task_id),
    actual = await row(a.task_id);
  assert.equal(runtime.calls, 1);
  assert.equal(dto.status, "succeeded");
  assert.equal(dto.cost_state, "confirmed");
  assert.equal(dto.confirmed_cost.amount_micros, String(actual.charged_micros));
  assert.ok(BigInt(dto.confirmed_cost.amount_micros) > 0n);
  assert.equal(dto.artifact_ids.length, 1);
  const artifact = (
    await s.db.control.query(
      "SELECT a.id,v.storage_key FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE v.metadata->>'task_id'=$1",
      [a.task_id],
    )
  ).rows[0];
  assert.equal(dto.artifact_ids[0], artifact.id);
  assert.equal(
    (await s.storage.get(artifact.storage_key)).toString(),
    "Clearly simulated result.",
  );
  assert.equal(dto.steps[0].state, "completed");
  assert.equal(dto.attempt_id, actual.fencing_token);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [a.task_id],
      )
    ).rows[0].n,
    1,
  );
});

test("canonical pause, resume and cancel are versioned, idempotent and preserve one original task and budget", async () => {
  const f = await fixture(),
    a = await create(f),
    url = a.location + "/controls",
    key = randomUUID();
  const command = {
    action: "pause",
    expected_version: a.version,
    reason: "Wait for review",
  };
  const p = await call(f.owner, f.tenant, "POST", url, command, { key });
  assert.equal(p.status, 202, JSON.stringify(p.data));
  check("Task", p.data);
  assert.equal(p.data.status, "paused");
  assert.deepEqual(
    (await call(f.owner, f.tenant, "POST", url, command, { key })).data,
    p.data,
  );
  assert.equal(
    (
      await call(f.owner, f.tenant, "POST", url, {
        action: "resume",
        expected_version: a.version,
      })
    ).status,
    409,
  );
  const resumed = await ok(f.owner, f.tenant, "POST", url, {
    action: "resume",
    expected_version: p.data.version,
  });
  assert.equal(resumed.status, "queued");
  const cancelled = await ok(f.owner, f.tenant, "POST", url, {
    action: "cancel",
    expected_version: resumed.version,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cost_state, "confirmed");
  assert.equal(cancelled.confirmed_cost.amount_micros, "0");
  const replayed = await call(f.owner, f.tenant, "POST", url, command, { key });
  assert.equal(replayed.status, 202);
  assert.equal(replayed.data.status, "cancelled");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM tasks WHERE tenant_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [a.task_id],
      )
    ).rows[0].status,
    "released",
  );
});

test("an unknown accepted operation remains reconciliable and cannot be retried or disguised as a completed task", async () => {
  const f = await fixture(),
    a = await create(f),
    runtime = new FixtureRuntime();
  runtime.uncertain = true;
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    a.task_id,
  );
  const dto = await task(f, a.task_id);
  assert.equal((await row(a.task_id)).status, "reconciling");
  assert.equal(dto.status, "paused");
  assert.equal(dto.cost_state, "reconciling");
  assert.equal(dto.steps[0].state, "unknown");
  const retry = await call(
    f.owner,
    f.tenant,
    "POST",
    a.location + "/controls",
    { action: "retry", expected_version: dto.version },
  );
  assert.equal(retry.status, 409);
  assert.equal(retry.data.error.code, "TASK_RETRY_CHECKPOINT_UNAVAILABLE");
  const cancelled = await ok(
    f.owner,
    f.tenant,
    "POST",
    a.location + "/controls",
    { action: "cancel", expected_version: dto.version },
  );
  assert.equal(cancelled.status, "cancelling");
  assert.equal(cancelled.cost_state, "reconciling");
  assert.equal(runtime.calls, 1);
});

test("canonical batched prerequisite answers validate all resources atomically and queue the original task once", async () => {
  const f = await fixture(),
    x = await file(f),
    y = await file(f),
    other = await fixture(),
    forbidden = await file(other);
  const a = await create(f, {
    dependencies: [
      { kind: "file", description: "First source" },
      { kind: "file", description: "Second source" },
    ],
  });
  assert.equal(a.status, "needs_input");
  const dto = await task(f, a.task_id);
  assert.deepEqual(dto.pending_input_fields, ["input-1", "input-2"]);
  const body = {
    expected_version: dto.version,
    answers: {
      "input-1": { resource_ids: [x.version.id] },
      "input-2": { resource_ids: [forbidden.version.id] },
    },
  };
  const rejected = await call(
    f.owner,
    f.tenant,
    "POST",
    a.location + "/inputs",
    body,
  );
  assert.equal(rejected.status, 404);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM task_dependencies WHERE task_id=$1 AND state='resolved'",
        [a.task_id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal((await row(a.task_id)).version, dto.version);
  body.answers["input-2"].resource_ids = [y.version.id];
  assert.equal(
    (
      await call(f.owner, f.tenant, "POST", a.location + "/inputs", {
        ...body,
        asset_version_ids: [x.version.id],
      })
    ).status,
    422,
  );
  const key = randomUUID(),
    response = await call(
      f.owner,
      f.tenant,
      "POST",
      a.location + "/inputs",
      body,
      { key },
    );
  assert.equal(response.status, 202, JSON.stringify(response.data));
  check("Task", response.data);
  assert.equal(response.data.status, "queued");
  assert.equal(response.data.id, a.task_id);
  assert.deepEqual(response.data.pending_input_fields, []);
  assert.deepEqual(
    (
      await call(f.owner, f.tenant, "POST", a.location + "/inputs", body, {
        key,
      })
    ).data,
    response.data,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1 AND dispatched_at IS NULL",
        [a.task_id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [a.task_id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await call(f.owner, f.tenant, "POST", a.location + "/inputs", body))
      .status,
    409,
  );
});

test("malformed or unknown answers never become ignored text, duplicate resources or partial input updates", async () => {
  const f = await fixture(),
    a = await create(f, {
      dependencies: [{ kind: "file", description: "Need a selected file" }],
    }),
    v = await file(f);
  for (const answers of [
    {},
    { "input-1": "Just continue" },
    { "input-1": { resource_ids: [v.version.id], extra: true } },
    { "input-1": { resource_ids: [v.version.id, v.version.id] } },
    { nonexistent: { resource_ids: [v.version.id] } },
  ]) {
    const r = await call(f.owner, f.tenant, "POST", a.location + "/inputs", {
      expected_version: a.version,
      answers,
    });
    assert.ok([400, 409].includes(r.status), JSON.stringify(r.data));
  }
  assert.equal((await row(a.task_id)).status, "needs_input");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM task_dependencies WHERE task_id=$1 AND state='resolved'",
        [a.task_id],
      )
    ).rows[0].n,
    0,
  );
});

test("explicit delegation asset versions become authorized frozen prerequisites rather than ignored prompt references", async () => {
  const f = await fixture(),
    v = await file(f),
    a = await create(f, {
      input: {
        prompt: "Read this explicitly selected asset.",
        asset_version_ids: [v.version.id],
      },
    });
  const d = (
    await s.db.control.query(
      "SELECT * FROM task_dependencies WHERE task_id=$1",
      [a.task_id],
    )
  ).rows[0];
  assert.equal(a.status, "queued");
  assert.equal(d.state, "resolved");
  assert.deepEqual(d.resource_ids, [v.version.id]);
  const foreign = await fixture(),
    foreignFile = await file(foreign);
  const r = await call(
    f.owner,
    f.tenant,
    "POST",
    "/v1/tasks",
    input(f, {
      input: {
        prompt: "Invalid selection",
        asset_version_ids: [foreignFile.version.id],
      },
    }),
  );
  assert.equal(r.status, 404);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE tenant_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    1,
  );
});

test("signed keyset pagination is stable and revalidates account, tenant, project scope, filters and limits", async () => {
  const f = await fixture();
  const created = await Promise.all(Array.from({ length: 4 }, () => create(f)));
  const found: string[] = [];
  let cursor: string | null = null,
    firstCursor = "";
  do {
    const page: any = await ok(
      f.owner,
      f.tenant,
      "GET",
      "/v1/tasks?limit=1" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    check("TaskList", page);
    assert.equal(page.items.length, 1);
    found.push(page.items[0].id);
    cursor = page.next_cursor;
    if (!firstCursor && cursor) firstCursor = cursor;
  } while (cursor);
  assert.deepEqual([...found].sort(), created.map((a) => a.task_id).sort());
  assert.equal(new Set(found).size, 4);
  for (const url of [
    "/v1/tasks?limit=0",
    "/v1/tasks?limit=101",
    "/v1/tasks?extra=true",
    "/v1/tasks?cursor=corrupt",
    `/v1/tasks?cursor=${encodeURIComponent(firstCursor + "tampered")}`,
    `/v1/tasks?project_id=${f.project}&cursor=${encodeURIComponent(firstCursor)}`,
  ])
    assert.equal((await call(f.owner, f.tenant, "GET", url)).status, 400);
  const foreign = await fixture();
  assert.equal(
    (
      await call(
        foreign.owner,
        foreign.tenant,
        "GET",
        "/v1/tasks?cursor=" + encodeURIComponent(firstCursor),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        f.owner,
        f.tenant,
        "GET",
        "/v1/tasks?project_id=" + foreign.project,
      )
    ).status,
    404,
  );
  await s.db.control.query(
    "UPDATE memberships SET status='removed' WHERE tenant_id=$1 AND user_id=$2",
    [f.tenant, f.owner.id],
  );
  assert.equal(
    (
      await call(
        f.owner,
        f.tenant,
        "GET",
        "/v1/tasks?cursor=" + encodeURIComponent(firstCursor),
      )
    ).status,
    404,
  );
});

test("canonical task access and saved receipts cannot cross private owners, project grants, tenants or quarantined content", async () => {
  const f = await fixture(),
    member = await user(),
    key = randomUUID(),
    body = input(f);
  const accepted = await call(f.owner, f.tenant, "POST", "/v1/tasks", body, {
    key,
  });
  assert.equal(accepted.status, 202);
  const id = accepted.data.task_id;
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [f.tenant, member.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, member.id],
  );
  assert.equal(
    (await call(member, f.tenant, "GET", "/v1/tasks/" + id)).status,
    404,
  );
  assert.deepEqual((await ok(member, f.tenant, "GET", "/v1/tasks")).items, []);
  assert.equal(
    (
      await call(member, f.tenant, "POST", "/v1/tasks/" + id + "/controls", {
        action: "cancel",
        expected_version: accepted.data.version,
      })
    ).status,
    404,
  );
  const foreign = await fixture();
  assert.equal(
    (await call(f.owner, foreign.tenant, "GET", "/v1/tasks/" + id)).status,
    404,
  );
  await s.db.control.query(
    "UPDATE tasks SET content_state='quarantined' WHERE id=$1",
    [id],
  );
  assert.equal(
    (await call(f.owner, f.tenant, "POST", "/v1/tasks", body, { key })).status,
    404,
  );
  assert.equal(
    (await call(f.owner, f.tenant, "GET", "/v1/tasks/" + id)).status,
    404,
  );
});

test("conversation delegations serialize busy checks, retain the pinned specialist and append exactly one user message", async () => {
  const f = await fixture();
  const c = await ok(f.owner, f.tenant, "POST", f.base + "/conversations", {
    name: "Contract conversation",
    agent_id: f.agent.id,
  });
  const body = input(f, { conversation_id: c.id }),
    key = randomUUID();
  const [x, y] = await Promise.all([
    call(f.owner, f.tenant, "POST", "/v1/tasks", body, { key }),
    call(f.owner, f.tenant, "POST", "/v1/tasks", body),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [202, 409]);
  const accepted = x.status === 202 ? x : y;
  assert.equal((await task(f, accepted.data.task_id)).conversation_id, c.id);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM conversation_messages WHERE conversation_id=$1",
        [c.id],
      )
    ).rows[0].n,
    1,
  );
  const mismatch = await call(
    f.owner,
    f.tenant,
    "POST",
    "/v1/tasks",
    input(f, { conversation_id: c.id, agent_id: randomUUID() }),
  );
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.data.error.code, "CONVERSATION_AGENT_MISMATCH");
});

test("historical bound delegations project without fabricated identity, while unbound legacy rows retain their original interface", async () => {
  const f = await fixture();
  const base = {
    title: "Historical task",
    prompt: "Keep the actual old request.",
    role_key: "assistant",
    budget_micros: 1000000,
  };
  const bound = await ok(f.owner, f.tenant, "POST", f.base + "/tasks", {
    ...base,
    agent_id: f.agent.id,
  });
  const unbound = await ok(f.owner, f.tenant, "POST", f.base + "/tasks", base);
  assert.equal((await task(f, bound.id)).agent_id, f.agent.id);
  assert.equal(
    (await call(f.owner, f.tenant, "GET", "/v1/tasks/" + unbound.id)).status,
    409,
  );
  assert.equal(
    (await ok(f.owner, f.tenant, "GET", f.base + "/tasks/" + unbound.id)).id,
    unbound.id,
  );
  const listed = await ok(f.owner, f.tenant, "GET", "/v1/tasks");
  assert.deepEqual(
    listed.items.map((t: any) => t.id),
    [bound.id],
  );
});

test("canonical task creation retains Starter quotas and rejects plan budgets without creating another hold", async () => {
  const f = await fixture("starter"),
    a = await create(f);
  const quota = await call(f.owner, f.tenant, "POST", "/v1/tasks", input(f));
  assert.equal(quota.status, 409);
  assert.equal(quota.data.error.code, "PLAN_TASK_LIMIT");
  const budget = await call(
    f.owner,
    f.tenant,
    "POST",
    "/v1/tasks",
    input(f, { budget: { currency: "HKD", amount_micros: "100000001" } }),
  );
  assert.equal(budget.status, 403);
  assert.equal(budget.data.error.code, "PLAN_BUDGET_LIMIT");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE tenant_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await task(f, a.task_id)).status, "queued");
});

test("source revocation hides canonical inputs and artifacts on detail, list and successful control replay", async () => {
  const f = await fixture();
  const memory = await ok(f.owner, f.tenant, "POST", f.base + "/memories", {
    name: "Revocable context",
    scope: "project",
    content: "A controlled context source",
  });
  const canary = "SOURCE-PROMPT-" + randomUUID();
  const a = await create(f, { input: { prompt: canary } }),
    key = randomUUID();
  const pause = { action: "pause", expected_version: a.version };
  const first = await call(
    f.owner,
    f.tenant,
    "POST",
    a.location + "/controls",
    pause,
    { key },
  );
  assert.equal(first.status, 202);
  assert.equal(first.data.input.prompt, canary);
  await s.db.control.query(
    "UPDATE memories SET content_state='quarantined' WHERE id=$1",
    [memory.id],
  );
  const dto = await task(f, a.task_id),
    list = await ok(f.owner, f.tenant, "GET", "/v1/tasks");
  const replayed = await call(
    f.owner,
    f.tenant,
    "POST",
    a.location + "/controls",
    pause,
    { key },
  );
  assert.equal(replayed.status, 202);
  for (const value of [dto, list.items[0], replayed.data]) {
    assert.equal(value.input, undefined);
    assert.deepEqual(value.artifact_ids, []);
    assert.equal(value.steps[0].error_code, "TASK_SOURCE_REVOKED");
    assert.equal(JSON.stringify(value).includes(canary), false);
  }
  assert.equal(
    (
      await call(f.owner, f.tenant, "POST", a.location + "/controls", {
        action: "resume",
        expected_version: dto.version,
      })
    ).status,
    409,
  );
  const cancelled = await ok(
    f.owner,
    f.tenant,
    "POST",
    a.location + "/controls",
    { action: "cancel", expected_version: dto.version },
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cost_state, "confirmed");
});

test("canonical answers resume a measured paid checkpoint on the same thread and settle cumulative usage once", async () => {
  const f = await fixture(),
    v = await file(f),
    a = await create(f);
  const thread = "canonical-paid-" + randomUUID();
  let calls = 0;
  const observed: { thread?: string; file_selected: boolean }[] = [];
  const runtime = new (class extends CodexRuntimeAdapter {
    override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
      const attempt = ++calls,
        turn = "turn-" + attempt;
      observed.push({
        thread: ctx.thread,
        file_selected: ctx.prompt.includes(v.name),
      });
      await ctx.onEvent("runtime.thread", { thread_id: thread });
      await ctx.onEvent("runtime.turn", { turn_id: turn });
      if (attempt === 1)
        await ctx.tools
          .find((t) => t.name === "request_input")!
          .run(
            {
              requests: [
                { kind: "file", description: "Select the approved file" },
              ],
            },
            "canonical-paid-input",
          );
      else {
        assert.equal(ctx.thread, thread);
        assert.ok(ctx.prompt.includes(v.name));
      }
      return {
        text: "Controlled canonical paid turn",
        inputTokens: 100,
        outputTokens: 50,
        usageKnown: true,
        accepted: true,
        status: "completed",
        thread,
        turn,
      };
    }
  })(s.db.config);
  const worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, a.task_id);
  const waiting = await task(f, a.task_id);
  assert.equal(waiting.status, "needs_input");
  assert.equal(waiting.confirmed_cost.amount_micros, "150");
  assert.equal(waiting.cost_state, "estimated");
  assert.equal(waiting.pending_input_fields.length, 1);
  const field = waiting.pending_input_fields[0];
  const ready = await ok(f.owner, f.tenant, "POST", a.location + "/inputs", {
    expected_version: waiting.version,
    answers: { [field]: { resource_ids: [v.version.id] } },
    asset_version_ids: [v.version.id],
  });
  check("Task", ready);
  assert.equal(ready.id, a.task_id);
  assert.equal(ready.status, "queued");
  await worker.run(f.tenant, a.task_id);
  const done = await task(f, a.task_id);
  assert.equal(calls, 2);
  assert.equal(done.status, "succeeded", JSON.stringify({ done, observed }));
  assert.equal(done.cost_state, "confirmed");
  assert.equal(done.confirmed_cost.amount_micros, "300");
  assert.notEqual(done.attempt_id, waiting.attempt_id);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [a.task_id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [a.task_id],
      )
    ).rows[0].n,
    1,
  );
});

test("canonical pause cannot race a claimed turn into a second execution or release its pending budget", async () => {
  const f = await fixture(),
    a = await create(f),
    runtime = new FixtureRuntime();
  let release!: () => void, entered!: () => void;
  runtime.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  runtime.entered = entered;
  const running = new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    a.task_id,
  );
  try {
    await started;
    const current = await task(f, a.task_id);
    assert.equal(current.status, "running");
    const stale = await call(
      f.owner,
      f.tenant,
      "POST",
      a.location + "/controls",
      { action: "pause", expected_version: a.version },
    );
    assert.equal(stale.status, 409);
    const unavailable = await call(
      f.owner,
      f.tenant,
      "POST",
      a.location + "/controls",
      { action: "pause", expected_version: current.version },
    );
    assert.equal(unavailable.status, 409);
    assert.equal(unavailable.data.error.code, "CANNOT_PAUSE");
    assert.equal(
      (
        await s.db.control.query(
          "SELECT status FROM reservations WHERE task_id=$1",
          [a.task_id],
        )
      ).rows[0].status,
      "reserved",
    );
  } finally {
    release();
    await running;
  }
  assert.equal(runtime.calls, 1);
  assert.equal((await task(f, a.task_id)).status, "succeeded");
});

test("actual Fastify inventory retains declared routes and the five canonical task method/path pairs", async () => {
  const declared = JSON.parse(
    await readFile("contracts/implemented-routes.json", "utf8"),
  );
  const routes = [...s.routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  const routeKey = (r: { method: string; path: string }) =>
    r.method + " " + r.path.replace(/:[^/]+/g, ":parameter");
  const actual = new Set(routes.map(routeKey));
  console.log(
    "# canonical_task_route_inventory " +
      JSON.stringify({
        contract: "actual_fastify_route_inventory",
        not_full_design_openapi: true,
        routes,
      }),
  );
  // The old implementation inventory predates the state-bound connector OAuth
  // callback. This is an explicit legacy implementation-path replacement, not
  // a removal from the immutable normative OpenAPI or its acceptance cases.
  for (const r of declared.routes) {
    const replacement =
      r.path === "/v1/oauth/:provider/callback"
        ? { ...r, path: "/v1/connections/callback" }
        : r;
    assert.ok(
      actual.has(routeKey(replacement)),
      "Previously declared route missing: " + r.path,
    );
  }
  for (const pair of [
    "GET /v1/tasks",
    "POST /v1/tasks",
    "GET /v1/tasks/:task_id",
    "POST /v1/tasks/:task_id/controls",
    "POST /v1/tasks/:task_id/inputs",
  ])
    assert.ok(actual.has(pair.replace(/:[^/]+/g, ":parameter")));
});
