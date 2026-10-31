"""Freeze the current seven-component distribution and a complete single-file handoff."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,os,re,subprocess,uuid,zipfile
ROOT=Path(__file__).resolve().parents[3];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery';VERSION='v0.1.0-rc.2';OUTPUT=DELIVERY/'release'/('workmate-'+VERSION)
COMPONENTS={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
def digest(p):
 h=sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return h.hexdigest()
def git(repo,*args):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',str(repo),*args]).decode().strip()
def main():
 assert not OUTPUT.exists(),'Never overwrite a frozen release'
 cp=json.loads((ROOT/'docs/quality/release-freeze-checkpoint-158.json').read_bytes());assert cp['status']=='qualified' and cp['schema_version']==155
 for p,h in cp['qualified_sources'].items():assert digest(DEV/p)==h,p
 # The publication directory is resolved by the publisher after the checkpoint
 # is committed. Resolve the unique matching successful receipt, without editing it.
 candidates=[]
 for p in (DELIVERY/'.data/release-freeze-158').glob('publication-*/receipt.json'):
  value=json.loads(p.read_bytes())
  if value['status']=='published' and value['release']==VERSION:candidates.append(p)
 assert len(candidates)==1;publication=candidates[0];published=json.loads(publication.read_bytes())
 for branch,c in COMPONENTS.items():assert git(DEV/('copypaste-'+c),'rev-parse','HEAD')==published['components'][branch]['commit']
 subprocess.run(['C:/Python313/python.exe','-X','utf8','scripts/package-source-handoff-158-v4.py','04'],cwd=DELIVERY,check=True)
 source=DELIVERY/'release/workmate-source-158-04';sr=json.loads((source/'package-receipt.json').read_bytes())
 stage=DELIVERY/'.data/release-freeze-158'/('prepared-'+str(uuid.uuid4()));stage.mkdir(parents=True);assert stage.resolve().is_relative_to(DEV.resolve()) and OUTPUT.resolve().is_relative_to(DEV.resolve())
 artifacts=[];contents={}
 def archive(name,entries,kind):
  target=stage/name;listing={}
  with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
   for p,n in entries:
    z.write(p,n);listing[n]={'sha256':digest(p),'bytes':p.stat().st_size}
  with zipfile.ZipFile(target) as z:assert len(z.infolist())==len(listing)>0
  artifacts.append({'file':name,'kind':kind,'bytes':target.stat().st_size,'sha256':digest(target),'entries':len(listing)});contents[name]=listing;print(json.dumps(artifacts[-1]),flush=True)
 def folder(p,prefix=''):return [(f,prefix+f.relative_to(p).as_posix()) for f in sorted(p.rglob('*')) if f.is_file()]
 package=Path(cp['package_root'])
 for p,h in cp['package_files'].items():assert digest(package/p)==h,p
 archive('workmate-'+VERSION+'-windows-x64-unsigned.zip',folder(package,'CopyPaste/'),'current_unsigned_portable_windows_app')
 for name in ['web','admin','extension']:
  directory=DEV/('copypaste-'+name)/'dist';assert (directory/('manifest.json' if name=='extension' else 'index.html')).is_file();archive('workmate-'+VERSION+'-'+name+'.zip',folder(directory),'native_chrome_side_panel' if name=='extension' else 'current_static_build')
 platform=DEV/'copypaste-platform';backend=[]
 for f in git(platform,'ls-files','-z','--','src','scripts','catalog','contracts','skills','migrations','assets/fonts','public','package.json','package-lock.json','tsconfig.json','.env.example','README.md','README.en.md').split('\0'):
  if f and (platform/f).is_file():backend.append((platform/f,'copypaste-platform/'+f))
 for name in ['README.md','README.en.md']:
  for link in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)',(platform/name).read_text(encoding='utf-8')):
   f=link.split('#')[0]
   if f.startswith('assets/screenshots/') and '..' not in Path(f).parts and (platform/f).is_file():backend.append((platform/f,'copypaste-platform/'+f))
 backend+=folder(platform/'dist','copypaste-platform/dist/');backend=[(p,n) for n,p in {n:p for p,n in backend}.items()];archive('workmate-'+VERSION+'-backend.zip',backend,'compiled_backend_with_source_lockfiles_and_runtime_assets')
 for old,suffix,kind in [('workmate-source-158-04.zip','buildable-sources.zip','six_current_independent_buildable_source_trees'),('workmate-source-158-04-codex-windows-x64.zip','source-runtime-windows-x64.zip','pinned_source_runtime_companion')]:
  p=source/old;expected=sr['artifacts'][old];assert digest(p)==expected['sha256'];target=stage/('workmate-'+VERSION+'-'+suffix)
  with p.open('rb') as a,target.open('xb') as b:
   for block in iter(lambda:a.read(4*1024*1024),b''):b.write(block)
  artifacts.append({'file':target.name,'kind':kind,'bytes':target.stat().st_size,'sha256':digest(target)});print(json.dumps(artifacts[-1]),flush=True)
 guide=(ROOT/'docs/releases'/(VERSION+'.md')).read_text(encoding='utf-8')
 guide=guide.replace('](../quality/','](https://github.com/copypasteltd/workmate/blob/'+VERSION+'/docs/quality/').replace('](../development/','](https://github.com/copypasteltd/workmate/blob/'+VERSION+'/docs/development/').replace('](../assets/','](assets/')
 (stage/'README.md').write_text(guide,encoding='utf-8',newline='\n')
 for original in (ROOT/'docs/assets/release-freeze-158').glob('*'):
  if original.is_file():
   target=stage/'assets/release-freeze-158'/original.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(original.read_bytes())
 (stage/'source-files.json').write_bytes((source/'source-manifest.json').read_bytes())
 (stage/'artifact-contents.json').write_text(json.dumps(contents,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');(stage/'publication-receipt.json').write_bytes(publication.read_bytes())
 manifest={'product':'Workmate','release':VERSION,'frozen_at':datetime.now(timezone.utc).isoformat(),'release_type':'current_complete_frozen_candidate','schema_version':155,'ai_mode':'authorized_synthetic','codex':{'version':'0.163.0-alpha.11','sha256':'00c0f1e4099246fddcd67ec620ca8ed50827c7d70e113b7224f7a2933cf2d67c','desktop_execution':'customer_local'},'docs_commit':git(ROOT,'rev-parse','HEAD'),'docs_tag':VERSION,'components':[{'branch':b,'directory':'copypaste-'+c,'commit':git(DEV/('copypaste-'+c),'rev-parse','HEAD'),'tree':git(DEV/('copypaste-'+c),'rev-parse','HEAD^{tree}'),'tag':VERSION+'-'+b,'component_version':json.loads((DEV/('copypaste-'+c)/'package.json').read_bytes())['version']} for b,c in COMPONENTS.items()],'artifacts':artifacts,'source_manifest':{'file':'source-files.json','sha256':digest(stage/'source-files.json')},'artifact_contents':{'file':'artifact-contents.json','sha256':digest(stage/'artifact-contents.json')},'qualification_checkpoint':{'path':'docs/quality/release-freeze-checkpoint-158.json','sha256':digest(ROOT/'docs/quality/release-freeze-checkpoint-158.json')},'qualification_scope':cp['scope'],'github_release_channel':cp['github_release_channel'],'limits':['External AI/media/ads/payment dependencies use authorized synthetic data; live production integration not accepted','Windows portable build is unsigned; signed installer/update acceptance remains open','Full historical, cross-OS and whole102-record acceptance was deliberately not rerun','Old v0.1.0-rc.1 artifacts and tags remain unchanged'],'packager_sha256':digest(Path(__file__))}
 (stage/'release-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 (stage/'SHA256SUMS').write_text(''.join(digest(p)+'  '+p.relative_to(stage).as_posix()+'\n' for p in sorted(stage.rglob('*')) if p.is_file()),encoding='utf-8',newline='\n')
 for p,h in cp['qualified_sources'].items():assert digest(DEV/p)==h,p
 assert not OUTPUT.exists();stage.replace(OUTPUT)
 complete=DELIVERY/'release'/('workmate-'+VERSION+'-complete.zip');assert not complete.exists()
 with zipfile.ZipFile(complete,'x',zipfile.ZIP_STORED) as z:
  for f in sorted(OUTPUT.rglob("*")):
   if f.is_file():z.write(f,OUTPUT.name+'/'+f.relative_to(OUTPUT).as_posix())
 (complete.parent/(complete.name+'.sha256')).write_text(digest(complete)+'  '+complete.name+'\n',encoding='utf-8',newline='\n')
 receipt={'at':datetime.now(timezone.utc).isoformat(),'status':'frozen','release':VERSION,'directory':str(OUTPUT),'artifact_count':len(artifacts),'complete_archive':{'path':str(complete),'bytes':complete.stat().st_size,'sha256':digest(complete)},'manifest_sha256':digest(OUTPUT/'release-manifest.json'),'sums_sha256':digest(OUTPUT/'SHA256SUMS'),'git_publication':str(publication)}
 p=DELIVERY/'.data/release-freeze-158/frozen-receipt.json';p.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps(receipt,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
