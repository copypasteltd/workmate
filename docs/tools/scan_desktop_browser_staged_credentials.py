"""Check exact configured credential literals in the concrete staged blobs."""
from datetime import datetime,timezone
from hashlib import sha1,sha256
import argparse
import json
from pathlib import Path
import re
import subprocess
from audit_workmate_publication import MAP,ROOT,configured_credentials,git

parser=argparse.ArgumentParser()
parser.add_argument('--report',default='desktop-browser-staged-credentials-01.json')
report_name=parser.parse_args().report
assert re.fullmatch(r'desktop-browser-staged-credentials-\d{2}\.json',report_name)
needles=configured_credentials()
checked=0
seen=set()
repository_counts=[]
for branch,repo in MAP.items():
    names=[raw.decode('utf-8') for raw in git(repo,'diff','--cached','--name-only','--diff-filter=ACM','-z').split(b'\0') if raw]
    index={}
    for entry in git(repo,'ls-files','--stage','-z').split(b'\0'):
        if not entry:
            continue
        metadata,separator,name=entry.partition(b'\t')
        mode,oid,stage=metadata.split()
        assert separator and stage==b'0','Only resolved index entries may be published'
        index[name.decode('utf-8')]=oid.decode('ascii')
    objects={}
    for name in names:
        oid=index[name]
        if oid not in seen:
            objects.setdefault(oid,name)
    if objects:
        request=('\n'.join(objects)+'\n').encode('ascii')
        result=subprocess.run(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','cat-file','--batch'],cwd=repo,input=request,capture_output=True)
        assert result.returncode==0,'Could not read the selected staged objects'
        output=result.stdout
        offset=0
        for oid,name in objects.items():
            end=output.index(b'\n',offset)
            actual,kind,size=output[offset:end].split()
            assert actual.decode('ascii')==oid and kind==b'blob'
            size=int(size)
            offset=end+1
            content=output[offset:offset+size]
            assert len(content)==size and output[offset+size:offset+size+1]==b'\n'
            algorithm=sha1 if len(oid)==40 else sha256
            assert algorithm(b'blob '+str(size).encode('ascii')+b'\0'+content).hexdigest()==oid
            assert not any(secret in content for secret in needles),(branch,name,'Configured credential in staged content')
            offset+=size+1
            seen.add(oid)
        assert offset==len(output),'Unexpected trailing Git object data'
    checked+=len(names)
    repository_counts.append({'repository':branch,'staged_files':len(names),'new_unique_blobs_scanned':len(objects)})
assert checked>0
result={'at':datetime.now(timezone.utc).isoformat(),'status':'passed','staged_files_checked':checked,'unique_blobs_checked':len(seen),'repository_counts':repository_counts,'repositories':len(MAP),'scope':'Exact local configured credential literals in all staged added/copied/modified files before committing. Repeated source archives share content-addressed Git blobs; each unique body is read with cat-file --batch and its Git object digest is verified before scanning. Canonical history and signature/path/media audit runs separately before push; this is not a complete security certification.','configured_values_or_matches_printed':False,'verifier_sha256':sha256(Path(__file__).read_bytes()).hexdigest()}
with (ROOT/'docs/quality'/report_name).open('x',encoding='utf-8') as stream:
    stream.write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'passed','staged_files':checked,'configured_values_printed':False}))
