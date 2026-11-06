"""Actual full HTTP downloads through pinned SSH, without a public-TLS claim."""
from pathlib import Path
import base64,hashlib,http.client,json,time
import paramiko
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'.data/deployment-204-v1/inner-downloads-v2.sanitized.json';assert not out.exists()
spec=json.loads((ROOT/'.data/deployment-189/server-access.private.json').read_text('utf-8'))
package=json.loads((ROOT/'.data/deployment-204-v1/package-receipt.private.json').read_text('utf-8'))
report={'stage':204,'status':'running','scope':'Actual full Nginx HTTP downloads through pinned authenticated SSH to the existing inner63070 listener. No reply replacement, public HTTPS/Cloudflare or development-machine direct-egress claim.','downloads':[]}
t=paramiko.Transport((spec['host'],22))
try:
 t.start_client(timeout=15);assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE';t.auth_password(spec['username'],spec['password']);t.set_keepalive(20)
 for expected in package['public_files']:
  c=t.open_channel('direct-tcpip',('127.0.0.1',63070),('127.0.0.1',0),timeout=15);c.settimeout(90);started=time.monotonic()
  try:
   c.sendall(('GET /downloads/releases/20401/'+expected['name']+' HTTP/1.1\r\nHost: agent.copypaste.hk\r\nConnection: close\r\n\r\n').encode())
   response=http.client.HTTPResponse(c);response.begin();assert response.status==200;h=hashlib.sha256();size=0
   while True:
    b=response.read(1024*1024)
    if not b:break
    h.update(b);size+=len(b)
   assert size==expected['bytes'] and h.hexdigest()==expected['sha256'];report['downloads'].append({**expected,'full_http_status':200,'observed_bytes':size,'observed_sha256':h.hexdigest(),'seconds':round(time.monotonic()-started,2)});print(json.dumps({'name':expected['name'],'status':'complete_verified','bytes':size}),flush=True)
  finally:c.close()
 report['status']='passed'
except Exception as e:
 report.update(status='failed',error=type(e).__name__+': '+str(e)[:240]);raise
finally:
 t.close();report['owned_transport_closed']=True;out.write_text(json.dumps(report,indent=2)+'\n','utf-8')
