#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,ipaddress,json,socket,subprocess,time
cfg=Path('/root/cfg/workmate/integrated-204');out=cfg/'public-download-host-v1';out.mkdir(mode=0o700)
expected=json.loads((cfg/'downloads-v1/receipt.json').read_text());assert expected['status']=='published' and len(expected['files'])==4
host='agent.copypaste.hk';addresses=sorted({r[4][0] for r in socket.getaddrinfo(host,443,socket.AF_INET,socket.SOCK_STREAM)},reverse=True)
assert addresses and all(ipaddress.ip_address(a).is_global for a in addresses);address=addresses[0]
report={'stage':204,'status':'running','at':datetime.now(timezone.utc).isoformat(),'scope':'Actual complete public HTTPS200 downloads initiated on the application host with original company URL, normal certificate validation and an explicitly selected current public-DNS address for this curl process only. No private-origin fallback, reply substitution, developer-browser/direct-egress, installation or normal-DNS-failover claim. No server network, resolver, proxy, firewall, routing, environment or service change.','request_only_public_address':address,'downloads':[]}
def save():(out/'receipt.sanitized.json').write_text(json.dumps(report,indent=2)+'\n')
save()
try:
 for item in sorted(expected['files'].values(),key=lambda x:x['bytes']):
  url='https://'+host+'/downloads/releases/20401/'+item['name'];target=out/item['name'];started=time.monotonic()
  r=subprocess.run(['curl','-4','--http1.1','--silent','--show-error','--fail','--connect-timeout','15','--max-time','150','--resolve',host+':443:'+address,'--output',str(target),'--write-out','%{http_code} %{remote_ip} %{url_effective}',url],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  (out/(item['name']+'.stderr')).write_bytes(r.stderr)
  metadata=r.stdout.decode('ascii',errors='replace').split();size=target.stat().st_size if target.exists() else 0
  if target.exists():target.chmod(0o600)
  digest=hashlib.file_digest(target.open('rb'),'sha256').hexdigest() if target.exists() else None
  row={**item,'url':url,'expected_bytes':item['bytes'],'expected_sha256':item['sha256'],'bytes':size,'sha256':digest,'http_status':metadata[0] if metadata else None,'remote_ip':metadata[1] if len(metadata)>1 else None,'effective_url':metadata[2] if len(metadata)>2 else None,'curl_exit':r.returncode,'seconds':round(time.monotonic()-started,2)}
  row['status']='complete_verified' if r.returncode==0 and row['http_status']=='200' and row['remote_ip']==address and row['effective_url']==url and size==item['bytes'] and digest==item['sha256'] else 'incomplete'
  report['downloads'].append(row);save();print(json.dumps(row),flush=True)
 report['status']='passed' if len(report['downloads'])==4 and all(r['status']=='complete_verified' for r in report['downloads']) else 'partial'
finally:report['finished_at']=datetime.now(timezone.utc).isoformat();save()
print(json.dumps({'status':report['status'],'receipt':str(out/'receipt.sanitized.json'),'network_configuration_changed':False}),flush=True)
assert report['status']=='passed','Public file observation is partial; preserve exact receipts and do not change networking'
PY
