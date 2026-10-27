import {
  advanceCloudEvents,
  purgeUnavailableCloudEvents,
} from "../src/cloud-events.js";
import {
  eventSignature,
  parseEventEnvelope,
  verifyEventSignature,
} from "../src/cloud-event-model.js";
import { before, after, afterEach, test } from "node:test";
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

const options = (extra: any = {}) => ({
  name: "Incoming campaign brief",
  event_type: "campaign.ready",
  timezone: "Asia/Hong_Kong",
  overlap_policy: "latest",
  min_interval_seconds: 10,
  max_runs_per_day: 3,
  max_event_age_seconds: 3600,
  ends_at: new Date(Date.now() + 86400_000).toISOString(),
  expected_output: "A private review of the confirmed campaign evidence",
  ...extra,
});
afterEach(async () => {
  if (!s) return;
  await s.db.control.query(
    "UPDATE cloud_event_triggers SET state='retired',version=version+1 WHERE state IN('active','paused','blocked')",
  );
  await s.db.control.query(
    "UPDATE cloud_event_keys SET sealed_secret=NULL,retired_at=now() WHERE retired_at IS NULL",
  );
});
const events = (f: Fixture) => f.base + "/cloud-workflow-events";
async function prepare(
  f: Fixture,
  extra: any = {},
  during?: (q: any, ctx: RuntimeContext) => Promise<void>,
) {
  let request: any, saved: any, raw: any;
  const outcome = await run(f, async (ctx) => {
    assert.ok(
      !ctx.tools.some((t) =>
        /event.*(approve|activate|secret|sign|rotate)/.test(t.name),
      ),
    );
    saved = await tool(ctx, "workflow_save").run(
      {
        name: "Private incoming campaign review",
        definition: {
          steps: [
            { kind: "analytics.summary", dataset_id: f.d.id },
            {
              kind: "codex",
              role_key: "assistant",
              prompt: "Review the real prior evidence in a private note",
              budget_micros: 100000,
            },
          ],
        },
      },
      randomUUID(),
    );
    const published: any = await tool(ctx, "workflow_publish").run(
      {
        workflow_id: saved.workflow.id,
        expected_version: saved.workflow.version,
      },
      randomUUID(),
    );
    raw = {
      ...options(extra),
      workflow_id: saved.workflow.id,
      workflow_version: saved.workflow.version,
      workflow_definition_hash: published.definition_hash,
    };
    const preview: any = await tool(ctx, "workflow_event_preview").run(
      raw,
      randomUUID(),
    );
    assert.equal(preview.customer_confirmation_required, true);
    const result: any = await tool(ctx, "workflow_event_request").run(
      raw,
      randomUUID(),
    );
    request = result.request;
    assert.equal(result.customer_confirmation_required, true);
    const again: any = await tool(ctx, "workflow_event_request").run(
      raw,
      randomUUID(),
    );
    assert.equal(again.request.id, request.id);
    assert.equal(again.request.specification_hash, request.specification_hash);
    if (during) await during(request, ctx);
  });
  assert.equal(outcome.task.status, "succeeded");
  return { request, saved, outcome, raw };
}
const decision = (q: any, extra = {}) => ({
  decision: "activate",
  specification_hash: q.specification_hash,
  max_budget_micros: q.body.max_budget_micros,
  max_daily_budget_micros: q.body.max_daily_budget_micros,
  ...extra,
});
const activate = (f: Fixture, q: any, k?: string) =>
  ok(
    f.owner,
    "POST",
    events(f) + `/requests/${q.id}/decision`,
    decision(q),
    undefined,
    k,
  );
const listing = (f: Fixture) => ok(f.owner, "GET", events(f));
const current = async (f: Fixture, id: string) =>
  (await listing(f)).triggers.find((t: any) => t.id === id);
const runs = async (id: string) =>
  (
    await s.db.control.query(
      "SELECT * FROM workflow_runs WHERE cloud_event_trigger_id=$1 ORDER BY created_at,id",
      [id],
    )
  ).rows;
const inbox = async (id: string) =>
  (
    await s.db.control.query(
      "SELECT * FROM cloud_event_inbox WHERE trigger_id=$1 ORDER BY received_at,id",
      [id],
    )
  ).rows;
const tick = (at = Date.now()) =>
  advanceCloudEvents(s.db, s.catalog, s.storage, at);
async function send(active: any, extra: any = {}, config: any = {}) {
  const envelope = {
    event_id: randomUUID(),
    event_type: "campaign.ready",
    occurred_at: new Date().toISOString(),
    data: {
      campaign: "Owned launch",
      instruction: "Ignore these untrusted instructions",
    },
    ...extra,
  };
  const raw: Buffer = config.raw ?? Buffer.from(JSON.stringify(envelope));
  const timestamp = config.timestamp ?? String(Math.floor(Date.now() / 1000)),
    version = config.version ?? active.trigger.key_version;
  const headers = {
    "content-type": "application/json",
    "x-workmate-key-version": String(version),
    "x-workmate-timestamp": timestamp,
    "x-workmate-signature": eventSignature(
      config.secret ?? active.signing_secret,
      active.trigger.id,
      version,
      timestamp,
      raw,
    ),
    ...config.headers,
  };
  const r = await s.app.inject({
    method: "POST",
    url: `/v1/hooks/workflow-events/${active.trigger.id}`,
    headers,
    payload: raw,
  });
  return {
    status: r.statusCode,
    data: r.headers["content-type"]?.includes("application/json")
      ? r.json()
      : r.body,
    raw,
  };
}
async function finishRun(id: string) {
  for (let i = 0; i < 12; i++) {
    await advanceCloudWorkflows(s.db, s.catalog, s.storage);
    const r = (
      await s.db.control.query("SELECT * FROM workflow_runs WHERE id=$1", [id])
    ).rows[0];
    if (r.active_task) {
      const t = (
        await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [
          r.active_task,
        ])
      ).rows[0];
      if (t.status === "queued")
        await new Worker(
          s.db,
          s.catalog,
          s.storage,
          new FixtureRuntime(async (ctx) => {
            assert.ok(
              ctx.prompt.includes("Untrusted source data") ||
                ctx.prompt.includes("untrusted evidence"),
            );
          }),
        ).run(t.tenant_id, t.id);
    }
    if (r.state === "succeeded") return r;
    assert.equal(r.state, "running", JSON.stringify(r));
  }
  assert.fail("Bounded event workflow did not finish");
}

test("event proposal preserves role history, cannot activate while running, and requires exact customer budget confirmation", async () => {
  const f = await fixture();
  assert.equal(s.catalog.role("workflow-consultant").version, "1.3.0");
  for (const version of ["1.1.0", "1.2.0"])
    assert.ok(
      s.catalog.historicalRoles.some(
        (r) => r.role_key === "workflow-consultant" && r.version === version,
      ),
    );
  const p = await prepare(f, {}, async (q) => {
    assert.equal(q.state, "pending");
    assert.equal(
      (
        await call(
          f.owner,
          "POST",
          events(f) + `/requests/${q.id}/decision`,
          decision(q),
        )
      ).status,
      409,
    );
    assert.equal((await runs(q.id)).length, 0);
  });
  assert.equal((await listing(f)).requests[0].origin_ready, true);
  for (const extra of [
    { max_budget_micros: 1 },
    { max_daily_budget_micros: 1 },
    { specification_hash: "0".repeat(64) },
  ])
    assert.equal(
      (
        await call(
          f.owner,
          "POST",
          events(f) + `/requests/${p.request.id}/decision`,
          decision(p.request, extra),
        )
      ).status,
      409,
    );
  const key = randomUUID(),
    active = await activate(f, p.request, key),
    again = await activate(f, p.request, key);
  assert.match(active.signing_secret, /^wm_evt_/);
  assert.equal(again.signing_secret, null);
  assert.equal(again.trigger.id, active.trigger.id);
  assert.equal((await runs(active.trigger.id)).length, 0);
  assert.ok(!JSON.stringify(await listing(f)).includes(active.signing_secret));
  const cached = await s.db.control.query(
    "SELECT response FROM request_replays WHERE actor_id=$1",
    [f.owner.id],
  );
  assert.ok(!JSON.stringify(cached.rows).includes(active.signing_secret));
  const stored = (
    await s.db.control.query(
      "SELECT sealed_secret FROM cloud_event_keys WHERE trigger_id=$1",
      [active.trigger.id],
    )
  ).rows[0];
  assert.ok(!stored.sealed_secret.includes(active.signing_secret));
});

test("raw-byte signature, timestamp, envelope, complexity and size failures never create an inbox record", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request);
  const invalid = [
    { secret: "incorrect" },
    { timestamp: String(Math.floor(Date.now() / 1000) - 301) },
    { headers: { "x-workmate-signature": "v1=" + "0".repeat(64) } },
    { version: 999 },
    { raw: Buffer.from("not JSON") },
    { raw: Buffer.from([0xff]) },
    {
      raw: Buffer.from(
        JSON.stringify({
          event_id: randomUUID(),
          event_type: "campaign.ready",
          occurred_at: new Date().toISOString(),
          data: { x: "a".repeat(4100) },
        }),
      ),
    },
    {
      raw: Buffer.from(
        '{"event_id":"badnumber","event_type":"campaign.ready","occurred_at":"' +
          new Date().toISOString() +
          '","data":{"x":1e999}}',
      ),
    },
    {
      raw: Buffer.from(
        '{"event_id":"prototype","event_type":"campaign.ready","occurred_at":"' +
          new Date().toISOString() +
          '","data":{"__proto__":{}}}',
      ),
    },
    { raw: Buffer.from(" ".repeat(32769)) },
  ];
  for (const config of invalid) {
    const r = await send(a, {}, config);
    assert.ok([400, 401, 413].includes(r.status), JSON.stringify(r.data));
  }
  assert.equal((await inbox(a.trigger.id)).length, 0);
  const valid = await send(a);
  assert.equal(valid.status, 202, JSON.stringify(valid.data));
  assert.equal((await inbox(a.trigger.id)).length, 1);
  assert.equal(valid.data.receipt.state, "pending");
  assert.equal(
    (await runs(a.trigger.id)).length,
    0,
    "acknowledgement only after inbox commit; no inline execution",
  );
  assert.equal(
    verifyEventSignature(
      a.signing_secret,
      a.trigger.id,
      1,
      "bad",
      "bad",
      valid.raw,
    ),
    false,
  );
  assert.throws(() =>
    parseEventEnvelope(
      Buffer.from(
        JSON.stringify({
          event_id: "deep",
          event_type: "campaign.ready",
          occurred_at: new Date().toISOString(),
          data: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
        }),
      ),
    ),
  );
});

test("concurrent retries deduplicate exact bytes; changed event body conflicts; a different signed type is durably ignored", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request),
    id = randomUUID(),
    occurred_at = new Date().toISOString();
  const messages = await Promise.all(
    Array.from({ length: 6 }, () => send(a, { event_id: id, occurred_at })),
  );
  assert.ok(
    messages.every((r) => r.status === 202),
    JSON.stringify(messages.map((r) => r.data)),
  );
  assert.equal(messages.filter((r) => !r.data.duplicate).length, 1);
  assert.equal((await inbox(a.trigger.id)).length, 1);
  assert.equal(
    (await send(a, { event_id: id, occurred_at, data: { changed: true } }))
      .status,
    409,
  );
  const other = await send(a, { event_type: "campaign.other" });
  assert.equal(other.status, 202);
  assert.equal(other.data.receipt.state, "ignored_type");
  const history = await ok(
    f.owner,
    "GET",
    events(f) + `/${a.trigger.id}?limit=1`,
  );
  assert.equal(history.items.length, 1);
  assert.ok(history.next_cursor);
  const next = await ok(
    f.owner,
    "GET",
    events(f) + `/${a.trigger.id}?limit=1&cursor=${history.next_cursor}`,
  );
  assert.equal(next.items.length, 1);
  assert.notEqual(next.items[0].id, history.items[0].id);
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        events(f) + `/${a.trigger.id}?cursor=${randomUUID()}`,
      )
    ).status,
    400,
  );
});

test("concurrent dispatch creates one bound private run and settles its real child through the existing company execution path", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request),
    sent = await send(a);
  assert.equal(sent.status, 202);
  const at = Date.now();
  await Promise.all([tick(at), tick(at), tick(at)]);
  const r = await runs(a.trigger.id);
  assert.equal(r.length, 1, JSON.stringify(await current(f, a.trigger.id)));
  assert.equal(r[0].cloud_event_inbox_id, sent.data.receipt.id);
  assert.equal(r[0].private_owner, f.owner.id);
  assert.equal(r[0].workflow_version, p.request.body.workflow_version);
  assert.deepEqual(r[0].role_hashes, p.request.body.role_hashes);
  assert.equal(r[0].results[1].kind, "external_event");
  assert.match(r[0].results[1].trust, /Untrusted/);
  const done = await finishRun(r[0].id);
  assert.equal(done.state, "succeeded");
  const children = await s.db.control.query(
    "SELECT status,budget_micros,private_owner,execution_location FROM tasks WHERE cloud_workflow_run_id=$1",
    [r[0].id],
  );
  assert.equal(children.rowCount, 1);
  assert.equal(children.rows[0].status, "succeeded");
  assert.equal(children.rows[0].execution_location, "cloud");
  assert.equal(children.rows[0].private_owner, f.owner.id);
  assert.equal(Number(children.rows[0].budget_micros), 100000);
});

test("latest overlap coalesces busy deliveries, respects the interval and does not replay superseded data", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request);
  await send(a);
  const start = Date.now();
  await tick(start);
  assert.equal((await runs(a.trigger.id)).length, 1);
  await send(a, { data: { sequence: 2 } });
  await send(a, { data: { sequence: 3 } });
  await tick(start + 1000);
  const rows = await inbox(a.trigger.id);
  assert.equal(rows.filter((r) => r.state === "coalesced").length, 1);
  assert.equal(rows.filter((r) => r.state === "pending").length, 1);
  await finishRun((await runs(a.trigger.id))[0].id);
  await tick(start + 2000);
  assert.equal((await runs(a.trigger.id)).length, 1);
  await tick(start + 11000);
  const r = await runs(a.trigger.id);
  assert.equal(r.length, 2);
  assert.equal(r[1].results[1].data.sequence, 3);
});

test("skip overlap, expired occurrence and daily budget cap retain explicit terminal receipts", async () => {
  const f = await fixture(),
    p = await prepare(f, { overlap_policy: "skip", max_runs_per_day: 1 }),
    a = await activate(f, p.request);
  const stale = await send(a, {
    occurred_at: new Date(Date.now() - 7200_000).toISOString(),
  });
  assert.equal(stale.data.receipt.state, "expired");
  await send(a);
  const start = Date.now();
  await tick(start);
  await send(a);
  await tick(start + 1000);
  assert.ok(
    (await inbox(a.trigger.id)).some((r) => r.state === "skipped_overlap"),
  );
  await finishRun((await runs(a.trigger.id))[0].id);
  await send(a);
  await tick(start + 11000);
  assert.equal((await runs(a.trigger.id)).length, 1);
  assert.ok(
    (await inbox(a.trigger.id)).some((r) => r.state === "skipped_limit"),
  );
});

test("pause preserves current work, requires a newly confirmed revision to resume, and old events stay on their original method", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request);
  await send(a);
  await tick();
  const before = await runs(a.trigger.id);
  const row = await current(f, a.trigger.id);
  await ok(f.owner, "POST", events(f) + `/${row.id}/status`, {
    action: "pause",
    expected_version: row.version,
  });
  assert.deepEqual(await runs(row.id), before);
  assert.equal((await send(a)).data.receipt.state, "ignored_inactive");
  assert.equal(
    (
      await call(f.owner, "POST", events(f) + `/${row.id}/status`, {
        action: "resume",
        expected_version: row.version,
      })
    ).status,
    400,
  );
  let next = await current(f, row.id);
  const revised = await ok(f.owner, "POST", events(f) + `/${row.id}/requests`, {
    ...p.raw,
    expected_version: next.version,
  });
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        events(f) + `/requests/${revised.request.id}/decision`,
        decision(revised.request),
      )
    ).status,
    409,
  );
  await finishRun(before[0].id);
  const resumed = await activate(f, revised.request);
  assert.equal(resumed.signing_secret, null);
  assert.equal(resumed.trigger.revision, 2);
  await send({ ...a, trigger: resumed.trigger });
  await tick(Date.now() + 11000);
  const r = await runs(row.id);
  assert.equal(r.length, 2);
  assert.equal(r[0].cloud_event_revision, 1);
  assert.equal(r[1].cloud_event_revision, 2);
});

test("one-time key rotation revokes the old key immediately, survives idempotent retry and retains event deduplication", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request),
    sent = await send(a),
    row = await current(f, a.trigger.id),
    k = randomUUID();
  const url = events(f) + `/${row.id}/rotate-key`,
    body = { expected_version: row.version };
  const rotated = await ok(f.owner, "POST", url, body, undefined, k),
    again = await ok(f.owner, "POST", url, body, undefined, k);
  assert.ok(rotated.signing_secret !== a.signing_secret);
  assert.equal(again.signing_secret, null);
  assert.equal(rotated.trigger.key_version, 2);
  assert.equal((await send(a)).status, 401);
  assert.equal(
    (await send(rotated, {}, { raw: sent.raw })).data.duplicate,
    true,
  );
  assert.equal((await send(rotated)).status, 202);
  const keys = (
    await s.db.control.query(
      "SELECT version,sealed_secret,retired_at FROM cloud_event_keys WHERE trigger_id=$1 ORDER BY version",
      [row.id],
    )
  ).rows;
  assert.equal(keys[0].sealed_secret, null);
  assert.ok(keys[0].retired_at);
  assert.ok(keys[1].sealed_secret);
});

test("private event rows enforce RLS, deny app inbox forging, immutable bindings and cross-owner API access", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request),
    other = await fixture();
  await send(a);
  await tick();
  assert.equal(
    (await call(other.owner, "GET", events(f) + `/${a.trigger.id}`)).status,
    404,
  );
  assert.equal(
    (await call(f.owner, "GET", events(other) + `/${a.trigger.id}`)).status,
    404,
  );
  const hidden = await s.db.tx(
    (tx) =>
      tx.query("SELECT id FROM cloud_event_triggers WHERE id=$1", [
        a.trigger.id,
      ]),
    f.tenant,
    false,
    other.owner.id,
  );
  assert.equal(hidden.rowCount, 0);
  await assert.rejects(
    s.db.tx(
      (tx) =>
        tx.query(
          "INSERT INTO cloud_event_inbox SELECT * FROM cloud_event_inbox WHERE trigger_id=$1",
          [a.trigger.id],
        ),
      f.tenant,
      false,
      f.owner.id,
    ),
    /permission denied/,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE cloud_event_inbox SET event_id='forged' WHERE trigger_id=$1",
      [a.trigger.id],
    ),
    /cannot be rewritten/,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE workflow_runs SET cloud_event_revision=99 WHERE cloud_event_trigger_id=$1",
      [a.trigger.id],
    ),
    /immutable/,
  );
  await assert.rejects(
    s.db.control.query("DELETE FROM cloud_event_keys WHERE trigger_id=$1", [
      a.trigger.id,
    ]),
    /permission denied|immutable/,
  );
});

test("failure blocks future events without a retry storm; customer review creates a new revision", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request);
  await send(a);
  await tick();
  const r = (await runs(a.trigger.id))[0];
  await s.db.control.query(
    "UPDATE workflow_runs SET state='failed' WHERE id=$1",
    [r.id],
  );
  await send(a);
  const at = Date.now();
  await tick(at);
  const row = await current(f, a.trigger.id);
  assert.equal(row.state, "blocked");
  assert.equal(row.last_error, "EVENT_RUN_FAILED_REVIEW_REQUIRED");
  assert.equal((await inbox(a.trigger.id)).at(-1).state, "blocked");
  await tick(at + 11000);
  assert.equal((await runs(a.trigger.id)).length, 1);
  const revised = await ok(f.owner, "POST", events(f) + `/${row.id}/requests`, {
    ...p.raw,
    expected_version: row.version,
  });
  const resumed = await activate(f, revised.request);
  assert.equal(resumed.trigger.state, "active");
  assert.equal(resumed.trigger.revision, 2);
});

test("source deletion irreversibly scrubs private event payloads, definitions, keys and cached responses", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request);
  await send(a, { data: { sensitive: "customer brief" } });
  await s.db.control.query(
    "UPDATE tasks SET content_state='deleted' WHERE id=$1",
    [p.outcome.accepted.task.id],
  );
  await purgeUnavailableCloudEvents(s.db);
  const rows = await s.db.control.query(
    "SELECT * FROM cloud_event_triggers WHERE id=$1",
    [a.trigger.id],
  );
  assert.equal(rows.rows[0].content_state, "deleted");
  assert.ok(
    (await inbox(a.trigger.id)).every(
      (r) => r.content_state === "deleted" && JSON.stringify(r.data) === "{}",
    ),
  );
  assert.ok(
    (
      await s.db.control.query(
        "SELECT body FROM cloud_event_versions WHERE trigger_id=$1",
        [a.trigger.id],
      )
    ).rows.every((r) => JSON.stringify(r.body) === "{}"),
  );
  assert.ok(
    (
      await s.db.control.query(
        "SELECT sealed_secret FROM cloud_event_keys WHERE trigger_id=$1",
        [a.trigger.id],
      )
    ).rows.every((r) => r.sealed_secret === null),
  );
  assert.equal((await listing(f)).triggers.length, 0);
  assert.equal((await send(a)).status, 401);
  assert.equal(
    (await call(f.owner, "GET", events(f) + `/${a.trigger.id}`)).status,
    404,
  );
  const cache = await s.db.control.query(
    "SELECT response FROM request_replays WHERE actor_id=$1 AND response::text LIKE $2",
    [f.owner.id, "%" + a.trigger.id + "%"],
  );
  assert.equal(cache.rowCount, 0);
});

test("account authority withdrawal rejects incoming data and prevents dispatch using the old authorization", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request);
  await send(a);
  await s.db.control.query(
    "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
    [f.owner.id],
  );
  assert.equal((await send(a)).status, 410);
  await tick();
  assert.equal((await runs(a.trigger.id)).length, 0);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT state FROM cloud_event_triggers WHERE id=$1",
        [a.trigger.id],
      )
    ).rows[0].state,
    "blocked",
  );
});

test("scoped MFA administrators see control metadata only and can pause without resuming or changing current work", async () => {
  const f = await fixture(),
    p = await prepare(f),
    a = await activate(f, p.request),
    other = await fixture(),
    p2 = await prepare(other),
    a2 = await activate(other, p2.request);
  await send(a);
  await tick();
  const before = await runs(a.trigger.id);
  const secret = new OTPAuth.Secret({ size: 20 }),
    email = `event-admin-${randomUUID()}@example.invalid`;
  const principal = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Scoped event operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  const role = "event_" + randomUUID().replaceAll("-", "");
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(["admin.execution.read", "admin.execution.pause"])],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)",
    [principal.id, role, f.project],
  );
  const ch = await ok(undefined, "POST", "/v1/admin/auth/challenge", { email });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`,
      "utf8",
    ),
  );
  const login = await call(undefined, "POST", "/v1/admin/auth/verify", {
    challenge_id: ch.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    totp: new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  });
  assert.equal(login.status, 200);
  const c = login.raw.cookies.find((c) => c.name === "cp_admin_session")!,
    operator: Client = {
      id: principal.id,
      cookie: c.name + "=" + c.value,
      csrf: login.data.csrf_token,
      admin: true,
    };
  const list = await ok(operator, "GET", "/v1/admin/private-cloud-events");
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, a.trigger.id);
  for (const field of [
    "body",
    "data",
    "event_type",
    "definition",
    "name",
    "source_refs",
    "signing_secret",
    "endpoint",
  ])
    assert.ok(!(field in list.items[0]));
  const body = {
      expected_version: list.items[0].version,
      reason: "Review future campaign event work",
    },
    url = `/v1/admin/private-cloud-events/${a.trigger.id}/pause`,
    k = randomUUID();
  assert.equal(
    (
      await call(
        operator,
        "POST",
        `/v1/admin/private-cloud-events/${a2.trigger.id}/pause`,
        { ...body, expected_version: a2.trigger.version },
      )
    ).status,
    403,
  );
  await ok(operator, "POST", url, body, undefined, k);
  await ok(operator, "POST", url, body, undefined, k);
  assert.deepEqual(await runs(a.trigger.id), before);
  assert.equal((await current(f, a.trigger.id)).state, "paused");
  assert.equal(
    (await call(operator, "POST", url.replace("/pause", "/resume"), body))
      .status,
    404,
  );
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '1 hour' WHERE admin_id=$1",
    [principal.id],
  );
  assert.equal(
    (await call(operator, "GET", "/v1/admin/private-cloud-events")).status,
    403,
  );
  assert.ok(
    (
      await s.db.control.query(
        "SELECT 1 FROM audit_log WHERE target=$1 AND action='admin.execution.pause'",
        [a.trigger.id],
      )
    ).rowCount,
  );
});
