"""Retain the assembly failure and count nested TAP cases without rerunning tests."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,re
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery';Q=R/'docs/quality/integrated-round-205'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
first=R/'docs/tools/document-integrated-round-205-v1.py';next_script=first.with_name('document-integrated-round-205-v2.py');assert not next_script.exists()
log=L/'.data/integrated-205-v2/delivery-test.log';text=log.read_text('utf-8')
names=re.findall(r'^[ \t]*ok \d+ - (.*)$',text,re.M);assert len(names)==len(set(names))==21
preserved={name:sha(Q/name) for name in ['verification.json','final-source-manifest.json']}
failure={'stage':205,'status':'retained_assembly_failure','at':datetime.now(timezone.utc).isoformat(),'assembler_sha256':sha(first),'error':'AssertionError: .data/integrated-205-v2/delivery-test.log. The documentation parser counted only10 top-level cases while the passing TAP summary includes11 nested cases,21 total.','log_sha256':sha(log),'verified_top_level_cases':10,'verified_all_cases_including_nested':21,'preserved_partial_documents':preserved,'product_or_test_results_changed':False}
p=Q/'documentation-initial-attempt.json';assert not p.exists();p.write_text(json.dumps(failure,indent=2)+'\n','utf-8')
s=first.read_text('utf-8')
needle=" p=Q/(name+'.json');assert not p.exists(),p;p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\\n','utf-8')"
assert needle in s
replacement=""" p=Q/(name+'.json')
 if p.exists():
  retained=load(Q/'documentation-initial-attempt.json')['preserved_partial_documents']
  assert p.name in retained and sha(p)==retained[p.name] and load(p)==v,p
  return
 p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\\n','utf-8')"""
s=s.replace(needle,replacement).replace("r'^ok \\d+ - (.*)$'","r'^[ \\t]*ok \\d+ - (.*)$'")
assert "r'^[ \\t]*ok \\d+ - (.*)$'" in s
next_script.write_text(s,'utf-8')
print(json.dumps({'status':'prepared','retained_failed_assembler':True,'nested_cases':11,'passed_delivery_cases':21,'product_or_test_results_changed':False}))
