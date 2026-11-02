from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[3]
platform=root/'dev/copypaste-platform'
source=platform/'tests/provider-admin-188-v1.test.ts'
raw=source.read_bytes();text=raw.decode('utf8')
prefix=text.split('test("provider policy routes enforce Admin audience')[0]
assert prefix.count('  d = evidence(f.row),')==1
prefix=prefix.replace('  d = evidence(f.row),','  d: any = evidence(f.row),')
prefix+='\nexport {s,a,reviewer,fixture,evidence,registerEvidence,submit,decision,call,ok,root,admin};\n'
target=platform/'tests/provider-termination-fixture-189-v1.ts'
with target.open('x',encoding='utf8',newline='\n') as stream:stream.write(prefix)
print(json.dumps({'fixture':str(target),'original_source_sha256':hashlib.sha256(raw).hexdigest(),'scope':'Owned native database and actual audited provider API operations; explicit simulated upstream only.'}))
