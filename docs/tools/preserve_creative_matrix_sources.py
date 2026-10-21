"""Recover earlier executed sources only when their recorded byte hash matches."""
from pathlib import Path
from hashlib import sha256
import json
import subprocess

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
DELIVERY=DEV/'copypaste-delivery'
EVIDENCE=DELIVERY/'evidence'
sha=lambda b:sha256(b).hexdigest()
read=lambda p:json.loads(p.read_text(encoding='utf-8'))


def main():
    available={}
    reconstruction_origins=set()
    previous=EVIDENCE/'creative-matrix-source-recovery.json'
    if previous.exists():
        for file in read(previous)['files']:
            path=ROOT/file['path'];assert sha(path.read_bytes())==file['sha256'];available.setdefault(file['sha256'],path)
            if file['recovery_method']=='reconstructed_exact_hash_not_contemporaneous':reconstruction_origins.add(file['sha256'])
    historical=ROOT/'docs/quality/history/stage59-initial-scan/source-recovery.json.snapshot'
    if historical.exists():
        for file in read(historical)['files']:
            if file['recovery_method']=='reconstructed_exact_hash_not_contemporaneous':reconstruction_origins.add(file['sha256'])
    for manifest in EVIDENCE.glob('creative-matrix-*-sources.json'):
        for component in read(manifest).values():
            for file in component['files']:
                path=DELIVERY/file['path'];assert sha(path.read_bytes())==file['sha256'];available.setdefault(file['sha256'],path)
    for path in EVIDENCE.glob('creative-matrix-*-verifier.*'):
        available.setdefault(sha(path.read_bytes()),path)
    # Earlier UI 03 differs from final only in the explicit submission bound.
    # This is a hash-checked reconstruction, not a contemporaneous snapshot.
    current=(DEV/'copypaste-web/src/creative-matrices.tsx').read_bytes()
    reconstructed=current.replace(b'      submitDisabled={count < 1 || count > 60 || selectedSizes.length > 10}\r\n',b'').replace(b'      submitDisabled={count < 1 || count > 60 || selectedSizes.length > 10}\n',b'')
    recovered=[]
    for report in sorted(EVIDENCE.glob('creative-matrix-*.json')):
        data=read(report);sources={}
        if 'component_sources' in data:
            sources={f'copypaste-{component}/{name}':h for component,files in data['component_sources'].items() for name,h in files.items()}
        elif isinstance(data.get('source_files'),dict):
            sources={name:h for name,h in data['source_files'].items() if name.startswith(('copypaste-','docs/'))}
        for name,expected in sources.items():
            target=ROOT/name if name.startswith('docs/') else DEV/name
            if target.is_file() and sha(target.read_bytes())==expected:continue
            if expected in available:
                source=available[expected];method='existing_exact_preimage'
            else:
                repo_name,relative=name.split('/',1);repo=DEV/repo_name
                if repo.is_dir():
                    p=subprocess.run(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',str(repo),'show','HEAD:'+relative],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
                    baseline=p.stdout if p.returncode==0 else b''
                else:baseline=b''
                if sha(baseline)==expected:
                    content=baseline;method='exact_git_baseline'
                elif name=='copypaste-web/src/creative-matrices.tsx' and sha(reconstructed)==expected:
                    content=reconstructed;method='reconstructed_exact_hash_not_contemporaneous'
                elif name=='copypaste-delivery/scripts/package-creative-matrix-clients.mjs' and sha(target.read_bytes().replace(b'release/matrices-59-02/',b'release/matrices-59/'))==expected:
                    content=target.read_bytes().replace(b'release/matrices-59-02/',b'release/matrices-59/');method='reconstructed_exact_hash_not_contemporaneous'
                else:raise AssertionError('Missing executed bytes: '+report.name+':'+name+':'+expected)
                source=EVIDENCE/'creative-matrix-source-recovery'/expected/Path(name).name
                source.parent.mkdir(parents=True,exist_ok=True)
                if source.exists():assert source.read_bytes()==content
                else:source.write_bytes(content)
                available[expected]=source
            # Retention on a later run does not turn a reconstruction into a
            # contemporaneous capture. Keep that provenance visible forever.
            if name=='copypaste-web/src/creative-matrices.tsx' and sha(reconstructed)==expected:
                method='reconstructed_exact_hash_not_contemporaneous'
            if name=='copypaste-delivery/scripts/package-creative-matrix-clients.mjs' and sha(target.read_bytes().replace(b'release/matrices-59-02/',b'release/matrices-59/'))==expected:
                method='reconstructed_exact_hash_not_contemporaneous'
            if expected in reconstruction_origins:
                method='reconstructed_exact_hash_not_contemporaneous'
            recovered.append({'report':report.relative_to(ROOT).as_posix(),'source':name,'path':source.relative_to(ROOT).as_posix(),'sha256':expected,'recovery_method':method})
    path=EVIDENCE/'creative-matrix-source-recovery.json'
    result={'scope':'Exact hash recovery of superseded executed inputs; reconstructed inputs are explicitly distinguished from contemporaneous snapshots','files':recovered}
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'status':'passed','recovered_bindings':len(recovered),'unique_preimages':len({r['sha256'] for r in recovered})}))


if __name__=='__main__':main()
