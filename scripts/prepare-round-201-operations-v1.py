"""Version the reviewed prior native release/deployment tools; keep prior executions immutable."""
from pathlib import Path
delivery=Path(__file__).resolve().parents[1];desktop=delivery.parent/'copypaste-desktop'
names=['package-integrated','upload-integrated','stage-integrated','activate-integrated','collect-integrated','prepare-public-downloads','upload-downloads','activate-downloads','finalize-release-metadata','qualify-inner-downloads','qualify-public-stream']
sources={'qualify-public-stream':('200-v3','.mjs')}
for stem in names:
 version,extension=sources.get(stem,('200-v2','.py' if stem in ['package-integrated','upload-integrated','prepare-public-downloads','upload-downloads','qualify-inner-downloads'] else '.mjs' if stem=='finalize-release-metadata' else '.sh'))
 source=delivery/'scripts'/(stem+'-'+version+extension);target=delivery/'scripts'/(stem+'-201-v1'+extension);assert source.is_file() and not target.exists()
 s=source.read_text('utf8').replace('200-v1','__PRIOR_200_V2__').replace('200-v2','201-v1').replace('200-v3','201-v1').replace('200-v4','201-v2').replace('__PRIOR_200_V2__','200-v2')
 s=s.replace('integrated-200/','integrated-201/').replace("integrated-200'","integrated-201'").replace('activation-v2','activation-v1').replace('downloads-v2','downloads-v1').replace('20002','20101').replace('0.7.13','0.7.14')
 s=s.replace('stage=200','stage=201').replace("'stage':200","'stage':201").replace('stage:200','stage:201').replace("m['stage']==200","m['stage']==201").replace("manifest['stage']==200","manifest['stage']==201").replace("'z'*39","'z'*40")
 s=s.replace("'earlier_schema_rollback_exercised':True,", "'rollback_compatibility':'Unchanged schema163; previous overlay retained, rollback not triggered by this successful activation',")
 s=s.replace('inner-downloads-v2.sanitized.json','inner-downloads-v1.sanitized.json')
 target.write_text(s,encoding='utf8',newline='\n')
source=desktop/'scripts/package-integrated-200-v2.mjs';target=desktop/'scripts/package-integrated-201-v1.mjs';assert not target.exists();s=source.read_text('utf8').replace('200-v2','201-v1').replace('200-v4','201-v2').replace('stage:200','stage:201');target.write_text(s,encoding='utf8',newline='\n')
for source_name,target_name in [('company-qa-tunnel-200-v1.py','company-qa-tunnel-201-v1.py'),('preflight-integrated-200-v3.sh','preflight-integrated-201-v1.sh')]:
 source=delivery/'scripts'/source_name;target=delivery/'scripts'/target_name;assert not target.exists();s=source.read_text('utf8').replace('acceptance-200','acceptance-201').replace('integrated-200-v1/backend','integrated-200-v2/backend').replace("'stage':200","'stage':201");target.write_text(s,encoding='utf8',newline='\n')
print('Prepared versioned operations; no remote changes executed.')
