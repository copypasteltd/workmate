"""Record verified source/artifact publication and push the documentation follow-up."""
from pathlib import Path
from hashlib import sha256,sha1
from datetime import datetime,timezone
import importlib.util,json,os,subprocess,urllib.request,uuid

ROOT=Path(__file__).resolve().parents[2];D=ROOT/'dev/copypaste-delivery';P=D/'.data/acceptance-191'
def load(p):return json.loads(p.read_bytes())
def digest(p):return sha256(p.read_bytes()).hexdigest()
def save(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def latest(pattern):
 found=[p for p in P.glob(pattern) if load(p).get('status')=='published_and_verified']
 assert found,'Publication not complete: '+pattern
 return max(found,key=lambda p:p.stat().st_mtime)
def git(*args,raw=False):
 p=subprocess.run(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','gc.auto=0','-C',str(ROOT),*args],env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_SSH_COMMAND':'ssh -o BatchMode=yes'},capture_output=True,check=True)
 return p.stdout if raw else p.stdout.decode('utf8').strip()
out=P/('publication-record-'+str(uuid.uuid4()));out.mkdir()
source_path=latest('publication-*/receipt.json');release_path=latest('desktop-publication-*/receipt.json')
source=load(source_path);release=load(release_path);report_path=ROOT/'docs/quality/191-selected-repairs.json';report=load(report_path)
assert release['all_asset_digests_match'] and not release['old_releases_modified'] and source['all_frozen_tags_unchanged']
assert release['desktop_commit']==source['components']['desktop']['commit']
for name,h in report['sources'].items():assert digest(ROOT/name)==h,'Qualified source changed'
manifest=load(ROOT/'docs/quality/191-desktop-artifacts.json')
for artifact in manifest['artifacts']:
 asset=next(a for a in release['assets'] if a['name']==artifact['name'])
 assert asset['size']==artifact['bytes'] and asset['digest']=='sha256:'+artifact['sha256']
# Draft uploads carry provisional untagged URLs. Read metadata again after
# publication so the public handoff records final, usable release URLs.
helper_spec=importlib.util.spec_from_file_location('release_readback_helper',D/'scripts/publish-github-release-165-v1.py')
helper=importlib.util.module_from_spec(helper_spec);helper_spec.loader.exec_module(helper)
token,_=helper.credential(None);opener=urllib.request.build_opener(helper.NoRedirect())
def api(path):
 assert path.startswith('/releases/')
 req=urllib.request.Request('https://api.github.com/repos/copypasteltd/workmate'+path,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'workmate-publication191-readback'})
 with opener.open(req,timeout=90) as r:return json.load(r)
current_release=api('/releases/tags/desktop-v0.7.4');assert not current_release['draft']
final_assets=api('/releases/'+str(current_release['id'])+'/assets?per_page=100')
for row in release['assets']:
 current=next(a for a in final_assets if a['name']==row['name'])
 assert current['size']==row['size'] and current['digest']==row['digest'] and current['state']=='uploaded'
 assert current['browser_download_url']=='https://github.com/copypasteltd/workmate/releases/download/desktop-v0.7.4/'+row['name']
published_assets=[{k:a[k] for k in ['id','name','size','digest','browser_download_url']} for a in final_assets]
token=None
assert not git('diff','--name-only') and not git('diff','--cached','--name-only')
expected=source['verified_refs']
def refs():
 names=list(expected)+['refs/tags/desktop-v0.7.4']
 return {s.split()[1]:s.split()[0] for s in git('ls-remote','origin',*names).splitlines()}
before=refs();assert before==expected|{'refs/tags/desktop-v0.7.4':release['desktop_commit']}
assert git('rev-parse','HEAD')==expected['refs/heads/docs']
index=Path(git('rev-parse','--path-format=absolute','--git-path','index'));(out/'preexisting-index.raw').write_bytes(index.read_bytes())
baseline=load(ROOT/'docs/quality/release-freeze-checkpoint-175.json')['baseline']
for name,h in baseline['preserved_user_files'].items():assert digest(ROOT/name)==h
assert digest(ROOT/'dev/copypaste-desktop/.gitattributes')==baseline['desktop_attributes_sha256']
publication={'stage':191,'status':'published_and_verified','at':datetime.now(timezone.utc).isoformat(),'source_components':source['components'],'qualified_source_docs_commit':source['components']['docs']['commit'],'source_publication_receipt_sha256':digest(source_path),'release_publication_receipt_sha256':digest(release_path),'release_url':release['release_url'],'desktop_commit':release['desktop_commit'],'assets':published_assets,'asset_metadata_refetched_after_publication':True,'all_asset_digests_match':True,'old_frozen_releases_and_tags_preserved':True,'selected_items':[2,3,4,5,7],'excluded_items':[12],'full_product_accepted':False,'windows_trusted_signature':False,'manual_install':True,'credentials_written_or_published':False}
public_path=ROOT/'docs/quality/191-publication.json';assert not public_path.exists();save(public_path,publication)
cleanup_source=P/'owned-client-cleanup.json';cleanup=load(cleanup_source);assert all(p['closed'] for p in cleanup['owned_qa_transport_ports'])
cleanup_path=ROOT/'docs/quality/native-repair-191/owned-client-cleanup.json';cleanup_path.write_bytes(cleanup_source.read_bytes())
report['evidence'].append({'path':cleanup_path.relative_to(ROOT).as_posix(),'sha256':digest(cleanup_path),'original_receipt_sha256':digest(cleanup_source)})
report.update(manual_desktop_publication='published_and_verified',desktop_release_url=release['release_url'],publication_record_sha256=digest(public_path))
save(report_path,report)
zh='''<!-- selected-repairs-191-publication -->

Desktop **0.7.4 已发布**：[安装版和便携版](https://github.com/copypasteltd/workmate/releases/tag/desktop-v0.7.4)。下载后按 SHA256SUMS-0.7.4 核对，手动安装/替换后重新登录。当前后台修复已上线；六端代码与双语说明已推送到对应分支，docs/main同步。12按用户要求移出；该包未签名，不使用它宣称自动更新验收或全产品全部通过。旧冻结发布保留。

[发布回执及下载校验](quality/191-publication.json) · [指定五项修复结果](development/191-native-execution-and-capacity.md)

'''
en='''<!-- selected-repairs-191-publication -->

Desktop **0.7.4 is published**: [Setup and Portable downloads](https://github.com/copypasteltd/workmate/releases/tag/desktop-v0.7.4). Verify SHA256SUMS-0.7.4, install/replace manually and sign in again. Backend fixes are live; all six component branches and bilingual guides are pushed, with docs/main synchronized. The owner excluded12; this unsigned package does not qualify automatic updates or complete-product acceptance. Old frozen releases are preserved.

[Publication receipt and download checksums](quality/191-publication.json) · [Five selected fixes](development/191-native-execution-and-capacity.md)

'''
for name,text in [('docs/README.md',zh),('docs/README.en.md',en)]:
 p=ROOT/name;old=p.read_text(encoding='utf8');assert '<!-- selected-repairs-191-publication -->' not in old;p.write_text(text+old,encoding='utf8',newline='\n')
note='\n发布完成 / Publication complete: [Desktop0.7.4](https://github.com/copypasteltd/workmate/releases/tag/desktop-v0.7.4)。安装版、便携版及SHA256SUMS已上传，GitHub返回的文件散列与本地逐项一致；六端源码和docs/main已普通推送，旧冻结发布和标签保留。详见[发布回执](../quality/191-publication.json)。\n'
for name in ['docs/development/191-native-execution-and-capacity.md','docs/changes/191-selected-repairs.md']:
 with (ROOT/name).open('a',encoding='utf8',newline='\n') as f:f.write(note)
names=['docs/README.md','docs/README.en.md','docs/quality/191-selected-repairs.json','docs/quality/191-publication.json','docs/quality/native-repair-191/owned-client-cleanup.json','docs/development/191-native-execution-and-capacity.md','docs/changes/191-selected-repairs.md','docs/tools/record-publication-191.py','docs/tools/publish-desktop-191-remote-asset.py']
private=load(D/'.data/deployment-179/qa-login-context.json');secrets=[str(v).encode() for k,v in private.items() if k.endswith(('_password','_secret'))];secrets.append(load(D/'.data/deployment-189/server-access.private.json')['password'].encode())
for name in names:assert not any(secret in (ROOT/name).read_bytes() for secret in secrets),'Private credential detected'
assert set(git('diff','--name-only','-z').split('\0'))-{''}<=set(names)
git('add','--',*names);assert set(git('diff','--cached','--name-only','-z').split('\0'))-{''}==set(names)
for name in names:
 b=(ROOT/name).read_bytes();oid=sha1(('blob '+str(len(b))+'\0').encode()+b).hexdigest();assert git('ls-files','-s','--',name).split()[1]==oid
assert refs()==before
git('commit','-m','Record verified stage191 source publication and Desktop downloads');commit=git('rev-parse','HEAD')
git('push','--atomic','origin',commit+':refs/heads/docs',commit+':refs/heads/main')
after=refs();assert after==before|{'refs/heads/docs':commit,'refs/heads/main':commit};assert not git('status','--porcelain','--untracked-files=no')
result={'stage':191,'status':'published_and_verified','documentation_commit':commit,'source_publication_receipt_sha256':digest(source_path),'desktop_release_url':release['release_url'],'old_tags_and_component_branches_preserved':True,'finished_at':datetime.now(timezone.utc).isoformat()}
save(out/'receipt.json',result);print(json.dumps(result))
