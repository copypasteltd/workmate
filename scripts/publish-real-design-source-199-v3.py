"""Publish the original actual task output after the source-classification fix."""
from pathlib import Path
import importlib.util,json,uuid
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('company_api_199',ROOT/'scripts/live-company-api-199-v1.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
old=ROOT/'.data/acceptance-199/live-source/receipt.json';report=json.loads(old.read_text('utf-8'))
out=ROOT/'.data/acceptance-199/live-source-v3';out.mkdir(parents=True,exist_ok=False)
key=str(uuid.uuid4());(out/'operation-key.json').write_text(json.dumps({'publish':key})+'\n','utf-8')
report.update(status='running',original_receipt=str(old),original_failure=report.pop('error',None),model_submitted_again=False)
api=module.CompanyAPI()
try:
 base=f"/v1/tenants/{report['tenant_id']}/projects/{report['project_id']}"
 task=api.ok('GET',base+'/tasks/'+report['task_id']);assert task['status']=='succeeded' and int(task['charged_micros'])==38898
 files=api.ok('GET',base+'/tasks/'+report['task_id']+'/workspace')['files'];matches=[f for f in files if f['name']=='vector.source.json'];assert len(matches)==1;source=matches[0]
 published=api.ok('POST',base+'/assets/'+source['id']+'/publish',{'name':'Round199 editable vector.source.json','expected_version':source['version']},key)
 report['published_id']=published['id'];report['published_version_id']=published['version']['id'];(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n','utf-8')
 current=api.ok('GET',base+'/editable-projects/sources');matches=[r for r in current['items'] if r['source_version_id']==published['version']['id']];assert len(matches)==1
 assert matches[0]['sha256']==source['sha256']
 report.update(status='passed',source=matches[0],private_source=source,model_result_not_replaced=True,transport_did_not_change_services=True,charged_micros=task['charged_micros'],checks=[{'name':'Original paid cloud Codex output and single HK$0.038898 charge reconciled','status':'passed'},{'name':'Ordinary authorized publication preserves exact source bytes and editable discovery','status':'passed'}])
 print(json.dumps({'status':'passed','task_id':report['task_id'],'source':matches[0],'charged_micros':task['charged_micros'],'model_submitted_again':False}))
except Exception as e:
 report.update(status='failed',error=type(e).__name__+': '+str(e)[:300]);print(json.dumps({'status':'failed','error':report['error']}));raise
finally:
 api.close();(out/'receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
