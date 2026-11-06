"""Read only the existing measured task and its original pending question."""
from pathlib import Path
import importlib.util,json
R=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('company_203_inspect',R/'scripts/live-company-api-199-v1.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
out=R/'.data/acceptance-203/specialist-continuation-inspection-v1.json';assert not out.exists()
base='/v1/tenants/f5b06ebd-ec59-414c-ad1a-04224d202fc0/projects/f3374e9e-d591-4ff0-9b83-0b0dd1f1be8a'
api=m.CompanyAPI()
try:
 task=api.ok('GET',base+'/tasks/17a79b3c-761c-4894-a8ae-55e600f0583a')
 deps=api.ok('GET',base+'/tasks/'+task['id']+'/dependencies')
 report={'task':{k:task.get(k) for k in ['id','status','version','runtime_thread','charged_micros','accrued_micros','pause_requested','error_code']},'dependencies':deps}
 out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
 print(json.dumps(report,ensure_ascii=False))
finally:api.close()
