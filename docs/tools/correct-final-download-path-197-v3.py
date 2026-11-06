from pathlib import Path
from hashlib import sha256
import json
root=Path(__file__).resolve().parents[2];d=root/'dev/copypaste-delivery';s=d/'scripts';out=d/'.data/deployment-197-v2'
def put(p,text):p.write_text(text,encoding='utf8',newline='\n')
# Preserve the executed creator and failed metadata logs. Keep the existing numeric release-directory contract.
creator=(s/'prepare-public-downloads-197-v2.py').read_text(encoding='utf8').replace('/releases/197-v2/','/releases/19702/').replace('package-receipt.private.json\').write_text','package-receipt-v3.private.json\').write_text')
put(s/'prepare-public-downloads-197-v3.py',creator)
meta=(s/'finalize-release-metadata-197-v2.mjs').read_text(encoding='utf8').replace("phase+'-final.log'", "phase+'-final-v3.log'")
put(s/'finalize-release-metadata-197-v3.mjs',meta)
for filename in ['activate-downloads-197-v2.sh','probe-release-integrated-197-v3.mjs','smoke-integrated-197-v3.mjs']:
 p=s/filename;text=p.read_text(encoding='utf8').replace('/releases/197-v2','/releases/19702')
 if filename.startswith('probe-'):text=text.replace('package-receipt.private.json','package-receipt-v3.private.json')
 if filename.startswith('smoke-'):text=text.replace('Final deployed candidate 197 v1.','Final deployed candidate197 v2, numeric immutable release19702.')
 put(p,text)
logs=[out/'web-build-final.log',out/'catalog-test-final.log']
receipt={'stage':197,'status':'failed','scope':'Final metadata validation before deployment. The release path197-v2 violated the unchanged numeric-directory catalog contract. No production code defect, package corruption or public activation.','correction':'Use the established numeric directory19702; preserve all original packages and this attempt. Rerun only final Web metadata build/catalog checks.','logs':[{'name':p.name,'sha256':sha256(p.read_bytes()).hexdigest()} for p in logs]}
(out/'release-metadata-failure-v2.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf8')
print('Prepared numeric immutable release19702 and versioned metadata retry. Original failed logs retained.')
