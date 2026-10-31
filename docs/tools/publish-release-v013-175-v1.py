"""Publish reviewed v0.1.3 sources; prevalidate all staged blobs before committing."""
from pathlib import Path
from hashlib import sha256, sha1
from datetime import datetime, timezone
from urllib.parse import unquote
import json
import os
import re
import subprocess
import uuid
ROOT=Path(__file__).resolve().parents[2]; DEV=ROOT/'dev'; DELIVERY=DEV/'copypaste-delivery'; VERSION='v0.1.3'
COMPONENTS={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}; BRANCHES=[*COMPONENTS,'docs','main']
def digest(p):return sha256(p.read_bytes()).hexdigest()
cp_path=ROOT/'docs/quality/release-freeze-checkpoint-175.json'; cp=json.loads(cp_path.read_bytes()); baseline=cp['baseline']
out=DELIVERY/'.data/release-freeze-175'/('publication-'+str(uuid.uuid4())); out.mkdir(); log=(out/'commands.log').open('xb'); result={'at':datetime.now(timezone.utc).isoformat(),'status':'running','release':VERSION,'components':{},'failure':None}
env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_SSH_COMMAND':'ssh -o BatchMode=yes'}
def git(repo,*args):
 argv=['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','gc.auto=0','-c','gc.autoPackLimit=0','-C',str(repo),*args]; log.write((json.dumps({'repo':str(repo),'args':args})+'\n').encode());log.flush()
 p=subprocess.run(argv,cwd=repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0); log.write(p.stdout+p.stderr+b'\n');log.flush(); assert p.returncode==0,'Git failed; original log retained';return p.stdout.decode('utf-8').strip()
def refs():return {s.split()[1]:s.split()[0] for s in git(ROOT,'ls-remote','origin',*['refs/heads/'+b for b in BRANCHES],'refs/tags/v0.1.*').splitlines()}
def preserve():
 for n,h in baseline['preserved_user_files'].items():assert digest(ROOT/n)==h
 assert digest(DEV/'copypaste-desktop/.gitattributes')==baseline['desktop_attributes_sha256']
 for release,v in baseline['frozen_releases'].items():
  d=DELIVERY/'release'/('workmate-'+release);assert digest(d/'release-manifest.json')==v['manifest_sha256'];assert digest(d/'SHA256SUMS')==v['sums_sha256'];assert Path(v['complete_archive']['path']).stat().st_size==v['complete_archive']['bytes']
 for n,h in cp['qualified_sources'].items():assert digest(DEV/n)==h,n
try:
 assert cp['status']=='qualified' and cp['release']==VERSION and cp['schema_version']==156; assert cp['focused_qualification']['native_sql_api_at174']==21 and cp['focused_qualification']['actual_ui_checks_at174']==7
 assert cp['windows_distribution']['source_and_outputs_identical_to173']; preserve(); before=refs(); assert before==baseline['remote_refs'] and len(before)==120
 repos={b:DEV/('copypaste-'+c) for b,c in COMPONENTS.items()};repos['docs']=ROOT
 names={b:['README.md','README.en.md'] for b in COMPONENTS}

 names['backend']+=['src/admin-usage-report-model.ts','src/admin-usage-report-query.ts','src/admin-usage-reports.ts','contracts/admin-team-usage-174.json','tests/admin-team-usage-fixture-174-v1.ts','tests/admin-team-usage-174-v1.test.ts','scripts/serve-admin-team-usage-174-v1.ts']
 names['admin']+=['src/usage-reports.tsx','src/usage-reports.css']
 names['delivery']+=['scripts/package-frozen-release-175-v1.py','scripts/publish-github-release-175-v1.py','scripts/audit-release-scope-175-v1.mjs','evidence/release-freeze-175/source-scope-01.json']
 for v in [1,2,3]:
  names['delivery'] += [f'scripts/qa-admin-team-usage-174-v{v}.ts', f'scripts/qualify-admin-team-usage-174-v{v}.mjs', f'evidence/admin-team-usage-174/qualification-{v:02}.json',f'evidence/admin-team-usage-174/admin-ui-{v:02}.json']
 names['docs']=['docs/README.md','docs/README.en.md','docs/product/08-admin-dashboard.md','docs/requirements/31-admin-team-usage.md','docs/contracts/admin-team-usage-174.json','docs/development/174-admin-team-usage.md','docs/changes/174-admin-team-usage.md','docs/quality/admin-team-usage-174.json','docs/quality/remaining-work-stage174.json','docs/quality/remaining-work-stage174.md','docs/tools/prepare-admin-team-usage-174-v1.py','docs/releases/v0.1.3.md','docs/releases/v0.1.3-delivery-scope.md','docs/development/175-release-v013-freeze.md','docs/changes/175-release-v013-freeze.md','docs/quality/release-freeze-checkpoint-175.json','docs/tools/prepare-release-v013-175-v1.py','docs/tools/publish-release-v013-175-v1.py','docs/tools/finalize-release-v013-175-v1.py','docs/tools/author-release-v013-175-v1.py']
 report174=json.loads((ROOT/'docs/quality/admin-team-usage-174.json').read_bytes())
 for row in report174['media']['copies']:
  relative=row['path']
  if relative.startswith('docs/'): names['docs'].append(relative)
  else:
   parts=relative.split('/'); component=parts[1].removeprefix('copypaste-'); branch='backend' if component=='platform' else component
   names[branch].append('/'.join(parts[2:]))
 for branch in names: names[branch]=sorted(set(names[branch]))
 for b,repo in repos.items():
  assert git(repo,'rev-parse','HEAD')==baseline['heads']['docs' if b=='docs' else COMPONENTS[b]]
  assert not git(repo,'diff','--cached','--name-only');assert set(git(repo,'diff','--name-only','-z').split('\0'))-{''}<=set(names[b])
  for name in (['docs/README.md','docs/README.en.md'] if b=='docs' else ['README.md','README.en.md']):
   for link in re.findall(r'!?\[[^\]]*\]\(([^\s)]+)\)',(repo/name).read_text(encoding='utf-8')):
    if not link.startswith(('https://','http://','#')):assert ((repo/name).parent/unquote(link.split('#')[0])).is_file(),(b,link)
  git(repo,'add','--',*names[b]);assert set(git(repo,'diff','--cached','--name-only','-z').split('\0'))-{''}==set(names[b])
  for n in names[b]:
   raw=(repo/n).read_bytes();assert git(repo,'ls-files','-s','--',n).split()[1]==sha1(('blob '+str(len(raw))+'\0').encode()+raw).hexdigest(),n
 heads={}
 for b,repo in repos.items():
  git(repo,'commit','-m','Freeze Workmate v0.1.3 complete source and client delivery (stage175)');heads[b]=git(repo,'rev-parse','HEAD');result['components'][b]={'commit':heads[b],'files':len(names[b])}; print(json.dumps({'phase':'committed','component':b,'commit':heads[b]}),flush=True)
 for b in COMPONENTS:git(ROOT,'fetch','--no-tags','--no-write-fetch-head',str(repos[b]),heads[b])
 assert refs()==before;tags={}
 for b in [*COMPONENTS,'docs']:
  tag=VERSION+('' if b=='docs' else '-'+b);assert not git(ROOT,'tag','--list',tag);git(ROOT,'tag','-a',tag,heads[b],'-m','Workmate v0.1.3 complete frozen synthetic delivery; '+b);tags[tag]={'object':git(ROOT,'rev-parse','refs/tags/'+tag),'commit':heads[b]}
 preserve();git(ROOT,'push','--atomic','origin',*[heads[b]+':refs/heads/'+b for b in COMPONENTS],heads['docs']+':refs/heads/docs',heads['docs']+':refs/heads/main',*['refs/tags/'+t+':refs/tags/'+t for t in tags])
 expected={**before,**{'refs/heads/'+b:heads['docs' if b=='main' else b] for b in BRANCHES}}
 for tag,v in tags.items():expected['refs/tags/'+tag]=v['object'];expected['refs/tags/'+tag+'^{}']=v['commit']
 assert refs()==expected and len(expected)==134;preserve();result.update(status='published',verified_refs=expected,tags=tags,previous_frozen_tags_unchanged=True,preserved_user_files=12)
except Exception as e:result.update(status='failed',failure=type(e).__name__+': '+str(e))
finally:
 result['finished_at']=datetime.now(timezone.utc).isoformat();result['publisher_sha256']=digest(Path(__file__));log.close()
 with (out/'receipt.json').open('x',encoding='utf-8',newline='\n') as f:f.write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'status':result['status'],'receipt':str(out/'receipt.json'),'failure':result['failure']},ensure_ascii=False),flush=True)
assert result['status']=='published'
