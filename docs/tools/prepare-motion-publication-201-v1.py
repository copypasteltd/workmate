"""Prepare reviewed next-round publication/check tools without rewriting history."""
from pathlib import Path
import json,re
root=Path(__file__).resolve().parents[2];tools=root/'docs/tools'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
baseline=load(root/'dev/copypaste-delivery/.data/acceptance-201/baseline/receipt.json')
source=(tools/'publish-integrated-round-200-v1.py').read_text('utf8').replace('200','201')
source=re.sub(r'EXPECTED=\{[^\n]+\}',lambda m:'EXPECTED='+repr(baseline['heads']),source,count=1)
start=source.index('tracked={');end=source.index('\ndef allowed_new',start)
source=source[:start]+'''tracked={
 'backend':{'src/creative-packages.ts','src/task-business-tools.ts','src/video-project-model.ts','src/video-projects.ts','src/video-render.ts'},
 'web':{'contracts/product-downloads.json','src/api.ts','src/video-projects.css','src/video-projects.tsx'},
 'admin':set(),'desktop':{'renderer/src/api.ts','renderer/src/video-projects.css','renderer/src/video-projects.tsx'},
 'extension':set(),'delivery':set(),'docs':{'docs/README.md','docs/README.en.md'},
}
shared={'motion-draft-state.ts','motion-editor-model.ts','motion-production.tsx','use-motion-editor.ts'}
new={
 'backend':{'contracts/motion-production-route-additions-201.json','src/video-templates.ts','tests/brand-production-189-v4.test.ts','tests/dedicated-cloud-189-v4.test.ts','tests/motion-production-201-v1.test.ts','tests/motion-production-201-v2.test.ts','tests/route-inventory-201-v1.ts','tests/workspace-completion-196-v4.test.ts'},
 'web':{'src/'+p for p in shared}|{'tests/motion-production-201.test.ts'},
 'desktop':{'renderer/src/'+p for p in shared}|{'tests/motion-production-201.test.ts'},
 'admin':set(),'extension':set(),'delivery':set(),'docs':set(),
}
''' +source[end:]
source=source.replace('201-design-production','201-motion-production').replace('integrated-201-v2/backend','integrated-201-v1/backend')
source=source.replace("['status'] in ['passed','partial','failed']", "['status']=='passed'")
source=source.replace('feat: deliver layout-to-design production and exact shared evidence (201)','feat: deliver motion production, source-bound recovery and real MP4 (201)')
p=tools/'publish-integrated-round-201-v1.py';assert not p.exists();p.write_text(source,encoding='utf8',newline='\n')
source=(tools/'finalize-integrated-round-200-v1.py').read_text('utf8').replace('200','201')
start=source.index('cleanup=load(');end=source.index('readmes=[]',start)
source=source[:start]+'''cleanup=load(DEL/'.data/acceptance-201/runtime-cleanup-v1.json');assert cleanup['status']=='passed'
assert cleanup['owned_browsers_remaining']==cleanup['owned_desktop_instances_remaining']==cleanup['owned_db_helpers_remaining']==cleanup['owned_qa_transports_remaining']==0
''' +source[end:]
source=source.replace('<!-- integrated-round-199 -->','<!-- integrated-round-200 -->')
source=source.replace("['final_reviewed_source_manifest']", "['production_source_files']").replace("['original_prebuild_manifest_sha256']", "['original_prebuild_snapshot_sha256']")
source=source.replace("g['round201_full_acceptance_closed']", "g['round200_full_acceptance_closed']")
source=source.replace("'platform':'0.5.8','web':'0.5.9','admin':'0.5.2','desktop':'0.7.13','extension':'0.5.7','delivery':'0.5.7'", "'platform':'0.5.9','web':'0.5.10','admin':'0.5.2','desktop':'0.7.14','extension':'0.5.7','delivery':'0.5.8'")
source=source.replace('==631','==624').replace("'tests':631", "'tests':624").replace('201-design-production','201-motion-production')
p=tools/'finalize-integrated-round-201-v1.py';assert not p.exists();p.write_text(source,encoding='utf8',newline='\n')
print(json.dumps({'prepared':['publish-integrated-round-201-v1.py','finalize-integrated-round-201-v1.py'],'baseline_heads':baseline['heads']}))
