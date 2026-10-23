"""Check current browser/layout docs, media and unchanged original acceptance."""
from datetime import datetime,timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
read=lambda file:json.loads(file.read_text(encoding='utf-8'))
digest=lambda file:sha256(file.read_bytes()).hexdigest()
checkpoint_path=ROOT/'docs/quality/desktop-browser-checkpoint.json'
checkpoint=read(checkpoint_path)
assert checkpoint['status']=='verified_bounded_native_browser_and_desktop_layout'
readmes=[ROOT/'docs'/name for name in ['README.md','README.en.md']]
for component in ['platform','web','admin','desktop','extension','delivery']:
    readmes.extend(DEV/('copypaste-'+component)/name for name in ['README.md','README.en.md'])
images=[]
for file in readmes:
    text=file.read_text(encoding='utf-8')
    assert 'desktop-native-browser-stage77' in text and 'desktop-browser-checkpoint.json' in text and '04-desktop-layout-and-scroll.md' in text
    assert all(str(value) in text for value in [checkpoint['platform_tests']['tests'],848,428,102])
    for link in re.findall(r'!\[[^\]]*\]\(([^)]+)\)',text):
        if link.startswith(('https://','http://')):
            continue
        target=(file.parent/link).resolve()
        assert target.is_relative_to(ROOT) and target.is_file(),(file,link)
        images.append({'readme':file.relative_to(ROOT).as_posix(),'image':target.relative_to(ROOT).as_posix(),'sha256':digest(target)})
before=read(ROOT/'docs/quality/history/before-stage77-docs/docs__quality__requirements-alignment-progress.json.txt')
after=read(ROOT/'docs/quality/requirements-alignment-progress.json')
for key in ['requirements','summary','fully_accepted_requirements','gates','nfr_full_acceptance','requirements_count']:
    if key in before:
        assert before[key]==after[key],key
assert len(after['requirements'])==102 and after['summary']=={'partial_verified':81,'completion_not_proven':21} and after['fully_accepted_requirements']==0
for item in checkpoint['documentation_media']:
    assert digest(ROOT/item['source'])==digest(ROOT/item['path'])==item['sha256']
visual_path=ROOT/'docs/quality/desktop-browser-visual-review-01.json'
visual=read(visual_path)
assert visual['status']=='visually_reviewed_bounded_layout' and visual['actual_ui_attempt']==checkpoint['selected']['ui']
for item in visual['screenshots']:
    assert digest(ROOT/item['path'])==item['sha256']
old_path=DEV/'copypaste-delivery/evidence/extension-chat-05.json'
old=read(old_path)
sources={name:value for name,value in old['source_files'].items() if name.startswith('copypaste-extension/')}
verifiers={name:old['source_files'][name] for name in ['copypaste-delivery/scripts/qa-extension-chat.ts','copypaste-delivery/scripts/qa-extension.ts','copypaste-delivery/scripts/run-extension-chat.mjs']}
assert len(sources)==31 and len(verifiers)==3
for name,value in {**sources,**verifiers}.items():
    assert digest(DEV/name)==value
files=subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','ls-files','--cached','--others','--exclude-standard','-z','--','src','scripts','tests','public','package.json','package-lock.json','tsconfig.json'],cwd=DEV/'copypaste-extension').decode().split('\0')
assert {'copypaste-extension/'+name for name in files if name}==set(sources)
review={'at':datetime.now(timezone.utc).isoformat(),'status':'reviewed_direction_with_scoped_runtime_evidence','requirements':['CLIENT01','DESK-UI01'],
    'desktop':{'agent_location':'customer_device','kernel':'pinned_native_Codex','full_permission':'explicit_revocable_OS_user_access','checkpoint':checkpoint_path.relative_to(ROOT).as_posix(),'checkpoint_sha256':digest(checkpoint_path),'actual_ui_checks':25,'browser_checks':10,'native_supervisor_tests':17,'native_role_admissions':18,'full_browser_application_parity':'pending','layout_requirement':{'path':'docs/requirements/04-desktop-layout-and-scroll.md','sha256':digest(ROOT/'docs/requirements/04-desktop-layout-and-scroll.md'),'previous_progress_bar_constraint':'withdrawn'}},
    'extension':{'agent_location':'company_cloud','ui':'native_right_Side_Panel_conversation_and_attachments','file_scope':'explicitly_selected_or_dropped_files_read_and_uploaded_to_company','desktop_required_for_cloud_chat_and_file_upload':False,'unchanged_product_sources':sources,'unchanged_journey_verifier_sources':verifiers,'historical_actual_ui_report':old_path.relative_to(ROOT).as_posix(),'historical_report_sha256':digest(old_path),'new_extension_ui_run':False},
    'original_acceptance':checkpoint['original_acceptance'],'verifier_sha256':digest(Path(__file__))}
audit={'at':datetime.now(timezone.utc).isoformat(),'status':'passed','bilingual_readmes':len(readmes),'images':images,'original_requirement_records_unchanged':102,'summary':after['summary'],'fully_accepted_requirements':0,'documentation_media':len(checkpoint['documentation_media']),'visual_review':{'path':visual_path.relative_to(ROOT).as_posix(),'sha256':digest(visual_path)},'verifier_sha256':digest(Path(__file__))}
for name,value in [('client-direction-source-review-77.json',review),('desktop-browser-docs-audit-01.json',audit)]:
    with (ROOT/'docs/quality'/name).open('x',encoding='utf-8') as stream:
        stream.write(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'passed','readmes':14,'images':len(images),'extension_sources':31,'extension_verifiers':3,'original_requirements':102}))
