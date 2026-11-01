import {
  createApprovalRequest,
  expireAdminApprovals,
} from "../src/admin-approval-storage.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/admin-approval-schemas.json" with { type: "json" };
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, canonical, hash } from "../src/lib.js";
import {
  billingAccount,
  fund,
  reserve,
  settle,
  setBillingAccountLimit,
} from "../src/billing.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = {
  id: string;
  email: string;
  cookie: string;
  csrf: string;
  admin?: boolean;
};
const ajv = new Ajv2020({ allErrors: true });
createRequire(import.meta.url)("ajv-formats")(ajv);
const defs = JSON.parse(
  JSON.stringify(contract.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
function schema(name: string, value: unknown) {
  const check = ajv.compile({ $defs: defs, $ref: "#/$defs/" + name });
  assert.ok(check(value), JSON.stringify(check.errors));
}
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  options: { key?: string | null; headers?: Record<string, string> } = {},
) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(options.key === null
        ? {}
        : { "idempotency-key": options.key ?? randomUUID() }),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function signIn(
  address: string,
  secret?: OTPAuth.Secret,
): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  await s.db.control.query(
    "UPDATE auth_challenges SET created_at=now()-interval '2 minutes' WHERE email=$1",
    [address],
  );
  const ch = await call(undefined, "POST", prefix + "/challenge", {
    email: address,
  });
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
  const cookie =
    r.raw.cookies.find(
      (c) => c.name === (secret ? "cp_admin_session" : "cp_session"),
    ) ?? r.raw.cookies[0];
  return {
    id: r.data.user?.id ?? r.data.admin?.id,
    email: address,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: r.data.csrf_token,
    admin: !!secret,
  };
}
async function user() {
  return signIn(`admin-directory-${randomUUID()}@example.invalid`);
}
async function admin(tenant?: string, role = "user_operator") {
  const email = `admin-directory-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Membership operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, tenant ? "tenant" : "global", tenant ?? null],
  );
  return { ...(await signIn(email, secret)), id: p.id, secret };
}
async function workspace(o: Client) {
  const r = await call(o, "POST", "/v1/tenants", {
    name: "Admin membership authority",
    project_name: "Campaign",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return {
    ...r.data,
    base: `/v1/admin/tenants/${r.data.tenant.id}/memberships`,
  };
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      AI_BASE_URL: "http://127.0.0.1:9/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "controlled-fixture",
      AI_MODEL: "controlled-fixture",
      AI_VERIFIED: "true",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
      DEMO_MODE: "false",
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

async function bind(
  a: Client,
  permissions: string[],
  kind = "global",
  target: string | null = null,
  effect = "allow",
) {
  const role = "directory_" + randomUUID().replaceAll("-", "");
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(permissions)],
  );
  return s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,$3,$4,$5)",
    [a.id, role, kind, target, effect],
  );
}

async function request(op: string) {
  const r = (
    await s.db.control.query(
      "SELECT * FROM admin_approval_requests WHERE operation_id=$1",
      [op],
    )
  ).rows[0];
  assert.ok(r);
  return r;
}
async function pending(a: Client, w: any, recipient: Client) {
  const r = await call(a, "POST", w.base, {
    expected_version: 1,
    reason: "Independent controlled membership review",
    user_id: recipient.id,
    state: "active",
    role: "admin",
    project_ids: [w.project.id],
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "pending_approval");
  return r.data;
}
async function decide(a: Client, op: any, overrides: any = {}, key?: string) {
  const r = await request(op.id);
  return call(
    a,
    "POST",
    `/v1/admin/approvals/${r.id}/decisions`,
    {
      expected_version: r.version,
      payload_hash: r.payload_hash,
      decision: "approve",
      reason: "Independently checked frozen request",
      ...overrides,
    },
    { key },
  );
}
async function fixture() {
  const owner = await user(),
    w = await workspace(owner),
    a = await admin(w.tenant.id, "super_admin"),
    reviewer = await admin(w.tenant.id, "super_admin"),
    recipient = await user();
  return {
    owner,
    w,
    a,
    reviewer,
    recipient,
    op: await pending(a, w, recipient),
  };
}

async function membership(a:Client,w:any,recipient:Client,key=randomUUID()) {
 return call(a,"POST",w.base,{expected_version:1,reason:"Highest admin policy acceptance",user_id:recipient.id,state:"active",role:"admin",project_ids:[w.project.id]},{key});
}
test("global highest administrator executes a protected membership directly, audits and replays exactly once",async()=>{
 const a=await admin(undefined,"super_admin"),w=await workspace(await user()),recipient=await user(),key=randomUUID();
 assert.equal((await call(a,"GET","/v1/admin/me")).data.highest_admin,true);
 const r=await membership(a,w,recipient,key);assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.state,"succeeded");
 const op=(await s.db.control.query("SELECT * FROM admin_operations WHERE id=$1",[r.data.id])).rows[0];assert.equal(op.execution_mode,"super_admin_direct");
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM admin_approval_requests WHERE operation_id=$1",[op.id])).rows[0].n,0);
 const facts=(await s.db.control.query("SELECT * FROM audit_log WHERE action='admin.execution.direct' AND target=$1",[op.id])).rows;
 assert.equal(facts.length,1);assert.equal(facts[0].principal_id,a.id);assert.equal(facts[0].detail.execution_mode,"super_admin_direct");assert.equal(facts[0].detail.reason,"Highest admin policy acceptance");
 assert.equal((await membership(a,w,recipient,key)).data.id,r.data.id);
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audit_log WHERE action='admin.execution.direct' AND target=$1",[op.id])).rows[0].n,1);
});
test("tenant-scoped super role retains independent review and cannot approve itself",async()=>{
 const f=await fixture();assert.equal((await call(f.a,"GET","/v1/admin/me")).data.highest_admin,false);
 assert.equal((await decide(f.a,f.op)).status,403);
 const r=await decide(f.reviewer,f.op);assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.state,"succeeded");
 const d=(await s.db.control.query("SELECT * FROM admin_approval_decisions WHERE approval_id=$1",[(await request(f.op.id)).id])).rows[0];
 assert.equal(d.execution_mode,"independent_review");assert.notEqual(d.reviewer_id,f.a.id);
});
test("a copied global permission list does not become the highest role",async()=>{
 const a=await admin(),perms=(await s.db.control.query("SELECT permissions FROM admin_roles WHERE key='super_admin'")).rows[0].permissions;
 await bind(a,perms);const w=await workspace(await user()),r=await membership(a,w,await user());
 assert.equal((await call(a,"GET","/v1/admin/me")).data.highest_admin,false);
 assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.state,"pending_approval");assert.equal((await decide(a,r.data)).status,403);
});
test("highest administrator can execute its existing pending request without inventing a second reviewer",async()=>{
 const f=await fixture();await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",[f.a.id]);
 const review=await call(f.a,"GET",`/v1/admin/approvals/${(await request(f.op.id)).id}/review`);assert.equal(review.data.can_direct_execute,true);
 const r=await decide(f.a,f.op,{reason:"Highest administrator executes original frozen request"});assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.state,"succeeded");
 const d=(await s.db.control.query("SELECT * FROM admin_approval_decisions WHERE approval_id=$1",[(await request(f.op.id)).id])).rows[0];assert.equal(d.reviewer_id,f.a.id);assert.equal(d.execution_mode,"super_admin_direct");
 assert.equal((await s.db.control.query("SELECT execution_mode FROM admin_operations WHERE id=$1",[f.op.id])).rows[0].execution_mode,"super_admin_direct");
});
test("direct execution still enforces explicit denies, MFA and current role expiry",async()=>{
 const a=await admin(undefined,"super_admin"),w=await workspace(await user());await bind(a,["admin.tenants.members.write"],"tenant",w.tenant.id,"deny");
 assert.equal((await membership(a,w,await user())).status,403);
 const b=await admin(undefined,"super_admin");await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",[b.id]);
 const r=await membership(b,w,await user());assert.equal(r.status,403,JSON.stringify(r.data));
 await s.db.control.query("UPDATE admin_bindings SET expires_at=now()-interval '1 second' WHERE principal_id=$1",[b.id]);
 assert.equal((await call(b,"GET","/v1/admin/me")).data.highest_admin,false);
});
test("pending request hash/version remain frozen even for highest administrator",async()=>{
 const f=await fixture();await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",[f.a.id]);
 const r=await decide(f.a,f.op,{payload_hash:"0".repeat(64)});assert.equal(r.status,409,JSON.stringify(r.data));assert.equal((await request(f.op.id)).state,"pending");
});
test("a direct audit failure rolls back the business effect and operation",async()=>{
 const a=await admin(undefined,"super_admin"),w=await workspace(await user()),recipient=await user();
 await s.db.control.query("CREATE FUNCTION reject_direct_audit_182() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admin.execution.direct' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_direct_audit_182 BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_direct_audit_182()");
 try {const r=await membership(a,w,recipient);assert.equal(r.status,500,JSON.stringify(r.data));
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM memberships WHERE tenant_id=$1 AND user_id=$2",[w.tenant.id,recipient.id])).rows[0].n,0);
 }finally{await s.db.control.query("DROP TRIGGER reject_direct_audit_182 ON audit_log; DROP FUNCTION reject_direct_audit_182()");}
});
test("application credentials cannot forge highest execution context or approval attribution",async()=>{
 const app=new pg.Client({connectionString:s.db.config.DATABASE_URL});await app.connect();try{await assert.rejects(app.query("SELECT admin_is_highest(gen_random_uuid(),1)"),/permission denied/);await assert.rejects(app.query("SELECT admin_direct_context_valid()"),/permission denied/);}finally{await app.end();}
 const r=await s.db.tx(async tx=>{await tx.query("SELECT set_config('app.admin_direct_context','not-json',true)");return tx.query("SELECT admin_direct_context_valid() AS allowed");},undefined,true);assert.equal(r.rows[0].allowed,false);
});
