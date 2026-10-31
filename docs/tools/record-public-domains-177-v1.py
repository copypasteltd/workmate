"""Collect current-source hashes and immutable, sanitized deployment receipts."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,shutil
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-177'
evidence=D/'evidence/public-domains-177';evidence.mkdir()
receipts={
 'actual-browser-02.json':P/'browser-1d8d400d-1f2c-43e4-818c-753e0ac05622/receipt.json',
 'native-surfaces-02.json':P/'native-941cd5d9-8ee4-4cf4-aa4f-7ca809d0759e/receipt.json',
 'desktop-authorization-03.json':P/'desktop-auth-5dadc1a8-0f0f-4670-8b1e-d769d43d3fca/receipt.json',
 'server-runtime.json':P/'server-runtime.sanitized.json',
 'server-final.json':P/'server-final.sanitized.json',
 'client-artifacts.json':P/'workmate-domain-clients-177.json',
}
for name,p in receipts.items():
 data=json.loads(p.read_bytes())
 if name.startswith(('actual-browser','native-surfaces','desktop-authorization')):assert data['status']=='passed'
 shutil.copyfile(p,evidence/name)
failed=[]
for folder,reason in [('browser-c0c71124-9087-4f8b-81f6-36cc76047869','Observed real bootstrap-401 versus email sign-in race; fixed Web/Admin authentication generations.'),('native-9518c9de-df3e-4b69-9592-a5c02df0aa88','Verifier reloaded before the packaged initial file navigation settled; forward verifier waits for initial navigation.'),('desktop-auth-76b55c10-c070-49f0-ba16-f5490e147cb4','Verifier used the visual label rather than the actual Local specialist accessible name; corrected forward verifier.')]:
 p=P/folder/'receipt.json';raw=p.read_bytes();data=json.loads(raw);assert data['status']=='failed'
 target=evidence/('retained-'+folder+'.json');shutil.copyfile(p,target)
 failed.append({'receipt':target.relative_to(ROOT).as_posix(),'original_sha256':sha256(raw).hexdigest(),'explanation':reason})
with (evidence/'retained-failed-runs.json').open('x') as f:json.dump({'stage':177,'failures':failed,'original_receipts_and_verifiers_preserved':True},f,indent=2)
for name in ['README.md','README.en.md']:
 p=DEV/'copypaste-desktop'/name
 text=p.read_text(encoding='utf-8');needle='![Packaged Desktop sign-in](assets/screenshots/177-domain-signin.png)'
 assert needle in text;text=text.replace(needle,needle+'\n\n![Authorized local Desktop workspace](assets/screenshots/177c-domain-workspace.png)',1);p.write_text(text,encoding='utf-8',newline='\n')
repos={b:DEV/('copypaste-'+c) for b,c in {'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}.items()};repos['docs']=ROOT
names={b:['README.md','README.en.md'] for b in repos if b!='docs'}
names['backend']+=['src/auth.ts','src/cookie-policy.ts','src/federation.ts','src/publication-connections.ts','tests/cookie-policy-177.test.ts','tests/cookie-policy-177-v2.test.ts']
for b in ['web','admin']:names[b]+=['src/api.ts']
names['desktop']+=['deployment.json','package.json','package-lock.json','renderer/src/api.ts','src/deployment.ts']
names['extension']+=['deployment.json','package.json','package-lock.json','scripts/build.mjs']
for b in ['web','admin','desktop','extension']:
 for p in sorted((repos[b]/'assets/screenshots').glob('177*.png')):names[b].append(p.relative_to(repos[b]).as_posix())
 for p in sorted((repos[b]/'assets/demos').glob('177-public-domains.*')):names[b].append(p.relative_to(repos[b]).as_posix())
names['delivery']+=[p.relative_to(D).as_posix() for p in sorted((D/'scripts').glob('*177*')) if p.is_file()]
names['delivery']+=['tests/auth-bootstrap-race-177.test.ts','tests/public-config-session-177.test.ts']
names['delivery']+=[p.relative_to(D).as_posix() for p in sorted(evidence.iterdir()) if p.is_file()]
names['docs']=['docs/README.md','docs/README.en.md','docs/releases/domains-177.md','docs/requirements/33-public-domains.md','docs/development/177-public-domains.md','docs/changes/177-public-domains.md','docs/quality/public-domains-177.json']
names['docs']+=[p.relative_to(ROOT).as_posix() for p in sorted((ROOT/'docs/assets/domains-177').iterdir()) if p.is_file()]
names['docs']+=[p.relative_to(ROOT).as_posix() for p in sorted((ROOT/'docs/tools').glob('*177*')) if p.is_file()]
for b in names:names[b]=sorted(set(names[b]))
sources={};media=[]
for b,paths in names.items():
 for name in paths:
  p=repos[b]/name
  if name=='docs/quality/public-domains-177.json':continue
  raw=p.read_bytes();relative=p.relative_to(ROOT).as_posix();digest=sha256(raw).hexdigest()
  if p.suffix in ['.png','.gif','.mp4']:media.append({'path':relative,'bytes':len(raw),'sha256':digest})
  else:sources[relative]=digest
web=json.loads(receipts['actual-browser-02.json'].read_bytes());native=json.loads(receipts['native-surfaces-02.json'].read_bytes());auth=json.loads(receipts['desktop-authorization-03.json'].read_bytes());server=json.loads(receipts['server-final.json'].read_bytes())
assert web['browser_closed'] and native['owned_windows_closed'] and auth['owned_windows_closed']
assert len(web['checks'])==13 and len(native['checks'])==4 and len(auth['checks'])==3
report={'stage':177,'status':'deployed_and_qualified','at':datetime.now(timezone.utc).isoformat(),'mode':'authorized_synthetic_public_https','base_release':'v0.1.3','previous_increment':176,
 'origins':{'web':'https://agent.copypaste.hk','admin':'https://agent-dashboard.copypaste.hk','api':'https://ai-api.copypaste.hk'},
 'upstream':{'lan':'192.168.31.20','zerotier':'192.168.196.204','ports':[63070,63071,63072]},
 'native_versions':{'desktop':'0.7.2','extension':'0.5.3','local_codex':'0.163.0-alpha.11','windows_signed':False},
 'checks':{'cookie_and_production_config':6,'http_transport_and_auth_races':20,'public_browser_journey':13,'packaged_native_surfaces':4,'desktop_authorization_and_local_catalog':3,'unit_evidence':'Observed successful tool TAP output; no implementation changes after these checks. Native Desktop authorization/catalog uses the actual packaged application.','all_owned_windows_closed':True},
 'actual_codex_task':{'id':web['task'],'status':web['task_status'],'kernel':'codex','execution':'cloud_linux','provider_mode':'simulated','download_verified':True},
 'cookie_boundaries':{'user':web['user_cookie'],'admin':web['admin_cookie']},'server':server,
 'receipts':{n:p.relative_to(ROOT).as_posix() for n,p in ((n,evidence/n) for n in receipts)},'retained_failures':failed,'sources':sources,'media':media,
 'boundaries':['Real AI/media/ads/payment and SMTP are not configured; synthetic mode remains authorized.','Windows installers are unsigned; the verified updater gate remains closed.','Exact Windows cloud program/browser profiles are not qualified on Linux.','This is a domain/source increment, not replacement of frozen v0.1.3.']}
with (ROOT/'docs/quality/public-domains-177.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
with (P/'publication-paths.json').open('x',encoding='utf-8') as f:json.dump(names,f,ensure_ascii=False,indent=2)
print(json.dumps({'sources':len(sources),'media':len(media),'files_by_repository':{b:len(v) for b,v in names.items()}}))
