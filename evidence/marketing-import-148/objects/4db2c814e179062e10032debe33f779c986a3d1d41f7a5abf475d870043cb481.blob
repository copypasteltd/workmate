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

test("original localized Google export flows through inspect, preview, canonical snapshot, report and exact download", async () => {
  const f = await fixture();
  const text =
    "Synthetic daily export\r\nCampaign report\r\nDay;Campaign;Campaign ID;Impressions;Clicks;Cost;Conversions;Conv. value\r\n01/10/2026;Launch;00456;1.000;10;1.234,56;4,5;4.500,25";
  const bytes = Buffer.concat([
    Buffer.from([255, 254]),
    Buffer.from(text, "utf16le"),
  ]);
  const a = await asset(f, bytes, "google-localized.csv");
  const request = body(f, a, {
    header_row: 3,
    csv_delimiter: "semicolon",
    date_format: "day_first",
    number_format: "comma_decimal",
  });
  const info = await ok(f.owner, "POST", f.base + "/analytics/file-inspect", {
    asset_version_id: a.version.id,
    header_row: 3,
    csv_delimiter: "semicolon",
  });
  assert.equal(info.source_sha256, hash(bytes));
  assert.equal(info.csv_encoding, "utf16le");
  assert.equal(info.headers[0], "Day");
  const { project_id: _p, ...previewBody } = request;
  const p = await ok(f.owner, "POST", f.base + "/analytics/file-preview", {
    ...previewBody,
    name: "Confirmed parsed facts",
  });
  assert.equal(p.sample[0].date, "2026-10-01");
  assert.equal(p.sample[0].entity_id, "00456");
  assert.equal(p.sample[0].spend_micros, 1234560000);
  assert.equal(p.summary.exact.conversion_value, "4500.25000000");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM analytics_datasets WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    0,
  );
  const key = randomUUID(),
    batch = await Promise.all(
      Array.from({ length: 3 }, () =>
        call(f.owner, "POST", "/v1/dataset-imports", request, f.tenant, key),
      ),
    );
  batch.forEach((r) => assert.equal(r.status, 202, JSON.stringify(r.data)));
  assert.equal(new Set(batch.map((r) => r.data.id)).size, 1);
  const id = batch[0].data.id;
  assert.equal(batch[0].data.spec_hash, p.spec_hash);
  const d = await ok(f.owner, "GET", f.base + `/analytics/${id}`);
  assert.equal(d.summary.exact.spend, "1234.56000000");
  assert.equal(d.import_spec.number_format, "comma_decimal");
  assert.equal(d.source_sha256, hash(bytes));
  const report = await ok(f.owner, "GET", f.base + `/analytics/${id}/report`);
  assert.equal(report.definition.file.header_row, 3);
  assert.equal(report.summary.exact.conversions, "4.50000000");
  const source = await call(f.owner, "GET", f.base + `/analytics/${id}/source`);
  assert.equal(source.status, 200);
  assert.match(String(source.raw.headers["content-type"]), /utf-16le/);
  assert.deepEqual(source.raw.rawPayload, bytes);
});

test("different explicitly confirmed interpretations never reuse an old snapshot or replay key", async () => {
  const f = await fixture();
  const a = await asset(
    f,
    Buffer.from(
      "date,channel,entity_id,impressions,clicks,spend\n01/10/2026,Google,456,1000,10,100",
    ),
  );
  const input = body(f, a, { date_format: "day_first" }),
    key = randomUUID();
  const d = await call(
    f.owner,
    "POST",
    "/v1/dataset-imports",
    input,
    f.tenant,
    key,
  );
  assert.equal(d.status, 202);
  const stale = await call(
    f.owner,
    "POST",
    "/v1/dataset-imports",
    { ...input, date_format: "month_first" },
    f.tenant,
    key,
  );
  assert.equal(stale.status, 409);
  const changed = await imported(f, a, { date_format: "month_first" });
  assert.notEqual(changed.id, d.data.id);
  const aData = await ok(f.owner, "GET", f.base + `/analytics/${d.data.id}`),
    bData = await ok(f.owner, "GET", f.base + `/analytics/${changed.id}`);
  assert.equal(aData.import_spec.date_range.from, "2026-10-01");
  assert.equal(bData.import_spec.date_range.from, "2026-01-10");
});

test("source quarantine blocks localized preview, original-byte download and successful replay", async () => {
  const f = await fixture(),
    a = await asset(f);
  const input = body(f, a, {
      date_format: "iso",
      number_format: "dot_decimal",
    }),
    key = randomUUID();
  const d = await call(
    f.owner,
    "POST",
    "/v1/dataset-imports",
    input,
    f.tenant,
    key,
  );
  assert.equal(d.status, 202);
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [a.id],
  );
  const { project_id: _p, ...previewBody } = input;
  for (const r of [
    await call(f.owner, "POST", f.base + "/analytics/file-preview", {
      ...previewBody,
      name: "Blocked",
    }),
    await call(f.owner, "POST", "/v1/dataset-imports", input, f.tenant, key),
    await call(f.owner, "GET", f.base + `/analytics/${d.data.id}/source`),
  ])
    assert.ok(r.status >= 400, JSON.stringify(r.data));
});

test("malformed convention or cross-enterprise source cannot create any analytics snapshot", async () => {
  const f = await fixture(),
    other = await fixture(),
    a = await asset(f);
  const wrong = await call(
    other.owner,
    "POST",
    "/v1/dataset-imports",
    body(other, a, { number_format: "comma_decimal" }),
    other.tenant,
  );
  assert.ok(wrong.status >= 400);
  for (const extra of [
    { number_format: "guess" },
    { date_format: "auto" },
    { csv_delimiter: "|" },
    { header_row: 0 },
    { csv_encoding: "latin1" },
  ]) {
    const r = await call(
      f.owner,
      "POST",
      "/v1/dataset-imports",
      body(f, a, extra),
      f.tenant,
    );
    assert.equal(r.status, 400, JSON.stringify(r.data));
  }
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM analytics_datasets WHERE project_id=ANY($1::uuid[])",
        [[f.project, other.project]],
      )
    ).rows[0].n,
    0,
  );
});
