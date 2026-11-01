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
async function preview(c: Client, body: any) {
  return call(c,"POST","/v1/admin/directory/preview",body);
}
async function commit(c: Client, p: any, key?: string) {
  return call(c,"POST","/v1/admin/directory/commands",{preview_id:p.id,payload_hash:p.payload_hash},{key});
}
async function command(c: Client, body: any) {
  const p=await preview(c,body);assert.equal(p.status,200,JSON.stringify(p.data));
  return commit(c,p.data);
}
const why="Controlled directory lifecycle verification";
async function add(a: Client, label="Directory fixture") {
  const address=`directory-184-${randomUUID()}@example.invalid`;
  const r=await command(a,{action:"users.create",email:address,display_name:label,reason:why});
  assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.state,"succeeded");
  return {...r.data.result.items[0],email:address};
}
const target=(u:any)=>({id:u.id,version:u.version});

test("highest creates an ordinary OTP account with provenance, audit and exactly-once replay",async()=>{
 const a=await admin(undefined,"super_admin"),address=`directory-184-${randomUUID()}@example.invalid`;
 const p=await preview(a,{action:"users.create",email:address,display_name:"Created account",reason:why});
 assert.equal(p.status,200,JSON.stringify(p.data));assert.equal(p.data.approval,false);
 const k=randomUUID(),r=await commit(a,p.data,k),again=await commit(a,p.data,k);
 assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(again.data.id,r.data.id);assert.equal(r.data.state,"succeeded");
 const u=(await s.db.control.query("SELECT * FROM users WHERE email=$1",[address])).rows[0];
 assert.equal(u.registration_source,"admin");assert.equal(u.last_login_at,null);
 assert.equal((await s.db.control.query("SELECT 1 FROM sessions WHERE user_id=$1",[u.id])).rowCount,0);
 assert.equal((await s.db.control.query("SELECT 1 FROM admin_principals WHERE email=$1",[address])).rowCount,0);
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audit_events WHERE action='admin.execution.direct' AND target=$1",[r.data.id])).rows[0].n,1);
 assert.equal((await preview(a,{action:"users.create",email:address,display_name:"Duplicate",reason:why})).data.error.code,"EMAIL_ALREADY_EXISTS");
});
test("workspace creation atomically provides owner, wallet and first project",async()=>{
 const a=await admin(undefined,"super_admin"),o=await add(a);
 const r=await command(a,{action:"tenants.create",name:"Created workspace",owner_id:o.id,project_name:"First campaign",reason:why});
 assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.state,"succeeded");
 const item=r.data.result.items[0];
 const m=(await s.db.control.query("SELECT * FROM memberships WHERE tenant_id=$1 AND user_id=$2",[item.id,o.id])).rows[0];assert.equal(m.role,"owner");
 assert.ok((await s.db.control.query("SELECT 1 FROM wallets WHERE id=$1 AND tenant_id=$2",[item.billing_account_id,item.id])).rowCount);
 assert.ok((await s.db.control.query("SELECT 1 FROM projects WHERE id=$1 AND tenant_id=$2",[item.project_id,item.id])).rowCount);
});
test("both directory lists support an atomic selected status change and reject stale versions",async()=>{
 const a=await admin(undefined,"super_admin"),u=await add(a),v=await add(a);
 const body={action:"users.status",targets:[target(u),target(v)],state:"frozen",reason:why};
 const p=await preview(a,body);assert.equal(p.status,200,JSON.stringify(p.data));
 await s.db.control.query("UPDATE users SET version=version+1 WHERE id=$1",[v.id]);
 assert.equal((await commit(a,p.data)).data.error.code,"PREVIEW_CHANGED");
 assert.equal((await s.db.control.query("SELECT status FROM users WHERE id=$1",[u.id])).rows[0].status,"active");
 const fresh=await command(a,{...body,targets:[target(u),{id:v.id,version:v.version+1}]});assert.equal(fresh.data.state,"succeeded");
 const owner=await user(),w=await workspace(owner);
 const r=await command(a,{action:"tenants.status",targets:[{id:w.tenant.id,version:w.tenant.version}],state:"suspended",reason:why});
 assert.equal(r.status,202,JSON.stringify(r.data));assert.equal((await s.db.control.query("SELECT status FROM tenants WHERE id=$1",[w.tenant.id])).rows[0].status,"suspended");
});
test("account deletion scrubs profile, revokes credentials, hides the account and permits a new OTP identity",async()=>{
 const a=await admin(undefined,"super_admin"),u=await user();
 const row=(await s.db.control.query("SELECT * FROM users WHERE id=$1",[u.id])).rows[0];
 const r=await command(a,{action:"users.delete",targets:[target(row)],reason:why,acknowledge_retention:true});
 assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.result.items[0].state,"deleted");
 const after=(await s.db.control.query("SELECT * FROM users WHERE id=$1",[u.id])).rows[0];
 assert.ok(after.deleted_at);assert.equal(after.name,"[deleted]");assert.notEqual(after.email,row.email);assert.equal(after.status,"suspended");
 assert.equal((await call(u,"GET","/v1/me")).status,401);
 const listing=await call(a,"GET","/v1/admin/users?view=operations&limit=100");assert.equal(listing.status,200);assert.ok(!listing.data.items.some((x:any)=>x.id===u.id));
 const fresh=await signIn(row.email);assert.notEqual(fresh.id,u.id);
 await assert.rejects(s.db.control.query("UPDATE users SET status='active' WHERE id=$1",[u.id]));
});
test("bulk deletion protects last ownership across the complete selection and never deletes shared content",async()=>{
 const a=await admin(undefined,"super_admin"),o=await user(),co=await user(),w=await workspace(o);
 await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",[w.tenant.id,co.id]);
 const rows=(await s.db.control.query("SELECT id,version FROM users WHERE id=ANY($1::uuid[])",[[o.id,co.id]])).rows;
 const blocked=await preview(a,{action:"users.delete",targets:rows,reason:why,acknowledge_retention:true});
 assert.equal(blocked.data.error.code,"OWNER_TRANSFER_REQUIRED");
 const r=await command(a,{action:"users.delete",targets:[rows.find(x=>x.id===o.id)],reason:why,acknowledge_retention:true});assert.equal(r.status,202,JSON.stringify(r.data));
 assert.ok((await s.db.control.query("SELECT 1 FROM projects WHERE id=$1 AND NOT archived",[w.project.id])).rowCount);
 assert.equal((await s.db.control.query("SELECT status FROM users WHERE id=$1",[co.id])).rows[0].status,"active");
});
test("enterprise deletion accepts durable cleanup and preserves global user and billing identities",async()=>{
 const a=await admin(undefined,"super_admin"),o=await user(),w=await workspace(o);
 const r=await command(a,{action:"tenants.delete",targets:[target(w.tenant)],reason:why,acknowledge_retention:true});
 assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.result.items[0].state,"deleting");
 const item=r.data.result.items[0],job=(await s.db.control.query("SELECT * FROM deletion_jobs WHERE id=$1",[item.deletion_job_id])).rows[0];
 assert.equal(job.target_type,"tenants");assert.equal(job.target_id,w.tenant.id);
 assert.equal((await s.db.control.query("SELECT status FROM users WHERE id=$1",[o.id])).rows[0].status,"active");
 assert.ok((await s.db.control.query("SELECT 1 FROM wallets WHERE tenant_id=$1",[w.tenant.id])).rowCount);
 const list=await call(a,"GET","/v1/admin/tenants?limit=100");assert.ok(!list.data.items.some((x:any)=>x.id===w.tenant.id));
 const active=await preview(a,{action:"tenants.status",targets:[{id:w.tenant.id,version:item.version}],state:"active",reason:why});assert.equal(active.data.error.code,"ACCOUNT_DELETED");
});
test("explicit new permissions, scope denies, batch bounds and fresh MFA remain mandatory",async()=>{
 const highest=await admin(undefined,"super_admin"),limited=await admin(),u=await add(highest);
 assert.equal((await preview(limited,{action:"users.create",email:`x-${randomUUID()}@example.invalid`,display_name:"Forbidden",reason:why})).status,403);
 const invalid=await preview(highest,{action:"users.delete",targets:Array.from({length:101},()=>({id:randomUUID(),version:1})),reason:why,acknowledge_retention:true});assert.equal(invalid.status,400);
 const duplicate=await preview(highest,{action:"users.status",targets:[target(u),target(u)],state:"active",reason:why});assert.equal(duplicate.status,400);
 const own=await user(),w=await workspace(own);await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",[w.tenant.id,u.id]);
 await bind(highest,["admin.users.delete"],"tenant",w.tenant.id,"deny");
 assert.equal((await preview(highest,{action:"users.delete",targets:[target(u)],reason:why,acknowledge_retention:true})).status,403);
 const staleAdmin=await admin(undefined,"super_admin");await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",[staleAdmin.id]);
 assert.equal((await preview(staleAdmin,{action:"users.create",email:`x-${randomUUID()}@example.invalid`,display_name:"Expired MFA",reason:why})).data.error.code,"MFA_REQUIRED");
});
test("ordinary role follows independent review and rechecks frozen targets and actor permissions",async()=>{
 const highest=await admin(undefined,"super_admin"),operator=await admin(),u=await add(highest);
 await bind(operator,["admin.users.delete","admin.approvals.read","admin.approvals.decide","admin.users.read","admin.tenants.read"]);
 const r=await command(operator,{action:"users.delete",targets:[target(u)],reason:why,acknowledge_retention:true});
 assert.equal(r.status,202,JSON.stringify(r.data));assert.equal(r.data.state,"pending_approval");
 assert.equal((await decide(operator,r.data)).data.error.code,"SELF_APPROVAL_FORBIDDEN");
 const review=await call(highest,"GET","/v1/admin/approvals/"+(await request(r.data.id)).id+"/review");assert.equal(review.status,200,JSON.stringify(review.data));
 assert.equal(review.data.command.action,"users.delete");
 const accepted=await decide(highest,r.data);assert.equal(accepted.status,202,JSON.stringify(accepted.data));assert.equal(accepted.data.state,"succeeded");
 assert.ok((await s.db.control.query("SELECT deleted_at FROM users WHERE id=$1",[u.id])).rows[0].deleted_at);
});
test("audit failure rolls back every selected deletion and the consumed preview",async()=>{
 const a=await admin(undefined,"super_admin"),u=await add(a),v=await add(a);
 const p=await preview(a,{action:"users.delete",targets:[target(u),target(v)],reason:why,acknowledge_retention:true});assert.equal(p.status,200);
 const owner=new pg.Client({connectionString:isolated.env.OWNER_DATABASE_URL});await owner.connect();
 try{
  await owner.query("CREATE FUNCTION directory_audit_failure_184() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admin.users.delete' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END $$");
  await owner.query("CREATE TRIGGER directory_audit_failure_184 BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION directory_audit_failure_184()");
  assert.equal((await commit(a,p.data)).status,500);
  const rows=(await s.db.control.query("SELECT deleted_at,status FROM users WHERE id=ANY($1::uuid[])",[[u.id,v.id]])).rows;
  assert.ok(rows.every(r=>r.deleted_at===null&&r.status==='active'));
  assert.equal((await s.db.control.query("SELECT consumed_at FROM admin_previews WHERE id=$1",[p.data.id])).rows[0].consumed_at,null);
 }finally{await owner.query("DROP TRIGGER IF EXISTS directory_audit_failure_184 ON audit_events; DROP FUNCTION IF EXISTS directory_audit_failure_184()");await owner.end();}
});
