import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {buildApp} from "../src/server.js";
import {loadConfig} from "../src/config.js";
import {canonical,hmac} from "../src/lib.js";
import {isolatedTestEnvironment} from "./native-test-environment.js";
import {historyFixture,historyCall,historyOk,historyLogin} from "./admin-history-fixture.js";
let s:Awaited<ReturnType<typeof buildApp>>,isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});
async function fixture(){const f=await historyFixture(s,{versions:1,notes:0,authenticateAdmin:false});
 await s.db.control.query(`INSERT INTO tasks(tenant_id,project_id,created_by,private_owner,title,prompt,role_key,role_hash,status,mode,execution_location,budget_micros,idempotency_key,created_at)
 SELECT $1,$2,$3,$3,'Campaign task '||n,'PRIVATE_FIXTURE_BODY_NOT_DIRECTORY_CONTENT','assistant',repeat('a',64),
  CASE WHEN n%3=0 THEN 'succeeded' WHEN n%3=1 THEN 'failed' ELSE 'cancelled' END,
  CASE WHEN n%2=0 THEN 'ask' ELSE 'execute' END,CASE WHEN n%5=0 THEN 'desktop' ELSE 'cloud' END,1000000,gen_random_uuid()::text,
  '2020-01-01T00:00:00Z'::timestamptz+(n%3)*interval '1 microsecond' FROM generate_series(1,237) n`,[f.tenant,f.project,f.owner.id]);return f;}
async function walk(f:any,params:Record<string,string>={}){let cursor:string|null=null,pages=0;const ids:string[]=[];
 do{const q=new URLSearchParams({limit:"31",...params,...(cursor?{cursor}:{})}),r=await historyCall(s,f.owner,"GET",f.base+"/task-directory?"+q);assert.equal(r.status,200,JSON.stringify(r.data));assert.match(String(r.raw.headers["cache-control"]),/no-store/);
  ids.push(...r.data.items.map((t:any)=>t.id));cursor=r.data.next_cursor;assert.ok(++pages<100);if(cursor)assert.match(JSON.parse(Buffer.from(cursor.split(".")[0],"base64url").toString()).at,/\.\d{6}Z$/);
 }while(cursor);assert.equal(new Set(ids).size,ids.length);return ids;}
test("task directory reaches every record beyond100 with exact microsecond/id ordering and no writes",async()=>{
 const f=await fixture(),counts=async()=>{const q=await s.db.control.query("SELECT (SELECT count(*) FROM ai_gateway_requests WHERE tenant_id=$1)::int AS requests,(SELECT count(*) FROM ledger WHERE tenant_id=$1)::int AS ledger,(SELECT count(*) FROM tasks WHERE tenant_id=$1)::int AS tasks",[f.tenant]);return q.rows[0];},before=await counts();
 const expected=(await s.db.control.query("SELECT id FROM tasks WHERE project_id=$1 ORDER BY created_at DESC,id DESC",[f.project])).rows.map(r=>r.id);
 assert.equal(expected.length,237);assert.deepEqual(await walk(f),expected);assert.deepEqual(await counts(),before);
 const first=await historyOk(s,f.owner,"GET",f.base+"/task-directory");assert.equal(first.items.length,40);
 for(const item of first.items){assert.equal("prompt" in item,false);assert.equal("output" in item,false);assert.equal("input_context" in item,false);assert.equal("cursor_at" in item,false);}
});
test("combined task filters use literal case-insensitive title matches and real execution fields",async()=>{
 const f=await fixture();const expected=(await s.db.control.query("SELECT id FROM tasks WHERE project_id=$1 AND status='succeeded' AND mode='ask' AND execution_location='desktop' AND position('campaign' in lower(title))>0 ORDER BY created_at DESC,id DESC",[f.project])).rows.map(r=>r.id);
 assert.ok(expected.length>0);assert.deepEqual(await walk(f,{q:"cAMpaign",status:"succeeded",mode:"ask",location:"desktop"}),expected);
 assert.deepEqual(await walk(f,{q:"%_"}),[]);
 for(const q of ["limit=0","limit=101","limit=1.5","status=unknown","location=any","mode=raw","extra=secret"]){assert.equal((await historyCall(s,f.owner,"GET",f.base+"/task-directory?"+q)).status,400);}
});
test("signed pages bind filters, page size, session, actor and expiry; malformed inputs fail closed",async()=>{
 const f=await fixture(),first=await historyOk(s,f.owner,"GET",f.base+"/task-directory?limit=30"),cursor=first.next_cursor;
 for(const tail of ["q=Campaign","status=succeeded","mode=ask","location=desktop"]){assert.equal((await historyCall(s,f.owner,"GET",f.base+"/task-directory?limit=30&"+tail+"&cursor="+cursor)).status,400);}
 assert.equal((await historyCall(s,f.owner,"GET",f.base+"/task-directory?limit=31&cursor="+cursor)).status,400);
 const forged=cursor.slice(0,-1)+(cursor.endsWith("0")?"1":"0");assert.equal((await historyCall(s,f.owner,"GET",f.base+"/task-directory?limit=30&cursor="+forged)).status,400);
 const otherSession=await historyLogin(s,f.owner.email);otherSession.tenant=f.tenant;
 assert.equal((await historyCall(s,otherSession,"GET",f.base+"/task-directory?limit=30&cursor="+cursor)).status,400);
 const body=JSON.parse(Buffer.from(cursor.split(".")[0],"base64url").toString()),encoded=Buffer.from(canonical({...body,expires:Date.now()-1})).toString("base64url"),expired=encoded+"."+hmac(s.db.config.MASTER_KEY!,"task-directory-v1:"+encoded);
 const r=await historyCall(s,f.owner,"GET",f.base+"/task-directory?limit=30&cursor="+expired);assert.equal(r.status,409);assert.equal(r.data.error.code,"TASK_DIRECTORY_CURSOR_EXPIRED");
 assert.equal((await historyCall(s,f.owner,"GET",f.base.replace(f.project,randomUUID())+"/task-directory?limit=30&cursor="+cursor)).status,404);
});
test("current project, private owner and quarantine checks apply to every task page",async()=>{
 const f=await fixture(),viewer=await historyLogin(s);viewer.tenant=f.tenant;
 await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')",[f.tenant,viewer.id]);
 await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')",[f.tenant,f.project,viewer.id]);
 assert.equal((await historyOk(s,viewer,"GET",f.base+"/task-directory")).items.length,0);
 const ids=(await s.db.control.query("SELECT id FROM tasks WHERE project_id=$1 LIMIT 3",[f.project])).rows.map(r=>r.id);
 await s.db.control.query("UPDATE tasks SET private_owner=NULL WHERE id=$1",[ids[0]]);
 assert.deepEqual((await historyOk(s,viewer,"GET",f.base+"/task-directory")).items.map((t:any)=>t.id),[ids[0]]);
 await s.db.control.query("UPDATE tasks SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[ids[1]]);
 await s.db.control.query("UPDATE tasks SET input_context=jsonb_build_object('analysis_report_id',$2::text) WHERE id=$1",[ids[2],randomUUID()]);
 const page=await walk(f);assert.equal(page.includes(ids[1]),false);assert.equal(page.includes(ids[2]),false);
 await s.db.control.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",[f.project,viewer.id]);
 assert.equal((await historyCall(s,viewer,"GET",f.base+"/task-directory")).status,404);
 await s.db.control.query("UPDATE projects SET archived=true WHERE id=$1",[f.project]);
 assert.equal((await historyCall(s,f.owner,"GET",f.base+"/task-directory")).status,404);
});
test("task directory response matches the additive contract and requires sign-in",async()=>{
 const f=await fixture(),r=await historyOk(s,f.owner,"GET",f.base+"/task-directory?limit=1"),schema=JSON.parse(await readFile(new URL("../contracts/task-directory-v1.schema.json",import.meta.url),"utf8"));
 assert.deepEqual(Object.keys(r).sort(),schema.required.slice().sort());assert.deepEqual(Object.keys(r.items[0]).sort(),schema.properties.items.items.required.slice().sort());
 assert.equal((await historyCall(s,null,"GET",f.base+"/task-directory")).status,401);
});
