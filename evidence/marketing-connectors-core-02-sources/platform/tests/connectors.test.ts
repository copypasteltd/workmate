import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { advanceConnectors } from "../src/connectors.js";
import {
  connectionDTO,
  connectionListDTO,
  connectorSyncDTO,
  connectorSyncInput,
  type ConnectorProvider,
} from "../src/connector-model.js";
import { connectorJSON, sanitizeConnectorRaw } from "../src/connector-http.js";
import {
  connectorAuthorizationURL,
  exchangeConnectorCode,
} from "../src/connector-provider.js";
import { hash, unseal, seal } from "../src/lib.js";
import { ErasureService } from "../src/erasure.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
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
beforeEach(async () => {
  await s.db.control.query(
    "UPDATE connector_jobs SET state='cancelled',finished_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE state IN('queued','running')",
  );
  for (const p of ["google_ads", "meta_ads", "ga4", "search_console"])
    s.connectorFixture!.setFaults(p, []);
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  k = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      "idempotency-key": k,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  let data: any;
  try {
    data = raw.json();
  } catch {
    data = null;
  }
  return { status: raw.statusCode, data, raw };
}
const ok = (r: Awaited<ReturnType<typeof call>>, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
async function user(): Promise<Client> {
  const challenge = ok(
    await call(undefined, "POST", "/v1/auth/challenge", {
      email: `connector-${randomUUID()}@example.invalid`,
    }),
  );
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  const b = ok(r);
  return {
    id: b.user.id,
    csrf: b.csrf_token,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
  };
}
async function fixture() {
  const owner = await user(),
    w = ok(
      await call(owner, "POST", "/v1/tenants", {
        name: "Connector QA",
        project_name: "Hong Kong campaign",
      }),
    );
  return {
    owner,
    tenant: w.tenant.id as string,
    project: w.project.id as string,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function pending(
  f: Fixture,
  provider: ConnectorProvider,
  k = randomUUID(),
) {
  const c = ok(
    await call(
      f.owner,
      "POST",
      "/v1/connections",
      { project_id: f.project, provider },
      f.tenant,
      k,
    ),
    201,
  );
  connectionDTO.parse(c);
  return c;
}
async function callback(c: any) {
  const u = new URL(c.authorization_url);
  u.pathname = u.pathname.replace("/consent/", "/approve/");
  const consent = await fetch(u, { redirect: "manual" });
  assert.equal(consent.status, 302);
  const location = new URL(consent.headers.get("location")!);
  return location.pathname + location.search;
}
async function drain(f: Fixture, id: string, max = 30) {
  for (let i = 0; i < max; i++) {
    const detail = ok(
      await call(
        f.owner,
        "GET",
        `/v1/connections/${id}/detail`,
        undefined,
        f.tenant,
      ),
    );
    if (!detail.jobs.some((j: any) => ["queued", "running"].includes(j.status)))
      return detail;
    await advanceConnectors(s.db, s.storage);
  }
  throw new Error("Bounded connector queue did not finish");
}
async function connected(f: Fixture, provider: ConnectorProvider) {
  const c = await pending(f, provider),
    url = await callback(c),
    r = ok(await call(undefined, "GET", url));
  connectionDTO.parse(r);
  const detail = await drain(f, c.id);
  assert.equal(detail.catalog_state, "complete", JSON.stringify(detail));
  const ids = detail.accounts
    .filter((a: any) => a.readable && a.kind !== "manager")
    .map((a: any) => a.account_id);
  assert.ok(ids.length > 0);
  const selected = ok(
    await call(
      f.owner,
      "PATCH",
      `/v1/connections/${c.id}`,
      {
        expected_version: detail.connection.version,
        account_ids: ids,
        project_ids: [f.project],
      },
      f.tenant,
    ),
  );
  return { ...selected, ids };
}
const dates = { date_from: "2026-10-01", date_to: "2026-10-07" };
async function sync(f: Fixture, c: any) {
  const job = ok(
    await call(
      f.owner,
      "POST",
      `/v1/connections/${c.id}/syncs`,
      dates,
      f.tenant,
    ),
    202,
  );
  connectorSyncDTO.parse(job);
  return job;
}
for (const provider of [
  "google_ads",
  "meta_ads",
  "ga4",
  "search_console",
] as const)
  test(`${provider}: actual HTTP consent, discovered account scope, all pages, immutable snapshot, strict original DTO and exports`, async () => {
    const f = await fixture(),
      c = await connected(f, provider),
      job = await sync(f, c),
      detail = await drain(f, c.id);
    const finished = ok(
      await call(f.owner, "GET", `/v1/syncs/${job.id}`, undefined, f.tenant),
    );
    connectorSyncDTO.parse(finished);
    assert.equal(finished.state, "complete", JSON.stringify(detail));
    assert.ok(finished.snapshot_id);
    const snapshot = ok(
      await call(
        f.owner,
        "GET",
        `/v1/connector-snapshots/${finished.snapshot_id}?limit=100`,
        undefined,
        f.tenant,
      ),
    );
    assert.equal(snapshot.source_mode, "simulated");
    assert.equal(snapshot.data_as_of, null);
    assert.equal(snapshot.row_count, provider === "ga4" ? 6 : 3 * c.ids.length);
    assert.equal(
      new Set(snapshot.facts.map((v: any) => v.key)).size,
      snapshot.row_count,
    );
    const normative = ok(
      await call(
        f.owner,
        "GET",
        `/v1/snapshots/${finished.snapshot_id}`,
        undefined,
        f.tenant,
      ),
    );
    assert.equal(normative.id, finished.snapshot_id);
    assert.equal(normative.data_as_of, null);
    const raw = await call(
      f.owner,
      "GET",
      `/v1/connector-snapshots/${finished.snapshot_id}?format=json`,
      undefined,
      f.tenant,
    );
    assert.equal(raw.status, 200);
    assert.ok(!/access_token|refresh_token|client_secret/.test(raw.raw.body));
    const csv = await call(
      f.owner,
      "GET",
      `/v1/connector-snapshots/${finished.snapshot_id}?format=csv`,
      undefined,
      f.tenant,
    );
    assert.equal(csv.status, 200);
    assert.match(csv.raw.body, /dimensions_json,metrics_json/);
    if (provider === "meta_ads") {
      assert.equal(snapshot.facts[0].metrics.conversions, "2");
      assert.equal(snapshot.facts[2].metrics.conversions, null);
      assert.ok(
        snapshot.limitations.includes(
          "META_ACTION_TYPE_EXACT_MATCH_MISSING_IS_UNKNOWN",
        ),
      );
    }
    if (provider === "ga4") {
      assert.equal(
        snapshot.facts.filter((v: any) => v.profile === "ga4_events").length,
        3,
      );
      assert.ok(snapshot.limitations.includes("GA4_THRESHOLDING"));
      assert.ok(
        snapshot.limitations.includes(
          "GA4_USERS_NOT_ADDITIVE_ACROSS_ROWS_OR_REPORTS",
        ),
      );
      assert.equal(
        snapshot.specification.queries[0].account.reporting_identity,
        "BLENDED",
      );
    }
    if (provider === "search_console")
      assert.ok(
        snapshot.limitations.includes("GSC_TOP_ROWS_ONLY_NOT_FULL_COVERAGE"),
      );
    if (provider === "google_ads" || provider === "meta_ads") {
      assert.equal(snapshot.dataset_ids.length, c.ids.length);
      const datasets = (
        await s.db.control.query(
          "SELECT rows,source_asset_version_id FROM analytics_datasets WHERE id=ANY($1)",
          [snapshot.dataset_ids],
        )
      ).rows;
      assert.ok(datasets.every((d: any) => d.source_asset_version_id));
      assert.equal(datasets[0].rows[2].conversions, null);
    }
    await assert.rejects(
      s.db.control.query(
        "UPDATE connector_jobs SET spec_hash=$2,revision=revision+1 WHERE id=$1",
        [job.id, hash("different")],
      ),
    );
    await assert.rejects(
      s.db.control.query("DELETE FROM connector_pages WHERE job_id=$1", [
        job.id,
      ]),
    );
  });
test("authorization creation is idempotent and scoped list uses the exact canonical response", async () => {
  const f = await fixture(),
    k = randomUUID(),
    a = await pending(f, "ga4", k),
    b = await pending(f, "ga4", k);
  assert.deepEqual(a, b);
  const conflict = await call(
    f.owner,
    "POST",
    "/v1/connections",
    { project_id: f.project, provider: "google_ads" },
    f.tenant,
    k,
  );
  assert.equal(conflict.status, 409);
  const list = ok(
    await call(
      f.owner,
      "GET",
      `/v1/connections?project_id=${f.project}&limit=1`,
      undefined,
      f.tenant,
    ),
  );
  connectionListDTO.parse(list);
  assert.equal(list.items[0].id, a.id);
});
test("OAuth state cannot be replayed, changed or completed after the initiating session is revoked", async () => {
  const f = await fixture(),
    c = await pending(f, "ga4"),
    url = await callback(c);
  ok(await call(undefined, "GET", url));
  assert.equal((await call(undefined, "GET", url)).status, 401);
  const other = await pending(f, "ga4"),
    stale = await callback(other);
  await s.db.control.query(
    "UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1",
    [hash(f.owner.cookie.split("=")[1])],
  );
  const start = s.connectorFixture!.calls.length;
  assert.equal((await call(undefined, "GET", stale)).status, 401);
  assert.equal(s.connectorFixture!.calls.length, start);
});
test("OAuth validates actual scopes and never persists a credential after scope denial", async () => {
  const f = await fixture(),
    c = await pending(f, "ga4"),
    url = await callback(c);
  s.connectorFixture!.setFaults("ga4", ["missing_scope"]);
  const r = await call(undefined, "GET", url);
  assert.equal(r.status, 401);
  assert.equal(r.data.error.code, "CONNECTOR_SCOPE_MISSING");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT encrypted_secret FROM connections WHERE id=$1",
        [c.id],
      )
    ).rows[0].encrypted_secret,
    null,
  );
});
test("foreign tenant/project and arbitrary undiscovered account selection cause no supplier request", async () => {
  const f = await fixture(),
    foreign = await fixture(),
    c = await connected(f, "google_ads"),
    start = s.connectorFixture!.calls.length;
  assert.equal(
    (
      await call(
        foreign.owner,
        "GET",
        `/v1/connections/${c.id}/detail`,
        undefined,
        foreign.tenant,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "PATCH",
        `/v1/connections/${c.id}`,
        {
          expected_version: c.version,
          account_ids: ["999"],
          project_ids: [f.project],
        },
        f.tenant,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "PATCH",
        `/v1/connections/${c.id}`,
        {
          expected_version: c.version,
          account_ids: c.ids,
          project_ids: [f.project, foreign.project],
        },
        f.tenant,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        `/v1/tenants/${f.tenant}/projects/${f.project}/connections/${c.id}/report`,
        {
          account_id: "999",
          start_date: dates.date_from,
          end_date: dates.date_to,
        },
        f.tenant,
      )
    ).status,
    410,
  );
  assert.equal(s.connectorFixture!.calls.length, start);
});
test("manager/denied site accounts cannot be bound and optimistic versions prevent stale edits", async () => {
  const f = await fixture(),
    c = await connected(f, "google_ads");
  const bad = await call(
    f.owner,
    "PATCH",
    `/v1/connections/${c.id}`,
    {
      expected_version: c.version,
      account_ids: ["100"],
      project_ids: [f.project],
    },
    f.tenant,
  );
  assert.equal(bad.status, 403);
  const stale = await call(
    f.owner,
    "PATCH",
    `/v1/connections/${c.id}`,
    {
      expected_version: c.version - 1,
      account_ids: c.ids,
      project_ids: [f.project],
    },
    f.tenant,
  );
  assert.equal(stale.status, 409);
});
test("invalid calendar dates, reversed/oversized ranges and injected query fields are rejected before enqueue", async () => {
  for (const value of [
    { date_from: "2026-02-30", date_to: "2026-03-01" },
    { date_from: "2026-10-07", date_to: "2026-10-01" },
    { date_from: "2025-01-01", date_to: "2026-10-01" },
  ])
    assert.equal(connectorSyncInput.safeParse(value).success, false);
  const f = await fixture(),
    c = await connected(f, "ga4"),
    r = await call(
      f.owner,
      "POST",
      `/v1/connections/${c.id}/syncs`,
      { ...dates, url: "https://evil.invalid", account_id: "999" },
      f.tenant,
    );
  assert.equal(r.status, 400);
});
test("429 persists Retry-After and continues the frozen page without duplicate facts", async () => {
  const f = await fixture(),
    c = await connected(f, "meta_ads"),
    job = await sync(f, c);
  s.connectorFixture!.setFaults("meta_ads", ["rate_limit"]);
  await advanceConnectors(s.db, s.storage);
  let row = (
    await s.db.control.query("SELECT * FROM connector_jobs WHERE id=$1", [
      job.id,
    ])
  ).rows[0];
  assert.equal(row.state, "queued");
  assert.equal(row.attempts, 1);
  assert.ok(row.next_attempt_at.valueOf() > Date.now());
  assert.equal(row.page_count, 0);
  await s.db.control.query(
    "UPDATE connector_jobs SET next_attempt_at=clock_timestamp(),revision=revision+1 WHERE id=$1",
    [job.id],
  );
  const end = await drain(f, c.id);
  assert.equal(end.jobs[0].status, "complete");
  assert.equal(end.jobs[0].row_count, 3);
});
test("partial pages survive a permanent later-page failure and retry creates a new immutable snapshot", async () => {
  const f = await fixture(),
    c = await connected(f, "ga4"),
    job = await sync(f, c);
  await advanceConnectors(s.db, s.storage);
  s.connectorFixture!.setFaults("ga4", ["forbidden"]);
  const partial = await drain(f, c.id);
  assert.equal(partial.jobs[0].status, "partial");
  const before = ok(
    await call(f.owner, "GET", `/v1/syncs/${job.id}`, undefined, f.tenant),
  );
  assert.ok(before.snapshot_id);
  const retry = ok(
    await call(f.owner, "POST", `/v1/syncs/${job.id}/retry`, {}, f.tenant),
    202,
  );
  assert.notEqual(retry.id, job.id);
  const end = await drain(f, c.id);
  assert.equal(end.jobs[0].status, "complete");
  assert.equal(
    ok(await call(f.owner, "GET", `/v1/syncs/${job.id}`, undefined, f.tenant))
      .snapshot_id,
    before.snapshot_id,
  );
});
test("expired credentials require reauthorization and no later page is requested", async () => {
  const f = await fixture(),
    c = await connected(f, "google_ads");
  await sync(f, c);
  s.connectorFixture!.setFaults("google_ads", ["expired"]);
  const start = s.connectorFixture!.calls.length;
  const end = await drain(f, c.id);
  assert.equal(end.connection.state, "reauth_required");
  assert.equal(end.jobs[0].status, "failed");
  assert.equal(s.connectorFixture!.calls.length - start, 1);
});
test("revocation while a page is in flight discards its bytes, clears credentials and cancels future reads", async () => {
  const f = await fixture(),
    c = await connected(f, "ga4"),
    job = await sync(f, c);
  s.connectorFixture!.setFaults("ga4", ["slow"]);
  const start = s.connectorFixture!.calls.length;
  const running = advanceConnectors(s.db, s.storage);
  const deadline = Date.now() + 3000;
  while (s.connectorFixture!.calls.length === start) {
    assert.ok(Date.now() < deadline);
    await new Promise(setImmediate);
  }
  ok(
    await call(
      f.owner,
      "DELETE",
      `/v1/connections/${c.id}`,
      undefined,
      f.tenant,
    ),
  );
  await running;
  await advanceConnectors(s.db, s.storage);
  const row = (
    await s.db.control.query("SELECT * FROM connector_jobs WHERE id=$1", [
      job.id,
    ])
  ).rows[0];
  assert.equal(row.state, "cancelled");
  assert.equal(row.page_count, 0);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT encrypted_secret FROM connections WHERE id=$1",
        [c.id],
      )
    ).rows[0].encrypted_secret,
    null,
  );
  assert.equal(s.connectorFixture!.calls.length - start, 1);
});
test("cancel is durable; a changed scope fences old queued queries and explicit retry uses the newly confirmed scope", async () => {
  const f = await fixture(),
    c = await connected(f, "google_ads"),
    job = await sync(f, c);
  const changed = ok(
    await call(
      f.owner,
      "PATCH",
      `/v1/connections/${c.id}`,
      {
        expected_version: c.version,
        account_ids: [c.ids[0]],
        project_ids: [f.project],
      },
      f.tenant,
    ),
  );
  assert.equal(
    (
      await s.db.control.query("SELECT state FROM connector_jobs WHERE id=$1", [
        job.id,
      ])
    ).rows[0].state,
    "cancelled",
  );
  const retry = ok(
    await call(f.owner, "POST", `/v1/syncs/${job.id}/retry`, {}, f.tenant),
    202,
  );
  assert.notEqual(retry.id, job.id);
  const detail = ok(
    await call(
      f.owner,
      "GET",
      `/v1/syncs/${retry.id}/detail`,
      undefined,
      f.tenant,
    ),
  );
  assert.deepEqual(detail.specification.accounts, [c.ids[0]]);
  ok(await call(f.owner, "POST", `/v1/syncs/${retry.id}/cancel`, {}, f.tenant));
  assert.equal(
    (
      await s.db.control.query("SELECT state FROM connector_jobs WHERE id=$1", [
        retry.id,
      ])
    ).rows[0].state,
    "cancelled",
  );
  assert.equal(changed.account_ids.length, 1);
});
test("a worker crash lease resumes the same safe read without duplicating a stored page", async () => {
  const f = await fixture(),
    c = await connected(f, "meta_ads"),
    job = await sync(f, c);
  await advanceConnectors(s.db, s.storage);
  await s.db.control.query(
    "UPDATE connector_jobs SET state='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1",
    [job.id],
  );
  const end = await drain(f, c.id);
  assert.equal(end.jobs[0].status, "complete");
  assert.equal(end.jobs[0].page_count, 2);
  assert.equal(end.jobs[0].row_count, 3);
});
test("cursor loops and changing GA4 row counts produce partial snapshots, never complete", async () => {
  const f = await fixture(),
    c = await connected(f, "meta_ads");
  await sync(f, c);
  await advanceConnectors(s.db, s.storage);
  s.connectorFixture!.setFaults("meta_ads", ["cursor_loop"]);
  const end = await drain(f, c.id);
  assert.equal(end.jobs[0].status, "partial");
  assert.ok(end.jobs[0].limitations.includes("CONNECTOR_CURSOR_LOOP"));
  const other = await connected(f, "ga4");
  await sync(f, other);
  await advanceConnectors(s.db, s.storage);
  s.connectorFixture!.setFaults("ga4", ["row_count_changed"]);
  const g = await drain(f, other.id);
  assert.equal(g.jobs[0].status, "partial");
  assert.equal(g.jobs[0].error_code, "CONNECTOR_ROW_COUNT_CHANGED");
});
test("out-of-scope returned account data is rejected and not published", async () => {
  const f = await fixture(),
    c = await connected(f, "meta_ads");
  await sync(f, c);
  s.connectorFixture!.setFaults("meta_ads", ["cross_account"]);
  const end = await drain(f, c.id);
  assert.equal(end.jobs[0].status, "failed");
  assert.equal(end.snapshots.length, 0);
});
test("current user authority is rechecked before the first supplier read", async () => {
  const f = await fixture(),
    c = await connected(f, "ga4"),
    job = await sync(f, c),
    start = s.connectorFixture!.calls.length;
  await s.db.control.query(
    "UPDATE users SET status='suspended',auth_version=auth_version+1 WHERE id=$1",
    [f.owner.id],
  );
  await advanceConnectors(s.db, s.storage);
  assert.equal(s.connectorFixture!.calls.length, start);
  assert.equal(
    (
      await s.db.control.query("SELECT state FROM connector_jobs WHERE id=$1", [
        job.id,
      ])
    ).rows[0].state,
    "failed",
  );
});
test("source quarantine, expiry and physical deletion deny every derived snapshot and analysis", async () => {
  const f = await fixture(),
    c = await connected(f, "google_ads"),
    job = await sync(f, c);
  await drain(f, c.id);
  const snapshot = ok(
      await call(f.owner, "GET", `/v1/syncs/${job.id}`, undefined, f.tenant),
    ),
    page = (
      await s.db.control.query(
        "SELECT asset_id FROM connector_pages WHERE job_id=$1 ORDER BY ordinal LIMIT 1",
        [job.id],
      )
    ).rows[0];
  const source = (
    await s.db.control.query(
      "SELECT v.storage_key FROM asset_versions v WHERE v.asset_id=$1",
      [page.asset_id],
    )
  ).rows[0];
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [page.asset_id],
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `/v1/connector-snapshots/${snapshot.snapshot_id}`,
        undefined,
        f.tenant,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `/v1/snapshots/${snapshot.snapshot_id}`,
        undefined,
        f.tenant,
      )
    ).status,
    404,
  );
  await s.db.control.query(
    "UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=$1",
    [page.asset_id],
  );
  const eraser = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) {
    await s.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at=clock_timestamp() WHERE state IN('queued','cleaning')",
    );
    await eraser.advance(10);
  }
  await assert.rejects(s.storage.get(source.storage_key));
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM connector_snapshots s JOIN assets a ON a.id=s.asset_id WHERE s.job_id=$1 AND a.state<>'deleted'",
        [job.id],
      )
    ).rows[0].count,
    "0",
  );
});
test("RLS and least-privilege identities isolate all six new tables from cross-tenant and queue access", async () => {
  const f = await fixture();
  await connected(f, "ga4");
  const tables = [
    "connector_profiles",
    "connector_oauth_states",
    "connector_accounts",
    "connector_jobs",
    "connector_pages",
    "connector_snapshots",
  ];
  for (const table of tables) {
    const result = await s.db
      .tx((tx) => tx.query(`SELECT count(*) FROM ${table}`), randomUUID())
      .catch((e) => e);
    if (table === "connector_oauth_states") assert.equal(result.code, "42501");
    else assert.equal(result.rows[0].count, "0");
    await assert.rejects(s.db.queue.query(`SELECT * FROM ${table}`));
  }
});
test("transport rejects custom hosts/credentials and fixtures are forbidden outside local demo", async () => {
  await assert.rejects(
    connectorJSON(s.db.config, "https://attacker.invalid/report"),
    (e) => (e as any).code === "CONNECTOR_ENDPOINT_DENIED",
  );
  await assert.rejects(
    connectorJSON(
      s.db.config,
      "https://secret@www.googleapis.com/webmasters/v3/sites",
    ),
  );
  assert.throws(() =>
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "false",
      CONNECTOR_FIXTURE_ORIGIN: "http://127.0.0.1:4444",
      CONNECTOR_FIXTURE_KEY: "a".repeat(43),
    }),
  );
  assert.deepEqual(
    sanitizeConnectorRaw({
      data: [{ spend: "1.1" }],
      paging: {
        next: "https://graph.facebook.com?access_token=private",
        cursors: { after: "private" },
      },
      nextPageToken: "private",
    }),
    { data: [{ spend: "1.1" }], paging: {} },
  );
});
test("provider PKCE refuses a code exchanged with a different verifier", async () => {
  const verifier = "correct-verifier",
    url = connectorAuthorizationURL(
      s.db.config,
      "ga4",
      "a".repeat(43),
      verifier,
    ),
    u = new URL(url);
  u.pathname = u.pathname.replace("/consent/", "/approve/");
  const response = await fetch(u, { redirect: "manual" }),
    code = new URL(response.headers.get("location")!).searchParams.get("code")!;
  await assert.rejects(
    exchangeConnectorCode(s.db.config, "ga4", code, "wrong-verifier"),
  );
});
test("stored token expiry refreshes via the supplier before read and retains ciphertext-only storage", async () => {
  const f = await fixture(),
    c = await connected(f, "ga4"),
    raw = (
      await s.db.control.query(
        "SELECT encrypted_secret FROM connections WHERE id=$1",
        [c.id],
      )
    ).rows[0];
  const credential = JSON.parse(
    unseal(s.db.config.MASTER_KEY!, raw.encrypted_secret),
  );
  credential.expires_at = Date.now() - 1;
  await s.db.control.query(
    "UPDATE connections SET encrypted_secret=$2 WHERE id=$1",
    [c.id, seal(s.db.config.MASTER_KEY!, JSON.stringify(credential))],
  );
  const start = s.connectorFixture!.calls.length;
  await sync(f, c);
  const end = await drain(f, c.id);
  assert.equal(end.jobs[0].status, "complete");
  assert.equal(
    s.connectorFixture!.calls.slice(start).filter((v) => v.path === "/token")
      .length,
    1,
  );
  const detail = ok(
    await call(
      f.owner,
      "GET",
      `/v1/connections/${c.id}/detail`,
      undefined,
      f.tenant,
    ),
  );
  assert.ok(!JSON.stringify(detail).includes(credential.access_token));
});
