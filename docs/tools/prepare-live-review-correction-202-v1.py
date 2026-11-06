"""Preserve first network attempts and improve separate QA transport diagnostics only."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts'
s=(scripts/'qualify-live-marketing-review-202-v1.mjs').read_text('utf8').replace("import {launch,ok} from './live-client-189-v2.mjs';","import {launch} from './live-client-189-v2.mjs';")
s=s.replace('202-v1-marketing-review-live.png','202-v2-marketing-review-live.png').replace("'marketing-review-live','202-v1'","'marketing-review-live','202-v2'")
pos="const pass=async name=>"
helper="""async function ok(page,url,body,headers={},method){
 const verb=method??(body===undefined?'GET':'POST');
 for(let attempt=0;;attempt++){
  const r=await page.evaluate(async({url,body,headers,verb})=>{try{const r=await fetch(url,{method:verb,credentials:'include',headers:{...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)}),text=await r.text();let data=null;try{data=JSON.parse(text);}catch{}return{status:r.status,type:r.headers.get('content-type'),data};}catch(e){return{status:0,type:null,data:null,network_error:e.name};}},{url,body,headers,verb});
  if(r.status>=200&&r.status<300&&r.data!==null)return r.data;
  report.http_attempts??=[];report.http_attempts.push({path:url,method:verb,attempt,status:r.status,type:r.type,network_error:r.network_error,error_code:r.data?.error?.code});
  if(verb==='GET'&&attempt===0&&(r.status===0||[502,503,504].includes(r.status)))continue;
  throw Error('Actual HTTP '+verb+' '+url+': '+r.status+' '+(r.type??r.network_error)+' '+(r.data?.error?.code??'No JSON response'));
 }
}
"""
assert pos in s;s=s.replace(pos,helper+pos)
(scripts/'qualify-live-marketing-review-202-v2.mjs').write_text(s,encoding='utf8',newline='\n')
s=(scripts/'qualify-inner-downloads-202-v1.py').read_text('utf8').replace('inner-downloads-v1.sanitized.json','inner-downloads-v2.sanitized.json').replace('c.settimeout(30)','c.settimeout(90)')
(scripts/'qualify-inner-downloads-202-v2.py').write_text(s,encoding='utf8',newline='\n')
report={'stage':202,'product_source_changes':False,'status':'qa_correction_complete_before_replay','first_live_attempt':'No model/task/dataset write reached. An actual safe task GET unexpectedly returned HTML; original status was not retained by the older helper, so no precise cause is inferred. Separate read-only exact-path replay returns200 JSON and original charge38898. New driver records status/type on failure and retries only safe GET once on actual network/502/503/504, never auth callbacks or writes.','first_inner_attempt':'Setup completed its full200 bytes and SHA; the subsequent transport hit its30-second idle timeout. Retain original failed receipt, retry separately with90-second bounded reads after public transfer completes.','response_replacement':False,'network_settings_modified':False}
(root/'docs/quality/integrated-round-202/qa-correction-v1.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
print(json.dumps({'status':report['status']}))
