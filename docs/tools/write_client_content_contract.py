"""Additive OpenAPI contract; never regenerate published historical contracts."""
from pathlib import Path
import json
import subprocess

ROOT=Path(__file__).resolve().parents[2]
platform=ROOT/'dev/copypaste-platform'
source='''import {z} from 'zod'; import {clientContentDocument,clientContentAudience} from './src/client-content-model.ts'; process.stdout.write(JSON.stringify({Document:z.toJSONSchema(clientContentDocument),Audience:z.toJSONSchema(clientContentAudience)}));'''
schemas=json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',source],cwd=platform))
for schema in schemas.values(): schema.pop('$schema',None)
schemas['Document']['description']='Complete bilingual presentation bundle. Server additionally rejects duplicate section keys and duplicate client/path menu overrides and validates each client-specific existing optional path. A visibility end must follow its start.'
schemas['Audience']['description']='Client, workspace, user and stable percentage conditions intersect. Empty ID lists mean any. At most one targeted rollout is active. Unselected users receive the exact frozen baseline.'
def ref(name): return {'$ref':'#/components/schemas/'+name}
def obj(properties,required=None): return {'type':'object','additionalProperties':False,'required':required if required is not None else list(properties),'properties':properties}
uuid={'type':'string','format':'uuid'}
reason={'type':'string','minLength':3,'maxLength':1000}
schemas['Sample']=obj({'client':{'type':'string','enum':['web','desktop','extension']},'user_id':uuid,'tenant_id':uuid},['client'])
schemas['Draft']=obj({'document':ref('Document'),'audience':ref('Audience'),'reason':reason})
schemas['PreviewRequest']=obj({'action':{'type':'string','enum':['publish','rollback']},'reason':reason,'sample':ref('Sample')})
schemas['Confirmation']=obj({'preview_id':uuid})
def responses():return {'200':{'description':'Authorized current result'},'400':{'description':'Invalid strict schema or missing workspace context'},'401':{'description':'Live sign-in required'},'403':{'description':'Permission, explicit restriction or recent MFA required'},'404':{'description':'Authorized resource not found'},'409':{'description':'Expired/stale/session-mismatched preview, unavailable subject, overlapping rollout, legacy conflict or idempotency conflict'}}
paths={}
def add(path,method,summary,permission=None,body=None,parameters=None):
    operation={'summary':summary,'security':[{'adminSession':[]}] if permission else [{'userSession':[]},{'nativeBearer':[]}],'responses':responses()}
    if permission:operation['x-permission']=permission
    if method=='post':operation['x-csrf-and-origin-check']=True;operation['x-recent-mfa-seconds']=600
    if body:operation['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
    if parameters:operation['parameters']=parameters
    paths.setdefault(path,{})[method]=operation
add('/v1/client-content','get','Read effective presentation for the live authenticated identity',parameters=[{'name':'client','in':'query','required':True,'schema':{'type':'string','enum':['web','desktop','extension']}},{'name':'project_id','in':'query','schema':uuid,'description':'Requires X-Tenant-ID and projectAccess'},{'name':'X-Tenant-ID','in':'header','schema':uuid,'description':'Optional workspace; server validates live membership'}])
add('/v1/admin/client-content','get','List immutable content versions, current head, initial document and supported menu inventory','admin.catalog.read',parameters=[{'name':'before_version','in':'query','schema':{'type':'integer','minimum':1}},{'name':'limit','in':'query','schema':{'type':'integer','minimum':1,'maximum':100,'default':30}}])
add('/v1/admin/client-content','post','Save an immutable bilingual draft with an exact audience','admin.catalog.draft','Draft',[{'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','minLength':16,'maxLength':128,'pattern':r'^[\w:-]+$'}}])
add('/v1/admin/client-content/publications','get','Read append-only publication and rollback history','admin.catalog.read',parameters=[{'name':'before_revision','in':'query','schema':{'type':'integer','minimum':1}},{'name':'limit','in':'query','schema':{'type':'integer','minimum':1,'maximum':100,'default':30}}])
add('/v1/admin/client-content/{id}/previews','post','Freeze a five-minute recipient comparison against the current publication','admin.catalog.publish OR admin.catalog.rollback, matching action; admin.catalog.read also required','PreviewRequest',[{'name':'id','in':'path','required':True,'schema':uuid}])
for action in ['publish','rollback']:add('/v1/admin/client-content/'+action,'post','Append the exact reviewed '+action+' after live authority/session/MFA checks','admin.catalog.'+action+' and admin.catalog.read','Confirmation')
value={'openapi':'3.1.0','info':{'title':'Workmate client content releases','version':'1.0.0','description':'Additive presentation API contract. Zod definitions supply document/audience schemas. Server transaction and PostgreSQL guards additionally enforce context, audience, version, baseline and append-only invariants. No execution permissions can be granted through presentation.'},'paths':paths,'components':{'schemas':schemas,'securitySchemes':{'adminSession':{'type':'apiKey','in':'cookie','name':'cp_admin_session'},'userSession':{'type':'apiKey','in':'cookie','name':'cp_session'},'nativeBearer':{'type':'http','scheme':'bearer'}}}}
file=ROOT/'docs/contracts/client-content-openapi.json'
with file.open('x',encoding='utf-8',newline='\n') as out:json.dump(value,out,ensure_ascii=False,indent=2);out.write('\n')
print(json.dumps({'routes':sum(len(v) for v in paths.values()),'schemas':len(schemas)}))
