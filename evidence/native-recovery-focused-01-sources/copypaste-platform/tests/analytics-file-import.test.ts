import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { hash } from "../src/lib.js";
import { ErasureService } from "../src/erasure.js";
import { assertReportSources } from "../src/analysis-reports.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { packWorkbook, campaignWorkbook } from "./workbook-fixtures.js";
import { XLSX_MIME } from "../src/analytics-workbook.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter } from "../src/runtime.js";
import { recoverQueuedClaims } from "../src/task-recovery.js";
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
      email: `imports-${randomUUID()}@example.invalid`,
    }),
    mail = JSON.parse(
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
async function fixture() {
  const owner = await user(),
    w = await ok(owner, "POST", "/v1/tenants", {
      name: "File import studio",
      project_name: "Campaign files",
    });
  return {
    owner,
    tenant: w.tenant.id,
    project: w.project.id,
    base: `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const options = {
  source: "google_ads",
  account_id: "A",
  currency: "HKD",
  timezone: "Asia/Hong_Kong",
  entity_level: "campaign",
  attribution_definition: "7d click",
  conversion_definition: "Purchase",
  mapping: {},
};
const csv = (cost = "100.125") =>
  Buffer.from(
    `date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency,entity_id\r\n2026-10-01,Google,Launch,1000,100,${cost},4.5,450,HKD,456`,
  );
async function asset(
  f: Fixture,
  bytes: Buffer = csv(),
  name = "launch.csv",
  versionOf?: any,
) {
  return s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        name,
        mime: name.endsWith("xlsx") ? XLSX_MIME : "text/csv",
        bytes,
        ...(versionOf
          ? { asset: versionOf.id, expectedVersion: versionOf.current_version }
          : {}),
      }),
    f.tenant,
    false,
    f.owner.id,
  );
}
const body = (f: Fixture, a: any, extra: Record<string, unknown> = {}) => ({
  project_id: f.project,
  asset_version_id: a.version.id,
  ...options,
  ...extra,
});
async function imported(
  f: Fixture,
  a: any,
  extra: Record<string, unknown> = {},
) {
  const r = await call(
    f.owner,
    "POST",
    "/v1/dataset-imports",
    body(f, a, extra),
    f.tenant,
  );
  assert.equal(r.status, 202, JSON.stringify(r.data));
  return r.data;
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
test("canonical file imports deduplicate concurrent requests and legacy CSV; pinned versions survive later uploads", async () => {
  const f = await fixture(),
    a = await asset(f),
    request = body(f, a),
    key = randomUUID();
  const info = await ok(f.owner, "POST", f.base + "/analytics/file-inspect", {
    asset_version_id: a.version.id,
  });
  assert.equal(info.file_type, "csv");
  assert.equal(info.source_sha256, hash(csv()));
  const preview = await ok(
    f.owner,
    "POST",
    f.base + "/analytics/file-preview",
    { ...options, name: "Launch", asset_version_id: a.version.id },
  );
  assert.equal(preview.summary.exact.spend, "100.12500000");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM analytics_datasets WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    0,
  );
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () =>
      call(f.owner, "POST", "/v1/dataset-imports", request, f.tenant, key),
    ),
  );
  concurrent.forEach((r) =>
    assert.equal(r.status, 202, JSON.stringify(r.data)),
  );
  assert.equal(new Set(concurrent.map((r) => r.data.id)).size, 1);
  const d = concurrent[0].data;
  assert.deepEqual(
    Object.keys(d).sort(),
    [
      "id",
      "project_id",
      "source",
      "state",
      "row_count",
      "data_as_of",
      "spec_hash",
    ].sort(),
  );
  assert.equal(d.data_as_of, null);
  const text = await ok(f.owner, "POST", f.base + "/analytics/import", {
    ...options,
    name: "Legacy retry",
    csv: csv().toString("utf8"),
  });
  assert.equal(text.id, d.id);
  await asset(f, csv("200"), "launch.csv", a);
  await s.db.control.query("UPDATE assets SET name='renamed-as-workbook.xlsx' WHERE id=$1", [a.id]);
  const pinned = await ok(f.owner, "POST", f.base + "/analytics/file-inspect", {
    asset_version_id: a.version.id,
  });
  assert.equal(pinned.file_type, "csv");
  assert.equal(pinned.source_sha256, hash(csv()));
  assert.equal((await imported(f, a)).id, d.id);
  const raw = await call(f.owner, "GET", f.base + `/analytics/${d.id}/source`);
  assert.equal(raw.status, 200);
  assert.deepEqual(raw.raw.rawPayload, csv());
  const stored = await ok(f.owner, "GET", f.base + `/analytics/${d.id}`);
  assert.equal(stored.source_asset_version_id, a.version.id);
  assert.equal(stored.summary.exact.spend, "100.12500000");
  await assert.rejects(
    s.db.control.query(
      "UPDATE analytics_datasets SET source_asset_version_id=NULL WHERE id=$1",
      [d.id],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE analytics_datasets SET source_state='quarantined' WHERE id=$1",
      [d.id],
    ),
    { code: "23514" },
  );
  const changed = await call(
    f.owner,
    "POST",
    "/v1/dataset-imports",
    { ...request, name: "Different body" },
    f.tenant,
    key,
  );
  assert.equal(changed.status, 409);
});
test("canonical XLSX freezes mapping and file bytes; malformed cells and formula exports never write a snapshot", async () => {
  const f = await fixture(),
    bytes = packWorkbook(campaignWorkbook()),
    a = await asset(f, bytes, "launch.xlsx"),
    d = await imported(f, a);
  const stored = await ok(f.owner, "GET", f.base + `/analytics/${d.id}`);
  assert.equal(stored.import_spec.file.worksheet, "Campaigns");
  assert.equal(stored.summary.exact.cpc, "1.00125000");
  const raw = await call(f.owner, "GET", f.base + `/analytics/${d.id}/source`);
  assert.deepEqual(raw.raw.rawPayload, bytes);
  assert.match(raw.raw.headers["content-type"]!, /spreadsheetml/);
  assert.equal(raw.raw.headers["x-content-sha256"], hash(bytes));
  const p = campaignWorkbook();
  p["xl/worksheets/sheet1.xml"] = p["xl/worksheets/sheet1.xml"].replace(
    '<c r="F7"><v>100.125</v></c>',
    '<c r="F7"><f>1+1</f><v>2</v></c>',
  );
  const bad = await asset(f, packWorkbook(p), "formula.xlsx"),
    r = await call(
      f.owner,
      "POST",
      "/v1/dataset-imports",
      body(f, bad),
      f.tenant,
    );
  assert.equal(r.status, 400);
  assert.equal(r.data.error.details[0].path, "Campaigns!F7");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM analytics_datasets WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    1,
  );
});
test("corrections retain immutable history and prohibit direct or transitive double counting before task creation", async () => {
  const f = await fixture(),
    a = await asset(f),
    old = await imported(f, a),
    b = await asset(f, csv("200")),
    next = await imported(f, b, { supersedes_id: old.id }),
    c = await asset(f, csv("300")),
    latest = await imported(f, c, { supersedes_id: next.id });
  const frozen = await ok(f.owner, "GET", f.base + `/analytics/${old.id}`);
  assert.equal(frozen.summary.exact.spend, "100.12500000");
  const record = await ok(f.owner, "GET", f.base + `/analytics/${latest.id}`);
  assert.deepEqual(record.correction_ancestors, [old.id, next.id]);
  const fork = await call(
    f.owner,
    "POST",
    "/v1/dataset-imports",
    body(f, c, { supersedes_id: old.id }),
    f.tenant,
  );
  assert.equal(fork.status, 409);
  assert.equal(fork.data.error.code, "IMPORT_CORRECTION_EXISTS");
  const badScope = await call(
    f.owner,
    "POST",
    "/v1/dataset-imports",
    body(f, a, { supersedes_id: latest.id, timezone: "UTC" }),
    f.tenant,
  );
  assert.equal(badScope.status, 409);
  assert.equal(badScope.data.error.code, "IMPORT_CORRECTION_SCOPE");
  await ok(f.owner, "POST", `/v1/tenants/${f.tenant}/demo-credit`, {});
  const agent = await ok(f.owner, "POST", f.base + "/analysis/assistant", {});
  const r = await call(
    f.owner,
    "POST",
    "/v1/reports",
    {
      project_id: f.project,
      agent_id: agent.id,
      analysis: {
        prompt: "Do not combine corrected history",
        snapshot_ids: [old.id, latest.id],
        date_from: "2026-10-01",
        date_to: "2026-10-02",
        timezone: "Asia/Hong_Kong",
        currency_policy: "group_by_currency",
        metrics: ["spend"],
        dimensions: [],
      },
      budget: { currency: "HKD", amount_micros: "1000000" },
    },
    f.tenant,
  );
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error.code, "ANALYSIS_CORRECTION_OVERLAP");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM tasks WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    0,
  );
});
test("source quarantine and deletion revoke dataset, evidence and report access; independent dataset quarantine is preserved", async () => {
  const f = await fixture(),
    a = await asset(f),
    d = await imported(f, a),
    key = randomUUID(),
    request = body(f, a);
  await call(f.owner, "POST", "/v1/dataset-imports", request, f.tenant, key);
  await ok(f.owner, "POST", `/v1/tenants/${f.tenant}/demo-credit`, {});
  const agent = await ok(f.owner, "POST", f.base + "/analysis/assistant", {});
  const r = await call(
    f.owner,
    "POST",
    "/v1/reports",
    {
      project_id: f.project,
      agent_id: agent.id,
      analysis: {
        prompt: "Source lifecycle",
        snapshot_ids: [d.id],
        date_from: "2026-10-01",
        date_to: "2026-10-02",
        timezone: "Asia/Hong_Kong",
        currency_policy: "group_by_currency",
        metrics: ["spend"],
        dimensions: [],
      },
      budget: { currency: "HKD", amount_micros: "1000000" },
    },
    f.tenant,
  );
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const report = r.data,
    task = (
      await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [
        report.task_id,
      ])
    ).rows[0];
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [a.id],
  );
  for (const path of [
    `/v1/snapshots/${d.id}`,
    `/v1/reports/${report.id}`,
    `${f.base}/analytics/${d.id}/source`,
  ])
    assert.equal(
      (await call(f.owner, "GET", path, undefined, f.tenant)).status,
      404,
      path,
    );
  assert.equal(
    (await call(f.owner, "POST", "/v1/dataset-imports", request, f.tenant, key))
      .status,
    404,
  );
  await assert.rejects(
    s.db.tx((tx) => assertReportSources(tx, task), f.tenant, true, f.owner.id),
    /source|authorization/i,
  );
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
    [d.id],
  );
  await s.db.control.query(
    "UPDATE assets SET state='active',moderation_version=moderation_version+1 WHERE id=$1",
    [a.id],
  );
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/analytics/${d.id}`)).status,
    404,
  );
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='active' WHERE id=$1",
    [d.id],
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `/v1/reports/${report.id}`,
        undefined,
        f.tenant,
      )
    ).status,
    200,
  );
  await s.db.control.query(
    "UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=$1",
    [a.id],
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT content_state FROM analytics_datasets WHERE id=$1",
        [d.id],
      )
    ).rows[0].content_state,
    "deleted",
  );
  assert.equal(
    (
      await s.db.control.query("SELECT content_state FROM tasks WHERE id=$1", [
        task.id,
      ])
    ).rows[0].content_state,
    "deleted",
  );
  // The real worker closes the queued task and releases its reservation before
  // physical erasure may finish. The model must never be entered after deletion.
  const runtime = new CodexRuntimeAdapter(s.db.config);
  runtime.start = async () => {
    assert.fail("Deleted source must never enter Codex");
  };
  await s.db.control.query(
    "UPDATE tasks SET next_claim_retry_at=now()+interval '1 hour' WHERE id=$1",
    [task.id],
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1 AND dispatched_at IS NULL",
        [task.id],
      )
    ).rows[0].n,
    1,
  );
  await recoverQueuedClaims(s.db);
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, task.id);
  assert.equal(
    (
      await s.db.control.query("SELECT status FROM tasks WHERE id=$1", [
        task.id,
      ])
    ).rows[0].status,
    "cancelled",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [task.id],
      )
    ).rows[0].status,
    "released",
  );
  for (let n = 0; n < 5; n++) {
    await s.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at=now() WHERE state='queued'",
    );
    await new ErasureService(s.db, s.storage).advance(20);
  }
  const erased = (
    await s.db.control.query("SELECT * FROM analytics_datasets WHERE id=$1", [
      d.id,
    ])
  ).rows[0];
  assert.equal(erased.raw_csv, null);
  assert.equal(erased.source_asset_version_id, null);
  assert.equal(erased.import_spec, null);
  assert.deepEqual(erased.rows, []);
  const jobs = (
    await s.db.control.query(
      "SELECT target_type,state,exceptions,attempts FROM deletion_jobs WHERE target_id=ANY($1::uuid[])",
      [[a.id, d.id, task.id]],
    )
  ).rows;
  assert.equal(jobs.length, 3);
  assert.ok(
    jobs.every((j) => j.state === "completed"),
    JSON.stringify(jobs),
  );
});
test("project and tenant boundaries, private files, viewers and CSRF are checked on imports and replay", async () => {
  const f = await fixture(),
    a = await asset(f),
    other = await fixture(),
    viewer = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')",
    [f.tenant, viewer.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')",
    [f.tenant, f.project, viewer.id],
  );
  assert.equal(
    (await call(viewer, "POST", "/v1/dataset-imports", body(f, a), f.tenant))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        other.owner,
        "POST",
        "/v1/dataset-imports",
        body(other, a),
        other.tenant,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        { ...f.owner, csrf: "invalid" },
        "POST",
        "/v1/dataset-imports",
        body(f, a),
        f.tenant,
      )
    ).status,
    403,
  );
  const key = randomUUID();
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        "/v1/dataset-imports",
        body(f, a),
        f.tenant,
        key,
      )
    ).status,
    202,
  );
  const privateFile = await asset(f, csv("400"));
  await s.db.control.query("UPDATE assets SET private_owner=$1 WHERE id=$2", [
    f.owner.id,
    privateFile.id,
  ]);
  const privateResult = await call(
    f.owner,
    "POST",
    "/v1/dataset-imports",
    body(f, privateFile),
    f.tenant,
  );
  assert.equal(privateResult.status, 403);
  assert.equal(privateResult.data.error.code, "IMPORT_SOURCE_PRIVATE");
  await s.db.control.query(
    "UPDATE memberships SET status='removed' WHERE tenant_id=$1 AND user_id=$2",
    [f.tenant, f.owner.id],
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        "/v1/dataset-imports",
        body(f, a),
        f.tenant,
        key,
      )
    ).status,
    404,
  );
});
