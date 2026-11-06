from pathlib import Path
import json, hashlib, re
from datetime import datetime, timezone

R=Path(__file__).resolve().parents[2]
P=R/'dev/copypaste-platform'; W=R/'dev/copypaste-web'; N=R/'dev/copypaste-desktop'; L=R/'dev/copypaste-delivery'; Q=R/'docs/quality/integrated-round-205'
def change(p, old, new):
    s=p.read_text('utf-8'); assert old in s, (p,old[:100]); p.write_text(s.replace(old,new),'utf-8')
def fresh(p,s):
    assert not p.exists(),p; p.write_text(s,'utf-8')

change(P/'src/tool-outcome-ledger.ts', 'category: "execution", operation_outcome: "not_performed", can_correct_arguments: false,', 'category: error.reason === "invalid_reference" ? "validation" : "execution", operation_outcome: "not_performed", can_correct_arguments: error.reason === "invalid_reference",')
change(P/'src/tool-outcome-ledger.ts', 'p.tool === tool && p.operation_outcome === "unverified" && p.arguments_sha256 === digest', 'p.tool === tool && p.operation_outcome === "unverified"')
change(P/'src/tool-outcome-ledger.ts', '    const root = repair ?? call;\n    this.pending.set(root,', '    const root = repair ?? call;\n    // Duplicate call identities are idempotent, matching the durable SQL ledger.\n    // In particular, never downgrade an unknown side effect into a replayable call.\n    if (!repair && this.pending.has(root)) return root;\n    this.pending.set(root,')
change(P/'src/tool-outcome-ledger.ts', '  get outstanding() {', '  pendingFor(tool: string) { return [...this.pending.values()].filter(p => p.tool === tool); }\n  correctableReferences(tool: string) { return this.pendingFor(tool).filter(p => p.operation_outcome === "not_performed" && p.can_correct_arguments).map(p => p.failure_ref).slice(0,16); }\n  get outstanding() {')
change(P/'src/runtime.ts', 'RuntimeToolLedger, recoveryToolSchema, outcomeFeedback, assertDeliveredToolResult,', 'RuntimeToolLedger, ToolRecoveryFailure, recoveryToolSchema, outcomeFeedback, assertDeliveredToolResult,')
old='''              const root = tool ? toolState.fail(tool.name, identity.call_ref, identity.arguments_sha256, feedback, repair) : identity.call_ref;
              await ctx.onEvent("runtime.tool.failed", { ...identity, failure_ref: root, ...feedback });
              result = { success: false, contentItems: [{ type: "inputText", text: JSON.stringify({
                error: { ...feedback, call_ref: identity.call_ref, failure_ref: root },'''
new='''              // A rejected correction performs no business action and does not invent
              // another requested output. Keep the original obligation until its exact
              // correction succeeds, and provide only this task/tool's safe references.
              const rejected = !!tool && error instanceof ToolRecoveryFailure && toolState.pendingFor(tool.name).length > 0;
              const root = rejected ? undefined : tool ? toolState.fail(tool.name, identity.call_ref, identity.arguments_sha256, feedback, repair) : identity.call_ref;
              await ctx.onEvent(rejected ? "runtime.tool.repair_rejected" : "runtime.tool.failed", { ...identity, ...(root ? { failure_ref: root } : {}), ...feedback });
              result = { success: false, contentItems: [{ type: "inputText", text: JSON.stringify({
                error: { ...feedback, call_ref: identity.call_ref, ...(root ? { failure_ref: root } : {}),
                  ...(rejected && tool ? { correction_references: toolState.correctableReferences(tool.name) } : {}) },'''
change(P/'src/runtime.ts',old,new)
change(P/'src/task-events.ts', '["runtime.tool.failed", "runtime.tool.completed", "runtime.tool.recovered"].includes(e.kind)', '["runtime.tool.failed", "runtime.tool.completed", "runtime.tool.recovered", "runtime.tool.repair_rejected"].includes(e.kind)')
for p in [W/'src/task-tool-state.ts',N/'renderer/src/task-tool-state.ts']:
    change(p, ': kind === "runtime.tool.recovered" ?', ': kind === "runtime.tool.repair_rejected" ? ["修正需要核對", "Correction needs review"] as const\n  : kind === "runtime.tool.recovered" ?')

# Executed attempts are immutable. Preserve every original assertion in v2.
s=(P/'tests/tool-outcome-ledger-205-v1.test.ts').read_text('utf-8')
s+='''
test('unknown operation blocks changed arguments of the same delivery tool without blocking status tools',()=>{const s=new RuntimeToolLedger();s.fail('chart_render','a'.repeat(16),'a'.repeat(64),outcomeFeedback(Error(),tool));assert.throws(()=>s.prepare('chart_render',{title:'A different output'}),ToolRecoveryFailure);assert.doesNotThrow(()=>s.prepare('generated_video_get',{job_id:'original'}));assert.equal(s.outstanding.length,1);});
test('duplicate failed call cannot downgrade an unknown original into a correctable obligation',()=>{const s=new RuntimeToolLedger();s.fail('chart_render','a'.repeat(16),'a'.repeat(64),outcomeFeedback(Error(),tool));s.fail('chart_render','a'.repeat(16),'b'.repeat(64),correctable);assert.equal(s.outstanding[0].operation_outcome,'unverified');assert.equal(s.outstanding[0].can_correct_arguments,false);assert.throws(()=>s.prepare('chart_render',{title:'Retry',_workmate_repair_of:'a'.repeat(16)}),ToolRecoveryFailure);});
test('mistyped correction reference preserves the original; exact subsequent correction clears it',()=>{const s=new RuntimeToolLedger();s.fail('chart_render','a'.repeat(16),'a'.repeat(64),correctable);assert.throws(()=>s.prepare('chart_render',{title:'A',_workmate_repair_of:'b'.repeat(16)}),ToolRecoveryFailure);assert.deepEqual(s.correctableReferences('chart_render'),['a'.repeat(16)]);assert.deepEqual(s.correctableReferences('deliver_text'),[]);const p=s.prepare('chart_render',{title:'A',_workmate_repair_of:s.correctableReferences('chart_render')[0]});s.complete('chart_render',p.repair);assert.equal(s.unresolvedDelivery,false);});
'''
fresh(P/'tests/tool-outcome-ledger-205-v2.test.ts',s)
s=(P/'tests/tool-outcome-persistence-205-v1.test.ts').read_text('utf-8').replace(',f.tenant,true,f.c.id',',f.tenant,false,f.c.id').replace(',other.tenant,true,other.c.id',',other.tenant,false,other.c.id')
s+='''
test('rejected correction diagnostics do not create extra output obligations in PostgreSQL',async()=>{const f=await fixture(),root='a'.repeat(16);await emit(f,'runtime.tool.failed',body(root));await emit(f,'runtime.tool.repair_rejected',{...body('b'.repeat(16)),code:'TOOL_RECOVERY_NOT_ALLOWED'});assert.deepEqual((await pending(f)).map(p=>p.failure_ref),[root]);await emit(f,'runtime.tool.completed',body('c'.repeat(16),{repair_of:root}));assert.equal((await pending(f)).length,0);});
'''
fresh(P/'tests/tool-outcome-persistence-205-v2.test.ts',s)
s=(P/'tests/runtime-feedback-fixture-205-v1.ts').read_text('utf-8').replace('repairSecond?: boolean','repairSecond?: boolean; guessedSecond?: boolean')
s=s.replace('_workmate_repair_of: lastReference(body.input)', '_workmate_repair_of: options.guessedSecond && calls.length === 2 ? "0".repeat(16) : lastReference(body.input)')
fresh(P/'tests/runtime-feedback-fixture-205-v2.ts',s)
s=(P/'tests/runtime-feedback-native-205-v1.test.ts').read_text('utf-8').replace('runtime-feedback-fixture-205-v1','runtime-feedback-fixture-205-v2')
s=s.replace("{tool:true,toolCount:2});let effects=0;", "{tool:true,toolCount:2,validSecond:true});let effects=0;")
s=s.replace("e.kind==='runtime.tool.failed'&&e.body.code==='TOOL_RECOVERY_NOT_ALLOWED'", "e.kind==='runtime.tool.repair_rejected'&&e.body.code==='TOOL_RECOVERY_NOT_ALLOWED'")
s+='''
test('actual pinned Codex can correct a mistyped recovery reference without creating a phantom obligation',{timeout:120000},async t=>{const f=await fixture(t,{tool:true,toolCount:3,validSecond:true,repairSecond:true,guessedSecond:true});let writes=0;try{f.context.tools[0].run=async args=>{const v=parseToolArguments(schema,args);writes++;return {delivered:v.title};};const r=await new CodexRuntimeAdapter(f.config).start(f.context);assert.equal(r.status,'completed');assert.equal(writes,1);assert.equal(f.events.filter(e=>e.kind==='runtime.tool.failed').length,1);assert.equal(f.events.filter(e=>e.kind==='runtime.tool.repair_rejected').length,1);assert.equal(f.events.filter(e=>e.kind==='runtime.tool.recovered').length,1);assert.equal(r.inputTokens,68);assert.equal(r.outputTokens,20);assert.ok(JSON.stringify(f.inputs).includes('correction_references'));}finally{await f.close();}});
'''
fresh(P/'tests/runtime-feedback-native-205-v2.test.ts',s)
s=(W/'tests/tool-outcome-state-205-v1.test.ts').read_text('utf-8')
s+='''
test('rejected correction diagnostic neither adds nor clears the original pending output',()=>{const items=[fail(1,a),{id:2,kind:'runtime.tool.repair_rejected',body:{outcome_version:2,tool:'chart_render',call_ref:b,code:'TOOL_RECOVERY_NOT_ALLOWED'}}];assert.deepEqual(pendingToolFeedback(items).map(f=>f.reference),[a]);assert.equal(pendingToolFeedback([...items,done(3,a)]).length,0);});
'''
fresh(W/'tests/tool-outcome-state-205-v2.test.ts',s)
fresh(N/'tests/tool-outcome-state-205-v2.test.ts',s.replace('../src/task-tool-state.js','../renderer/src/task-tool-state.js'))

# Windows may report a just-closed worker briefly alive. Wait without killing,
# then require both a gone owner and actual absence of its exact owned path.
s=(P/'scripts/reclaim-test-fixtures.ts').read_text('utf-8')
s=s.replace('import path from "node:path";', 'import path from "node:path";\nimport { setTimeout as pause } from "node:timers/promises";')
s=s.replace('    const gone = processIsGone(item.worker_pid);','    const deadline = performance.now() + 3000;\n    let gone = processIsGone(item.worker_pid);\n    while (!gone && performance.now() < deadline) { await pause(50); gone = processIsGone(item.worker_pid); }')
fresh(P/'scripts/reclaim-test-fixtures-v2.ts',s)
fresh(P/'scripts/run-tests-owned-v2.mjs',(P/'scripts/run-tests-owned.mjs').read_text('utf-8').replace('scripts/reclaim-test-fixtures.ts','scripts/reclaim-test-fixtures-v2.ts'))
fresh(P/'scripts/run-current-tests-owned-v17.mjs',(P/'scripts/run-current-tests-owned-v16.mjs').read_text('utf-8').replace('scripts/run-tests-owned.mjs','scripts/run-tests-owned-v2.mjs'))
change(P/'package.json','run-current-tests-owned-v16.mjs','run-current-tests-owned-v17.mjs')
s=(P/'tests/test-fixture-ownership.test.ts').read_text('utf-8').replace('scripts/reclaim-test-fixtures.ts','scripts/reclaim-test-fixtures-v2.ts')
s+='''
test('reclamation waits for the exact briefly live worker to close without killing it',async()=>{const {spawn}=await import('node:child_process');const dead=spawnSync(process.execPath,['-e','process.exit(0)'],{windowsHide:true});const worker=spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),750)'],{windowsHide:true,stdio:'ignore'});assert.ok(worker.pid);const closed=new Promise<void>(r=>worker.once('close',()=>r()));const runId=randomUUID(),fixtureId=randomUUID().replaceAll('-',''),run=path.resolve('.data/test-fixture-reclamation',runId),directory=path.join(base,fixtureId),runToken=randomUUID();try{await mkdir(path.join(run,'owned'),{recursive:true});await mkdir(directory,{recursive:true});await writeFile(path.join(run,'manifest.json'),JSON.stringify({owner_pid:dead.pid,token:runToken}));await writeFile(path.join(run,'owned',fixtureId+'.json'),JSON.stringify({id:fixtureId,directory,worker_pid:worker.pid,token:runToken}));const p=spawn(process.execPath,['--import','tsx','scripts/reclaim-test-fixtures-v2.ts'],{windowsHide:true,stdio:'ignore',env:{...process.env,COPYPASTE_TEST_RECLAMATION_DIR:run,COPYPASTE_TEST_RECLAMATION_TOKEN:runToken,COPYPASTE_TEST_RECOVER_INTERRUPTED:'true'}});const code=await new Promise(r=>p.once('close',r));assert.equal(code,0);await closed;assert.ok(processIsGone(worker.pid));assert.equal(JSON.parse(await readFile(path.join(run,'result.json'),'utf8')).workers_exited,true);await assert.rejects(lstat(directory),(e:any)=>e.code==='ENOENT');}finally{await closed;for(const target of[directory,run]){assert.ok(target.startsWith(path.resolve('.data')+path.sep));await rm(target,{recursive:true,force:true});}}});
'''
fresh(P/'tests/test-fixture-ownership-205-v1.test.ts',s)

# One complete source freeze precedes the next unified build/test attempt.
rows=[];extensions={'.ts','.tsx','.cts','.mts','.js','.mjs','.cjs','.css','.py','.cs'}
for repo in ['platform','web','admin','desktop','extension','delivery']:
 base=R/'dev'/('copypaste-'+repo)
 for folder in ['src']+(['renderer/src'] if repo=='desktop' else []):
  for p in sorted((base/folder).rglob('*')):
   if p.is_file() and p.suffix in extensions:
    b=p.read_bytes();rows.append({'path':p.relative_to(R).as_posix(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
migrations=[{'path':p.relative_to(R).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((P/'migrations').glob('*.sql'))]
assert len(migrations)==166
report={'stage':205,'attempt':2,'status':'implementation_batch_complete_before_build_and_test','at':datetime.now(timezone.utc).isoformat(),'production_source_files':rows,'migration_files':migrations,'literal_markers':[r['path'] for r in rows if re.search(r'\b(?:TODO|FIXME|HACK|XXX)\b',(R/r['path']).read_text('utf-8',errors='replace'))],'scope':'Integrated correction package: monotonic unknown-call identity, no changed-argument unknown replay, recoverable correction-metadata diagnostics, actual RLS application identity, native binary+version test pin, native renderer import, bounded non-killing fixture worker close. Preserves all original102 requirements/32 groups and external/professional/production acceptance.'}
fresh(Q/'implementation-batch-v2.json',json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':report['status'],'source_files':len(rows),'migrations':len(migrations),'literal_markers':report['literal_markers']}))
