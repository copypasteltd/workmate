#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone,timedelta
from email.utils import parsedate_to_datetime
import gzip,hashlib,json,os,re,subprocess,urllib.request
state=Path('/root/cfg/workmate/integrated-204/client-provision-v2');state.mkdir(mode=0o700)
runtime=Path('/opt/workmate/toolchains/postgresql-client-18-204-v2');assert not runtime.exists();runtime.mkdir()
sha=lambda b:hashlib.sha256(b).hexdigest()
show=lambda prop:subprocess.check_output(['systemctl','show','workmate-db.service','-p',prop,'--value'],text=True).strip()
before={k:show(k) for k in ['MainPID','NRestarts','ActiveState']};assert before['ActiveState']=='active'
def get(url,name):
 assert url.startswith(('https://www.postgresql.org/','https://apt.postgresql.org/'))
 data=(Path('/home/carzygod/workmate-backup-client-204-v3')/name).read_bytes()
 assert data and len(data)<16000000
 p=state/name;p.write_bytes(data);p.chmod(0o600);return data
key=get('https://www.postgresql.org/media/keys/ACCC4CF8.asc','repository-key.asc')
home=state/'gnupg';home.mkdir(mode=0o700)
base=['gpg','--no-options','--homedir',str(home),'--batch']
keys=subprocess.check_output(base+['--with-colons','--show-keys',str(state/'repository-key.asc')],text=True,stderr=subprocess.PIPE)
fingerprint='B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8'
assert fingerprint in [line.split(':')[9] for line in keys.splitlines() if line.startswith('fpr:')]
subprocess.run(base+['--dearmor','--output',str(state/'repository-key.gpg'),str(state/'repository-key.asc')],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
origin='https://apt.postgresql.org/pub/repos/apt/'
signed=get(origin+'dists/jammy-pgdg/InRelease','InRelease')
signature=subprocess.run(['gpgv','--keyring',str(state/'repository-key.gpg'),str(state/'InRelease')],check=True,capture_output=True)
(state/'signature.log').write_bytes(signature.stderr)
text=signed.decode();date=re.search(r'^Date: (.+)$',text,re.M);assert date
assert abs(datetime.now(timezone.utc)-parsedate_to_datetime(date[1]))<timedelta(days=7)
section=None;checks={}
for line in text.splitlines():
 if line and not line.startswith(' '):section=line
 elif section=='SHA256:':
  parts=line.split()
  if len(parts)==3 and re.fullmatch('[a-f0-9]{64}',parts[0]):checks[parts[2]]=(parts[0],int(parts[1]))
index_path='main/binary-amd64/Packages.gz';assert index_path in checks
compressed=get(origin+'dists/jammy-pgdg/'+index_path,'Packages.gz')
assert (sha(compressed),len(compressed))==checks[index_path]
records=[]
for block in gzip.decompress(compressed).decode().split('\n\n'):
 row={}
 for line in block.splitlines():
  if line and not line.startswith(' ') and ': ' in line:
   k,v=line.split(': ',1);row[k]=v
 if row.get('Package') in ['postgresql-client-18','libpq5'] and row.get('Architecture')=='amd64' and row.get('Version')=='18.4-1.pgdg22.04+1':
  records.append(row)
assert {r['Package'] for r in records}=={'postgresql-client-18','libpq5'} and len(records)==2
packages=[]
for row in records:
 filename=row['Filename'];assert filename.startswith('pool/') and '..' not in filename and re.fullmatch('[a-f0-9]{64}',row['SHA256'])
 name=row['Package']+'.deb';data=get(origin+filename,name)
 assert len(data)==int(row['Size']) and sha(data)==row['SHA256']
 subprocess.run(['dpkg-deb','--extract',str(state/name),str(runtime)],check=True,capture_output=True)
 packages.append({k:row[k] for k in ['Package','Version','Filename','Size','SHA256']})
dump=runtime/'usr/lib/postgresql/18/bin/pg_dump';restore=dump.with_name('pg_restore');lib=runtime/'usr/lib/x86_64-linux-gnu'
env={**os.environ,'LD_LIBRARY_PATH':str(lib)}
dependencies=subprocess.run(['ldd',str(dump)],env=env,check=True,capture_output=True,text=True)
assert 'not found' not in dependencies.stdout
versions={p.name:subprocess.check_output([str(p),'--version'],env=env,text=True).strip() for p in [dump,restore]}
assert all(re.search(r'\b18\.',v) for v in versions.values())
assert before=={k:show(k) for k in before}
report={'stage':204,'status':'prepared','at':datetime.now(timezone.utc).isoformat(),'dump':str(dump),'restore':str(restore),'library_directory':str(lib),'versions':versions,'signing_fingerprint':fingerprint,'inrelease_sha256':sha(signed),'index_sha256':sha(compressed),'packages':packages,'dump_sha256':sha(dump.read_bytes()),'restore_sha256':sha(restore.read_bytes()),'database_service_preserved':True,'system_packages_installed':False,'system_trust_or_apt_configuration_changed':False,'network_configuration_changed':False}
(runtime/'runtime.sanitized.json').write_text(json.dumps(report,indent=2)+'\n')
p=state/'receipt.sanitized.json';p.write_text(json.dumps(report,indent=2)+'\n');p.chmod(0o600)
print(json.dumps(report),flush=True)
PY
