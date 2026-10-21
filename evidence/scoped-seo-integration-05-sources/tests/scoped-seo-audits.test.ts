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

test("SEO create is authenticated, strict, idempotent and tied to a private frozen Codex task and reservation", async () => {
  const f = await fixture(),
    requestKey = randomUUID();
  assert.equal(
    (await call(undefined, "POST", "/v1/seo/audits", f.body, f.tenant)).status,
    401,
  );
  const a = ok(
    await call(f.owner, "POST", "/v1/seo/audits", f.body, f.tenant, requestKey),
    202,
  );
  const b = ok(
    await call(f.owner, "POST", "/v1/seo/audits", f.body, f.tenant, requestKey),
    202,
  );
  assert.equal(a.id, b.id);
  assert.equal(a.task_id, b.task_id);
  assert.equal(a.data_mode, "simulated");
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        "/v1/seo/audits",
        { ...f.body, input: { ...f.body.input, max_pages: 5 } },
        f.tenant,
        requestKey,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        "/v1/seo/audits",
        { ...f.body, ignored: true },
        f.tenant,
      )
    ).status,
    400,
  );
  const task = (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [a.task_id])
  ).rows[0];
  assert.equal(task.private_owner, f.owner.id);
  assert.equal(task.input_context.seo_audit_id, a.id);
  assert.equal(task.input_context.agent_id, f.agent.id);
  assert.equal(task.status, "queued");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [a.task_id],
      )
    ).rows[0].status,
    "reserved",
  );
  await assert.rejects(
    s.db.control.query("UPDATE tasks SET input_context='{}' WHERE id=$1", [
      a.task_id,
    ]),
    /binding/i,
  );
  const ready = await s.db.tx(
    (tx) => readyOutbox(tx, "simulated"),
    undefined,
    true,
  );
  assert.equal(
    ready.some((row) => row.payload.task_id === a.task_id),
    false,
  );
  const runtime = new FixtureRuntime();
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    a.task_id,
  );
  assert.equal(runtime.calls, 0);
  ok(await call(f.owner, "POST", `${f.base}/tasks/${a.task_id}/cancel`, {}));
});
test("insufficient funds and unconfirmed scope reject before any website traffic or partial task creation", async () => {
  const f = await fixture(false),
    before = s.seoFixture!.calls.length;
  assert.equal(
    (await call(f.owner, "POST", "/v1/seo/audits", f.body, f.tenant)).status,
    402,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        "/v1/seo/audits",
        {
          ...f.body,
          input: { ...f.body.input, allowed_hosts: ["other.example.invalid"] },
        },
        f.tenant,
      )
    ).status,
    400,
  );
  assert.equal(s.seoFixture!.calls.length, before);
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) AS n FROM seo_runs WHERE project_id=$1",
          [f.project],
        )
      ).rows[0].n,
    ),
    0,
  );
});
test("native database checkpoints retain actual website response containers and issue locations; Codex can publish only a validated report", async () => {
  const f = await fixture(),
    a = await create(f),
    done = await drain(f, a.id);
  assert.equal(done.state, "partial");
  assert.equal(done.task_status, "queued");
  assert.ok(done.result_asset_version_id);
  const evidence = await findings(f, a.id),
    broken = evidence.items.find((i: any) => i.code === "broken_link");
  assert.ok(broken);
  assert.equal(
    evidence.items.filter((i: any) => i.code === "duplicate_title").length,
    2,
  );
  const source = ok(
    await call(
      f.owner,
      "GET",
      `/v1/seo/audits/${a.id}/documents/${broken.source_id}`,
      undefined,
      f.tenant,
    ),
  );
  const download = ok(
    await call(
      f.owner,
      "GET",
      `${f.base}/assets/${source.asset_id}/download?version=${source.asset_version}`,
    ),
  );
  assert.equal(
    download.text.slice(broken.location.start, broken.location.end),
    broken.location.quote,
  );
  assert.equal(download.source_mode, "simulated");
  assert.equal(download.response_sha256, download.raw_sha256);
  const exported = await call(
    f.owner,
    "GET",
    `/v1/seo/audits/${a.id}/download?format=json`,
    undefined,
    f.tenant,
  );
  assert.equal(ok(exported).run_id, a.id);
  assert.deepEqual(exported.data.findings, evidence.items);
  assert.equal(exported.raw.headers["cache-control"], "private, no-store");
  assert.match(
    exported.raw.headers["content-disposition"] as string,
    /attachment/,
  );
  const runtime = new FixtureRuntime();
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    a.task_id,
  );
  assert.equal(runtime.calls, 1);
  const ready = ok(
    await call(f.owner, "GET", "/v1/seo/audits/" + a.id, undefined, f.tenant),
  );
  assert.equal(ready.task_status, "succeeded");
  assert.ok(ready.report_asset_version_id);
  const artifact = (
    await s.db.control.query(
      "SELECT asset_id FROM asset_versions WHERE id=$1",
      [ready.report_asset_version_id],
    )
  ).rows[0].asset_id;
  const html = ok(
    await call(f.owner, "GET", `${f.base}/assets/${artifact}/download`),
  );
  assert.match(html, /Scoped SEO audit/);
  assert.ok(html.includes(broken.id));
  assert.equal(html.includes("{{"), false);
  const reportDownload = await call(
    f.owner,
    "GET",
    `/v1/seo/audits/${a.id}/download?format=html`,
    undefined,
    f.tenant,
  );
  assert.equal(ok(reportDownload), html);
  assert.match(
    reportDownload.raw.headers["x-content-sha256"] as string,
    /^[a-f0-9]{64}$/,
  );
});
test("same-project editors and other tenants cannot read another user private audit or raw sources", async () => {
  const f = await fixture(),
    a = await create(f);
  await drain(f, a.id);
  const other = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [f.tenant, other.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, other.id],
  );
  for (const suffix of [
    "",
    "/pages",
    "/findings",
    "/download?format=json",
    "/download?format=html",
  ])
    assert.equal(
      (
        await call(
          other,
          "GET",
          "/v1/seo/audits/" + a.id + suffix,
          undefined,
          f.tenant,
        )
      ).status,
      404,
    );
  assert.deepEqual(
    ok(
      await call(
        other,
        "GET",
        "/v1/seo/audits?project_id=" + f.project,
        undefined,
        f.tenant,
      ),
    ).items,
    [],
  );
  assert.equal(
    (
      await s.db.tx(
        (tx) => tx.query("SELECT id FROM seo_runs WHERE id=$1", [a.id]),
        f.tenant,
      )
    ).rowCount,
    0,
  );
});
test("pause, resume and cancellation preserve the existing pre-model task checkpoint and stop collection", async () => {
  const f = await fixture(),
    a = await create(f);
  let task = ok(await call(f.owner, "GET", `${f.base}/tasks/${a.task_id}`));
  ok(
    await call(f.owner, "POST", `${f.base}/tasks/${a.task_id}/controls`, {
      action: "pause",
      expected_version: task.version,
    }),
    202,
  );
  const before = s.seoFixture!.calls.length;
  await advanceSeoAudits(s.db, s.catalog, s.storage, {
    now: () => clock + 100000,
  });
  assert.equal(s.seoFixture!.calls.length, before);
  task = ok(await call(f.owner, "GET", `${f.base}/tasks/${a.task_id}`));
  ok(
    await call(f.owner, "POST", `${f.base}/tasks/${a.task_id}/controls`, {
      action: "resume",
      expected_version: task.version,
    }),
    202,
  );
  await advanceSeoAudits(s.db, s.catalog, s.storage, {
    now: () => clock + 100000,
  });
  assert.equal(s.seoFixture!.calls.length, before + 1);
  ok(await call(f.owner, "POST", `${f.base}/tasks/${a.task_id}/cancel`, {}));
  await advanceSeoAudits(s.db, s.catalog, s.storage, {
    now: () => clock + 200000,
  });
  const cancelled = ok(
    await call(f.owner, "GET", "/v1/seo/audits/" + a.id, undefined, f.tenant),
  );
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.task_status, "cancelled");
  assert.equal(s.seoFixture!.calls.length, before + 1);
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
test("immutable recheck records observed repairs and retains both previous and current evidence", async () => {
  const f = await fixture(),
    a = await create(f);
  await drain(f, a.id);
  await new Worker(s.db, s.catalog, s.storage, new FixtureRuntime()).run(
    f.tenant,
    a.task_id,
  );
  const original = ok(
      await call(f.owner, "GET", "/v1/seo/audits/" + a.id, undefined, f.tenant),
    ),
    old = await findings(f, a.id);
  s.seoFixture!.setRevision(2);
  const body = {
      agent_id: f.agent.id,
      expected_revision: original.revision,
      budget: f.body.budget,
    },
    requestKey = randomUUID();
  const recheck = ok(
    await call(
      f.owner,
      "POST",
      `/v1/seo/audits/${a.id}/recheck`,
      body,
      f.tenant,
      requestKey,
    ),
    202,
  );
  assert.equal(
    ok(
      await call(
        f.owner,
        "POST",
        `/v1/seo/audits/${a.id}/recheck`,
        body,
        f.tenant,
        requestKey,
      ),
      202,
    ).id,
    recheck.id,
  );
  await drain(f, recheck.id);
  const result = await findings(f, recheck.id);
  assert.equal(
    result.items.some((i: any) => i.code === "broken_link"),
    false,
  );
  for (const issue of old.items.filter((i: any) =>
    ["broken_link", "duplicate_title"].includes(i.code),
  ))
    assert.equal(
      result.comparison.changes.find(
        (c: any) => c.previous_finding_id === issue.id,
      ).state,
      "resolved",
    );
  assert.deepEqual((await findings(f, a.id)).items, old.items);
  await assert.rejects(
    s.db.control.query(
      "UPDATE seo_documents SET url_sha256=$2 WHERE run_id=$1",
      [a.id, "0".repeat(64)],
    ),
    /permission denied/i,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE seo_runs SET checkpoint='{}',revision=revision+1 WHERE id=$1",
      [a.id],
    ),
    /history|identity/i,
  );
});
test("an old report cannot be read, downloaded or copied after a source is quarantined or expired", async () => {
  const f = await fixture(),
    a = await create(f);
  await drain(f, a.id);
  await new Worker(s.db, s.catalog, s.storage, new FixtureRuntime()).run(
    f.tenant,
    a.task_id,
  );
  const binding = (
    await s.db.control.query(
      "SELECT asset_id FROM seo_documents WHERE run_id=$1 ORDER BY captured_at,id LIMIT 1",
      [a.id],
    )
  ).rows[0];
  const run = (
    await s.db.control.query("SELECT * FROM seo_runs WHERE id=$1", [a.id])
  ).rows[0];
  const report = (
    await s.db.control.query(
      "SELECT asset_id FROM asset_versions WHERE id=$1",
      [run.report_asset_version_id],
    )
  ).rows[0].asset_id;
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [binding.asset_id],
  );
  assert.equal(
    (await call(f.owner, "GET", "/v1/seo/audits/" + a.id, undefined, f.tenant))
      .status,
    404,
  );
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/assets/${report}/download`)).status,
    404,
  );
  await s.db.control.query(
    "UPDATE assets SET state='active',moderation_version=moderation_version+1,retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [binding.asset_id],
  );
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/assets/${report}/download`)).status,
    404,
  );
});

test("conditional HTTP cache retains its source lineage and blocks derived evidence when the original is quarantined", async () => {
  const f = await fixture(),
    first = await create(f);
  await drain(f, first.id);
  await new Worker(s.db, s.catalog, s.storage, new FixtureRuntime()).run(
    f.tenant,
    first.task_id,
  );
  const second = await create(f, {
    ...f.body,
    input: { ...f.body.input, cache_policy: "reuse_valid" },
  } as typeof f.body);
  await drain(f, second.id);
  const cached = (
    await s.db.control.query(
      `SELECT d.id,d.cache_source_id,p.asset_id FROM seo_documents d
    JOIN seo_documents p ON p.id=d.cache_source_id WHERE d.run_id=$1 ORDER BY d.id LIMIT 1`,
      [second.id],
    )
  ).rows[0];
  assert.ok(
    cached,
    "A real HTTP 304 must retain its original container binding",
  );
  const metadata = ok(
    await call(
      f.owner,
      "GET",
      `/v1/seo/audits/${second.id}/documents/${cached.id}`,
      undefined,
      f.tenant,
    ),
  );
  assert.equal(metadata.http_status, 304);
  assert.equal(metadata.effective_status, 200);
  assert.notEqual(metadata.response_sha256, metadata.raw_sha256);
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [cached.asset_id],
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `/v1/seo/audits/${second.id}/findings`,
        undefined,
        f.tenant,
      )
    ).status,
    404,
  );
  ok(
    await call(f.owner, "POST", `${f.base}/tasks/${second.task_id}/cancel`, {}),
  );
});

test("current identity is checked again after retained evidence storage I/O", async () => {
  const f = await fixture(),
    a = await create(f);
  const done = await drain(f, a.id),
    row = (
      await s.db.control.query(
        "SELECT storage_key FROM asset_versions WHERE id=$1",
        [done.result_asset_version_id],
      )
    ).rows[0];
  const get = s.storage.get.bind(s.storage);
  let revoked = false;
  s.storage.get = async (key: string) => {
    const bytes = await get(key);
    if (key === row.storage_key && !revoked) {
      revoked = true;
      await s.db.control.query(
        "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
        [f.owner.id],
      );
    }
    return bytes;
  };
  try {
    const response = await call(
      f.owner,
      "GET",
      `/v1/seo/audits/${a.id}/findings`,
      undefined,
      f.tenant,
    );
    assert.equal(revoked, true);
    assert.equal(response.status, 404);
    assert.equal(
      JSON.stringify(response.data).includes("marketing.example.invalid"),
      false,
    );
  } finally {
    s.storage.get = get;
  }
});
test("explicitly published copies preserve source governance and are physically erased with a deleted source", async () => {
  const f = await fixture(),
    a = await create(f);
  await drain(f, a.id);
  await new Worker(s.db, s.catalog, s.storage, new FixtureRuntime()).run(
    f.tenant,
    a.task_id,
  );
  const run = (
    await s.db.control.query("SELECT * FROM seo_runs WHERE id=$1", [a.id])
  ).rows[0];
  const report = (
    await s.db.control.query(
      "SELECT asset_id FROM asset_versions WHERE id=$1",
      [run.report_asset_version_id],
    )
  ).rows[0].asset_id;
  const publication = ok(
    await call(f.owner, "POST", `${f.base}/assets/${report}/publish`, {
      expected_version: 1,
      name: "Reviewed SEO report",
    }),
  );
  const version = (
    await s.db.control.query(
      "SELECT storage_key,metadata FROM asset_versions WHERE asset_id=$1",
      [publication.id],
    )
  ).rows[0];
  assert.equal(version.metadata.seo_run_id, a.id);
  assert.equal(publication.private_owner, null);
  const source = (
    await s.db.control.query(
      "SELECT asset_id FROM seo_documents WHERE run_id=$1 LIMIT 1",
      [a.id],
    )
  ).rows[0].asset_id;
  await s.db.control.query(
    "UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=$1",
    [source],
  );
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/assets/${publication.id}/download`))
      .status,
    404,
  );
  const erased = new ErasureService(s.db, s.storage);
  for (let n = 0; n < 18; n++) await erased.advance();
  const proof = (
    await s.db.control.query("SELECT state FROM assets WHERE id=$1", [
      publication.id,
    ])
  ).rows[0];
  assert.equal(proof.state, "deleted");
  await assert.rejects(s.storage.get(version.storage_key), { code: "ENOENT" });
  const cleared = (
    await s.db.control.query(
      "SELECT invalidated_at,checkpoint FROM seo_runs WHERE id=$1",
      [a.id],
    )
  ).rows[0];
  assert.ok(cleared.invalidated_at);
  assert.deepEqual(cleared.checkpoint, {});
});
test("unbound numerical or unread narrative claims fail without creating a report", async () => {
  for (const runtimeKind of ["numbers", "unread"] as const) {
    const f = await fixture(),
      a = await create(f);
    await drain(f, a.id);
    await new Worker(
      s.db,
      s.catalog,
      s.storage,
      new FixtureRuntime(runtimeKind === "numbers", runtimeKind === "unread"),
    ).run(f.tenant, a.task_id);
    const run = ok(
      await call(f.owner, "GET", "/v1/seo/audits/" + a.id, undefined, f.tenant),
    );
    assert.equal(run.task_status, "failed");
    assert.equal(run.report_asset_version_id, null);
    assert.equal(run.progress.error_code, "SEO_NARRATIVE_INVALID");
  }
});
test("current permission revocation fences the next crawl request and releases only the unclaimed AI reservation", async () => {
  const f = await fixture(),
    a = await create(f);
  await s.db.control.query(
    "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
    [f.owner.id],
  );
  const before = s.seoFixture!.calls.length;
  await advanceSeoAudits(s.db, s.catalog, s.storage, {
    now: () => clock + 100000,
  });
  assert.equal(s.seoFixture!.calls.length, before);
  const task = (
    await s.db.control.query(
      "SELECT status,cancel_requested FROM tasks WHERE id=$1",
      [a.task_id],
    )
  ).rows[0];
  assert.equal(task.status, "cancelled");
  assert.equal(task.cancel_requested, true);
});

test("actual SQL storage exhaustion stops collection and releases the unclaimed model reservation without repeated HTTP", async () => {
  const f = await fixture(), a = await create(f);
  await giveSeoStorageLimit(s, f.tenant);
  const resources = ok(await call(f.owner, "GET", `/v1/tenants/${f.tenant}/resource-usage`));
  assert.equal(resources.storage.limit_bytes, "16");
  // Reserve the real remaining allowance; no object bytes or fake SQL errors.
  await s.db.control.query(
    "INSERT INTO upload_sessions(tenant_id,project_id,created_by,filename,mime_type,size_bytes,sha256) VALUES($1,$2,$3,'pending-capacity.txt','text/plain',$4,$5)",
    [f.tenant, f.project, f.owner.id, resources.storage.remaining_bytes, "0".repeat(64)],
  );
  const before = s.seoFixture!.calls.length;
  await advanceSeoAudits(s.db, s.catalog, s.storage, { now: () => clock + 100000 });
  const task = (await s.db.control.query("SELECT status,error_code,charged_micros,runtime_thread FROM tasks WHERE id=$1", [a.task_id])).rows[0];
  assert.equal(task.status, "cancelled");
  assert.equal(task.error_code, "PLAN_STORAGE_LIMIT");
  assert.equal(task.charged_micros, "0");
  assert.equal(task.runtime_thread, null);
  assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [a.task_id])).rows[0].status, "released");
  assert.equal(s.seoFixture!.calls.length, before + 1);
  for (let n = 0; n < 4; n++) await advanceSeoAudits(s.db, s.catalog, s.storage, { now: () => clock + 200000 });
  assert.equal(s.seoFixture!.calls.length, before + 1);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM seo_documents WHERE run_id=$1", [a.id])).rows[0].n, 0);
});
