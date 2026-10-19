import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { hash } from "../src/lib.js";
import { parseMetricsCSV, analyticsEvidence } from "../src/analytics.js";
import { ErasureService } from "../src/erasure.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: "http://localhost:4317",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "idempotency-key": randomUUID(),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  const data = raw.headers["content-type"]?.includes("application/json")
    ? raw.json()
    : raw.body;
  return { status: raw.statusCode, data, raw };
}
async function user(): Promise<Client> {
  const email = `analytics-${randomUUID()}@example.invalid`,
    c = await call(undefined, "POST", "/v1/auth/challenge", { email });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${c.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const v = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: c.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  return {
    id: v.data.user.id,
    cookie: v.raw.cookies[0].name + "=" + v.raw.cookies[0].value,
    csrf: v.data.csrf_token,
  };
}
async function fixture() {
  const owner = await user(),
    w = await call(owner, "POST", "/v1/tenants", {
      name: "Marketing studio",
      project_name: "Campaign evidence",
    });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  return {
    owner,
    tenant: w.data.tenant.id,
    project: w.data.project.id,
    base: `/v1/tenants/${w.data.tenant.id}/projects/${w.data.project.id}/analytics`,
  };
}
const input = {
  name: "Daily launch",
  csv: "\ufeffdate,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\r\n2026-10-01,Google,Launch,1000,100,100,4,400,HKD\r\n2026-10-02,Google,Launch,9000,90,180,6,300,HKD",
  timezone: "Asia/Hong_Kong",
  currency: "HKD",
  attribution_definition: "7d click",
  conversion_definition: "Purchase",
  source_filename: "launch.csv",
};
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
test("preview does not write; concurrent identical imports return one immutable project snapshot", async () => {
  const f = await fixture(),
    preview = await call(f.owner, "POST", f.base + "/preview", input);
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.summary.exact.ctr, "0.01900000");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT id FROM analytics_datasets WHERE project_id=$1",
        [f.project],
      )
    ).rowCount,
    0,
  );
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      call(f.owner, "POST", f.base + "/import", input),
    ),
  );
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(new Set(results.map((r) => r.data.id)).size, 1);
  assert.equal(results.filter((r) => !r.data.duplicate).length, 1);
  const d = results[0].data;
  assert.equal(d.summary.exact.cpc, "1.47368421");
  assert.equal(d.summary.exact.cpm, "28.00000000");
  assert.equal(d.source_sha256, hash(Buffer.from(input.csv, "utf8")));
  const stored = (
    await s.db.control.query("SELECT * FROM analytics_datasets WHERE id=$1", [
      d.id,
    ])
  ).rows[0];
  assert.equal(stored.metric_snapshot.summary.exact.roas, "2.50000000");
  assert.equal(
    analyticsEvidence({ ...stored, rows: [] }).exact.roas,
    "2.50000000",
    "historical metrics use the frozen result rather than a later calculator",
  );
  assert.ok(!Object.hasOwn(d, "raw_csv"));
  assert.equal(
    (await call(f.owner, "POST", f.base + "/preview", input)).data
      .existing_dataset_id,
    d.id,
  );
  const same = await call(f.owner, "POST", f.base + "/import", {
    ...input,
    name: "Retry with another label",
    source_filename: "renamed.csv",
  });
  assert.equal(same.data.id, d.id);
  assert.equal(same.data.name, input.name);
  const different = await call(f.owner, "POST", f.base + "/import", {
    ...input,
    attribution_definition: "1d click",
  });
  assert.notEqual(different.data.id, d.id);
  assert.notEqual(different.data.spec_hash, d.spec_hash);
  const otherProject = (
    await call(f.owner, "POST", `/v1/tenants/${f.tenant}/projects`, {
      name: "Another campaign",
    })
  ).data;
  const separate = await call(
    f.owner,
    "POST",
    `/v1/tenants/${f.tenant}/projects/${otherProject.id}/analytics/import`,
    input,
  );
  assert.equal(separate.status, 200, JSON.stringify(separate.data));
  assert.notEqual(separate.data.id, d.id);
  await assert.rejects(
    s.db.tx(
      (tx) =>
        tx.query("UPDATE analytics_datasets SET rows='[]' WHERE id=$1", [d.id]),
      f.tenant,
    ),
    { code: "23514" },
  );
  await assert.rejects(
    s.db.tx(
      (tx) =>
        tx.query(
          "UPDATE analytics_datasets SET metric_snapshot='{}' WHERE id=$1",
          [d.id],
        ),
      f.tenant,
    ),
    { code: "23514" },
  );
  await assert.rejects(
    s.db.tx(
      (tx) => tx.query("DELETE FROM analytics_datasets WHERE id=$1", [d.id]),
      f.tenant,
    ),
    { code: "23514" },
  );
});
test("source downloads are byte-exact; reports and charts retain stable evidence and scope", async () => {
  const f = await fixture(),
    d = (await call(f.owner, "POST", f.base + "/import", input)).data;
  const source = await call(f.owner, "GET", `${f.base}/${d.id}/source`);
  assert.equal(source.status, 200);
  assert.deepEqual(source.raw.rawPayload, Buffer.from(input.csv, "utf8"));
  assert.equal(source.raw.headers["x-content-sha256"], d.source_sha256);
  const a = await call(f.owner, "GET", `${f.base}/${d.id}`),
    b = await call(f.owner, "GET", `${f.base}/${d.id}/report`);
  assert.equal(b.status, 200);
  assert.equal(b.data.snapshot_id, d.id);
  assert.equal(
    b.data.data_as_of,
    null,
    "upload time is not the platform extraction cutoff",
  );
  assert.equal(b.data.captured_at, a.data.created_at);
  assert.deepEqual(b.data.date_range, { from: "2026-10-01", to: "2026-10-02" });
  assert.deepEqual(a.data.summary.evidence, b.data.summary.evidence);
  assert.equal(b.data.definition.attribution_definition, "7d click");
  assert.equal(
    b.data.summary.evidence.find((v: any) => v.metric_id === "cpc").value,
    "1.47368421",
  );
  assert.equal(b.data.daily.length, 2);
  assert.equal(b.data.channels[0].spend_micros, 280000000);
  const normalized = await call(f.owner, "GET", `${f.base}/${d.id}/export`);
  assert.equal(
    parseMetricsCSV(normalized.data).summary.exact.spend,
    "280.00000000",
  );
  const chart = await call(f.owner, "GET", `${f.base}/${d.id}/chart`);
  assert.equal(chart.status, 200);
  assert.match(chart.data, /<svg /);
  assert.ok(chart.data.includes(d.source_sha256));
  const outsider = await user();
  for (const suffix of ["", "/report", "/source", "/chart", "/export"])
    assert.equal(
      (await call(outsider, "GET", `${f.base}/${d.id}${suffix}`)).status,
      404,
    );
  assert.equal(
    (await call(outsider, "POST", f.base + "/preview", input)).status,
    404,
  );
  const bad = await call(f.owner, "POST", f.base + "/import", {
    ...input,
    csv: input.csv.replace(",100,100,4,", ",nonsense,100,4,"),
  });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error.details[0].path, /row 2.clicks/);
  const malformed = await call(f.owner, "POST", f.base + "/import", {
    ...input,
    csv: input.csv + "\u0000",
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.data.error.code, "CSV_INVALID");
  assert.equal(
    (
      await call(
        { ...f.owner, csrf: "wrong" },
        "POST",
        f.base + "/import",
        input,
      )
    ).status,
    403,
  );
});
test("quarantined source cannot be reimported; deletion clears retained CSV and mappings before a new snapshot", async () => {
  const f = await fixture(),
    d = (await call(f.owner, "POST", f.base + "/import", input)).data;
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [d.id],
  );
  const retry = await call(f.owner, "POST", f.base + "/import", input);
  assert.equal(retry.status, 409, JSON.stringify(retry.data));
  assert.equal(retry.data.error.code, "IMPORT_UNAVAILABLE");
  for (const suffix of ["", "/source", "/report", "/chart"])
    assert.equal(
      (await call(f.owner, "GET", `${f.base}/${d.id}${suffix}`)).status,
      404,
    );
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='active',moderation_version=moderation_version+1 WHERE id=$1",
    [d.id],
  );
  assert.equal(
    (await call(f.owner, "POST", f.base + "/import", input)).data.id,
    d.id,
  );
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1",
    [d.id],
  );
  await new ErasureService(s.db, s.storage).advance(10);
  const row = (
    await s.db.control.query("SELECT * FROM analytics_datasets WHERE id=$1", [
      d.id,
    ])
  ).rows[0];
  assert.equal(row.raw_csv, null);
  assert.equal(row.import_spec, null);
  assert.equal(row.import_metadata, null);
  assert.equal(row.metric_snapshot, null);
  assert.deepEqual(row.rows, []);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT state FROM deletion_jobs WHERE target_id=$1",
        [d.id],
      )
    ).rows[0].state,
    "completed",
  );
  const next = await call(f.owner, "POST", f.base + "/import", input);
  assert.equal(next.status, 200, JSON.stringify(next.data));
  assert.notEqual(next.data.id, d.id);
});
test("membership and project revocation apply to every derivative; unknown values survive source/export", async () => {
  const f = await fixture(),
    reader = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')",
    [f.tenant, reader.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')",
    [f.tenant, f.project, reader.id],
  );
  const missing = {
    ...input,
    csv: "date,channel,impressions,clicks,spend\n2026-10-01,Google,100,10,20",
  };
  const d = (await call(f.owner, "POST", f.base + "/import", missing)).data;
  assert.equal(d.summary.exact.cpa, null);
  assert.equal(d.summary.null_reasons.cpa, "missing_conversions");
  assert.equal(
    (await call(reader, "GET", `${f.base}/${d.id}/report`)).status,
    200,
  );
  assert.equal(
    (await call(reader, "POST", f.base + "/import", missing)).status,
    403,
  );
  assert.equal(
    (await call(reader, "POST", f.base + "/inspect", { csv: missing.csv }))
      .status,
    403,
  );
  const normalized = await call(f.owner, "GET", `${f.base}/${d.id}/export`);
  assert.equal(
    parseMetricsCSV(normalized.data).summary.exact.conversions,
    null,
  );
  await s.db.control.query(
    "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
    [f.project, reader.id],
  );
  for (const suffix of ["", "/source", "/report", "/chart", "/export"])
    assert.equal(
      (await call(reader, "GET", `${f.base}/${d.id}${suffix}`)).status,
      404,
    );
});
