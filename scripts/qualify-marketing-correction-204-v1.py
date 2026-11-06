"""One collected QA brief correction; preserve successful, failed and unknown work.

Continue the existing measured question checkpoint; do not submit a replacement.
Only known terminal failures get linked correction tasks. No paid POST retries.
"""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,http.client,importlib.util,json,time,uuid

R=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('company_203_corrected',R/'scripts/live-company-api-199-v1.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OUT=R/'.data/acceptance-204/marketing-correction-v1';OUT.mkdir(parents=True,exist_ok=False)
TENANT='f5b06ebd-ec59-414c-ad1a-04224d202fc0';PROJECT='f3374e9e-d591-4ff0-9b83-0b0dd1f1be8a'
BASE=f'/v1/tenants/{TENANT}/projects/{PROJECT}'
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n','utf-8')
def load(p):return json.loads(p.read_text('utf-8'))
def digest(b):return hashlib.sha256(b).hexdigest()
previous=load(R/'.data/acceptance-203/real-specialists-v4/receipt.json')
brief=load(R/'.data/acceptance-203/real-specialists-v1/203-controlled-design-brief.txt.source.json')
csv=load(R/'.data/acceptance-203/real-specialists-v1/203-controlled-performance.csv.source.json')
common=("Controlled QA functional sample; not customer-approved professional design. Use only this task's actual authorized company tools and exact selected source. "
 "Do not change settings, publish, send messages, install packages or fetch external URLs. Do not generate paid raster images, audio or video. "
 "Never invent source values, receipts, IDs or success. A new workspace has no index.html: create it directly with code_write; do not read a nonexistent new file. "
 "For editing an existing source, first read its exact current bytes/hash. A failed assertion is a debugging observation: inspect the real receipt/DOM/source, correct the source, and rerun the real check, at most twice. "
 "Do not weaken assertions or forge pass records. Stop and report an actual unavailable/denied tool. Deliver actual downloadable files, not prose. "
 "Do not hand-write a manifest: code_package produces exact sources and immutable executed check receipts. ")
cases=[
 {'role':'information-design','existing_task_id':'17a79b3c-761c-4894-a8ae-55e600f0583a','tools':['analysis_file_inspect','sheet_calculate','chart_render'],'file':csv},
 {'role':'ui-ux','tools':['code_write','browser_preview','code_package'],'file':brief,'prompt':
  'Create a minimal accessible offline two-step enquiry index.html using CopyPaste blue #194BFB, ink #15181D and paper #F6F7F9. Unique labeled email input #email, visible enabled type=button #next, clear step progress, and a review #review initially hidden. The explicit click handler uses email.checkValidity(): invalid input stays at step one; valid hello@example.com displays that email in the visible review. Keep styles compact. Use two independent actual browser_preview calls on these same source bytes: one fills not-an-email and clicks #next, asserting review remains hidden and step one remains visible; the other starts a fresh page, fills hello@example.com, clicks #next and asserts visible review containing that email and step-two progress. Checks must pass before code_package. A generated prototype check failure is not a successful deliverable.'},
 {'role':'landing-page','tools':['code_write','browser_preview','code_package'],'file':brief,'prompt':
  'Create a compact offline responsive Hong Kong agency landing page index.html, CopyPaste blue/ink/paper and a labeled enquiry input #name. A visible enabled type=button #submit has an explicit click handler displaying Thank you, CopyPaste in #confirmation when #name is CopyPaste. No form navigation/network. Create this new file directly, then actual browser_preview fills #name, clicks #submit, asserts visible #confirmation and exact text Thank you, CopyPaste. Deliver code_package immediately after a passing actual check. Do not stop merely because no new source file exists before creation.'},
 {'role':'marketing-analyst','tools':['analysis_file_inspect','sheet_calculate','chart_render'],'file':csv,'prompt':
  "As the author of this controlled QA CSV, I explicitly confirm the date column uses Asia/Hong_Kong. Inspect actual selected CSV with analysis_file_inspect. Use sheet_calculate to compare 2026-10-08 vs 2026-10-01, grouped by channel, currency HKD, account sample-203, attribution 7d click and conversion Purchase, timezone Asia/Hong_Kong. Use confirmed column mapping, exact source rows and scope. Then chart_render actual SVG/PNG/CSV/HTML/evidence-source/ZIP, selecting spend and clicks with exact evidence placeholders for any numerical narrative. Include exact metrics/facts. Identify a cautious next test without causal/ROI guarantees. Label controlled QA data. Actual downloadable evidence files are required."},
]
assert {c['role'] for c in cases}=={'information-design','ui-ux','landing-page','marketing-analyst'}
assert all(next(x for x in previous['items'] if x['role']==c['role'])['status']!='passed_controlled_functional_sample' for c in cases)
cases=[next(c for c in cases if c['role']=='marketing-analyst')]
cases[0]['prompt'] += " Use a nonnumerical chart title. Keep actual date values in the returned calculation/specification, not in title or narrative prose. Use exact returned current scope IDs and calculation_sha256. Optional narrative can be omitted; this must not remove any requested data or evidence. If a safe tool response explicitly proves input validation did not execute the operation, correct those arguments within this same task and original budget once. Never retry an unknown operation, rerun completed paid work, weaken evidence validation, or report prose as file delivery."
save(OUT/'planned-cases.private.json',{'cases':cases,'retained_passes_not_repeated':11,'new_task_budgets_HKD':5,'new_tasks_maximum':1,'continuation_uses_original_budget':True,'correction_scope':'One collected brief correction; no automatic extra paid task if it fails.'})

def get_bytes(api,path):
 assert path.startswith(BASE+'/assets/') and '/download?version=' in path
 channel=api.t.open_channel('direct-tcpip',('127.0.0.1',63073),('127.0.0.1',0),timeout=15);channel.settimeout(90)
 try:
  headers={'Host':'ai-api.copypaste.hk','Origin':'https://agent.copypaste.hk','Cookie':api.cookie,'X-Tenant-ID':TENANT,'Connection':'close'}
  channel.sendall(('GET '+path+' HTTP/1.1\r\n'+''.join(k+': '+v+'\r\n' for k,v in headers.items())+'\r\n').encode())
  response=http.client.HTTPResponse(channel);response.begin();assert response.status==200;return response.read()
 finally:channel.close()

def inspect_result(api,task_id,case,folder,report):
 deadline=time.monotonic()+540;last=None
 while True:
  task=api.ok('GET',BASE+'/tasks/'+task_id);state=task['status']
  if state!=last:print(json.dumps({'role':case['role'],'task_id':task_id,'status':state}),flush=True);last=state
  if state in ['succeeded','failed','cancelled','needs_input','awaiting_approval','reconciling']:break
  if time.monotonic()>deadline:raise TimeoutError('Original task retained without resubmission; bounded observation ended')
  time.sleep(3)
 save(folder/'task.private.json',task);report['task']={k:task.get(k) for k in ['status','kernel','role_key','role_hash','runtime_thread','charged_micros','data_mode','error_code','budget_micros']}
 events=[];after=0
 while True:
  page=api.ok('GET',BASE+'/tasks/'+task_id+'/events?after='+str(after))['items'];events.extend(page)
  if len(page)<200:break
  after=max(int(e['id']) for e in page)
 save(folder/'events.private.json',events);report['skills_loaded']=[e['body'] for e in events if e['kind']=='skills.loaded'];report['event_kinds']=sorted({e['kind'] for e in events})
 workspace=api.ok('GET',BASE+'/tasks/'+task_id+'/workspace');save(folder/'workspace.private.json',workspace);report['files']=[]
 for file in workspace['files']:
  raw=get_bytes(api,BASE+'/assets/'+file['id']+'/download?version='+str(file['version']));assert len(raw)==int(file['bytes']) and digest(raw)==file['sha256']
  (folder/(file['version_id']+'.artifact')).write_bytes(raw);report['files'].append({k:file[k] for k in ['name','version_id','mime_type','bytes','sha256']})
  if file['name'].endswith('.json'):
   value=json.loads(raw)
   if isinstance(value,dict) and value.get('execution_id') and value.get('program'):report.setdefault('native_execution_receipts',[]).append({k:value.get(k) for k in ['execution_id','program','passed','exit_code','source_digest']})
 assert task['status']=='succeeded',report['task']
 assert task['data_mode']=='configured_services' and task['kernel']=='codex' and 0<int(task['charged_micros'])<=5000000
 assert report['skills_loaded'] and report['files']
 names=[f['name'].lower() for f in report['files']];assert any(n.endswith('.zip') for n in names)
 if case['role'] in ['ui-ux','landing-page']:
  assert any(r['program']=='browser_preview' and r['passed'] is True and r.get('exit_code',0) in [None,0] for r in report.get('native_execution_receipts',[])),report.get('native_execution_receipts',[])
 else:assert any(n.endswith('.png') for n in names) and any(n.endswith('.json') for n in names) and any(n.endswith('.csv') for n in names)
 report['status']='passed_controlled_functional_sample'

def trial(case):
 folder=OUT/case['role'];folder.mkdir();api=m.CompanyAPI();report={'role':case['role'],'status':'running','customer_professional_approval':False,'required_tools':case['tools']}
 try:
  prior=next(x for x in previous['items'] if x['role']==case['role'])
  if case.get('existing_task_id'):
   task_id=case['existing_task_id'];assert task_id==prior['task_id'];report.update(task_id=task_id,known_task_continuation=True)
   task=api.ok('GET',BASE+'/tasks/'+task_id);assert task['status']=='needs_input' and task['pause_requested'] is False
   deps=api.ok('GET',BASE+'/tasks/'+task_id+'/dependencies')['items'];pending=[d for d in deps if d['state']=='pending']
   assert len(pending)==1 and pending[0]['kind']=='question' and 'timezone' in pending[0]['description'].lower() and pending[0]['checkpoint_id']
   d=pending[0];path=f'/v1/tenants/{TENANT}/task-dependencies/'+d['id']+'/resolutions';key=str(uuid.uuid4())
   body={'expected_version':d['version'],'answer':'Asia/Hong_Kong. I am the author of this controlled QA CSV and confirm this timezone defines its date column. Keep the original approved reporting dates, currency, account, attribution and conversion, and deliver actual chart evidence files.'}
   save(folder/'original-request.private.json',{'endpoint':path,'key':key,'body':body,'original_task_id':task_id,'checkpoint_id':d['checkpoint_id']})
   resolved=api.ok('POST',path,body,key);save(folder/'input-resolution.private.json',resolved)
   report['continuation']='Original measured checkpoint queues automatically after the last pending answer; no new task or manual retry/resume.'
  else:
   source=case['file'];version=source['version']['id'];asset=source['id']
   body={'title':'204 linked controlled '+case['role'],'role_key':case['role'],'mode':'execute','budget_micros':5000000,'prompt':common+f'First asset_text_read the selected source asset_id={asset}, pinned version={version}. '+case['prompt'],'dependencies':[{'kind':'file','description':'Explicitly selected controlled acceptance source','resource_ids':[version]}]}
   if prior.get('task_id'):
    terminal=api.ok('GET',BASE+'/tasks/'+prior['task_id']);assert terminal['status'] in ['succeeded','failed','cancelled']
    body['parent_id']=prior['task_id'];report['known_terminal_correction_of']=prior['task_id']
   else:assert 'PLAN_TASK_LIMIT' in prior.get('error','');report['definite_not_admitted_replacement_brief']=True
   key=str(uuid.uuid4());save(folder/'original-request.private.json',{'endpoint':BASE+'/tasks','key':key,'body':body})
   task=api.ok('POST',BASE+'/tasks',body,key);task_id=task['id'];report['task_id']=task_id;save(folder/'submission.private.json',task)
  report['idempotency_key']=key;save(folder/'progress.json',report)
  inspect_result(api,task_id,case,folder,report)
 except Exception as e:report.update(status='failed_or_requires_investigation',error=type(e).__name__+': '+str(e)[:700])
 finally:api.close();report['finished_at']=datetime.now(timezone.utc).isoformat();save(folder/'receipt.json',report)
 print(json.dumps({'role':case['role'],'status':report['status'],'error':report.get('error'),'files':len(report.get('files',[]))}),flush=True);return report

report={'stage':204,'status':'running','professional_customer_acceptance':False,'transport':'Authenticated SSH to unchanged real deployed API; no replacement models or replies','items':[],'maximum_new_task_HKD':5,'existing_task_original_budget_HKD':5}
try:
 for case in cases:
  report['items'].append(trial(case));save(OUT/'progress.json',report)
 report['status']='passed_controlled_functional_samples' if all(x['status']=='passed_controlled_functional_sample' for x in report['items']) else 'failures_for_integrated_debugging'
finally:
 report['actual_charge_micros']=str(sum(int(x.get('task',{}).get('charged_micros') or 0) for x in report['items']))
 report['finished_at']=datetime.now(timezone.utc).isoformat();save(OUT/'receipt.json',report)
print(json.dumps({'status':report['status'],'roles':len(report['items']),'actual_charge_micros':report['actual_charge_micros'],'receipt':str(OUT/'receipt.json')}),flush=True)
assert report['status']=='passed_controlled_functional_samples'
