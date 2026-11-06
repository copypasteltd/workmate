"""Check runtime entries; development inspection scripts are not service entries."""
from pathlib import Path
import ast,json
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts'
text=(S/'bundle-integrated-204-v2.py').read_text('utf-8')
start=text.index('relative={component+');end=text.index("archive=out/",start)
closure='''relative={component+'/'+p.relative_to(base).as_posix() for component,base,p in sources}
modules={component+'/'+p.relative_to(base).as_posix():p for component,base,p in sources if component=='backend' and p.suffix in ['.js','.mjs','.cjs'] and p.relative_to(base).parts[0]=='dist'}
pending=[rel for rel in modules if rel.startswith('backend/dist/src/')]+['backend/dist/scripts/migration-runner.js'];seen=set();imports=[]
while pending:
 rel=pending.pop()
 if rel in seen:continue
 seen.add(rel);assert rel in modules,rel
 for match in re.finditer(r"(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*)[\\\"'](\\.[^\\\"']+)[\\\"']",modules[rel].read_text('utf-8')):
  target=posixpath.normpath(posixpath.join(posixpath.dirname(rel),match[1]));assert target in relative,(rel,match[1],target)
  imports.append({'from':rel,'to':target})
  if target in modules:pending.append(target)
assert 'backend/dist/contracts/task-schemas.json' in relative and len(imports)>100
'''
text=text[:start]+closure+text[end:]
text=text.replace('integrated-204-v2.zip','integrated-204-v3.zip').replace('candidate-manifest-v2.json','candidate-manifest-v3.json')
ast.parse(text)
with (S/'bundle-integrated-204-v3.py').open('x',encoding='utf-8',newline='\n') as f:f.write(text)
text=(S/'upload-integrated-204-v2.py').read_text('utf-8').replace('integrated-204-v2.zip','integrated-204-v3.zip').replace('workmate-upload-204-v2','workmate-upload-204-v3')
with (S/'upload-integrated-204-v3.py').open('x',encoding='utf-8',newline='\n') as f:f.write(text)
p=S/'stage-integrated-204-v2.sh';text=p.read_text('utf-8');assert 'workmate-upload-204-v2/integrated-204-v2.zip' in text
p.write_text(text.replace('workmate-upload-204-v2/integrated-204-v2.zip','workmate-upload-204-v3/integrated-204-v3.zip'),encoding='utf-8',newline='\n')
print(json.dumps({'status':'all_compiled_service_modules_and_migration_entry_closure_prepared'}))
