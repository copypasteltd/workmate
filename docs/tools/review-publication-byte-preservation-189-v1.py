"""Preserve qualified raw bytes through narrow Git attributes before staging."""
from pathlib import Path
from hashlib import sha1,sha256
from datetime import datetime,timezone
import json,subprocess
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';P=DEV/'copypaste-delivery/.data/deployment-189'
REPORT=ROOT/'docs/quality/live-acceptance-189.json';PATHS=P/'publication-paths.json'
REVIEW=ROOT/'docs/quality/live-acceptance-189/publication-byte-review.json'
COMP={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery','docs':None}
def digest(p):return sha256(p.read_bytes()).hexdigest()
def save(p,value):p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def git(repo,*args,payload=None):return subprocess.check_output(['git','-c','core.fsmonitor=false','-C',str(repo),*args],input=payload,cwd=repo)
assert not REVIEW.exists()
report=json.loads(REPORT.read_bytes());paths=json.loads(PATHS.read_bytes())
for name,h in report['sources'].items():assert digest(ROOT/name)==h,name
changed={}
for branch,short in COMP.items():
 repo=ROOT if short is None else DEV/('copypaste-'+short)
 assert not git(repo,'diff','--cached','--name-only').strip(),'Preserve any existing user index.'
 filtered=git(repo,'hash-object','--stdin-paths',payload=('\n'.join(paths[branch])+'\n').encode()).decode().splitlines()
 preserve=[]
 for name,oid in zip(paths[branch],filtered,strict=True):
  raw=(repo/name).read_bytes();exact=sha1(('blob '+str(len(raw))+'\0').encode()+raw).hexdigest()
  if exact!=oid:preserve.append(name)
 if preserve:
  assert branch!='desktop','Frozen Desktop attributes must remain unchanged.'
  attributes=repo/'.gitattributes';original=attributes.read_bytes()
  with (P/('attributes-'+branch+'.before-byte-review-v1')).open('xb') as f:f.write(original)
  assert all('\n' not in n and ' ' not in n for n in preserve)
  attributes.write_bytes(original+b'\n# Stage189 exact qualified source bytes.\n'+''.join(n+' -text whitespace=cr-at-eol\n' for n in preserve).encode())
  paths[branch]=sorted(set(paths[branch])|{'.gitattributes'});report['sources'][attributes.relative_to(ROOT).as_posix()]=digest(attributes)
  changed[branch]={'paths':preserve,'previous_attributes_sha256':sha256(original).hexdigest(),'attributes_sha256':digest(attributes)}
value={'stage':189,'at':datetime.now(timezone.utc).isoformat(),'changes':changed,'executed_sources_modified':False,'desktop_attributes_modified':False,'scope':'Keep already-qualified CRLF source bytes intact in fresh clones; do not rewrite executed scripts.'}
save(REVIEW,value);paths['docs']=sorted(set(paths['docs'])|{REVIEW.relative_to(ROOT).as_posix()})
report['sources'][REVIEW.relative_to(ROOT).as_posix()]=digest(REVIEW);save(REPORT,report);save(PATHS,paths)
print(json.dumps({'status':'exact_source_bytes_preserved','attribute_changes':list(changed)}))
