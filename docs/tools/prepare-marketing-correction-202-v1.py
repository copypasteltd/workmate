from pathlib import Path
import json,hashlib
from datetime import datetime,timezone
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';P=D/'copypaste-platform';N=D/'copypaste-desktop';O=R/'docs/quality/integrated-round-202'
# Preserve the executed fixture which correctly encountered the active-task cap.
s=(P/'tests/analysis-review-202-v1.test.ts').read_text('utf8')
s=s.replace('  for (let i = 1; i < 53; i++) ok(await call(f.owner, "POST", "/v1/reports", { ...body, expected_calculation_sha256: undefined, analysis: { ...review.spec, prompt: "Report history " + i } }));','  ok(await call(f.owner, "POST", f.base + "/tasks/" + first.task_id + "/cancel", {}));\n  for (let i = 1; i < 53; i++) { const report = ok(await call(f.owner, "POST", "/v1/reports", { ...body, expected_calculation_sha256: undefined, analysis: { ...review.spec, prompt: "Report history " + i } })); ok(await call(f.owner, "POST", f.base + "/tasks/" + report.task_id + "/cancel", {})); }')
(P/'tests/analysis-review-202-v2.test.ts').write_text(s,encoding='utf8',newline='\n')
s=(L/'scripts/qualify-marketing-review-202-v1.mjs').read_text('utf8').replace(".selectOption(w.project.id);",".selectOption(w.project.id);await page.getByRole('link',{name:'Marketing insights',exact:true}).click();",1).replace("'202-v1'","'202-v2'").replace('202-v1-marketing-review.png','202-v2-marketing-review.png').replace("./marketing-review-ui-202-v1.mjs","./marketing-review-ui-202-v2.mjs")
(L/'scripts/qualify-marketing-review-202-v2.mjs').write_text(s,encoding='utf8',newline='\n')
# All selector assertions should fail visibly; a disabled Previous is not an
# action and should not spend45seconds in an intentionally swallowed timeout.
s=(L/'scripts/marketing-review-ui-202-v1.mjs').read_text('utf8').replace("await pagination.getByRole('button',{name:'Previous',exact:true}).click().catch(()=>{});","if(await pagination.getByRole('button',{name:'Previous',exact:true}).isEnabled())await pagination.getByRole('button',{name:'Previous',exact:true}).click();")
(L/'scripts/marketing-review-ui-202-v2.mjs').write_text(s,encoding='utf8',newline='\n')
p=L/'scripts/qualify-live-marketing-review-202-v1.mjs';s=p.read_text('utf8').replace('./marketing-review-ui-202-v1.mjs','./marketing-review-ui-202-v2.mjs');p.write_text(s,encoding='utf8',newline='\n')
for p in [N/'scripts/package-integrated-202-v1.mjs',L/'scripts/finalize-release-metadata-202-v1.mjs']:
 s=p.read_text('utf8').replace('integrated-202-v1/verification.json','integrated-202-v2/verification.json');p.write_text(s,encoding='utf8',newline='\n')
batch=json.loads((O/'implementation-batch.json').read_text('utf8'))
for row in batch['production_source_files']:assert hashlib.sha256((R/row['path']).read_bytes()).hexdigest()==row['sha256'],row['path']
report={'stage':202,'at':datetime.now(timezone.utc).isoformat(),'status':'collected_correction_batch_complete_before_replay','production_source_changes':0,'scope':'Whole product batch unchanged. Preserve original147backend assertions (146passed); replay3marketing-review cases after using actual cancellation to retain53historical reports without bypassing the valid active-task cap. Browser driver explicitly re-enters Marketing insights after workspace selection redirects to home. User new constraint: no server network configuration edits; versioned deployment/download scripts will only change application files under existing paths.','retained':['.data/integrated-202-v1/verification.json','.data/acceptance-202/marketing-review-08a94a57-34af-4684-9db3-1ab7346e3126/receipt.json'],'production_source_files':batch['production_source_files']}
(O/'correction-batch-v1.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
print('Collected fixture, navigation driver and application-only deployment adjustments; all823product sources remain unchanged.')
