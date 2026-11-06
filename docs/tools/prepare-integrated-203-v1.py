"""Finish the entire autonomous code/QA/operations batch before verification."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';S=L/'scripts'
def put(path,text):
 assert not path.exists(),path
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text,encoding='utf-8',newline='\n')
def derive(source,target,replacements):
 text=source.read_text('utf-8')
 for a,b in replacements:
  assert a in text,(source,a);text=text.replace(a,b)
 put(target,text)
for repo,version in [('web','0.5.12'),('desktop','0.7.16'),('delivery','0.5.10')]:
 for filename in ['package.json','package-lock.json']:
  p=D/('copypaste-'+repo)/filename;b=json.loads(p.read_text('utf-8'));b['version']=version
  if filename=='package-lock.json':b['packages']['']['version']=version
  p.write_text(json.dumps(b,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
derive(S/'company-qa-tunnel-202-v1.py',S/'company-qa-tunnel-203-v1.py',[('acceptance-202','acceptance-203'),("'stage':202","'stage':203")])
derive(S/'owned-native-db-202-v1.mjs',S/'owned-native-db-203-v1.mjs',[('acceptance-202','acceptance-203')])
derive(D/'copypaste-desktop/scripts/package-integrated-202-v2.mjs',D/'copypaste-desktop/scripts/package-integrated-203-v1.mjs',[
 ('deployment-202-v2','deployment-203-v1'),('stage:202','stage:203'),('integrated-202-v3','integrated-203-v1')])
derive(S/'prepare-public-downloads-202-v2.py',S/'prepare-public-downloads-203-v1.py',[
 ('deployment-202-v1','deployment-203-v1'),('deployment-202-v2','deployment-203-v1'),('0.7.15','0.7.16'),('20201','20301'),("'stage':202","'stage':203")])
derive(S/'finalize-release-metadata-202-v2.mjs',S/'finalize-release-metadata-203-v1.mjs',[
 ('deployment-202-v1','deployment-203-v1'),('integrated-202-v3','integrated-203-v1'),('0.7.15','0.7.16'),('stage:202','stage:203')])
derive(S/'activate-downloads-202-v2.sh',S/'activate-downloads-203-v1.sh',[
 ('workmate-downloads-202-v1','workmate-downloads-203-v1'),('manifest[\'stage\']==202','manifest[\'stage\']==203'),('0.7.15','0.7.16'),('20201','20301'),
 ("state=Path('/root/cfg/workmate/integrated-202/downloads-v1')","state=Path('/root/cfg/workmate/integrated-203/downloads-v1')"),("'stage':202","'stage':203")])
derive(S/'upload-downloads-202-v1.py',S/'upload-downloads-203-v1.py',[('deployment-202-v1','deployment-203-v1'),('workmate-downloads-202-v1','workmate-downloads-203-v1')])
derive(S/'verify-network-preserved-202-v3.sh',S/'verify-network-preserved-203-v1.sh',[
 ("p=root/'network-preserved-v3.json'","p=Path('/root/cfg/workmate/integrated-203/network-preserved-v1.json');p.parent.mkdir(mode=0o700,exist_ok=True)"),("'stage':202","'stage':203")])
derive(S/'qualify-inner-downloads-202-v2.py',S/'qualify-inner-downloads-203-v1.py',[('deployment-202-v1','deployment-203-v1'),("'stage':202","'stage':203")])
derive(S/'qualify-public-stream-202-v1.mjs',S/'qualify-public-stream-203-v1.mjs',[('deployment-202-v1','deployment-203-v1'),('stage:202','stage:203')])
derive(S/'qualify-live-marketing-review-202-v7.mjs',S/'qualify-live-marketing-review-203-v1.mjs',[
 ('deployment-202-v2','deployment-203-v1'),('acceptance-202','acceptance-203'),('stage:202','stage:203'),('0.7.15','0.7.16'),('202-v7','203-v1'),
 ("import {untilMotion} from './motion-ui-journey-201-v2.mjs';","import {untilMotion} from './motion-ui-journey-201-v2.mjs';\nimport {assertReviewLayout} from './review-layout-203-v1.mjs';"),
 ("await review.scrollIntoViewIfNeeded();await capture(page,'web');","report.web_layout=await assertReviewLayout(page,dialog,review);await review.scrollIntoViewIfNeeded();await capture(page,'web');"),
 ("await native.review.scrollIntoViewIfNeeded();await capture(page,'desktop');","report.native_layout=await assertReviewLayout(page,native.dialog,native.review);await native.review.scrollIntoViewIfNeeded();await capture(page,'desktop');"),
 ("'--proxy-server=http://127.0.0.1:8733'","'--proxy-server='+process.env.WORKMATE_QA_PROXY")])
print('Prepared versions, packaging, original-TLS QA, unchanged-network download and verification scripts. No builds/tests/deployments started.')
