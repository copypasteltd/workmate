"""Bounded actual company Codex role trials. Never retry a paid POST.

Controlled QA inputs are not customer data or professional customer approval.
All exact requests and idempotency keys are retained before dispatch.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone
import base64,hashlib,http.client,importlib.util,json,time,uuid,zipfile,io

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('company_api_203',ROOT/'scripts/live-company-api-199-v1.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
OUT=ROOT/'.data/acceptance-203/real-specialists-v3';OUT.mkdir(parents=True,exist_ok=False)
TENANT='f5b06ebd-ec59-414c-ad1a-04224d202fc0';PROJECT='f3374e9e-d591-4ff0-9b83-0b0dd1f1be8a'
BASE=f'/v1/tenants/{TENANT}/projects/{PROJECT}'
sha=lambda b:hashlib.sha256(b).hexdigest()
def save(p,data):p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n','utf-8')
def get_bytes(api,path):
 assert path.startswith(BASE+'/assets/') and '/download?version=' in path
 channel=api.t.open_channel('direct-tcpip',('127.0.0.1',63073),('127.0.0.1',0),timeout=15);channel.settimeout(90)
 try:
  headers={'Host':'ai-api.copypaste.hk','Origin':'https://agent.copypaste.hk','Cookie':api.cookie,'X-Tenant-ID':TENANT,'Connection':'close'}
  channel.sendall(('GET '+path+' HTTP/1.1\r\n'+''.join(k+': '+v+'\r\n' for k,v in headers.items())+'\r\n').encode())
  r=http.client.HTTPResponse(channel);r.begin();assert r.status==200;return r.read()
 finally:channel.close()
def upload(api,name,content,mime):
 raw=content.encode('utf-8');digest=sha(raw);prefix=BASE+'/uploads'
 request={'project_id':PROJECT,'filename':name,'content_type':mime,'size_bytes':len(raw),'sha256':digest}
 keys={k:str(uuid.uuid4()) for k in ['create','part','complete']};save(OUT/(name+'.upload.json'),{'request':request,'keys':keys})
 created=api.ok('POST',prefix,request,keys['create']);uid=created.get('upload_id',created.get('id'));uuid.UUID(uid)
 api.ok('POST',prefix+'/'+uid+'/parts/0',{'sha256':digest,'base64':base64.b64encode(raw).decode()},keys['part'])
 result=api.ok('POST',prefix+'/'+uid+'/complete',{'sha256':digest,'size_bytes':len(raw)},keys['complete'])
 save(OUT/(name+'.source.json'),result);return result

common=('This is a controlled functional acceptance sample, not a customer-approved professional design. '
 'Use only this task\'s authorized company tools and actual source bytes. Do not change account settings, publish, send messages, install packages or fetch external URLs. '
 'Do not generate images, audio or video in these bounded trials. Do not invent IDs, tool receipts, source numbers or execution results. '
 'If a required tool is unavailable or fails, state the actual error and stop rather than claiming success. Deliver actual downloadable files, not only prose. ')
code={
 'fullstack':'Create an offline quote calculator index.html. An input #quantity defaults to 2, a button #calculate computes quantity times 125, and #total displays HK$250 for quantity 2. Use code_write, actual browser_preview fill/click and a named DOM assertion for HK$250, then code_package. No frameworks.',
 'frontend':'Create a responsive offline task list index.html with input #task, button #add and ul #tasks. Enter CopyPaste launch in the actual browser_preview, click Add and assert the item exists. Include keyboard-accessible labels and CopyPaste blue. Deliver exact source and browser receipt via code_package.',
 'backend-api':'Create handler.cjs exporting a Node HTTP handler. GET /quote?quantity=2 returns JSON {quantity:2,total:250,currency:"HKD"}; invalid negative quantity returns 400. Use actual api_test on both cases and code_package with exact sources and immutable receipts. Do not start a network server.',
 'software-qa':'Create price.cjs exporting quote(q) returning q*125 for positive integer q and throwing for negative/zero/noninteger. Create price.test.cjs with real node:test assertions covering 2=>250, 1=>125, 0, -1, 1.5. Run actual process_run_allowed program=node_test on price.test.cjs, inspect its exit code and deliver code_package. Do not merely list test cases.',
 'ui-ux':'Create an offline accessible two-step enquiry prototype index.html with visible progress, labeled #email, #next and #review. Invalid email must not advance; hello@example.com advances to a review containing that email. Use actual browser_preview for the valid flow and assertions, then code_package. Use CopyPaste blue and a clear primary action.',
 'landing-page':'Create an offline responsive Hong Kong agency landing page index.html using CopyPaste blue/ink/paper, with a project enquiry form. #name accepts CopyPaste; #submit displays Thank you, CopyPaste in #confirmation. Actual browser_preview must exercise that interaction and assert its text. Deliver code_package including sources and check receipt.'}
def role_cases(brief,csv):
 cases=[{'role':r,'prompt':p,'tools':['code_write','code_package',('api_test' if r=='backend-api' else 'process_run_allowed' if r=='software-qa' else 'browser_preview')],'file':brief} for r,p in code.items()]
 cases.extend([
  {'role':'designer','prompt':'Use font_catalog and design_render to create an actual 1200x800 PNG poster plus its editable source for the attached approved sample brief. Headline: Make room for your next idea. Small line: COPYPASTE / CONTROLLED SAMPLE. Use blue #194BFB, ink #15181D and paper #F6F7F9, readable type and a restrained single focal shape. No paid raster generation. Deliver actual PNG and editable JSON.','tools':['font_catalog','design_render'],'file':brief},
  {'role':'typography-layout','prompt':'Use font_catalog and design_render to make a typography-first actual 1200x800 PNG and editable JSON. Headline: Clear ideas. Better work. Caption: COPYPASTE / CONTROLLED SAMPLE. Use supplied brief colors, sufficient contrast, generous line spacing and no clipping. No external fonts or image generation. Deliver the actual files.','tools':['font_catalog','design_render'],'file':brief},
  {'role':'brand-visual','prompt':'Use vector_render to create actual editable SVG, PNG and immutable vector source for the sample brand. Canvas1200x800; paper #F6F7F9; blue #194BFB rectangle x48 y48 w1104 h704 radius24; white text Make room for your next idea. in a generous box x120 y180 w950 h200 font64; bottom caption COPYPASTE / CONTROLLED SAMPLE x120 y550 w900 h70 font24. Use exact geometry with line wrapping as needed and no text overflow. Deliver original SVG/source/manifest/ZIP.','tools':['vector_render'],'file':brief},
  {'role':'presentation','prompt':'Use slides_build then slides_render to create an actual two-slide editable PPTX and source-based previews. Audience: Hong Kong marketing team; decision: approve a small creative test. Both slides1200x800. Slide1 headline Clear ideas. Better work. and a short controlled sample caption. Slide2 headline Next step with three concise actions: Review brief; Prepare creative; Measure results. Use #194BFB/#15181D/#F6F7F9, roomy text boxes, speaker notes and no charts or invented performance numbers. Deliver actual PPTX, source JSON and previews; a draft alone is insufficient.','tools':['slides_build','slides_render'],'file':brief},
  {'role':'information-design','prompt':'Inspect the attached actual CSV with analysis_file_inspect. Calculate with sheet_calculate for 2026-10-08 only, group_by channel, currency HKD, account sample-203, attribution 7d click, conversion Purchase. Use confirmed CSV columns and definitions. Render real exact evidence SVG/PNG/CSV/HTML/source/ZIP with chart_render, selecting spend/clicks, current period only. Any numerical narrative must use exact evidence placeholders; do not invent values. Clearly label controlled QA data.','tools':['analysis_file_inspect','sheet_calculate','chart_render'],'file':csv},
  {'role':'marketing-analyst','prompt':'Inspect the actual attached CSV with analysis_file_inspect. With sheet_calculate compare 2026-10-08 vs2026-10-01 by channel, HKD, account sample-203, attribution 7d click, conversion Purchase. Use confirmed column mapping. Render actual chart_render files including exact metrics CSV, facts CSV and evidence source. All quantitative narrative must use evidence placeholders. Identify a cautious next test, not a causal claim or ROI guarantee. Clearly label controlled QA inputs.','tools':['analysis_file_inspect','sheet_calculate','chart_render'],'file':csv}
 ]);assert len(cases)==12;return cases

def trial(case):
 folder=OUT/case['role'];folder.mkdir();api=module.CompanyAPI();report={'role':case['role'],'status':'running','customer_professional_approval':False,'required_tools':case['tools']}
 try:
  file=case['file'];version=file['version']['id'];asset=file['id']
  source=f'First read the explicitly selected source with asset_text_read asset_id={asset}. Its pinned version is {version}. '
  body={'title':'203 controlled '+case['role'],'role_key':case['role'],'mode':'execute','budget_micros':5000000,'prompt':common+source+case['prompt'],'dependencies':[{'kind':'file','description':'Explicitly selected controlled acceptance source','resource_ids':[version]}]}
  prior=next(r for r in prior_report['items'] if r['role']==case['role'])
  assert prior['status']!='passed_controlled_functional_sample'
  original=json.loads((ROOT/'.data/acceptance-203/real-specialists-v2'/case['role']/'original-request.private.json').read_text('utf-8'))
  if prior.get('task_id'):
   terminal=api.ok('GET',BASE+'/tasks/'+prior['task_id']);assert terminal['status'] in ['failed','cancelled','succeeded']
   body={**body,'parent_id':prior['task_id']};key=str(uuid.uuid4());report['known_terminal_correction_of']=prior['task_id']
   if case['role']=='backend-api':body['prompt']+=' This is a new empty workspace. Create handler.cjs directly with code_write; do not read a nonexistent new source. Use named exported handler if api_test requires it. Do not create a manual manifest; code_package records the real execution receipts.'
   elif case['role']=='ui-ux':body['prompt']+=' Keep delivery minimal: write only index.html, exercise the requested valid flow with browser_preview, then call code_package immediately. Do not write a manual manifest or extra reports. The previous terminal task is preserved; this is an explicitly linked correction, not a replay of an unknown task.'
  else:
   assert 'PLAN_TASK_LIMIT' in prior['error'];assert original['body']==body;key=original['key'];report['definite_not_admitted_retry']=True
  save(folder/'original-request.private.json',{'endpoint':BASE+'/tasks','key':key,'body':body});report['idempotency_key']=key
  task=api.ok('POST',BASE+'/tasks',body,key);report['task_id']=task['id'];save(folder/'submission.private.json',task);save(folder/'progress.json',report)
  print(json.dumps({'role':case['role'],'task_id':task['id'],'status':'submitted','maximum_HKD':5}),flush=True)
  deadline=time.monotonic()+480;last=None
  while True:
   task=api.ok('GET',BASE+'/tasks/'+task['id']);state=task['status']
   if state!=last:print(json.dumps({'role':case['role'],'task_id':task['id'],'status':state}),flush=True);last=state
   if state in ['succeeded','failed','cancelled','needs_input','awaiting_approval','reconciling']:break
   if time.monotonic()>deadline:raise TimeoutError('Bounded observation ended; original task is retained and must not be resubmitted')
   time.sleep(3)
  save(folder/'task.private.json',task);report['task']={k:task.get(k) for k in ['status','kernel','role_key','role_hash','runtime_thread','charged_micros','cost_state','data_mode','error_code','budget_micros']}
  events=[];after=0
  while True:
   page=api.ok('GET',BASE+'/tasks/'+task['id']+'/events?after='+str(after))['items'];events.extend(page)
   if len(page)<200:break
   after=max(int(x['id']) for x in page)
  save(folder/'events.private.json',events)
  report['event_kinds']=sorted(set(e['kind'] for e in events));report['skills_loaded']=[e['body'] for e in events if e['kind']=='skills.loaded']
  report['tool_execution_proof']='Collected separately from immutable server tool receipts and exact artifact metadata; model prose and event text are not execution proof.'
  workspace=api.ok('GET',BASE+'/tasks/'+task['id']+'/workspace');save(folder/'workspace.private.json',workspace);report['files']=[]
  for f in workspace['files']:
   raw=get_bytes(api,BASE+'/assets/'+f['id']+'/download?version='+str(f['version']))
   assert len(raw)==int(f['bytes']) and sha(raw)==f['sha256'],f['name']
   (folder/(f['version_id']+'.artifact')).write_bytes(raw)
   report['files'].append({k:f[k] for k in ['name','version_id','mime_type','bytes','sha256']})
   if f['name'].endswith('.pptx'):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:assert '[Content_Types].xml' in z.namelist() and 'ppt/presentation.xml' in z.namelist()
   if f['name'].endswith('.json'):
    evidence=json.loads(raw)
    if isinstance(evidence,dict) and evidence.get('execution_id') and evidence.get('program'):
     report.setdefault('native_execution_receipts',[]).append({k:evidence.get(k) for k in ['execution_id','program','passed','exit_code','source_digest']})
  assert task['status']=='succeeded',report['task'];assert task['data_mode']=='configured_services' and task['kernel']=='codex'
  assert 0<int(task['charged_micros'])<=5000000 and report['skills_loaded'] and report['files']
  names=[f['name'].lower() for f in report['files']]
  if case['role'] in code:
   assert any(n.endswith('.zip') for n in names)
   expected='api_test' if case['role']=='backend-api' else 'node_test' if case['role']=='software-qa' else 'browser_preview'
   assert any(r['program']==expected and r['passed'] is True and r.get('exit_code',0) in [None,0] for r in report.get('native_execution_receipts',[])),report.get('native_execution_receipts',[])
  elif case['role']=='presentation':assert any(n.endswith('.pptx') for n in names)
  elif case['role'] in ['designer','typography-layout']:assert any(n.endswith('.png') for n in names) and any(n.endswith('.editable.json') for n in names)
  else:assert any(n.endswith('.png') for n in names) and any(n.endswith('.json') for n in names) and any(n.endswith('.zip') for n in names)
  report['status']='passed_controlled_functional_sample'
 except Exception as e:report.update(status='failed_or_requires_investigation',error=type(e).__name__+': '+str(e)[:500])
 finally:api.close();report['finished_at']=datetime.now(timezone.utc).isoformat();save(folder/'receipt.json',report)
 print(json.dumps({'role':case['role'],'status':report['status'],'error':report.get('error'),'files':len(report.get('files',[]))}),flush=True);return report

api=module.CompanyAPI();report={'stage':203,'status':'running','maximum_total_HKD':45,'source_kind':'explicitly controlled QA fixtures','transport':'Authenticated SSH to unchanged deployed API; no response or model replacement, no public TLS/browser claim','professional_customer_acceptance':False,'items':[]}
try:
 catalog=api.ok('GET','/v1/catalog/roles');save(OUT/'role-readiness.json',catalog)
 prior_report=json.loads((ROOT/'.data/acceptance-203/real-specialists-v2/receipt.json').read_text('utf-8'));assert prior_report['status']=='failures_for_integrated_debugging'
 brief=json.loads((ROOT/'.data/acceptance-203/real-specialists-v1/203-controlled-design-brief.txt.source.json').read_text('utf-8'))
 csv=json.loads((ROOT/'.data/acceptance-203/real-specialists-v1/203-controlled-performance.csv.source.json').read_text('utf-8'))
 all_cases=role_cases(brief,csv);cases=[c for c in all_cases if next(r for r in prior_report['items'] if r['role']==c['role'])['status']!='passed_controlled_functional_sample'];report['retained_successful_tasks']=[r for r in prior_report['items'] if r['status']=='passed_controlled_functional_sample'];assert len(cases)==9;assert all(next(x for x in catalog['items'] if x['role_key']==c['role'])['available'] is True for c in cases)
 save(OUT/'planned-cases.private.json',cases);report['sources']=[{'asset_id':s['id'],'version_id':s['version']['id'],'sha256':s['version']['sha256']} for s in [brief,csv]];save(OUT/'progress.json',report)
 # Product task concurrency is bounded; these are not coding subagents.
 with ThreadPoolExecutor(max_workers=1) as pool:
  for future in as_completed([pool.submit(trial,c) for c in cases]):report['items'].append(future.result());save(OUT/'progress.json',report)
 report['status']='passed_controlled_functional_samples' if len(report['items'])==9 and all(x['status']=='passed_controlled_functional_sample' for x in report['items']) else 'failures_for_integrated_debugging'
 report['actual_charge_micros']=str(sum(int(x.get('task',{}).get('charged_micros') or 0) for x in report['items']))
finally:api.close();report['finished_at']=datetime.now(timezone.utc).isoformat();save(OUT/'receipt.json',report)
print(json.dumps({'status':report['status'],'roles':len(report['items']),'receipt':str(OUT/'receipt.json'),'actual_charge_micros':report.get('actual_charge_micros')}),flush=True)
assert report['status']=='passed_controlled_functional_samples'
