import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { advanceSeoAudits } from "../src/seo-audits.js";
import { Worker } from "../src/worker.js";
import { readyOutbox } from "../src/execution-capacity.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { ErasureService } from "../src/erasure.js";
import { giveSeoStorageLimit } from "./seo-quota-fixture.js";
import { hash } from "../src/lib.js";
import { cancelUnavailableSeoChanges } from "../src/seo-changes.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>,
  clock = Date.now();
type Client = { id: string; cookie: string; csrf: string };
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
beforeEach(() => {
  s.seoFixture!.setRevision(1);
  s.seoFixture!.setFaults([]);
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});
async function call(
  client: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  requestKey = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      "idempotency-key": requestKey,
      ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
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
const ok = (r: Awaited<ReturnType<typeof call>>, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
async function user(): Promise<Client> {
  const challenge = ok(
    await call(undefined, "POST", "/v1/auth/challenge", {
      email: `seo-${randomUUID()}@example.invalid`,
    }),
  );
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,
      "utf8",
    ),
  );
  const response = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  const body = ok(response);
  return {
    id: body.user.id,
    cookie: response.raw.cookies[0].name + "=" + response.raw.cookies[0].value,
    csrf: body.csrf_token,
  };
}
async function fixture(credit = true) {
  const owner = await user(),
    workspace = ok(
      await call(owner, "POST", "/v1/tenants", {
        name: "Scoped SEO QA",
        project_name: "Campaign website",
      }),
    );
  const tenant = workspace.tenant.id as string,
    project = workspace.project.id as string,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  if (credit)
    ok(await call(owner, "POST", `/v1/tenants/${tenant}/demo-credit`, {}));
  const agent = ok(await call(owner, "POST", base + "/analysis/assistant", {}));
  const body = {
    project_id: project,
    agent_id: agent.id,
    input: {
      prompt: "Diagnose the campaign website and retain exact source evidence",
      start_urls: ["https://marketing.example.invalid/"],
      allowed_hosts: ["marketing.example.invalid"],
      max_pages: 10,
    },
    budget: { currency: "HKD", amount_micros: "1000000" },
  };
  return { owner, tenant, project, base, agent, body };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = async (f: Fixture, body = f.body) =>
  ok(await call(f.owner, "POST", "/v1/seo/audits", body, f.tenant), 202);
async function drain(f: Fixture, id: string) {
  for (let n = 0; n < 180; n++) {
    const state = ok(
      await call(f.owner, "GET", "/v1/seo/audits/" + id, undefined, f.tenant),
    );
    if (!["queued", "running"].includes(state.state)) return state;
    clock = Math.max(clock + 1100, Date.parse(state.progress.next_attempt_at));
    await advanceSeoAudits(s.db, s.catalog, s.storage, { now: () => clock });
  }
  throw new Error("The persisted SEO queue exceeded its fixture bound");
}
async function findings(f: Fixture, id: string) {
  return ok(
    await call(
      f.owner,
      "GET",
      `/v1/seo/audits/${id}/findings`,
      undefined,
      f.tenant,
    ),
  );
}
class FixtureRuntime extends CodexRuntimeAdapter {
  calls = 0;
  constructor(
    private invalid = false,
    private unread = false,
  ) {
    super(s.db.config);
  }
  override async start(context: RuntimeContext): Promise<RuntimeResult> {
    this.calls++;
    assert.ok(context.prompt.includes("frozen, scoped SEO"));
    assert.deepEqual(
      context.tools.map((t) => t.name),
      ["seo_audit_facts"],
    );
    const facts = (await context.tools[0].run(
      {},
      "seo-facts-" + randomUUID(),
    )) as any;
    const id = this.unread ? randomUUID() : facts.coverage.id;
    return {
      status: "completed",
      text: JSON.stringify({
        observations: [
          {
            text:
              (this.invalid ? "Invented 999 " : "Scope and coverage: ") +
              `{{${id}}}`,
            evidence_ids: [id],
          },
        ],
        hypotheses: [],
        next_steps: [
          "Review the retained URL evidence before authorizing website changes.",
        ],
      }),
      inputTokens: 100,
      outputTokens: 100,
      usageKnown: true,
      accepted: true,
      thread: "synthetic-seo-thread",
      turn: "synthetic-seo-turn",
    };
  }
}

async function website(interpret = true) {
  const f = await fixture();
  if (!interpret)
    await giveSeoStorageLimit(s, f.tenant, f.agent.role_key, 8 * 1024 * 1024);
  const audit = await create(f);
  await drain(f, audit.id);
  if (interpret)
    await new Worker(s.db, s.catalog, s.storage, new FixtureRuntime()).run(
      f.tenant,
      audit.task_id,
    );
  const current = ok(
    await call(
      f.owner,
      "GET",
      `/v1/seo/audits/${audit.id}`,
      undefined,
      f.tenant,
    ),
  );
  const issues = (await findings(f, audit.id)).items as any[];
  assert.ok(
    issues.length >= 3,
    "Use actual retained findings from the native HTTP fixture",
  );
  return {
    ...f,
    audit: current,
    issues,
    route: `/v1/seo/audits/${audit.id}/change-tasks`,
  };
}
type Website = Awaited<ReturnType<typeof website>>;
const request = (f: Website) => ({
  agent_id: f.agent.id,
  expected_revision: f.audit.revision,
  title: "Review campaign website repairs",
  objective:
    "Draft source corrections and manual verification for the selected website findings.",
  finding_ids: f.issues.slice(0, 3).map((issue) => issue.id),
  budget: f.body.budget,
});
async function save(f: Website, b = request(f), key = randomUUID()) {
  return ok(await call(f.owner, "POST", f.route, b, f.tenant, key), 202);
}
async function detail(f: Website, id: string) {
  return ok(
    await call(f.owner, "GET", f.route + "/" + id, undefined, f.tenant),
  );
}
class ChangeRuntime extends CodexRuntimeAdapter {
  calls = 0;
  pages = 0;
  constructor(
    private ids: string[],
    private kind = "valid",
    private afterFacts?: () => Promise<void>,
  ) {
    super(s.db.config);
  }
  override async start(context: RuntimeContext): Promise<RuntimeResult> {
    this.calls++;
    assert.ok(context.prompt.includes("saved website change draft"));
    assert.deepEqual(
      context.tools.map((tool) => tool.name),
      ["seo_change_facts"],
    );
    if (this.kind !== "none") {
      let offset: number | null = 0;
      do {
        const facts = (await context.tools[0].run(
          { offset },
          "change-facts-" + randomUUID(),
        )) as any;
        this.pages++;
        assert.equal(facts.website_modified, false);
        assert.ok(facts.source_result_sha256.match(/^[a-f0-9]{64}$/));
        for (const item of facts.items) {
          assert.equal(item.source.id, item.source_id);
          assert.ok(item.source.raw_sha256.match(/^[a-f0-9]{64}$/));
        }
        offset = facts.next_offset;
      } while (offset !== null && this.kind !== "unread");
    }
    await this.afterFacts?.();
    let ids = [...this.ids];
    if (this.kind === "unknown") ids[0] = randomUUID();
    if (this.kind === "duplicate") ids[1] = ids[0];
    if (this.kind === "omitted") ids.pop();
    return {
      status: "completed",
      text: JSON.stringify(
        this.kind === "schema"
          ? { applied: true }
          : {
              changes: ids.map((id) => ({
                finding_id: id,
                rationale: "Review the original evidence before editing.",
                proposed_change:
                  '<script>globalThis.NOT_AUTHORIZED=true</script><img src=x onerror="alert(1)">',
                verification: [
                  "Review the source change manually.",
                  "Explicitly recheck the same authorized scope.",
                ],
              })),
            },
      ),
      inputTokens: 100,
      outputTokens: 100,
      usageKnown: true,
      accepted: true,
      thread: "synthetic-change-thread",
      turn: "synthetic-change-turn",
    };
  }
}
async function runChange(f: Website, c: any, runtime: ChangeRuntime) {
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    c.task_id,
  );
  return (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [c.task_id])
  ).rows[0];
}
const sourceAsset = async (f: Website) =>
  (
    await s.db.control.query(
      "SELECT asset_id FROM seo_documents WHERE run_id=$1 AND kind='page' ORDER BY id LIMIT 1",
      [f.audit.id],
    )
  ).rows[0].asset_id as string;

test("saved website change tasks strictly bind actual selected findings, private ownership, normal task versions and budget", async () => {
  const f = await website(),
    b = request(f),
    traffic = s.seoFixture!.calls.length;
  assert.equal(
    (await call(undefined, "POST", f.route, b, f.tenant)).status,
    401,
  );
  for (const body of [
    { ...b, finding_ids: [] },
    { ...b, finding_ids: [b.finding_ids[0], b.finding_ids[0]] },
    { ...b, finding_ids: [randomUUID()] },
    { ...b, writeback: true },
    { ...b, objective: "" },
    { ...b, budget: { currency: "USD", amount_micros: "1000000" } },
    { ...b, budget: { currency: "HKD", amount_micros: "0" } },
  ])
    assert.equal(
      (await call(f.owner, "POST", f.route, body, f.tenant)).status,
      422,
    );
  const c = await save(f),
    t = ok(await call(f.owner, "GET", f.base + "/tasks/" + c.task_id));
  assert.equal(c.state, "queued");
  assert.equal(c.website_modified, false);
  assert.equal(c.source_result_version_id, f.audit.result_asset_version_id);
  assert.equal(t.private_owner, f.owner.id);
  assert.equal(t.input_context.seo_change_task_id, c.id);
  assert.equal(t.prompt, b.objective);
  assert.ok(!t.prompt.includes("https://marketing.example.invalid"));
  assert.equal(
    (
      await s.db.control.query(
        "SELECT amount_micros,status FROM reservations WHERE task_id=$1",
        [t.id],
      )
    ).rows[0].status,
    "reserved",
  );
  for (const table of ["task_skill_bindings", "task_runtime_bindings"])
    assert.ok(
      (
        await s.db.control.query(`SELECT 1 FROM ${table} WHERE task_id=$1`, [
          t.id,
        ])
      ).rowCount,
    );
  assert.equal(
    s.seoFixture!.calls.length,
    traffic,
    "Saving a draft cannot refetch or modify a website",
  );
  assert.equal((await detail(f, c.id)).draft, null);
});

test("saved change retries survive later audit report revisions but retain current access and request conflicts", async () => {
  const f = await website(false),
    b = request(f),
    key = randomUUID(),
    c = await save(f, b, key);
  await new Worker(s.db, s.catalog, s.storage, new FixtureRuntime()).run(
    f.tenant,
    f.audit.task_id,
  );
  const updated = ok(
    await call(
      f.owner,
      "GET",
      `/v1/seo/audits/${f.audit.id}`,
      undefined,
      f.tenant,
    ),
  );
  assert.ok(updated.revision > b.expected_revision);
  assert.equal((await save(f, b, key)).id, c.id);
  const conflict = await call(
    f.owner,
    "POST",
    f.route,
    { ...b, objective: b.objective + " Changed" },
    f.tenant,
    key,
  );
  assert.equal(conflict.data.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(
    (await call(f.owner, "POST", f.route, b, f.tenant)).data.error.code,
    "VERSION_CONFLICT",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM seo_change_tasks WHERE run_id=$1",
        [f.audit.id],
      )
    ).rows[0].n,
    1,
  );
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [await sourceAsset(f)],
  );
  assert.equal(
    (await call(f.owner, "POST", f.route, b, f.tenant, key)).status,
    404,
  );
});

test("a saved draft paginates actual selected evidence and creates immutable escaped JSON and HTML without any writeback tool", async () => {
  const f = await website(),
    b = request(f),
    c = await save(f, b),
    runtime = new ChangeRuntime(b.finding_ids);
  assert.equal((await runChange(f, c, runtime)).status, "succeeded");
  assert.equal(runtime.pages, 2);
  const d = await detail(f, c.id);
  assert.equal(d.state, "draft_ready");
  assert.equal(d.draft.website_modified, false);
  assert.equal(
    d.draft.source_result_version_id,
    f.audit.result_asset_version_id,
  );
  assert.deepEqual(
    d.draft.changes.map((item: any) => item.finding_id).sort(),
    [...b.finding_ids].sort(),
  );
  for (const item of d.draft.changes)
    assert.deepEqual(
      item.evidence,
      f.issues.find((issue) => issue.id === item.finding_id),
    );
  for (const format of ["json", "html"]) {
    const downloaded = await call(
      f.owner,
      "GET",
      `${f.route}/${c.id}/download?format=${format}`,
      undefined,
      f.tenant,
    );
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.raw.headers["cache-control"], "private, no-store");
    assert.equal(
      downloaded.raw.headers["x-content-sha256"],
      hash(downloaded.raw.rawPayload),
    );
    if (format === "html") {
      assert.ok(!downloaded.raw.body.includes("<script>"));
      assert.ok(downloaded.raw.body.includes("&lt;script&gt;"));
    }
  }
  await assert.rejects(
    s.db.control.query("UPDATE seo_change_tasks SET spec='{}' WHERE id=$1", [
      c.id,
    ]),
    /immutable/i,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE seo_change_tasks SET html_asset_version_id=NULL,json_asset_version_id=NULL WHERE id=$1",
      [c.id],
    ),
    /immutable/i,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE tasks SET prompt='Detach the evidence' WHERE id=$1",
      [c.task_id],
    ),
    /immutable/i,
  );
  const detached = await call(f.owner, "POST", f.base + "/tasks", {
    title: "Detach",
    prompt: "Continue using old website evidence",
    role_key: f.agent.role_key,
    budget_micros: 1000000,
    parent_id: c.task_id,
  });
  assert.equal(detached.data.error.code, "SEO_CHANGE_NEW_TASK_REQUIRED");
});

for (const kind of [
  "none",
  "unread",
  "unknown",
  "duplicate",
  "omitted",
  "schema",
])
  test(`saved change rejects ${kind} evidence without publishing a draft`, async () => {
    const f = await website(),
      b = request(f),
      c = await save(f, b),
      runtime = new ChangeRuntime(b.finding_ids, kind);
    const t = await runChange(f, c, runtime);
    assert.equal(t.status, "failed");
    assert.equal(t.error_code, "SEO_CHANGE_NARRATIVE_INVALID");
    assert.equal((await detail(f, c.id)).draft, null);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'seo_change_task_id'=$1",
          [c.id],
        )
      ).rows[0].n,
      0,
    );
  });

test("private change tasks reject same-project editors, other tenants and unrelated audit identifiers", async () => {
  const f = await website(),
    c = await save(f),
    other = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [f.tenant, other.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, other.id],
  );
  for (const suffix of ["", "/" + c.id, "/" + c.id + "/download?format=json"])
    assert.equal(
      (await call(other, "GET", f.route + suffix, undefined, f.tenant)).status,
      404,
    );
  assert.equal(
    (await call(other, "POST", f.route, request(f), f.tenant)).status,
    404,
  );
  assert.equal(
    (await call(f.owner, "GET", f.route + "/" + c.id, undefined, randomUUID()))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        f.route.replace(f.audit.id, randomUUID()) + "/" + c.id,
        undefined,
        f.tenant,
      )
    ).status,
    404,
  );
});

test("quarantine fences queued and paused change tasks, normal task reads and events, releasing unclaimed reservations without a model call", async () => {
  const f = await website(),
    b = request(f),
    c = await save(f, b),
    t = ok(await call(f.owner, "GET", f.base + "/tasks/" + c.task_id));
  ok(
    await call(f.owner, "POST", f.base + "/tasks/" + c.task_id + "/controls", {
      action: "pause",
      expected_version: t.version,
    }),
    202,
  );
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [await sourceAsset(f)],
  );
  assert.equal(
    (await call(f.owner, "GET", f.route + "/" + c.id, undefined, f.tenant))
      .status,
    404,
  );
  assert.equal(
    (await call(f.owner, "GET", f.base + "/tasks/" + c.task_id)).status,
    403,
  );
  assert.equal(
    (await call(f.owner, "GET", f.base + "/tasks/" + c.task_id + "/events"))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `/v1/tasks/${c.task_id}/events`,
        undefined,
        f.tenant,
      )
    ).status,
    403,
  );
  assert.ok(
    !ok(await call(f.owner, "GET", f.base + "/tasks")).items.some(
      (item: any) => item.id === c.task_id,
    ),
  );
  await cancelUnavailableSeoChanges(s.db);
  const runtime = new ChangeRuntime(b.finding_ids);
  const ended = await runChange(f, c, runtime);
  assert.equal(ended.status, "cancelled");
  assert.equal(ended.charged_micros, "0");
  assert.equal(runtime.calls, 0);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [c.task_id],
      )
    ).rows[0].status,
    "released",
  );
});

test("source-task moderation after model facts fences final publication", async () => {
  const f = await website(),
    b = request(f),
    c = await save(f, b);
  const runtime = new ChangeRuntime(b.finding_ids, "valid", async () => {
    await s.db.control.query(
      "UPDATE tasks SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
      [f.audit.task_id],
    );
  });
  const t = await runChange(f, c, runtime);
  assert.notEqual(t.status, "succeeded");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'seo_change_task_id'=$1",
        [c.id],
      )
    ).rows[0].n,
    0,
  );
});

test("draft and published copies retain source fences and physically erase with a deleted original source", async () => {
  const f = await website(),
    b = request(f),
    c = await save(f, b);
  assert.equal(
    (await runChange(f, c, new ChangeRuntime(b.finding_ids))).status,
    "succeeded",
  );
  const versions = (
    await s.db.control.query(
      "SELECT * FROM asset_versions WHERE metadata->>'seo_change_task_id'=$1",
      [c.id],
    )
  ).rows;
  const html = versions.find((row) => row.mime_type === "text/html");
  const published = ok(
    await call(f.owner, "POST", f.base + `/assets/${html.asset_id}/publish`, {
      expected_version: html.version,
      name: "Reviewed website draft",
    }),
  );
  const copy = (
    await s.db.control.query("SELECT * FROM asset_versions WHERE asset_id=$1", [
      published.id,
    ])
  ).rows[0];
  assert.equal(copy.metadata.seo_change_task_id, c.id);
  const source = await sourceAsset(f);
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [source],
  );
  assert.notEqual(
    (await call(f.owner, "GET", `${f.base}/assets/${published.id}/download`))
      .status,
    200,
  );
  await s.db.control.query(
    "UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=$1",
    [source],
  );
  const task = (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [c.task_id])
  ).rows[0];
  assert.equal(task.content_state, "deleted");
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT spec FROM seo_change_tasks WHERE id=$1",
        [c.id],
      )
    ).rows[0].spec,
    {},
  );
  const erasure = new ErasureService(s.db, s.storage);
  for (let n = 0; n < 100; n++) {
    await erasure.advance(4);
    if (
      !(
        await s.db.control.query(
          "SELECT 1 FROM asset_versions WHERE id=ANY($1::uuid[]) AND erased_at IS NULL",
          [[...versions, copy].map((v) => v.id)],
        )
      ).rowCount
    )
      break;
  }
  for (const version of [...versions, copy]) {
    const stored = (
      await s.db.control.query(
        "SELECT erased_at FROM asset_versions WHERE id=$1",
        [version.id],
      )
    ).rows[0];
    assert.ok(stored.erased_at);
    await assert.rejects(s.storage.get(version.storage_key), /ENOENT/);
  }
});

test("a real locked Codex process paginates selected findings through the internal synthetic gateway and saves a governed draft", async () => {
  const f = await website(),
    b = request(f),
    c = await save(f, b);
  await s.worker.run(f.tenant, c.task_id);
  const d = await detail(f, c.id);
  assert.equal(d.state, "draft_ready");
  assert.equal(d.draft.data_mode, "simulated");
  assert.deepEqual(
    d.draft.changes.map((item: any) => item.finding_id).sort(),
    [...b.finding_ids].sort(),
  );
  const count = (
    await s.db.control.query(
      "SELECT count(*)::int AS n FROM task_events WHERE task_id=$1 AND kind='seo.change_facts_read'",
      [c.task_id],
    )
  ).rows[0].n;
  assert.equal(count, 2);
  const task = (
    await s.db.control.query(
      "SELECT input_tokens,output_tokens FROM tasks WHERE id=$1",
      [c.task_id],
    )
  ).rows[0];
  assert.ok(Number(task.input_tokens) > 0 && Number(task.output_tokens) > 0);
});
