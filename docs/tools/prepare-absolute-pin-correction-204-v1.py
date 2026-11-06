"""Correct executable/version binding; preserve original failed whole attempts."""
from pathlib import Path
from datetime import datetime,timezone
import json
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery';Q=R/'docs/quality/integrated-round-204'
v=json.loads((L/'.data/integrated-204-v10/verification.json').read_text('utf-8'))
assert v['qualified_backend_case_count']==183 and v['backend_failed_cases']==21
def edit(p,before,after):
 text=p.read_text('utf-8');assert before in text,p
 p.write_text(text.replace(before,after),encoding='utf-8',newline='\n')
for p in [L/'scripts/deploy-integrated-204-v1.py',L/'scripts/finalize-release-metadata-204-v1.mjs',R/'docs/tools/document-integrated-round-204-v1.py']:
 edit(p,'integrated-204-v10','integrated-204-v11')
doc=R/'docs/tools/document-integrated-round-204-v1.py'
edit(doc,"old=load(OLD/'final-source-manifest.json');", "assert counts['copypaste-platform']==37 and len(v['retained_backend_cases'])==167 and all(c['passed'] for c in v['retained_backend_cases'])\ncounts['copypaste-platform']+=len(v['retained_backend_cases'])\nold=load(OLD/'final-source-manifest.json');")
edit(doc,"'current_round_test_log_evidence':current,", "'current_round_test_log_evidence':current,'retained_backend_cases':v['retained_backend_cases'],'original_failed_backend_whole':v['original_failed_whole'],")
edit(doc,'All204 Backend cases were executed on the final complete corrected batch in three independent isolated-database groups, with the explicit pinned Windows native version.', 'Backend204 distinct cases cover the final identical product source: all37 cases in the three affected files rerun with absolute executable plus matching version/hash;167 other passed cases retain exact source/test/log SHA and unique TAP evidence from failed whole204-v10. That original whole attempt remains failed with21 failures.')
final=R/'docs/tools/finalize-integrated-round-204-v1.py'
edit(final,"assert verification['backend_groups']==3 and verification['backend_failed_cases']==0", "assert verification['backend_groups']==3 and verification['backend_failed_cases']==0\nassert len(verification['retained_backend_cases'])==167 and len(verification['current_backend_cases'])==37\nassert all(c['passed'] for c in verification['retained_backend_cases']+verification['current_backend_cases'])\nassert verification['original_failed_whole']['failed']==21")
receipt={'stage':204,'at':datetime.now(timezone.utc).isoformat(),'previous_whole':'.data/integrated-204-v10/verification.json','observed_default_cli':'codex-cli 0.166.0-alpha.6','environment_file_version':'0.163.0-alpha.10.2','delivery_native_pin':'0.163.0-alpha.11','correction':'Pin both CODEX_BIN to the exact delivery executable and CODEX_VERSION to its verified version; pinning only the version or deleting its environment override still called a different global program. The earlier profile-only explanation was incomplete.','product_source_unchanged':True,'production_version_guard_changed':False,'current_complete_affected_files':3,'current_cases':37,'retained_distinct_passed_cases':167,'original_whole_failure_preserved':True,'server_network_changes':False}
with (Q/'collected-absolute-pin-correction-v1.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(receipt,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({'status':'complete_correction_prepared','affected_cases':37,'retained_cases':167,'server_network_changes':False}))
