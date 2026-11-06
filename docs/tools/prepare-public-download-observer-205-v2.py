"""Correct the observer's collapsed-details action; retain verified whole files."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery'
p=L/'scripts/qualify-public-download-205-v2.mjs';assert not p.exists()
s=(L/'scripts/qualify-public-download-205-v1.mjs').read_text('utf-8')
s=s.replace('public-download-v1.sanitized.json','public-download-v2.sanitized.json').replace('public-browser-files-v1','public-browser-files-v2')
needle="const sleep=ms=>new Promise(r=>setTimeout(r,ms));"
assert needle in s
s=s.replace(needle,"""const priorFile=path.resolve('.data/deployment-205-v1/public-download-v1.sanitized.json');
const priorBytes=await readFile(priorFile),prior=JSON.parse(priorBytes.toString());
assert.equal(prior.stage,205);assert.equal(prior.owned_browser_closed,true);assert.notEqual(prior.status,'running');
const priorSha=createHash('sha256').update(priorBytes).digest('hex');
for(const row of prior.downloads??[]){
 if(row.status!=='complete_verified')continue;
 const spec=expected.public_files.find(x=>x.name===row.name);assert.ok(spec);
 assert.equal(row.bytes,spec.bytes);assert.equal(row.sha256,spec.sha256);assert.equal(row.expected_sha256,spec.sha256);
 assert.equal(row.url,'https://agent.copypaste.hk/downloads/releases/20501/'+spec.name);
 report.downloads.push({...row,retained_exact_whole_file:true,source_receipt:'.data/deployment-205-v1/public-download-v1.sanitized.json',source_receipt_sha256:priorSha});
}
assert.equal(new Set(report.downloads.map(x=>x.name)).size,report.downloads.length);
report.retained_observation={receipt_sha256:priorSha,whole_files:report.downloads.length,reason:'Same immutable20501 file bytes and exact URLs. Preserve passing whole-file observations; retry only unmet downloads. The first observer did not open the checksum details element.'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));""")
needle="for(const spec of [...expected.public_files].sort((a,b)=>a.bytes-b.bytes)){"
assert needle in s
s=s.replace(needle,"for(const spec of [...expected.public_files].filter(s=>!report.downloads.some(r=>r.name===s.name)).sort((a,b)=>a.bytes-b.bytes)){")
needle="if(await link.count())await link.click({timeout:60000,noWaitAfter:true});"
assert needle in s
s=s.replace(needle,"""if(await link.count()){
    const details=link.locator('xpath=ancestor::details');
    if(await details.count()&&!await details.evaluate(e=>e.open))await details.locator('summary').click();
    await link.waitFor({state:'visible',timeout:30000});await link.click({timeout:60000,noWaitAfter:true});
   }""")
s=s.replace('Date.now()-started>180000','Date.now()-started>300000')
p.write_text(s,'utf-8')
p=R/'docs/tools/document-integrated-round-205-v1.py';s=p.read_text('utf-8')
assert 'public-download-v1.sanitized.json' in s
s=s.replace("public=load(L/'.data/deployment-205-v1/public-download-v1.sanitized.json')","public=load(L/'.data/deployment-205-v1/public-download-v2.sanitized.json')")
needle="attempts=[]"
assert needle in s
s=s.replace(needle,"attempts=[]\np=L/'.data/deployment-205-v1/public-download-v1.sanitized.json';r=load(p);attempts.append({'kind':'public_download_initial_observer','sha256':sha(p),'status':r['status'],'owned_browser_closed':r['owned_browser_closed'],'qualified_complete_files':len([x for x in r['downloads'] if x['status']=='complete_verified']),'note':'Checksum link lives inside a closed details element. Retain actual complete files and original action failure; new observer expands the real summary before clicking.'})")
p.write_text(s,'utf-8')
print(json.dumps({'status':'prepared','observer':'205-v2','product_source_changes':False,'retain_actual_complete_files':True}))
