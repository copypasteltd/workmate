"""Complete the collected presentation/version/release correction before checks."""
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DEL=DEV/'copypaste-delivery';DESK=DEV/'copypaste-desktop'
for rel in ['copypaste-web/src/task-directory.tsx','copypaste-desktop/renderer/src/task-directory.tsx']:
    p=DEV/rel;s=p.read_text(encoding='utf8');assert s.count('t("已結算","Settled")')==1
    p.write_text(s.replace('t("已結算","Settled")','t("已記錄用量","Recorded usage")'),encoding='utf8',newline='\n')
for name,old,new in [('web','0.5.5','0.5.6'),('desktop','0.7.9','0.7.10'),('delivery','0.5.4','0.5.5')]:
    for filename in ['package.json','package-lock.json']:
        p=DEV/('copypaste-'+name)/filename;v=json.loads(p.read_text(encoding='utf8'));assert v['version']==old;v['version']=new
        if filename=='package-lock.json':assert v['packages']['']['version']==old;v['packages']['']['version']=new
        p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def create(base,source,target,changes):
    p=base/source;q=base/target;assert not q.exists(),q;s=p.read_text(encoding='utf8')
    for a in changes:assert a in s,(p.name,a)
    pattern=re.compile('|'.join(re.escape(k) for k in sorted(changes,key=len,reverse=True)))
    s=pattern.sub(lambda m:changes[m[0]],s);q.write_text(s,encoding='utf8',newline='\n')
create(DESK,'scripts/package-integrated-198-v1.mjs','scripts/package-integrated-198-v2.mjs',{'deployment-198-v1':'deployment-198-v2',"JSON.parse(await readFile('../copypaste-delivery/.data/integrated-198-v3/verification.json','utf8')).state":"JSON.parse(await readFile('../copypaste-delivery/.data/integrated-198-v4/verification.json','utf8')).state"})
common={'deployment-198-v1':'deployment-198-v2'}
for stem,ext,extra in [
 ('prepare-public-downloads','py',{'0.7.9':'0.7.10','/releases/198/':'/releases/19802/'}),
 ('finalize-release-metadata','mjs',{'0.7.9':'0.7.10','integrated-198-v3':'integrated-198-v4','final-v1':'final-v2'}),
 ('package-integrated','py',{'integrated-198-v1':'integrated-198-v2'}),
 ('upload-integrated','py',{'integrated-198-v1':'integrated-198-v2','upload-198-v1':'upload-198-v2'}),
 ('upload-downloads','py',{'downloads-198-v1':'downloads-198-v2'})]:
    create(DEL,f'scripts/{stem}-198-v1.{ext}',f'scripts/{stem}-198-v2.{ext}',{**common,**extra})
create(DEL,'scripts/stage-integrated-198-v1.sh','scripts/stage-integrated-198-v2.sh',{'integrated-198-v1':'integrated-198-v2','integrated-197-v2':'integrated-198-v1','upload-198-v1':'upload-198-v2'})
create(DEL,'scripts/activate-downloads-198-v1.sh','scripts/activate-downloads-198-v2.sh',{'downloads-198-v1':'downloads-198-v2','0.7.9':'0.7.10','releases/198':'releases/19802','integrated-198/downloads-v1':'integrated-198/downloads-v2'})
create(DEL,'scripts/activate-integrated-198-v1.sh','scripts/activate-integrated-198-v2.sh',{'integrated-198-v1':'integrated-198-v2','integrated-197-v2':'integrated-198-v1','integrated-198/activation-v1':'integrated-198/activation-v2','integrated-198/downloads-v1':'integrated-198/downloads-v2',"'z'*35+":"'z'*36+"})
create(DEL,'scripts/collect-integrated-198-v1.sh','scripts/collect-integrated-198-v2.sh',{'integrated-198-v1':'integrated-198-v2','activation-v1':'activation-v2','downloads-v1':'downloads-v2'})
create(DEL,'scripts/probe-release-integrated-198-v2.mjs','scripts/probe-release-integrated-198-v3.mjs',{'deployment-198-v1':'deployment-198-v2','releases/198/':'releases/19802/','public-release-v2':'public-release-v1','browser-downloads-v2':'browser-downloads-v1'})
# A new real-page driver checks final wording too, retaining the successful v4.
create(DEL,'scripts/qualify-work-directory-198-v4.mjs','scripts/qualify-work-directory-198-v5.mjs',{'198-v4':'198-v5'})
p=DEL/'scripts/qualify-work-directory-198-v5.mjs';s=p.read_text(encoding='utf8');needle=' for(const width of [375,768,1024,1440])';assert needle in s
s=s.replace(needle," const usageLabels=await p.locator('.task-directory-usage > .muted').allTextContents();assert.ok(usageLabels.length>0);assert.ok(usageLabels.every(s=>s==='Recorded usage'));pass('task-directory amounts are recorded usage without claiming unresolved work is settled');\n"+needle);p.write_text(s,encoding='utf8',newline='\n')
print('Complete wording/version/release correction batch; checks have not started.')
