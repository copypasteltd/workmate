#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import fcntl,hashlib,json,os,shutil,subprocess,urllib.request
cfg=Path('/root/cfg/workmate/integrated-205');baseline=json.loads((cfg/'resume-baseline-v1.json').read_text())
state=cfg/'downloads-v2';state.mkdir(mode=0o700,exist_ok=True)
lock=(state/'publication.lock').open('a+');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
source=Path('/home/carzygod/workmate-downloads-205-v1');manifest=json.loads((source/'manifest.json').read_text());assert manifest['stage']==205
expected={'CopyPaste-0.7.18-x64-Setup.exe','CopyPaste-0.7.18-x64-Portable.exe','CopyPaste-Extension-0.5.7.zip','SHA256SUMS.txt'};assert set(manifest['files'])==expected
root=Path('/opt/workmate/downloads');releases=root/'releases';dest=releases/'20501';stage=releases/'.20501-staging-v2'
assert releases.resolve()==Path('/opt/workmate/downloads/releases') and not releases.is_symlink()
quarantine=root/'interrupted';quarantine.mkdir(mode=0o700,exist_ok=True);assert quarantine.resolve()==Path('/opt/workmate/downloads/interrupted') and not quarantine.is_symlink()
saved=quarantine/('20501-'+baseline['boot_id']+'-v1')
def syncdir(p):
 fd=os.open(str(p),os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def complete(folder):
 if not folder.is_dir() or folder.is_symlink():return False
 if {p.name for p in folder.iterdir()}!=expected:return False
 return all((folder/n).is_file() and not (folder/n).is_symlink() and (folder/n).stat().st_size==r['bytes'] and digest(folder/n)==r['sha256'] for n,r in manifest['files'].items())
for n,r in manifest['files'].items():assert (source/n).is_file() and not (source/n).is_symlink() and (source/n).stat().st_size==r['bytes'] and digest(source/n)==r['sha256']
network=json.loads(Path('/root/cfg/workmate/integrated-202/network-baseline-v1.json').read_text())['files'];assert all(digest(Path(p))==h for p,h in network.items())
if not complete(dest):
 assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()=='/opt/workmate/overlays/integrated-204-v2/backend'
 assert Path('/opt/workmate/overlays/integrated-201-v1/web/dist').resolve()==Path('/opt/workmate/overlays/integrated-204-v2/web/dist')
 stage.mkdir(mode=0o755,exist_ok=True);assert stage.is_dir() and not stage.is_symlink()
 assert {p.name for p in stage.iterdir()}.issubset(expected|{'.'+n+'.part' for n in expected})
 for n,r in manifest['files'].items():
  target=stage/n
  if target.exists():assert target.is_file() and not target.is_symlink() and target.stat().st_size==r['bytes'] and digest(target)==r['sha256'];continue
  partial=stage/('.'+n+'.part')
  if partial.exists():
   assert partial.is_file() and not partial.is_symlink();prior=quarantine/(baseline['boot_id']+'-staging-'+n);assert not prior.exists();partial.rename(prior);syncdir(quarantine);syncdir(stage)
  with (source/n).open('rb') as src,partial.open('xb') as dst:
   shutil.copyfileobj(src,dst,1024*1024);dst.flush();os.fchmod(dst.fileno(),0o644);os.fsync(dst.fileno())
  assert partial.stat().st_size==r['bytes'] and digest(partial)==r['sha256'];partial.rename(target);syncdir(stage)
 assert complete(stage);syncdir(stage)
 if dest.exists():
  assert dest.is_dir() and not dest.is_symlink() and not saved.exists()
  actual=[{'name':p.name,'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(dest.iterdir()) if p.is_file() and not p.is_symlink()]
  assert len(actual)==len(list(dest.iterdir())) and actual==baseline['interrupted_public_files']
  dest.rename(saved);syncdir(quarantine);syncdir(releases)
 else:assert saved.is_dir(),'Original interrupted directory must remain recoverable'
 stage.rename(dest);syncdir(releases)
assert complete(dest) and saved.is_dir()
for n in expected:
 fd=os.open(str(dest/n),os.O_RDONLY)
 try:os.fsync(fd)
 finally:os.close(fd)
syncdir(dest);syncdir(releases)
checks=[]
for n,row in manifest['files'].items():
 url='http://127.0.0.1:63070/downloads/releases/20501/'+n
 with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=10) as r:assert r.status==200 and int(r.headers['Content-Length'])==row['bytes']
 with urllib.request.urlopen(urllib.request.Request(url,headers={'Range':'bytes=0-15'}),timeout=10) as r:
  assert r.status==206
  with (dest/n).open('rb') as f:assert r.read()==f.read(16)
 checks.append({'name':n,'head':200,'range':206,'bytes':row['bytes'],'sha256':row['sha256']})
assert all(digest(Path(p))==h for p,h in network.items())
report={'stage':205,'status':'published','at':datetime.now(timezone.utc).isoformat(),'files':manifest['files'],'checks':checks,'old_releases_preserved':True,'interrupted_original_preserved':str(saved),'full_files_and_parent_directories_fsynced':True,'publication':'Verified private staging followed by atomic directory rename; existing generic download alias. No network/configuration change or proxy reload.','network_configuration_unchanged':True}
receipt=state/'receipt.json'
if receipt.exists():
 old=json.loads(receipt.read_text());assert old['status']=='published' and old['files']==manifest['files'];report=old
else:
 with receipt.open('x') as f:f.write(json.dumps(report,indent=2)+'\n');f.flush();os.fsync(f.fileno())
 receipt.chmod(0o600);syncdir(state)
print(json.dumps(report))
PY
