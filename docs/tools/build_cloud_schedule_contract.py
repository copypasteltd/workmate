"""Build the additive private schedule contract from explicit route semantics."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
def obj(properties, required=None):
    return {'type':'object','additionalProperties':False,'properties':properties,'required':list(properties) if required is None else required}
def string(**kw): return {'type':'string',**kw}
uuid=string(format='uuid')
digest=string(pattern='^[a-f0-9]{64}$')
positive={'type':'integer','minimum':1,'maximum':9007199254740991}
budget={'type':'integer','minimum':0,'maximum':9007199254740991,'description':'Sum of fixed Codex child-step budgets, in HKD millionths. Not a prepaid fee or all-future-spend ceiling.'}
calendar=obj({'timezone':string(minLength=1,maxLength=80,description='Validated IANA zone.'),'frequency':string(enum=['daily','weekly']),'time':string(pattern='^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),'weekdays':{'type':'array','items':{'type':'integer','minimum':1,'maximum':7},'uniqueItems':True,'maxItems':7,'default':[],'description':'ISO weekday numbers. Daily uses []; weekly requires at least one.'}},['timezone','frequency','time'])
options={'name':string(minLength=1,maxLength=160),'calendar':calendar,'catch_up':string(enum=['latest','skip']),'starts_at':string(format='date-time',description='Optional current/future start; omitted value is frozen on the first identical model request.'),'ends_at':{'type':['string','null'],'format':'date-time'},'expected_output':string(minLength=3,maxLength=1000)}
required=[k for k in options if k!='starts_at']
schemas={
 'ScheduleOptions':obj(options,required),
 'PrepareFromRun':obj({**options,'source_run_id':uuid},required+['source_run_id']),
 'PrepareRevision':obj({**options,'expected_version':positive},required+['expected_version']),
 'ScheduleToolRequest':obj({**options,'workflow_id':uuid,'workflow_version':positive,'workflow_definition_hash':digest},required+['workflow_id','workflow_version','workflow_definition_hash']),
 'CustomerDecision':obj({'decision':string(enum=['activate','decline']),'specification_hash':digest,'max_budget_micros':budget}),
 'CustomerControl':obj({'action':string(enum=['pause','resume','retire']),'expected_version':positive,'specification_hash':digest,'max_budget_micros':budget}),
 'AdminPause':obj({'expected_version':positive,'reason':string(minLength=5,maxLength=1000)}),
 'Problem':{'type':'object','properties':{'error':{'type':'object','properties':{'code':string(),'message':string()}}}},
}
param=lambda n:{'name':n,'in':'path','required':True,'schema':uuid}
base='/v1/tenants/{tenant}/projects/{project}/cloud-workflow-schedules'
def operation(summary,body=None,admin=False,permissions=None):
    result={'summary':summary,'security':[{'AdminCookie':[]} if admin else {'UserCookie':[]},{'NativeBearer':[]}] if not admin else [{'AdminCookie':[]}],
      'responses':{'200':{'description':'Committed result or idempotent replay.'},'400':{'description':'Strict schema/calendar/interval validation failed.'},'401':{'description':'No current authenticated session.'},'403':{'description':'Permission, CSRF or recent-MFA requirement failed.'},'404':{'description':'Resource unavailable in this owner/scope.'},'409':{'description':'Exact version, digest, budget, source, current authority or lifecycle no longer permits this operation.'}},
      'x-cache-control':'no-store'}
    if body:
        result['requestBody']={'required':True,'content':{'application/json':{'schema':{'$ref':'#/components/schemas/'+body}}}}
        result['parameters']=[{'name':'Idempotency-Key','in':'header','required':True,'schema':string(pattern=r'^[\w:-]{16,128}$')},{'name':'X-CSRF-Token','in':'header','required':admin,'schema':string(),'description':'Required for user/admin cookie mutations; native bearer does not use cookie CSRF.'}]
    if permissions:result['x-permissions']=permissions
    return result
paths={}
def route(suffix,method,summary,body=None,query=None):
    full=base+suffix; item=paths.setdefault(full,{'parameters':[param(n) for n in ['tenant','project']+(['id'] if '{id}' in suffix else [])]})
    item[method]=operation(summary,body)
    if query:item[method].setdefault('parameters',[]).extend(query)
route('','get','Private owner list: pending requests, schedules and latest 100 actual occurrences.',query=[{'name':'task_id','in':'query','schema':uuid}])
route('/requests','post','Prepare a pending request from an exact existing private cloud run; never activates it.','PrepareFromRun')
route('/{id}/requests','post','Prepare an independently confirmed calendar revision with exact control version.','PrepareRevision')
route('/requests/{id}/decision','post','Explicit private customer activation or decline bound to exact digest and budget.','CustomerDecision')
route('/{id}/status','post','Pause future times, explicitly resume from now, or irreversibly retire. Current run is preserved.','CustomerControl')
route('/{id}','get','Owner history: latest 100 versions and cursor-paginated 50 occurrences, each with original calendar, run and settled charges.',query=[{'name':'before','in':'query','schema':uuid,'description':'Use next_cursor from the prior page; cursor must belong to the same private schedule.'}])
paths['/v1/admin/private-cloud-schedules']={'get':operation('Scoped metadata only; excludes name, prompts, expected outputs and source definitions.',admin=True,permissions=['admin.execution.read'])}
paths['/v1/admin/private-cloud-schedules']['get']['parameters']=[{'name':'page','in':'query','schema':{'type':'integer','minimum':1,'default':1}},{'name':'page_size','in':'query','schema':{'type':'integer','minimum':1,'maximum':100,'default':50}}]
paths['/v1/admin/private-cloud-schedules/{id}/pause']={'parameters':[param('id')],'post':operation('Recent-MFA scoped pause with reason and exact control version; records audit and preserves current work.','AdminPause',True,['admin.execution.pause'])}
paths['/v1/tenants/{tenant}/projects/{project}/cloud-workflows']={'parameters':[param('tenant'),param('project')],'get':operation('Existing private workflow listing, now with optional exact private run lookup before its 100-row limit.')}
paths['/v1/tenants/{tenant}/projects/{project}/cloud-workflows']['get']['parameters']=[{'name':'run_id','in':'query','schema':uuid,'description':'Optional exact private run UUID, including older runs outside the latest 100; unavailable, withdrawn or other-owner runs return 404.'}]
result={'openapi':'3.1.0','info':{'title':'Private cloud workflow schedules','version':'1.0.0','description':'Additive SQL120. Fixed inputs do not refresh automatically. Codex prepares requests only; explicit customer consent activates paid future work. Desktop native credentials cannot prepare/activate/resume cloud replacement execution. No administrator resume endpoint.'},'paths':paths,
 'components':{'schemas':schemas,'securitySchemes':{'UserCookie':{'type':'apiKey','in':'cookie','name':'cp_session'},'AdminCookie':{'type':'apiKey','in':'cookie','name':'cp_admin_session'},'NativeBearer':{'type':'http','scheme':'bearer'}}},
 'x-tools':{'workflow_schedule_preview':{'mode':['ask','plan','execute'],'schema':'ScheduleToolRequest','effect':'Validation/preview only. No activation or future reservation.'},'workflow_schedule_request':{'mode':['execute'],'schema':'ScheduleToolRequest','effect':'Pending request only. Same origin and content deduplicate even with a fresh call ID.'},'workflow_schedule_status':{'mode':['ask','plan','execute'],'schema':obj({}),'effect':'Actual private requests and outcomes in this task only.'}},
 'x-worker':{'candidate_limit':20,'single_active_run_per_schedule':True,'active_schedule_limit_per_owner_project':50,'missed_runs':'latest only or skip; coalesce missed facts; no overlapping run','dst':'skip nonexistent wall times, first repeated wall time once','failures':'block future runs; no paid automatic retries','source_erasure':'purge private request/version bodies and stop schedules; keep occurrence/fee facts'},
 'x-source':['dev/copypaste-platform/src/cloud-schedule-model.ts','dev/copypaste-platform/src/cloud-schedules.ts','dev/copypaste-platform/migrations/120-private-cloud-schedules.sql']}
out=ROOT/'docs/contracts/private-cloud-schedules-openapi.json'
out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'paths':len(paths),'operations':sum(k in ['get','post'] for p in paths.values() for k in p),'contract':out.relative_to(ROOT).as_posix()}))
