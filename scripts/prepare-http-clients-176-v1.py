"""Use explicit native/CSPRNG-backed browser helpers for authorized LAN HTTP."""
from pathlib import Path
import re,json,hashlib,shutil
ROOT=Path(__file__).resolve().parents[3]
web=ROOT/'dev/copypaste-web';admin=ROOT/'dev/copypaste-admin'
for name in ['src/browser-crypto.ts','tests/browser-crypto-176.test.ts']:
 target=admin/name;assert not target.exists();target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(web/name,target)
rows=[]
for repo in [web,admin]:
 for p in sorted((repo/'src').iterdir()):
  if p.suffix not in ['.ts','.tsx'] or p.name=='browser-crypto.ts':continue
  text=p.read_text(encoding='utf-8');imports=[]
  if re.search(r'(?<![\w.])crypto\.',text):imports.append('browserCrypto as crypto')
  if 'navigator.clipboard.writeText(' in text:
   assert not re.search(r'(?:function|const|let)\s+writeClipboardText\b',text)
   text=text.replace('navigator.clipboard.writeText(', 'writeClipboardText(');imports.append('writeClipboardText')
  if imports:
   assert 'from "./browser-crypto"' not in text
   text='import { '+', '.join(imports)+' } from "./browser-crypto";\n'+text
   p.write_text(text,encoding='utf-8',newline='\n');rows.append(p.relative_to(ROOT).as_posix())
out=ROOT/'dev/copypaste-delivery/.data/deployment-176/http-client-paths.json'
with out.open('x',encoding='utf-8',newline='\n') as f:f.write(json.dumps(rows,indent=2)+'\n')
print(json.dumps({'status':'prepared','files':len(rows),'clients':['web','admin']}))
