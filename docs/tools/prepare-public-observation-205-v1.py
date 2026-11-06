from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery'
s=(L/'scripts/qualify-public-download-204-v5.mjs').read_text('utf-8')
s=s.replace('deployment-204-v1','deployment-205-v1').replace('public-download-v5','public-download-v1').replace('public-browser-files-v5','public-browser-files-v1').replace('stage:204','stage:205').replace('/releases/20401/','/releases/20501/').replace('600000','180000')
s=s.replace('Three successful health observations from the identical deployed release are retained from204-v4;', 'Fresh public health is checked on all three current domains;')
start=s.index('const healthPath=')
end=s.index('const persist=',start)
s=s[:start]+s[end:]
needle=' report.anonymous_download_links=true;'
assert needle in s
s=s.replace(needle,needle+'''
 for(const host of ['agent','agent-dashboard','ai-api']){
  const result=await page.evaluate(async host=>{const r=await fetch('https://'+host+'.copypaste.hk/health/ready',{signal:AbortSignal.timeout(45000)});return {status:r.status,body:await r.json()};},host);
  assert.equal(result.status,200);assert.equal(result.body.kernel,'codex');assert.equal(result.body.ai_ready,true);assert.equal(result.body.data_mode,'configured_services');report.health.push({host,status:'passed',body:result.body});await persist();
 }
''')
p=L/'scripts/qualify-public-download-205-v1.mjs';assert not p.exists();p.write_text(s,'utf-8')
print(json.dumps({'status':'prepared','public_file_observation_limit_seconds':180,'no_server_network_changes':True}))
