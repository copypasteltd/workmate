from pathlib import Path
ROOT=Path('D:/dev/copypasted/自有agent');DEL=ROOT/'dev/copypaste-delivery';DESK=ROOT/'dev/copypaste-desktop'
def create(source,target,replacements):
 s=source.read_text(encoding='utf-8')
 for old,new in replacements:
  if old not in s:raise RuntimeError(f'{source.name}: missing {old[:90]}')
  s=s.replace(old,new)
 with target.open('x',encoding='utf-8',newline='\n') as f:f.write(s)

create(DESK/'scripts/package-integrated-197-v3.mjs',DESK/'scripts/package-integrated-198-v1.mjs',[
 ('deployment-197-v3','deployment-198-v1'),('stage:197','stage:198'),('integrated-197-v2','integrated-198-v2')])
create(DEL/'scripts/prepare-public-downloads-197-v1.py',DEL/'scripts/prepare-public-downloads-198-v1.py',[
 ('deployment-197-v2','deployment-198-v1'),('deployment-197','deployment-198-v1'),('0.7.7','0.7.9'),('0.5.6','0.5.7'),('/releases/197/','/releases/198/'),("'stage':197","'stage':198")])
create(DEL/'scripts/finalize-release-metadata-197-v3.mjs',DEL/'scripts/finalize-release-metadata-198-v1.mjs',[
 ('deployment-197-v2','deployment-198-v1'),('integrated-197-v2','integrated-198-v2'),('0.7.8','0.7.9'),('stage:197','stage:198'),('final-v3','final-v1')])
create(DEL/'scripts/package-integrated-197-v2.py',DEL/'scripts/package-integrated-198-v1.py',[
 ('deployment-197-v2','deployment-198-v1'),('integrated-197-v2','integrated-198-v1'),('stage=197','stage=198')])
create(DEL/'scripts/upload-integrated-197-v2.py',DEL/'scripts/upload-integrated-198-v1.py',[
 ('deployment-197-v2','deployment-198-v1'),('integrated-197-v2','integrated-198-v1'),('upload-197-v2','upload-198-v1')])
create(DEL/'scripts/stage-integrated-197-v2.sh',DEL/'scripts/stage-integrated-198-v1.sh',[
 ('integrated-197-v2','integrated-198-v1'),('integrated-197-v1','integrated-197-v2'),('upload-197-v2','upload-198-v1'),('WM_STAGE_197','WM_STAGE_198'),("m['stage']==197","m['stage']==198")])
create(DEL/'scripts/activate-integrated-197-v2.sh',DEL/'scripts/activate-integrated-198-v1.sh',[
 ('integrated-197-v2','integrated-198-v1'),('integrated-197-v1','integrated-197-v2'),('integrated-197/activation-v2','integrated-198/activation-v1'),('integrated-197/downloads-v2','integrated-198/downloads-v1'),("('z'*34+","('z'*35+"),('WM_ACTIVATE_197_V2','WM_ACTIVATE_198_V1'),("'stage':197","'stage':198")])
create(DEL/'scripts/upload-downloads-197-v2.py',DEL/'scripts/upload-downloads-198-v1.py',[
 ('deployment-197-v2','deployment-198-v1'),('downloads-197-v2','downloads-198-v1'),("'stage':197","'stage':198")])
create(DEL/'scripts/activate-downloads-197-v2.sh',DEL/'scripts/activate-downloads-198-v1.sh',[
 ('downloads-197-v2','downloads-198-v1'),("manifest['stage']==197","manifest['stage']==198"),('0.7.8','0.7.9'),('0.5.6','0.5.7'),('releases/19702','releases/198'),("needle='location ^~ /downloads/releases/197/ {'","needle='location ^~ /downloads/releases/19702/ {'"),('integrated-197/downloads-v2','integrated-198/downloads-v1'),("'stage':197","'stage':198"),('WM_DOWNLOADS_197','WM_DOWNLOADS_198')])
# The insertion anchor refers to the existing 19702 location, not the new198 block.
p=DEL/'scripts/activate-downloads-198-v1.sh';s=p.read_text(encoding='utf-8');s=s.replace("needle='location ^~ /downloads/releases/198/ {'","needle='location ^~ /downloads/releases/19702/ {'");p.write_text(s,encoding='utf-8',newline='\n')
create(DEL/'scripts/collect-integrated-197-v2.sh',DEL/'scripts/collect-integrated-198-v1.sh',[
 ('integrated-197-v2','integrated-198-v1'),('integrated-197','integrated-198'),('activation-v2','activation-v1'),('downloads-v2','downloads-v1'),("'stage':197","'stage':198"),('WM_COLLECT_197','WM_COLLECT_198')])
create(DEL/'scripts/probe-release-integrated-197-v3.mjs',DEL/'scripts/probe-release-integrated-198-v1.mjs',[
 ('deployment-197-v2','deployment-198-v1'),('package-receipt-v3.private','package-receipt.private'),('releases/19702','releases/198'),('stage:197','stage:198')])
create(DEL/'scripts/qualify-real-desktop-197-v2.mjs',DEL/'scripts/qualify-real-desktop-198-v1.mjs',[
 ('acceptance-197','acceptance-198'),('deployment-197-v2','deployment-198-v1'),('WM197','WM198'),('stage:197','stage:198'),('integrated-197-v1','integrated-198-v1'),('0.7.7','0.7.9'),('197-v2','198-v1'),('197-v1','198-v1')])
create(DEL/'scripts/qualify-native-extension-197-v2.mjs',DEL/'scripts/qualify-native-extension-198-v1.mjs',[
 ('acceptance-197','acceptance-198'),('stage:197','stage:198'),('197-v2','198-v1'),('extension-197','extension-198')])
create(DEL/'scripts/smoke-integrated-197-v4.mjs',DEL/'scripts/smoke-integrated-198-v1.mjs',[
 ('acceptance-197','acceptance-198'),('deployment-197-v2','deployment-198-v1'),('integrated-197-v2','integrated-198-v1'),('host-final-v2','host-final-v1'),('releases/19702','releases/198'),('release19702','release198'),('candidate197 v2','candidate198 v1'),('stage:197','stage:198'),('0.5.6','0.5.7'),('197-v4','198-v1')])
print('198 release and acceptance pipeline scripts prepared; historical scripts preserved.')
