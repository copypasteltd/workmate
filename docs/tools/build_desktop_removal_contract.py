"""Document the strict runtime schemas and device-specific removal protocol."""
from pathlib import Path
from hashlib import sha256
import json
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'dev/copypaste-platform/contracts/desktop-removal-schemas.json'
schemas=json.loads(source.read_text('utf-8'))['schemas']
result={'openapi':'3.1.0','info':{'title':'Workmate Desktop withdrawal','version':'1.0.0'},'x-runtime-schema-sha256':sha256(source.read_bytes()).hexdigest(),
 'paths':{'/v1/auth/native/disconnect':{'post':{
  'operationId':'disconnectDesktopInstallation','security':[],
  'description':'One-way withdrawal only. Possession of a Desktop refresh credential revokes its own family even when expired, used or already revoked. Retiring a device additionally requires its Ed25519 signature and matching credential owner, tenant and Desktop client. Removed membership does not block withdrawal. Unknown/foreign identifiers and wrong proof keys uniformly return unverified. Pending/claimed commands are cancelled; completed results and original files remain. Repeated identical requests are safe; no new access is issued. No session cookies or short-lived access token are needed. Body credentials must never enter logs.',
  'x-proof-message':'UTF-8 JSON array [copypaste.desktop-disconnect.v1, desktop, request_id, lowercase SHA256(refresh_token), tenant_id, device_id]; Ed25519 signature as exactly 86 base64url characters without padding.',
  'x-constraint':'At most 64 distinct (tenant_id,device_id) pairs; duplicate pairs are rejected before mutation. This semantic refinement is checked by the runtime.',
  'requestBody':{'required':True,'content':{'application/json':{'schema':{'$ref':'#/components/schemas/DesktopDisconnectRequest'}}}},
  'responses':{'200':{'description':'No-store, bounded result in request order. ok acknowledges processing, not successful revocation of unverified devices. Credentials with no devices use the same uniform acknowledgement as native revoke.','headers':{'Cache-Control':{'schema':{'const':'no-store'}}},'content':{'application/json':{'schema':{'$ref':'#/components/schemas/DesktopDisconnectReceipt'}}}},'400':{'description':'Invalid strict body or duplicate device pair'},'500':{'description':'No acknowledgement; retain encrypted request for retry'}}
 }}},'components':{'schemas':schemas}}
(ROOT/'docs/contracts/desktop-removal.openapi.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'paths':1,'schemas':len(schemas)}))
