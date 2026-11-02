"""Upload one owned draft asset through the pinned host; credentials stay in memory."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import base64,importlib.util,json,paramiko,sys,time,urllib.request,uuid

ROOT=Path(__file__).resolve().parents[2];D=ROOT/'dev/copypaste-delivery'
helper_spec=importlib.util.spec_from_file_location('release_helper',D/'scripts/publish-github-release-165-v1.py')
helper=importlib.util.module_from_spec(helper_spec);helper_spec.loader.exec_module(helper)
token,credential_source=helper.credential(None)
manifest=json.loads((ROOT/'docs/quality/191-desktop-artifacts.json').read_bytes());name=sys.argv[1]
artifact=next(a for a in manifest['artifacts'] if a['name']==name)
source=ROOT/'dev/copypaste-desktop/.data/deployment-191-v5/release'/name
assert source.stat().st_size==artifact['bytes'] and helper.digest(source)==artifact['sha256']
headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'workmate-desktop191'}
api='https://api.github.com/repos/copypasteltd/workmate'
def request(url):
 assert url.startswith(api+'/')
 with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=90) as r:return json.load(r)
releases=request(api+'/releases?per_page=100');release=next(r for r in releases if r['tag_name']=='desktop-v0.7.4')
assert release['draft'] and '<!-- desktop191:'+manifest['app_asar_sha256']+' -->' in release['body']
assets=request(api+'/releases/'+str(release['id'])+'/assets?per_page=100')
assert not any(a['name']==name for a in assets),'Asset already exists; inspect/reconcile instead of replaying'
spec=json.loads((D/'.data/deployment-189/server-access.private.json').read_bytes())
out=D/'.data/acceptance-191'/('remote-asset-publication-'+str(uuid.uuid4()));out.mkdir()
transport=paramiko.Transport((spec['host'],22));remote_dir='/tmp/workmate-desktop-191-'+str(uuid.uuid4())
report={'stage':191,'status':'started','asset':name,'credential_source':credential_source,'credential_written_to_disk':False,'credential_transmitted_only_in_encrypted_pinned_ssh_stdin':True}
remote_code=r'''
import hashlib,http.client,json,os,sys,time,urllib.parse
p=json.loads(sys.stdin.buffer.readline());filename=p['filename'];name=p['name']
assert filename.startswith('/tmp/workmate-desktop-191-') and filename.endswith('/'+name)
assert name in ['CopyPaste-0.7.4-x64-Setup.exe','CopyPaste-0.7.4-x64-Portable.exe']
h=hashlib.sha256()
with open(filename,'rb') as f:
 for b in iter(lambda:f.read(1048576),b''):h.update(b)
assert os.path.getsize(filename)==p['bytes'] and h.hexdigest()==p['sha256']
c=http.client.HTTPSConnection('uploads.github.com',timeout=120)
url='/repos/copypasteltd/workmate/releases/'+str(int(p['release_id']))+'/assets?'+urllib.parse.urlencode({'name':name})
c.putrequest('POST',url)
for k,v in {'Authorization':'Bearer '+p['token'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'workmate-desktop191','Content-Type':'application/octet-stream','Content-Length':str(p['bytes'])}.items():c.putheader(k,v)
c.endheaders();p['token']=None;sent=0;last=time.monotonic()
with open(filename,'rb') as f:
 for b in iter(lambda:f.read(1048576),b''):
  c.send(b);sent+=len(b)
  if time.monotonic()-last>10:print(json.dumps({'phase':'remote_upload','asset':name,'sent_bytes':sent,'total_bytes':p['bytes']}),flush=True);last=time.monotonic()
r=c.getresponse();data=r.read();status=r.status;c.close()
if status!=201:raise RuntimeError('GitHub asset upload status '+str(status))
a=json.loads(data)
assert a['name']==name and a['size']==p['bytes'] and a['state']=='uploaded' and a['digest']=='sha256:'+p['sha256']
print(json.dumps({'phase':'asset_verified','asset':{k:a[k] for k in ['id','name','size','digest','browser_download_url']}}),flush=True)
os.unlink(filename);os.rmdir(os.path.dirname(filename))
'''
try:
 transport.start_client(timeout=15)
 fingerprint=base64.b64encode(sha256(transport.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')
 assert fingerprint=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
 transport.auth_password(spec['username'],spec['password'])
 sftp=paramiko.SFTPClient.from_transport(transport);sftp.mkdir(remote_dir,mode=0o700)
 last=[time.monotonic()]
 def progress(sent,total):
  if time.monotonic()-last[0]>10:print(json.dumps({'phase':'pinned_lan_transfer','asset':name,'sent_bytes':sent,'total_bytes':total}),flush=True);last[0]=time.monotonic()
 sftp.put(str(source),remote_dir+'/'+name,callback=progress);sftp.close()
 channel=transport.open_session(timeout=15)
 code=base64.b64encode(remote_code.encode()).decode()
 channel.exec_command('python3 -u -c "import base64;exec(base64.b64decode(\''+code+'\'))"')
 payload={'token':token,'filename':remote_dir+'/'+name,'name':name,'bytes':artifact['bytes'],'sha256':artifact['sha256'],'release_id':release['id']}
 channel.sendall(json.dumps(payload).encode()+b'\n');channel.shutdown_write();payload['token']=None
 for line in channel.makefile('r'):
  value=json.loads(line);print(json.dumps(value),flush=True)
  if value['phase']=='asset_verified':report['published_asset']=value['asset']
 error=channel.makefile_stderr('r').read();assert channel.recv_exit_status()==0,'Remote upload failed; request metadata must be reconciled before retry'
 current=request(api+'/releases/'+str(release['id'])+'/assets?per_page=100')
 asset=next(a for a in current if a['name']==name)
 assert asset['digest']=='sha256:'+artifact['sha256'] and asset['state']=='uploaded'
 report.update(status='published_and_verified',release_id=release['id'],all_asset_digests_match=True,remote_owned_staging_removed=True)
except Exception as e:report.update(status='failed',error=(type(e).__name__+': '+str(e)).replace(token,'[redacted]'))
finally:
 transport.close();report['finished_at']=datetime.now(timezone.utc).isoformat()
 (out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8',newline='\n')
 print(json.dumps({'status':report['status'],'asset':name,'receipt':str(out/'receipt.json'),'error':report.get('error')}),flush=True)
assert report['status']=='published_and_verified'
