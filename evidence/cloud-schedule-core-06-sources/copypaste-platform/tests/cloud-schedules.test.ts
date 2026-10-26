import {
  advanceCloudSchedules,
  purgeUnavailableCloudSchedules,
} from "../src/cloud-schedules.js";
import { nextOccurrence } from "../src/schedule-time.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import * as OTPAuth from "otpauth";
import { readFile } from "node:fs/promises";
import { advanceCloudWorkflows } from "../src/cloud-workflows.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { advanceConnectors } from "../src/connectors.js";
import { desktopCompanyToolSchema } from "../src/desktop-tool-policy.js";
import { hash, seal } from "../src/lib.js";
import { saveAsset } from "../src/storage.js";
import { campaignWorkbook, packWorkbook } from "./workbook-fixtures.js";
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
async function user(
  email = `analysis-role-${randomUUID()}@example.invalid`,
): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", {
    email,
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
      r.raw.cookies.find((c) => c.name === "cp_session")!.name +
      "=" +
      r.raw.cookies.find((c) => c.name === "cp_session")!.value,
    csrf: r.data.csrf_token,
  };
}
async function fixture(role = "workflow-consultant") {
  const owner = await user(),
    w = await ok(owner, "POST", "/v1/tenants", {
      name: "Synthetic role checks",
      project_name: "Marketing workspace",
    });
  const tenant = w.tenant.id,
    project = w.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await ok(owner, "POST", `/v1/tenants/${tenant}/demo-credit`, {});
  const d = await ok(owner, "POST", base + "/analytics/import", {
    name: "Confirmed campaign source",
    csv: "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Launch,100,10,10,1,20,HKD\n2026-10-02,Google,Launch,1000,200,90,3,180,HKD",
    currency: "HKD",
    account_id: "account",
    attribution_definition: "7d click",
    conversion_definition: "Purchase",
  });
  const templates = await ok(
    owner,
    "GET",
    "/v1/agent-templates?limit=30",
    undefined,
    tenant,
  );
  const template = templates.items.find((t: any) => t.role_key === role);
  assert.ok(template, JSON.stringify(templates));
  const input = { project_id: project, template_version: template.version };
  const preflight = await ok(
    owner,
    "POST",
    `/v1/agent-templates/${template.id}/preflights`,
    input,
    tenant,
  );
  assert.equal(preflight.state, "ready", JSON.stringify(preflight));
  assert.equal(preflight.qualification_state, "unverified");
  const agent = await ok(
    owner,
    "POST",
    `/v1/agent-templates/${template.id}/instances`,
    input,
    tenant,
  );
  const conversation = await ok(owner, "POST", base + "/conversations", {
    name: "Actual file delivery, synthetic model",
    agent_id: agent.id,
  });
  const specification = {
    prompt: "Review campaign evidence and propose a creative experiment",
    snapshot_ids: [d.id],
    date_from: "2026-10-01",
    date_to: "2026-10-02",
    timezone: "Asia/Hong_Kong",
    currency_policy: "group_by_currency",
    metrics: ["spend", "ctr", "cpa", "roas"],
    dimensions: [],
  };
  return {
    owner,
    tenant,
    project,
    base,
    d,
    agent,
    conversation,
    specification,
    template,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function message(f: Fixture, mode = "execute") {
  const c = await ok(
    f.owner,
    "GET",
    f.base + `/conversations/${f.conversation.id}`,
  );
  return ok(
    f.owner,
    "POST",
    f.base + `/conversations/${f.conversation.id}/messages`,
    {
      body: "Create or revise the clearly simulated evidence report.",
      expected_version: c.version,
      intent: "delegate",
      mode,
      budget_micros: 1000000,
      client_message_id: randomUUID(),
    },
  );
}
class FixtureRuntime extends CodexRuntimeAdapter {
  failure: unknown;
  constructor(private perform: (ctx: RuntimeContext) => Promise<unknown>) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    try {
      await this.perform(ctx);
    } catch (error) {
      this.failure = error;
      throw error;
    }
    return {
      status: "completed",
      text: "Clearly simulated role check; real files were created through the company tools.",
      inputTokens: 20,
      outputTokens: 10,
      usageKnown: true,
      accepted: true,
      thread: "synthetic-role-thread",
      turn: randomUUID(),
    };
  }
}
async function run(
  f: Fixture,
  perform: (ctx: RuntimeContext) => Promise<unknown>,
  mode = "execute",
) {
  const accepted = await message(f, mode);
  const runtime = new FixtureRuntime(perform);
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    accepted.task.id,
  );
  if (runtime.failure) throw runtime.failure;
  const task = await ok(f.owner, "GET", f.base + "/tasks/" + accepted.task.id);
  return { accepted, task };
}
const tool = (ctx: RuntimeContext, name: string) => {
  const t = ctx.tools.find((t) => t.name === name);
  assert.ok(t, `Missing ${name}`);
  return t;
};
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

const options = (extra = {}) => ({
  name: "Weekly campaign review",
  calendar: {
    timezone: "Asia/Hong_Kong",
    frequency: "daily",
    time: "09:00",
    weekdays: [],
  },
  catch_up: "latest",
  ends_at: null,
  expected_output: "A private campaign summary and an evidence-backed note",
  ...extra,
});
const schedules = (f: Fixture) => f.base + "/cloud-workflow-schedules";
async function prepare(
  f: Fixture,
  overrides: any = {},
  steps?: any[],
  during?: (request: any, ctx: RuntimeContext) => Promise<void>,
) {
  let request: any, saved: any;
  const outcome = await run(f, async (ctx) => {
    assert.ok(
      !ctx.tools.some((t) =>
        /schedule.*(activate|approve)|schedule_decision/.test(t.name),
      ),
    );
    const definition = {
      steps: steps ?? [
        { kind: "analytics.summary", dataset_id: f.d.id },
        {
          kind: "codex",
          role_key: "assistant",
          prompt:
            "Write a short private campaign note from the actual prior evidence",
          budget_micros: 100000,
        },
      ],
    };
    saved = await tool(ctx, "workflow_save").run(
      { name: "Confirmed campaign routine", definition },
      randomUUID(),
    );
    const published: any = await tool(ctx, "workflow_publish").run(
      {
        workflow_id: saved.workflow.id,
        expected_version: saved.workflow.version,
      },
      randomUUID(),
    );
    const raw = {
      ...options(overrides),
      workflow_id: saved.workflow.id,
      workflow_version: saved.workflow.version,
      workflow_definition_hash: published.definition_hash,
    };
    const preview: any = await tool(ctx, "workflow_schedule_preview").run(
      raw,
      randomUUID(),
    );
    assert.equal(preview.customer_confirmation_required, true);
    request = await tool(ctx, "workflow_schedule_request").run(
      raw,
      randomUUID(),
    );
    const repeated: any = await tool(ctx, "workflow_schedule_request").run(
      raw,
      randomUUID(),
    );
    assert.equal(
      repeated.id,
      request.id,
      "a fresh model call ID must retain the original omitted start and request",
    );
    assert.equal(repeated.specification_hash, request.specification_hash);
    if (during) await during(request, ctx);
  });
  assert.equal(outcome.task.status, "succeeded");
  return { request, saved, outcome };
}
function activateBody(request: any, extra = {}) {
  return {
    decision: "activate",
    specification_hash: request.specification_hash,
    max_budget_micros: request.body.max_budget_micros,
    ...extra,
  };
}
async function activate(f: Fixture, request: any, idempotency?: string) {
  return ok(
    f.owner,
    "POST",
    schedules(f) + `/requests/${request.id}/decision`,
    activateBody(request),
    undefined,
    idempotency,
  );
}
const read = (f: Fixture) => ok(f.owner, "GET", schedules(f));
async function current(f: Fixture, id: string) {
  return (await read(f)).schedules.find((r: any) => r.id === id);
}
function controlBody(row: any, action: string) {
  return {
    action,
    expected_version: row.version,
    specification_hash: row.specification_hash,
    max_budget_micros: row.body.max_budget_micros,
  };
}
async function tick(at: number) {
  await advanceCloudSchedules(s.db, s.catalog, s.storage, at);
}
const runs = async (id: string) =>
  (
    await s.db.control.query(
      "SELECT * FROM workflow_runs WHERE cloud_schedule_id=$1 ORDER BY created_at,id",
      [id],
    )
  ).rows;
async function finishRun(id: string) {
  for (let i = 0; i < 12; i++) {
    await advanceCloudWorkflows(s.db, s.catalog, s.storage);
    const row = (
      await s.db.control.query("SELECT * FROM workflow_runs WHERE id=$1", [id])
    ).rows[0];
    if (row.active_task) {
      const child = (
        await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [
          row.active_task,
        ])
      ).rows[0];
      if (child.status === "queued")
        await new Worker(
          s.db,
          s.catalog,
          s.storage,
          new FixtureRuntime(async () => {}),
        ).run(child.tenant_id, child.id);
    }
    if (row.state === "succeeded") return row;
    assert.equal(row.state, "running", JSON.stringify(row));
  }
  assert.fail("Run did not finish within its bounded step count");
}

test("conversation prepares a private fixed request; no model activation or child reservation and no activation before successful origin", async () => {
  const f = await fixture();
  assert.equal(s.catalog.role("workflow-consultant").version, "1.2.0");
  assert.ok(
    s.catalog.historicalRoles.some(
      (r) => r.role_key === "workflow-consultant" && r.version === "1.1.0",
    ),
  );
  const p = await prepare(f, {}, undefined, async (request) => {
    assert.equal(request.state, "pending");
    assert.equal(request.origin_ready, false);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*) FROM cloud_schedules WHERE private_owner=$1",
          [f.owner.id],
        )
      ).rows[0].count,
      "0",
    );
    const r = await call(
      f.owner,
      "POST",
      schedules(f) + `/requests/${request.id}/decision`,
      activateBody(request),
    );
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, "WORKFLOW_ORIGIN_NOT_READY");
  });
  const data = await read(f);
  assert.equal(data.requests.length, 1);
  assert.equal(data.requests[0].origin_ready, true);
  assert.equal(p.request.body.max_budget_micros, 100000);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM tasks WHERE cloud_workflow_run_id IS NOT NULL AND created_by=$1",
        [f.owner.id],
      )
    ).rows[0].count,
    "0",
  );
  assert.deepEqual(
    data.requests[0].body.source_refs,
    p.request.body.source_refs,
  );
});

test("activation binds exact method, calendar, budget and authority; concurrent same-key retries create exactly one schedule", async () => {
  const f = await fixture(),
    p = await prepare(f),
    url = schedules(f) + `/requests/${p.request.id}/decision`;
  for (const extra of [
    { max_budget_micros: 1 },
    { specification_hash: "0".repeat(64) },
  ])
    assert.equal(
      (await call(f.owner, "POST", url, activateBody(p.request, extra))).status,
      409,
    );
  const id = randomUUID(),
    responses = await Promise.all([
      activate(f, p.request, id),
      activate(f, p.request, id),
    ]);
  assert.equal(responses[0].schedule.id, responses[1].schedule.id);
  assert.equal((await read(f)).schedules.length, 1);
  assert.equal(
    (await call(f.owner, "POST", url, activateBody(p.request))).status,
    409,
  );
  const schedule = (await read(f)).schedules[0];
  assert.equal(schedule.specification_hash, p.request.specification_hash);
  assert.deepEqual(schedule.body.role_hashes, p.request.body.role_hashes);
});

test("concurrent native ticks commit one occurrence/run; real domain steps, private files and child charges settle exactly once and repeat as independent runs", async () => {
  const f = await fixture(),
    p = await prepare(f),
    active = await activate(f, p.request),
    id = active.schedule.id;
  const due = Date.parse(active.schedule.next_due_at);
  await Promise.all([tick(due), tick(due), tick(due)]);
  let recorded = await runs(id);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].state, "running");
  assert.equal(recorded[0].cloud_schedule_revision, 1);
  assert.equal(
    recorded[0].results[0].specification_hash,
    p.request.specification_hash,
  );
  const done = await finishRun(recorded[0].id);
  assert.equal(done.state, "succeeded");
  const asset = done.results.find((x: any) => x.kind === "analytics.summary");
  const download = await call(
    f.owner,
    "GET",
    f.base + `/assets/${asset.asset_id}/download`,
  );
  assert.equal(download.status, 200);
  assert.equal(JSON.parse(download.raw.body).snapshot_id, f.d.id);
  const billed = (
    await s.db.control.query(
      "SELECT id,status,charged_micros FROM tasks WHERE cloud_workflow_run_id=$1",
      [done.id],
    )
  ).rows;
  assert.equal(billed.length, 1);
  assert.equal(billed[0].status, "succeeded");
  assert.ok(BigInt(billed[0].charged_micros) > 0n);
  const next = Date.parse((await current(f, id)).next_due_at);
  await tick(next);
  recorded = await runs(id);
  assert.equal(recorded.length, 2);
  await finishRun(recorded[1].id);
  const focused = await ok(
    f.owner,
    "GET",
    f.base + "/cloud-workflows?run_id=" + recorded[0].id,
  );
  assert.deepEqual(
    focused.runs.map((r: any) => r.id),
    [recorded[0].id],
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        f.base + "/cloud-workflows?run_id=" + randomUUID(),
      )
    ).status,
    404,
  );
  await tick(next);
  assert.equal((await runs(id)).length, 2);
  assert.equal(
    (await read(f)).occurrences.filter((o: any) => o.state === "launched")
      .length,
    2,
  );
});

test("human review holds the current run, missed times coalesce and overlapping triggers create no child or duplicate run", async () => {
  const f = await fixture(),
    p = await prepare(f, {}, [
      {
        kind: "approval",
        message: "Review each scheduled result before continuing",
      },
      { kind: "analytics.summary", dataset_id: f.d.id },
    ]),
    active = await activate(f, p.request),
    id = active.schedule.id;
  await tick(Date.parse(active.schedule.next_due_at));
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  assert.equal((await runs(id))[0].state, "awaiting_approval");
  const next = Date.parse((await current(f, id)).next_due_at);
  await tick(next + 3 * 86400000);
  assert.equal((await runs(id)).length, 1);
  const events = (await read(f)).occurrences;
  assert.ok(events.some((o: any) => o.state === "skipped_overlap"));
  assert.ok(events.some((o: any) => o.missed_count >= 3 && o.through_local));
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM tasks WHERE cloud_workflow_run_id=$1",
        [(await runs(id))[0].id],
      )
    ).rows[0].count,
    "0",
  );
});

test("pausing future times preserves current work; cancelling the current run is separate; resumption retains versions and skips paused history", async () => {
  const f = await fixture(),
    p = await prepare(f),
    active = await activate(f, p.request),
    id = active.schedule.id;
  await tick(Date.parse(active.schedule.next_due_at));
  let row = await current(f, id);
  await ok(
    f.owner,
    "POST",
    schedules(f) + `/${id}/status`,
    controlBody(row, "pause"),
  );
  assert.equal((await runs(id))[0].state, "running");
  row = await current(f, id);
  assert.equal(row.next_due_at, null);
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        schedules(f) + `/${id}/status`,
        controlBody(row, "resume"),
      )
    ).data.error.code,
    "SCHEDULE_CURRENT_RUN_UNRESOLVED",
  );
  const r = (await ok(f.owner, "GET", f.base + "/cloud-workflows")).runs[0];
  await ok(f.owner, "POST", f.base + `/cloud-workflows/runs/${r.id}/decision`, {
    decision: "cancel",
    expected_revision: r.revision,
    definition_hash: r.definition_hash,
    stage: "step",
    max_budget_micros: r.step_budget_micros,
    expected_cursor: r.cursor,
  });
  assert.equal((await current(f, id)).state, "paused");
  await ok(
    f.owner,
    "POST",
    schedules(f) + `/${id}/status`,
    controlBody(row, "resume"),
  );
  row = await current(f, id);
  assert.equal(row.state, "active");
  assert.equal(row.revision, 2);
  const detail = await ok(f.owner, "GET", schedules(f) + "/" + id);
  assert.equal(detail.versions.length, 2);
  assert.equal(
    detail.versions[0].specification_hash,
    detail.versions[1].specification_hash,
  );
});

test("a failed run blocks future launches and unknown child charges prevent resumption until reviewed", async () => {
  const f = await fixture(),
    p = await prepare(f, {}, [
      {
        kind: "codex",
        role_key: "assistant",
        prompt: "Make a private note",
        budget_micros: 100000,
      },
    ]);
  const active = await activate(f, p.request),
    id = active.schedule.id;
  await tick(Date.parse(active.schedule.next_due_at));
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  const r = (await runs(id))[0];
  await s.db.control.query(
    "UPDATE tasks SET status='reconciling' WHERE id=$1",
    [r.active_task],
  );
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  await tick(Date.now());
  const row = await current(f, id);
  assert.equal(row.state, "blocked");
  assert.equal(row.last_error, "SCHEDULE_RUN_FAILED_REVIEW_REQUIRED");
  await tick(Date.parse(active.schedule.next_due_at) + 10 * 86400000);
  assert.equal((await runs(id)).length, 1);
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        schedules(f) + `/${id}/status`,
        controlBody(row, "resume"),
      )
    ).data.error.code,
    "SCHEDULE_CURRENT_RUN_UNRESOLVED",
  );
});

test("revoking current source authority hides private bodies and blocks the original frozen plan without starting a run", async () => {
  const f = await fixture(),
    p = await prepare(f),
    active = await activate(f, p.request);
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
    [f.d.id],
  );
  const data = await read(f);
  assert.equal(data.schedules.length, 0);
  assert.equal(data.requests.length, 0);
  await tick(Date.parse(active.schedule.next_due_at));
  const row = (
    await s.db.control.query("SELECT * FROM cloud_schedules WHERE id=$1", [
      active.schedule.id,
    ])
  ).rows[0];
  assert.equal(row.state, "blocked");
  assert.equal((await runs(row.id)).length, 0);
});

test("same-project members and cross-tenant users cannot list, activate, pause or directly read another private schedule", async () => {
  const f = await fixture(),
    p = await prepare(f),
    active = await activate(f, p.request),
    other = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [f.tenant, other.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, other.id],
  );
  const data = await ok(other, "GET", schedules(f));
  assert.deepEqual(data, { requests: [], schedules: [], occurrences: [] });
  assert.equal(
    (
      await call(
        other,
        "POST",
        schedules(f) + `/requests/${p.request.id}/decision`,
        activateBody(p.request),
      )
    ).status,
    404,
  );
  const row = await current(f, active.schedule.id);
  assert.equal(
    (
      await call(
        other,
        "POST",
        schedules(f) + `/${row.id}/status`,
        controlBody(row, "pause"),
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(other, "GET", schedules(f) + "/" + row.id)).status,
    404,
  );
  for (const table of [
    "cloud_schedule_requests",
    "cloud_schedules",
    "cloud_schedule_versions",
    "cloud_schedule_occurrences",
  ])
    assert.equal(
      await s.db.tx(
        async (tx) =>
          Number(
            (await tx.query(`SELECT count(*) FROM ${table}`)).rows[0].count,
          ),
        f.tenant,
        false,
        other.id,
      ),
      0,
    );
  const outside = await fixture();
  assert.equal((await call(outside.owner, "GET", schedules(f))).status, 404);
});

test("an existing reviewed workflow can become a schedule, and editing creates a separately confirmed version while original runs retain their method", async () => {
  const f = await fixture(),
    p = await prepare(f),
    active = await activate(f, p.request),
    id = active.schedule.id;
  await tick(Date.parse(active.schedule.next_due_at));
  const first = (await runs(id))[0];
  await finishRun(first.id);
  const fromResult = await ok(f.owner, "POST", schedules(f) + "/requests", {
    ...options({
      name: "From a saved result",
      starts_at: new Date().toISOString(),
    }),
    source_run_id: first.id,
  });
  assert.equal(fromResult.state, "pending");
  assert.equal(fromResult.body.workflow_version, first.workflow_version);
  const row = await current(f, id),
    changed = await ok(f.owner, "POST", schedules(f) + `/${id}/requests`, {
      ...options({
        name: "Revised calendar",
        calendar: {
          timezone: "UTC",
          frequency: "weekly",
          time: "10:30",
          weekdays: [1, 4],
        },
      }),
      expected_version: row.version,
    });
  assert.equal((await current(f, id)).revision, 1);
  await activate(f, changed);
  const revised = await current(f, id);
  assert.equal(revised.revision, 2);
  assert.equal(revised.body.calendar.time, "10:30");
  const retained = (
    await s.db.control.query("SELECT * FROM workflow_runs WHERE id=$1", [
      first.id,
    ])
  ).rows[0];
  assert.deepEqual(retained.definition, first.definition);
  assert.equal(retained.cloud_schedule_revision, 1);
  const history = await ok(f.owner, "GET", schedules(f) + "/" + id);
  assert.equal(history.versions.length, 2);
});

test("retirement is irreversible and expiry erases private request/version bodies while preserving occurrence and charge facts", async () => {
  const f = await fixture(),
    p = await prepare(f),
    active = await activate(f, p.request),
    id = active.schedule.id;
  const row = await current(f, id);
  await ok(
    f.owner,
    "POST",
    schedules(f) + `/${id}/status`,
    controlBody(row, "retire"),
  );
  const retired = await current(f, id);
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        schedules(f) + `/${id}/status`,
        controlBody(retired, "resume"),
      )
    ).status,
    409,
  );
  await s.db.control.query(
    "UPDATE tasks SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [p.outcome.task.id],
  );
  await purgeUnavailableCloudSchedules(s.db);
  assert.equal((await read(f)).schedules.length, 0);
  const request = (
    await s.db.control.query(
      "SELECT * FROM cloud_schedule_requests WHERE id=$1",
      [p.request.id],
    )
  ).rows[0];
  assert.equal(request.content_state, "deleted");
  assert.deepEqual(request.body, {});
  const version = (
    await s.db.control.query(
      "SELECT body FROM cloud_schedule_versions WHERE schedule_id=$1",
      [id],
    )
  ).rows[0];
  assert.deepEqual(version.body, {});
});

test("database rejects rewritten requests, frozen versions, forged scheduled runs and altered native run bindings", async () => {
  const f = await fixture(),
    p = await prepare(f),
    active = await activate(f, p.request),
    id = active.schedule.id;
  await assert.rejects(
    s.db.control.query(
      "UPDATE cloud_schedule_requests SET body=jsonb_set(body,'{max_budget_micros}','1') WHERE id=$1",
      [p.request.id],
    ),
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE cloud_schedule_versions SET body='{}' WHERE schedule_id=$1",
      [id],
    ),
  );
  await tick(Date.parse(active.schedule.next_due_at));
  const first = (await runs(id))[0];
  await assert.rejects(
    s.db.control.query(
      "UPDATE workflow_runs SET cloud_schedule_revision=99 WHERE id=$1",
      [first.id],
    ),
  );
  await assert.rejects(
    s.db.tx(
      async (tx) => {
        await tx.query(
          `INSERT INTO workflow_runs(tenant_id,project_id,workflow_id,created_by,actor_auth_version,
    definition,workflow_version,role_hashes,execution_location,private_owner,origin_task_id,state,authorized_at,
    cloud_schedule_id,cloud_schedule_revision,cloud_schedule_occurrence_id)
    VALUES($1,$2,$3,$4,1,$5,$6,$7,'cloud',$4,$8,'running',now(),$9,1,$10)`,
          [
            f.tenant,
            f.project,
            first.workflow_id,
            f.owner.id,
            first.definition,
            first.workflow_version,
            first.role_hashes,
            first.origin_task_id,
            id,
            randomUUID(),
          ],
        );
      },
      f.tenant,
      false,
      f.owner.id,
    ),
  );
});

test("skip policy never backfills late work; an ended interval and nonexistent daylight wall time cannot launch a paid child", async () => {
  const f = await fixture(),
    p = await prepare(f, { catch_up: "skip" }),
    active = await activate(f, p.request);
  await tick(Date.parse(active.schedule.next_due_at) + 120000);
  assert.equal((await runs(active.schedule.id)).length, 0);
  assert.equal((await read(f)).occurrences[0].state, "skipped_missed");
  const future = new Date("2027-03-01T00:00:00Z").toISOString();
  const g = await fixture(),
    gp = await prepare(g, {
      starts_at: future,
      calendar: {
        timezone: "America/New_York",
        frequency: "weekly",
        time: "02:30",
        weekdays: [7],
      },
    }),
    ga = await activate(g, gp.request);
  await tick(Date.parse("2027-03-14T07:00:00Z"));
  assert.equal((await runs(ga.schedule.id)).length, 0);
  assert.ok(
    (await read(g)).occurrences.some(
      (o: any) => o.state === "skipped_dst" && o.scheduled_at === null,
    ),
  );
});

test("native Desktop credentials cannot activate cloud replacement work; Ask and Plan expose no schedule mutation tools", async () => {
  const f = await fixture(),
    p = await prepare(f);
  const verifier = randomBytes(32).toString("base64url"),
    redirect = "http://127.0.0.1:46661/callback";
  const authorized = await ok(f.owner, "POST", "/v1/auth/native/authorize", {
    client_id: "desktop",
    redirect_uri: redirect,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  });
  const issued = await ok(undefined, "POST", "/v1/auth/native/token", {
    client_id: "desktop",
    redirect_uri: redirect,
    code: new URL(authorized.redirect).searchParams.get("code"),
    code_verifier: verifier,
  });
  const response = await s.app.inject({
    method: "POST",
    url: schedules(f) + `/requests/${p.request.id}/decision`,
    headers: {
      authorization: `Bearer ${issued.access_token}`,
      "idempotency-key": randomUUID(),
      "content-type": "application/json",
    },
    payload: activateBody(p.request),
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, "DESKTOP_LOCAL_EXECUTION_REQUIRED");
  assert.equal((await read(f)).schedules.length, 0);
  for (const mode of ["ask", "plan"])
    await run(
      f,
      async (ctx) => {
        assert.ok(
          ctx.tools.some((t) => t.name === "workflow_schedule_preview"),
        );
        assert.ok(ctx.tools.some((t) => t.name === "workflow_schedule_status"));
        assert.ok(
          !ctx.tools.some((t) => t.name === "workflow_schedule_request"),
        );
      },
      mode,
    );
});

test("a changed account authorization invalidates old paid consent even after the owner signs in again", async () => {
  const f = await fixture(),
    p = await prepare(f);
  const email = (
    await s.db.control.query("SELECT email FROM users WHERE id=$1", [
      f.owner.id,
    ])
  ).rows[0].email;
  await s.db.control.query(
    "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
    [f.owner.id],
  );
  await s.db.control.query(
    "UPDATE auth_challenges SET created_at=now()-interval '2 minutes' WHERE email=$1",
    [email],
  );
  assert.equal((await call(f.owner, "GET", schedules(f))).status, 401);
  f.owner = await user(email);
  const response = await call(
    f.owner,
    "POST",
    schedules(f) + `/requests/${p.request.id}/decision`,
    activateBody(p.request),
  );
  assert.equal(response.status, 409);
  assert.equal(response.data.error.code, "SCHEDULE_AUTHORIZATION_CHANGED");
  assert.equal((await read(f)).schedules.length, 0);
});

test("scoped administrators see metadata only; MFA pause preserves the running private work and cannot authorize its resumption", async () => {
  const f = await fixture(),
    p = await prepare(f),
    active = await activate(f, p.request);
  const outsider = await fixture(),
    other = await prepare(outsider),
    otherActive = await activate(outsider, other.request);
  await tick(Date.parse(active.schedule.next_due_at));
  const before = await runs(active.schedule.id);
  const secret = new OTPAuth.Secret({ size: 20 }),
    email = `schedule-admin-${randomUUID()}@example.invalid`;
  const principal = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Scoped schedule operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  const role = "schedule_" + randomUUID().replaceAll("-", "");
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(["admin.execution.read", "admin.execution.pause"])],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)",
    [principal.id, role, f.project],
  );
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
    totp: new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  });
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  const cookie = signed.raw.cookies.find((c) => c.name === "cp_admin_session")!;
  const operator: Client = {
    id: principal.id,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: signed.data.csrf_token,
    admin: true,
  };
  const listing = await ok(
    operator,
    "GET",
    "/v1/admin/private-cloud-schedules",
  );
  assert.equal(listing.total, 1);
  assert.equal(listing.items[0].id, active.schedule.id);
  for (const field of [
    "body",
    "definition",
    "name",
    "expected_output",
    "source_refs",
  ])
    assert.ok(!(field in listing.items[0]));
  assert.equal(
    (
      await call(
        operator,
        "POST",
        `/v1/admin/private-cloud-schedules/${otherActive.schedule.id}/pause`,
        {
          expected_version: otherActive.schedule.version,
          reason: "Review future customer jobs",
        },
      )
    ).status,
    403,
  );
  const key = randomUUID(),
    body = {
      expected_version: listing.items[0].version,
      reason: "Review future customer jobs",
    },
    url = `/v1/admin/private-cloud-schedules/${active.schedule.id}/pause`;
  await ok(operator, "POST", url, body, undefined, key);
  await ok(operator, "POST", url, body, undefined, key);
  assert.equal((await current(f, active.schedule.id)).state, "paused");
  assert.deepEqual(await runs(active.schedule.id), before);
  assert.equal(
    (await call(operator, "POST", url.replace("/pause", "/resume"), body))
      .status,
    404,
  );
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '1 hour' WHERE admin_id=$1",
    [principal.id],
  );
  const latestOther = await current(outsider, otherActive.schedule.id);
  await s.db.control.query(
    "UPDATE admin_bindings SET scope_kind='global',scope_id=NULL WHERE principal_id=$1",
    [principal.id],
  );
  assert.equal(
    (
      await call(
        operator,
        "POST",
        `/v1/admin/private-cloud-schedules/${latestOther.id}/pause`,
        {
          expected_version: latestOther.version,
          reason: "Recent MFA is required for this pause",
        },
      )
    ).status,
    403,
  );
});

test("occurrence pagination keeps all facts once, binds the original calendar and rejects a cursor from another private schedule", async () => {
  const f = await fixture(),
    p = await prepare(f),
    active = await activate(f, p.request),
    id = active.schedule.id;
  const other = await fixture(),
    op = await prepare(other),
    oa = await activate(other, op.request);
  const insert = async (
    scheduleId: string,
    owner: string,
    tenant: string,
    project: string,
    count: number,
  ) =>
    s.db.control.query(
      `INSERT INTO cloud_schedule_occurrences(schedule_id,revision,tenant_id,project_id,private_owner,scheduled_local,scheduled_at,state,code)
      SELECT $1,1,$2,$3,$4,to_char(date '2026-01-01'+n,'YYYY-MM-DD')||'T09:00:00',
      (date '2026-01-01'+n)::timestamptz+interval '9 hours','skipped_overlap','SYNTHETIC_PAGINATION_FIXTURE'
      FROM generate_series(1,$5::integer) n RETURNING id`,
      [scheduleId, tenant, project, owner, count],
    );
  await insert(id, f.owner.id, f.tenant, f.project, 51);
  const foreign = await insert(
    oa.schedule.id,
    other.owner.id,
    other.tenant,
    other.project,
    1,
  );
  const first = await ok(f.owner, "GET", schedules(f) + "/" + id);
  assert.equal(first.occurrences.length, 50);
  assert.ok(first.next_cursor);
  const second = await ok(
    f.owner,
    "GET",
    schedules(f) + "/" + id + "?before=" + first.next_cursor,
  );
  assert.equal(second.occurrences.length, 1);
  assert.equal(second.next_cursor, null);
  const facts = [...first.occurrences, ...second.occurrences];
  assert.equal(new Set(facts.map((v: any) => v.id)).size, 51);
  assert.ok(
    facts.every(
      (v: any) =>
        v.calendar.timezone === "Asia/Hong_Kong" && v.charged_micros === "0",
    ),
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        schedules(f) + "/" + id + "?before=" + foreign.rows[0].id,
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(other.owner, "GET", schedules(f) + "/" + id)).status,
    404,
  );
});
