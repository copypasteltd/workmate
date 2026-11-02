#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import concurrent.futures,socket,ssl,json
def probe(pair):
 host,ip=pair
 try:
  with socket.create_connection((ip,443),timeout=5) as c:
   with ssl.create_default_context().wrap_socket(c,server_hostname=host) as s:
    s.settimeout(5);s.sendall(('HEAD / HTTP/1.1\r\nHost: '+host+'\r\nConnection: close\r\n\r\n').encode());head=s.recv(4096).decode('latin1').split('\r\n')[0]
  return {'host':host,'ip':ip,'status':head,'certificate_verified':True}
 except Exception as e:return {'host':host,'ip':ip,'error_type':type(e).__name__}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:print(json.dumps(list(pool.map(probe,[(h,ip) for h in ['agent.copypaste.hk','agent-dashboard.copypaste.hk','ai-api.copypaste.hk'] for ip in ['104.21.43.151','172.67.180.165']]))))
PY
