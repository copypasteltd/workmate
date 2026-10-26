"""Freeze an unchanged attempt's exact inputs before any subsequent source edit."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import json
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
name=sys.argv[1]
assert re.fullmatch(r'client-content-(core|ui)-\d{2}',name)
report=DEV/'copypaste-delivery/evidence'/ (name+'.json')
data=json.loads(report.read_text(encoding='utf-8'))
archive=report.with_name(name+'-sources')
def preserve(entry):
    name,expected=entry
    relative=Path(name);assert not relative.is_absolute() and '..' not in relative.parts
    file=DEV/relative
    target=archive/relative
    # Windows resolve() can add an extended-length prefix only to long child
    # paths. Normalize that representation before comparing the same root.
    resolved=Path(str(target.resolve()).removeprefix('\\\\?\\'))
    assert resolved.is_relative_to(archive.resolve()),name
    if target.exists():assert sha256(target.read_bytes()).hexdigest()==expected;return
    content=file.read_bytes();assert sha256(content).hexdigest()==expected,name
    target.parent.mkdir(parents=True,exist_ok=True)
    with target.open('xb') as out:out.write(content)
with ThreadPoolExecutor(max_workers=12) as pool:list(pool.map(preserve,data['source_files'].items()))
print(json.dumps({'attempt':name,'exact_source_files':len(data['source_files']),'status':'preserved'}))
