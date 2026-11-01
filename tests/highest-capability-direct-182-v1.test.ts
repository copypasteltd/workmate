import { seedProviderBudgetPolicy } from "../src/provider-budgets.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createServer } from "node:http";
import { crc32, deflateSync } from "node:zlib";
import { PNG } from "pngjs";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/capability-schemas.json" with { type: "json" };
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { runMigrations } from "../scripts/migration-runner.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, canonical, hash } from "../src/lib.js";
import { taskCapabilities } from "../src/capability-bindings.js";
import { Catalog } from "../src/catalog.js";
import {
  purgeCapabilityWorkspaces,
  queueCapabilityWorkspacePurge,
} from "../src/capability-workspace-cleanup.js";
import { removeOwnedUUIDDirectory } from "../src/owned-directory-cleanup.js";
import { validateVerificationPNG } from "../src/png-validation.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import { CodexRuntimeAdapter, type RuntimeContext } from "../src/runtime.js";
import { Worker } from "../src/worker.js";
import { installIsolatedProviderPolicy } from "./provider-policy-fixture.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin: boolean };
const ajv = new Ajv2020({ allErrors: true });
createRequire(import.meta.url)("ajv-formats")(ajv);
const defs = JSON.parse(
  JSON.stringify(contract.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
function check(name: string, value: unknown) {
  const validator = ajv.compile({ $defs: defs, $ref: "#/$defs/" + name });
  assert.ok(validator(value), JSON.stringify(validator.errors));
}
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
  const data = raw.json();
  if (
    raw.statusCode === 202 &&
    url.startsWith("/v1/admin/capability-releases") &&
    (url.endsWith("/drafts") || /\/(publications|rollbacks)$/.test(url))
  )
    check("AdminOperation", data);
  return { status: raw.statusCode, data, raw };
}
async function login(email: string, secret?: OTPAuth.Secret): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  const ch = await call(undefined, "POST", prefix + "/challenge", { email });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: ch.data.challenge_id,
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
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie = r.raw.cookies.find(
    (c) => c.name === (secret ? "cp_admin_session" : "cp_session"),
  )!;
  return {
    id: r.data.user?.id ?? r.data.admin?.id,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: r.data.csrf_token,
    admin: !!secret,
  };
}
async function administrator(
  options: {
    permissions?: string[];
    scope?: "global" | "tenant" | "project";
    id?: string;
  } = {},
) {
  const secret = new OTPAuth.Secret({ size: 20 }),
    email = randomUUID() + "@example.invalid";
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Plan operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  let role = "super_admin";
  if (options.permissions) {
    role = "plan-" + randomUUID();
    await s.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
      [role, JSON.stringify(options.permissions)],
    );
  }
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, options.scope ?? "global", options.id ?? null],
  );
  return { ...(await login(email, secret)), id: p.id };
}

const root = "/v1/admin/capability-releases";
let price = 1200000;
const document = () => ({
  profile_key: "internal-text-v1",
  kernel: "codex",
  gateway_policy: "company_internal_only",
  model_alias: "copypaste-demo",
  reasoning_effort: "medium",
  rates: [++price, ++price],
});
const command = (v: any) => ({
  expected_version: v.version,
  reason: "Independent model capability review",
});
async function draft(a: Client, doc: any = document(), k = randomUUID()) {
  const b = { document: doc, reason: "Controlled capability document" };
  const r = await call(a, "POST", root + "/drafts", b, {
    "idempotency-key": k,
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "succeeded");
  const detail = await call(a, "GET", root + "/" + r.data.result_ids[0]);
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  return { v: detail.data, op: r.data, b, k };
}
async function validate(a: Client, v: any, k = randomUUID()) {
  const r = await call(a, "POST", `${root}/${v.id}/validations`, command(v), {
    "idempotency-key": k,
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  return r.data;
}
async function preview(a: Client, v: any, rollback = false) {
  const b = command(v),
    suffix = rollback ? "rollbacks" : "publications";
  const r = await call(a, "POST", `${root}/${v.id}/${suffix}-previews`, b);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(["independent_approval","super_admin_direct"].includes(r.data.decision));
  assert.equal(r.data.creates_business_effect, false);
  return { b, p: r.data, suffix };
}
async function submit(
  a: Client,
  v: any,
  p: Awaited<ReturnType<typeof preview>>,
) {
  const r = await call(a, "POST", `${root}/${v.id}/${p.suffix}`, p.b, {
    "x-admin-preview-id": p.p.preview_id,
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.ok(["pending_approval","succeeded"].includes(r.data.state));
  return r.data;
}
async function approve(
  a: Client,
  op: any,
  decision: "approve" | "reject" = "approve",
) {
  const r = await call(a, "GET", `/v1/admin/operations/${op.id}/approval`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return call(a, "POST", `/v1/admin/approvals/${r.data.id}/decisions`, {
    expected_version: r.data.version,
    payload_hash: r.data.payload_hash,
    decision,
    reason: "Independent capability review",
  });
}
async function publish(a: Client, reviewer: Client, v: any, rollback = false) {
  const op = await submit(a, v, await preview(a, v, rollback));
  const r = await approve(reviewer, op);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "succeeded");
  return op;
}
async function fixture() {
  const owner = await login(randomUUID() + "@example.invalid");
  const r = await call(owner, "POST", "/v1/tenants", {
    name: "Capability customer",
    project_name: "Version confirmation",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const tenant = r.data.tenant.id,
    project = r.data.project.id;
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [tenant],
  );
  return {
    owner,
    tenant,
    project,
    headers: { "x-tenant-id": tenant },
    base: `/v1/tenants/${tenant}/projects/${project}`,
  };
}
async function task(f: Awaited<ReturnType<typeof fixture>>) {
  const r = await call(f.owner, "POST", f.base + "/tasks", {
    title: "Frozen capability",
    prompt: "Keep the confirmed model and price",
    role_key: "marketing-analyst",
    budget_micros: 1000000,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [r.data.id])
  ).rows[0];
}
async function binding(t: any) {
  return s.db.tx(
    (tx) => taskCapabilities(tx, s.db.config, s.catalog, t),
    undefined,
    true,
  );
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  const configuredCodex = isolated.env.CODEX_BIN ?? "codex";
  const pinnedCodex = path.isAbsolute(configuredCodex)
    ? configuredCodex
    : execFileSync(
        process.platform === "win32" ? "where.exe" : "which",
        [configuredCodex],
        { encoding: "utf8", windowsHide: true },
      )
        .split(/\r?\n/)
        .find((p) => path.isAbsolute(p.trim()))!
        .trim();
  assert.ok(path.isAbsolute(pinnedCodex));
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      CODEX_BIN: pinnedCodex,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "true",
      AI_VERIFICATION_PER_RUN_BUDGET_MICROS: "100000000",
      AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS: "1000000000000",
    }),
    { worker: false },
  );
  await installIsolatedProviderPolicy(s.db);
});
after(async () => {
  if (s) await s.app.close();
  if (isolated) await isolated.cleanup();
});


test("highest administrator publishes and rolls back qualified model without a pending independent request",async()=>{
 const a=await administrator(),d=await draft(a),v=await validate(a,d.v);assert.equal(v.state,"passed",JSON.stringify(v));
 const p=await preview(a,d.v);assert.equal(p.p.decision,"super_admin_direct");const op=await submit(a,d.v,p);assert.equal(op.state,"succeeded");
 assert.equal((await call(a,"GET",root+"/"+d.v.id)).data.state,"published");
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM admin_approval_requests WHERE operation_id=$1",[op.id])).rows[0].n,0);
 const d2=await draft(a);assert.equal((await validate(a,d2.v)).state,"passed");assert.equal((await submit(a,d2.v,await preview(a,d2.v))).state,"succeeded");
 const rollback=await submit(a,d.v,await preview(a,d.v,true));assert.equal(rollback.state,"succeeded");
 const facts=(await s.db.control.query("SELECT * FROM audit_log WHERE action='admin.execution.direct' AND target=ANY($1::text[])",[[op.id,rollback.id]])).rows;
 assert.equal(facts.length,2);assert.ok(facts.every(row=>row.principal_id===a.id && row.detail.execution_mode==='super_admin_direct'));
});
test("ordinary model publisher retains independent approval despite possessing the same permission list",async()=>{
 const permissions=(await s.db.control.query("SELECT permissions FROM admin_roles WHERE key='super_admin'")).rows[0].permissions,a=await administrator({permissions}),reviewer=await administrator(),d=await draft(a);
 assert.equal((await validate(a,d.v)).state,"passed");const p=await preview(a,d.v);assert.equal(p.p.decision,"independent_approval");
 const op=await submit(a,d.v,p);assert.equal(op.state,"pending_approval");assert.equal((await approve(a,op)).status,403);
 const r=await approve(reviewer,op);assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.state,"succeeded");
});
