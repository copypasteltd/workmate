"""Validate the new bounded product skill, preserving prior packages/cases."""
import json
from datetime import datetime,timezone
from pathlib import Path
import subprocess
from refresh_stage52_capabilities import ROOT,PLATFORM,DELIVERY,digest,read,git,receipt

old=json.loads(git(PLATFORM,'show','9ade763:catalog/skill-packages.json'))
current=read(PLATFORM/'catalog/skill-packages.json')
assert len(old)==28 and len(current)==29
indexed={s['key']:s for s in current}
for package in old:
    assert package==indexed[package['key']]
    assert digest(PLATFORM/package['path'])==package['sha256']
new=indexed['template-video-composition'];folder=PLATFORM/'skills/template-video-composition'
assert digest(folder/'SKILL.md')==new['sha256']
catalog=read(ROOT/'docs/contracts/role-preset-catalog.json')
assert catalog==read(PLATFORM/'catalog/role-preset-catalog.json')
prior=json.loads(git(ROOT,'show','59728b4:docs/contracts/role-preset-catalog.json'))
assert len(catalog['roles'])==18 and catalog['skill_catalog'][:28]==prior['skill_catalog']
for before in prior['roles']:
    after=next(r for r in catalog['roles'] if r['role_key']==before['role_key'])
    if before['role_key']!='video-motion':assert after==before
    else:
        assert after['version']=='1.1.0' and {b['skill_key'] for b in after['skill_bindings']}=={'video-storyboard','template-video-composition','delivery-core'}
        for key in ('sample_task','workflow','deliverables','acceptance_checks','qualification_cases'):
            assert after[key]==before[key]
validator=Path('C:/Users/carzy/.codex/skills/.system/skill-creator/scripts/quick_validate.py')
result=subprocess.run(['python','-X','utf8',str(validator),str(folder)],capture_output=True,text=True,encoding='utf-8',check=False)
assert result.returncode==0,result.stdout+result.stderr
report={'at':datetime.now(timezone.utc).isoformat(),'status':'passed','scope':'New product skill static validation and exact preservation of the 28 earlier packages and original 18 role acceptance cases; controlled runtime invocation is independently exercised by the video integration suite.',
        'original_packages_preserved':28,'current_packages':29,'roles':18,'qualified_live_roles':0,'new_skill':new,'new_skill_bytes':receipt(folder/'SKILL.md'),
        'catalog':receipt(ROOT/'docs/contracts/role-preset-catalog.json'),'validator':{'path':str(validator),'sha256':digest(validator),'exit_code':result.returncode,'output':result.stdout.strip()},'verifier':receipt(Path(__file__).resolve())}
target=DELIVERY/'evidence/template-video-skill-validation.json'
with target.open('x',encoding='utf-8',newline='\n') as f:json.dump(report,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({'status':'passed','preserved_packages':28,'current_packages':29,'roles':18,'original_acceptance_cases_preserved':True}))
