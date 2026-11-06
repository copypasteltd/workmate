"""Clarify explicit owned-browser termination without changing cleanup checks."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery';S=L/'scripts'
s=(S/'collect-runtime-cleanup-204-v1.ps1').read_text('utf-8-sig')
s=s.replace('runtime-cleanup-v1.json','runtime-cleanup-v2.json')
s=s.replace('Read-only collection after driver finally blocks close their owned browsers/native clients, exact-owner IPC PostgreSQL checkpointing shutdown and owned company-only QA transport stop. No process kills, recursive deletion or server/network changes.', 'Read-only final collection after driver cleanup and explicit termination of exactly identified stalled/ended QA browser main processes; driver finally blocks retain the partial results and release their remaining contexts. Native PostgreSQL checkpoint shutdown and both owned QA transport closures are separately evidenced. This observer kills no processes. No unrelated user process, recursive deletion, virtualization or server/network change is used.')
with (S/'collect-runtime-cleanup-204-v2.ps1').open('x',encoding='utf-8',newline='\n') as f:f.write(s)
p=R/'docs/tools/document-integrated-round-204-v2.py';s=p.read_text('utf-8-sig')
needle="cleanup=load(L/'.data/acceptance-204/runtime-cleanup-v1.json');assert cleanup['status']=='passed';put('runtime-cleanup.json',cleanup)"
assert s.count(needle)==1
s=s.replace(needle,"cleanup=load(L/'.data/acceptance-204/runtime-cleanup-v2.json');assert cleanup['status']=='passed';put('runtime-cleanup.json',cleanup)\nput('retained-cleanup-observation-v1.json',{'receipt':load(L/'.data/acceptance-204/runtime-cleanup-v1.json'),'note':'The original zero-owner/resource counts passed, but its No process kills wording was too broad for this round. v2 explicitly records exact-owned QA browser termination and preserves all original counts/requirements; unrelated user processes were not targeted.'})")
p.write_text(s,encoding='utf-8',newline='\n')
print(json.dumps({'status':'prepared','cleanup_requirements_unchanged':True,'unrelated_processes_targeted':False}))
