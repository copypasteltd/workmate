"""Build the recovery API document from the actual backend response schemas."""
from pathlib import Path
from hashlib import sha256
import json

ROOT = Path(__file__).resolve().parents[2]
source = ROOT/'dev/copypaste-platform/contracts/native-recovery-schemas.json'
value = json.loads(source.read_text('utf-8-sig'))
result = {
 'openapi':'3.1.0', 'info':{'title':'Workmate native recovery readiness','version':'1.0.0'},
 'x-runtime-schema-sha256':sha256(source.read_bytes()).hexdigest(),
 'paths':{'/v1/admin/recovery':{'get':{
  'operationId':'readNativeRecoveryReadiness',
  'description':'Global admin.recovery.read, current ten-minute MFA, no overlapping explicit deny; audited. Returns summaries only. Restore execution remains quarantined.',
  'security':[{'adminSession':[]}],
  'parameters':[
   {'name':'limit','in':'query','schema':{'type':'integer','minimum':1,'maximum':100,'default':20}},
   {'name':'kind','in':'query','schema':{'type':'string','enum':['backup','ledger','restore']}},
   {'name':'cursor','in':'query','schema':{'type':'string','format':'uuid'}},
  ],
  'responses':{'200':{'description':'Current readiness and a stable cursor page','content':{'application/json':{'schema':{'$ref':'#/components/schemas/RecoverySummary'}}}},
   **{str(code):{'description':message} for code,message in [(400,'Invalid query or cursor'),(401,'Admin session required'),(403,'Current MFA or global permission required')]}
  }
 }}},
 'components':{'securitySchemes':{'adminSession':{'type':'apiKey','in':'cookie','name':'cp_admin_session'}},'schemas':value['schemas']}
}
target = ROOT/'docs/contracts/native-recovery.openapi.json'
target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'paths':len(result['paths']),'schemas':len(value['schemas'])}))
