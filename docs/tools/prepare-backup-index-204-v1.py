"""Use the signed main index; retain the observed empty optional version index."""
from pathlib import Path
import ast,json
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts'
text=(S/'download-backup-client-204-v1.py').read_text('utf-8').replace('postgres-client-download-v1','postgres-client-download-v2').replace('workmate-backup-client-204-v1','workmate-backup-client-204-v2').replace("index='18/binary-amd64/Packages.gz'","index='main/binary-amd64/Packages.gz'")
ast.parse(text)
with (S/'download-backup-client-204-v2.py').open('x',encoding='utf-8',newline='\n') as f:f.write(text)
for name,before,after in [('provision-backup-client-204-v2.sh','workmate-backup-client-204-v1','workmate-backup-client-204-v2'),('provision-backup-client-204-v2.sh',"index_path='18/binary-amd64/Packages.gz'","index_path='main/binary-amd64/Packages.gz'"),('continue-deployment-204-v2.py','postgres-client-download-v1','postgres-client-download-v2')]:
 p=S/name;text=p.read_text('utf-8');assert before in text;p.write_text(text.replace(before,after),encoding='utf-8',newline='\n')
print(json.dumps({'status':'main_signed_index_prepared','original_empty_index_preserved':True}))
