from pathlib import Path
import json
root=Path('D:/dev/copypasted/自有agent');desktop=root/'dev/copypaste-desktop';delivery=root/'dev/copypaste-delivery'
p=desktop/'scripts/package-integrated-197-v1.mjs';text=p.read_text(encoding='utf8')
text=text.replace('.data/deployment-197-v1','.data/deployment-197-v2').replace("CSC_IDENTITY_AUTO_DISCOVERY:'false'", "CSC_IDENTITY_AUTO_DISCOVERY:'false',COPYPASTE_LOCAL_CODEX_BIN:path.resolve('.data/runtime/windows-x64/codex.exe')")
(desktop/'scripts/package-integrated-197-v2.mjs').write_text(text,encoding='utf8')
for filename in ['prepare-public-downloads-197-v1.py','qualify-real-desktop-197-v1.mjs']:
 p=delivery/'scripts'/filename;text=p.read_text(encoding='utf8').replace('deployment-197-v1/release','deployment-197-v2/release');p.write_text(text,encoding='utf8')
(desktop/'.data/deployment-197-v1/failure-receipt.json').write_text(json.dumps({'stage':197,'status':'failed','phase':'pinned-runtime','cause':'The packaging command omitted the explicit local pinned Codex path. The existing locked bytes are used explicitly in packaging v2. No product code change.'},indent=2)+'\n',encoding='utf8')
