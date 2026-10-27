"""Export the exact runtime native-pairing schemas and fixed HTTP operations."""
from pathlib import Path
from hashlib import sha256
import json
ROOT=Path(__file__).resolve().parents[2]
mirror=ROOT/'dev/copypaste-platform/contracts/desktop-pairing-schemas.json'
value=json.loads(mirror.read_text('utf-8'))
paths={}
for suffix,response,secured in [('', 'DesktopPairingReceipt',True),('/retire','DesktopPairingRetirement',False)]:
    paths['/v1/auth/native/device-pair'+suffix]={'post':{'summary':'Pair a fixed native intent' if secured else 'Permanently retire a proven intent, including an unacknowledged create','security':[{'NativeBearer':[]}] if secured else [],'requestBody':{'required':True,'content':{'application/json':{'schema':{'$ref':'#/components/schemas/DesktopPairingRequest'}}}},'responses':{'200':{'description':'Current device' if secured else 'Private retired/unverified receipt','content':{'application/json':{'schema':{'$ref':'#/components/schemas/'+response}}}}}}}
output={'openapi':'3.1.0','info':{'title':'CopyPaste recoverable Desktop pairing','version':'1.0.0','description':'Create and retirement use distinct Ed25519 signatures. Creation requires a current Desktop session in the original credential family and active workspace authority. Retirement accepts expired/revoked original credentials, stores a permanent private tombstone, and never grants access or retires another family.'},'x-runtime-schema-sha256':sha256(mirror.read_bytes()).hexdigest(),'paths':paths,'components':{'securitySchemes':{'NativeBearer':{'type':'http','scheme':'bearer'}},'schemas':value['schemas']}}
p=ROOT/'docs/contracts/native-pairings.openapi.json';assert not p.exists();p.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print('Exported two native pairing operations and three runtime schemas')
