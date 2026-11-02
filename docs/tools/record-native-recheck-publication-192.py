"""Publish the verified source receipt without changing any frozen release or tag."""
from pathlib import Path
from datetime import datetime,timezone
from hashlib import sha256,sha1
import json,os,subprocess,uuid

ROOT=Path(__file__).resolve().parents[2];D=ROOT/'dev/copypaste-delivery';P=D/'.data/acceptance-192'
def load(p):return json.loads(p.read_bytes())
def digest(p):return sha256(p.read_bytes()).hexdigest()
def save(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def git(*args,raw=False):
 p=subprocess.run(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','gc.auto=0','-C',str(ROOT),*args],capture_output=True,check=True,env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_SSH_COMMAND':'ssh -o BatchMode=yes'})
 return p.stdout if raw else p.stdout.decode('utf8').strip()
source_path=P/'publication-0841d36a-2af7-42c7-996e-7db8c264444c/receipt.json';source=load(source_path);report=load(ROOT/'docs/quality/192-native-recheck.json')
assert source['status']=='published_and_verified' and source['all_frozen_tags_unchanged']
for name,h in report['sources'].items():assert digest(ROOT/name)==h
for item in report['evidence']+report['media']:assert digest(ROOT/item['path'])==item['sha256']
assert not git('diff','--name-only') and not git('diff','--cached','--name-only')
def refs():return {line.split()[1]:line.split()[0] for line in git('ls-remote','origin','refs/heads/*','refs/tags/*').splitlines()}
before=refs();assert before==source['verified_refs'];assert git('rev-parse','HEAD')==before['refs/heads/docs']==before['refs/heads/main']
baseline=load(ROOT/'docs/quality/release-freeze-checkpoint-175.json')['baseline']
def preserve():
 for name,h in baseline['preserved_user_files'].items():assert digest(ROOT/name)==h
 assert digest(ROOT/'dev/copypaste-desktop/.gitattributes')==baseline['desktop_attributes_sha256']
preserve();out=P/('publication-record-'+str(uuid.uuid4()));out.mkdir()
index=Path(git('rev-parse','--path-format=absolute','--git-path','index'));(out/'preexisting-index.raw').write_bytes(index.read_bytes())
publication={'stage':192,'status':'published_and_verified','at':datetime.now(timezone.utc).isoformat(),'source_components':source['components'],'qualified_docs_commit':source['components']['docs']['commit'],'source_publication_receipt_sha256':digest(source_path),'component_refs':{k:v for k,v in before.items() if k.startswith('refs/heads/')},'old_remote_tags_unchanged':True,'frozen_release_manifests_preserved':True,'desktop_binaries_changed':False,'desktop_version':'0.7.4','existing_desktop_release':'https://github.com/copypasteltd/workmate/releases/tag/desktop-v0.7.4','selected_items':[2,3,4,5,7],'excluded_items':[12],'full_product_accepted':False,'final_regressions_passed':306,'native_linux_checks_passed':8,'original_failed_desktop_wrapper_retained':True,'original_post_deployment_result_independently_verified_without_paid_replay':True,'local_virtualization_used':False}
target=ROOT/'docs/quality/192-publication.json';assert not target.exists();save(target,publication)
for name in ['README.md','README.en.md']:
 p=ROOT/'docs'/name;raw=p.read_text(encoding='utf8');marker='<!-- native-recheck-192 -->';assert raw.startswith(marker)
 zh=name=='README.md';text=('本轮代码、双语说明及实际媒体已推送到 backend/web/admin/desktop/extension/delivery，docs/main同步；旧tag和Desktop0.7.4安装包保留。' if zh else 'Code, bilingual guides and actual media are pushed to backend/web/admin/desktop/extension/delivery, with docs/main synchronized. Old tags and Desktop0.7.4 binaries are retained.')
 p.write_text(raw.replace(marker,marker+'\n\n'+text+'\n\n[推送回执 / Publication receipt](quality/192-publication.json)',1),encoding='utf8',newline='\n')
names=['docs/quality/192-publication.json','docs/tools/record-native-recheck-publication-192.py','docs/README.md','docs/README.en.md']
private=load(D/'.data/deployment-179/qa-login-context.json');secrets=[str(v).encode() for k,v in private.items() if k.endswith(('_password','_secret'))];secrets.append(load(D/'.data/deployment-189/server-access.private.json')['password'].encode())
for name in names:assert not any(s in (ROOT/name).read_bytes() for s in secrets)
git('add','--',*names);assert set(git('diff','--cached','--name-only','-z').split('\0'))-{''}==set(names)
for name in names:
 raw=(ROOT/name).read_bytes();oid=sha1(('blob '+str(len(raw))+'\0').encode()+raw).hexdigest();assert git('ls-files','-s','--',name).split()[1]==oid and git('cat-file','blob',':'+name,raw=True)==raw
assert refs()==before;preserve();git('commit','-m','Record verified recheck publication and retained release boundaries (stage192)');head=git('rev-parse','HEAD')
git('push','--atomic','origin',head+':refs/heads/docs',head+':refs/heads/main');after=refs();assert after==before|{'refs/heads/docs':head,'refs/heads/main':head};preserve();assert not git('status','--porcelain','--untracked-files=no')
save(out/'receipt.json',{'stage':192,'status':'published_and_verified','final_docs_commit':head,'verified_refs':after,'publication_sha256':digest(target),'all_old_tags_unchanged':True,'unrelated_user_files_preserved':True})
print(json.dumps({'status':'published_and_verified','final_docs_commit':head,'all_old_tags_unchanged':True,'receipt':str(out/'receipt.json')}))
