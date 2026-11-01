import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { canonical, hash, seal } from "../src/lib.js";
import { capabilityBody } from "../src/capability-verification.js";
import { assertNewModelSelection } from "../src/model-entry-management.js";
import { confirmedAgentCapabilities } from "../src/capability-bindings.js";
import { internalAIRequest } from "../src/internal-ai-gateway.js";
import { normalizedModelURL } from "../src/model-connections.js";
import { modelAddressAllowed } from "../src/model-connection-http.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
type Client = { cookie: string; csrf: string; id: string };
let admin: Client, reader: Client;
const root = "/v1/admin/capability-releases", alias = "gpt-6-luna";
const keyA = "fixture-a-" + randomUUID(), keyB = "fixture-b-" + randomUUID();
const requests: { vendor: string; path: string; key: string }[] = [];
const servers: ReturnType<typeof createServer>[] = [];
let baseA: string, baseB: string, a: any, b: any;
async function vendor(name: string, key: string) {
  const server = createServer(async (req, res) => {
    requests.push({ vendor: name, path: req.url!, key: String(req.headers.authorization) });
    if (req.headers.authorization !== "Bearer " + key) { res.writeHead(401).end(JSON.stringify({ secret: req.headers.authorization })); return; }
    for await (const _ of req) { /* consume the complete request */ }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.method === "GET" ? { data: [{ id: alias }] } : { vendor: name, model: alias }));
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as any).port}/v1`;
}
async function call(client: Client | undefined, method: string, url: string, body?: any, idem?: string) {
  const raw = await s.app.inject({ method: method as any, url, headers: {
    origin: s.db.config.ADMIN_ORIGIN, ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
    ...(body ? { "content-type": "application/json" } : {}), ...(idem ? { "idempotency-key": idem } : {}),
  }, ...(body ? { payload: JSON.stringify(body) } : {}) });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function operator(permissions?: string[]): Promise<Client> {
  const secret = new OTPAuth.Secret({ size: 20 }), email = randomUUID() + "@example.invalid";
  const principal = (await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Model operator',$2) RETURNING id",
    [email, seal(s.db.config.MASTER_KEY!, secret.base32)])).rows[0];
  const role = permissions ? "model-" + randomUUID() : "super_admin";
  if (permissions) await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)", [role, JSON.stringify(permissions)]);
  await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')", [principal.id, role]);
  const challenge = await call(undefined, "POST", "/v1/admin/auth/challenge", { email });
  assert.equal(challenge.status, 200);
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`, "utf8"));
  const login = await call(undefined, "POST", "/v1/admin/auth/verify", { challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0], totp: new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate() });
  assert.equal(login.status, 200);
  const cookie = login.raw.cookies.find(c => c.name === "cp_admin_session")!;
  return { id: principal.id, cookie: `${cookie.name}=${cookie.value}`, csrf: login.data.csrf_token };
}
function draftBody(base: string, key: string) { return {
  document: { profile_key: "internal-text-v1", kernel: "codex", gateway_policy: "company_internal_only", model_alias: alias,
    reasoning_effort: "low", rates: [1000000, 2000000] },
  connection: { base_url: base, api_key: key, allow_private_network: false }, reason: "Configure independently bound model upstream",
}; }
async function draft(base: string, key: string) {
  const response = await call(admin, "POST", root + "/drafts", draftBody(base, key), randomUUID());
  assert.equal(response.status, 202, JSON.stringify(response.data));
  const detail = await call(admin, "GET", root + "/" + response.data.result_ids[0]);
  assert.equal(detail.status, 200); return detail.data;
}
async function probe(release: any, client = admin) {
  return call(client, "POST", `${root}/${release.id}/connection-test`, { expected_version: release.version, reason: "Read upstream model list" });
}
async function version(release: any) {
  const body = capabilityBody(s.db.config, release.document);
  const existing=(await s.db.control.query("SELECT id FROM internal_capability_versions WHERE fingerprint=$1",[hash(canonical(body))])).rows[0];if(existing)return existing.id;
  return (await s.db.control.query("INSERT INTO internal_capability_versions(fingerprint,profile_key,data_mode,body,ready) VALUES($1,$2,$3,$4,true) RETURNING id",
    [hash(canonical(body)), body.profile_key, body.data_mode, body])).rows[0].id;
}

before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false });
  admin = await operator(); reader = await operator(["admin.catalog.read"]);
  baseA = await vendor("a", keyA); baseB = await vendor("b", keyB);
});
after(async () => {
  for (const server of servers) await new Promise<void>(resolve => server.close(() => resolve()));
  if (s) await s.app.close(); if (isolated) await isolated.cleanup();
});


async function editModel(r:any,body:any=draftBody(baseB,keyB),client=admin,idem=randomUUID()){
 return call(client,"POST",`${root}/${r.id}/edits`,{...body,expected_version:r.version,expected_revision:r.management_revision},idem);
}
async function detail(id:string){const out=await call(admin,"GET",root+"/"+id);assert.equal(out.status,200);return out.data;}
async function removeModel(r:any,client=admin,idem=randomUUID()){
 return call(client,"POST",`${root}/${r.id}/deletions`,{expected_version:r.version,expected_revision:r.management_revision,confirm_model:r.document.model_alias,reason:"Remove model for management verification"},idem);
}
async function execute(id:string){return internalAIRequest(s.db.config,{operation:"responses",model:alias,reasoningEffort:"low",tools:[],body:{model:alias,stream:true,input:[{role:"user",content:"Check retained model binding"}],tools:[],reasoning:{effort:"low"}},signal:AbortSignal.timeout(5000),authority:{taskId:randomUUID(),capabilityVersionId:id,authorize:async()=>{}}});}

test("editing a legacy configuration updates the current model entry and preserves its original document",async()=>{
 const legacy:any=draftBody(baseA,keyA);delete legacy.connection;
 const created=await call(admin,"POST",root+"/drafts",legacy,randomUUID());a=await detail(created.data.result_ids[0]);
 assert.equal(a.document.upstream,undefined);assert.equal(a.is_current,true);
 const edited=await editModel(a);assert.equal(edited.status,202,JSON.stringify(edited.data));b=await detail(edited.data.result_ids[0]);
 assert.equal(b.model_id,a.model_id);assert.equal(b.management_revision,2);assert.equal(b.document.upstream.base_url,baseB);
 assert.equal((await detail(a.id)).is_current,false);assert.equal((await detail(a.id)).document.upstream,undefined);
 const listed=await call(admin,"GET",root+"?limit=100");assert.ok(listed.data.items.some((x:any)=>x.id===b.id));assert.ok(!listed.data.items.some((x:any)=>x.id===a.id));
 const history=await call(admin,"GET",root+"?view=history&limit=100");assert.ok(history.data.items.some((x:any)=>x.id===a.id));
 assert.equal((await probe(b)).data.reachable,true);
});
test("saved credentials can be retained while editing rates without retyping a key",async()=>{
 const r=await draft(baseA,keyA),body:any=draftBody(baseA,keyA);body.connection={base_url:baseA,reuse_from_release_id:r.id};body.document.rates=[3000000,4000000];
 const edited=await editModel(r,body);assert.equal(edited.status,202,JSON.stringify(edited.data));const current=await detail(edited.data.result_ids[0]);
 assert.deepEqual(current.document.rates,[3000000,4000000]);assert.equal((await probe(current)).data.reachable,true);assert.equal(current.model_id,r.model_id);
 assert.ok(!JSON.stringify(current).includes(keyA));
});
test("rotating URL and API key routes new configurations to B and keeps original work on A",async()=>{
 const old=await draft(baseA,keyA),oldVersion=await version(old),changed=await editModel(old);assert.equal(changed.status,202);
 const current=await detail(changed.data.result_ids[0]),newVersion=await version(current);
 assert.equal((await(await execute(oldVersion)).json()).vendor,"a");assert.equal((await(await execute(newVersion)).json()).vendor,"b");
 assert.equal((await(await execute(oldVersion)).json()).vendor,"a");
});
test("stale editors and wrong delete confirmations cannot overwrite newer settings",async()=>{
 assert.equal((await editModel(a)).status,409);assert.equal((await removeModel(a)).status,409);
 const bad=await call(admin,"POST",`${root}/${b.id}/deletions`,{expected_version:b.version,expected_revision:b.management_revision,confirm_model:"another-model",reason:"Wrong model confirmation"},randomUUID());assert.equal(bad.status,422);
 const stale=await call(admin,"POST",`${root}/${b.id}/edits`,{...draftBody(baseA,keyA),expected_version:b.version,expected_revision:1},randomUUID());assert.equal(stale.status,409);
 assert.equal((await detail(b.id)).document.upstream.base_url,baseB);
});
test("read-only, unauthenticated and draft-only actors cannot delete models",async()=>{
 assert.equal((await editModel(b,undefined,reader)).status,403);assert.equal((await removeModel(b,reader)).status,403);
 const payload={...draftBody(baseA,keyA),expected_version:b.version,expected_revision:b.management_revision};
 assert.equal((await call(undefined,"POST",`${root}/${b.id}/edits`,payload,randomUUID())).status,401);
 const drafter=await operator(["admin.catalog.read","admin.catalog.draft"]);assert.equal((await removeModel(b,drafter)).status,403);
});
test("edit retry is idempotent and key material never enters replay, operation or audit bodies",async()=>{
 const r=await draft(baseA,keyA),body=draftBody(baseB,keyB),idem=randomUUID();
 const one=await editModel(r,body,admin,idem),two=await editModel(r,body,admin,idem);assert.equal(one.status,202);assert.deepEqual(one.data.result_ids,two.data.result_ids);
 for(const table of ["admin_operations","request_replays","audit_log"]){const rows=(await s.db.control.query(`SELECT * FROM ${table}`)).rows;assert.ok(!JSON.stringify(rows).includes(keyA));assert.ok(!JSON.stringify(rows).includes(keyB));}
});
test("deleting an edited model removes the entire family from availability and retains exact history and keys",async()=>{
 const versionId=await version(b),idem=randomUUID();const one=await removeModel(b,admin,idem),two=await removeModel(b,admin,idem);assert.equal(one.status,202,JSON.stringify(one.data));assert.deepEqual(one.data.result_ids,two.data.result_ids);
 const listed=await call(admin,"GET",root+"?limit=100");assert.ok(!listed.data.items.some((x:any)=>x.model_id===b.model_id));
 const deleted=await call(admin,"GET",root+"?view=deleted&limit=100");assert.ok(deleted.data.items.some((x:any)=>x.id===b.id&&x.state==="deleted"));
 assert.equal((await detail(a.id)).state,"deleted");assert.equal((await detail(b.id)).state,"deleted");
 assert.equal((await(await execute(versionId)).json()).vendor,"b");
 await assert.rejects(s.db.tx(tx=>assertNewModelSelection(tx,[versionId])),(e:any)=>e.code==="MODEL_DELETED");
 for(const action of ["connection-test","validations","publish-previews"]){const x=await call(admin,"POST",`${root}/${b.id}/${action}`,{expected_version:b.version,reason:"Deleted model must remain unavailable"},randomUUID());assert.equal(x.status,409,JSON.stringify(x.data));assert.equal(x.data.code,"MODEL_DELETED");}
});
test("deleted model versions cannot be selected for new agents",async()=>{
 const id=await version(b);await assert.rejects(s.db.tx(tx=>confirmedAgentCapabilities(tx,s.db.config,s.catalog,{capability_version_ids:[id]})),(e:any)=>e.code==="MODEL_DELETED");
});
test("deleting a published default blocks bootstrap fallback and preserves old published inference",async()=>{
 const r=await draft(baseA,keyA),capId=await version(r),validation=randomUUID();
 await s.db.control.query("INSERT INTO capability_validations(id,release_id,principal_id,session_id,idempotency_hash,payload_hash,execution_nonce,state,capability_version_id,result,finished_at,expires_at) VALUES($1,$2,$3,$4,$5,$5,$4,'passed',$6,'{}',now(),now()+interval '1 hour')",[validation,r.id,admin.id,randomUUID(),hash(randomUUID()),capId]);
 const op=(await s.db.control.query("SELECT id FROM admin_operations WHERE action='catalog.draft' AND target_ids=ARRAY[$1::uuid]",[r.id])).rows[0];
 const pub=(await s.db.control.query("INSERT INTO capability_publications(profile_key,data_mode,release_id,validation_id,operation_id,actor_id) VALUES('internal-text-v1','simulated',$1,$2,$3,$4) RETURNING id",[r.id,validation,op.id,admin.id])).rows[0];
 await s.db.control.query("INSERT INTO capability_heads(profile_key,data_mode,publication_id,revision) VALUES('internal-text-v1','simulated',$1,1)",[pub.id]);
 assert.equal((await s.db.tx(tx=>s.catalog.currentCapabilities(tx))).get("internal-text-v1").id,capId);
 const latest=await detail(r.id);assert.equal((await removeModel(latest)).status,202);
 assert.equal((await s.db.tx(tx=>s.catalog.currentCapabilities(tx))).has("internal-text-v1"),false);
 assert.equal((await(await execute(capId)).json()).vendor,"a");
 assert.equal((await s.db.control.query("SELECT id FROM published_capability_versions WHERE id=$1",[capId])).rowCount,1);
});
test("customer and worker identities cannot mutate model management records",async()=>{
 await assert.rejects(s.db.app.query("SELECT * FROM capability_model_entries"),(e:any)=>e.code==="42501");
 await assert.rejects(s.db.queue.query("UPDATE capability_model_entries SET deleted_at=now()"),(e:any)=>e.code==="42501");
});
