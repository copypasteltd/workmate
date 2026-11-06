from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];D=R/'dev';W=D/'copypaste-web';N=D/'copypaste-desktop';P=D/'copypaste-platform';L=D/'copypaste-delivery'
def change(p,old,new):
 s=p.read_text('utf8');assert old in s,(str(p),old[:80]);p.write_text(s.replace(old,new,1),encoding='utf8',newline='\n')
for folder in [W/'src',N/'renderer/src']:
 (folder/'review-download.ts').write_bytes((W/'src/review-download.ts').read_bytes())
 change(folder/'api.ts','import { clearAnalysisPending }','import { readReviewBlob } from "./review-download";\nimport { clearAnalysisPending }')
 change(folder/'api.ts','blob = await response.blob();','blob = postBody === undefined ? await response.blob() : await readReviewBlob(response, current);')
 change(folder/'analysis-review.tsx','const reason = (value: string) => ({','const reasons: Record<string, string> = {')
 change(folder/'analysis-review.tsx',' }[value] ?? t("來源未提供可計算數值", "The source provides no calculable value"));',' };\n  const reason = (value: string) => reasons[value] ?? t("來源未提供可計算數值", "The source provides no calculable value");')
 change(folder/'analysis-history.tsx','setCursors(old => [...old, result.data.next_cursor])','setCursors(old => old.at(-1) === result.data.next_cursor ? old : [...old, result.data.next_cursor])')
(N/'tests/analysis-review-202.test.ts').write_text((W/'tests/analysis-review-202.test.ts').read_text('utf8').replace('../src/','../renderer/src/'),encoding='utf8',newline='\n')

contract={'schema':'copypaste-analysis-review-routes-202-v1','routes':[{'method':'POST','path':'/v1/tenants/:tenant/projects/:project/analysis/preview/export'}],'conditional_routes':[],'expected_current_routes':760,'expected_current_conditional_routes':1,'authorization':'Current actor/project write authority and fresh source/retention locks, normalized specification and exact deterministic preview digest. No-store HTML/CSV/JSON with checksum, all scopes and evidence; no model calls or task/billing writes. Cursors retain current RLS on every read.'}
(P/'contracts/analysis-review-route-additions-202.json').write_text(json.dumps(contract,indent=2)+'\n',encoding='utf8',newline='\n')
(P/'tests/route-inventory-202-v1.ts').write_text((P/'tests/route-inventory-201-v1.ts').read_text('utf8').replace('./route-inventory-200-v1.js','./route-inventory-201-v1.js').replace('motion-production-route-additions-201.json','analysis-review-route-additions-202.json'),encoding='utf8',newline='\n')
for stem in ['brand-production-189','dedicated-cloud-189','workspace-completion-196']:
 target=P/'tests'/(stem+'-v5.test.ts');assert not target.exists();target.write_text((P/'tests'/(stem+'-v4.test.ts')).read_text('utf8').replace('./route-inventory-201-v1.js','./route-inventory-202-v1.js').replace('inventory.routes.length,759','inventory.routes.length,760'),encoding='utf8',newline='\n')

# Retain every prior operation/failed attempt. New tools target one new overlay
# and immutable download directory; the known live201 overlay is the rollback.
sources={'package-integrated':('201-v1','.py'),'upload-integrated':('201-v1','.py'),'stage-integrated':('201-v1','.sh'),'activate-integrated':('201-v1','.sh'),'collect-integrated':('201-v2','.sh'),'prepare-public-downloads':('201-v1','.py'),'upload-downloads':('201-v1','.py'),'activate-downloads':('201-v1','.sh'),'finalize-release-metadata':('201-v1','.mjs'),'qualify-inner-downloads':('201-v1','.py'),'qualify-public-stream':('201-v2','.mjs'),'company-qa-tunnel':('201-v1','.py'),'preflight-integrated':('201-v1','.sh'),'owned-native-db':('201-v1','.mjs')}
for stem,(version,suffix) in sources.items():
 source=L/'scripts'/(stem+'-'+version+suffix);target=L/'scripts'/(stem+'-202-v1'+suffix);assert not target.exists()
 text=source.read_text('utf8').replace('integrated-201-v1','__NEXT_OVERLAY__').replace('integrated-200-v2','integrated-201-v1').replace('__NEXT_OVERLAY__','integrated-202-v1')
 text=text.replace('integrated-201-v4','integrated-202-v1').replace('integrated-201-v3','integrated-202-v1').replace('integrated-201/','integrated-202/').replace("integrated-201'","integrated-202'").replace('acceptance-201','acceptance-202').replace('deployment-201-v1','deployment-202-v1').replace('20101','20201').replace('0.7.14','0.7.15')
 text=text.replace("'stage':201","'stage':202").replace('stage:201','stage:202').replace('stage=201','stage=202').replace("m['stage']==201","m['stage']==202").replace("manifest['stage']==201","manifest['stage']==202").replace("'z'*40","'z'*41")
 text=text.replace('workmate-upload-201-v1','workmate-upload-202-v1').replace('workmate-downloads-201-v1','workmate-downloads-202-v1').replace('public-downloads-201','public-downloads-202')
 if stem=='collect-integrated':text=text.replace("cfg/'media-runtime-v2/receipt.sanitized.json'","Path('/root/cfg/workmate/integrated-201/media-runtime-v2/receipt.sanitized.json')")
 target.write_text(text,encoding='utf8',newline='\n')
target=N/'scripts/package-integrated-202-v1.mjs';assert not target.exists();target.write_text((N/'scripts/package-integrated-201-v1.mjs').read_text('utf8').replace('deployment-201-v1','deployment-202-v1').replace('integrated-201-v3','integrated-202-v1').replace('stage:201','stage:202'),encoding='utf8',newline='\n')
source=(L/'scripts/verify-integrated-round-201-v2.mjs').read_text('utf8');source=source.replace('integrated-201-v2','integrated-202-v1').replace('integrated-round-201/post-build-code-batch.json','integrated-round-202/implementation-batch.json').replace('stage:201','stage:202')
source=source.replace('/\\/(motion-production-201|video-|desktop-video\\.|creative-packages-140|design-production-200|brand-production-189|dedicated-cloud-189|workspace-completion-196|business-quality\\.)/', '/\\/(analysis-review-202|analysis-calculation\\.|analysis-reports\\.|analysis-role-|analytics-|web-analytics|design-production-200|brand-production-189|dedicated-cloud-189|workspace-completion-196|business-quality\\.)/')
source=source.replace("n.includes('motion-production-201')","n.includes('analysis-review-202')").replace('Motion production, actual rendering, source authority, Desktop video, immutable packages, unchanged design paths and full route inventory.', 'Marketing history, current source authority, exact analysis/reporting and immutable deliveries, native bounded downloads, unchanged design and complete route inventory.').replace('Motion production','Marketing review')
(L/'scripts/verify-integrated-round-202-v1.mjs').write_text(source,encoding='utf8',newline='\n')
print('Finished shared clients, current contracts, meaningful test cases and versioned whole-round operations. No build/test has run.')
