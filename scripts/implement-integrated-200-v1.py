"""Explicit shared-renderer synchronization and versioned regression entries."""
from pathlib import Path
import json
delivery=Path(__file__).resolve().parents[1];dev=delivery.parent
web=dev/'copypaste-web';desktop=dev/'copypaste-desktop';backend=dev/'copypaste-platform'
for name in ['editable-projects.tsx','editable-projects.css','design-production-model.ts','design-resource-picker.tsx','design-template-start.tsx']:
 text=(web/'src'/name).read_text('utf-8').replace('import { browserCrypto as crypto } from "./browser-crypto";\n','')
 if name.endswith('.css'):text=text.replace('var(--text,#282724)','var(--ink,#282724)')
 (desktop/'renderer/src'/name).write_text(text,encoding='utf-8',newline='\n')
 if name.endswith('.css'):(web/'src'/name).write_text(text,encoding='utf-8',newline='\n')
test=(web/'tests/design-production-200.test.ts').read_text('utf-8').replace('../src/','../renderer/src/')
(desktop/'tests/design-production-200.test.ts').write_text(test,encoding='utf-8',newline='\n')
for old,new in [('brand-production-189-v2','brand-production-189-v3'),('dedicated-cloud-189-v2','dedicated-cloud-189-v3'),('workspace-completion-196-v2','workspace-completion-196-v3')]:
 source=backend/'tests'/(old+'.test.ts');target=backend/'tests'/(new+'.test.ts');assert not target.exists()
 text=source.read_text('utf-8').replace('./route-inventory-189-v2.js','./route-inventory-200-v1.js')
 text=text.replace('inventory.routes.length,740','inventory.routes.length,756').replace('inventory.routes.length,753','inventory.routes.length,756')
 target.write_text(text,encoding='utf-8',newline='\n')
for folder,version in [('copypaste-platform','0.5.8'),('copypaste-web','0.5.8'),('copypaste-desktop','0.7.12'),('copypaste-delivery','0.5.7')]:
 for name in ['package.json','package-lock.json']:
  p=dev/folder/name;x=json.loads(p.read_text('utf-8'));x['version']=version
  if 'packages' in x:x['packages']['']['version']=version
  p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'synchronized_product_files':5,'desktop_tests':1,'new_versioned_regression_entries':3,'desktop_version':'0.7.12'}))
