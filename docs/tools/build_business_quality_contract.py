"""Add the business-quality contract without rewriting the original OpenAPI."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
original = json.loads((root / 'docs/contracts/openapi.json').read_text(encoding='utf-8'))
uuid = {'type': 'string', 'format': 'uuid'}
timestamp = {'type': 'string', 'format': 'date-time'}
integer = {'type': 'integer', 'minimum': 0}
nullable_integer = {'type': ['integer', 'null'], 'minimum': 0}
sha = {'type': 'string', 'pattern': '^[a-f0-9]{64}$'}
decision = {'type': 'string', 'enum': ['accepted', 'changes_requested', 'discarded']}
ref = lambda name: {'$ref': '#/components/schemas/' + name}
def obj(fields, required=None):
    return {'type': 'object', 'properties': fields, 'required': list(fields) if required is None else required, 'additionalProperties': False}

schemas = {name: original['components']['schemas'][name] for name in ['ReviewCreate', 'Review']}
schemas['ProjectReviewCreate'] = obj({'expected_version': {'type':'integer','minimum':1}, 'expected_delivery_hash':sha,
    'artifact_ids': {'type':'array','items':uuid,'minItems':1}, 'decision':decision,'comment':{'type':'string','maxLength':5000}}, ['expected_version','expected_delivery_hash','decision'])
schemas['QualityMeasurementCreate'] = obj({'expected_version': {'type':'integer','minimum':1},
    'baseline_minutes':{**nullable_integer,'maximum':525600},'human_minutes':{**nullable_integer,'maximum':525600},'manual_revisions':{**nullable_integer,'maximum':10000}})
schemas['QualityMeasurement'] = obj({'id':uuid,'task_id':uuid,'task_version':{'type':'integer','minimum':1},
    'baseline_minutes':nullable_integer,'human_minutes':nullable_integer,'manual_revisions':nullable_integer,'created_at':timestamp})
schemas['DeliverySnapshot'] = obj({'output_sha256': {'anyOf':[sha,{'type':'null'}]},'artifacts':{'type':'array','items':obj({'id':uuid,'version_id':uuid,'version':{'type':'integer','minimum':1},'sha256':sha})}})
counts = ['tasks','technical_successes','failed','cancelled','reviewable','accepted','changes_requested','revision_requests','discarded','pending_review','sources_unavailable','incomplete_cost_tasks','uncertain_cost_tasks','human_minutes_coverage','baseline_minutes_coverage','manual_revisions_coverage','observed_reuse_pairs','successful_reuse_pairs','simulated_tasks','configured_services_tasks']
summary = {key:integer for key in counts}
summary.update({key:{'type':'string','pattern':'^[0-9]+$'} for key in ['known_cost_micros','failed_cancelled_cost_micros']})
summary.update({key:{'type':['string','null'],'pattern':'^[0-9]+$'} for key in ['human_minutes','baseline_minutes','manual_revisions','complete_cost_per_accepted_micros']})
summary.update({'currency':{'const':'HKD'},'cohort':obj({'from':timestamp,'to':timestamp,'clock':{'const':'task_created_at'},'data_mode':{'enum':['all','simulated','configured_services']}}),
    'acceptance_rate':{'type':['number','null'],'minimum':0,'maximum':1},'measurements_source':{'const':'customer_reported'},'reuse_source':{'const':'observed_fixed_asset_reads'},
    'cost_basis':{'const':'company_task_usage_before_refunds_excludes_external_and_labor_cost'},'roi':{'type':'null'}})
schemas['QualitySummary'] = obj(summary)
review_history = obj({'id':uuid,'decision':decision,'task_version':{'type':'integer','minimum':1},'created_at':timestamp,'erased_at':{'anyOf':[timestamp,{'type':'null'}]},
    'current_delivery':{'type':['boolean','null']},'comment':{'type':['string','null']},'artifact_ids':{'anyOf':[{'type':'array','items':uuid},{'type':'null'}]}})
measurement_view = dict(schemas['QualityMeasurement']); measurement_view['properties'] = {k:v for k,v in measurement_view['properties'].items() if k!='task_id'}; measurement_view['required'] = list(measurement_view['properties'])
schemas['TaskQuality'] = obj({'task_id':uuid,'task_version':{'type':'integer','minimum':1},'technical_status':{'type':'string'},
    'review_state':{'enum':['pending_review','accepted','changes_requested','discarded']},'delivery':{'anyOf':[ref('DeliverySnapshot'),{'type':'null'}]},'delivery_hash':sha,
    'can_review':{'type':'boolean'},'can_measure':{'type':'boolean'},'measurements_source':{'const':'customer_reported'},'measurements':{'anyOf':[measurement_view,{'type':'null'}]},
    'reviews':{'type':'array','items':review_history,'maxItems':50},'history_truncated':{'type':'boolean'}})
paths = {}
prefix = '/v1/tenants/{tenant}/projects/{project}'
def operation(path, method, response, body=None, admin=False):
    params = [{'name':name,'in':'path','required':True,'schema':uuid} for name in ['tenant','project','task'] if '{'+name+'}' in path]
    if '{task_id}' in path: params += [{'name':'task_id','in':'path','required':True,'schema':uuid},{'name':'X-Tenant-ID','in':'header','required':True,'schema':uuid}]
    if method == 'post': params += [{'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','minLength':16,'maxLength':128}}]
    if path.endswith('/quality') and '{task}' not in path:
        params += [{'name':name,'in':'query','schema':timestamp} for name in ['from','to']]
        params += [{'name':'data_mode','in':'query','schema':{'enum':['simulated','configured_services']}}]
        if admin: params += [{'name':name,'in':'query','schema':uuid} for name in ['tenant_id','project_id']]
    op = {'parameters':params,'responses':{('201' if method=='post' else '200'):{'description':'Recorded result' if method=='post' else 'Authorized current view','content':{'application/json':{'schema':ref(response)}}}},'x-requirements':['REQ-012','REQ-022','REQ-056'],'security':[{'adminSession' if admin else 'userSession':[]}]}
    if body: op['requestBody'] = {'required':True,'content':{'application/json':{'schema':ref(body)}}}
    if admin: op['x-permission'] = 'admin.usage.read'; op['description'] = 'Metadata aggregates only. Explicit project denies constrain every count and cost. Does not authorize writing customer acceptance.'
    paths.setdefault(path,{})[method] = op
operation('/v1/tasks/{task_id}/reviews','post','Review','ReviewCreate')
paths['/v1/tasks/{task_id}/reviews']['post']['parameters'] += [{'name':'If-Match','in':'header','schema':{'type':'string','pattern':'^"[1-9][0-9]*"$'}},{'name':'X-Delivery-SHA256','in':'header','schema':sha}]
paths['/v1/tasks/{task_id}/reviews']['post']['description'] = 'Original ReviewCreate/Review retained. Without optional concurrency headers, reviews the current selected artifact versions at commit. Product forms use mandatory expected_version and expected_delivery_hash on the project route.'
operation(prefix+'/tasks/{task}/reviews','post','Review','ProjectReviewCreate')
operation(prefix+'/tasks/{task}/quality','get','TaskQuality')
operation(prefix+'/tasks/{task}/quality/measurements','post','QualityMeasurement','QualityMeasurementCreate')
operation(prefix+'/quality','get','QualitySummary')
operation('/v1/admin/quality','get','QualitySummary',admin=True)
contract = {'openapi':'3.1.0','info':{'title':'CopyPaste business delivery quality','version':'1.0.0','description':'Additive contract. Costs are company task usage before refunds, excluding external services and labor. Customer measurements are self reported. Fixed-version reads establish observed reuse, not renewal or ROI. Time interval is [from,to), defaults to 30 days and is limited to 366 days.'},
    'paths':paths,'components':{'schemas':schemas,'securitySchemes':{'userSession':{'type':'apiKey','in':'cookie','name':'cp_session'},'adminSession':{'type':'apiKey','in':'cookie','name':'cp_admin_session'}}}}
raw = (json.dumps(contract,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
for target in ['docs/contracts/business-quality-openapi.json','dev/copypaste-platform/contracts/business-quality-openapi.json']:
    (root/target).write_bytes(raw)
print('Wrote the six additive quality operations; original OpenAPI unchanged')
