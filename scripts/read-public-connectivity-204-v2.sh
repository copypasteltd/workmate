#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import concurrent.futures,json,os,socket,subprocess,time
hosts=['agent.copypaste.hk','agent-dashboard.copypaste.hk','ai-api.copypaste.hk']
jobs=[(h,a) for h in hosts for a in sorted({r[4][0] for r in socket.getaddrinfo(h,443,socket.AF_INET,socket.SOCK_STREAM)})]
def probe(item):
 h,a=item;started=time.monotonic()
 r=subprocess.run(['curl','-4','--http1.1','--silent','--show-error','--max-time','10','--resolve',h+':443:'+a,'--output','/dev/null','--write-out','%{http_code} %{remote_ip} %{time_connect} %{time_appconnect}','https://'+h+'/health/ready'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 return {'host':h,'request_only_resolved_address':a,'curl_exit':r.returncode,'connection_metadata':r.stdout.decode('ascii',errors='replace'),'seconds':round(time.monotonic()-started,2)}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:rows=list(pool.map(probe,jobs))
print(json.dumps({'stage':204,'scope':'Read-only per-address verified original TLS GETs. Resolver selection is confined to these curl requests; no DNS, environment or server configuration write.','proxy_environment_present':{k:bool(os.environ.get(k)) for k in ['https_proxy','HTTPS_PROXY','http_proxy','HTTP_PROXY','all_proxy','ALL_PROXY']},'items':rows}))
PY
