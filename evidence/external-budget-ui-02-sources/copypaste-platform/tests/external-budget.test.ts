import { advanceExternalBudgets } from "../src/external-budget.js";
import { Worker } from "../src/worker.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { desktopCompanyToolSchema } from "../src/desktop-tool-policy.js";
import { recoverBudgetReceipts } from "../src/external-budget-receipts.js";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
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
import * as OTPAuth from "otpauth";

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
  s.connectorFixture!.resetBudgets();
  await s.db.control.query(
    "UPDATE external_budget_operations SET state=CASE WHEN state='dispatched' THEN 'unknown' ELSE 'cancelled' END,version=version+1,finished_at=clock_timestamp() WHERE state IN('awaiting_confirmation','queued','checking','dispatched')",
  );
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
      origin: url.startsWith("/v1/admin/")
        ? s.db.config.ADMIN_ORIGIN
        : s.db.config.WEB_ORIGIN,
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
const base = (f: Fixture) =>
  `/v1/tenants/${f.tenant}/projects/${f.project}/external-budget`;
const body = (confirmation = "each_operation") => ({
  enabled: true,
  currency: "HKD",
  budget_ids: ["700", "701"],
  maximum_average_daily_micros: "200000000",
  maximum_change_micros: "50000000",
  confirmation,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
});
async function setup(confirmation = "each_operation") {
  const f = await fixture(),
    c = await connected(f, "google_ads");
  const policy = ok(
    await call(f.owner, "PUT", base(f) + `/policy/${c.id}/101`, {
      expected_version: 0,
      policy: body(confirmation),
    }),
  );
  return { ...f, c, policy };
}
type F = Awaited<ReturnType<typeof setup>>;
async function preview(f: F, amount = "125000000", budget = "700") {
  return ok(
    await call(f.owner, "POST", base(f) + "/previews", {
      connection_id: f.c.id,
      account_id: "101",
      budget_id: budget,
      new_average_daily_micros: amount,
    }),
  );
}
const proposal = (f: F, p: any, amount = p.desired_average_daily_micros) => ({
  connection_id: f.c.id,
  account_id: "101",
  budget_id: p.before.budget_id,
  new_average_daily_micros: amount,
  preview_id: p.preview_id,
  expected_source_sha256: p.source_sha256,
});
async function prepare(f: F, p: any, k = randomUUID()) {
  return ok(
    await call(
      f.owner,
      "POST",
      base(f) + "/operations",
      proposal(f, p),
      undefined,
      k,
    ),
    202,
  );
}
async function detail(f: F, id: string) {
  return ok(await call(f.owner, "GET", base(f) + "/operations/" + id));
}
async function confirm(f: F, o: any) {
  return ok(
    await call(f.owner, "POST", base(f) + `/operations/${o.id}/decision`, {
      expected_version: o.version,
      payload_sha256: o.payload_sha256,
      decision: "confirm",
    }),
  );
}
const mutations = () =>
  s.connectorFixture!.calls.filter((c) =>
    c.path.endsWith("/campaignBudgets:mutate"),
  ).length;

test("no policy means no external budget read or mutation; unsupported connector is denied", async () => {
  const f = await fixture(),
    c = await connected(f, "google_ads"),
    before = mutations();
  assert.equal(
    (
      await call(f.owner, "POST", base(f) + "/previews", {
        connection_id: c.id,
        account_id: "101",
        budget_id: "700",
        new_average_daily_micros: "125000000",
      })
    ).data.error.code,
    "BUDGET_POLICY_REQUIRED",
  );
  assert.equal(mutations(), before);
  const meta = await connected(f, "meta_ads");
  assert.equal(
    (
      await call(f.owner, "PUT", base(f) + `/policy/${meta.id}/301`, {
        expected_version: 0,
        policy: body(),
      })
    ).status,
    404,
  );
});
test("immutable preview, human confirmation, exact receipt and idempotent lost creation response after execution", async () => {
  const f = await setup(),
    p = await preview(f),
    k = randomUUID(),
    before = mutations();
  assert.equal(p.before.amount_micros, "100000000");
  assert.equal(p.provider_mutations, 0);
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        base(f) + "/operations",
        proposal(f, p, "126000000"),
      )
    ).data.error.code,
    "BUDGET_PREVIEW_CHANGED",
  );
  const o = await prepare(f, p, k);
  assert.equal(o.state, "awaiting_confirmation");
  await advanceExternalBudgets(s.db);
  assert.equal(mutations(), before);
  await confirm(f, o);
  await advanceExternalBudgets(s.db);
  const d = await detail(f, o.id);
  assert.equal(d.operation.state, "succeeded");
  assert.equal(d.receipts.length, 1);
  assert.equal(d.receipts[0].body.amount_micros, "125000000");
  assert.equal(d.receipts[0].body.attribution, "provider_mutation_receipt");
  assert.equal(d.operation.request_sha256, d.receipts[0].body.request_sha256);
  assert.equal(mutations(), before + 1);
  const recovered = await prepare(f, p, k);
  assert.equal(recovered.id, o.id);
  assert.equal(recovered.state, "succeeded");
  assert.equal(mutations(), before + 1);
  assert.ok(!("task_id" in recovered));
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        base(f) + "/operations",
        proposal(f, p, "127000000"),
        undefined,
        k,
      )
    ).data.error.code,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.deepEqual(
    d.events.map((e: any) => e.state),
    ["awaiting_confirmation", "queued", "checking", "dispatched", "succeeded"],
  );
});
test("policy caps use exact micros; expiry, shared and unsupported budgets do not reach mutate", async () => {
  const f = await setup(),
    before = mutations();
  assert.equal(
    (
      await call(f.owner, "POST", base(f) + "/previews", {
        connection_id: f.c.id,
        account_id: "101",
        budget_id: "700",
        new_average_daily_micros: "200000001",
      })
    ).data.error.code,
    "BUDGET_POLICY_LIMIT",
  );
  s.connectorFixture!.setBudget("101", "700", { explicitlyShared: true });
  assert.equal(
    (
      await call(f.owner, "POST", base(f) + "/previews", {
        connection_id: f.c.id,
        account_id: "101",
        budget_id: "700",
        new_average_daily_micros: "125000000",
      })
    ).data.error.code,
    "BUDGET_UNSUPPORTED_SOURCE",
  );
  assert.equal(
    (
      await call(f.owner, "PUT", base(f) + `/policy/${f.c.id}/101`, {
        expected_version: 1,
        policy: {
          ...body(),
          expires_at: new Date(Date.now() + 31 * 86400000).toISOString(),
        },
      })
    ).data.error.code,
    "BUDGET_POLICY_EXPIRY",
  );
  assert.equal(mutations(), before);
});
test("a member can propose but cannot publish policy or confirm their own operation", async () => {
  const f = await setup(),
    member = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [f.tenant, member.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, member.id],
  );
  const p = ok(
    await call(member, "POST", base(f) + "/previews", {
      connection_id: f.c.id,
      account_id: "101",
      budget_id: "700",
      new_average_daily_micros: "125000000",
    }),
  );
  const o = ok(
    await call(member, "POST", base(f) + "/operations", proposal(f, p)),
    202,
  );
  assert.equal(
    (
      await call(member, "POST", base(f) + `/operations/${o.id}/decision`, {
        expected_version: o.version,
        payload_sha256: o.payload_sha256,
        decision: "confirm",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(member, "PUT", base(f) + `/policy/${f.c.id}/101`, {
        expected_version: 1,
        policy: body("within_policy"),
      })
    ).status,
    403,
  );
  await confirm(f, o);
  await advanceExternalBudgets(s.db);
  assert.equal((await detail(f, o.id)).operation.state, "succeeded");
});
test("parallel creation keys and parallel workers issue a single physical mutation", async () => {
  const f = await setup("within_policy"),
    p = await preview(f),
    before = mutations();
  const attempts = await Promise.all([
    call(f.owner, "POST", base(f) + "/operations", proposal(f, p)),
    call(f.owner, "POST", base(f) + "/operations", proposal(f, p)),
  ]);
  assert.deepEqual(attempts.map((r) => r.status).sort(), [202, 409]);
  const o = attempts.find((r) => r.status === 202)!.data;
  await Promise.all([
    advanceExternalBudgets(s.db),
    advanceExternalBudgets(s.db),
  ]);
  assert.equal((await detail(f, o.id)).operation.state, "succeeded");
  assert.equal(mutations(), before + 1);
});
test("reconnecting the same advertiser cannot bypass an unresolved budget target", async () => {
  const f = await setup(),
    p = await preview(f);
  await prepare(f, p);
  const c = await connected(f, "google_ads"),
    other = { ...f, c };
  ok(
    await call(f.owner, "PUT", base(f) + `/policy/${c.id}/101`, {
      expected_version: 0,
      policy: body(),
    }),
  );
  const p2 = await preview(other);
  assert.equal(
    (await call(f.owner, "POST", base(f) + "/operations", proposal(other, p2)))
      .data.error.code,
    "BUDGET_TARGET_UNRESOLVED",
  );
});
test("external source drift fails before dispatch; a fresh preview can safely replace a terminal failed intent", async () => {
  const f = await setup("within_policy"),
    o = await prepare(f, await preview(f)),
    before = mutations();
  s.connectorFixture!.setBudget("101", "700", { amountMicros: "110000000" });
  await advanceExternalBudgets(s.db);
  const d = await detail(f, o.id);
  assert.equal(d.operation.state, "failed");
  assert.equal(d.operation.error_code, "BUDGET_REMOTE_CHANGED");
  assert.equal(mutations(), before);
  const next = await prepare(f, await preview(f));
  assert.notEqual(next.id, o.id);
});
test("changing policy cancels queued work; old preview cannot authorize a new request", async () => {
  const f = await setup("within_policy"),
    p = await preview(f),
    o = await prepare(f, p),
    before = mutations();
  ok(
    await call(f.owner, "PUT", base(f) + `/policy/${f.c.id}/101`, {
      expected_version: 1,
      policy: { ...body(), enabled: false },
    }),
  );
  await advanceExternalBudgets(s.db);
  assert.equal((await detail(f, o.id)).operation.state, "cancelled");
  assert.equal(mutations(), before);
  assert.equal(
    (await call(f.owner, "POST", base(f) + "/operations", proposal(f, p))).data
      .error.code,
    "BUDGET_POLICY_DISABLED",
  );
});
test("revoked connection and removed creator authority fail before external dispatch", async () => {
  for (const change of ["connection", "user"]) {
    const f = await setup("within_policy"),
      o = await prepare(f, await preview(f)),
      before = mutations();
    if (change === "connection")
      await s.db.control.query(
        "UPDATE connections SET state='revoked',encrypted_secret=NULL WHERE id=$1",
        [f.c.id],
      );
    else
      await s.db.control.query(
        "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
        [f.owner.id],
      );
    await advanceExternalBudgets(s.db);
    const row = (
      await s.db.control.query(
        "SELECT state FROM external_budget_operations WHERE id=$1",
        [o.id],
      )
    ).rows[0];
    assert.equal(row.state, "failed");
    assert.equal(mutations(), before);
  }
});
test("applied then disconnected stays unknown, is never resent, and matching observation retains unknown attribution", async () => {
  const f = await setup("within_policy"),
    o = await prepare(f, await preview(f)),
    before = mutations();
  s.connectorFixture!.setBudgetFaults(["apply_then_disconnect"]);
  await advanceExternalBudgets(s.db);
  let d = await detail(f, o.id);
  assert.equal(d.operation.state, "unknown");
  for (let i = 0; i < 3; i++) await advanceExternalBudgets(s.db);
  assert.equal(mutations(), before + 1);
  assert.equal(
    (
      await call(f.owner, "POST", base(f) + `/operations/${o.id}/cancel`, {
        expected_version: d.operation.version,
      })
    ).data.error.code,
    "BUDGET_CANNOT_CANCEL",
  );
  const observed = ok(
    await call(f.owner, "POST", base(f) + `/operations/${o.id}/observe`, {
      expected_version: d.operation.version,
    }),
  );
  assert.equal(observed.observation.snapshot.amount_micros, "125000000");
  assert.equal(observed.observation.attribution, "unknown");
  const closed = ok(
    await call(f.owner, "POST", base(f) + `/operations/${o.id}/close-unknown`, {
      expected_version: observed.version,
      observation_sha256: observed.observation.sha256,
      reason: "Reviewed external account; retain unknown attribution",
      acknowledge_unknown_attribution: true,
    }),
  );
  assert.equal(closed.state, "closed_unknown");
  assert.equal(closed.resolution.attribution, "unknown");
  const next = await prepare(f, await preview(f));
  await advanceExternalBudgets(s.db);
  assert.equal((await detail(f, next.id)).operation.state, "no_change");
  assert.equal(mutations(), before + 1);
});
test("known rejection is failed; malformed success receipt and early disconnect are unknown without retries", async () => {
  for (const [fault, state] of [
    ["reject", "failed"],
    ["malformed_receipt", "unknown"],
    ["disconnect_before_apply", "unknown"],
  ] as const) {
    s.connectorFixture!.setBudget("101", "700", { amountMicros: "100000000" });
    const f = await setup("within_policy"),
      o = await prepare(f, await preview(f)),
      before = mutations();
    s.connectorFixture!.setBudgetFaults([fault]);
    await advanceExternalBudgets(s.db);
    await advanceExternalBudgets(s.db);
    assert.equal((await detail(f, o.id)).operation.state, state);
    assert.equal(mutations(), before + 1);
  }
});
test("a lost database receipt write recovers the exact encrypted success without another mutation", async () => {
  const f = await setup("within_policy"),
    o = await prepare(f, await preview(f)),
    before = mutations();
  const original = s.db.tx.bind(s.db);
  let failed = false;
  (s.db as any).tx = (fn: any, ...args: any[]) =>
    original(
      async (tx: any) => {
        const query = tx.query;
        tx.query = (...queryArgs: any[]) => {
          const sql = queryArgs[0];
          if (
            !failed &&
            String(sql).includes("INSERT INTO external_budget_receipts")
          ) {
            failed = true;
            throw new Error("simulated receipt database outage");
          }
          return query.apply(tx, queryArgs);
        };
        try {
          return await fn(tx);
        } finally {
          tx.query = query;
        }
      },
      ...(args as [any, any, any]),
    );
  try {
    await assert.rejects(
      () => advanceExternalBudgets(s.db),
      /simulated receipt database outage/,
    );
  } finally {
    (s.db as any).tx = original;
  }
  const spool = path.resolve(s.db.config.DATA_DIR, "external-budget-receipts"),
    files = await readdir(spool);
  assert.equal(files.filter((n) => n.endsWith(".sealed")).length, 1);
  const encrypted = await readFile(
    path.join(spool, files.find((n) => n.endsWith(".sealed"))!),
    "utf8",
  );
  assert.ok(!encrypted.includes("125000000"));
  assert.equal((await detail(f, o.id)).operation.state, "dispatched");
  assert.equal(await recoverBudgetReceipts(s.db), 1);
  const d = await detail(f, o.id);
  assert.equal(d.operation.state, "succeeded");
  assert.equal(d.receipts[0].body.amount_micros, "125000000");
  await advanceExternalBudgets(s.db);
  assert.equal(mutations(), before + 1);
});
test("expired checking lease is failed; expired dispatched lease is unknown and cannot requeue", async () => {
  const f = await setup("within_policy"),
    o = await prepare(f, await preview(f)),
    before = mutations(),
    lease = randomUUID();
  await s.db.control.query(
    "UPDATE external_budget_operations SET state='checking',version=version+1,lease_token=$2,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [o.id, lease],
  );
  await advanceExternalBudgets(s.db);
  assert.equal((await detail(f, o.id)).operation.state, "failed");
  const next = await prepare(f, await preview(f));
  await s.db.control.query(
    "UPDATE external_budget_operations SET state='checking',version=version+1,lease_token=$2,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [next.id, lease],
  );
  await s.db.control.query(
    "UPDATE external_budget_operations SET state='dispatched',version=version+1,request_sha256=$2 WHERE id=$1",
    [next.id, "1".repeat(64)],
  );
  await advanceExternalBudgets(s.db);
  assert.equal((await detail(f, next.id)).operation.state, "unknown");
  assert.equal(mutations(), before);
  await assert.rejects(
    () =>
      s.db.control.query(
        "UPDATE external_budget_operations SET state='queued',version=version+1 WHERE id=$1",
        [next.id],
      ),
    /Invalid external budget transition/,
  );
});
test("cross-tenant reads, policies and previews cannot reveal or mutate foreign operations", async () => {
  const f = await setup(),
    o = await prepare(f, await preview(f)),
    other = await fixture();
  assert.equal(
    (await call(other.owner, "GET", base(f) + "/operations/" + o.id)).status,
    404,
  );
  assert.equal(
    (await call(other.owner, "GET", base(other) + "/operations/" + o.id))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        other.owner,
        "GET",
        base(other) + `/policy?connection_id=${f.c.id}&account_id=101`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(f.owner, "GET", base(f) + "/operations?limit=101")).status,
    400,
  );
  await assert.rejects(
    () =>
      s.db.control.query(
        "UPDATE external_budget_policies SET body='{}' WHERE id=$1",
        [f.policy.id],
      ),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      s.db.control.query(
        "UPDATE external_budget_operations SET specification='{}',version=version+1 WHERE id=$1",
        [o.id],
      ),
    /Frozen budget identity/,
  );
});

async function operator(role: string, tenant: string): Promise<Client> {
  const email = `connector-admin-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 }),
    p = (
      await s.db.control.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
        [email, role, seal(s.db.config.MASTER_KEY!, secret.base32)],
      )
    ).rows[0];
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)",
    [p.id, role, tenant],
  );
  const challenge = ok(
      await call(undefined, "POST", "/v1/admin/auth/challenge", { email }),
    ),
    mail = JSON.parse(
      await readFile(
        `${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,
        "utf8",
      ),
    );
  const r = await call(undefined, "POST", "/v1/admin/auth/verify", {
      challenge_id: challenge.challenge_id,
      code: mail.text.match(/\b\d{6}\b/)[0],
      totp: new OTPAuth.TOTP({
        secret,
        digits: 6,
        period: 30,
        algorithm: "SHA1",
      }).generate(),
    }),
    data = ok(r),
    cookie = r.raw.cookies.find((c) => c.name === "cp_admin_session")!;
  return {
    id: p.id,
    cookie: cookie.name + "=" + cookie.value,
    csrf: data.csrf_token,
  };
}
test("scoped administrators read exact evidence without secrets; deny and recent MFA remain authoritative", async () => {
  const f = await setup(),
    o = await prepare(f, await preview(f)),
    foreign = await fixture(),
    admin = await operator("super_admin", f.tenant),
    support = await operator("support_agent", f.tenant);
  const list = ok(
    await call(admin, "GET", "/v1/admin/external-budget/operations?limit=100"),
  );
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].id, o.id);
  const root = `/v1/admin/tenants/${f.tenant}/projects/${f.project}/external-budget`;
  const d = ok(await call(admin, "GET", root + "/operations/" + o.id));
  assert.equal(d.operation.id, o.id);
  assert.ok(
    !/access_token|refresh_token|encrypted_secret|task_id/.test(
      JSON.stringify(d),
    ),
  );
  assert.equal(
    (await call(support, "GET", "/v1/admin/external-budget/operations")).status,
    403,
  );
  assert.equal(
    (
      await call(
        admin,
        "GET",
        `/v1/admin/tenants/${foreign.tenant}/projects/${foreign.project}/external-budget/operations/${o.id}`,
      )
    ).status,
    403,
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,'super_admin','project',$2,'deny')",
    [admin.id, f.project],
  );
  assert.equal(
    ok(await call(admin, "GET", "/v1/admin/external-budget/operations")).items
      .length,
    0,
  );
  assert.equal(
    (await call(admin, "GET", root + "/operations/" + o.id)).status,
    403,
  );
  const current = await operator("super_admin", f.tenant);
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=clock_timestamp()-interval '11 minutes' WHERE admin_id=$1",
    [current.id],
  );
  assert.equal(
    (await call(current, "GET", "/v1/admin/external-budget/operations")).data
      .error.code,
    "MFA_REQUIRED",
  );
});
test("admin policy authors are recorded separately; managers cancel but cannot impersonate customer confirmation", async () => {
  const f = await setup(),
    o = await prepare(f, await preview(f)),
    admin = await operator("super_admin", f.tenant),
    root = `/v1/admin/tenants/${f.tenant}/projects/${f.project}/external-budget`;
  assert.equal(
    (
      await call(admin, "POST", root + `/operations/${o.id}/decision`, {
        expected_version: o.version,
        payload_sha256: o.payload_sha256,
        decision: "confirm",
      })
    ).status,
    404,
  );
  const changed = ok(
    await call(admin, "PUT", root + `/policy/${f.c.id}/101`, {
      expected_version: 1,
      policy: body("within_policy"),
    }),
  );
  assert.equal(changed.version, 2);
  assert.equal((await detail(f, o.id)).operation.state, "cancelled");
  const row = (
    await s.db.control.query(
      "SELECT created_by,created_by_audience FROM external_budget_policies WHERE id=$1",
      [changed.id],
    )
  ).rows[0];
  assert.equal(row.created_by, admin.id);
  assert.equal(row.created_by_audience, "admin");
  const next = await prepare(f, await preview(f));
  assert.equal(
    ok(
      await call(admin, "POST", root + `/operations/${next.id}/cancel`, {
        expected_version: next.version,
      }),
    ).state,
    "cancelled",
  );
  const budgetCatalog = s.catalog.admin.permissions.filter((p: any) =>
    p.key.startsWith("admin.external_budget."),
  );
  assert.equal(budgetCatalog.length, 3);
});
class BudgetToolFixture extends CodexRuntimeAdapter {
  failure: unknown;
  constructor(private perform: (ctx: RuntimeContext) => Promise<void>) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    try {
      await this.perform(ctx);
    } catch (e) {
      this.failure = e;
      throw e;
    }
    return {
      status: "completed",
      text: "Synthetic model; exact budget tool result was used.",
      inputTokens: 20,
      outputTokens: 10,
      usageKnown: true,
      accepted: true,
      thread: "synthetic-budget",
      turn: randomUUID(),
    };
  }
}
test("versioned Codex tools freeze the preview, cannot self-confirm, and preserve historical role permissions", async () => {
  const f = await setup(),
    before = mutations();
  ok(await call(f.owner, "POST", `/v1/tenants/${f.tenant}/demo-credit`, {}));
  const templates = ok(
      await call(
        f.owner,
        "GET",
        "/v1/agent-templates?limit=30",
        undefined,
        f.tenant,
      ),
    ),
    template = templates.items.find(
      (t: any) => t.role_key === "marketing-analyst",
    );
  const agent = ok(
    await call(
      f.owner,
      "POST",
      `/v1/agent-templates/${template.id}/instances`,
      { project_id: f.project, template_version: template.version },
      f.tenant,
    ),
    201,
  );
  const projectRoot = `/v1/tenants/${f.tenant}/projects/${f.project}`;
  const conversation = ok(
    await call(f.owner, "POST", projectRoot + "/conversations", {
      name: "Exact budget change",
      agent_id: agent.id,
    }),
  );
  const accepted = ok(
    await call(
      f.owner,
      "POST",
      projectRoot + `/conversations/${conversation.id}/messages`,
      {
        body: "Change advertiser 101 budget 700 to HKD 125 average daily under the configured policy.",
        expected_version: conversation.version,
        intent: "delegate",
        mode: "execute",
        budget_micros: 1000000,
        client_message_id: randomUUID(),
      },
    ),
  );
  let operation: any;
  const runtime = new BudgetToolFixture(async (ctx) => {
    assert.ok(
      ctx.skills.some((s) => s.content.includes("name: external-budget")),
    );
    for (const tool of ctx.tools.filter((t) =>
      t.name.startsWith("external_budget_"),
    ))
      desktopCompanyToolSchema(tool.inputSchema);
    const p: any = await ctx.tools
      .find((t) => t.name === "external_budget_preview")!
      .run(
        {
          connection_id: f.c.id,
          account_id: "101",
          budget_id: "700",
          new_average_daily_micros: "125000000",
        },
        randomUUID(),
      );
    operation = await ctx.tools
      .find((t) => t.name === "external_budget_prepare")!
      .run(proposal(f, p), randomUUID());
    assert.equal(operation.state, "awaiting_confirmation");
    assert.equal(
      ctx.tools.some((t) =>
        /external_budget_(confirm|approve|execute|policy)/.test(t.name),
      ),
      false,
    );
    const status: any = await ctx.tools
      .find((t) => t.name === "external_budget_status")!
      .run({ operation_id: operation.id }, randomUUID());
    assert.equal(status.id, operation.id);
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    accepted.task.id,
  );
  if (runtime.failure) throw runtime.failure;
  assert.ok(operation);
  await advanceExternalBudgets(s.db);
  assert.equal(mutations(), before);
  await confirm(f, operation);
  await advanceExternalBudgets(s.db);
  assert.equal((await detail(f, operation.id)).operation.state, "succeeded");
  const release = JSON.parse(
    await readFile("catalog/external-budget-release-v1.json", "utf8"),
  );
  const old = s.catalog.role("marketing-analyst", release.previous_role_sha256);
  assert.equal(old.version, "1.2.0");
  assert.equal(
    old.tool_ids.some((id: string) => id.startsWith("connector.budget.")),
    false,
  );
});
