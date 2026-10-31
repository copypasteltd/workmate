"""Ordinary atomic source/tag publication of the current frozen candidate."""
from pathlib import Path
from hashlib import sha256,sha1
from datetime import datetime,timezone
import json,os,subprocess,uuid
ROOT=Path(r'D:\dev\copypasted\自有agent');DEV=ROOT/'dev';VERSION='v0.1.0-rc.2';REMOTE='git@github.com:copypasteltd/workmate.git'
COMPONENTS={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
def digest(p):return sha256(p.read_bytes()).hexdigest()
def main():
 checkpoint=ROOT/'docs/quality/release-freeze-checkpoint-158.json';cp=json.loads(checkpoint.read_bytes());baseline=cp['baseline']
 output=DEV/'copypaste-delivery/.data/release-freeze-158'/('publication-'+str(uuid.uuid4()));output.mkdir(parents=True);log=(output/'commands.log').open('xb')
 receipt={'started_at':datetime.now(timezone.utc).isoformat(),'status':'running','release':VERSION,'remote':REMOTE,'checkpoint_sha256':digest(checkpoint),'components':{},'failure':None}
 env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_SSH_COMMAND':'ssh -o BatchMode=yes'}
 def git(repo,*args):
  argv=['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','gc.auto=0','-c','gc.autoPackLimit=0','-C',str(repo),*args];log.write((json.dumps({'cwd':str(repo),'args':args})+'\n').encode());log.flush();r=subprocess.run(argv,cwd=repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE);log.write(r.stdout+r.stderr+b'\n');log.flush();assert r.returncode==0,'Git operation failed; exact commands.log retained';return r.stdout
 def text(repo,*args):return git(repo,*args).decode().strip()
 def refs(pattern):return {s.split()[1]:s.split()[0] for s in text(ROOT,'ls-remote','origin',*pattern).splitlines()}
 def preserved():
  for name,h in {**baseline['frozen_files'],**baseline['preserved_user_files']}.items():assert digest(ROOT/name)==h,name
  assert digest(DEV/'copypaste-desktop/.gitattributes')==baseline['desktop_attributes_sha256']
 def source():
  for name,h in cp['qualified_sources'].items():assert digest(DEV/name)==h,name
 try:
  assert cp['status']=='qualified' and cp['schema_version']==155
  preserved();source()
  oldtags=refs(['refs/tags/v0.1.0-rc.1*']);assert len(oldtags)==14
  assert not refs(['refs/tags/'+VERSION+'*']),'New version already exists; never move a frozen tag'
  branches=list(COMPONENTS)+['docs','main'];old=refs(['refs/heads/'+b for b in branches]);assert len(old)==8
  for b in branches:assert old['refs/heads/'+b]==baseline['heads']['docs' if b in ['docs','main'] else COMPONENTS[b]],'Remote advanced; preserve other work'
  repos={b:DEV/('copypaste-'+c) for b,c in COMPONENTS.items()};repos['docs']=ROOT
  heads={}
  for branch,repo in repos.items():
   assert text(repo,'remote','get-url','origin')==REMOTE
   assert text(repo,'rev-parse','HEAD')==baseline['heads']['docs' if branch=='docs' else COMPONENTS[branch]]
   assert text(repo,'branch','--show-current')=='codex/'+branch
   assert text(repo,'diff','--cached','--name-only')=='','Pre-existing staged work must be preserved'
   specs=['docs/README.md','docs/README.en.md','docs/requirements/24-current-source-release.md','docs/development/158-current-source-startup.md','docs/changes/158-frozen-release.md','docs/releases/v0.1.0-rc.2.md','docs/quality/*158*','docs/assets/release-freeze-158','docs/tools/*158*'] if branch=='docs' else ['README.md','README.en.md','package.json','scripts/*158*','assets/screenshots/*158*','evidence/source-handoff-158','evidence/release-freeze-158']
   if branch=='backend':specs+=['scripts/db-local.ts','scripts/setup-local.ts']
   changed=set(git(repo,'diff','--name-only','-z','HEAD','--',*specs).decode().split('\0'))-{''};changed.update(set(git(repo,'ls-files','--others','--exclude-standard','-z','--',*specs).decode().split('\0'))-{''});assert changed,branch
   for i in range(0,len(changed),70):git(repo,'add','--',*sorted(changed)[i:i+70])
   staged=set(git(repo,'diff','--cached','--name-only','-z').decode().split('\0'))-{''};assert staged==changed
   for name in staged:
    raw=(repo/name).read_bytes();expected=sha1(('blob '+str(len(raw))+'\0').encode()+raw).hexdigest();row=text(repo,'ls-files','-s','--',name);assert row.split()[1]==expected,'Git normalization changed bound bytes: '+name
   source();preserved();git(repo,'commit','-m','Freeze Workmate '+VERSION+' with current complete source and startup handoff (stage158)');heads[branch]=text(repo,'rev-parse','HEAD');receipt['components'][branch]={'commit':heads[branch],'files':len(changed)}
  for branch,repo in repos.items():
   if branch!='docs':git(ROOT,'fetch','--no-tags',str(repo),heads[branch])
  tags={VERSION:heads['docs'],**{VERSION+'-'+b:heads[b] for b in COMPONENTS}}
  for tag,commit in tags.items():git(ROOT,'tag','-a',tag,commit,'-m','Workmate '+VERSION+' / current schema155 frozen candidate; synthetic external services')
  source();preserved()
  git(ROOT,'push','--atomic','origin',*[heads[b]+':refs/heads/'+b for b in COMPONENTS],heads['docs']+':refs/heads/docs',heads['docs']+':refs/heads/main',*['refs/tags/'+t+':refs/tags/'+t for t in tags])
  observed=refs(['refs/heads/'+b for b in branches]);assert all(observed['refs/heads/'+b]==heads['docs' if b=='main' else b] for b in branches)
  observed_tags=refs(['refs/tags/'+VERSION+'*']);assert len(observed_tags)==14
  for t,commit in tags.items():assert observed_tags['refs/tags/'+t+'^{}']==commit
  assert refs(['refs/tags/v0.1.0-rc.1*'])==oldtags
  source();preserved();receipt.update(status='published',verified_heads=observed,verified_tags=observed_tags,old_frozen_tags_unchanged=True)
 except Exception as e:receipt['status']='failed';receipt['failure']=type(e).__name__+': '+str(e)
 finally:
  receipt['finished_at']=datetime.now(timezone.utc).isoformat();(output/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');log.close();print(json.dumps({'status':receipt['status'],'receipt':str(output/'receipt.json'),'failure':receipt['failure']},ensure_ascii=False))
 assert receipt['status']=='published'
if __name__=='__main__':main()
