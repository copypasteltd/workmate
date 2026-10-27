"""Build signed-event API documentation from the actual runtime Zod schemas."""
from pathlib import Path
from hashlib import sha256
import json

ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'dev/copypaste-platform/contracts/cloud-events-schemas.json'
schemas=json.loads(source.read_text('utf-8-sig'))['schemas']
base='/v1/tenants/{tenant}/projects/{project}/cloud-workflow-events'
def ref(name): return {'$ref':'#/components/schemas/'+name}
def response(schema,description='Current scoped result'):
    return {'description':description,'content':{'application/json':{'schema':schema}}}
def operation(name,description,body=None,admin=False,query=None):
    value={'operationId':name,'description':description,'security':[{'adminSession' if admin else 'userSession':[]}],
           'responses':{'200':{'description':'Current authorized result'},**{str(n):{'description':v} for n,v in [(400,'Invalid input'),(401,'Authentication required'),(403,'Current scoped permission or MFA required'),(404,'Private resource unavailable'),(409,'Version, authorization or request conflict'),(410,'Content result withdrawn')]}}}
    if body:value['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
    if query:
        q=schemas[query]
        value['parameters']=[{'name':k,'in':'query','required':k in q.get('required',[]),'schema':v} for k,v in q['properties'].items()]
    return value
paths={
 base:{'get':operation('listPrivateCloudEvents','Current project read access, private owner only. Returns up to 50 pending proposals and 50 recent triggers with exact methods; inaccessible source content is excluded.',query='EventListQuery')},
 base+'/requests':{'post':operation('preparePrivateEventProposal','Project write. Supply a fixed published workflow version and exact event options. expected_version is forbidden for a new trigger. Saves pending proposal; never activates. Native Desktop activation is forbidden. Idempotency-Key required.','EventRequest')},
 base+'/{id}/requests':{'post':operation('revisePrivateEventProposal','Project write, private owner, exact current expected_version required. Saves a fresh pending revision; no implicit resumption. Idempotency-Key required.','EventProposalRequest')},
 base+'/requests/{id}/decision':{'post':operation('decidePrivateEventProposal','Activate requires project approve, successful origin, current authorization, exact specification hash and both exact budgets. Decline requires project write. No model approval tool. Idempotency response omits one-time key on retry. Idempotency-Key and CSRF required.','EventDecision')},
 base+'/{id}/status':{'post':operation('stopPrivateEventWork','Project write, exact control version. Pause or retire future work while preserving current runs. No resume action. Idempotency-Key required.','EventControl')},
 base+'/{id}/rotate-key':{'post':operation('rotatePrivateEventKey','Project approve and current method/source authority. Immediately retire old key. New secret appears only in first committed operation response, never a GET or replay. Idempotency-Key required.','EventRotate')},
 base+'/{id}':{'get':operation('readPrivateEventHistory','Private owner and current project/source access. Exact immutable method revisions and newest-first stable (received_at,id) cursor page. Foreign cursors are rejected.',query='EventHistoryQuery')},
 '/v1/admin/private-cloud-events':{'get':operation('listScopedAdminEventMetadata','Current ten-minute MFA, admin.execution.read in scope and no overlapping deny. Metadata only; no private names, definitions, event types, payloads, endpoints or secrets. Audited.',admin=True,query='AdminEventQuery')},
 '/v1/admin/private-cloud-events/{id}/pause':{'post':operation('pauseScopedAdminEventWork','Current MFA, admin.execution.pause in exact scope, reason and current control version. Preserves current work. No administrative event resume or key disclosure. Idempotency-Key required.','AdminEventPause',admin=True)},
}
hook={'operationId':'receiveSignedWorkmateEvent','description':'Workmate-owned HMAC-SHA256 over domain, trigger UUID, key version, timestamp and exact raw JSON bytes. Five-minute timestamp tolerance. Maximum 32 KiB; data depth <=6, <=300 values, strings <=4000 and ordinary keys <=80. Verify before parsing, recheck authority, persist inbox before 202. Exact event_id/raw-body retries return the original receipt; changed body returns 409. This is not a provider-native webhook format.',
      'security':[{'eventKeyVersion':[],'eventTimestamp':[],'eventSignature':[]}],
      'parameters':[{'name':'id','in':'path','required':True,'schema':{'type':'string','format':'uuid'}}],
      'requestBody':{'required':True,'content':{'application/json':{'schema':ref('EventEnvelope')}}},
      'responses':{'202':response({'type':'object','required':['accepted','duplicate','receipt'],'properties':{'accepted':{'const':True},'duplicate':{'type':'boolean'},'receipt':ref('EventReceipt')},'additionalProperties':False},'Committed durable event receipt, not a completed run'),**{str(n):{'description':v} for n,v in [(400,'Malformed or overly complex JSON'),(401,'Invalid signature/key/timestamp'),(404,'Unavailable trigger'),(409,'Event identifier body conflict'),(410,'Current authority/source withdrawn'),(413,'Body exceeds 32 KiB'),(429,'Rate or durable inbox limit; retry exact ID/body later')]}}}
paths['/v1/hooks/workflow-events/{id}']={'post':hook}
for route,verbs in paths.items():
    for verb,op in verbs.items():
        if route.startswith(base) or route.startswith('/v1/admin/'):
            op.setdefault('parameters',[])
            for part in ['tenant','project','id']:
                if '{'+part+'}' in route:op['parameters'].append({'name':part,'in':'path','required':True,'schema':{'type':'string','format':'uuid'}})
            if verb=='post':op['parameters'].append({'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','format':'uuid'}})
paths['/v1/admin/private-cloud-events']['get']['responses']['200']=response({'type':'object','properties':{'items':{'type':'array','items':ref('AdminEventMetadata')},'total':{'type':'integer'},'page':{'type':'integer'},'page_size':{'type':'integer'},'state':{'type':'string'}}})
result={'openapi':'3.1.0','info':{'title':'Workmate private signed cloud events','version':'1.0.0'},'x-runtime-schema-sha256':sha256(source.read_bytes()).hexdigest(),'paths':paths,
        'components':{'schemas':schemas,'securitySchemes':{'userSession':{'type':'apiKey','in':'cookie','name':'cp_session'},'adminSession':{'type':'apiKey','in':'cookie','name':'cp_admin_session'},
          **{k:{'type':'apiKey','in':'header','name':v} for k,v in [('eventKeyVersion','X-Workmate-Key-Version'),('eventTimestamp','X-Workmate-Timestamp'),('eventSignature','X-Workmate-Signature')]}}}}
target=ROOT/'docs/contracts/cloud-events.openapi.json'
target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'paths':len(paths),'schemas':len(schemas)}))
