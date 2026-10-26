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
import { ErasureService } from "../src/erasure.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
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
) {
  const r = await call(c, method, url, body, tenant);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", {
    email: `reports-${randomUUID()}@example.invalid`,
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
    w = await ok(owner, "POST", "/v1/tenants", {
      name: "Analysis studio",
      project_name: "Report project",
    });
  const tenant = w.tenant.id,
    project = w.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  if (credit) await ok(owner, "POST", `/v1/tenants/${tenant}/demo-credit`, {});
  const d = await ok(owner, "POST", base + "/analytics/import", {
    name: "Launch",
    csv: "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Launch,1000,100,100,4,400,HKD",
    currency: "HKD",
    account_id: "account",
    attribution_definition: "7d click",
    conversion_definition: "Purchase",
  });
  const agent = await ok(owner, "POST", base + "/analysis/assistant", {});
  const body = {
    project_id: project,
    agent_id: agent.id,
    analysis: {
      prompt: "Review campaign evidence",
      snapshot_ids: [d.id],
      date_from: "2026-10-01",
      date_to: "2026-10-02",
      timezone: "Asia/Hong_Kong",
      currency_policy: "group_by_currency",
      metrics: ["spend", "ctr", "roas"],
      dimensions: [],
    },
    budget: { currency: "HKD", amount_micros: "1000000" },
  };
  return { owner, tenant, project, base, d, body };
}
async function create(f: Awaited<ReturnType<typeof fixture>>) {
  const r = await call(f.owner, "POST", "/v1/reports", f.body, f.tenant);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  return r.data;
}
class FixtureRuntime extends CodexRuntimeAdapter {
  constructor(private invalid = false) {
    super(s.db.config);
  }
  override async start(c: RuntimeContext): Promise<RuntimeResult> {
    assert.ok(c.prompt.includes("frozen campaign analysis report"));
    assert.ok(
      c.tools.every(
        (t) =>
          ![
            "deliver_text",
            "image2_generate",
            "code_write",
            "design_render",
          ].includes(t.name),
      ),
    );
    const facts: any = await c.tools
      .find((t) => t.name === "analysis_report_facts")!
      .run({}, "facts-" + randomUUID());
    const id = facts.evidence[0].id;
    const ids = new Set(facts.evidence.map((e: any) => e.id));
    let next = facts.next_offset;
    while (next !== null) {
      const page: any = await c.tools
        .find((t) => t.name === "analysis_report_facts")!
        .run({ offset: next }, "facts-page-" + randomUUID());
      assert.ok(page.evidence.length > 0 && page.evidence.length <= 2);
      for (const e of page.evidence) {
        assert.ok(!ids.has(e.id));
        ids.add(e.id);
      }
      next = page.next_offset;
    }
    assert.equal(ids.size, facts.total_evidence);
    return {
      status: "completed",
      text: JSON.stringify({
        observations: [
          {
            text: this.invalid
              ? `Invented 999 {{${id}}}`
              : `Spend is {{${id}}}`,
            evidence_ids: [id],
          },
        ],
        hypotheses: [],
        next_steps: ["Verify coverage before changing the campaign."],
      }),
      inputTokens: 100,
      outputTokens: 100,
      usageKnown: true,
      accepted: true,
      thread: "fixture-report-thread",
      turn: "fixture-report-turn",
    };
  }
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
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
test("report creation is one task and reservation under retries; canonical snapshot/evidence have real authorized reads", async () => {
  const f = await fixture(),
    key = randomUUID();
  assert.equal(
    (
      await call(
        { ...f.owner, csrf: "" },
        "POST",
        "/v1/reports",
        f.body,
        f.tenant,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        "/v1/reports",
        {
          ...f.body,
          budget: { currency: "HKD", amount_micros: "1000000000000" },
        },
        f.tenant,
      )
    ).status,
    403,
  );
  const unfunded = await fixture(false);
  const insufficient = await call(
    unfunded.owner,
    "POST",
    "/v1/reports",
    unfunded.body,
    unfunded.tenant,
  );
  assert.equal(insufficient.status, 402, JSON.stringify(insufficient.data));
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM tasks WHERE project_id=$1",
        [unfunded.project],
      )
    ).rows[0].n,
    0,
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
  assert.equal(
    (
      await s.db.control.query(
        "SELECT reserved_micros FROM wallets WHERE tenant_id=$1",
        [f.tenant],
      )
    ).rows[0].reserved_micros,
    "0",
  );
  const requests = await Promise.all(
    Array.from({ length: 6 }, () =>
      call(f.owner, "POST", "/v1/reports", f.body, f.tenant, key),
    ),
  );
  requests.forEach((r) => assert.equal(r.status, 202, JSON.stringify(r.data)));
  const r = requests[0].data;
  assert.equal(new Set(requests.map((r) => r.data.id)).size, 1);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [r.task_id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        "/v1/reports",
        {
          ...f.body,
          analysis: { ...f.body.analysis, prompt: "Different question" },
        },
        f.tenant,
        key,
      )
    ).status,
    409,
  );
  const source = await ok(
    f.owner,
    "GET",
    "/v1/snapshots/" + f.d.id,
    undefined,
    f.tenant,
  );
  assert.equal(source.data_as_of, null);
  const sourceEvidence = await ok(
    f.owner,
    "GET",
    "/v1/evidence/" + f.d.summary.evidence[0].id,
    undefined,
    f.tenant,
  );
  assert.deepEqual(sourceEvidence, f.d.summary.evidence[0]);
  await new Worker(s.db, s.catalog, s.storage, new FixtureRuntime()).run(
    f.tenant,
    r.task_id,
  );
  const ready = await ok(
    f.owner,
    "GET",
    "/v1/reports/" + r.id,
    undefined,
    f.tenant,
  );
  assert.equal(ready.state, "ready");
  const evidence = await ok(
    f.owner,
    "GET",
    "/v1/evidence/" + ready.evidence_ids[0],
    undefined,
    f.tenant,
  );
  assert.equal(evidence.value, "0.10000000");
  const snapshot = await ok(
    f.owner,
    "GET",
    "/v1/snapshots/" + ready.snapshot_ids[0],
    undefined,
    f.tenant,
  );
  assert.equal(snapshot.data_as_of, null);
  const html = await ok(
    f.owner,
    "GET",
    f.base + `/analysis/reports/${r.id}/download?format=html`,
  );
  assert.match(html, /Frozen evidence/);
  assert.ok(html.includes(evidence.id));
  assert.ok(!html.includes("{{"));
  await assert.rejects(
    s.db.control.query("UPDATE analysis_snapshots SET body='{}' WHERE id=$1", [
      ready.snapshot_ids[0],
    ]),
    /Frozen analysis/,
  );
  await assert.rejects(
    s.db.control.query("UPDATE tasks SET input_context='{}' WHERE id=$1", [
      r.task_id,
    ]),
    /binding/,
  );
  const other = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [f.tenant, other.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, other.id],
  );
  assert.equal(
    (await call(other, "GET", "/v1/reports/" + r.id, undefined, f.tenant))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        other,
        "GET",
        "/v1/evidence/" + evidence.id,
        undefined,
        f.tenant,
      )
    ).status,
    404,
  );
  await s.db.control.query(
    "UPDATE memberships SET role='member' WHERE tenant_id=$1 AND user_id=$2",
    [f.tenant, f.owner.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor') ON CONFLICT(project_id,user_id) DO UPDATE SET role='editor'",
    [f.tenant, f.project, f.owner.id],
  );
  assert.equal(
    (await call(f.owner, "GET", "/v1/reports/" + r.id, undefined, f.tenant))
      .status,
    200,
  );
  await s.db.control.query(
    "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
    [f.project, f.owner.id],
  );
  for (const url of [
    "/v1/reports/" + r.id,
    "/v1/evidence/" + evidence.id,
    "/v1/snapshots/" + ready.snapshot_ids[0],
  ])
    assert.equal(
      (await call(f.owner, "GET", url, undefined, f.tenant)).status,
      404,
    );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        f.base + `/analysis/reports/${r.id}/download?format=html`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(f.owner, "POST", "/v1/reports", f.body, f.tenant, key)).status,
    404,
  );
});
test("invalid model numbers fail report publication while retaining real usage settlement", async () => {
  const f = await fixture(),
    r = await create(f);
  await new Worker(s.db, s.catalog, s.storage, new FixtureRuntime(true)).run(
    f.tenant,
    r.task_id,
  );
  const t = (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [r.task_id])
  ).rows[0];
  assert.equal(t.status, "failed");
  assert.equal(t.error_code, "REPORT_NARRATIVE_INVALID");
  assert.equal(Number(t.input_tokens), 100);
  const record = await ok(f.owner, "GET", f.base + "/analysis/reports/" + r.id);
  assert.equal(record.report.state, "failed");
  assert.equal(record.validation.state, "failed");
  assert.equal(record.narrative, null);
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        f.base + `/analysis/reports/${r.id}/download?format=html`,
      )
    ).status,
    409,
  );
  const blocked = await fixture(),
    queued = await create(blocked);
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
    [blocked.d.id],
  );
  let modelCalled = false;
  class NeverCalled extends FixtureRuntime {
    override async start(c: RuntimeContext) {
      modelCalled = true;
      return super.start(c);
    }
  }
  await new Worker(s.db, s.catalog, s.storage, new NeverCalled()).run(
    blocked.tenant,
    queued.task_id,
  );
  assert.equal(modelCalled, false);
  const cancelled = (
    await s.db.control.query(
      "SELECT status,error_code,charged_micros FROM tasks WHERE id=$1",
      [queued.task_id],
    )
  ).rows[0];
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error_code, "AUTHORIZATION_CHANGED");
  assert.equal(cancelled.charged_micros, "0");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT reserved_micros FROM wallets WHERE tenant_id=$1",
        [blocked.tenant],
      )
    ).rows[0].reserved_micros,
    "0",
  );
});
test("source quarantine, restore, permanent erasure and permission changes protect every report derivative", async () => {
  const f = await fixture(),
    r = await create(f);
  await new Worker(s.db, s.catalog, s.storage, new FixtureRuntime()).run(
    f.tenant,
    r.task_id,
  );
  const report = (
    await s.db.control.query("SELECT * FROM analysis_reports WHERE id=$1", [
      r.id,
    ])
  ).rows[0];
  const asset = (
    await s.db.control.query(
      "SELECT asset_id FROM asset_versions WHERE id=$1",
      [report.asset_version_id],
    )
  ).rows[0].asset_id;
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
    [f.d.id],
  );
  assert.equal(
    (await call(f.owner, "GET", "/v1/reports/" + r.id, undefined, f.tenant))
      .status,
    404,
  );
  assert.equal(
    (await call(f.owner, "GET", f.base + `/assets/${asset}/download`)).status,
    404,
  );
  assert.equal(
    (await call(f.owner, "POST", "/v1/reports", f.body, f.tenant)).status,
    404,
  );
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='active' WHERE id=$1",
    [f.d.id],
  );
  assert.equal(
    (await ok(f.owner, "GET", "/v1/reports/" + r.id, undefined, f.tenant))
      .state,
    "ready",
  );
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1",
    [f.d.id],
  );
  await new ErasureService(s.db, s.storage).advance(10);
  const erased = (
    await s.db.control.query("SELECT * FROM analysis_reports WHERE id=$1", [
      r.id,
    ])
  ).rows[0];
  assert.deepEqual(erased.calculation, {});
  assert.deepEqual(erased.spec, {});
  assert.equal(erased.narrative, null);
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        "/v1/evidence/" + r.evidence_ids[0],
        undefined,
        f.tenant,
      )
    ).status,
    404,
  );
  assert.equal(
    (await s.db.control.query("SELECT state FROM assets WHERE id=$1", [asset]))
      .rows[0].state,
    "deleted",
  );
  const task = (
    await s.db.control.query("SELECT prompt,output FROM tasks WHERE id=$1", [
      r.task_id,
    ])
  ).rows[0];
  assert.equal(task.prompt, "[deleted]");
  assert.equal(task.output, null);
});
test("real pinned Codex consumes frozen report facts through the authorized tool and publishes a checked HTML asset", async () => {
  const f = await fixture();
  for (const [source, currency] of [
    ["google_ads", "USD"],
    ["meta_ads", "HKD"],
  ]) {
    const d = await ok(f.owner, "POST", f.base + "/analytics/import", {
      name: `${source} ${currency}`,
      source,
      currency,
      account_id: "account",
      entity_level: "campaign",
      attribution_definition: "7d click",
      conversion_definition: "Purchase",
      csv: `date,channel,campaign,entity_id,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,${source},Launch,a,1000,100,100,4,400,${currency}\n2026-09-01,${source},Launch,a,1000,100,80,2,200,${currency}`,
    });
    f.body.analysis.snapshot_ids.push(d.id);
  }
  f.body.analysis.metrics = ["spend", "ctr", "roas", "cpc", "clicks"];
  Object.assign(f.body.analysis, {
    comparison: { date_from: "2026-09-01", date_to: "2026-09-02" },
  });
  const r = await create(f);
  assert.equal(r.evidence_ids.length, 45);
  let actualText = "";
  class CapturedCodex extends CodexRuntimeAdapter {
    override async start(c: RuntimeContext) {
      const r = await super.start(c);
      actualText = r.text;
      return r;
    }
  }
  await new Worker(
    s.db,
    s.catalog,
    s.storage,
    new CapturedCodex(s.db.config),
  ).run(f.tenant, r.task_id);
  const task = (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [r.task_id])
  ).rows[0];
  assert.equal(
    task.status,
    "succeeded",
    JSON.stringify({ code: task.error_code, output: task.output, actualText }),
  );
  assert.equal(
    (await ok(f.owner, "GET", "/v1/reports/" + r.id, undefined, f.tenant))
      .state,
    "ready",
  );
  assert.ok(task.runtime_thread);
  assert.equal(task.kernel, "codex");
});
