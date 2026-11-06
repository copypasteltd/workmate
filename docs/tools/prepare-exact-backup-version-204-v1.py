"""Select the actual server's exact client version from the signed multi-version index."""
from pathlib import Path
import ast,json
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts'
text=(S/'download-backup-client-204-v2.py').read_text('utf-8').replace('postgres-client-download-v2','postgres-client-download-v3').replace('workmate-backup-client-204-v2','workmate-backup-client-204-v3')
text=text.replace("row.get('Version','').startswith('18.')","row.get('Version')=='18.4-1.pgdg22.04+1'")
anchor=" with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Workmate-release-204'}),timeout=30) as r:assert r.status==200;data=r.read(16000000)"
assert anchor in text
text=text.replace(anchor," cached=L/'.data/deployment-204-v1/postgres-client-download-v2'/name\n if name in ['repository-key.asc','InRelease','Packages.gz']:data=cached.read_bytes()\n else:\n  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Workmate-release-204'}),timeout=30) as r:assert r.status==200;data=r.read(16000000)")
ast.parse(text)
with (S/'download-backup-client-204-v3.py').open('x',encoding='utf-8',newline='\n') as f:f.write(text)
for name,before,after in [('provision-backup-client-204-v2.sh','workmate-backup-client-204-v2','workmate-backup-client-204-v3'),('provision-backup-client-204-v2.sh',"row.get('Version','').startswith('18.')","row.get('Version')=='18.4-1.pgdg22.04+1'"),('continue-deployment-204-v2.py','postgres-client-download-v2','postgres-client-download-v3')]:
 p=S/name;text=p.read_text('utf-8');assert before in text;p.write_text(text.replace(before,after),encoding='utf-8',newline='\n')
print(json.dumps({'status':'exact_server_client184_prepared','signed_multi_version_index_retained':True}))
