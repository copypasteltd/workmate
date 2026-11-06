from pathlib import Path
import json,hashlib,re
from datetime import datetime,timezone
R=Path(__file__).resolve().parents[2];W=R/'dev/copypaste-web';N=R/'dev/copypaste-desktop';L=R/'dev/copypaste-delivery';Q=R/'docs/quality/integrated-round-205'
for p in [W/'src/task-tool-state.ts',N/'renderer/src/task-tool-state.ts']:
 s=p.read_text('utf-8').replace('if(!tools.has(key))delta++;','if(!tools.has(key) && !(useSummary && validRef(event.body?.repair_of)))delta++;');p.write_text(s,'utf-8')
harness='''import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {Preferences,useI18n} from '../src/ui';import {TaskToolFeedback} from '../src/task-tool-feedback';
import {retainTaskActivity,type ActivityEvent} from '../src/task-tool-state';import '../src/style.css';
const a='205a205a205a205a',b='205b205b205b205b';
const failure=(id:number,ref:string)=>({id,kind:'runtime.tool.failed',body:{outcome_version:2,tool:'chart_render',code:'TOOL_INPUT_INVALID',category:'validation',call_ref:ref,failure_ref:ref}});
function Preview(){const {t}=useI18n();const [events,setEvents]=useState<ActivityEvent[]>([failure(1,a),failure(2,b)]),[status,setStatus]=useState('running');
 const complete=(id:number,ref?:string)=>setEvents(old=>retainTaskActivity(old,[{id,kind:'runtime.tool.completed',body:{outcome_version:2,tool:'chart_render',call_ref:'205c205c205c205c',...(ref?{repair_of:ref}:{})}}]));
 return <main style={{maxWidth:800,margin:'3rem auto',padding:'1.5rem'}}><section className="card"><p className="eyebrow">COPYPASTE · CONTROLLED UI SCENARIO</p><h1>{t('逐項交付與修正','Delivery and individual corrections')}</h1><p>{t('受控情境：兩份圖表各自失敗，另一份成功不會抹去它們。此頁並非正式用戶工作或模型驗收。','Controlled scenario: two chart outputs failed independently. Another successful output does not clear them. This is not a live customer task or model acceptance.')}</p>
 <div className="button-row"><button onClick={()=>complete(3)}>{t('完成另一份成果','Complete another output')}</button><button onClick={()=>setEvents(old=>retainTaskActivity(old,Array.from({length:800},(_,i)=>({id:i+4,kind:'message.appended'}))))}>{t('加入長回覆','Add a long reply')}</button><button onClick={()=>setStatus('failed')}>{t('工作結束','Finish task')}</button><button onClick={()=>complete(900,a)}>{t('修正第一項','Correct the first output')}</button><button onClick={()=>{complete(901,b);setStatus('succeeded');}}>{t('修正第二項','Correct the second output')}</button></div>
 <TaskToolFeedback events={events} status={status} errorCode={status==='failed'?'TOOL_DELIVERY_INCOMPLETE':null}/>{status==='succeeded'&&<p className="notice" role="status">{t('兩項修正均已確認，原用量記錄保留。','Both corrections are confirmed. Original recorded usage remains.')}</p>}</section></main>;}
createRoot(document.getElementById('root')!).render(<Preferences><Preview/></Preferences>);
'''
(W/'scripts/tool-feedback-harness-205-v1.tsx').write_text(harness,'utf-8')
qa=(L/'scripts/qualify-tool-feedback-ui-204-v3.mjs').read_text('utf-8').replace('acceptance-204/feedback-ui-v3','acceptance-205/feedback-ui-v1').replace('stage:204','stage:205').replace('204-v3','205-v1').replace('tool-feedback-harness-204-v1','tool-feedback-harness-205-v1').replace("name:'交付狀態與恢復'","name:'逐項交付與修正'")
qa=qa.replace("await page.getByRole('button',{name:'加入長回覆',exact:true}).click();","await page.getByRole('button',{name:'完成另一份成果',exact:true}).click();assert.equal(await page.locator('.task-tool-feedback details').count(),2);\n await page.getByRole('button',{name:'加入長回覆',exact:true}).click();")
qa=qa.replace("await page.getByText('支援記錄',{exact:true}).click();","await page.getByText('支援記錄',{exact:true}).first().click();")
qa=qa.replace('204a204b204c204d','205b205b205b205b')
qa=qa.replace("name:'記錄成功修正'","name:'修正第一項'").replace("assert.equal(await page.locator('.task-tool-feedback').count(),0);await page.waitForTimeout(800);report.recordings.push", "assert.equal(await page.locator('.task-tool-feedback details').count(),1);await page.waitForTimeout(800);await page.getByRole('button',{name:'修正第二項',exact:true}).click();assert.equal(await page.locator('.task-tool-feedback').count(),0);await page.waitForTimeout(800);report.recordings.push")
qa=qa.replace("name:'Record a successful correction'","name:'Correct the first output'").replace(".click();assert.equal(await page.locator('.task-tool-feedback').count(),0);await page.getByText('The corrected step is complete. Its recorded usage is retained.'", ".click();assert.equal(await page.locator('.task-tool-feedback details').count(),1);await page.getByRole('button',{name:'Correct the second output',exact:true}).click();assert.equal(await page.locator('.task-tool-feedback').count(),0);await page.getByText('Both corrections are confirmed. Original recorded usage remains.'")
qa=qa.replace('Actual success clears unresolved feedback;', 'Only both exact corrections clear both pending outputs;')
(L/'scripts/qualify-tool-feedback-ui-205-v1.mjs').write_text(qa,'utf-8')
rows=[];extensions={'.ts','.tsx','.cts','.mts','.js','.mjs','.cjs','.css','.py','.cs'}
for repo in ['platform','web','admin','desktop','extension','delivery']:
 base=R/'dev'/('copypaste-'+repo)
 for folder in ['src']+(['renderer/src'] if repo=='desktop' else []):
  for p in sorted((base/folder).rglob('*')):
   if p.is_file() and p.suffix in extensions:
    b=p.read_bytes();rows.append({'path':p.relative_to(R).as_posix(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
migrations=[{'path':p.relative_to(R).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((R/'dev/copypaste-platform/migrations').glob('*.sql'))]
assert len(migrations)==166
report={'stage':205,'status':'implementation_batch_complete_before_build_and_test','at':datetime.now(timezone.utc).isoformat(),'production_source_files':rows,'migration_files':migrations,'literal_markers':[r['path'] for r in rows if re.search(r'\b(?:TODO|FIXME|HACK|XXX)\b',(R/r['path']).read_text('utf-8',errors='replace'))],
 'scope':'All102 original requirements/32 groups inventoried. Complete autonomous package: exact cloud call obligations, explicit validated correction, durable RLS metadata, pruning-safe authorized summary with SSE/native cursor identity alignment, current UI/native media confirmation, forward schema166 and app-only backup/fallback. Paid unknown operations are not replayed. Original external, professional, production, native-general-tool and full download acceptance remain open.'}
p=Q/'implementation-batch-v1.json';assert not p.exists();p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps({'status':report['status'],'source_files':len(rows),'migrations':len(migrations),'literal_markers':report['literal_markers']}))
