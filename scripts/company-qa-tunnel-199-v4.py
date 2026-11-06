"""Owned QA transport only: authenticated SSH, exact company TLS destinations.

CONNECT and optional SNI routing forward original TLS bytes. They never terminate
TLS, replace application replies, relax certificates, or modify either service.
"""
from pathlib import Path
import base64,hashlib,json,os,select,socket,socketserver,threading,time
import paramiko
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.data/acceptance-199/transport-v4';OUT.mkdir(parents=True,exist_ok=False)
spec=json.loads((ROOT/'.data/deployment-189/server-access.private.json').read_text('utf-8'))
allowed={'agent.copypaste.hk','agent-dashboard.copypaste.hk','ai-api.copypaste.hk'}
t=paramiko.Transport((spec['host'],22));t.start_client(timeout=15)
assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
t.auth_password(spec['username'],spec['password']);t.set_keepalive(20)
# Resolve only IPv4 on the actual host. TLS still authenticates each original URL.
c=t.open_session(timeout=10)
c.exec_command("python3 -c \"import socket,json;print(json.dumps({h:sorted({r[4][0] for r in socket.getaddrinfo(h,443,socket.AF_INET,socket.SOCK_STREAM)}) for h in ['agent.copypaste.hk','agent-dashboard.copypaste.hk','ai-api.copypaste.hk']}))\"")
addresses=json.loads(c.makefile('r').read());assert c.recv_exit_status()==0;c.close()
for h,ips in addresses.items():assert h in allowed and ips

def relay(client,host,first=b''):
 if host not in allowed:raise ValueError('Destination denied')
 channel=None
 for address in addresses[host]:
  try:channel=t.open_channel('direct-tcpip',(address,443),client.getpeername(),timeout=6);break
  except Exception:pass
 if channel is None:raise TimeoutError('Company transport unreachable')
 try:
  if first:channel.sendall(first)
  # Windows select supports sockets, not Paramiko's pipe-backed Channel.fileno.
  while t.is_active() and not (OUT/'stop').exists():
   readable,_,_=select.select([client],[],[],.005)
   if readable:
    data=client.recv(65536)
    if not data:return
    channel.sendall(data)
   if channel.recv_ready():
    data=channel.recv(65536)
    if not data:return
    client.sendall(data)
   elif channel.closed or channel.eof_received:return
 finally:channel.close()
class Connect(socketserver.BaseRequestHandler):
 def handle(self):
  try:
   self.request.settimeout(20);data=b''
   while b'\r\n\r\n' not in data:
    part=self.request.recv(4096)
    if not part:return
    data+=part
    if len(data)>8192:raise ValueError('Header too large')
   header,extra=data.split(b'\r\n\r\n',1);line=header.split(b'\r\n',1)[0].decode('ascii').split()
   if len(line)!=3 or line[0]!='CONNECT' or not line[1].endswith(':443') or line[1][:-4] not in allowed:raise ValueError('Destination denied')
   self.request.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n');relay(self.request,line[1][:-4],extra)
  except Exception as e:print(json.dumps({'transport_error':type(e).__name__,'errno':getattr(e,'errno',None),'message':str(e)[:140]}),flush=True)
def sni(data):
 # TLS ClientHello, parsed only far enough to select an exact allowed host.
 if len(data)<5 or data[0]!=22 or len(data)<5+int.from_bytes(data[3:5],'big'):return None
 p=5
 if data[p]!=1:raise ValueError('ClientHello required')
 p+=4+2+32;p+=1+data[p];n=int.from_bytes(data[p:p+2],'big');p+=2+n;p+=1+data[p];end=p+2+int.from_bytes(data[p:p+2],'big');p+=2
 while p+4<=end:
  typ=int.from_bytes(data[p:p+2],'big');size=int.from_bytes(data[p+2:p+4],'big');p+=4
  if typ==0:
   q=p+2
   while q+3<=p+size:
    kind=data[q];length=int.from_bytes(data[q+1:q+3],'big');q+=3
    if kind==0:return data[q:q+length].decode('ascii').lower()
    q+=length
  p+=size
 raise ValueError('SNI required')
class TLS(socketserver.BaseRequestHandler):
 def handle(self):
  try:
   self.request.settimeout(20);data=b'';host=None
   while host is None and len(data)<65536:
    part=self.request.recv(4096)
    if not part:return
    data+=part;host=sni(data)
   relay(self.request,host,data)
  except Exception:pass
class Server(socketserver.ThreadingTCPServer):
 allow_reuse_address=False;daemon_threads=True
servers=[]
try:
 connect=Server(('127.0.0.1',0),Connect);servers.append(connect)
 # Used only by an isolated packaged Electron process via resolver rules.
 # Fail closed when443 is already owned; never replace an existing listener.
 try:tls=Server(('127.0.0.1',443),TLS);servers.append(tls)
 except OSError:tls=None
 receipt={'stage':199,'status':'running','owner_pid':os.getpid(),'proxy':'http://127.0.0.1:'+str(connect.server_address[1]),'tls_sni_port':443 if tls else None,'hosts':sorted(allowed),'tls_termination':False,'response_replacement':False,'server_services_changed':False}
 (OUT/'receipt.private.json').write_text(json.dumps(receipt,indent=2)+'\n','utf-8');print(json.dumps(receipt),flush=True)
 for server in servers:threading.Thread(target=server.serve_forever,daemon=True).start()
 while t.is_active() and not (OUT/'stop').exists():time.sleep(.5)
finally:
 for server in servers:server.shutdown();server.server_close()
 t.close();(OUT/'closed.json').write_text(json.dumps({'stage':199,'status':'closed','owner_pid':os.getpid(),'listeners_closed':True})+'\n','utf-8')
