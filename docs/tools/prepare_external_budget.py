"""Freeze the published Stage112 boundary before controlled Google Ads budget operations."""
from pathlib import Path
from hashlib import sha256
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'dev/copypaste-delivery/.data/preparation/external-budget-113'
assert not OUT.exists(), 'Never overwrite preparation evidence'
rows = {}
for repo in [ROOT, *(ROOT/'dev'/('copypaste-'+n) for n in ['platform','web','admin','desktop','extension','delivery'])]:
    def git(*args):
        return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false',*args],cwd=repo)
    assert not git('status','--porcelain','-uno').strip(), str(repo)
    names = git('ls-files','-z','--','src','renderer','tests','scripts','migrations','catalog','contracts','skills','public','renderer-source.json','package.json','package-lock.json','tsconfig.json','vite.config.ts','README.md','README.en.md').split(b'\0')
    sources = {}
    for raw in names:
        if not raw: continue
        name=raw.decode('utf-8'); data=(repo/name).read_bytes(); sources[name]=sha256(data).hexdigest()
        target=OUT/repo.name/name; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
    rows[repo.name]={'head':git('rev-parse','HEAD').decode().strip(),'sources':sources}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'receipt.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'repositories':len(rows),'sources':sum(len(v['sources']) for v in rows.values())}))
