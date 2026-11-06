"""Package every runtime directory and verify static import closure before staging."""
from pathlib import Path
import ast,json
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts'
def fresh(name,text):
 with (S/name).open('x',encoding='utf-8',newline='\n') as f:f.write(text)
bundle=(S/'bundle-integrated-204-v1.py').read_text('utf-8')
bundle=bundle.replace('import hashlib,json,zipfile','import hashlib,json,zipfile,re,posixpath')
bundle=bundle.replace("['src','dist/src','dist/scripts','dist/assets','migrations','scripts','contracts']","['src','dist','migrations','scripts','contracts']")
bundle=bundle.replace("and 'node_modules' not in p.relative_to(base).parts)","and 'node_modules' not in p.relative_to(base).parts and p.relative_to(base).parts[:2]!=('dist','tests'))")
bundle=bundle.replace('integrated-204-v1.zip','integrated-204-v2.zip').replace('candidate-manifest.json','candidate-manifest-v2.json')
anchor="archive=out/'integrated-204-v2.zip';assert not archive.exists()"
assert anchor in bundle
closure='''relative={component+'/'+p.relative_to(base).as_posix() for component,base,p in sources}
imports=[]
for component,base,p in sources:
 if component=='backend' and p.relative_to(base).parts[0]=='dist' and p.suffix in ['.js','.mjs','.cjs']:
  for match in re.finditer(r"(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*)[\\\"'](\\.[^\\\"']+)[\\\"']",p.read_text('utf-8')):
   rel=posixpath.normpath(posixpath.join(component,p.relative_to(base).parent.as_posix(),match[1]));assert rel in relative,(str(p),match[1],rel)
   imports.append({'from':component+'/'+p.relative_to(base).as_posix(),'to':rel})
assert 'backend/dist/contracts/task-schemas.json' in relative and len(imports)>100
'''
bundle=bundle.replace(anchor,closure+anchor).replace("'schema_version':165,'files':files","'schema_version':165,'static_runtime_imports':imports,'files':files")
ast.parse(bundle);fresh('bundle-integrated-204-v2.py',bundle)
upload=(S/'upload-integrated-204-v1.py').read_text('utf-8').replace('integrated-204-v1.zip','integrated-204-v2.zip').replace('workmate-upload-204-v1','workmate-upload-204-v2')
ast.parse(upload);fresh('upload-integrated-204-v2.py',upload)
stage=(S/'stage-integrated-204-v1.sh').read_text('utf-8')
stage=stage.replace(".strip()==str(previous)",".strip()=='/opt/workmate/overlays/integrated-204-v1/rollback-compatible-backend-v2'")
stage=stage.replace("dest=Path('/opt/workmate/overlays/integrated-204-v1')","dest=Path('/opt/workmate/overlays/integrated-204-v2')")
stage=stage.replace('workmate-upload-204-v1/integrated-204-v1.zip','workmate-upload-204-v2/integrated-204-v2.zip')
ast.parse(stage.split("python3 - <<'PY'\n",1)[1].rsplit('\nPY',1)[0]);fresh('stage-integrated-204-v2.sh',stage)
read=(S/'read-deployment-204-v2.sh').read_text('utf-8').replace('activation-v2/','activation-v3/')
fresh('read-deployment-204-v3.sh',read)
collector=S/'collect-final-service-state-204-v1.sh';text=collector.read_text('utf-8');assert '/opt/workmate/overlays/integrated-204-v1' in text
collector.write_text(text.replace('/opt/workmate/overlays/integrated-204-v1','/opt/workmate/overlays/integrated-204-v2'),encoding='utf-8',newline='\n')
doc=R/'docs/tools/document-integrated-round-204-v1.py';text=doc.read_text('utf-8')
text=text.replace('deploy-steps-v2/read-deployment.stdout.log','deploy-steps-v3/read-deployment.stdout.log')
text=text.replace("'continuation':load(L/'.data/deployment-204-v1/deploy-steps-v2/receipt.json')", "'backup_continuation':load(L/'.data/deployment-204-v1/deploy-steps-v2/receipt.json'),'corrected_runtime_package':load(L/'.data/deployment-204-v1/deploy-steps-v3/receipt.json')")
text=text.replace("'initial_failure':'System pg_dump14", "'runtime_package_failure':'Compiled dist/contracts was omitted in the first archive; complete runtime directories/static import closure and a healthy pre-cutover candidate are required in the corrected package.','initial_failure':'System pg_dump14")
doc.write_text(text,encoding='utf-8',newline='\n')
print(json.dumps({'status':'whole_runtime_package_correction_prepared','product_source_unchanged':True,'new_overlay':'integrated-204-v2'}))
