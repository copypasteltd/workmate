"""Real deployed API over authenticated SSH; no reply replacement or browser claim."""
from pathlib import Path
import base64,hashlib,http.client,json,uuid
import paramiko
ROOT=Path(__file__).resolve().parents[1]
class CompanyAPI:
 def __init__(self):
  spec=json.loads((ROOT/'.data/deployment-189/server-access.private.json').read_text('utf-8'))
  self.t=paramiko.Transport((spec['host'],22));self.t.start_client(timeout=15)
  assert base64.b64encode(hashlib.sha256(self.t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
  self.t.auth_password(spec['username'],spec['password'])
  state=json.loads((ROOT/'.data/acceptance-189/realowner-state.private.json').read_text('utf-8'))
  cookies=[c for c in state['cookies'] if c['name']=='cp_session'];assert len(cookies)==1
  self.cookie='cp_session='+cookies[0]['value'];self.csrf=None
  identity=self.ok('GET','/v1/session/context');assert identity['user']['email']=='agent-test-20261102@workmate.local'
  self.identity=identity;self.csrf=identity['csrf_token']
 def call(self,method,path,body=None,key=None):
  assert path.startswith('/v1/') and '\r' not in path and '\n' not in path and method in ['GET','POST','PUT']
  payload=b'' if body is None else json.dumps(body,ensure_ascii=False).encode()
  headers={'Host':'ai-api.copypaste.hk','Origin':'https://agent.copypaste.hk','Cookie':self.cookie,'Connection':'close'}
  if body is not None:headers.update({'Content-Type':'application/json','Content-Length':str(len(payload)),'Idempotency-Key':key or str(uuid.uuid4())})
  if self.csrf:headers['X-CSRF-Token']=self.csrf
  if path.startswith('/v1/tenants/'):
   tenant=path.split('/')[3];uuid.UUID(tenant);headers['X-Tenant-ID']=tenant
  channel=self.t.open_channel('direct-tcpip',('127.0.0.1',63073),('127.0.0.1',0),timeout=15);channel.settimeout(90)
  try:
   channel.sendall((method+' '+path+' HTTP/1.1\r\n'+''.join(k+': '+v+'\r\n' for k,v in headers.items())+'\r\n').encode()+payload)
   response=http.client.HTTPResponse(channel);response.begin();raw=response.read();data=json.loads(raw) if response.getheader('Content-Type','').startswith('application/json') else raw
   return response.status,data,dict(response.getheaders())
  finally:channel.close()
 def ok(self,method,path,body=None,key=None):
  status,data,_=self.call(method,path,body,key);assert 200<=status<300,(path,status,data.get('error',{}).get('code') if isinstance(data,dict) else 'non-json');return data
 def close(self):self.t.close()
if __name__=='__main__':
 api=CompanyAPI()
 try:
  tenant='f5b06ebd-ec59-414c-ad1a-04224d202fc0';assert any(m['id']==tenant for m in api.identity['memberships']);projects=api.ok('GET','/v1/tenants/'+tenant+'/projects');rows=[]
  for p in projects['items']:
   base='/v1/tenants/'+tenant+'/projects/'+p['id'];sources=api.ok('GET',base+'/editable-projects/sources');current=api.ok('GET',base+'/editable-projects');rows.append({'project_id':p['id'],'sources':sources['items'],'projects':current['items']})
  out=ROOT/'.data/acceptance-199/design-sources.private.json';assert not out.exists();out.write_text(json.dumps({'tenant':tenant,'items':rows},indent=2)+'\n','utf-8')
  print(json.dumps({'status':'read_actual_deployed_api','transport':'authenticated SSH to unchanged internal HTTP API','browser_or_public_https_claim':False,'projects':[{'id':r['project_id'],'sources':len(r['sources']),'editable':len(r['projects'])} for r in rows]}))
 finally:api.close()
