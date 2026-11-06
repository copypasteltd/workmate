#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import concurrent.futures,hashlib,json,socket,subprocess,time
hosts=['agent.copypaste.hk','agent-dashboard.copypaste.hk','ai-api.copypaste.hk']
def probe(host):
 started=time.monotonic()
 addresses=sorted({r[4][0] for r in socket.getaddrinfo(host,443,socket.AF_INET,socket.SOCK_STREAM)})
 r=subprocess.run(['curl','-4','--http1.1','--silent','--show-error','--max-time','12','--output','-','--write-out','\n%{http_code}','https://'+host+'/health/ready'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 body,_,status=r.stdout.rpartition(b'\n')
 return {'host':host,'ipv4':addresses,'curl_exit':r.returncode,'http_status':status.decode('ascii',errors='replace'),'body_bytes':len(body),'body_sha256':hashlib.sha256(body).hexdigest(),'configured_health':b'"configured_services"' in body,'edge_group_rejection':b'error code: 1010' in body.lower(),'seconds':round(time.monotonic()-started,2),'network_configuration_changed':False}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(probe,hosts))
print(json.dumps({'stage':204,'scope':'Read-only current server DNS and bounded public TLS health GETs; no network/configuration/service change.','items':rows}))
PY
