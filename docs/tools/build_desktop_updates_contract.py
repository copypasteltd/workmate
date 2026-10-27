"""Document the actual runtime release schemas and company-only update transport."""
from pathlib import Path
from hashlib import sha256
import json
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'dev/copypaste-platform/contracts/desktop-updates-schemas.json'
schemas=json.loads(source.read_text('utf-8'))['schemas']
def op(name,description,body=None,public=False):
    result={'operationId':name,'description':description,'security':[] if public else [{'adminSession':[]}],
            'responses':{'200':{'description':'Current signed release or authorized operation result'},**{str(n):{'description':v} for n,v in [(400,'Invalid manifest, signature or part'),(401,'Sign in required'),(403,'Global action permission and current ten-minute MFA required; overlapping denies win'),(404,'Unavailable release/artifact'),(409,'Revision, immutable part, sequence or artifact conflict'),(503,'No current trusted release/storage')]}}}
    if body:result['requestBody']={'required':True,'content':{'application/json':{'schema':{'$ref':'#/components/schemas/'+body}}}}
    return result
base='/v1/admin/desktop-updates'
paths={base:{'get':op('listDesktopReleases','Global admin.desktop_updates.read, current MFA, audit. Channel stable/preview; 20 newest-first sequences and 20 latest publication records. before_sequence provides stable pagination. Trust status exposes no private key.'),
             'post':op('stageDesktopRelease','Global admin.desktop_updates.stage, current MFA. Offline Ed25519 signature, app/platform/key fingerprint, canonical JSON, expiry <=31 days and sequence floor verified. Stage a strictly higher sequence than current channel. No AI or customer credentials. Idempotency-Key required.','DesktopUpdateStage')},
       base+'/{id}/parts/{part}':{'put':op('uploadDesktopInstallerPart','Global staging permission, current MFA. Canonical base64 for one exact 4 MiB part (last part shorter), SHA-256, fixed index and total signed byte count. Identical retries succeed; changed bytes conflict. Only uploading releases. Audit metadata; no arbitrary server path.','DesktopUpdatePart')},
       base+'/{id}/finalize':{'post':op('finalizeDesktopInstaller','Global staging permission, current MFA. Serialize per release; verify every part and aggregate signed size/hash and Windows MZ header, fsync and atomically retain a company-owned immutable artifact. Existing content is hashed again. Repeat returns current state.')},
       base+'/{id}/publish':{'post':op('publishDesktopRelease','Independent global admin.desktop_updates.publish, current MFA and exact manifest checksum/current channel revision. Under locks, strictly increase signed channel sequence. Append immutable history. Rollback needs an exact formerly published release; withdrawal is an offline-signed null release at a higher sequence. Idempotency-Key required.','DesktopUpdatePublication')},
       '/v1/public/desktop-updates/{channel}':{'get':op('checkDesktopUpdate','No session/auth token. Returns {envelope:null} only for a never-published channel, otherwise the exact current signed envelope. No-store, fail closed on expired/untrusted publication. Clients persist sequence+envelope hash and independently verify every field, signature, rollout, compatibility and direction.',public=True)},
       '/v1/public/desktop-updates/artifacts/{sha256}':{'get':op('downloadDesktopInstaller','No session/auth token. Fixed company API origin, no redirects. Serves only an artifact referenced by a current valid channel head with exact content length, nosniff and no-store. Withdrawn/unpublished artifacts return 404. Desktop independently hashes actual bytes and validates Windows chain and publisher.',public=True)}}
for route,methods in paths.items():
    for method,value in methods.items():
        parameters=[]
        for name in ['id','part','channel','sha256']:
            if '{'+name+'}' in route:
                schema={'type':'integer','minimum':0,'maximum':511} if name=='part' else {'type':'string'}
                if name=='id':schema['format']='uuid'
                if name=='channel':schema['enum']=['stable','preview']
                if name=='sha256':schema['pattern']='^[a-f0-9]{64}$'
                parameters.append({'name':name,'in':'path','required':True,'schema':schema})
        if route==base and method=='get':
            parameters.extend([{'name':'channel','in':'query','required':False,'schema':{'type':'string','enum':['stable','preview'],'default':'stable'}},{'name':'before_sequence','in':'query','required':False,'schema':{'type':'integer','minimum':1}}])
        if method=='post' and route in [base,base+'/{id}/publish']:parameters.append({'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','format':'uuid'}})
        if parameters:value['parameters']=parameters
paths['/v1/public/desktop-updates/{channel}']['get']['responses']['200']={'description':'Exact signed current envelope, or null if never published','content':{'application/json':{'schema':{'type':'object','required':['envelope'],'properties':{'envelope':{'anyOf':[{'$ref':'#/components/schemas/DesktopUpdateEnvelope'},{'type':'null'}]}},'additionalProperties':False}}}}
paths['/v1/public/desktop-updates/artifacts/{sha256}']['get']['responses']['200']={'description':'Exact signed installer byte count; independently verify hash and publisher','content':{'application/octet-stream':{'schema':{'type':'string','format':'binary'}}}}
target=ROOT/'docs/contracts/desktop-updates.openapi.json'
target.write_text(json.dumps({'openapi':'3.1.0','info':{'title':'Workmate controlled native Desktop updates','version':'1.0.0'},'x-runtime-schema-sha256':sha256(source.read_bytes()).hexdigest(),'paths':paths,'components':{'schemas':schemas,'securitySchemes':{'adminSession':{'type':'apiKey','in':'cookie','name':'cp_admin_session'}}}},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'paths':len(paths),'schemas':len(schemas)}))
