#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import hashlib,json,subprocess,urllib.request
root=Path('/opt/workmate/toolchains/pg-client-188-v1')
assert not root.exists(),'Existing client-tool provisioning preserved'
root.mkdir(mode=0o755)
for name in ['state/lists/partial','cache/archives/partial','packages','root']:(root/name).mkdir(parents=True,exist_ok=True)
key=root/'pgdg.asc'
with urllib.request.urlopen('https://www.postgresql.org/media/keys/ACCC4CF8.asc',timeout=30) as r:key.write_bytes(r.read(100000))
fingerprints=subprocess.check_output(['gpg','--with-colons','--show-keys',str(key)],text=True,stderr=subprocess.DEVNULL)
assert 'fpr:::::::::B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8:' in fingerprints,'Unexpected official repository signing key'
sources=root/'sources.list';sources.write_text('deb [signed-by='+str(key)+'] https://apt.postgresql.org/pub/repos/apt jammy-pgdg main\n')
options=['-o','Dir::Etc::sourcelist='+str(sources),'-o','Dir::Etc::sourceparts=-','-o','Dir::State::lists='+str(root/'state/lists'),'-o','Dir::Cache::archives='+str(root/'cache/archives'),'-o','APT::Get::List-Cleanup=0']
subprocess.run(['apt-get',*options,'update'],check=True,timeout=120)
subprocess.run(['apt-get',*options,'download','postgresql-client-18','libpq5'],cwd=root/'packages',check=True,timeout=120)
files=[]
for p in sorted((root/'packages').glob('*.deb')):
 subprocess.run(['dpkg-deb','-x',str(p),str(root/'root')],check=True)
 files.append({'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
import os
env={**os.environ,'LD_LIBRARY_PATH':str(root/'root/usr/lib/x86_64-linux-gnu')}
binary=root/'root/usr/lib/postgresql/18/bin/pg_dump'
version=subprocess.check_output([str(binary),'--version'],env=env,text=True).strip();assert ' 18.' in version
report={'stage':188,'status':'native_client_tools_ready','version':version,'packages':files,'system_package_installation':False,'system_repositories_modified':False,'services_modified':False,'signing_key_fingerprint':'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8'}
(root/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
PY
