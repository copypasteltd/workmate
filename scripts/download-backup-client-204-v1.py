"""Download official packages locally and upload; never configure host networking."""
from pathlib import Path
import base64,gzip,hashlib,json,re,urllib.request,paramiko
L=Path(__file__).resolve().parents[1];out=L/'.data/deployment-204-v1/postgres-client-download-v1';out.mkdir(parents=True,exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest()
def get(url,name):
 assert url.startswith(('https://www.postgresql.org/','https://apt.postgresql.org/'))
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Workmate-release-204'}),timeout=30) as r:assert r.status==200;data=r.read(16000000)
 assert data and len(data)<16000000
 with (out/name).open('xb') as f:f.write(data)
 print(json.dumps({'downloaded':name,'bytes':len(data)}),flush=True);return data
get('https://www.postgresql.org/media/keys/ACCC4CF8.asc','repository-key.asc')
origin='https://apt.postgresql.org/pub/repos/apt/'
signed=get(origin+'dists/jammy-pgdg/InRelease','InRelease')
index='18/binary-amd64/Packages.gz';compressed=get(origin+'dists/jammy-pgdg/'+index,'Packages.gz')
assert re.search(r'^ '+sha(compressed)+r' '+str(len(compressed))+' '+re.escape(index)+'$',signed.decode(),re.M)
records=[]
for block in gzip.decompress(compressed).decode().split('\n\n'):
 row=dict(line.split(': ',1) for line in block.splitlines() if line and not line.startswith(' ') and ': ' in line)
 if row.get('Package') in ['postgresql-client-18','libpq5'] and row.get('Architecture')=='amd64' and row.get('Version','').startswith('18.'):
  records.append(row)
assert len(records)==2 and {r['Package'] for r in records}=={'postgresql-client-18','libpq5'}
for row in records:
 assert row['Filename'].startswith('pool/') and '..' not in row['Filename']
 data=get(origin+row['Filename'],row['Package']+'.deb');assert sha(data)==row['SHA256'] and len(data)==int(row['Size'])
spec=json.loads((L/'.data/deployment-189/server-access.private.json').read_text('utf-8'));t=paramiko.Transport((spec['host'],22))
try:
 t.start_client(timeout=15)
 assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
 t.auth_password(spec['username'],spec['password']);s=paramiko.SFTPClient.from_transport(t)
 target='/home/carzygod/workmate-backup-client-204-v1';s.mkdir(target)
 files=[]
 for name in ['repository-key.asc','InRelease','Packages.gz','postgresql-client-18.deb','libpq5.deb']:
  s.put(str(out/name),target+'/'+name);raw=(out/name).read_bytes();files.append({'name':name,'bytes':len(raw),'sha256':sha(raw)})
 receipt={'status':'downloaded_and_uploaded_awaiting_server_signature_verification','destination':target,'files':files,'server_network_changes':False}
 with (out/'receipt.json').open('x',encoding='utf-8') as f:json.dump(receipt,f,indent=2);f.write('\n')
 print(json.dumps({'status':receipt['status'],'files':len(files)}),flush=True)
finally:t.close()
