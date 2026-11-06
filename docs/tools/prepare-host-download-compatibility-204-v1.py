"""Use Python3.10-compatible streamed hashes; preserve the original probe."""
from pathlib import Path
import ast,json
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts'
s=(S/'qualify-public-download-host-204-v1.sh').read_text('utf-8-sig').replace('public-download-host-v1','public-download-host-v2')
needle="  digest=hashlib.file_digest(target.open('rb'),'sha256').hexdigest() if target.exists() else None"
replacement="""  digest=None
  if target.exists():
   h=hashlib.sha256()
   with target.open('rb') as f:
    for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
   digest=h.hexdigest()"""
assert s.count(needle)==1;s=s.replace(needle,replacement)
s=s.replace("finally:report['finished_at']", "except Exception:report['status']='failed';raise\nfinally:report['finished_at']")
needle="print(json.dumps({'status':report['status'],'receipt':str(out/'receipt.sanitized.json'),'network_configuration_changed':False}),flush=True)"
assert s.count(needle)==1;s=s.replace(needle,'print(json.dumps(report),flush=True)')
ast.parse(s.split("<<'PY'\n",1)[1].rsplit('\nPY',1)[0],feature_version=(3,10))
with (S/'qualify-public-download-host-204-v2.sh').open('x',encoding='utf-8',newline='\n') as f:f.write(s)
print(json.dumps({'status':'prepared','python_target':'3.10','application_or_network_changes':False}))
