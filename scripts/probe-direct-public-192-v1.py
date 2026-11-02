"""Read actual public HTTPS without a QA proxy, remapping or retries."""
from pathlib import Path
from datetime import datetime,timezone
import concurrent.futures,hashlib,json,time,urllib.request,uuid

root=Path(__file__).resolve().parents[1];out=root/'.data/acceptance-192'/('direct-public-'+str(uuid.uuid4()));out.mkdir()
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def probe(item):
 name,url=item;start=time.monotonic()
 try:
  with opener.open(url,timeout=15) as response:
   raw=response.read(2*1024*1024);row={'name':name,'url':url,'status':response.status,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
   if name=='api':
    data=json.loads(raw);row['health']={k:data.get(k) for k in ['ok','kernel','data_mode','ai_ready','email_delivery']}
 except Exception as error:row={'name':name,'url':url,'status':'unavailable','error':type(error).__name__+': '+str(error)}
 row['elapsed_ms']=round((time.monotonic()-start)*1000);return row
items=[('web','https://agent.copypaste.hk/'),('admin','https://agent-dashboard.copypaste.hk/'),('api','https://ai-api.copypaste.hk/health/ready')]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:checks=list(pool.map(probe,items))
report={'stage':192,'at':datetime.now(timezone.utc).isoformat(),'scope':'One read-only GET per canonical public domain, direct local Internet path, normal certificate validation, no fallback or proxy','checks':checks,'all_direct_reads_ok':all(c['status']==200 for c in checks)}
(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8',newline='\n');print(json.dumps({**report,'receipt':str(out/'receipt.json')}))
