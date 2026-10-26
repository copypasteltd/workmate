import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
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
async function fixture(role = "marketing-analyst") {
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

for (const role of ["marketing-analyst", "information-design"])
  test(`${role}: template, fixed Skills, authorized facts, real private deliverables, exact replay and one original settlement`, async () => {
    const f = await fixture(role);
    let delivered: any;
    const result = await run(f, async (ctx) => {
      assert.ok(ctx.skills.some((s) => s.content.includes("Version: 1.1.0.")));
      for (const t of ctx.tools) desktopCompanyToolSchema(t.inputSchema);
      const sources: any = await tool(ctx, "analysis_sources").run(
        {},
        randomUUID(),
      );
      assert.equal(sources.items[0].id, f.d.id);
      if (role === "marketing-analyst")
        assert.deepEqual(
          ((await tool(ctx, "connector_read").run({}, randomUUID())) as any)
            .items,
          [],
        );
      else assert.ok(!ctx.tools.some((t) => t.name === "connector_read"));
      await assert.rejects(
        tool(ctx, "sheet_calculate").run(
          {
            specification: { ...f.specification, snapshot_ids: [randomUUID()] },
          },
          randomUUID(),
        ),
      );
      const facts: any = await tool(ctx, "sheet_calculate").run(
        { specification: f.specification },
        randomUUID(),
      );
      assert.equal(
        facts.evidence.find((e: any) => e.metric_id === "ctr").value,
        "0.19090909",
      );
      const render = tool(ctx, "chart_render"),
        input = renderInput(f.specification, facts),
        id = randomUUID();
      await assert.rejects(
        render.run(
          { ...input, calculation_sha256: "0".repeat(64) },
          randomUUID(),
        ),
        (e: any) => e.code === "ANALYSIS_CALCULATION_CHANGED",
      );
      delivered = await render.run(input, id);
      assert.deepEqual(await render.run(input, id), delivered);
      assert.deepEqual(await render.run(input, randomUUID()), delivered);
      await assert.rejects(
        render.run({ ...input, title: "Changed title" }, id),
        (e: any) => e.code === "IDEMPOTENCY_CONFLICT",
      );
    });
    assert.equal(result.task.status, "succeeded", JSON.stringify(result.task));
    assert.equal(delivered.files.length, 9);
    assert.equal(delivered.provider_calls, 0);
    assert.equal(delivered.additional_ai_charge_micros, "0");
    const counts = (
      await s.db.control.query(
        "SELECT (SELECT count(*)::int FROM assets WHERE project_id=$1 AND kind='deliverable') AS assets,(SELECT count(*)::int FROM reservations WHERE task_id=$2) AS reservations,(SELECT count(*)::int FROM task_tool_receipts WHERE task_id=$2 AND tool_name='chart_render') AS receipts",
        [f.project, result.task.id],
      )
    ).rows[0];
    assert.deepEqual(counts, { assets: 9, reservations: 1, receipts: 2 });
    const outsider = await user();
    await s.db.control.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
      [f.tenant, outsider.id],
    );
    await s.db.control.query(
      "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
      [f.tenant, f.project, outsider.id],
    );
    for (const file of delivered.files) {
      const own = await call(
        f.owner,
        "GET",
        f.base + `/assets/${file.asset_id}/download`,
      );
      assert.equal(own.status, 200);
      assert.equal(hash(own.raw.rawPayload), file.sha256);
      assert.equal(
        (
          await call(
            outsider,
            "GET",
            f.base + `/assets/${file.asset_id}/download`,
          )
        ).status,
        404,
      );
    }
    const zip = delivered.files.find(
      (f: any) => f.filename === "analysis-delivery.zip",
    );
    const bytes = (
      await call(f.owner, "GET", f.base + `/assets/${zip.asset_id}/download`)
    ).raw.rawPayload;
    const manifest = JSON.parse(
      Buffer.from(unzipSync(bytes)["manifest.json"]).toString(),
    );
    assert.equal(manifest.data_mode, "simulated");
  });

test("an Agent cannot discover or open another conversation's private file even for the same customer", async () => {
  const f = await fixture();
  const other = await ok(f.owner, "POST", f.base + "/conversations", {
    name: "Other private conversation",
    agent_id: f.agent.id,
  });
  const asset = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        conversation: other.id,
        name: "other-private.csv",
        mime: "text/csv",
        bytes: Buffer.from("date,spend\n2026-10-01,999"),
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  const result = await run(f, async (ctx) => {
    const files: any = await tool(ctx, "analysis_sources").run(
      { kind: "files" },
      randomUUID(),
    );
    assert.equal(files.items.length, 0);
    await assert.rejects(
      tool(ctx, "analysis_file_inspect").run(
        { asset_version_id: asset.version.id },
        randomUUID(),
      ),
      (e: any) => e.code === "NOT_FOUND",
    );
  });
  assert.equal(result.task.status, "succeeded");
});

test("a private XLSX preserves its actual worksheet, exact fractional conversions, provenance and private delivery", async () => {
  const f = await fixture("information-design"),
    bytes = packWorkbook(campaignWorkbook("100.125"));
  const asset = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        conversation: f.conversation.id,
        name: "private-marketing.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  let delivery: any;
  const result = await run(f, async (ctx) => {
    const inspected: any = await tool(ctx, "analysis_file_inspect").run(
      { asset_version_id: asset.version.id },
      randomUUID(),
    );
    assert.equal(inspected.selected_sheet, "Campaigns");
    const specification = {
      ...f.specification,
      metrics: ["spend", "conversions", "cpa"],
      snapshot_ids: [],
      file_inputs: [
        {
          asset_version_id: asset.version.id,
          sha256: inspected.sha256,
          sheet_name: "Campaigns",
          header_row: 1,
          options: {
            currency: "HKD",
            account_id: "A",
            attribution_definition: "7d click",
            conversion_definition: "Purchase",
          },
        },
      ],
    };
    const facts: any = await tool(ctx, "sheet_calculate").run(
      { specification },
      randomUUID(),
    );
    assert.equal(
      facts.evidence.find((e: any) => e.metric_id === "spend").value,
      "100.12500000",
    );
    assert.equal(
      facts.evidence.find((e: any) => e.metric_id === "conversions").value,
      "4.50000000",
    );
    assert.equal(facts.sources[0].source_asset_version_id, asset.version.id);
    delivery = await tool(ctx, "chart_render").run(
      {
        ...renderInput(facts.specification, facts),
        metrics: ["spend", "conversions"],
        locale: "zh-HK",
      },
      randomUUID(),
    );
  });
  assert.equal(result.task.status, "succeeded", JSON.stringify(result.task));
  assert.equal(delivery.files.length, 9);
});

for (const role of ["marketing-analyst", "information-design"])
  test(
    `${role}: the pinned native Codex process consumes actual source/calculation tools and delivers real files`,
    { timeout: 180000 },
    async () => {
      const f = await fixture(role),
        accepted = await message(f);
      const calls: string[] = [];
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
      assert.equal(task.status, "succeeded", JSON.stringify(task));
      assert.deepEqual(calls, [
        "analysis_sources",
        "sheet_calculate",
        "chart_render",
      ]);
      const rows = (
        await s.db.control.query(
          "SELECT result,output_version_ids FROM task_tool_receipts WHERE task_id=$1 AND tool_name='chart_render'",
          [accepted.task.id],
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].output_version_ids.length, 9);
      assert.equal(rows[0].result.provider_calls, 0);
      assert.ok(Number(task.charged_micros) > 0);
      assert.equal(
        (
          await s.db.control.query(
            "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
            [accepted.task.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );

test("a private conversation CSV is calculated and delivered without copying it into shared datasets", async () => {
  const f = await fixture();
  const csv =
    "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Meta,Private launch,100,10,20,2,100,HKD";
  const asset = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        conversation: f.conversation.id,
        name: "private-marketing.csv",
        mime: "text/csv",
        bytes: Buffer.from(csv),
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  let delivered: any;
  const result = await run(f, async (ctx) => {
    const files: any = await tool(ctx, "analysis_sources").run(
      { kind: "files" },
      randomUUID(),
    );
    assert.equal(files.items[0].asset_version_id, asset.version.id);
    const inspected: any = await tool(ctx, "analysis_file_inspect").run(
      { asset_version_id: asset.version.id },
      randomUUID(),
    );
    assert.deepEqual(inspected.headers, csv.split("\n")[0].split(","));
    assert.equal(inspected.sha256, hash(Buffer.from(csv)));
    const specification = {
      ...f.specification,
      snapshot_ids: [],
      file_inputs: [
        {
          asset_version_id: asset.version.id,
          sha256: inspected.sha256,
          options: {
            currency: "HKD",
            account_id: "private-account",
            attribution_definition: "7d click",
            conversion_definition: "Purchase",
          },
        },
      ],
    };
    await assert.rejects(
      tool(ctx, "sheet_calculate").run(
        {
          specification: {
            ...specification,
            file_inputs: [
              { ...specification.file_inputs[0], sha256: "0".repeat(64) },
            ],
          },
        },
        randomUUID(),
      ),
      (e: any) => e.code === "ANALYSIS_FILE_CHANGED",
    );
    const facts: any = await tool(ctx, "sheet_calculate").run(
      { specification },
      randomUUID(),
    );
    assert.equal(
      facts.evidence.find((e: any) => e.metric_id === "spend").value,
      "20.00000000",
    );
    assert.equal(facts.sources[0].source_asset_version_id, asset.version.id);
    delivered = await tool(ctx, "chart_render").run(
      renderInput(facts.specification, facts),
      randomUUID(),
    );
    const source: any = await tool(ctx, "analysis_source_read").run(
      { source_version_id: delivered.editable_source.asset_version_id },
      randomUUID(),
    );
    const recalculated: any = await tool(ctx, "sheet_calculate").run(
      { specification: source.render.specification },
      randomUUID(),
    );
    assert.equal(recalculated.calculation_sha256, facts.calculation_sha256);
  });
  assert.equal(result.task.status, "succeeded", JSON.stringify(result.task));
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM analytics_datasets WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    1,
  );
  assert.ok(
    (
      await s.db.control.query(
        "SELECT private_owner FROM assets WHERE id=ANY($1::uuid[])",
        [delivered.files.map((f: any) => f.asset_id)],
      )
    ).rows.every((a: any) => a.private_owner === f.owner.id),
  );
});

test("revising dates reads the original source, recomputes facts and retains old bytes and separate exact receipts", async () => {
  const f = await fixture();
  let original: any, revised: any;
  const first = await run(f, async (ctx) => {
    const facts: any = await tool(ctx, "sheet_calculate").run(
      { specification: f.specification },
      randomUUID(),
    );
    original = await tool(ctx, "chart_render").run(
      renderInput(f.specification, facts),
      randomUUID(),
    );
  });
  assert.equal(first.task.status, "succeeded", JSON.stringify(first.task));
  const spec = { ...f.specification, date_from: "2026-10-02" };
  const second = await run(f, async (ctx) => {
    const source: any = await tool(ctx, "analysis_source_read").run(
      { source_version_id: original.editable_source.asset_version_id },
      randomUUID(),
    );
    assert.equal(source.sha256, original.editable_source.sha256);
    const facts: any = await tool(ctx, "sheet_calculate").run(
      { specification: spec },
      randomUUID(),
    );
    assert.equal(
      facts.evidence.find((e: any) => e.metric_id === "spend").value,
      "90.00000000",
    );
    const input = renderInput(spec, facts, {
      revision_of: {
        source_version_id: source.source_version_id,
        sha256: source.sha256,
      },
    });
    await assert.rejects(
      tool(ctx, "chart_render").run(
        {
          ...input,
          revision_of: { ...input.revision_of, sha256: "0".repeat(64) },
        },
        randomUUID(),
      ),
      (e: any) => e.code === "ANALYSIS_REVISION_CHANGED",
    );
    revised = await tool(ctx, "chart_render").run(input, randomUUID());
  });
  assert.equal(second.task.status, "succeeded", JSON.stringify(second.task));
  assert.notEqual(revised.calculation_sha256, original.calculation_sha256);
  assert.equal(
    revised.revision_of.source_version_id,
    original.editable_source.asset_version_id,
  );
  for (const file of original.files)
    assert.equal(
      hash(
        (
          await call(
            f.owner,
            "GET",
            f.base + `/assets/${file.asset_id}/download`,
          )
        ).raw.rawPayload,
      ),
      file.sha256,
    );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=ANY($1::uuid[])",
        [[first.task.id, second.task.id]],
      )
    ).rows[0].n,
    2,
  );
});

for (const mode of ["ask", "plan"])
  test(`${mode} cannot regain chart/artifact writes by selecting a professional role`, async () => {
    const f = await fixture();
    const result = await run(
      f,
      async (ctx) => {
        assert.ok(
          !ctx.tools.some((t) =>
            ["chart_render", "deliver_text", "design_render"].includes(t.name),
          ),
        );
        const facts: any = await tool(ctx, "sheet_calculate").run(
          { specification: f.specification },
          randomUUID(),
        );
        assert.equal(facts.total_scopes, 1);
      },
      mode,
    );
    assert.ok(
      ["succeeded", "awaiting_approval"].includes(result.task.status),
      JSON.stringify(result.task),
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM assets WHERE project_id=$1 AND kind='deliverable'",
          [f.project],
        )
      ).rows[0].n,
      0,
    );
  });

test("source revocation fences identical read/write replay and hides previously delivered files without deleting the fee receipt", async () => {
  const f = await fixture();
  let delivered: any;
  const result = await run(f, async (ctx) => {
    const id = randomUUID(),
      args = { specification: f.specification };
    const facts: any = await tool(ctx, "sheet_calculate").run(args, id);
    const render = tool(ctx, "chart_render"),
      input = renderInput(f.specification, facts),
      writeId = randomUUID();
    delivered = await render.run(input, writeId);
    await s.db.control.query(
      "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
      [f.d.id],
    );
    await assert.rejects(
      tool(ctx, "sheet_calculate").run(args, id),
      (e: any) => e.code === "TASK_SOURCE_REVOKED",
    );
    await assert.rejects(
      render.run(input, writeId),
      (e: any) => e.code === "TASK_SOURCE_REVOKED",
    );
  });
  assert.notEqual(result.task.status, "succeeded");
  assert.equal(result.task.output, "");
  for (const file of delivered.files)
    assert.ok(
      [403, 404, 409].includes(
        (
          await call(
            f.owner,
            "GET",
            f.base + `/assets/${file.asset_id}/download`,
          )
        ).status,
      ),
    );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [result.task.id],
      )
    ).rows[0].n,
    1,
  );
});

test("connector tool pages captured HTTP facts, retains authorized history after OAuth revocation and fences quarantined sources", async () => {
  const f = await fixture();
  const c = await ok(
    f.owner,
    "POST",
    "/v1/connections",
    { project_id: f.project, provider: "google_ads" },
    f.tenant,
  );
  const consent = new URL(c.authorization_url);
  consent.pathname = consent.pathname.replace("/consent/", "/approve/");
  const approved = await fetch(consent, { redirect: "manual" });
  assert.equal(approved.status, 302);
  const callback = new URL(approved.headers.get("location")!);
  await ok(undefined, "GET", callback.pathname + callback.search);
  async function drain() {
    for (let i = 0; i < 30; i++) {
      const d = await ok(
        f.owner,
        "GET",
        `/v1/connections/${c.id}/detail`,
        undefined,
        f.tenant,
      );
      if (!d.jobs.some((j: any) => ["queued", "running"].includes(j.status)))
        return d;
      await advanceConnectors(s.db, s.storage);
    }
    throw new Error("Connector did not finish");
  }
  const discovered = await drain(),
    ids = discovered.accounts
      .filter((a: any) => a.readable && a.kind !== "manager")
      .map((a: any) => a.account_id);
  await ok(
    f.owner,
    "PATCH",
    `/v1/connections/${c.id}`,
    {
      expected_version: discovered.connection.version,
      account_ids: ids,
      project_ids: [f.project],
    },
    f.tenant,
  );
  const job = await ok(
    f.owner,
    "POST",
    `/v1/connections/${c.id}/syncs`,
    { date_from: "2026-10-01", date_to: "2026-10-07" },
    f.tenant,
  );
  await drain();
  const completed = await ok(
    f.owner,
    "GET",
    `/v1/syncs/${job.id}`,
    undefined,
    f.tenant,
  );
  assert.equal(completed.state, "complete");
  const result = await run(f, async (ctx) => {
    const read = tool(ctx, "connector_read"),
      listed: any = await read.run({}, randomUUID());
    assert.equal(listed.items[0].id, completed.snapshot_id);
    const callId = randomUUID(),
      input = { snapshot_id: completed.snapshot_id, limit: 1 };
    let page: any = await read.run(input, callId);
    assert.equal(page.data_mode, "simulated");
    assert.ok(page.dataset_ids.length);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      for (const fact of page.facts) {
        assert.ok(!seen.has(fact.key));
        seen.add(fact.key);
      }
      if (page.next_offset === null) break;
      page = await read.run(
        { ...input, offset: page.next_offset },
        randomUUID(),
      );
    }
    assert.equal(seen.size, page.total_facts);
    assert.ok(
      !/access_token|refresh_token|client_secret/.test(JSON.stringify(page)),
    );
    await s.db.control.query(
      "UPDATE connections SET state='revoked' WHERE id=$1",
      [c.id],
    );
    // Disconnecting OAuth prevents new collection, but does not erase retained,
    // authorized historical snapshots. This is the existing connector contract.
    const retained: any = await read.run(input, randomUUID());
    assert.equal(retained.snapshot_id, completed.snapshot_id);
    await s.db.control.query(
      "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=(SELECT asset_id FROM connector_snapshots WHERE id=$1)",
      [completed.snapshot_id],
    );
    await assert.rejects(read.run(input, callId), (e: any) =>
      ["TASK_SOURCE_REVOKED", "NOT_FOUND"].includes(e.code),
    );
  });
  assert.notEqual(result.task.status, "succeeded");
});
