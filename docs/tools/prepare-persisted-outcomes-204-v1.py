"""Prepare one complete final correction: durable outcomes and exact native QA pin."""
from pathlib import Path
from datetime import datetime,timezone
import json,re
R=Path(__file__).resolve().parents[2];P=R/'dev/copypaste-platform';L=R/'dev/copypaste-delivery';Q=R/'docs/quality/integrated-round-204'
previous=json.loads((L/'.data/integrated-204-v6/verification.json').read_text('utf-8'));assert previous['status']=='failures_for_integrated_debugging'
log=(L/'.data/integrated-204-v6/platform-test.log').read_text('utf-8');failed=re.findall(r'^not ok \d+ - ([^\r\n]+)',log,re.M)
audio=set(re.findall(r'^test\("([^"\r\n]+)"',(P/'tests/audio-accounting-188-v1.test.ts').read_text('utf-8'),re.M));assert len(failed)==7 and set(failed)<=audio
def fresh(p,text):
 with p.open('x',encoding='utf-8',newline='\n') as f:f.write(text)
def edit(p,old,new):
 raw=p.read_bytes();text=raw.decode().replace('\r\n','\n');assert old in text,(str(p),old[:80]);text=text.replace(old,new);p.write_bytes(text.replace('\n','\r\n').encode() if b'\r\n' in raw else text.encode())
feedback=P/'src/runtime-tool-feedback.ts'
edit(feedback,'import { z } from "zod";','import { z } from "zod";\nimport type { Tx } from "./db.js";')
edit(feedback,'export class RuntimeToolState {','''/** Latest durable outcomes survive a new native turn and paid input wait. */
export async function readUnresolvedDeliveryToolNames(tx: Tx, tenant: string, task: string): Promise<string[]> {
  const rows = await tx.query(`SELECT DISTINCT ON(body->>'tool') body->>'tool' AS tool,kind
    FROM task_events WHERE tenant_id=$1 AND task_id=$2
      AND kind IN('runtime.tool.failed','runtime.tool.completed','runtime.tool.recovered')
      AND body->>'tool'=ANY($3::text[])
    ORDER BY body->>'tool',id DESC`, [tenant, task, [...deliveryTools]]);
  return rows.rows.filter(row => row.kind === "runtime.tool.failed").map(row => row.tool);
}
export function deliveryFailureCode(names: readonly string[]): string {
  return names.some(name => name === "image2_generate" || name === "image2_edit") ? "IMAGE_TOOL_FAILED" : "TOOL_DELIVERY_INCOMPLETE";
}
export class RuntimeToolState {''')
edit(feedback,'  private waitingForInput = false;','''  private waitingForInput = false;
  constructor(unresolved: readonly string[] = []) {
    for (const name of new Set(unresolved)) if (deliveryTools.has(name))
      this.failures.set(name, safeToolFeedback(new Error(), { name, inputSchema: {} }));
  }''')
edit(feedback,'return ["image2_generate", "image2_edit"].some(name => this.failures.has(name)) ? "IMAGE_TOOL_FAILED" : "TOOL_DELIVERY_INCOMPLETE";','return deliveryFailureCode([...this.failures.keys()]);')
runtime=P/'src/runtime.ts'
edit(runtime,'  requestAuthority?: AIRequestAuthority;','''  requestAuthority?: AIRequestAuthority;
  // Server-derived persisted outcomes, never a customer-supplied authority.
  unresolvedDeliveryToolNames?: readonly string[];''')
edit(runtime,'const toolState = new RuntimeToolState();','const toolState = new RuntimeToolState(ctx.unresolvedDeliveryToolNames);')
worker=P/'src/worker.ts'
edit(worker,'import {conversationMutation}', 'import { readUnresolvedDeliveryToolNames, deliveryFailureCode } from "./runtime-tool-feedback.js";\nimport {conversationMutation}')
edit(worker,'const result = await this.runtime.start({','''const result = await this.runtime.start({
        unresolvedDeliveryToolNames: await this.db.tx(
          tx => readUnresolvedDeliveryToolNames(tx, t.tenant_id, t.id), t.tenant_id, true, t.created_by),''')
anchor='        await tx.query(\n          "UPDATE tasks SET status=$2,output=CASE WHEN content_state='
edit(worker,anchor,'''        // Input/pause checkpoints above retain their measured wait. A final
        // success must also satisfy durable outcomes from all prior turns.
        if (status === "succeeded") {
          const outstanding = await readUnresolvedDeliveryToolNames(tx, t.tenant_id, t.id);
          if (outstanding.length) { status = "failed"; error = deliveryFailureCode(outstanding); }
        }
'''+anchor)
native=(P/'tests/runtime-feedback-native-204-v1.test.ts').read_text('utf-8')+'''
test('a new native turn inherits durable delivery failure and cannot replace it with completion prose',{timeout:120000},async t=>{
 const f=await fixture(t,{});
 try {f.context.unresolvedDeliveryToolNames=['chart_render'];const r=await new CodexRuntimeAdapter(f.config).start(f.context);
  assert.equal(r.status,'failed');assert.equal(r.errorCode,'TOOL_DELIVERY_INCOMPLETE');assert.equal(r.usageKnown,true);assert.ok(r.inputTokens>0);
 } finally {await f.close();}
});
test('a recorded successful registered tool clears inherited failure while retaining measured native usage',{timeout:120000},async t=>{
 const f=await fixture(t,{tool:true});let calls=0;
 try {f.context.unresolvedDeliveryToolNames=['chart_render'];f.context.tools[0].run=async()=>{calls++;return {delivered:'Explicit controlled successful handler result'};};
  const r=await new CodexRuntimeAdapter(f.config).start(f.context);assert.equal(calls,1);assert.equal(r.status,'completed');assert.equal(r.usageKnown,true);assert.ok(r.inputTokens>0);assert.ok(f.events.some(e=>e.kind==='runtime.tool.recovered'));
 } finally {await f.close();}
});
'''
fresh(P/'tests/runtime-feedback-native-204-v2.test.ts',native)
lease=(P/'tests/cloud-task-lease-204-v2.test.ts').read_text('utf-8').replace("import {Worker,recoverExpiredCloudTaskLeases}","import {readUnresolvedDeliveryToolNames} from '../src/runtime-tool-feedback.js';\nimport {Worker,recoverExpiredCloudTaskLeases}")
lease+='''
test('durable tool outcomes stay scoped through long activity and only same-tool success clears the original failure',async()=>{
 const f=await fixture(),other=await fixture();
 const outcome=async(task:any,kind:string,tool:string)=>s.db.control.query('INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,$3,$4)',[task.tenant,task.task.id,kind,{tool,code:'TOOL_INPUT_INVALID',call_ref:'204d204e204f204a'}]);
 const read=(tenant=f.tenant)=>s.db.tx(tx=>readUnresolvedDeliveryToolNames(tx,tenant,f.task.id),tenant,true,f.c.id);
 await outcome(f,'runtime.tool.failed','chart_render');await outcome(other,'runtime.tool.failed','image2_generate');
 await s.db.control.query("INSERT INTO task_events(tenant_id,task_id,kind,body) SELECT $1,$2,'runtime.delta',jsonb_build_object('text','Controlled later activity') FROM generate_series(1,800)",[f.tenant,f.task.id]);
 assert.deepEqual(await read(),['chart_render']);assert.deepEqual(await read(other.tenant),[]);
 await outcome(f,'runtime.tool.completed','deliver_text');assert.deepEqual(await read(),['chart_render']);
 await outcome(f,'runtime.tool.completed','chart_render');assert.deepEqual(await read(),[]);
});
test('canonical worker finish rejects unresolved prior-turn delivery while retaining real partial files and known usage',async()=>{
 const f=await fixture();
 await s.db.control.query("INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'runtime.tool.failed',$3)",[f.tenant,f.task.id,{tool:'chart_render',code:'TOOL_INPUT_INVALID',call_ref:'204d204e204f204a'}]);
 const runtime=new ControlledRuntime(async ctx=>{
  assert.deepEqual(ctx.unresolvedDeliveryToolNames,['chart_render']);
  const tool=ctx.tools.find(t=>t.name==='deliver_text');assert.ok(tool);
  await tool.run({filename:'retained-partial-result.txt',content:'This actual partial file does not replace the unresolved chart.',mime_type:'text/plain'},'retained-partial-result');
  await ctx.onEvent('runtime.tool.completed',{tool:'deliver_text',call_ref:'204d204e204f204b'});
 });
 await new Worker(s.db,s.catalog,s.storage,runtime).run(f.tenant,f.task.id);
 const done=await row(f.task.id);assert.equal(done.status,'failed');assert.equal(done.error_code,'TOOL_DELIVERY_INCOMPLETE');
 assert.equal(done.input_tokens,100);assert.equal(done.output_tokens,50);assert.equal(done.budget_micros,'1000000');
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'task_id'=$1",[f.task.id])).rows[0].n,1);
});
'''
fresh(P/'tests/cloud-task-lease-204-v3.test.ts',lease)
record=(R/'docs/tools/record-integrated-code-batch-204-v4.py').read_text('utf-8').replace('implementation-batch-v4.json','implementation-batch-v5.json')
fresh(R/'docs/tools/record-integrated-code-batch-204-v5.py',record)
for path in [L/'scripts/deploy-integrated-204-v1.py',L/'scripts/finalize-release-metadata-204-v1.mjs']:
 edit(path,'integrated-204-v7','integrated-204-v8')
doc=R/'docs/tools/document-integrated-round-204-v1.py'
edit(doc,'implementation-batch-v4.json','implementation-batch-v5.json');edit(doc,'integrated-204-v7','integrated-204-v8')
edit(doc,"if c['phase']=='test':","if c['phase'].startswith('test'):")
edit(doc,"counts['copypaste-'+c['component']]=summary['tests'];current.append", "counts['copypaste-'+c['component']]=counts.get('copypaste-'+c['component'],0)+summary['tests'];current.append")
text=doc.read_text('utf-8')
start=text.index("assert counts['copypaste-platform']==12 and len(v['retained_backend_cases'])==188")
end=text.index('prior_counts=',start);text=text[:start]+text[end:]
text=text.replace("'copypaste-platform':200","'copypaste-platform':204").replace("'backend_retained188':v['retained_backend_cases'],'backend_original_whole_attempt_remains_failed':v['retained_backend_log'],",'')
text=text.replace('721 distinct related cases. Backend188 pass in full v6 plus all12 accounting cases rerun with explicit Windows native version in v7; final source is unchanged.', '725 distinct related cases. All204 Backend cases were executed on the final complete corrected batch in two independent isolated-database groups, with the explicit pinned Windows native version.')
text=text.replace('Final whole source plus prior client passes','Final whole source plus prior client passes')
doc.write_text(text,encoding='utf-8',newline='\n')
final=R/'docs/tools/finalize-integrated-round-204-v1.py'
text=final.read_text('utf-8').replace('==721','==725').replace('related_cases=721','related_cases=725').replace("'related_cases':721","'related_cases':725").replace("'related_qualified_cases':721","'related_qualified_cases':725").replace('distinct721','distinct725').replace('implementation-batch-v4.json','implementation-batch-v5.json')
text=text.replace("assert verification['status']=='passed' and verification['qualified_backend_case_count']==200", "assert verification['status']=='passed' and verification['qualified_backend_case_count']==204")
text=text.replace("assert len(verification['retained_backend_cases'])==188 and len(verification['current_backend_cases'])==12\nassert all(c['passed'] for c in verification['retained_backend_cases']+verification['current_backend_cases'])", "assert verification['backend_groups']==2 and verification['backend_failed_cases']==0")
final.write_text(text,encoding='utf-8',newline='\n')
report={'stage':204,'at':datetime.now(timezone.utc).isoformat(),'previous_full_backend':{'tests':200,'passed':193,'failed':7,'all_failed_in_audio_accounting_fixture':True},'native_environment':{'default_profile':'0.163.0-alpha.10.2','explicit_windows_pin':'0.163.0-alpha.11','production_guard_changed':False},'additional_complete_code_correction':'Persist unresolved delivery state across native turns and request-input waits; canonical Worker completion independently checks actual last durable tool outcomes, retaining partial files and measured usage. Only actual same-tool completion clears it.','new_cases':4,'final_backend_cases':204,'client_artifacts_unchanged':True,'server_network_changes':False}
fresh(Q/'collected-persisted-outcome-corrections-v1.json',json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'whole_final_correction_batch_prepared','new_backend_cases':4,'server_network_changes':False}))
