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

test("highest administrator publishes provider policy immediately with honest direct decision and immutable audit",async()=>{
 const id=await draft(),current=ok(await call(a,"GET",root+"/policy"));
 const x=await submit({action:"ai.policy.publish",draft_id:id,expected_revision:current.revision,reason:"Highest administrator policy execution"});
 assert.equal(x.p.decision,"super_admin_direct");assert.equal(x.op.state,"succeeded",JSON.stringify(x.op));
 const facts=(await s.db.control.query("SELECT * FROM ai_provider_admin_publications WHERE operation_id=$1",[x.op.id])).rows;
 assert.equal(facts.length,1);assert.equal(facts[0].actor_id,a.id);assert.equal(facts[0].reviewer_id,a.id);assert.equal(facts[0].execution_mode,"super_admin_direct");
 const decision=(await s.db.control.query("SELECT d.* FROM admin_approval_decisions d JOIN admin_approval_requests r ON r.id=d.approval_id WHERE r.operation_id=$1",[x.op.id])).rows[0];
 assert.equal(decision.execution_mode,"super_admin_direct");assert.equal(decision.reviewer_id,a.id);
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audit_log WHERE action='admin.execution.direct' AND target=$1",[x.op.id])).rows[0].n,1);
});
test("ordinary provider operator with same permissions still needs a different reviewer",async()=>{
 const perms=(await s.db.control.query("SELECT permissions FROM admin_roles WHERE key='super_admin'")).rows[0].permissions,who=await admin(perms);
 const id=await draft(),current=ok(await call(who,"GET",root+"/policy"));
 const x=await submit({action:"ai.policy.publish",draft_id:id,expected_revision:current.revision,reason:"Ordinary administrator policy review"},who);
 assert.equal(x.p.decision,"independent_approval");assert.equal(x.op.state,"pending_approval");
 assert.equal((await decision(x.op,who)).status,403);
 assert.equal(ok(await decision(x.op),202).state,"succeeded");
});
