import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { hash } from "../src/lib.js";
import { saveAsset } from "../src/storage.js";
import { campaignWorkbook, packWorkbook } from "./workbook-fixtures.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
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
      origin: "http://localhost:4317",
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
    email: `analysis-role-${randomUUID()}@example.invalid`,
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
const renderInput = (specification: any, facts: any, extra = {}): any => ({
  specification,
  calculation_sha256: facts.calculation_sha256,
  title: "Campaign evidence review",
  locale: "en-HK",
  metrics: ["spend", "ctr"],
  scope_ids: facts.scopes.map((g: any) => g.id),
  ...extra,
});
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

const decision = (r: any, extra = {}) => ({
  decision: "approve",
  expected_revision: r.revision,
  definition_hash: r.definition_hash,
  stage: r.authorized ? "step" : "start",
  max_budget_micros: r.step_budget_micros,
  expected_cursor: r.cursor,
  ...extra,
});
const listRuns = (f: Fixture) =>
  ok(f.owner, "GET", f.base + "/cloud-workflows");
async function prepareWorkflow(f: Fixture, definition: any) {
  let saved: any, request: any;
  const outcome = await run(f, async (ctx) => {
    const checked: any = await tool(ctx, "workflow_validate").run(
      { definition },
      randomUUID(),
    );
    saved = await tool(ctx, "workflow_save").run(
      { name: "Campaign evidence & review", definition },
      randomUUID(),
    );
    const again: any = await tool(ctx, "workflow_save").run(
      { name: "Campaign evidence & review", definition },
      randomUUID(),
    );
    assert.equal(again.workflow.id, saved.workflow.id);
    const published: any = await tool(ctx, "workflow_publish").run(
      {
        workflow_id: saved.workflow.id,
        expected_version: saved.workflow.version,
      },
      randomUUID(),
    );
    assert.equal(published.definition_hash, checked.definition_hash);
    const args = {
      workflow_id: saved.workflow.id,
      version: saved.workflow.version,
      definition_hash: published.definition_hash,
    };
    request = await tool(ctx, "workflow_run").run(args, randomUUID());
    const replay: any = await tool(ctx, "workflow_run").run(args, randomUUID());
    assert.equal(replay.run.id, request.run.id);
    assert.equal(request.run.state, "awaiting_approval");
    assert.equal(request.run.authorized, false);
    assert.ok(!ctx.tools.some((t) => /approve|decision/.test(t.name)));
    const children = (
      await s.db.control.query(
        "SELECT count(*) FROM tasks WHERE cloud_workflow_run_id=$1",
        [request.run.id],
      )
    ).rows[0];
    assert.equal(children.count, "0");
  });
  return { outcome, saved, request };
}

test("private cloud consultant validates, versions and requests; only customer-approved fixed steps execute and settle once", async () => {
  const f = await fixture();
  assert.equal(f.template.role_key, "workflow-consultant");
  const definition = {
    steps: [
      { kind: "analytics.summary", dataset_id: f.d.id },
      {
        kind: "approval",
        message: "Review the campaign summary before writing the final note.",
      },
      {
        kind: "codex",
        role_key: "assistant",
        prompt:
          "Write the approved campaign review note from the actual prior receipts.",
        budget_micros: 100000,
      },
    ],
  };
  const p = await prepareWorkflow(f, definition);
  assert.equal(p.outcome.task.status, "succeeded");
  let r = (await listRuns(f)).runs[0];
  assert.equal(r.step_budget_micros, 100000);
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  assert.equal((await listRuns(f)).runs[0].cursor, 0);
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        f.base + `/cloud-workflows/runs/${r.id}/decision`,
        decision(r, { max_budget_micros: 99999 }),
      )
    ).status,
    409,
  );
  const approved = await ok(
    f.owner,
    "POST",
    f.base + `/cloud-workflows/runs/${r.id}/decision`,
    decision(r),
  );
  assert.equal(approved.run.authorized, true);
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  r = (await listRuns(f)).runs[0];
  assert.equal(r.cursor, 1);
  const file = await call(
    f.owner,
    "GET",
    f.base + `/assets/${r.results.at(-1).asset_id}/download`,
  );
  assert.equal(file.status, 200);
  assert.equal(JSON.parse(file.raw.body).snapshot_id, f.d.id);
  const original = await s.db.control.query(
    "SELECT private_owner FROM assets WHERE id=$1",
    [r.results.at(-1).asset_id],
  );
  assert.equal(original.rows[0].private_owner, f.owner.id);
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  r = (await listRuns(f)).runs[0];
  assert.equal(r.state, "awaiting_approval");
  assert.equal(r.authorized, true);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM tasks WHERE cloud_workflow_run_id=$1",
        [r.id],
      )
    ).rows[0].count,
    "0",
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        f.base + `/cloud-workflows/runs/${r.id}/decision`,
        decision(r, { expected_cursor: 0 }),
      )
    ).status,
    409,
  );
  await ok(
    f.owner,
    "POST",
    f.base + `/cloud-workflows/runs/${r.id}/decision`,
    decision(r),
  );
  await Promise.all([
    advanceCloudWorkflows(s.db, s.catalog, s.storage),
    advanceCloudWorkflows(s.db, s.catalog, s.storage),
  ]);
  r = (await listRuns(f)).runs[0];
  const child = (
    await s.db.control.query(
      "SELECT * FROM tasks WHERE cloud_workflow_run_id=$1",
      [r.id],
    )
  ).rows;
  assert.equal(child.length, 1);
  assert.equal(child[0].private_owner, f.owner.id);
  assert.equal(child[0].conversation_id, f.conversation.id);
  assert.equal(child[0].execution_location, "cloud");
  assert.equal(child[0].role_hash, p.request.role_hashes.assistant);
  assert.equal(child[0].budget_micros, "100000");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM reservations WHERE task_id=$1",
        [child[0].id],
      )
    ).rows[0].count,
    "1",
  );
  const runtime = new FixtureRuntime(async (ctx) => {
    await tool(ctx, "deliver_text").run(
      {
        filename: "review.md",
        content:
          "# Approved campaign review\n\nSynthetic test note, actual private delivery.",
        mime_type: "text/markdown",
      },
      randomUUID(),
    );
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    child[0].id,
  );
  if (runtime.failure) throw runtime.failure;
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  r = (await listRuns(f)).runs[0];
  assert.equal(r.state, "succeeded", JSON.stringify(r));
  assert.equal(r.results.at(-1).task_id, child[0].id);
  assert.ok(BigInt(r.results.at(-1).charged_micros) > 0n);
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM tasks WHERE cloud_workflow_run_id=$1",
        [r.id],
      )
    ).rows[0].count,
    "1",
  );
  const outsider = await user();
  assert.ok(
    [403, 404].includes(
      (
        await call(
          outsider,
          "GET",
          f.base +
            `/assets/${r.results.find((x: any) => x.kind === "analytics.summary").asset_id}/download`,
        )
      ).status,
    ),
  );
});

test("cloud drafts retain immutable versions, reject stale edits and stay in their originating private conversation", async () => {
  const f = await fixture(),
    first = await prepareWorkflow(f, {
      steps: [{ kind: "approval", message: "Review original draft." }],
    });
  const old = (
    await s.db.control.query(
      "SELECT * FROM workflow_versions WHERE workflow_id=$1 AND version=1",
      [first.saved.workflow.id],
    )
  ).rows[0];
  let revision: any;
  await run(f, async (ctx) => {
    const original: any = await tool(ctx, "workflow_read").run(
      { workflow_id: first.saved.workflow.id, version: 1 },
      randomUUID(),
    );
    assert.equal(original.selected.definition_hash, old.definition_hash);
    revision = await tool(ctx, "workflow_save").run(
      {
        workflow_id: first.saved.workflow.id,
        expected_version: 1,
        name: "Revised private review",
        definition: {
          steps: [
            {
              kind: "approval",
              message:
                "Review the revised campaign and preserve the first draft.",
            },
          ],
        },
      },
      randomUUID(),
    );
    assert.equal(revision.workflow.version, 2);
    await assert.rejects(
      tool(ctx, "workflow_save").run(
        {
          workflow_id: first.saved.workflow.id,
          expected_version: 1,
          name: "Conflict",
          definition: old.definition,
        },
        randomUUID(),
      ),
      { code: "WORKFLOW_VERSION_CHANGED" },
    );
  });
  const after = (
    await s.db.control.query(
      "SELECT * FROM workflow_versions WHERE workflow_id=$1 AND version=1",
      [first.saved.workflow.id],
    )
  ).rows[0];
  assert.deepEqual(after, old);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT workflow_version FROM workflow_runs WHERE id=$1",
        [first.request.run.id],
      )
    ).rows[0].workflow_version,
    1,
  );
  const another = await ok(f.owner, "POST", f.base + "/conversations", {
    name: "Separate confidential conversation",
    agent_id: f.agent.id,
  });
  await run({ ...f, conversation: another }, async (ctx) => {
    await assert.rejects(
      tool(ctx, "workflow_read").run(
        { workflow_id: first.saved.workflow.id },
        randomUUID(),
      ),
      { code: "NOT_FOUND" },
    );
    assert.deepEqual(
      ((await tool(ctx, "workflow_list").run({}, randomUUID())) as any).items,
      [],
    );
  });
});

for (const mode of ["ask", "plan"])
  test(`${mode} exposes workflow validation and current reads, without writers or fee approval`, async () => {
    const f = await fixture();
    await run(
      f,
      async (ctx) => {
        const names = ctx.tools.map((t) => t.name);
        for (const name of [
          "workflow_validate",
          "workflow_list",
          "workflow_read",
          "workflow_status",
        ])
          assert.ok(names.includes(name), names.join(","));
        for (const name of [
          "workflow_save",
          "workflow_publish",
          "workflow_run",
          "workflow_cancel",
        ])
          assert.ok(!names.includes(name));
        await assert.rejects(
          tool(ctx, "workflow_validate").run(
            {
              definition: {
                steps: [
                  {
                    kind: "codex",
                    role_key: "workflow-consultant",
                    prompt: "Never recurse into another workflow",
                    budget_micros: 100000,
                  },
                ],
              },
            },
            randomUUID(),
          ),
          { code: "CLOUD_WORKFLOW_ROLE_NOT_READY" },
        );
        await assert.rejects(
          tool(ctx, "workflow_validate").run(
            {
              definition: {
                steps: [{ kind: "shell", command: "echo denied" }],
              },
            },
            randomUUID(),
          ),
        );
      },
      mode,
    );
  });

test("source withdrawal blocks pending approval and cancellation releases a queued child without another fee", async () => {
  const f = await fixture();
  const first = await prepareWorkflow(f, {
    steps: [{ kind: "analytics.summary", dataset_id: f.d.id }],
  });
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
    [f.d.id],
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        f.base + `/cloud-workflows/runs/${first.request.run.id}/decision`,
        decision(first.request.run),
      )
    ).status,
    409,
  );
  const second = await prepareWorkflow(await fixture(), {
    steps: [{ kind: "approval", message: "Review before anything else." }],
  });
  assert.equal(second.request.run.state, "awaiting_approval");
});

test("customer cancellation releases a queued private child and never replays it", async () => {
  const f = await fixture(),
    p = await prepareWorkflow(f, {
      steps: [
        {
          kind: "codex",
          role_key: "assistant",
          prompt: "Write a private review note after approval.",
          budget_micros: 100000,
        },
      ],
    });
  await ok(
    f.owner,
    "POST",
    f.base + `/cloud-workflows/runs/${p.request.run.id}/decision`,
    decision(p.request.run),
  );
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  const r = (await listRuns(f)).runs[0];
  assert.ok(r.active_task);
  await ok(
    f.owner,
    "POST",
    f.base + `/cloud-workflows/runs/${r.id}/decision`,
    decision(r, { decision: "cancel" }),
  );
  const child = (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [r.active_task])
  ).rows[0];
  assert.equal(child.status, "cancelled");
  const receipt = (
    await s.db.control.query("SELECT * FROM reservations WHERE task_id=$1", [
      r.active_task,
    ])
  ).rows;
  assert.equal(receipt.length, 1);
  assert.equal(receipt[0].status, "released");
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM tasks WHERE cloud_workflow_run_id=$1",
        [r.id],
      )
    ).rows[0].count,
    "1",
  );
});

test("a reconciling child stops the sequence; fee uncertainty cannot authorize a replacement", async () => {
  const f = await fixture(),
    p = await prepareWorkflow(f, {
      steps: [
        {
          kind: "codex",
          role_key: "assistant",
          prompt: "Create the reviewed campaign note.",
          budget_micros: 100000,
        },
        {
          kind: "codex",
          role_key: "assistant",
          prompt: "Revise the note only after the first outcome is known.",
          budget_micros: 100000,
        },
      ],
    });
  await ok(
    f.owner,
    "POST",
    f.base + `/cloud-workflows/runs/${p.request.run.id}/decision`,
    decision(p.request.run),
  );
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  const r = (await listRuns(f)).runs[0];
  await s.db.control.query(
    "UPDATE tasks SET status='reconciling',error_code='SYNTHETIC_UNKNOWN_RESULT' WHERE id=$1",
    [r.active_task],
  );
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  const stopped = (await listRuns(f)).runs[0];
  assert.equal(stopped.state, "failed");
  assert.equal(stopped.error_code, "WORKFLOW_STEP_RECONCILIATION_REQUIRED");
  await advanceCloudWorkflows(s.db, s.catalog, s.storage);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM tasks WHERE cloud_workflow_run_id=$1",
        [r.id],
      )
    ).rows[0].count,
    "1",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [r.active_task],
      )
    ).rows[0].status,
    "reserved",
  );
});

test(
  "the pinned native Codex process loads the workflow Skills and prepares a real fixed pending request",
  { timeout: 180000 },
  async () => {
    const f = await fixture(),
      accepted = await message(f),
      calls: string[] = [];
    class CapturedCodex extends CodexRuntimeAdapter {
      override start(ctx: RuntimeContext) {
        return super.start({
          ...ctx,
          tools: ctx.tools.map((t) => ({
            ...t,
            run: async (a, id) => {
              calls.push(t.name);
              return t.run(a, id);
            },
          })),
        });
      }
    }
    await new Worker(
      s.db,
      s.catalog,
      s.storage,
      new CapturedCodex(s.db.config),
    ).run(f.tenant, accepted.task.id);
    const task = await ok(
      f.owner,
      "GET",
      f.base + "/tasks/" + accepted.task.id,
    );
    assert.equal(
      task.status,
      "succeeded",
      JSON.stringify({
        task,
        calls,
        events: (
          await s.db.control.query(
            "SELECT kind,body FROM task_events WHERE task_id=$1 ORDER BY created_at",
            [task.id],
          )
        ).rows,
      }),
    );
    assert.deepEqual(calls, [
      "analysis_sources",
      "workflow_validate",
      "workflow_save",
      "workflow_publish",
      "workflow_run",
    ]);
    const snapshot = await listRuns(f);
    assert.equal(snapshot.runs.length, 1);
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.runs[0].state, "awaiting_approval");
    assert.equal(snapshot.runs[0].authorized, false);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*) FROM tasks WHERE cloud_workflow_run_id=$1",
          [snapshot.runs[0].id],
        )
      ).rows[0].count,
      "0",
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*) FROM reservations WHERE task_id=$1",
          [accepted.task.id],
        )
      ).rows[0].count,
      "1",
    );
  },
);
