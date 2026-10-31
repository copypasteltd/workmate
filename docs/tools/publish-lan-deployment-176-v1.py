"""Review every staged raw blob before any commit; ordinary atomic publication."""
from pathlib import Path
from hashlib import sha256,sha1
from datetime import datetime,timezone
from urllib.parse import unquote
import json,os,re,subprocess,uuid
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-176'
COMPONENTS={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
BRANCHES=[*COMPONENTS,'docs','main'];out=P/('publication-'+str(uuid.uuid4()));out.mkdir()
log=(out/'commands.log').open('xb');result={'stage':176,'status':'started','at':datetime.now(timezone.utc).isoformat(),'components':{}}
env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_SSH_COMMAND':'ssh -o BatchMode=yes'}
def git(repo,*args,raw=False):
 argv=['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','gc.auto=0','-c','gc.autoPackLimit=0','-C',str(repo),*args]
 log.write((json.dumps({'repo':str(repo),'args':args})+'\n').encode());log.flush()
 p=subprocess.run(argv,cwd=repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
 if not raw:log.write(p.stdout+p.stderr+b'\n');log.flush()
 assert p.returncode==0,'Git failed; original private command log retained'
 return p.stdout if raw else p.stdout.decode('utf-8').strip()
def refs():return {s.split()[1]:s.split()[0] for s in git(ROOT,'ls-remote','origin',*['refs/heads/'+b for b in BRANCHES],'refs/tags/v0.1.*').splitlines()}
def digest(p):return sha256(p.read_bytes()).hexdigest()
prior=json.loads((D/'.data/release-freeze-175/handoff-b583bdd4-1f20-461e-8195-153e7328c772/receipt.json').read_bytes())
baseline=json.loads((ROOT/'docs/quality/release-freeze-checkpoint-175.json').read_bytes())['baseline']
def preserve():
 for name,h in baseline['preserved_user_files'].items():assert digest(ROOT/name)==h,'User file changed: '+name
 assert digest(DEV/'copypaste-desktop/.gitattributes')==baseline['desktop_attributes_sha256']
 for release,frozen in baseline['frozen_releases'].items():
  folder=D/'release'/('workmate-'+release);assert digest(folder/'release-manifest.json')==frozen['manifest_sha256'];assert digest(folder/'SHA256SUMS')==frozen['sums_sha256']
 assert digest(D/'release/workmate-v0.1.3/release-manifest.json')=='8b1f7b660d797655fa48ba15d14d20cf89969288e81edcf984dd99fb0f35b346'
try:
 preserve();before=refs();assert before==prior['verified_refs'] and len(before)==134
 report=json.loads((ROOT/'docs/quality/lan-deployment-176.json').read_bytes());assert report['status']=='deployed_and_qualified'
 for name,h in report['sources'].items():assert digest(ROOT/name)==h,'Qualified source changed: '+name
 for row in report['media']:assert digest(ROOT/row['path'])==row['sha256']
 repos={b:DEV/('copypaste-'+c) for b,c in COMPONENTS.items()};repos['docs']=ROOT
 names={b:['README.md','README.en.md'] for b in COMPONENTS}
 changed=json.loads((P/'http-client-paths.json').read_bytes())
 for name in changed:
  _,repo,*tail=name.split('/');b='web' if repo=='copypaste-web' else 'admin';names[b].append('/'.join(tail))
 for b in ['web','admin']:
  names[b]+=['src/browser-crypto.ts','tests/browser-crypto-176.test.ts']
  for folder,pattern in [('assets/screenshots','176*.png'),('assets/demos','176-lan-http.*')]:names[b]+=[p.relative_to(repos[b]).as_posix() for p in sorted((repos[b]/folder).glob(pattern))]
 names['admin']+=['package.json','package-lock.json']
 names['delivery'] += [p.relative_to(D).as_posix() for p in sorted((D/'scripts').glob('*176*')) if p.is_file()]
 names['delivery'] += ['tests/public-config-session-176.test.ts']+[p.relative_to(D).as_posix() for p in sorted((D/'evidence/lan-deployment-176').iterdir()) if p.is_file()]
 names['docs']=['docs/README.md','docs/README.en.md','docs/requirements/32-lan-http-deployment.md','docs/releases/lan-176.md','docs/development/176-lan-http-deployment.md','docs/changes/176-lan-http-deployment.md','docs/quality/lan-deployment-176.json']
 names['docs'] += [p.relative_to(ROOT).as_posix() for p in sorted((ROOT/'docs/assets/lan-176').iterdir()) if p.is_file()]
 names['docs'] += [p.relative_to(ROOT).as_posix() for p in sorted((ROOT/'docs/tools').glob('*lan*176*')) if p.is_file()]
 for b in names:names[b]=sorted(set(names[b]))
 private=json.loads((P/'qa-login-context.json').read_bytes());sensitive=[v.encode() for k,v in private.items() if k.endswith(('_password','_secret'))]
 staged={}
 # All seven indexes are checked in full before the first commit is allowed.
 for b,repo in repos.items():
  assert git(repo,'rev-parse','HEAD')==before['refs/heads/'+b]
  assert not git(repo,'diff','--cached','--name-only')
  assert set(git(repo,'diff','--name-only','-z').split('\0'))-{''}<=set(names[b]),'Unrelated tracked change in '+b
  for n in names[b]:
   assert not any(part in ['.data','node_modules','.env','.git','dist','release'] for part in Path(n).parts)
   raw=(repo/n).read_bytes();assert not any(v in raw for v in sensitive),'Private credential detected; no secret value logged'
   assert not re.search(rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----',raw),'Private key detected'
  for name in (['docs/README.md','docs/README.en.md'] if b=='docs' else ['README.md','README.en.md']):
   for link in re.findall(r'!?\[[^\]]*\]\(([^\s)]+)\)',(repo/name).read_text(encoding='utf-8')):
    if not link.startswith(('https://','http://','#')):assert ((repo/name).parent/unquote(link.split('#')[0])).is_file(),(b,link)
  git(repo,'add','--',*names[b]);assert set(git(repo,'diff','--cached','--name-only','-z').split('\0'))-{''}==set(names[b])
  for n in names[b]:
   raw=(repo/n).read_bytes();oid=sha1(('blob '+str(len(raw))+'\0').encode()+raw).hexdigest()
   assert git(repo,'ls-files','-s','--',n).split()[1]==oid and git(repo,'cat-file','blob',':'+n,raw=True)==raw,'Staged raw bytes differ: '+n
  staged[b]={'files':len(names[b]),'raw_bytes_validated':True}
 result['prevalidated_all_seven_indexes']=staged;preserve();assert refs()==before
 heads={}
 for b,repo in repos.items():
  git(repo,'commit','-m','Deploy Workmate LAN HTTP services and authenticated preview (stage176)');heads[b]=git(repo,'rev-parse','HEAD');result['components'][b]={'commit':heads[b],'files':len(names[b])};print(json.dumps({'phase':'committed','component':b,'commit':heads[b]}),flush=True)
 for b in COMPONENTS:git(ROOT,'fetch','--no-tags','--no-write-fetch-head',str(repos[b]),heads[b])
 assert refs()==before;preserve()
 git(ROOT,'push','--atomic','origin',*[heads[b]+':refs/heads/'+b for b in COMPONENTS],heads['docs']+':refs/heads/docs',heads['docs']+':refs/heads/main')
 expected={**before,**{'refs/heads/'+b:heads['docs' if b=='main' else b] for b in BRANCHES}}
 assert refs()==expected and len(expected)==134;preserve()
 for b,repo in repos.items():assert not git(repo,'status','--porcelain','--untracked-files=no')
 result.update(status='published_and_verified',verified_refs=expected,preserved_user_files=12,all_frozen_tags_unchanged=True,all_seven_tracked_worktrees_clean=True)
except Exception as e:result.update(status='failed',failure=type(e).__name__+': '+str(e))
finally:
 result['finished_at']=datetime.now(timezone.utc).isoformat();result['publisher_sha256']=digest(Path(__file__));log.close()
 with (out/'receipt.json').open('x',encoding='utf-8',newline='\n') as f:f.write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'status':result['status'],'receipt':str(out/'receipt.json'),'failure':result.get('failure')},ensure_ascii=False),flush=True)
assert result['status']=='published_and_verified'
