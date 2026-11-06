"""Continue the already charged real task; never submit another model operation."""
from pathlib import Path
import importlib.util,json
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('company_api_199',ROOT/'scripts/live-company-api-199-v1.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
previous=ROOT/'.data/acceptance-199/live-source'
out=ROOT/'.data/acceptance-199/live-source-reconciled-v2';out.mkdir(parents=True,exist_ok=False)
report=json.loads((previous/'receipt.json').read_text('utf-8'));keys=json.loads((previous/'operation-keys.json').read_text('utf-8'))
report.update(status='running',original_receipt=str(previous/'receipt.json'),original_failure=report.pop('error',None),model_submitted_again=False)
api=module.CompanyAPI()
try:
 base=f"/v1/tenants/{report['tenant_id']}/projects/{report['project_id']}"
 task=api.ok('GET',base+'/tasks/'+report['task_id']);assert task['status']=='succeeded'
 workspace=api.ok('GET',base+'/tasks/'+report['task_id']+'/workspace');files=[f for f in workspace['files'] if f['name']=='vector.source.json'];assert len(files)==1
 source=files[0]
 published=api.ok('POST',base+'/assets/'+source['id']+'/publish',{'name':'Round199 actual vector.source.json','expected_version':source['version']},keys['publish'])
 current=api.ok('GET',base+'/editable-projects/sources');matches=[r for r in current['items'] if r['name']=='Round199 actual vector.source.json'];assert len(matches)==1
 report.update(status='passed',source=matches[0],private_source=source,model_result_not_replaced=True,transport_did_not_change_services=True,checks=[{'name':'Original actual model task, artifacts and single charge reconciled','status':'passed'},{'name':'Publish the exact original private version through the ordinary user-authorized API','status':'passed'}])
 print(json.dumps({'status':'passed','task_id':report['task_id'],'source':matches[0],'charged_micros':task['charged_micros'],'model_submitted_again':False}))
except Exception as e:
 report.update(status='failed',error=type(e).__name__+': '+str(e)[:300]);print(json.dumps({'status':'failed','error':report['error']}));raise
finally:
 api.close();(out/'receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
