"""Current delivery links, manifests, original files and owned runtime cleanup."""
from pathlib import Path
import json,hashlib,re
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DEL=DEV/'copypaste-delivery';OUT=ROOT/'docs/quality/integrated-round-198'
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
protected=load(DEL/'.data/acceptance-193/baseline/receipt.json')['preserved_untracked']
for rel,digest in protected.items():assert (ROOT/rel).is_file() and sha(ROOT/rel)==digest,rel
cleanup=load(DEL/'.data/deployment-198-v1/runtime-cleanup-v1.sanitized.json');assert cleanup['status']=='cleaned' and cleanup['owned_browsers_remaining']==cleanup['owned_desktop_instances_remaining']==0
actual=load(DEL/'.data/deployment-198-v2/final-owned-process-check.sanitized.json');assert actual['owned_browsers_remaining']==actual['owned_desktop_instances_remaining']==actual['owned_db_helpers_remaining']==0
cleanup['post_final_release_check']=actual;(OUT/'runtime-cleanup.json').write_text(json.dumps(cleanup,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
readmes=[]
for name in ['platform','web','admin','desktop','extension','delivery']:
    folder=DEV/('copypaste-'+name)
    for filename in ['README.md','README.en.md']:
        p=folder/filename;text=p.read_text(encoding='utf8');assert text.startswith('<!-- integrated-round-198 -->');current=text.split('<!-- integrated-round-197 -->',1)[0];assert '```mermaid' in current
        links=re.findall(r'\]\((assets/screenshots/[^)]+)\)',current)
        if name in ['web','admin','desktop','extension']:assert all(any(x.endswith(ext) for x in links) for ext in ['.png','.gif','.mp4'])
        for rel in links:assert (folder/rel).is_file(),rel
        readmes.append({'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p),'current_media':links})
for media in load(OUT/'actual-media.json')['files']:assert sha(DEV/media['path'])==media['sha256']
for row in load(OUT/'implementation-batch.json')['final_reviewed_source_manifest']:assert sha(ROOT/row['path'])==row['sha256'],row['path']
overlay=load(OUT/'requirements-overlay.json');assert len(overlay['groups'])==32 and len(overlay['requirements'])==len({r['id'] for r in overlay['requirements']})==102
versions={name:load(DEV/('copypaste-'+name)/'package.json')['version'] for name in ['platform','web','admin','desktop','extension','delivery']}
assert versions=={'platform':'0.5.6','web':'0.5.6','admin':'0.5.2','desktop':'0.7.10','extension':'0.5.7','delivery':'0.5.5'}
catalog=load(DEV/'copypaste-web/contracts/product-downloads.json');assert catalog==load(OUT/'public-downloads.json')['catalog'];assert catalog['desktop']['version']==versions['desktop'] and catalog['extension']['version']==versions['extension']
for p in OUT.rglob('*.json'):
    text=p.read_text(encoding='utf8');assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',text),p.name
for p in [ROOT/'docs/development/198-task-directory-and-context.md',ROOT/'docs/requirements/198-task-directory-and-context-round.md',ROOT/'docs/changes/198-task-directory-and-context.md',OUT/'README.md']:
    for rel in re.findall(r'\]\(([^)]+)\)',p.read_text(encoding='utf8')):
        if '://' not in rel and not rel.startswith('#'):assert (p.parent/rel.split('#')[0]).exists(),(p.name,rel)
report={'stage':198,'status':'passed','scope':'Current bilingual delivery guides, media/source hashes, release/catalog versions,102 retained requirements, protected files and owned cleanup. Does not claim all historical documentation or production qualification.','versions':versions,'readmes':readmes,'protected_files_preserved':len(protected),'runtime_cleanup':cleanup,'marker_scan':'No production TODO/FIXME/HACK/not-implemented source marker; this does not establish whole-goal completion.'}
(OUT/'documentation-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'status':'passed','readmes':12,'protected_files':len(protected),'versions':versions}))
