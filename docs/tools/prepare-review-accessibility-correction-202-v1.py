from pathlib import Path
import hashlib,json
from datetime import datetime,timezone
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';N=D/'copypaste-desktop';O=R/'docs/quality/integrated-round-202'
old='<div className="review-search"><Search size={16} aria-hidden/><input value={query} maxLength={160} onChange={e => setQuery(e.target.value)} placeholder={t("渠道、帳戶、幣種或活動", "Source, account, currency or campaign")}/></div>'
new='<input type="search" value={query} maxLength={160} onChange={e => setQuery(e.target.value)} placeholder={t("渠道、帳戶、幣種或活動", "Source, account, currency or campaign")}/>'
for folder in [D/'copypaste-web/src',N/'renderer/src']:
 p=folder/'analysis-review.tsx';s=p.read_text('utf8');assert old in s;s=s.replace(old,new).replace('{ Download, Search }','{ Download }').replace('useState(calculation.spec.metrics[0])','useState(calculation.spec.metrics.includes("spend") ? "spend" : calculation.spec.metrics[0])');p.write_text(s,encoding='utf8',newline='\n')
s=(L/'scripts/qualify-marketing-review-202-v2.mjs').read_text('utf8').replace("'202-v2'","'202-v3'").replace('202-v2-marketing-review.png','202-v3-marketing-review.png');(L/'scripts/qualify-marketing-review-202-v3.mjs').write_text(s,encoding='utf8',newline='\n')
source=N/'scripts/package-integrated-202-v1.mjs';s=source.read_text('utf8').replace('deployment-202-v1','deployment-202-v2').replace('integrated-202-v2/verification.json','integrated-202-v3/verification.json');(N/'scripts/package-integrated-202-v2.mjs').write_text(s,encoding='utf8',newline='\n')
for stem in ['prepare-public-downloads','finalize-release-metadata']:
 suffix='.py' if stem=='prepare-public-downloads' else '.mjs';p=L/'scripts'/(stem+'-202-v1'+suffix);s=p.read_text('utf8').replace('copypaste-desktop/.data/deployment-202-v1/release','copypaste-desktop/.data/deployment-202-v2/release').replace('integrated-202-v2/verification.json','integrated-202-v3/verification.json');(L/'scripts'/(stem+'-202-v2'+suffix)).write_text(s,encoding='utf8',newline='\n')
p=L/'scripts/qualify-live-marketing-review-202-v1.mjs';s=p.read_text('utf8').replace(".data/deployment-202-v1/release/win-unpacked",".data/deployment-202-v2/release/win-unpacked");p.write_text(s,encoding='utf8',newline='\n')
original=json.loads((O/'implementation-batch.json').read_text('utf8'));rows=[];changed=[]
for row in original['production_source_files']:
 p=R/row['path'];b=p.read_bytes();r={'path':row['path'],'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()};rows.append(r)
 if r['sha256']!=row['sha256']:changed.append(row['path'])
assert set(changed)=={'dev/copypaste-web/src/analysis-review.tsx','dev/copypaste-desktop/renderer/src/analysis-review.tsx'}
report={'stage':202,'at':datetime.now(timezone.utc).isoformat(),'status':'collected_correction_batch_complete_before_replay','changed_product_sources':changed,'production_source_files':rows,'reason':'Actual browser exposed a Field-cloned aria-label on a wrapper in addition to the nested input. Bind the shared Field directly to the search input and open with spend when available. Preserve both original UI failures and the earlier package as superseded, never publish it. Rerun changed Web/Desktop builds/full suites and actual unified journey; all other823source-minus-two files retain their proven bytes.'}
(O/'correction-batch-v2.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
print(json.dumps({'status':report['status'],'changed':changed}))
