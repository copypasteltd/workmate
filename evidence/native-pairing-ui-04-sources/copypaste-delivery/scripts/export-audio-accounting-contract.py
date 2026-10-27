"""SQL122 contract: additive audio evidence accounting; retain the SQL121 contract."""
from pathlib import Path
from hashlib import sha256
from copy import deepcopy
import json

ROOT = Path(__file__).resolve().parents[3]
source = ROOT / 'docs/contracts/managed-audio-capabilities.openapi.json'
result = json.loads(source.read_text(encoding='utf-8'))
result['info'] = {**result['info'], 'title': 'Workmate independently reviewed audio accounting', 'version': '1.2.0'}
result['x-historical-audio-contract'] = {'path': source.name, 'sha256': sha256(source.read_bytes()).hexdigest()}
s = result['components']['schemas']
ref = lambda name: {'$ref': '#/components/schemas/' + name}
nullable = lambda p: {'anyOf': [p, {'type': 'null'}]}
obj = lambda p, required=None: {'type': 'object', 'properties': p, 'required': list(p) if required is None else required, 'additionalProperties': False}
uid = {'type': 'string', 'format': 'uuid'}
stamp = {'type': 'string', 'format': 'date-time'}
money = {'type': 'string', 'pattern': '^[0-9]+$'}
digest = {'type': 'string', 'pattern': '^[a-f0-9]{64}$'}
boolean = {'type': 'boolean'}
text = {'type': 'string'}
channel = {'enum': ['audio_customer', 'audio_validation']}
mode = {'enum': ['simulated', 'configured_services']}
s['AudioAccountingFact'] = obj({
 'original_state': text, 'original_usage_known': boolean, 'cost_state': {'enum': ['known','unknown','manually_confirmed']},
 'cost_source': {'enum': ['company_tariff','unknown','human_evidence']}, 'confirmed_micros': nullable(money), 'confirmed_units': nullable(money),
 'cost_confirmation_id': nullable(uid), 'termination_confirmation_id': nullable(uid), 'capacity_held': boolean,
 'accounting_resolved': boolean, 'allocation_exceeded': boolean})
s['AudioVerificationCase']['properties']['accounting'] = ref('AudioAccountingFact')
s['AudioVerificationCase']['required'].append('accounting')
s['AudioVerificationSuite']['properties']['accounting'] = obj({'confirmed_micros': money,
 'unconfirmed_cases': {'type':'integer','minimum':0}, 'capacity_held_cases': {'type':'integer','minimum':0},
 'resolved': boolean, 'allocation_exceeded': boolean})
s['AudioVerificationSuite']['required'].append('accounting')
s['AudioAccountingCost'] = obj({'state': {'enum':['known','unknown','manually_confirmed']},
 'source': {'enum':['company_tariff','unknown','human_evidence']}, 'rate_micros': money, 'quoted_units': money, 'quoted_micros': money,
 'original_billable_units': nullable(money), 'original_micros': nullable(money), 'billable_units': nullable(money),
 'amount_micros': nullable(money), 'confirmation_id': nullable(uid), 'evidence_id': nullable(uid),
 'allocation_exceeded': boolean, 'accounting_resolved': boolean})
fields = {'id':uid,'channel':channel,'data_mode':mode,'tenant_id':nullable(uid),'project_id':nullable(uid),'task_id':nullable(uid),
 'validation_id':nullable(uid),'release_id':nullable(uid),'actor_id':uid,'capability_version_id':nullable(uid),
 'model_alias':text,'gateway_fingerprint':digest,'kind':{'enum':['speech','transcription']},
 'pricing_unit':{'enum':['unicode_scalar','input_millisecond']},'state':text,'usage_known':boolean,'operation_id':uid,
 'request_hash':nullable(digest),'source_sha256':nullable(digest),'created_at':stamp,'dispatched_at':nullable(stamp),
 'finished_at':nullable(stamp),'error_code':nullable(text),'capacity_held':boolean,'termination_confirmation_id':nullable(uid)}
s['AudioAccountingRequest'] = obj({**fields,'cost':ref('AudioAccountingCost')},list(fields))
eheader = obj({'id':uid,'document_hash':digest,'actor_id':uid,'reason':text,'created_at':stamp})
s['AudioAccountingDetail'] = obj({**s['AudioAccountingRequest']['properties'],'evidence':{'type':'array','items':eheader}},list(fields))
s['AudioAccountingPage'] = obj({'items':{'type':'array','items':ref('AudioAccountingRequest')},'next_cursor':nullable(text)})
s['AudioAccountingEvidenceDocument'] = obj({'schema_version':{'const':1},'channel':channel,'request_id':uid,'data_mode':mode,
 'operation_id':uid,'request_hash':digest,'model_alias':text,'gateway_fingerprint':digest,'source_sha256':nullable(digest),
 'provider_reference':{'type':'string','minLength':3,'maxLength':300},'source_reference':{'type':'string','minLength':3,'maxLength':500},
 'source_note':{'type':'string','minLength':10,'maxLength':8000},'observed_at':stamp,'terminated':{'const':True},
 'outcome':{'enum':['completed','failed','cancelled','not_executed']},'currency':{'const':'HKD'},
 'billed_micros':{'type':'string','pattern':'^(0|[1-9][0-9]{0,15})$'},
 'usage':obj({'kind':{'enum':['speech','transcription']},'pricing_unit':{'enum':['unicode_scalar','input_millisecond']},
 'billable_units':{'type':'integer','minimum':0,'maximum':1000000}})})
s['AudioAccountingEvidenceCreate'] = obj({'document':ref('AudioAccountingEvidenceDocument'),'reason':{'type':'string','minLength':3,'maxLength':1000}})
s['AudioAccountingEvidence'] = obj({**eheader['properties'],'document':ref('AudioAccountingEvidenceDocument'),
 'source':{'const':'human_submission'},'provider_authenticated':{'const':False}})
s['AudioAccountingCommand'] = obj({'action':{'enum':['ai.cost.reconcile','ai.capacity.release']},'channel':channel,
 'request_id':uid,'evidence_id':uid,'reason':{'type':'string','minLength':3,'maxLength':1000}})
# Existing preview/operation routes consume the provider command union. The audio
# variant deliberately keeps the established two independent approval actions.
result['x-audio-command'] = {'schema':ref('AudioAccountingCommand'),'preview':'POST /v1/admin/ai/previews','submit':'POST /v1/admin/ai/operations',
 'review':'POST /v1/admin/approvals/{approval}/decisions','cost_and_capacity_are_separate':True}
base='/v1/admin/ai/audio-accounting'
def route(method,path,name,response,body=None):
 op={'operationId':name,'security':[{'adminCookie':[]}],'responses':{'202' if body else '200':{'description':'Scoped, audited result','content':{'application/json':{'schema':ref(response)}}}},
     'parameters':[{'name':p,'in':'path','required':True,'schema':channel if p=='channel' else uid} for p in ['channel','request_id','evidence_id'] if '{'+p+'}' in path]}
 if body: op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
 result['paths'].setdefault(path,{})[method]=op
route('get',base,'listAudioAccounting','AudioAccountingPage')
route('get',base+'/{channel}/{request_id}','readAudioAccounting','AudioAccountingDetail')
route('post',base+'/{channel}/{request_id}/evidence','saveAudioEvidence','AdminOperation','AudioAccountingEvidenceCreate')
route('get','/v1/admin/ai/audio-evidence/{evidence_id}','readAudioEvidence','AudioAccountingEvidence')
queries={'cursor':text,'limit':{'type':'integer','minimum':1,'maximum':100,'default':20},'channel':{**channel,'default':'audio_customer'},
 'state':{'enum':['prepared','dispatched','completed','cancelled','unknown']},'cost_state':{'enum':['known','unknown','manually_confirmed']},
 'capacity_state':{'enum':['held','released']},**{k:uid for k in ['tenant_id','project_id','task_id','validation_id','release_id','actor_id']},
 'period_from':stamp,'period_to':stamp}
result['paths'][base]['get']['parameters']=[{'name':k,'in':'query','schema':v} for k,v in queries.items()]
output=ROOT/'docs/contracts/audio-accounting.openapi.json'
assert not output.exists()
output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
mirror=ROOT/'dev/copypaste-platform/contracts/audio-accounting-schemas.json'
assert not mirror.exists()
mirror.write_text(json.dumps({'normative_source_sha256':sha256(output.read_bytes()).hexdigest(),'schemas':s},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
baseline=json.loads((ROOT/'dev/copypaste-platform/contracts/managed-audio-route-additions.json').read_text('utf-8'))
addon={'baseline_lf_sha256':baseline['baseline_lf_sha256'],'routes':[{'method':method,'path':path} for method,path in [
 ('GET',base),('GET',base+'/:channel/:request_id'),('POST',base+'/:channel/:request_id/evidence'),('GET','/v1/admin/ai/audio-evidence/:evidence_id')]],'conditional_routes':[]}
(ROOT/'dev/copypaste-platform/contracts/audio-accounting-route-additions.json').write_text(json.dumps(addon,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'schemas':len(s),'new_routes':4,'historical_contract_unchanged':True}))
