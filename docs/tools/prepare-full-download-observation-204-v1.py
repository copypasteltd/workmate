"""Qualify the actual full browser flow; retain the deliberately ended range run."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
prior=load(L/'.data/deployment-204-v1/public-stream-v4.sanitized.json');assert prior['status']=='partial' and prior['owned_browser_closed']
assert next(x for x in prior['downloads'] if x['name'].endswith('Portable.exe'))['bytes']==24117248
p=L/'scripts/qualify-public-download-204-v5.mjs';s=p.read_text('utf-8-sig')
needle="const before=new Set(await readdir(folder)),event=page.waitForEvent('download',{timeout:60000});"
assert s.count(needle)==1;s=s.replace(needle,needle+"event.catch(()=>{});")
p.write_text(s,encoding='utf-8',newline='\n')
p=R/'docs/tools/document-integrated-round-204-v1.py';s=p.read_text('utf-8-sig')
needle="'partial_parallel_public_transfer':load(L/'.data/deployment-204-v1/public-stream-v3.sanitized.json'),"
assert s.count(needle)==1
s=s.replace(needle,needle+"'ended_sequential_range_observation':{'receipt':load(L/'.data/deployment-204-v1/public-stream-v4.sanitized.json'),'operator_ended':True,'retained_portable_prefix_bytes':24117248,'reason':'After slow actual sequential progress, only the exact owned range browser was closed to qualify the actual ordinary browser-managed product download flow. Final Target-closed read failures are operator termination, not attributed to the server.'},")
needle="pub=load(L/'.data/deployment-204-v1/public-stream-v4.sanitized.json');assert inner"
assert s.count(needle)==1;s=s.replace(needle,"pub=load(L/'.data/deployment-204-v1/public-download-v5.sanitized.json');assert inner")
s=s.replace('All four complete innerHTTP200 and original-TLS public206 release files have exact whole-file bytes/SHA.', 'All four complete innerHTTP200 and actual original-TLS browser-managed full release files have exact whole-file bytes/SHA. The three actual health responses retain the immutable failed/partial range-run source; that whole attempt remains partial.')
s=s.replace('完整内网200和公网原TLS全部206字节／SHA一致；', '完整内网200与公网原TLS浏览器完整下载字节／SHA一致；')
s=s.replace('完整内网200／公网原TLS全部206文件哈希验证；', '完整内网200／公网原TLS浏览器完整文件哈希验证；')
s=s.replace('Sequential safe range recovery retains every failed read and independently checks saved whole-file content.', 'The sequential range run was deliberately ended after24MiB; its original result remains partial. The actual browser-managed full download run is evaluated independently against all complete expected bytes and SHA values.')
p.write_text(s,encoding='utf-8',newline='\n')
print(json.dumps({'status':'prepared','retained_partial_bytes':24117248,'qualification':'Actual product download flow, complete bytes and SHA required','server_network_writes':False}))
