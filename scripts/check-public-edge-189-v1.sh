#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_EDGE_189'
import concurrent.futures
import socket
import ssl
import json
import uuid
from pathlib import Path
from datetime import datetime,timezone

def public(pair):
    host, ip = pair
    result = {'host':host,'address':ip}
    started = datetime.now(timezone.utc)
    try:
        with socket.create_connection((ip,443),timeout=6) as raw:
            with ssl.create_default_context().wrap_socket(raw,server_hostname=host) as connection:
                result['certificate_verified']=True
                connection.settimeout(8)
                connection.sendall(('GET /health/ready HTTP/1.1\r\nHost: '+host+'\r\nConnection: close\r\n\r\n').encode())
                header = b''
                while b'\r\n\r\n' not in header and len(header)<16384:
                    chunk=connection.recv(4096)
                    if not chunk:break
                    header+=chunk
                result['status']=header.split(b'\r\n')[0].decode('ascii',errors='replace')
    except Exception as error:
        result['error_class']=type(error).__name__
    result['elapsed_ms']=int((datetime.now(timezone.utc)-started).total_seconds()*1000)
    return result

def origin(port):
    import urllib.request
    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=5) as response:
        body=json.load(response)
        return {'port':port,'status':response.status,'kernel':body.get('kernel'),'data_mode':body.get('data_mode')}

hosts=['agent.copypaste.hk','agent-dashboard.copypaste.hk','ai-api.copypaste.hk']
addresses=sorted({row[4][0] for host in hosts for row in socket.getaddrinfo(host,443,socket.AF_INET,socket.SOCK_STREAM)})
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as workers:
    probes=list(workers.map(public,[(host,ip) for host in hosts for ip in addresses]*2))
report={'stage':189,'at':datetime.now(timezone.utc).isoformat(),'scope':'Read-only origin and real canonical HTTPS GET checks; no DNS, tunnel or TLS changes','addresses':addresses,'public':probes,'origin':[origin(port) for port in [63070,63071,63072]]}
file=Path('/root/cfg/workmate/public-edge-189-'+str(uuid.uuid4())+'.sanitized.json')
with file.open('x') as stream:json.dump(report,stream,indent=2)
file.chmod(0o600)
print(json.dumps({**report,'receipt':str(file)}))
WM_EDGE_189
