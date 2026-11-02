"""Publish a new, manually installed Desktop build; preserve every existing release."""
from pathlib import Path
from datetime import datetime,timezone
from hashlib import sha256
import importlib.util,json,os,subprocess,time,urllib.error,urllib.parse,urllib.request,uuid

delivery=Path(__file__).resolve().parents[1];root=delivery.parents[1]
desktop=delivery.parent/'copypaste-desktop';folder=desktop/'.data/deployment-191-v5/release'
helper_spec=importlib.util.spec_from_file_location('previous_release_helper',delivery/'scripts/publish-github-release-165-v1.py')
helper=importlib.util.module_from_spec(helper_spec);helper_spec.loader.exec_module(helper)
token,credential_source=helper.credential(None)
api='https://api.github.com/repos/copypasteltd/workmate';tag='desktop-v0.7.4'
out=delivery/'.data/acceptance-191'/('desktop-publication-'+str(uuid.uuid4()));out.mkdir()
report={'stage':191,'status':'started','tag':tag,'credential_source':credential_source,'credential_written_to_disk':False}
headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'workmate-desktop191'}
opener=urllib.request.build_opener(helper.NoRedirect())
def request(method,url,body=None,extra=None):
 p=urllib.parse.urlsplit(url)
 assert p.scheme=='https' and p.netloc in ['api.github.com','uploads.github.com'] and p.path.startswith('/repos/copypasteltd/workmate/')
 data=json.dumps(body,ensure_ascii=False).encode() if isinstance(body,dict) else body
 h={**headers,**(extra or {})}
 if isinstance(body,dict):h['Content-Type']='application/json'
 try:
  with opener.open(urllib.request.Request(url,data=data,method=method,headers=h),timeout=180) as r:return json.load(r)
 except urllib.error.HTTPError as e:
  raise helper.ApiError(e.code,json.loads(e.read()).get('message','Request rejected')) from None
def git(*args):
 p=subprocess.run(['git','-C',str(desktop),*args],capture_output=True,check=True,env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_SSH_COMMAND':'ssh -o BatchMode=yes'})
 return p.stdout.decode().strip()
def assets(release):return request('GET',api+'/releases/'+str(release['id'])+'/assets?per_page=100')
try:
 evidence=json.loads((root/'docs/quality/191-selected-repairs.json').read_bytes())
 assert evidence['status']=='selected_targets_verified' and evidence['excluded_items']==[12]
 build=json.loads((root/'docs/quality/191-desktop-artifacts.json').read_bytes())
 assert helper.digest(folder/'win-unpacked/resources/app.asar')==build['app_asar_sha256']
 paths=[folder/r['name'] for r in build['artifacts']]
 for p,row in zip(paths,build['artifacts']):assert p.stat().st_size==row['bytes'] and helper.digest(p)==row['sha256']
 sums=folder/'SHA256SUMS-0.7.4';expected_sums=''.join(r['sha256']+'  '+r['name']+'\n' for r in build['artifacts'])
 if sums.exists():assert sums.read_text()==expected_sums
 else:sums.write_text(expected_sums,encoding='utf8',newline='\n')
 paths.append(sums)
 commit=git('rev-parse','HEAD');assert git('ls-remote','origin','refs/heads/desktop').split()[0]==commit
 try:ref=request('GET',api+'/git/ref/tags/'+tag)
 except helper.ApiError as e:
  if e.status!=404:raise
  ref=request('POST',api+'/git/refs',{'ref':'refs/tags/'+tag,'sha':commit})
 assert ref['object']['type']=='commit' and ref['object']['sha']==commit
 marker='<!-- desktop191:'+build['app_asar_sha256']+' -->'
 releases=request('GET',api+'/releases?per_page=100');matches=[r for r in releases if r['tag_name']==tag];assert len(matches)<=1
 route=('The actual final workflow used the default canonical company HTTPS origin, preserving TLS verification and all application bytes through raw CONNECT forwarding. This single test does not establish long-term public-route stability; issue01 remains open.' if evidence['desktop_public_https_qualified'] else 'The actual workflow used a protected direct-origin qualification route. Default public HTTPS reliability remains tracked separately as issue01.')
 body='''Desktop 0.7.4 · 本机 Codex 修复 / Native Codex fixes

本版本修复本机错误回传、错误重启保留、活跃任务续期及待对账执行容量。真实公司模型已完成本机文件读取、PowerShell 执行、结果写入和实际费用结算。客户须主动选择目录并授予本机权限；全部 AI 请求仍通过公司 API。

This build fixes native error propagation/persistence and active execution renewal. A supplier-backed local Windows task completed file read/write, actual PowerShell execution and measured settlement with actual company-billed usage. LOCAL_ROUTE_191 Local permission is explicit and revocable; AI requests use the company API.

Windows x64: Setup installs the application; Portable runs without installation. This is an unsigned manual-install Desktop build. Item 12 (trusted signing/distribution/update qualification) was explicitly excluded by the owner; no automatic update or complete-product acceptance is claimed. Old releases are preserved.

下载后核对 SHA256SUMS-0.7.4。完整证据 / Evidence:
https://github.com/copypasteltd/workmate/blob/docs/docs/development/191-native-execution-and-capacity.md
'''.replace('LOCAL_ROUTE_191',route)+marker+'\n'
 if matches:
  release=matches[0];assert marker in release['body'],'Existing unrelated release preserved'
 else:release=request('POST',api+'/releases',{'tag_name':tag,'target_commitish':commit,'name':'Desktop 0.7.4 · Native Codex repair','body':body,'draft':True,'prerelease':True,'make_latest':'false'})
 verified=[]
 for p in paths:
  digest=helper.digest(p);found=next((a for a in assets(release) if a['name']==p.name),None)
  if found is None:
   assert release['draft'],'Never modify an existing published release'
   class Stream:
    def __init__(self,f):self.f=f;self.h=sha256();self.sent=0;self.last=time.monotonic()
    def read(self,n=-1):
     b=self.f.read(n if n>0 else 1024*1024);self.h.update(b);self.sent+=len(b)
     if time.monotonic()-self.last>15:
      print(json.dumps({'phase':'uploading','asset':p.name,'sent_bytes':self.sent,'total_bytes':p.stat().st_size}),flush=True);self.last=time.monotonic()
     return b
   with p.open('rb') as f:
    stream=Stream(f)
    try:found=request('POST',release['upload_url'].split('{')[0]+'?'+urllib.parse.urlencode({'name':p.name}),stream,{'Content-Type':'application/octet-stream','Content-Length':str(p.stat().st_size)})
    except Exception:
     found=next((a for a in assets(release) if a['name']==p.name and a['state']=='uploaded' and a.get('digest')=='sha256:'+digest),None)
     if found is None:raise
    else:assert stream.sent==p.stat().st_size and stream.h.hexdigest()==digest
  assert found['state']=='uploaded' and found['size']==p.stat().st_size and found.get('digest')=='sha256:'+digest
  verified.append({k:found.get(k) for k in ['id','name','size','digest','browser_download_url']})
 if release['draft']:release=request('PATCH',api+'/releases/'+str(release['id']),{'draft':False,'prerelease':True,'make_latest':'false'})
 current=request('GET',api+'/releases/tags/'+tag);assert not current['draft'] and current['id']==release['id']
 report.update(status='published_and_verified',release_url=current['html_url'],desktop_commit=commit,assets=verified,all_asset_digests_match=True,old_releases_modified=False)
except Exception as e:report.update(status='failed',error=(type(e).__name__+': '+str(e)).replace(token,'[redacted]'))
finally:
 report['finished_at']=datetime.now(timezone.utc).isoformat();(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
 print(json.dumps({'status':report['status'],'receipt':str(out/'receipt.json'),'url':report.get('release_url'),'error':report.get('error')}),flush=True)
assert report['status']=='published_and_verified'
