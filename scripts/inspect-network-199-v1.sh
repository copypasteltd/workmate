#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_NET_199'
import json,urllib.request,urllib.parse,socket
proxies={k:{'scheme':urllib.parse.urlparse(v).scheme,'host':urllib.parse.urlparse(v).hostname,'port':urllib.parse.urlparse(v).port} for k,v in urllib.request.getproxies().items() if k in ['http','https','all']}
addresses=sorted({v[4][0] for v in socket.getaddrinfo('agent.copypaste.hk',443,socket.AF_INET,socket.SOCK_STREAM)})
result={'proxies':proxies,'ipv4':addresses,'connect':[]}
for address in addresses:
 s=socket.socket();s.settimeout(3)
 try:s.connect((address,443));result['connect'].append({'ip':address,'status':'connected'})
 except Exception as e:result['connect'].append({'ip':address,'error':type(e).__name__})
 finally:s.close()
print(json.dumps(result))
WM_NET_199
