from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts';p=S/'qualify-specialist-intake-203-v3.mjs';s=p.read_text('utf-8')
old="intake=page.getByRole('dialog',{name:'Start something new',exact:true});";assert s.count(old)==2;s=s.replace(old,'intake=await open();')
s=s.replace("'203-v3'","'203-v4'");out=S/'qualify-specialist-intake-203-v4.mjs';assert not out.exists();out.write_text(s,encoding='utf-8',newline='\n')
p=R/'docs/quality/integrated-round-203/intake-scope-correction-v1.json';assert not p.exists();p.write_text(json.dumps({'stage':203,'retained_attempt':'qualify-specialist-intake-203-v3.mjs','observation':'Switching workspace unmounts the entire work surface and closes its modal, rather than keeping a blank modal open. The original test waited on an already-closed dialog.','correction':'Explicitly reopen the work input in each selected scope, then check blank/restored content and attachments.','production_source_changed':False},indent=2)+'\n',encoding='utf-8')
