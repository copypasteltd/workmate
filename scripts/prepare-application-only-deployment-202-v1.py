from pathlib import Path
L=Path(__file__).resolve().parents[1]
p=L/'scripts/activate-integrated-202-v1.sh';s=p.read_text('utf8')
s=s.replace('import hashlib,json,subprocess,zipfile','import hashlib,json,subprocess,zipfile')
s=s.replace('import hashlib,json,subprocess','import hashlib,json,subprocess,shutil',1)
s=s.replace('changed_proxy=False;started=time.monotonic()','static_swaps=[];started=time.monotonic()')
a=s.index(' text=proxy_before.decode()');b=s.index(' for port,component in [(63070',a)
s=s[:a]+''' # Preserve the existing Nginx root paths and every network byte. Switch
 # only owned application directories; keep the prior static tree for rollback.
 for component in ['web','admin']:
  live=previous.parent/component/'dist';saved=live.with_name('dist.before-integrated-202-v1');link=live.with_name('.dist-integrated-202-v1')
  assert live.is_dir() and not live.is_symlink() and not saved.exists() and not link.exists()
  target=root/component/'dist'
  # Preserve already-open pages' old hashed assets without changing new files.
  for sub in ['assets','fonts']:
   if (live/sub).is_dir():
    for old in (live/sub).rglob('*'):
     if old.is_file():
      new=target/old.relative_to(live)
      if not new.exists():new.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(old,new);new.chmod(0o644)
  link.symlink_to(target,target_is_directory=True);static_swaps.append((live,saved,link));live.rename(saved);link.rename(live)
 assert proxy.read_bytes()==proxy_before
'''+s[b:]
a=s.index(' if changed_proxy:');b=s.index(' if drop.exists():',a)
s=s[:a]+''' for live,saved,link in reversed(static_swaps):
  if live.is_symlink():live.unlink()
  if saved.exists() and not live.exists():saved.rename(live)
  if link.is_symlink():link.unlink()
 assert proxy.read_bytes()==proxy_before
'''+s[b:]
s=s.replace("'credentials_unchanged':True,","'credentials_unchanged':True,'proxy_configuration_unchanged':proxy.read_bytes()==proxy_before,'static_serving_paths_preserved':True,'static_rollback_suffix':'dist.before-integrated-202-v1',")
assert 'proxy.write' not in s and "'reload','workmate-lan-proxy.service'" not in s
(L/'scripts/activate-integrated-202-v2.sh').write_text(s,encoding='utf8',newline='\n')
p=L/'scripts/activate-downloads-202-v1.sh';s=p.read_text('utf8');a=s.index("config=Path('/opt/workmate/nginx/nginx.conf')")
s=s[:a]+'''# Existing generic /downloads/ alias already serves this new immutable folder.
# Do not add/reload a location, alter cache policy or change any network setting.
config=Path('/opt/workmate/nginx/nginx.conf');before=config.read_bytes()
assert 'location /downloads/ { alias /opt/workmate/downloads/;' in before.decode()
baseline=json.loads(Path('/root/cfg/workmate/integrated-202/network-baseline-v1.json').read_text());assert digest(config)==baseline['files'][str(config)]
state=Path('/root/cfg/workmate/integrated-202/downloads-v1');state.parent.mkdir(mode=0o700,exist_ok=True);state.mkdir(mode=0o700)
checks=[]
for name,row in manifest['files'].items():
 url='http://127.0.0.1:63070/downloads/releases/20201/'+name
 with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=5) as response:
  assert response.status==200 and int(response.headers['Content-Length'])==row['bytes']
  observed={'status':response.status,'bytes':int(response.headers['Content-Length']),'content_type':response.headers.get('Content-Type'),'disposition':response.headers.get('Content-Disposition')}
 with urllib.request.urlopen(urllib.request.Request(url,headers={'Range':'bytes=0-15'}),timeout=5) as response:
  assert response.status==206
  with (dest/name).open('rb') as f:assert response.read()==f.read(16)
 checks.append({'name':name,'head':observed,'range':206,'source_sha256':row['sha256']})
assert config.read_bytes()==before
report={'stage':202,'status':'published','files':manifest['files'],'checks':checks,'old_releases_preserved':True,'proxy_before_sha256':hashlib.sha256(before).hexdigest(),'proxy_after_sha256':digest(config),'network_configuration_unchanged':True,'delivery':'Existing generic download alias; no new location, proxy reload or network-policy change.'}
(state/'receipt.json').write_text(json.dumps(report,indent=2)+'\\n');print(json.dumps(report))
WM_DOWNLOADS_200
'''
assert 'config.write' not in s and "'reload'" not in s
(L/'scripts/activate-downloads-202-v2.sh').write_text(s,encoding='utf8',newline='\n')
print('Prepared application-only activation and existing-alias downloads. No remote operation executed.')
