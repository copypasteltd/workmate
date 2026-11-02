"""Review all seven indexes, scan exact new raw blobs, then ordinarily push atomically.

Unchanged published history retains its original audits; this is an incremental audit.
"""
from pathlib import Path
from hashlib import sha256,sha1
from datetime import datetime,timezone
from urllib.parse import unquote
import json,os,re,subprocess,uuid
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-188'
COMP={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
BRANCHES=[*COMP,'docs','main'];out=P/('publication-'+str(uuid.uuid4()));out.mkdir()
log=(out/'commands.log').open('xb');result={'stage':188,'status':'started','at':datetime.now(timezone.utc).isoformat(),'components':{}}
env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_SSH_COMMAND':'ssh -o BatchMode=yes'}
def git(repo,*args,raw=False):
 argv=['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','gc.auto=0','-c','gc.autoPackLimit=0','-C',str(repo),*args]
 log.write((json.dumps({'repo':str(repo),'args':args})+'\n').encode());log.flush()
 p=subprocess.run(argv,cwd=repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
 if not raw:log.write(p.stdout+p.stderr+b'\n');log.flush()
 assert p.returncode==0,'Git failed; private command log retained'
 return p.stdout if raw else p.stdout.decode('utf-8').strip()
def refs():return {s.split()[1]:s.split()[0] for s in git(ROOT,'ls-remote','origin',*['refs/heads/'+b for b in BRANCHES],'refs/tags/v0.1.*').splitlines()}
def digest(p):return sha256(p.read_bytes()).hexdigest()
baseline=json.loads((ROOT/'docs/quality/release-freeze-checkpoint-175.json').read_bytes())['baseline']
def preserve():
 for name,h in baseline['preserved_user_files'].items():assert digest(ROOT/name)==h,'User file changed: '+name
 assert digest(DEV/'copypaste-desktop/.gitattributes')==baseline['desktop_attributes_sha256']
 for release,r in baseline['frozen_releases'].items():
  folder=D/'release'/('workmate-'+release);assert digest(folder/'release-manifest.json')==r['manifest_sha256'];assert digest(folder/'SHA256SUMS')==r['sums_sha256']
try:
 preserve();before=refs();assert len(before)==134
 report=json.loads((ROOT/'docs/quality/live-acceptance-188.json').read_bytes());assert report['status']=='deployed_with_open_acceptance_gaps'
 for n,h in report['sources'].items():assert digest(ROOT/n)==h,'Qualified source changed: '+n
 for r in report['media']:assert digest(ROOT/r['path'])==r['sha256']
 repos={b:DEV/('copypaste-'+c) for b,c in COMP.items()};repos['docs']=ROOT
 names=json.loads((P/'publication-paths.json').read_bytes())
 private=json.loads((D/'.data/deployment-179/qa-login-context.json').read_bytes());sensitive=[str(v).encode() for k,v in private.items() if k.endswith(('_password','_secret'))]
 reviewed={}
 # No commit occurs until every independent index and every staged change passes.
 for b,repo in repos.items():
  assert git(repo,'rev-parse','HEAD')==before['refs/heads/'+b]
  assert not git(repo,'diff','--cached','--name-only')
  assert set(git(repo,'diff','--name-only','-z').split('\0'))-{''}<=set(names[b]),'Unrelated tracked change in '+b
  for n in names[b]:
   assert not any(v in Path(n).parts for v in ['.data','node_modules','.env','.git','dist','release'])
   raw=(repo/n).read_bytes();assert not any(v in raw for v in sensitive),'Private credential detected; value withheld'
   assert not re.search(rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----',raw),'Private key detected'
  for name in (['docs/README.md','docs/README.en.md'] if b=='docs' else ['README.md','README.en.md']):
   for link in re.findall(r'!?\[[^\]]*\]\(([^\s)]+)\)',(repo/name).read_text(encoding='utf-8')):
    if not link.startswith(('https://','http://','#')):assert ((repo/name).parent/unquote(link.split('#')[0])).is_file(),(b,link)
  if names[b]:git(repo,'add','--',*names[b])
  assert set(git(repo,'diff','--cached','--name-only','-z').split('\0'))-{''}==set(names[b])
  # Raw-byte checks bypass line-ending filters for every new indexed object.
  for n in names[b]:
   raw=(repo/n).read_bytes();oid=sha1(('blob '+str(len(raw))+'\0').encode()+raw).hexdigest()
   assert git(repo,'ls-files','-s','--',n).split()[1]==oid and git(repo,'cat-file','blob',':'+n,raw=True)==raw,'Staged bytes differ: '+n
  reviewed[b]={'changed_files':len(names[b]),'new_raw_blobs_validated':True,'index_checked':True}
 result['prevalidated_all_seven_indexes']=reviewed;preserve();assert refs()==before
 heads={}
 for b,repo in repos.items():
  if names[b]:git(repo,'commit','-m','Qualify real services, repair native Codex contracts and document open gaps (stage188)')
  heads[b]=git(repo,'rev-parse','HEAD');result['components'][b]={'commit':heads[b],'files':len(names[b])}
  print(json.dumps({'phase':'committed' if names[b] else 'preserved','component':b,'commit':heads[b]}),flush=True)
 for b in COMP:git(ROOT,'fetch','--no-tags','--no-write-fetch-head',str(repos[b]),heads[b])
 assert refs()==before;preserve()
 git(ROOT,'push','--atomic','origin',*[heads[b]+':refs/heads/'+b for b in COMP],heads['docs']+':refs/heads/docs',heads['docs']+':refs/heads/main')
 expected={**before,**{'refs/heads/'+b:heads['docs' if b=='main' else b] for b in BRANCHES}}
 assert refs()==expected;preserve()
 for b,repo in repos.items():assert not git(repo,'status','--porcelain','--untracked-files=no')
 result.update(status='published_and_verified',verified_refs=expected,preserved_user_files=len(baseline['preserved_user_files']),all_frozen_tags_unchanged=True,all_seven_tracked_worktrees_clean=True,audit_scope='all seven indexes, exact changed raw blobs and current README links; previously published history retains its historical audit scope')
except Exception as e:result.update(status='failed',failure=type(e).__name__+': '+str(e))
finally:
 result['finished_at']=datetime.now(timezone.utc).isoformat();result['publisher_sha256']=digest(Path(__file__));log.close()
 with (out/'receipt.json').open('x',encoding='utf-8',newline='\n') as f:f.write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'status':result['status'],'receipt':str(out/'receipt.json'),'failure':result.get('failure')},ensure_ascii=False),flush=True)
assert result['status']=='published_and_verified'
