"""Correct only stale test-discovery expectations; preserve every executed attempt."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];backend=root/'dev/copypaste-platform'
old=backend/'tests/current-test-discovery-189-v3.test.ts';new=backend/'tests/current-test-discovery-189-v4.test.ts'
assert not new.exists()
text=old.read_text('utf8').replace('current-test-discovery-189-v3.test.ts','current-test-discovery-189-v4.test.ts').replace('"desktop-executions-139-v2.test.ts"','"desktop-executions-139-v3.test.ts"')
assert text!=old.read_text('utf8');new.write_text(text,encoding='utf8',newline='\n')
out=root/'docs/quality/integrated-round-202/discovery-correction-v1.json';assert not out.exists()
out.write_text(json.dumps({'stage':202,'product_source_changes':False,'failure':'One of171 related backend cases expected retained desktop-executions139v2, while the actual current runner correctly selects139v3. The other170 cases, including the complete HTML/SEO download suites, passed.','correction':'Retain all six discovery cases and update the expected current Desktop attempt/self identity. Preserve original failing suite and source-qualified165 non-discovery passes; replay all six discovery cases, without counting the five original passing discovery cases twice.','final_distinct_related_backend_cases':171},indent=2)+'\n',encoding='utf8')
print(json.dumps({'status':'collected_test_expectation_correction','product_changes':False,'replay_cases':6}))
