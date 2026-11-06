import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {isolatedTestEnvironment} from './native-test-environment.js';
import {buildApp} from '../src/server.js';
import {loadConfig} from '../src/config.js';
import {Worker} from '../src/worker.js';
import {CodexRuntimeAdapter,type RuntimeContext,type RuntimeResult} from '../src/runtime.js';
let isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>,s:Awaited<ReturnType<typeof buildApp>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:'test',DEMO_MODE:'true',WORKER_ENABLED:'false',DEV_MAILBOX:'true'}),{worker:false});},{timeout:900000});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});
async function call(c:any,method:string,url:string,body?:unknown){
 const r=await s.app.inject({method:method as any,url,headers:{origin:s.db.config.WEB_ORIGIN,'idempotency-key':randomUUID(),...(c?{cookie:c.cookie,'x-csrf-token':c.csrf}:{}),...(body===undefined?{}:{'content-type':'application/json'})},payload:body===undefined?undefined:JSON.stringify(body)});
 assert.ok([200,201,202].includes(r.statusCode),r.body);return {data:r.json(),r};
}
async function fixture(){
 const a=(await call(null,'POST','/v1/auth/challenge',{email:`lease-${randomUUID()}@example.invalid`})).data;
 const mail=JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${a.challenge_id}.json`,'utf8'));
 const v=await call(null,'POST','/v1/auth/verify',{challenge_id:a.challenge_id,code:mail.text.match(/\b\d{6}\b/)[0]});
 const c={id:v.data.user.id,cookie:v.r.cookies[0].name+'='+v.r.cookies[0].value,csrf:v.data.csrf_token};
 const w=(await call(c,'POST','/v1/tenants',{name:'Independent lease fixture',project_name:'Controlled work'})).data;
 await s.db.control.query('UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1',[w.tenant.id]);
 const task=(await call(c,'POST',`/v1/tenants/${w.tenant.id}/projects/${w.project.id}/delegations`,{title:'Lease boundary',prompt:'Produce a controlled retained text file.',mode:'execute',budget_micros:1000000,client_message_id:randomUUID()})).data.task;
 return {c,tenant:w.tenant.id,project:w.project.id,task};
}
const row=async(id:string)=>(await s.db.control.query('SELECT t.*,public.task_live_lease_until(t)>clock_timestamp() AS live FROM tasks t WHERE id=$1',[id])).rows[0];
class ControlledRuntime extends CodexRuntimeAdapter {
 constructor(private runCase:(ctx:RuntimeContext)=>Promise<void>){super(s.db.config);}
 override async start(ctx:RuntimeContext):Promise<RuntimeResult>{
  await ctx.onEvent('runtime.thread',{thread_id:'lease-'+ctx.taskId});await ctx.onEvent('runtime.turn',{turn_id:'turn-'+ctx.taskId});
  await this.runCase(ctx);return {text:'Controlled lease fixture',inputTokens:100,outputTokens:50,usageKnown:true,accepted:true,thread:'lease-'+ctx.taskId,turn:'turn-'+ctx.taskId,status:'completed'};
 }
}
test('worker renews beyond forty-five seconds while the existing tool authority task lock is held, then actually delivers',{timeout:150000},async()=>{
 const f=await fixture();let elapsed=0;
 const runtime=new ControlledRuntime(async ctx=>{
  const began=Date.now();
  await s.db.tx(async tx=>{
   await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE NOWAIT',[f.task.id]);
   while(Date.now()-began<48000){await wait(1000);assert.equal(ctx.signal.aborted,false);}
   const current=(await tx.query('SELECT public.task_live_lease_until(t)>clock_timestamp() AS live,t.lease_until<clock_timestamp() AS legacy_expired FROM tasks t WHERE id=$1',[f.task.id])).rows[0];
   assert.equal(current.live,true);assert.equal(current.legacy_expired,true);
  },f.tenant,false,f.c.id);
  elapsed=Date.now()-began;
  const write=ctx.tools.find(t=>t.name==='deliver_text');assert.ok(write);
  await write.run({filename:'after-long-authority-lock.txt',content:'The original tool authority lock was retained beyond its initial deadline.',mime_type:'text/plain'},'long-lease-retained-output');
 });
 await new Worker(s.db,s.catalog,s.storage,runtime).run(f.tenant,f.task.id);
 const done=await row(f.task.id);assert.ok(elapsed>=48000);assert.equal(done.status,'succeeded');assert.equal(done.lease_until,null);
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'task_id'=$1",[f.task.id])).rows[0].n,1);
});
test('expired ownership cannot be renewed or admitted by a correct but stale fence; explicit NULL invalidation also fences it',async()=>{
 const f=await fixture();
 await s.db.tx(async tx=>{await tx.query("SELECT claim_execution_capacity($1,'text',8,$2)",[f.task.id,randomUUID()]);},f.tenant,false,f.c.id);
 const live=await row(f.task.id);assert.equal(live.live,true);
 await s.db.control.query("UPDATE tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.task.id]);
 const renew=await s.db.tx(async tx=>(await tx.query('SELECT renew_cloud_task_lease($1,$2) AS deadline',[f.task.id,live.fencing_token])).rows[0],f.tenant,false,f.c.id);
 assert.equal(renew.deadline,null);assert.equal((await row(f.task.id)).live,false);
 await s.db.control.query('UPDATE tasks SET lease_until=NULL WHERE id=$1',[f.task.id]);
 assert.equal((await row(f.task.id)).live,false);
 await s.db.control.query("UPDATE tasks SET status='cancelled',lease_until=NULL WHERE id=$1",[f.task.id]);
});
test('cross-tenant, stale fence, cancelled task and revoked authentication cannot renew a live cloud lease',async()=>{
 const f=await fixture(),other=await fixture();
 await s.db.tx(async tx=>{await tx.query("SELECT claim_execution_capacity($1,'text',8,$2)",[f.task.id,randomUUID()]);},f.tenant,false,f.c.id);
 const live=await row(f.task.id);
 const renew=async(tenant:string,actor:string,fence=live.fencing_token)=>s.db.tx(async tx=>(await tx.query('SELECT renew_cloud_task_lease($1,$2) AS deadline',[f.task.id,fence])).rows[0].deadline,tenant,false,actor);
 assert.equal(await renew(other.tenant,other.c.id),null);assert.equal(await renew(f.tenant,f.c.id,randomUUID()),null);
 await s.db.control.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[f.c.id]);assert.equal(await renew(f.tenant,f.c.id),null);
 await s.db.control.query("UPDATE tasks SET status='cancelled',lease_until=NULL WHERE id=$1",[f.task.id]);assert.equal(await renew(f.tenant,f.c.id),null);
});
