"""Prepare the full collected correction batch; no build, test or deployment."""
from pathlib import Path
from datetime import datetime, timezone
import json

R = Path(__file__).resolve().parents[2]
P = R / 'dev/copypaste-platform'
L = R / 'dev/copypaste-delivery'
Q = R / 'docs/quality/integrated-round-204'

def edit(p, old, new):
    raw = p.read_bytes()
    text = raw.decode('utf-8').replace('\r\n', '\n')
    assert old in text, (str(p), old[:80])
    text = text.replace(old, new)
    p.write_bytes(text.replace('\n', '\r\n').encode() if b'\r\n' in raw else text.encode())

edit(P/'src/schema-compatibility.ts', 'requiredSchemaVersion = 164', 'requiredSchemaVersion = 165')
upgrade = (P/'tests/audio-authorization-upgrade-189-v1.test.ts').read_text(encoding='utf-8')
upgrade = upgrade.replace('import { authorizeTaskPlan }', 'import { authorizeExecutionPlan }')
upgrade = upgrade.replace('const plan = await authorizeTaskPlan(tx, f.tenant, f.c.id, historical, 1000000);', '''// Reconstruct the published SQL101 fixture, without calling current
        // SQL162 capacity admission against an intentionally historical DB.
        const plan = await authorizeExecutionPlan(tx, f.tenant, f.c.id, historical);
        assert.ok(1000000 <= plan.body.max_task_budget_micros);
        assert.equal((await tx.query("SELECT count(*)::int AS n FROM tasks WHERE tenant_id=$1 AND created_by=$2 AND status IN ('queued','running','paused','awaiting_approval','needs_input','reconciling')", [f.tenant, f.c.id])).rows[0].n, 0);''')
with (P/'tests/audio-authorization-upgrade-189-v2.test.ts').open('x', encoding='utf-8', newline='\n') as f: f.write(upgrade)

lease = (P/'tests/cloud-task-lease-204-v1.test.ts').read_text(encoding='utf-8').replace('import {Worker}', 'import {Worker,recoverExpiredCloudTaskLeases}')
lease += '''
test('an authenticated canonical renewal in flight is never reaped using its old committed deadline',{timeout:15000},async()=>{
 const f=await fixture();
 await s.db.tx(async tx=>{await tx.query("SELECT claim_execution_capacity($1,'text',8,$2)",[f.task.id,randomUUID()]);},f.tenant,false,f.c.id);
 await s.db.control.query("UPDATE tasks SET lease_until=clock_timestamp()+interval '500 milliseconds' WHERE id=$1",[f.task.id]);
 const task=await row(f.task.id);let release!:()=>void,enter!:()=>void;
 const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const renewal=s.db.tx(async tx=>{
  assert.ok((await tx.query('SELECT renew_cloud_task_lease($1,$2) AS deadline',[f.task.id,task.fencing_token])).rows[0].deadline);
  enter();await gate;
 },f.tenant,false,f.c.id);
 try {
  await Promise.race([entered,renewal.then(()=>{throw Error('Renewal must enter its actual transaction');})]);
  await wait(800);assert.equal((await row(f.task.id)).live,false,'The committed old row is expired while renewal is uncommitted');
  const began=Date.now();await recoverExpiredCloudTaskLeases(s.db);assert.ok(Date.now()-began<2000);
  assert.equal((await row(f.task.id)).status,'running');
 } finally {release();await renewal;}
 assert.equal((await row(f.task.id)).live,true);
 await s.db.control.query("UPDATE tasks SET status='cancelled',lease_until=NULL WHERE id=$1",[f.task.id]);
});

test('expired cloud ownership is recovered once after its real authority lock ends, preserving unknown money',{timeout:15000},async()=>{
 const f=await fixture();
 await s.db.tx(async tx=>{await tx.query("SELECT claim_execution_capacity($1,'text',8,$2)",[f.task.id,randomUUID()]);},f.tenant,false,f.c.id);
 const task=await row(f.task.id);
 await s.db.control.query("UPDATE tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.task.id]);
 let release!:()=>void,enter!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const held=s.db.tx(async tx=>{await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[f.task.id]);enter();await gate;},f.tenant,false,f.c.id);
 try {
  await entered;const began=Date.now();await recoverExpiredCloudTaskLeases(s.db);assert.ok(Date.now()-began<2000);
  assert.equal((await row(f.task.id)).status,'running');
  assert.equal(await s.db.tx(async tx=>(await tx.query('SELECT renew_cloud_task_lease($1,$2) AS deadline',[f.task.id,task.fencing_token])).rows[0].deadline,f.tenant,false,f.c.id),null);
 } finally {release();await held;}
 await recoverExpiredCloudTaskLeases(s.db);
 const done=await row(f.task.id);assert.equal(done.status,'reconciling');assert.equal(done.error_code,'WORKER_LEASE_EXPIRED');
 const reservation=(await s.db.control.query('SELECT * FROM reservations WHERE task_id=$1',[f.task.id])).rows[0];
 assert.equal(reservation.status,'reconciling');assert.equal(reservation.amount_micros,'1000000');
 const count=async()=>(await s.db.control.query("SELECT count(*)::int AS n FROM task_events WHERE task_id=$1 AND kind='task.finished'",[f.task.id])).rows[0].n;
 assert.equal(await count(),1);await recoverExpiredCloudTaskLeases(s.db);assert.equal(await count(),1);
 assert.equal((await s.db.control.query('SELECT count(*)::int AS n FROM ledger WHERE task_id=$1',[f.task.id])).rows[0].n,0);
});
'''
with (P/'tests/cloud-task-lease-204-v2.test.ts').open('x', encoding='utf-8', newline='\n') as f: f.write(lease)

ui = (L/'scripts/qualify-tool-feedback-ui-204-v1.mjs').read_text(encoding='utf-8')
ui = ui.replace("from 'node:module';", "from 'node:module';import {pathToFileURL} from 'node:url';")
ui = ui.replace("await import(req.resolve('vite'))", "await import(pathToFileURL(req.resolve('vite')).href)")
ui = ui.replace('feedback-ui-v1', 'feedback-ui-v2').replace('204-v1-tool-feedback', '204-v2-tool-feedback').replace("'204-v1',()=>page.screenshot", "'204-v2',()=>page.screenshot")
ui = ui.replace("}finally{if(recording)report.recordings.push(await recording.stop());await browser?.close();await server.close();report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\\n',{flag:'wx'});}", """}catch(error){report.status='failed';report.errors.push(error.message);throw error;
}finally{try{if(recording)report.recordings.push(await recording.stop());}catch(error){report.errors.push('Owned recording cleanup: '+error.message);report.status='failed';}finally{await browser?.close();await server.close();report.finished_at=new Date().toISOString();await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\\n',{flag:'wx'});}}""")
with (L/'scripts/qualify-tool-feedback-ui-204-v2.mjs').open('x', encoding='utf-8', newline='\n') as f: f.write(ui)

for p in [L/'scripts/activate-integrated-204-v1.sh', L/'scripts/stage-integrated-204-v1.sh', L/'scripts/bundle-integrated-204-v1.py', R/'docs/tools/update-integrated-readmes-204-v1.py']:
    edit(p, '164', '165')
activation=L/'scripts/activate-integrated-204-v1.sh'
edit(activation, 'swaps=[];migrated=False;stopped=False;', 'swaps=[];migrated=False;stopped=False;migration_started=False;')
edit(activation, "migration_output=js(migration,True);", "migration_started=True;migration_output=js(migration,True);")
edit(activation, 'except Exception:\n for live,saved', '''except Exception:
 # A migration may commit before its reporting process fails. Discover the
 # actual application schema before selecting a compatible code fallback.
 if migration_started:
  probe="import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query('SELECT max(version)::int v FROM schema_migrations');console.log(r.rows[0].v);}finally{await c.end();}"
  actual=int(js(probe).strip());assert actual in [163,164,165]
  if actual==164:
   for p in [fallback/'src/schema-compatibility.ts',fallback/'dist/src/schema-compatibility.js']:
    p.write_text(p.read_text().replace('requiredSchemaVersion = 165','requiredSchemaVersion = 164'))
  migrated=actual>=164
 for live,saved''')
edit(L/'scripts/finalize-release-metadata-204-v1.mjs', 'integrated-204-v3', 'integrated-204-v4')
edit(L/'scripts/finalize-release-metadata-204-v1.mjs', 'completed final integrated-202-v1 batch', 'completed final integrated-204 source batch')
publish=R/'docs/tools/publish-integrated-round-204-v1.py'
edit(publish, "'src/runtime.ts','src/task-business-tools.ts'", "'src/server.ts','src/runtime.ts','src/task-business-tools.ts'")
edit(publish, "'migrations/164-independent-cloud-task-leases.sql'", "'migrations/164-independent-cloud-task-leases.sql','migrations/165-native-transaction-lease-compatibility.sql','tests/audio-authorization-upgrade-189-v2.test.ts'")
edit(publish, "if (repos[n]/p).relative_to(D).as_posix() in qualified_media if n!='docs' else False:return True", "if n!='docs' and (repos[n]/p).relative_to(D).as_posix() in qualified_media:return True")

record = (R/'docs/tools/record-integrated-code-batch-204-v2.py').read_text(encoding='utf-8').replace('implementation-batch-v2.json', 'implementation-batch-v3.json')
with (R/'docs/tools/record-integrated-code-batch-204-v3.py').open('x', encoding='utf-8', newline='\n') as f:f.write(record)
report={'stage':204,'at':datetime.now(timezone.utc).isoformat(),'previous_verification':'.data/integrated-204-v3/verification.json','previous_backend':{'passed':181,'failed':17,'total':198},'corrections':['14 native audio/video cases require the explicit pinned native test environment, not a PATH fallback','One SQL101 upgrade fixture must seed its historical plan without current SQL162 admission','Native HTTP tool-input failures preserve VALIDATION_ERROR400 without validator detail leakage','Forward SQL165 preserves native transaction-time receipt/checkpoint semantics; SQL164 remains unchanged','Cloud expiry serializes with canonical renewal and skips actual locked work; native uses its authenticated reaper','Two additional real PostgreSQL expiry/renewal race cases retain all three prior lease cases','Controlled UI verifier uses a Windows file URL and always closes owned browser/recording','Unexecuted application-only release scripts require schema165 and discover actual schema before fallback'],'not_claimed':['Historical marketing failure exact cause','Professional role acceptance','Complete 102 requirements/32 acceptance groups','Default public HTTP2 egress','External video/audio/marketing credentials','Disaster recovery drill']}
with (Q/'collected-build-corrections-v3.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({'status':'whole_collected_correction_batch_prepared','tests_started':False,'schema_target':165}))
