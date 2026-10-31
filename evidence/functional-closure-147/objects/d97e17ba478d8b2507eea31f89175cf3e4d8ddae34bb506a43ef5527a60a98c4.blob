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
async function startFixture(overrides: Record<string,string> = {}) {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
      DEV_MAILBOX: "true",
      ...overrides,
    }),
    { worker: false },
  );
}
async function stopFixture() {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
}

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


export {s, startFixture, stopFixture, fixture, call, ok, user, tool, decision, listRuns, prepareWorkflow, FixtureRuntime};
export type {Fixture, Client};
