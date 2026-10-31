"""Immutable LAN frontend overlay; the frozen v0.1.3 bundle is preserved."""
from pathlib import Path
import hashlib, json, zipfile
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT/'dev/copypaste-delivery/.data/deployment-176'
archive = OUT/'workmate-lan-http-176-v2.zip'
assert not archive.exists()
rows = []
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for client in ['web', 'admin']:
        repo = ROOT/'dev'/('copypaste-'+client)
        files = [(p, client+'/'+p.relative_to(repo/'dist').as_posix()) for p in sorted((repo/'dist').rglob('*')) if p.is_file()]
        for folder in ['src', 'tests', 'public']:
            files += [(p, 'sources/'+client+'/'+p.relative_to(repo).as_posix()) for p in sorted((repo/folder).rglob('*')) if p.is_file()]
        files += [(p, 'sources/'+client+'/'+p.name) for p in sorted(repo.iterdir()) if p.is_file() and (p.name.startswith(('package', 'tsconfig', 'vite.config', 'README')) or p.name=='index.html')]
        for p, name in files:
            raw = p.read_bytes(); z.writestr(name, raw)
            rows.append({'path': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    manifest = {'stage':176, 'base_release':'v0.1.3', 'increment':'lan-http-176-v2', 'files':rows,
        'tests':{'http_crypto_cases':8, 'passed':8, 'web_build':'passed', 'admin_build':'passed'}}
    z.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
sha = hashlib.sha256(archive.read_bytes()).hexdigest()
with archive.with_suffix('.zip.sha256').open('x',encoding='utf-8',newline='\n') as f:f.write(sha+'  '+archive.name+'\n')
print(json.dumps({'archive':archive.name,'bytes':archive.stat().st_size,'sha256':sha,'files':len(rows)}))
