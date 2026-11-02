"""Owned loopback TCP forward to the real company API via the pinned SSH host.

This isolates public route issue01. It is not a mock, HTTP rewriter or public
HTTPS qualification. No API request is retried, inspected, generated or logged.
"""
from pathlib import Path
import base64,hashlib,json,paramiko,select,socketserver,threading,sys

root=Path(__file__).resolve().parents[1]
spec=json.loads((root/'.data/deployment-189/server-access.private.json').read_bytes())
transport=paramiko.Transport((spec['host'],22))
transport.start_client(timeout=15)
assert base64.b64encode(hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
transport.auth_password(spec['username'],spec['password']);del spec
transport.set_keepalive(25)
class Handler(socketserver.BaseRequestHandler):
 def handle(self):
  channel=None
  try:
   channel=transport.open_channel('direct-tcpip',('127.0.0.1',63072),self.client_address,timeout=10)
   while True:
    ready,_,_=select.select([self.request,channel],[],[],120)
    if not ready:return
    for src in ready:
     data=src.recv(65536)
     if not data:return
     (channel if src is self.request else self.request).sendall(data)
  except (OSError,EOFError,paramiko.SSHException):pass
  finally:
   if channel:channel.close()
class Server(socketserver.ThreadingTCPServer):
 allow_reuse_address=True
 daemon_threads=True
server=Server(('127.0.0.1',11238),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
print(json.dumps({'status':'ready','origin':'http://127.0.0.1:11238','destination':'actual company API63072','transport':'pinned SSH','public_https_qualification':False}),flush=True)
try:
 for line in sys.stdin:
  if json.loads(line).get('action')=='close':break
finally:
 server.shutdown();server.server_close();transport.close()
 print(json.dumps({'status':'closed'}),flush=True)
