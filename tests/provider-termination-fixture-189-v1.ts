import {delegatedAdminFixtureRole} from "./delegated-admin-fixture-188.js";
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
  highest = false,
): Promise<Client> {
  const secret = new OTPAuth.Secret({ size: 20 }),
    email = randomUUID() + "@example.invalid";
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Provider reviewer',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  let role = permissions || highest ? "super_admin" : await delegatedAdminFixtureRole(s.db);
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
  d: any = evidence(f.row),
) {
  const op = ok(
    await call(a, "POST", `${root}/requests/${f.row.channel}/${f.row.id}/evidence`, {
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


export {s,a,reviewer,fixture,evidence,registerEvidence,submit,decision,call,ok,root,admin};
