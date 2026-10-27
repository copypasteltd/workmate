"""Build the additive native GEO API contract; never rewrite the Stage83 contract."""
from pathlib import Path
from hashlib import sha256
import argparse
import json

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/contracts/geo-observation-openapi.json'
OUT=ROOT/'docs/contracts/desktop-geo.openapi.json'
def obj(properties, optional=()):
    return {'type':'object','properties':properties,'required':[k for k in properties if k not in optional],'additionalProperties':False}
def arr(items, low=0, high=20): return {'type':'array','items':items,'minItems':low,'maxItems':high}
def string(**fields): return {'type':'string',**fields}
def ref(name): return {'$ref':'#/components/schemas/'+name}
def literal(value): return {'type': 'boolean' if isinstance(value,bool) else 'string', 'const':value}
uuid=string(format='uuid'); digest=string(pattern='^[a-f0-9]{64}$')
budget=string(pattern='^[1-9][0-9]{4,10}$',description='Exact HKD micros as a decimal string; validated integer range 10000 through 10000000000, inclusive.')
pin=json.loads((ROOT/'dev/copypaste-desktop/contracts/local-codex-runtime.json').read_text('utf-8'))
runtime=obj({'profile_key':literal('codex-desktop-native-v1'),'kernel':literal('codex'),'pinned_version':literal(pin['runtime_version']),
    'transport':literal('stdio'),'gateway_policy':literal('company_internal_only'),'automatic_fallback':literal(False),'windows_x64_sha256':literal(pin['windows_x64_sha256'])})
question=obj({'key':string(minLength=1,maxLength=80),'text':string(minLength=1,maxLength=2000)})
binding=obj({'question_key':question['properties']['key'],'device_id':uuid,'local_session_id':uuid,'workspace_hash':digest,
    'runtime_version':literal(pin['runtime_version']),'runtime_sha256':literal(pin['windows_x64_sha256'])})
quota=obj({'active':{'type':'integer','minimum':0},'max_active_tasks':{'type':'integer','minimum':1},'available':{'type':'integer','minimum':0},'max_question_budget_micros':string(pattern='^[0-9]+$')})
schemas={
    'NativeRuntime':runtime,'Question':question,'LocalBinding':binding,'Quota':quota,
    'NativeConfiguration':obj({'id':uuid,'name':string(),'sha256':digest,'role_key':string(),'model_alias':string(),'questions':arr(ref('Question'),1), 'runtime':ref('NativeRuntime'),'quota':ref('Quota')}),
    'NativeRunInput':obj({'name':string(minLength=1,maxLength=160),'expected_experiment_sha256':digest,'per_question_budget_micros':budget,'sessions':arr(ref('LocalBinding'),1)}),
    'NativeSampleReceipt':obj({'question_key':question['properties']['key'],'sample_id':uuid,'task_id':uuid,'local_session_id':uuid,'budget_micros':budget,'role_key':string()}),
    'NativeRunReceipt':obj({'id':uuid,'experiment_id':uuid,'execution_location':literal('desktop'),'protocol':literal('codex-desktop-geo-v1'),
        'config_hash':digest,'total_budget_micros':string(pattern='^[1-9][0-9]*$'),'sessions':arr(ref('NativeSampleReceipt'),1)})}
path='/v1/tenants/{tenant}/projects/{project}/geo/experiments/{id}'
def operation(name,response,method):
    result={'operationId':name,'security':[{'NativeBearer':[]}],
        'parameters':[{'name':n,'in':'path','required':True,'schema':uuid} for n in ['tenant','project','id']],
        'responses':{('201' if method=='post' else '200'):{'description':'Exact native configuration or atomic preparation receipt','content':{'application/json':{'schema':ref(response)}}},
            **{str(n):{'description':d} for n,d in [(400,'Strict input binding rejected'),(401,'Current sign-in required'),(403,'Current Desktop authorization required'),(404,'Private content or native family unavailable'),(409,'Quota, credit, plan, version or idempotency conflict'),(422,'Fixed question order or frozen Agent invalid'),(503,'Pinned capability unavailable')]} }}
    if method=='post':
        result['parameters'].append({'name':'Idempotency-Key','in':'header','required':True,'schema':string(minLength=1,maxLength=200)})
        result['requestBody']={'required':True,'content':{'application/json':{'schema':ref('NativeRunInput')}}}
        result['description']='Atomically reserve all fixed questions, preserving private experiment lineage and binding each task to a fresh native session, device, workspace hash and current Desktop login family. No cloud queue dispatch or model call. Every question must occur exactly once in original order, on one device; session IDs and workspace hashes must be distinct. Never reuse an accepted or unknown native question.'
    return result
contract={'openapi':'3.1.0','info':{'title':'CopyPaste Desktop-native GEO','version':'110.0.0'},'paths':{
    path+'/desktop-configuration':{'get':operation('readDesktopGeoConfiguration','NativeConfiguration','get')},
    path+'/desktop-runs':{'post':operation('prepareDesktopGeoRun','NativeRunReceipt','post')}},
    'components':{'securitySchemes':{'NativeBearer':{'type':'http','scheme':'bearer','description':'A current PKCE Desktop native authorization. A Web cookie or Extension token cannot prepare native work.'}},'schemas':schemas},
    'x-historical-geo-contract':{'path':BASE.relative_to(ROOT).as_posix(),'sha256':sha256(BASE.read_bytes()).hexdigest(),'unchanged':True},
    'x-execution':'Actual local Codex on the customer computer; company Responses gateway for all AI. Separate configuration from cloud runs. Native answer text is client-reported; financial usage uses company receipts.'}
parser=argparse.ArgumentParser();parser.add_argument('--mirror',action='store_true');args=parser.parse_args()
OUT.write_text(json.dumps(contract,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
if args.mirror:
    mirror=ROOT/'dev/copypaste-platform/contracts/desktop-geo-schemas.json'
    mirror.write_text(json.dumps({'normative_source_sha256':sha256(OUT.read_bytes()).hexdigest(),'schemas':schemas},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'schemas':len(schemas),'sha256':sha256(OUT.read_bytes()).hexdigest(),'mirror':args.mirror}))
