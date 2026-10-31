"""Current buildable source kit; historical frozen release and local secrets stay untouched."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
from datetime import datetime, timezone
import json, re, subprocess, sys, zipfile

ROOT=Path(__file__).resolve().parents[3]
DEV=ROOT/'dev'
DELIVERY=DEV/'copypaste-delivery'
COMPONENTS=['platform','web','admin','desktop','extension','delivery']
ADDED=['scripts/source-demo-runtime-158.mjs','scripts/start-source-demo-158.mjs','scripts/bootstrap-source-demo-158.mjs','scripts/package-source-handoff-158-v1.py']

def git(repo,*args):
 return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',str(repo),*args]).decode('utf-8')
def digest(p):
 h=sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return h.hexdigest()
def main():
 attempt=sys.argv[1];assert re.fullmatch(r'\d{2}',attempt)
 stem='workmate-source-158-'+attempt
 output=DELIVERY/'release'/stem;output.mkdir(parents=True,exist_ok=False)
 files={};heads={};excluded={}
 for c in COMPONENTS:
  repo=DEV/('copypaste-'+c);heads[c]=git(repo,'rev-parse','HEAD').strip()
  tracked=git(repo,'ls-files','-z','--','.',':(exclude)evidence/**',':(exclude)release/**',':(exclude)node_modules/**',':(exclude).data/**',':(exclude)dist/**').split('\0')
  selected=set()
  for f in tracked:
   if not f:continue
   parts=PurePosixPath(f).parts
   if any(x in parts for x in ['.git','node_modules','.data','dist','release','test-results','playwright-report']):continue
   if '.env' in parts or any(x.startswith('.env.') and x!='.env.example' for x in parts):continue
   if f.startswith('assets/screenshots/'):continue
   selected.add(f)
  if c=='delivery':selected.update(ADDED)
  for name in ['README.md','README.en.md']:
   for link in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)',(repo/name).read_text(encoding='utf-8')):
    link=link.split('#')[0]
    if not link or '://' in link or link.startswith(('/','../')):continue
    f=PurePosixPath(link)
    if '..' in f.parts or any(x in f.parts for x in ['.git','.data','node_modules','release','dist']):continue
    if (repo/link).is_file():selected.add(link)
  for f in sorted(selected):
   p=repo/f
   assert p.is_file(),str(p)
   files['dev/'+repo.name+'/'+f]=p
  excluded[c]='Git metadata, dependencies, local configuration/data, build outputs, historical raw evidence and unreferenced historical screenshots. README-linked media retained; full Git history/evidence remains on the component branches.'
 # Authoritative document text and top-level structured acceptance ledgers, without multi-GB raw blob stores.
 for folder in ['requirements','development','changes','governance','contracts','operations','deployment','product','design']:
  d=ROOT/'docs'/folder
  if d.exists():
   for p in d.rglob('*'):
    if p.is_file() and p.suffix.lower() in ['.md','.json','.yaml','.yml','.mmd']:files[p.relative_to(ROOT).as_posix()]=p
 for p in (ROOT/'docs').glob('README*.md'):files[p.relative_to(ROOT).as_posix()]=p
 for p in (ROOT/'docs/quality').glob('*'):
  if p.is_file() and p.suffix in ['.md','.json']:files[p.relative_to(ROOT).as_posix()]=p
 guide=ROOT/'docs/development/158-current-source-startup.md';assert guide.is_file()
 files['START-HERE.md']=guide
 sources={f:{'sha256':digest(p),'bytes':p.stat().st_size} for f,p in files.items()}
 manifest={'at':datetime.now(timezone.utc).isoformat(),'stage':158,'schema_version':155,'type':'post-freeze-buildable-source','root':stem,'base_commits':heads,'source_files':sources,'exclusions':excluded,'frozen_release':'v0.1.0-rc.1 remains the unchanged stage148 snapshot','runtime':'Companion ZIP required, or an explicitly supplied matching Codex plus all three adjacent helpers. No PATH lookup or automatic runtime download.'}
 mb=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
 source=output/(stem+'.zip')
 with zipfile.ZipFile(source,'x',zipfile.ZIP_DEFLATED,compresslevel=5) as z:
  for name,p in sorted(files.items()):z.write(p,stem+'/'+name)
  z.writestr(stem+'/SOURCE-MANIFEST.json',mb)
 runtime=DEV/'copypaste-desktop/.data/runtime/windows-x64';rm=json.loads((runtime/'runtime-manifest.json').read_bytes())
 assert rm['runtime']=='0.163.0-alpha.11'
 companion=output/(stem+'-codex-windows-x64.zip')
 with zipfile.ZipFile(companion,'x',zipfile.ZIP_DEFLATED,compresslevel=3) as z:
  for name,expected in rm['files'].items():
   p=runtime/name;assert p.stat().st_size==expected['bytes'] and digest(p)==expected['sha256']
   z.write(p,stem+'/dev/copypaste-desktop/.data/runtime/windows-x64/'+name)
  z.write(runtime/'runtime-manifest.json',stem+'/dev/copypaste-desktop/.data/runtime/windows-x64/runtime-manifest.json')
 receipt={'at':datetime.now(timezone.utc).isoformat(),'status':'packaged','stage':158,'source_manifest_sha256':sha256(mb).hexdigest(),'source_files':len(files),'base_commits':heads,'artifacts':{p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in [source,companion]},'runtime':rm,'scope':'Current source kit; not replacement binaries, installed Desktop acceptance, live model acceptance or a new frozen release tag.'}
 (output/'source-manifest.json').write_bytes(mb)
 (output/'package-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 (output/'SHA256SUMS').write_text(''.join(v['sha256']+'  '+k+'\n' for k,v in receipt['artifacts'].items()),encoding='utf-8',newline='\n')
 print(json.dumps({'output':str(output),'files':len(files),'artifacts':receipt['artifacts']},ensure_ascii=False))
if __name__=='__main__':main()
