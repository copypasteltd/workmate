import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { installIsolatedProviderPolicy } from "./provider-policy-fixture.js";
import { loadConfig } from "../src/config.js";
import { seal, hash, canonical } from "../src/lib.js";
import { Worker } from "../src/worker.js";
import { taskCapabilities } from "../src/capability-bindings.js";
import {
  seedProviderBudgetPolicy,
  taskProviderBudgetReceipt,
} from "../src/provider-budgets.js";
import { providerEvidenceCost } from "../src/provider-admin-reconciliation.js";
import { enableProviderAdmin } from "../src/provider-admin-bootstrap.js";
import type {
  AIRequestInfo,
  AIRequestPermit,
} from "../src/internal-ai-gateway.js";

let owned: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin: boolean };
let a: Client, reviewer: Client;
before(async () => {
  owned = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...owned.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
      DEV_MAILBOX: "true",
    }),
    { worker: false },
  );
  await installIsolatedProviderPolicy(s.db);
  a = await admin();
  reviewer = await admin();
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await owned?.cleanup();
  }
});
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: url.startsWith("/v1/admin")
        ? s.db.config.ADMIN_ORIGIN
        : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
function ok(r: Awaited<ReturnType<typeof call>>, status = 200) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}
async function login(
  address: string,
  secret?: OTPAuth.Secret,
): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth",
    ch = ok(
      await call(undefined, "POST", prefix + "/challenge", { email: address }),
    );
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: ch.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    ...(secret
      ? {
          totp: new OTPAuth.TOTP({
            secret,
            digits: 6,
            period: 30,
            algorithm: "SHA1",
          }).generate(),
        }
      : {}),
  });
  const data = ok(r),
    cookie = r.raw.cookies.find(
      (c) => c.name === (secret ? "cp_admin_session" : "cp_session"),
    )!;
  return {
    id: data.admin?.id ?? data.user.id,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: data.csrf_token,
    admin: !!secret,
  };
}
async function admin(
  permissions?: string[],
  scope = "global",
  target: string | null = null,
): Promise<Client> {
  const secret = new OTPAuth.Secret({ size: 20 }),
    email = randomUUID() + "@example.invalid";
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Provider reviewer',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  let role = "super_admin";
  if (permissions) {
    role = "provider-test-" + randomUUID();
    await s.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
      [role, JSON.stringify(permissions)],
    );
  }
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, scope, target],
  );
  return { ...(await login(email, secret)), id: p.id };
}
const root = "/v1/admin/ai";
async function definition() {
  const current = ok(await call(a, "GET", root + "/policy"));
  const keys = [
    "global_slots",
    "tenant_slots",
    "actor_slots",
    "text_slots",
    "image_slots",
    "verification_slots",
    "global_rpm",
    "tenant_rpm",
    "actor_rpm",
    "text_rpm",
    "image_rpm",
    "verification_rpm",
    "preparation_seconds",
  ];
  return {
    limits: Object.fromEntries(keys.map((k) => [k, current.limits[k]])),
    budget: {
      count_verified: true,
      count_price_micros: 3,
      verification_run_micros: 1000000,
      verification_daily_micros: 10000000,
      counting_daily_micros: 10000000,
    },
    count_contract: {
      reference: "Simulated counting contract",
      terms: "Simulated explicit counting fee, no live model qualification.",
      service: "responses.input_tokens",
      fee_micros: 3,
      effective_at: "2026-01-01T00:00:00Z",
    },
  };
}
async function draft(d?: any) {
  const op = ok(
    await call(a, "POST", root + "/policies/drafts", {
      definition: d ?? (await definition()),
      reason: "Controlled provider policy fixture",
    }),
    202,
  );
  return op.result_ids[0] as string;
}
async function submit(command: any, who = a) {
  const p = ok(await call(who, "POST", root + "/previews", command));
  const op = ok(
    await call(who, "POST", root + "/operations", {
      command,
      preview_id: p.preview_id,
    }),
    202,
  );
  return { op, p, command };
}
async function decision(
  op: any,
  who = reviewer,
  choice = "approve",
  headers: Record<string, string> = {},
) {
  const approval = ok(
    await call(who, "GET", `/v1/admin/operations/${op.id}/approval`),
  );
  return call(
    who,
    "POST",
    `/v1/admin/approvals/${approval.id}/decisions`,
    {
      expected_version: approval.version,
      payload_hash: approval.payload_hash,
      decision: choice,
      reason: "Independent provider evidence review",
    },
    headers,
  );
}
async function publish(d?: any) {
  const id = await draft(d),
    current = ok(await call(a, "GET", root + "/policy"));
  const x = await submit({
    action: "ai.policy.publish",
    draft_id: id,
    expected_revision: current.revision,
    reason: "Publish independently reviewed provider policy",
  });
  ok(await decision(x.op), 202);
  return x;
}
async function fixture(
  options: {
    image?: boolean;
    budget?: number;
    known?: boolean;
    countOnly?: boolean;
  } = {},
) {
  const user = await login(randomUUID() + "@example.invalid"),
    w = ok(
      await call(user, "POST", "/v1/tenants", {
        name: "Provider admin customer",
        project_name: "Scoped reconciliation",
      }),
    );
  const tenant = w.tenant.id,
    project = w.project.id;
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [tenant],
  );
  const t = ok(
    await call(
      user,
      "POST",
      `/v1/tenants/${tenant}/projects/${project}/tasks`,
      {
        title: "Evidence controlled task",
        prompt: "Only explicitly simulated responses",
        role_key: options.image ? "designer" : "marketing-analyst",
        budget_micros: options.budget ?? 1000000,
      },
    ),
  );
  const fence = randomUUID(),
    task = (
      await s.db.control.query(
        "UPDATE tasks SET status='running',attempt=1,fencing_token=$2,lease_until=now()+interval '5 minutes' WHERE id=$1 RETURNING *",
        [t.id, fence],
      )
    ).rows[0];
  const actor = (
    await s.db.control.query(
      "SELECT name,email,auth_version FROM users WHERE id=$1",
      [user.id],
    )
  ).rows[0];
  const principal = {
    id: user.id,
    audience: "user",
    authVersion: actor.auth_version,
    name: actor.name,
    email: actor.email,
    sessionId: "",
    sessionHash: "",
  };
  const cap = await s.db.tx(
    (tx) => taskCapabilities(tx, s.db.config, s.catalog, task),
    tenant,
    true,
    user.id,
  );
  const worker = new Worker(s.db, s.catalog, s.storage);
  const genId = randomUUID(),
    common = {
      taskId: task.id,
      tenantId: tenant,
      projectId: project,
      actorId: user.id,
      capabilityVersionId: options.image ? cap.image!.id : cap.text.id,
      attempt: 1,
      fencingToken: fence,
    };
  const finalize = async (channel: string, id: string | undefined) => {
    await s.db.control.query(
      "UPDATE tasks SET status='reconciling',lease_until=NULL WHERE id=$1",
      [task.id],
    );
    await s.db.control.query(
      "UPDATE reservations SET status='reconciling' WHERE task_id=$1",
      [task.id],
    );
    const row = (
      await s.db.control.query(
        "SELECT * FROM current_ai_provider_requests WHERE channel=$1 AND id=$2",
        [channel, id],
      )
    ).rows[0];
    return { task, user, tenant, project, row };
  };
  let countId: string | undefined;
  if (!options.image) {
    const ci: AIRequestInfo = {
      ...common,
      requestId: randomUUID(),
      operation: "responses.input_tokens",
      model: cap.text.body.model_alias,
      requestHash: hash("count fixture"),
      requestBytes: 10,
      generationOperationId: genId,
      generationHash: hash("generation fixture"),
    };
    const count = (await (worker as any).authorizeInference(
      task,
      principal,
      fence,
      ci,
    )) as AIRequestPermit;
    await count.dispatch();
    if (options.countOnly) {
      await count.finish({
        state: "unknown",
        code: "SIMULATED_COUNT_RESULT_LOST",
      });
      return finalize("input_count", count.requestId);
    }
    await count.finish({
      state: "completed",
      countedInputTokens: 100,
      httpStatus: 200,
    });
    countId = count.requestId;
  }
  const info: AIRequestInfo = {
    ...common,
    requestId: genId,
    operation: options.image ? "images.generate" : "responses",
    model: options.image
      ? cap.image!.body.model_alias
      : cap.text.body.model_alias,
    requestHash: hash("generation fixture"),
    requestBytes: 20,
    ...(options.image ? {} : { inputCountId: countId, maxOutputTokens: 32 }),
  };
  const permit = (await (worker as any).authorizeInference(
    task,
    principal,
    fence,
    info,
  )) as AIRequestPermit;
  await permit.dispatch();
  if (options.known)
    await permit.finish({
      state: "completed",
      inputTokens: 100,
      outputTokens: 11,
      httpStatus: 200,
    });
  else
    await permit.finish({ state: "unknown", code: "SIMULATED_RESPONSE_LOST" });
  return finalize("generation", permit.requestId);
}
function evidence(
  r: any,
  usage: any = { kind: "text", input_tokens: 100, output_tokens: 11 },
) {
  const numerator =
    usage.kind === "text"
      ? BigInt(usage.input_tokens) * BigInt(r.rate_snapshot[0]) +
        BigInt(usage.output_tokens) * BigInt(r.rate_snapshot[1])
      : usage.kind === "image"
        ? BigInt(usage.image_units) * BigInt(r.rate_snapshot[0]) * 1000000n
        : BigInt(r.price_micros) * 1000000n;
  return {
    schema_version: 1,
    data_mode: r.data_mode,
    operation_id: r.operation_id,
    request_hash: r.request_hash,
    provider_reference: "Company provider fixture reference",
    source_reference: "Simulated provider usage statement",
    source_note:
      "Human-submitted labelled mock evidence for the original request",
    observed_at: new Date().toISOString(),
    terminated: true,
    outcome: "completed",
    currency: "HKD",
    billed_micros: ((numerator + 999999n) / 1000000n).toString(),
    usage,
  };
}
async function registerEvidence(
  f: Awaited<ReturnType<typeof fixture>>,
  d = evidence(f.row),
) {
  const op = ok(
    await call(a, "POST", `${root}/requests/generation/${f.row.id}/evidence`, {
      document: d,
      reason: "Register immutable simulated provider statement",
    }),
    202,
  );
  return op.result_ids[0] as string;
}
const requestCommand = (r: any, id: string, action = "ai.cost.reconcile") => ({
  action,
  channel: r.channel,
  request_id: r.id,
  evidence_id: id,
  reason: "Independently confirm the original provider statement",
});
async function reconcile(f: Awaited<ReturnType<typeof fixture>>) {
  const id = await registerEvidence(f);
  const x = await submit(requestCommand(f.row, id));
  ok(await decision(x.op), 202);
  return { id, x };
}

test("provider policy routes enforce Admin audience, fresh MFA and dedicated permission", async () => {
  assert.equal((await call(undefined, "GET", root + "/policy")).status, 401);
  const narrow = await admin(["admin.catalog.read"]);
  assert.equal((await call(narrow, "GET", root + "/policy")).status, 403);
  const stale = await admin();
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '1 hour' WHERE admin_id=$1",
    [stale.id],
  );
  assert.equal((await call(stale, "GET", root + "/policy")).status, 403);
});
test("provider immutable policy publication is independently approved and survives startup seeding", async () => {
  const x = await publish(),
    p = ok(await call(a, "GET", root + "/policy"));
  assert.equal(p.revision, 1);
  assert.equal(
    (await call(a, "GET", root + "/policies")).data.items[0].id,
    x.command.draft_id,
  );
  await seedProviderBudgetPolicy(s.db);
  const reloaded = ok(await call(a, "GET", root + "/policy"));
  assert.equal(reloaded.publication_id, p.publication_id);
  assert.equal(reloaded.budget.id, p.budget.id);
  await assert.rejects(
    s.db.control.query(
      "UPDATE ai_provider_policy_drafts SET reason='changed' WHERE id=$1",
      [x.command.draft_id],
    ),
    (e) => (e as any).code === "42501",
  );
  const owner = new pg.Client({
    connectionString: owned.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await assert.rejects(
      owner.query(
        "UPDATE ai_provider_policy_drafts SET reason='changed by owner' WHERE id=$1",
        [x.command.draft_id],
      ),
      (e) => (e as any).code === "23514",
    );
  } finally {
    await owner.end();
  }
});
test("provider publication rejects self approval and stale heads", async () => {
  const current = ok(await call(a, "GET", root + "/policy")),
    id = await draft();
  const x = await submit({
    action: "ai.policy.publish",
    draft_id: id,
    expected_revision: current.revision,
    reason: "Cannot approve own controlled change",
  });
  assert.equal((await decision(x.op, a)).status, 403);
  await publish();
  assert.equal((await decision(x.op)).status, 409);
});
test("provider publication rejects incomplete counting contracts and unknown fields", async () => {
  const d = await definition();
  d.count_contract = null as any;
  assert.equal(
    (
      await call(a, "POST", root + "/policies/drafts", {
        definition: d,
        reason: "Missing explicit price contract",
      })
    ).status,
    400,
  );
  const valid = await definition();
  assert.equal(
    (
      await call(a, "POST", root + "/policies/drafts", {
        definition: { ...valid, wallet_credit: 100 },
        reason: "No implicit money actions",
      })
    ).status,
    400,
  );
});
test("provider approvals recheck revoked requester and preserve pending operation", async () => {
  const temporary = await admin(),
    id = await draft(),
    current = ok(await call(a, "GET", root + "/policy"));
  const x = await submit(
    {
      action: "ai.policy.publish",
      draft_id: id,
      expected_revision: current.revision,
      reason: "Requester authority recheck",
    },
    temporary,
  );
  await s.db.control.query(
    "UPDATE admin_principals SET auth_version=auth_version+1 WHERE id=$1",
    [temporary.id],
  );
  assert.equal((await decision(x.op)).status, 403);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT state FROM admin_operations WHERE id=$1",
        [x.op.id],
      )
    ).rows[0].state,
    "pending_approval",
  );
  ok(await decision(x.op, reviewer, "reject"), 202);
});
test("provider directory hides internal cost and excludes cross-tenant records", async () => {
  const f = await fixture(),
    other = await fixture();
  const scoped = await admin(["admin.ai.requests.read"], "tenant", f.tenant);
  const list = ok(await call(scoped, "GET", root + "/requests?limit=1"));
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].tenant_id, f.tenant);
  assert.equal(list.items[0].cost, undefined);
  assert.equal(
    (await call(scoped, "GET", `${root}/requests/generation/${other.row.id}`))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        scoped,
        "GET",
        root + "/requests?data_mode=configured_services",
      )
    ).status,
    404,
  );
  assert.ok(!JSON.stringify(list).includes("execution_nonce"));
});
test("provider signed pagination rejects tampering and changed filters", async () => {
  const first = ok(await call(a, "GET", root + "/requests?limit=1"));
  assert.ok(first.next_cursor);
  ok(
    await call(
      a,
      "GET",
      root +
        "/requests?limit=1&cursor=" +
        encodeURIComponent(first.next_cursor),
    ),
  );
  assert.equal(
    (
      await call(
        a,
        "GET",
        root +
          "/requests?state=unknown&limit=1&cursor=" +
          encodeURIComponent(first.next_cursor),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        a,
        "GET",
        root +
          "/requests?limit=1&cursor=" +
          encodeURIComponent(first.next_cursor + "x"),
      )
    ).status,
    400,
  );
});
test("provider evidence binds exact request identity and retains canonical download", async () => {
  const f = await fixture(),
    d = evidence(f.row),
    bad = { ...d, request_hash: hash("different") };
  assert.equal(
    (
      await call(
        a,
        "POST",
        `${root}/requests/${f.row.channel}/${f.row.id}/evidence`,
        { document: bad, reason: "Mismatch must never become evidence" },
      )
    ).status,
    400,
  );
  const id = await registerEvidence(f, d),
    e = ok(await call(a, "GET", root + "/evidence/" + id));
  assert.equal(e.document_hash, hash(canonical(d)));
  assert.equal(e.source, "human_submission");
  assert.equal(e.canonical_document, canonical(d));
  await assert.rejects(
    s.db.app.query("SELECT * FROM ai_provider_evidence"),
    (e) => (e as any).code === "42501",
  );
});
test("provider cost confirmation keeps original unknown observation and capacity held", async () => {
  const f = await fixture();
  await reconcile(f);
  const r = (
    await s.db.control.query(
      "SELECT * FROM current_ai_provider_requests WHERE id=$1",
      [f.row.id],
    )
  ).rows[0];
  assert.equal(r.state, "unknown");
  assert.equal(r.cost_state, "manually_confirmed");
  assert.equal(r.capacity_held, true);
  assert.equal(r.usage_known, false);
  const receipt = await s.db.tx(
    (tx) => taskProviderBudgetReceipt(tx, f.task.id),
    undefined,
    true,
  );
  assert.equal(receipt.uncertain, false);
  assert.equal(receipt.inputTokens, 100);
  assert.equal(receipt.outputTokens, 11);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [f.task.id],
      )
    ).rows[0].n,
    0,
  );
});
test("provider capacity release never clears unknown fees or budget commitment", async () => {
  const f = await fixture(),
    id = await registerEvidence(f),
    before = (
      await s.db.control.query(
        "SELECT amount_numerator FROM ai_request_budget_allocations WHERE provider_request_id=$1",
        [f.row.id],
      )
    ).rows[0];
  const x = await submit(requestCommand(f.row, id, "ai.capacity.release"));
  ok(await decision(x.op), 202);
  const r = (
    await s.db.control.query(
      "SELECT * FROM current_ai_provider_requests WHERE id=$1",
      [f.row.id],
    )
  ).rows[0];
  assert.equal(r.state, "unknown");
  assert.equal(r.cost_state, "unknown");
  assert.equal(r.capacity_held, false);
  const used = await s.db.tx(
    (tx) =>
      tx.query(
        "SELECT ai_budget_used(envelope_id,NULL)::text AS used FROM ai_request_budget_allocations WHERE provider_request_id=$1",
        [f.row.id],
      ),
    undefined,
    true,
  );
  assert.equal(used.rows[0].used, before.amount_numerator);
  const receipt = await s.db.tx(
    (tx) => taskProviderBudgetReceipt(tx, f.task.id),
    undefined,
    true,
  );
  assert.equal(receipt.uncertain, true);
});
test("provider incorrect invoice cannot alter frozen charge but can independently prove termination", async () => {
  const f = await fixture(),
    d = { ...evidence(f.row), billed_micros: "99999" },
    id = await registerEvidence(f, d);
  assert.equal(
    (await call(a, "POST", root + "/previews", requestCommand(f.row, id)))
      .status,
    409,
  );
  const x = await submit(requestCommand(f.row, id, "ai.capacity.release"));
  ok(await decision(x.op), 202);
});
test("provider task settlement derives one customer charge, excludes counting, and preserves business failure", async () => {
  const f = await fixture();
  await reconcile(f);
  const facts = ok(
    await call(a, "GET", `${root}/tasks/${f.task.id}/settlement`),
  );
  const command = {
    action: "ai.tasks.settle",
    task_id: f.task.id,
    expected_task_version: facts.task.version,
    acknowledge_violation_ids: [],
    reason: "Settle exact provider usage once",
  };
  const x = await submit(command);
  ok(await decision(x.op), 202);
  const t = (
    await s.db.control.query(
      "SELECT status,charged_micros FROM tasks WHERE id=$1",
      [f.task.id],
    )
  ).rows[0];
  assert.equal(t.status, "failed");
  const expected = providerEvidenceCost(f.row, evidence(f.row)).amount_micros;
  assert.equal(t.charged_micros, expected);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [f.task.id],
      )
    ).rows[0].n,
    Number(BigInt(expected) > 0n),
  );
  assert.equal(
    (await call(a, "POST", root + "/previews", command)).status,
    409,
  );
});
test("provider task settlement refuses unknown costs and legacy arbitrary amount bypass", async () => {
  const f = await fixture(),
    facts = ok(await call(a, "GET", `${root}/tasks/${f.task.id}/settlement`));
  const command = {
    action: "ai.tasks.settle",
    task_id: f.task.id,
    expected_task_version: facts.task.version,
    acknowledge_violation_ids: [],
    reason: "Unknown must not become zero",
  };
  assert.equal(
    (await call(a, "POST", root + "/previews", command)).status,
    409,
  );
  // Legacy command still passes its own preview protocol; direct effect must
  // reject at the apply boundary as well, not only in the new UI.
  const legacy = {
    action: "billing.reconcile",
    tenant_id: f.tenant,
    task_id: f.task.id,
    actual_micros: 0,
    reason: "Attempt old arbitrary charge bypass",
  };
  const p = await call(a, "POST", "/v1/admin/operations/preview", legacy);
  if (p.status === 200) {
    const r = await call(a, "POST", "/v1/admin/operations/commit", {
      preview_id: p.data.id,
      payload_hash: p.data.payload_hash,
    });
    assert.equal(r.status, 409, JSON.stringify(r.data));
  } else assert.equal(p.status, 409, JSON.stringify(p.data));
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].status,
    "reconciling",
  );
});
test("provider operation and approval directory cannot leak costs through generic jobs.read", async () => {
  const f = await fixture(),
    id = await registerEvidence(f),
    x = await submit(requestCommand(f.row, id)),
    limited = await admin(["admin.jobs.read", "admin.approvals.read"]);
  assert.equal(
    (await call(limited, "GET", `/v1/admin/operations/${x.op.id}`)).status,
    403,
  );
  const jobs = ok(await call(limited, "GET", "/v1/admin/jobs"));
  assert.ok(!jobs.items?.some((j: any) => j.id === x.op.id));
  const list = ok(await call(limited, "GET", "/v1/admin/approvals"));
  assert.ok(!list.items.some((j: any) => j.operation_id === x.op.id));
});
test("provider exact fee math uses one rounding and refuses nonzero not-executed claims", () => {
  const r = {
    channel: "generation",
    state: "unknown",
    data_mode: "simulated",
    operation_id: randomUUID(),
    request_hash: hash("math"),
    dispatched_at: new Date(Date.now() - 1000),
    request_class: "text",
    rate_snapshot: [1, 1],
  };
  const d = evidence(r, { kind: "text", input_tokens: 1, output_tokens: 1 });
  assert.equal(providerEvidenceCost(r, d).numerator, "2");
  assert.equal(providerEvidenceCost(r, d).amount_micros, "1");
  assert.throws(() =>
    providerEvidenceCost(r, { ...d, outcome: "not_executed" }),
  );
});
test("provider operational enablement previews exact principal then revokes old sessions without changing existing role", async () => {
  const who = await admin(),
    base = (
      await s.db.control.query(
        "SELECT permissions FROM admin_roles WHERE key='super_admin'",
      )
    ).rows[0].permissions;
  const keys = s.catalog.admin.permissions
    .filter((p: any) => p.key.startsWith("admin.ai."))
    .map((p: any) => p.key);
  const preview = await s.db.tx(
    (tx) =>
      enableProviderAdmin(
        tx,
        who.id,
        "Enable selected installed principal",
        keys,
      ),
    undefined,
    true,
  );
  assert.equal(preview.creates_business_effect, false);
  await assert.rejects(
    s.db.tx(
      (tx) =>
        enableProviderAdmin(
          tx,
          who.id,
          "Enable selected installed principal",
          keys,
          hash("wrong"),
        ),
      undefined,
      true,
    ),
  );
  await s.db.tx(
    (tx) =>
      enableProviderAdmin(
        tx,
        who.id,
        "Enable selected installed principal",
        keys,
        preview.preview_hash,
      ),
    undefined,
    true,
  );
  assert.equal((await call(who, "GET", root + "/policy")).status, 401);
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT permissions FROM admin_roles WHERE key='super_admin'",
      )
    ).rows[0].permissions,
    base,
  );
});

test("provider paid counting confirmation remains platform-funded and is never an input-count proof", async () => {
  const f = await fixture({ countOnly: true }),
    d = evidence(f.row, { kind: "input_count", counted_input_tokens: null }),
    id = await registerEvidence(f, d);
  assert.equal(d.billed_micros, "3");
  const x = await submit(requestCommand(f.row, id));
  ok(await decision(x.op), 202);
  const original = (
    await s.db.control.query(
      "SELECT state,counted_input_tokens,usage_known,charge_numerator FROM ai_input_count_requests WHERE id=$1",
      [f.row.id],
    )
  ).rows[0];
  assert.deepEqual(original, {
    state: "unknown",
    counted_input_tokens: null,
    usage_known: false,
    charge_numerator: null,
  });
  const used = await s.db.tx(
    (tx) =>
      tx.query(
        "SELECT ai_budget_used(NULL,platform_period_id)::text AS n FROM ai_request_budget_allocations WHERE count_request_id=$1",
        [f.row.id],
      ),
    undefined,
    true,
  );
  assert.ok(BigInt(used.rows[0].n) >= 3000000n);
  const receipt = await s.db.tx(
    (tx) => taskProviderBudgetReceipt(tx, f.task.id),
    undefined,
    true,
  );
  assert.equal(receipt.requests, 0);
  assert.equal(receipt.knownChargeMicros, 0);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [f.task.id],
      )
    ).rows[0].n,
    0,
  );
});
test("provider immutable evidence does not permit unknown client success or future timestamps", async () => {
  const f = await fixture(),
    d = evidence(f.row),
    url = `${root}/requests/generation/${f.row.id}/evidence`;
  assert.equal(
    (
      await call(a, "POST", url, {
        document: { ...d, verified: true },
        reason: "Do not trust a client success flag",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(a, "POST", url, {
        document: {
          ...d,
          observed_at: new Date(Date.now() + 3600000).toISOString(),
        },
        reason: "Future evidence is not current",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(a, "POST", url, {
        document: { ...d, observed_at: "2020-01-01T00:00:00Z" },
        reason: "Evidence cannot predate dispatch",
      })
    ).status,
    400,
  );
});
test("provider original known observation cannot be overwritten with human evidence", async () => {
  const f = await fixture({ known: true });
  const r = await call(
    a,
    "POST",
    `${root}/requests/generation/${f.row.id}/evidence`,
    { document: evidence(f.row), reason: "Known gateway facts are immutable" },
  );
  assert.equal(r.status, 409);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT state FROM ai_gateway_requests WHERE id=$1",
        [f.row.id],
      )
    ).rows[0].state,
    "completed",
  );
});
test("provider independent fee operations serialize concurrent approvals and never overwrite confirmation", async () => {
  const f = await fixture(),
    id = await registerEvidence(f),
    one = await submit(requestCommand(f.row, id)),
    two = await submit({
      ...requestCommand(f.row, id),
      reason: "Separate concurrent review of the same cost",
    });
  const responses = await Promise.all([decision(one.op), decision(two.op)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [202, 409]);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ai_provider_cost_confirmations WHERE provider_request_id=$1",
        [f.row.id],
      )
    ).rows[0].n,
    1,
  );
});
test("provider audit failure rolls back fee confirmation and approval atomically", async () => {
  const f = await fixture(),
    id = await registerEvidence(f),
    x = await submit(requestCommand(f.row, id));
  const owner = new pg.Client({
    connectionString: owned.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await owner.query(
      "CREATE FUNCTION provider_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admin.ai.cost.reconcile' AND NEW.outcome='succeeded' THEN RAISE EXCEPTION 'Owned fixture audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER provider_test_fail_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION provider_test_fail_audit()",
    );
    assert.equal((await decision(x.op)).status, 500);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM ai_provider_cost_confirmations WHERE provider_request_id=$1",
          [f.row.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT state FROM admin_operations WHERE id=$1",
          [x.op.id],
        )
      ).rows[0].state,
      "pending_approval",
    );
  } finally {
    await owner.query(
      "DROP TRIGGER provider_test_fail_audit ON audit_log; DROP FUNCTION provider_test_fail_audit()",
    );
    await owner.end();
  }
  ok(await decision(x.op), 202);
});
test("provider approval replay retains one result and reauthorizes a revoked reviewer", async () => {
  const f = await fixture(),
    id = await registerEvidence(f),
    x = await submit(requestCommand(f.row, id)),
    who = await admin(),
    approval = ok(
      await call(who, "GET", `/v1/admin/operations/${x.op.id}/approval`),
    );
  const body = {
      expected_version: approval.version,
      payload_hash: approval.payload_hash,
      decision: "approve",
      reason: "Stable exact provider decision replay",
    },
    headers = { "idempotency-key": randomUUID() },
    url = `/v1/admin/approvals/${approval.id}/decisions`;
  const first = ok(await call(who, "POST", url, body, headers), 202),
    second = ok(await call(who, "POST", url, body, headers), 202);
  assert.deepEqual(second, first);
  await s.db.control.query(
    "UPDATE admin_principals SET auth_version=auth_version+1 WHERE id=$1",
    [who.id],
  );
  assert.equal((await call(who, "POST", url, body, headers)).status, 401);
});
test("provider scoped explicit deny blocks global evidence actions and entire-task settlement reads", async () => {
  const f = await fixture(),
    who = await admin(),
    role = "provider-deny-" + randomUUID();
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(["admin.ai.cost.read", "admin.ai.evidence.write"])],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",
    [who.id, role, f.project],
  );
  assert.equal(
    (
      await call(
        who,
        "POST",
        `${root}/requests/generation/${f.row.id}/evidence`,
        {
          document: evidence(f.row),
          reason: "Denied project must stay denied",
        },
      )
    ).status,
    403,
  );
  assert.equal(
    (await call(who, "GET", `${root}/tasks/${f.task.id}/settlement`)).status,
    403,
  );
  const detail = ok(
    await call(who, "GET", `${root}/requests/generation/${f.row.id}`),
  );
  assert.equal(detail.cost, undefined);
});
test("provider preview binds exact payload, is consumed once, and operation replay is stable", async () => {
  const f = await fixture(),
    id = await registerEvidence(f),
    command = requestCommand(f.row, id),
    p = ok(await call(a, "POST", root + "/previews", command));
  assert.equal(
    (
      await call(a, "POST", root + "/operations", {
        command: { ...command, reason: "Changed after frozen preview" },
        preview_id: p.preview_id,
      })
    ).status,
    409,
  );
  const body = { command, preview_id: p.preview_id },
    headers = { "idempotency-key": randomUUID() },
    one = ok(await call(a, "POST", root + "/operations", body, headers), 202);
  assert.deepEqual(
    ok(await call(a, "POST", root + "/operations", body, headers), 202),
    one,
  );
  assert.equal((await call(a, "POST", root + "/operations", body)).status, 409);
});
test("provider new control tables and internal request view reject application-role access", async () => {
  for (const table of [
    "ai_provider_policy_drafts",
    "ai_provider_admin_publications",
    "ai_provider_admin_heads",
    "ai_provider_evidence",
    "ai_provider_cost_confirmations",
    "ai_provider_termination_confirmations",
    "ai_provider_task_settlements",
    "current_ai_provider_requests",
  ])
    await assert.rejects(
      s.db.app.query("SELECT * FROM " + table),
      (e) => (e as any).code === "42501",
    );
});
test("provider observed over-budget fees persist without expanding or charging the original reservation", async () => {
  const f = await fixture(),
    d = evidence(f.row, {
      kind: "text",
      input_tokens: 100,
      output_tokens: 1000001,
    }),
    id = await registerEvidence(f, d),
    x = await submit(requestCommand(f.row, id));
  ok(await decision(x.op), 202);
  const facts = ok(
    await call(a, "GET", `${root}/tasks/${f.task.id}/settlement`),
  );
  assert.equal(facts.violations.length, 1);
  const command = {
    action: "ai.tasks.settle",
    task_id: f.task.id,
    expected_task_version: facts.task.version,
    acknowledge_violation_ids: facts.violations.map((v: any) => v.id),
    reason: "Over-budget cost remains unresolved",
  };
  const response = await call(a, "POST", root + "/previews", command);
  assert.equal(response.status, 409);
  assert.equal(response.data.error.code, "RESERVATION_EXCEEDED");
  const reservation = (
    await s.db.control.query(
      "SELECT status,amount_micros FROM reservations WHERE task_id=$1",
      [f.task.id],
    )
  ).rows[0];
  assert.equal(reservation.status, "reconciling");
  assert.equal(reservation.amount_micros, "1000000");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [f.task.id],
      )
    ).rows[0].n,
    0,
  );
});
test("provider in-budget violations require explicit exact acknowledgement and remain immutable after settlement", async () => {
  const f = await fixture(),
    d = evidence(f.row, { kind: "text", input_tokens: 100, output_tokens: 33 }),
    id = await registerEvidence(f, d);
  ok(await decision((await submit(requestCommand(f.row, id))).op), 202);
  const facts = ok(
    await call(a, "GET", `${root}/tasks/${f.task.id}/settlement`),
  );
  assert.equal(facts.violations[0].code, "OUTPUT_LIMIT_EXCEEDED");
  const command = {
    action: "ai.tasks.settle",
    task_id: f.task.id,
    expected_task_version: facts.task.version,
    acknowledge_violation_ids: [],
    reason: "Explicitly review the original budget violation",
  };
  assert.equal(
    (await call(a, "POST", root + "/previews", command)).status,
    409,
  );
  const x = await submit({
    ...command,
    acknowledge_violation_ids: facts.violations.map((v: any) => v.id),
  });
  ok(await decision(x.op), 202);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ai_request_budget_violations x JOIN ai_gateway_requests r ON r.id=x.provider_request_id WHERE r.task_id=$1",
        [f.task.id],
      )
    ).rows[0].n,
    1,
  );
});
test("provider explicit zero-usage image evidence releases the hold without creating a zero charge", async () => {
  const f = await fixture({ image: true }),
    d = {
      ...evidence(f.row, { kind: "image", image_units: 0 }),
      outcome: "not_executed",
    },
    id = await registerEvidence(f, d);
  ok(await decision((await submit(requestCommand(f.row, id))).op), 202);
  const facts = ok(
      await call(a, "GET", `${root}/tasks/${f.task.id}/settlement`),
    ),
    x = await submit({
      action: "ai.tasks.settle",
      task_id: f.task.id,
      expected_task_version: facts.task.version,
      acknowledge_violation_ids: [],
      reason: "Confirmed not-executed image with explicit zero usage",
    });
  ok(await decision(x.op), 202);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].status,
    "released",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [f.task.id],
      )
    ).rows[0].n,
    0,
  );
});
test("provider same-day budget raises preserve the original boundary and reductions constrain new dispatch", async () => {
  const initial = ok(await call(a, "GET", root + "/policy")),
    old = initial.periods.find((p: any) => p.purpose === "input_count");
  assert.ok(old);
  const higher = await definition();
  higher.budget.counting_daily_micros = 20000000;
  await publish(higher);
  let current = ok(await call(a, "GET", root + "/policy"));
  assert.equal(
    current.periods.find((p: any) => p.purpose === "input_count").amount_micros,
    old.amount_micros,
  );
  assert.equal(current.budget.counting_daily_micros, "20000000");
  const lower = await definition();
  lower.budget.counting_daily_micros = 1;
  await publish(lower);
  await assert.rejects(
    fixture({ countOnly: true }),
    (e: any) => e.code === "PLATFORM_BUDGET_EXHAUSTED",
  );
  current = ok(await call(a, "GET", root + "/policy"));
  assert.equal(
    current.periods.find((p: any) => p.purpose === "input_count").id,
    old.id,
  );
  await publish(await definition());
});
