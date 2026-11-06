"""Resume the report with the reviewed final catalog included in its manifest."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];source=root/'docs/tools/finalize-evidence-delta-198-v2.py';target=root/'docs/tools/finalize-evidence-delta-198-v3.py';assert not target.exists()
s=source.read_text(encoding='utf8')
old="history=OUT/'initial-198-v1';assert not history.exists();history.mkdir()\nfor p in OUT.iterdir():\n    if p.is_file():shutil.copyfile(p,history/p.name)"
assert old in s
new="history=OUT/'initial-198-v1';assert history.is_dir()\nassert load(history/'verification.json')['total_tests']==555\nassert load(history/'real-desktop-journey.json')['desktop_version']=='0.7.9'\n# The interruptedv2 report already retained this exact initial archive; never recopy final files over it."
s=s.replace(old,new)
old="['dev/copypaste-web/src/task-directory.tsx','dev/copypaste-desktop/renderer/src/task-directory.tsx']"
assert old in s;s=s.replace(old,"['dev/copypaste-web/src/task-directory.tsx','dev/copypaste-desktop/renderer/src/task-directory.tsx','dev/copypaste-web/contracts/product-downloads.json']")
target.write_text(s,encoding='utf8',newline='\n')
out=root/'docs/quality/integrated-round-198/documentation-failures.json'
out.write_text(json.dumps({'stage':198,'retained_failure':{'script':'docs/tools/finalize-evidence-delta-198-v2.py','error':'Manifest review rejected the newly released Web product-downloads catalog, which changed after final package hashes became available.','resolution':'v3 resumes without replacing the initial archive; explicitly includes the final catalog already verified by complete public downloads.'}},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('prepared bounded report resume; original v2 and initial evidence remain')
