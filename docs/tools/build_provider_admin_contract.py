"""Additive provider-control contract; never rewrites the original OpenAPI."""
from pathlib import Path
import copy
import json
import sys

ROOT=Path(__file__).resolve().parents[2]
DOCS=ROOT/'docs/contracts'
PLATFORM=ROOT/'dev/copypaste-platform'

def obj(properties, required=None):
    return {'type':'object','properties':properties,'required':list(properties) if required is None else required,'additionalProperties':False}
def enum(*values): return {'type':'string','enum':list(values)}
def ref(name): return {'$ref':'#/components/schemas/'+name}
def array(item): return {'type':'array','items':item}
def nullable(schema): return {'anyOf':[schema,{'type':'null'}]}
def string(n=1,m=1000): return {'type':'string','minLength':n,'maxLength':m}
UUID={'type':'string','format':'uuid'}
TIME={'type':'string','format':'date-time'}
BOOL={'type':'boolean'}
SAFE={'type':'integer','minimum':0,'maximum':9007199254740991}
POS={**SAFE,'minimum':1}
REASON=string(3,1000)
HASH={'type':'string','pattern':'^[a-f0-9]{64}$'}
MODE=enum('simulated','configured_services')
CHANNEL=enum('generation','input_count')
DECIMAL={'type':'string','pattern':'^(0|[1-9][0-9]{0,39})$'}

def build():
    limits={k:{'type':'integer','minimum':1,'maximum':1000} for k in ['global_slots','tenant_slots','actor_slots','text_slots','image_slots','verification_slots']}
    limits.update({k:{'type':'integer','minimum':1,'maximum':100000} for k in ['global_rpm','tenant_rpm','actor_rpm','text_rpm','image_rpm','verification_rpm']})
    limits['preparation_seconds']={'type':'integer','minimum':1,'maximum':300}
    budget=obj({'count_verified':BOOL,'count_price_micros':nullable(SAFE),'verification_run_micros':POS,'verification_daily_micros':POS,'counting_daily_micros':POS})
    contract=obj({'reference':string(3,300),'terms':string(10,16000),'service':enum('responses.input_tokens'),'fee_micros':SAFE,'effective_at':TIME})
    definition=obj({'limits':obj(limits),'budget':budget,'count_contract':nullable(contract)})
    definition['description']='Verified counting additionally requires matching explicit fee/contract and an effective contract bound to the current company gateway. Publication never qualifies a live model.'
    policy=obj({'action':enum('ai.policy.publish'),'draft_id':UUID,'expected_revision':{**SAFE},'reason':REASON})
    request=obj({'action':enum('ai.cost.reconcile','ai.capacity.release'),'channel':CHANNEL,'request_id':UUID,'evidence_id':UUID,'reason':REASON})
    task=obj({'action':enum('ai.tasks.settle'),'task_id':UUID,'expected_task_version':POS,'acknowledge_violation_ids':{**array(UUID),'maxItems':100,'uniqueItems':True},'reason':REASON})
    usage={'oneOf':[obj({'kind':enum('text'),'input_tokens':SAFE,'output_tokens':SAFE}),obj({'kind':enum('image'),'image_units':{'type':'integer','minimum':0,'maximum':1}}),obj({'kind':enum('input_count'),'counted_input_tokens':nullable(SAFE)})]}
    evidence=obj({'schema_version':{'const':1},'data_mode':MODE,'operation_id':{'type':'string','pattern':'^[a-zA-Z0-9_:-]{16,128}$'},'request_hash':HASH,
        'provider_reference':string(3,300),'source_reference':string(3,500),'source_note':string(10,8000),'observed_at':TIME,
        'terminated':{'const':True},'outcome':enum('completed','failed','cancelled','not_executed'),'currency':enum('HKD'),
        'billed_micros':{'type':'string','pattern':'^(0|[1-9][0-9]{0,33})$'},'usage':usage})
    evidence['description']='Human-submitted immutable source statement, not an authenticated gateway callback. Bound to the original unknown request, mode, hash, operation and dispatch time. Confirmation always needs an independent reviewer.'
    schemas={'ProviderLimits':obj(limits),'ProviderBudgetDefinition':budget,'ProviderPolicyDefinition':definition,
        'ProviderPolicyDraft':obj({'definition':ref('ProviderPolicyDefinition'),'reason':REASON}),
        'ProviderPolicyPublication':policy,'ProviderRequestCommand':request,'ProviderTaskSettlement':task,
        'ProviderCommand':{'oneOf':[ref('ProviderPolicyPublication'),ref('ProviderRequestCommand'),ref('ProviderTaskSettlement')]},
        'ProviderEvidenceDocument':evidence,'ProviderEvidenceCreate':obj({'document':ref('ProviderEvidenceDocument'),'reason':REASON}),
        'ProviderSubmit':obj({'command':ref('ProviderCommand'),'preview_id':UUID})}
    scope=obj({'data_mode':MODE,'tenant_id':nullable(UUID),'project_id':nullable(UUID)})
    limit_row=obj({'id':UUID,'data_mode':MODE,'version':POS,**limits,'created_by':nullable(UUID),'reason':REASON,'created_at':TIME})
    budget_row=obj({'id':UUID,'data_mode':MODE,'fingerprint':HASH,'count_verified':BOOL,
        **{k:nullable(DECIMAL) if k=='count_price_micros' else DECIMAL for k in ['count_price_micros','verification_run_micros','verification_daily_micros','counting_daily_micros']},
        'reason':REASON,'created_at':TIME})
    draft_props={'id':UUID,'data_mode':MODE,'version':POS,'gateway_fingerprint':HASH,'definition':ref('ProviderPolicyDefinition'),
        'actor_id':UUID,'operation_id':UUID,'reason':REASON,'created_at':TIME}
    evidence_index=obj({'id':UUID,'document_hash':HASH,'actor_id':UUID,'reason':REASON,'created_at':TIME})
    cost=obj({'state':enum('known','unknown','manually_confirmed'),'source':enum('gateway_observation','human_evidence','unknown'),
        'rate_snapshot':{**array(SAFE),'minItems':1,'maxItems':2},'numerator':nullable(DECIMAL),'amount_micros':nullable(DECIMAL),
        'input_tokens':nullable(DECIMAL),'output_tokens':nullable(DECIMAL),'image_units':nullable(SAFE),'counted_input_tokens':nullable(DECIMAL),
        'confirmation_id':nullable(UUID),'evidence_id':nullable(UUID)})
    request_props={'id':UUID,'channel':CHANNEL,'data_mode':MODE,'subject_kind':enum('task','validation'),
        **{k:nullable(UUID) for k in ['task_id','validation_id','tenant_id','project_id','actor_id','capability_version_id','release_id','dispatch_policy_version_id','termination_confirmation_id']},
        'attempt':nullable(POS),'request_class':enum('text','image'),'operation':enum('responses','images.generate','images.edit','responses.input_tokens'),
        'operation_id':string(16,128),'model_alias':string(),'request_hash':HASH,'request_bytes':SAFE,'policy_version_id':UUID,
        'state':enum('prepared','dispatched','completed','unknown','cancelled','denied'),
        **{k:TIME for k in ['prepared_until','created_at']},
        **{k:nullable(TIME) for k in ['dispatched_at','finished_at','released_at']},
        'outcome_code':nullable(string()),'http_status':nullable({'type':'integer','minimum':100,'maximum':599}),'capacity_held':BOOL,
        'cost':ref('ProviderRequestCost')}
    request_required=[k for k in request_props if k!='cost']
    violation=obj({'id':UUID,'code':enum('INPUT_COUNT_MISMATCH','OUTPUT_LIMIT_EXCEEDED','ALLOCATION_EXCEEDED')})
    receipt=obj({'requests':SAFE,'knownChargeMicros':SAFE,'inputTokens':SAFE,'outputTokens':SAFE,'uncertain':BOOL,'violation':BOOL})
    derived=obj({'numerator':DECIMAL,'amount_micros':DECIMAL,'input_tokens':SAFE,'output_tokens':SAFE,'image_units':SAFE,'counted_input_tokens':nullable(SAFE)})
    request_before=obj({'scope':scope,'request':ref('ProviderRequest'),'evidence':obj({'id':UUID,'document_hash':HASH,
        'document':ref('ProviderEvidenceDocument'),'actor_id':UUID,'reason':REASON}),'cost':nullable(derived)})
    policy_before=obj({'scope':scope,'draft':obj(draft_props),'current':ref('ProviderCurrentPolicy'),'definition':ref('ProviderPolicyDefinition')})
    task_before=obj({'scope':scope,'task':obj({'id':UUID,'version':POS,'status':enum('reconciling'),'created_by':UUID}),
        'reservation':obj({'id':nullable(UUID),'status':enum('reserved','reconciling'),'amount_micros':DECIMAL}),
        'receipt':receipt,'violations':array(violation),'facts':array(obj({'id':UUID,'channel':CHANNEL,
            'state':request_props['state'],'cost_state':cost['properties']['state'],'numerator':nullable(DECIMAL),'cost_confirmation_id':nullable(UUID)})),
        'receipt_hash':HASH})
    schemas.update({
        'ProviderCurrentPolicy':obj({'data_mode':MODE,'gateway_fingerprint':HASH,'revision':SAFE,'publication_id':nullable(UUID),
            'limits':limit_row,'budget':budget_row,'periods':array(obj({'id':UUID,'purpose':enum('verification','input_count'),
                'utc_day':{'type':'string','format':'date'},'amount_micros':DECIMAL,'policy_id':UUID}))}),
        'ProviderPolicyList':obj({'items':array(obj({**draft_props,'publication_id':nullable(UUID),'published_at':nullable(TIME),'cursor_at':TIME})),
            'next_cursor':nullable(string(1,4096))}),
        'ProviderRequestCost':cost,'ProviderRequest':obj(request_props,request_required),
        'ProviderRequestList':obj({'items':array(ref('ProviderRequest')),'next_cursor':nullable(string(1,4096))}),
        'ProviderRequestDetail':obj({**request_props,'evidence':array(evidence_index)},request_required),
        'ProviderEvidenceRecord':obj({'id':UUID,'document':ref('ProviderEvidenceDocument'),'canonical_document':string(1,40000),
            'document_hash':HASH,'source':enum('human_submission'),'actor_id':UUID,'reason':REASON,'created_at':TIME}),
        'ProviderTaskSettlementFacts':obj({'task':obj({'id':UUID,'tenant_id':UUID,'data_mode':MODE,'status':string(),
            'version':POS,'charged_micros':DECIMAL,'budget_micros':DECIMAL}),
            'reservation':nullable(obj({'status':string(),'amount_micros':DECIMAL})),'violations':array(violation)}),
        'ProviderPolicyBefore':policy_before,'ProviderRequestBefore':request_before,'ProviderTaskBefore':task_before,
        'ProviderPreview':obj({'preview_id':UUID,'payload_hash':HASH,'policy_version_id':UUID,
            'before':{'oneOf':[ref('ProviderPolicyBefore'),ref('ProviderRequestBefore'),ref('ProviderTaskBefore')]},
            'command':ref('ProviderCommand'),'decision':enum('independent_approval'),'expires_at':TIME,'creates_business_effect':{'const':False}}),
    })
    base=json.loads((DOCS/'openapi.json').read_text(encoding='utf-8'))
    for name in ['AdminOperation','ErrorResponse']:
        if name in base['components']['schemas']: schemas[name]=copy.deepcopy(base['components']['schemas'][name])
    paths={}
    def operation(path,method,permission,body=None,code=200,description=''):
        params=[]
        for part in path.split('/'):
            if part.startswith('{'):
                name=part[1:-1]
                params.append({'in':'path','name':name,'required':True,'schema':CHANNEL if name=='channel' else UUID})
        if method!='get':
            params.extend([{'in':'header','name':'Idempotency-Key','required':True,'schema':string(8,128)}, {'in':'header','name':'X-CSRF-Token','required':True,'schema':string()}])
        record={'operationId':'provider_'+method+'_'+path.replace('/v1/admin/ai/','').replace('/','_').replace('{','').replace('}',''),
            'summary':description,'security':[{'AdminSession':[]}],'x-permission':permission,'parameters':params,
            'responses':{str(code):{'description':'Accepted controlled operation' if code==202 else 'Current scoped facts'},'400':{'description':'Strict schema, binding or cursor invalid'},'401':{'description':'Independent Admin session required'},'403':{'description':'Current scoped permission, explicit deny, recent MFA or independent review failed'},'409':{'description':'Current target, policy, proof, price, budget, preview or task changed'}}}
        if body: record['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
        if code==202: record['responses']['202']['content']={'application/json':{'schema':ref('AdminOperation')}}
        paths.setdefault(path,{})[method]=record
    operation('/v1/admin/ai/policy','get','admin.ai.policy.read',description='Current independently published limits and budgets; UTC-day boundaries remain frozen')
    operation('/v1/admin/ai/policies','get','admin.ai.policy.read',description='Immutable policy draft and publication directory')
    operation('/v1/admin/ai/policies/drafts','post','admin.ai.policy.draft','ProviderPolicyDraft',202,'Register an immutable policy draft; no live effect')
    operation('/v1/admin/ai/requests','get','admin.ai.requests.read',description='Scoped request directory with separate extra cost-field permission')
    operation('/v1/admin/ai/requests/{channel}/{request_id}','get','admin.ai.requests.read',description='Original observation and explicit manual overlays; no private request body or execution nonce')
    operation('/v1/admin/ai/requests/{channel}/{request_id}/evidence','post','admin.ai.evidence.write','ProviderEvidenceCreate',202,'Register inspectable human evidence; no fee, ledger or capacity effect')
    operation('/v1/admin/ai/evidence/{evidence_id}','get','admin.ai.cost.read',description='Reauthorize and read canonical human evidence for download')
    operation('/v1/admin/ai/tasks/{task_id}/settlement','get','admin.ai.cost.read',description='Current original task, reservation and immutable violations; no charge')
    operation('/v1/admin/ai/previews','post','action-specific','ProviderCommand',200,'Freeze exact current facts for independent review; no business effect')
    operation('/v1/admin/ai/operations','post','action-specific','ProviderSubmit',202,'Submit exact preview for another currently authorized Admin; never self-approve')
    response_schemas={
        '/v1/admin/ai/policy':'ProviderCurrentPolicy','/v1/admin/ai/policies':'ProviderPolicyList',
        '/v1/admin/ai/requests':'ProviderRequestList','/v1/admin/ai/requests/{channel}/{request_id}':'ProviderRequestDetail',
        '/v1/admin/ai/evidence/{evidence_id}':'ProviderEvidenceRecord','/v1/admin/ai/tasks/{task_id}/settlement':'ProviderTaskSettlementFacts',
        '/v1/admin/ai/previews':'ProviderPreview'}
    for path,name in response_schemas.items():
        paths[path]['post' if path.endswith('/previews') else 'get']['responses']['200']['content']={'application/json':{'schema':ref(name)}}
    for path in ['/v1/admin/ai/policies','/v1/admin/ai/requests']:
        params=paths[path]['get']['parameters']
        params.extend([{'in':'query','name':'cursor','schema':string(1,4096)},{'in':'query','name':'limit','schema':{'type':'integer','minimum':1,'maximum':100,'default':50}}])
    filters={'data_mode':MODE,'subject_kind':enum('task','validation'),'operation':enum('responses','images.generate','images.edit','responses.input_tokens'),
        'state':enum('prepared','dispatched','completed','unknown','cancelled','denied'),'cost_state':enum('known','unknown','manually_confirmed'),'capacity_state':enum('held','released'),
        **{k:UUID for k in ['tenant_id','project_id','actor_id','task_id','validation_id','capability_version_id','release_id']},'period_from':TIME,'period_to':TIME}
    paths['/v1/admin/ai/requests']['get']['parameters'].extend({'in':'query','name':k,'schema':v} for k,v in filters.items())
    api={'openapi':'3.1.0','info':{'title':'CopyPaste additive provider Admin controls','version':'0.1.0'},'paths':paths,
         'components':{'securitySchemes':{'AdminSession':{'type':'apiKey','in':'cookie','name':'cp_admin_session'}},'schemas':schemas},
         'x-original-contract-unchanged':True,'x-independent-review-endpoints':['/v1/admin/operations/{operation}/approval','/v1/admin/approvals/{approval}/review','/v1/admin/approvals/{approval_id}/decisions']}
    standalone=json.loads(json.dumps(schemas).replace('#/components/schemas/','#/$defs/'))
    return {'provider-admin-openapi.json':api,'provider-admin-schemas.json':{
        '$schema':'https://json-schema.org/draft/2020-12/schema', '$defs':standalone}}

def main():
    docs_only='--docs-only' in sys.argv
    for name,data in build().items():
        encoded=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
        (DOCS/name).write_text(encoded,encoding='utf-8',newline='\n')
        if not docs_only: (PLATFORM/'contracts'/name).write_text(encoded,encoding='utf-8',newline='\n')
    permissions=(PLATFORM/'catalog/provider-admin-permissions.json').read_bytes()
    (DOCS/'provider-admin-permissions.json').write_bytes(permissions)
    print(json.dumps({'contracts':3,'docs_only':docs_only,'base_openapi_modified':False}))

if __name__=='__main__': main()
