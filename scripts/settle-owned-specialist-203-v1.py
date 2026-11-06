"""Settle only the original controlled QA task via existing audited Admin APIs.

No direct DB writes, unknown-cost overrides, plan changes or model replay.
"""
from pathlib import Path
import base64,hashlib,hmac,http.client,importlib.util,json,re,struct,time,uuid
from http.cookies import SimpleCookie
R=Path(__file__).resolve().parents[1];OUT=R/'.data/acceptance-203/owned-settlement-v1';OUT.mkdir(parents=True,exist_ok=False)
spec=importlib.util.spec_from_file_location('company_settlement_203',R/'scripts/live-company-api-199-v1.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
secret=json.loads((R/'.data/deployment-179/qa-login-context.json').read_text('utf-8'))
task_id='5b2367dc-c80b-4743-8d28-2c2229b0a707';tenant='f5b06ebd-ec59-414c-ad1a-04224d202fc0';project='f3374e9e-d591-4ff0-9b83-0b0dd1f1be8a'
def save(name,v):(OUT/name).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n','utf-8')
api=m.CompanyAPI();jar=SimpleCookie();csrf=None
state=json.loads((R/'.data/acceptance-189/admin-state.private.json').read_text('utf-8'))
for c in state['cookies']:
 if c['name']=='cp_admin_session':jar[c['name']]=c['value']
def call(method,path,body=None,port=63073,mail=False):
 global csrf
 payload=b'' if body is None else json.dumps(body).encode();key=str(uuid.uuid4());headers={'Host':'agent-dashboard.copypaste.hk','Origin':'https://agent-dashboard.copypaste.hk','Connection':'close','Cookie':'; '.join(k+'='+v.value for k,v in jar.items())}
 if body is not None:headers.update({'Content-Type':'application/json','Content-Length':str(len(payload)),'Idempotency-Key':key})
 if csrf:headers['X-CSRF-Token']=csrf
 if mail:headers['Authorization']='Basic '+base64.b64encode((secret['operator_username']+':'+secret['operator_password']).encode()).decode()
 if body is not None:save('request-'+key+'.private.json',{'method':method,'path':path,'body':body,'idempotency_key':key})
 ch=api.t.open_channel('direct-tcpip',('127.0.0.1',port),('127.0.0.1',0),timeout=15);ch.settimeout(90)
 try:
  ch.sendall((method+' '+path+' HTTP/1.1\r\n'+''.join(k+': '+v+'\r\n' for k,v in headers.items())+'\r\n').encode()+payload);r=http.client.HTTPResponse(ch);r.begin();raw=r.read()
  for c in r.headers.get_all('set-cookie',[]):jar.load(c)
  data=json.loads(raw) if r.getheader('Content-Type','').startswith('application/json') else None
  return r.status,data
 finally:ch.close()
def ok(*a,**kw):
 status,data=call(*a,**kw);assert 200<=status<300,(a[1],status,data.get('error',{}).get('code') if data else None);return data
report={'stage':203,'status':'running','task_id':task_id,'scope':'Original owned controlled QA task; actual known per-request cost only. Existing highest-admin preview, direct policy and immutable audit. No networking/configuration/plan changes.'}
try:
 status,identity=call('GET','/v1/admin/me')
 if status==401:
  challenge=ok('POST','/v1/admin/auth/challenge',{'email':secret['admin_email']});mail=ok('GET','/ops/mailbox/data/'+challenge['challenge_id']+'.json',port=63071,mail=True);assert mail['to']==secret['admin_email'];code=re.search(r'code is (\d{6})',mail['text']).group(1)
  key=base64.b32decode(secret['admin_totp_secret']+'='*((8-len(secret['admin_totp_secret'])%8)%8));digest=hmac.new(key,struct.pack('>Q',int(time.time()//30)),hashlib.sha1).digest();offset=digest[-1]&15;totp=str((int.from_bytes(digest[offset:offset+4],'big')&0x7fffffff)%1000000).zfill(6)
  verified=ok('POST','/v1/admin/auth/verify',{'challenge_id':challenge['challenge_id'],'code':code,'totp':totp});csrf=verified['csrf_token'];identity=ok('GET','/v1/admin/me')
 else:assert status==200
 assert identity['highest_admin'] is True;csrf=identity['csrf_token'];save('admin-state.private.json',{'cookies':[{'name':k,'value':v.value} for k,v in jar.items()]})
 original=json.loads((R/'.data/acceptance-203/settlement-diagnosis-v1.private.json').read_text('utf-8'));assert original['requests'] and all(r['state']=='completed' and r['usage_known'] and r['cost_state']=='known' and not r['capacity_held'] for r in original['requests'])
 expected=(sum(int(r['effective_numerator']) for r in original['requests'])+999999)//1000000
 current=ok('GET','/v1/admin/ai/tasks/'+task_id+'/settlement');assert current['task']['status']=='reconciling';assert not current['violations'];save('before.private.json',current)
 command={'action':'ai.tasks.settle','task_id':task_id,'expected_task_version':current['task']['version'],'acknowledge_violation_ids':[],'reason':'203 owned controlled UI prototype: native turn interrupted after lease expiry; all original company request costs are completed and known. Settle actual receipts without rerunning the task.'}
 preview=ok('POST','/v1/admin/ai/previews',command);save('preview.private.json',preview);assert preview['decision']=='super_admin_direct' and preview['before']['receipt']['knownChargeMicros']==expected and not preview['before']['receipt']['uncertain']
 operation=ok('POST','/v1/admin/ai/operations',{'command':command,'preview_id':preview['preview_id']});save('operation.private.json',operation)
 task=api.ok('GET',f'/v1/tenants/{tenant}/projects/{project}/tasks/'+task_id);save('task.private.json',task);assert task['status']=='failed' and task['error_code']=='PROVIDER_COST_RECONCILED' and int(task['charged_micros'])==expected
 after=ok('GET','/v1/admin/ai/tasks/'+task_id+'/settlement');assert after['reservation']['status']=='settled';save('after.private.json',after)
 report.update(status='settled_actual_receipts',actual_micros=str(expected),prior_reservation_micros=current['reservation']['amount_micros'],operation_id=operation['id'],business_status=task['status'],error_code=task['error_code'],model_replayed=False,professional_acceptance=False)
except Exception as e:report.update(status='failed_or_unknown_do_not_repeat',error=type(e).__name__+': '+str(e)[:350]);raise
finally:api.close();save('receipt.json',report);print(json.dumps(report))
