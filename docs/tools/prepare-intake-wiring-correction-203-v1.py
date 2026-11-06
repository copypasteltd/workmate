from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts'
p=S/'qualify-specialist-intake-203-v2.mjs';text=p.read_text('utf-8').replace("'./review-layout-203-v2.mjs'","'./review-layout-203-v1.mjs'").replace('203-v2','203-v3')
out=S/'qualify-specialist-intake-203-v3.mjs';assert not out.exists();out.write_text(text,encoding='utf-8',newline='\n')
p=R/'docs/quality/integrated-round-203/intake-wiring-correction-v1.json';assert not p.exists();p.write_text(json.dumps({'stage':203,'original_attempt':'qualify-specialist-intake-203-v2.mjs','failure':'ERR_MODULE_NOT_FOUND: generated version substitution changed the shared helper import to nonexistent review-layout-203-v2.mjs','product_tests_executed':False,'correction':'v3 imports the existing immutable v1 layout helper; product sources remain unchanged','original_attempt_preserved':True},indent=2)+'\n',encoding='utf-8')
