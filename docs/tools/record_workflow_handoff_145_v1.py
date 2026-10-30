"""Bind exact workflow sources, immutable attempts, actual media and Git bytes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
from concurrent.futures import ThreadPoolExecutor
import argparse,json,re
from record_business_history_144_v1 import check_sources
from record_source_build_reproduction_v1 import credentials,scan
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery'
RAW=DELIVERY/'evidence/workflow-handoff-145';OUT=ROOT/'docs/quality/workflow-handoff-evidence-145';CP=ROOT/'docs/quality/workflow-handoff-checkpoint-145.json'
PREVIOUS=DELIVERY/'.data/business-history-144/publication-231194c2-09b2-4b47-a296-38af3e1a64d0/receipt.json'
sha=lambda b:sha256(b).hexdigest()
read=lambda p:json.loads(p.read_bytes())
encoded=lambda v:(json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode()
ref=lambda p:{'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p.read_bytes())}
def report(stem):
    r=read(RAW/(stem+'.json'))
    for key in ['source_manifest','raw_report','verifier']:
        item=r[key];assert sha((DELIVERY/item['path']).read_bytes())==item['sha256']
    return r,read(DELIVERY/r['source_manifest']['path'])
def passed(r):
    assert r['status']=='passed' and r['source_unchanged'] and r['result_exit_code']==0
    assert r['owned_database_shutdown'] and r['owned_database_port_closed']
    assert r['fixture_cleanup']['status']=='passed' and r['fixture_cleanup']['exit_code']==0
    assert all(x['exit_code']==0 for x in r['checks'])
def record(backend,ui):
    assert not CP.exists() and not OUT.exists()
    selected={'backend':'backend-'+backend,'ui':'ui-'+ui}
    b,bs=report(selected['backend']);u,us=report(selected['ui']);passed(b);passed(u)
    differences=[n for n,v in bs.items() if n in us and not n.startswith('copypaste-delivery/') and us[n]['sha256']!=v['sha256']]
    assert differences==['copypaste-web/src/style.css'],'Only the independently browser-qualified narrow-navigation CSS changed after backend acceptance'
    journey=read(DELIVERY/u['journey']['path']);assert ref(DELIVERY/u['journey']['path'])['sha256']==u['journey']['sha256']
    assert journey['status']=='passed' and len(journey['checks'])==7 and len(journey['screenshots'])==7
    assert all(journey[k] for k in ['browser_closed','api_closed','fixture_closed'])
    assert len(journey['layouts'])==3 and all(x['page']<=x['viewport']+1 for x in journey['layouts'])
    assert len(journey['recordings'])==2 and all(x['distinct_frames']>1 and x['skipped_capture_errors']==0 for x in journey['recordings'])
    assert len(journey['downloads'])==1 and journey['downloads'][0]['complete_original_text'] and journey['downloads'][0]['bytes']==83299
    media=[*journey['screenshots'],*[f for r in journey['recordings'] for f in r['files']]]
    sources={'dev/'+k:v['sha256'] for k,v in us.items() if not k.startswith('copypaste-delivery/')}
    sources['dev/copypaste-desktop/.gitattributes']='82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e'
    extra={'dev/'+k:v['sha256'] for k,v in us.items() if k.startswith('copypaste-delivery/')}
    for filename in [*[f'scripts/qualify-workflow-handoff-145-v{n}.mjs' for n in range(1,6)],
                     'scripts/qa-workflow-handoff-145-v1.ts','scripts/qa-workflow-handoff-145-v2.ts',
                     'package.json','package-lock.json','tsconfig.json','.gitattributes']:
        p=DELIVERY/filename;extra[p.relative_to(ROOT).as_posix()]=sha(p.read_bytes())
    for name,digest in {**sources,**extra}.items():assert sha((ROOT/name).read_bytes())==digest,name
    previous=read(PREVIOUS);assert previous['status']=='pushed_and_verified' and previous['remote_after']['docs']=='4eae6a95082fbf73f56cdea051f911f543c9ca3b'
    # Validate every original attempt and distinct frozen source object once.
    objects={}
    for p in RAW.glob('*-sources.json'):
        for item in read(p).values():
            assert item['path'] not in objects or objects[item['path']]==item['sha256'];objects[item['path']]=item['sha256']
    def check(item):name,digest=item;assert sha((DELIVERY/name).read_bytes())==digest
    with ThreadPoolExecutor(max_workers=16) as pool:list(pool.map(check,objects.items()))
    for p in RAW.glob('*.json'):
        if re.fullmatch(r'(backend|ui)-\d{2}\.json',p.name):report(p.stem)
    OUT.mkdir(parents=True);originals=[];needles=credentials()
    def retain(p):
        body=p.read_bytes();digest=sha(body);archive='blobs/'+digest+'.blob';target=OUT/archive
        scan(p.relative_to(ROOT).as_posix(),body,needles);target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():assert target.read_bytes()==body
        else:
            with target.open('xb') as f:f.write(body)
        item={'source':p.relative_to(ROOT).as_posix(),'archive':archive,'sha256':digest,'bytes':len(body)};originals.append(item);return item
    attempts=[]
    for p in sorted(RAW.rglob('*')):
        if not p.is_file() or 'objects' in p.relative_to(RAW).parts:continue
        retain(p)
        if re.fullmatch(r'(backend|ui)-\d{2}\.json',p.name):attempts.append({'source':p.relative_to(ROOT).as_posix(),'status':read(p)['status']})
    retain(ROOT/'docs/quality/workflow-handoff-qualifier-startup-145-01.json')
    retain(ROOT/'docs/quality/workflow-handoff-test-selection-145.json')
    for p in RAW.glob('ui-??-journey.json'):
        j=read(p)
        for item in [*j['screenshots'],*[f for r in j['recordings'] for f in r['files']]]:retain(DEV/item['path'])
    copies=read(ROOT/'docs/quality/workflow-handoff-media-copies-145.json');retain(ROOT/'docs/quality/workflow-handoff-media-copies-145.json')
    for item in copies:
        assert sha((ROOT/item['path']).read_bytes())==item['sha256']==sha((ROOT/item['source']).read_bytes());retain(ROOT/item['path'])
    prior=retain(PREVIOUS);retain(PREVIOUS.with_name('commands.log'));retain(ROOT/previous['incremental_history_and_links']['path'])
    index={'at':datetime.now(timezone.utc).isoformat(),'recorder_sha256':sha(Path(__file__).read_bytes()),'originals':originals,'attempts':attempts}
    with (OUT/'index.json').open('xb') as f:f.write(encoded(index))
    log=(DELIVERY/b['raw_report']['path']).read_text(encoding='utf-8')
    counts=[int(n) for n in re.findall(r'^# tests (\d+)\r?$',log,re.M)];failures=[int(n) for n in re.findall(r'^# fail (\d+)\r?$',log,re.M)]
    assert counts==[12,39] and failures==[0,0]
    value={'at':datetime.now(timezone.utc).isoformat(),'status':'verified_workflow_handoff_slice','selected_attempts':selected,
      'evidence_index':ref(OUT/'index.json'),'source_files':sources,'qualification_sources':extra,'media_files':media,'shared_media_copies':copies,
      'previous_publication_receipt':prior,'backend_case_counts':counts,'ui_checks':journey['checks'],'git_source_proofs':check_sources(sources,extra),
      'backend_vs_ui_source_differences':differences,'difference_scope':'Only narrow-navigation CSS; the final actual Web journey requalifies it. Backend and trusted Desktop runtime sources are identical.',
      'historical_attempts':attempts,'scope':'Exact private cloud/native workflow handoffs and known settled-failure review. Actual Web controls and downloads with explicitly synthetic models; not full native Codex/OS or production acceptance.',
      'new_full_acceptance_closures':0,'recorder_sha256':sha(Path(__file__).read_bytes())}
    with CP.open('xb') as f:f.write(encoded(value))
    print(json.dumps({'status':'recorded','sources':len(sources),'originals':len(originals),'targeted_cases':sum(counts),'ui_checks':len(journey['checks'])}))
def verify():
    cp,index=read(CP),read(OUT/'index.json');assert cp['status']=='verified_workflow_handoff_slice'
    assert cp['evidence_index']==ref(OUT/'index.json') and cp['recorder_sha256']==index['recorder_sha256']==sha(Path(__file__).read_bytes())
    needles=credentials()
    for item in index['originals']:
        body=(OUT/item['archive']).read_bytes();assert len(body)==item['bytes'] and sha(body)==item['sha256'];scan(item['source'],body,needles)
    for name,digest in {**cp['source_files'],**cp['qualification_sources']}.items():assert sha((ROOT/name).read_bytes())==digest,name
    for item in cp['media_files']:assert sha((DEV/item['path']).read_bytes())==item['sha256']
    for item in cp['shared_media_copies']:assert sha((ROOT/item['path']).read_bytes())==item['sha256']==sha((ROOT/item['source']).read_bytes())
    for stem in cp['selected_attempts'].values():r,_=report(stem);passed(r)
    assert check_sources(cp['source_files'],cp['qualification_sources'])==cp['git_source_proofs']
    return {'status':'passed','source_files':len(cp['source_files']),'backend_cases':sum(cp['backend_case_counts']),'ui_checks':len(cp['ui_checks']),
      'media_files':len(cp['media_files']),'originals':len(index['originals']),'new_full_acceptance_closures':0}
if __name__=='__main__':
    p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True);g.add_argument('--record',action='store_true');g.add_argument('--verify',action='store_true');p.add_argument('--backend');p.add_argument('--ui');a=p.parse_args()
    if a.record:record(a.backend,a.ui)
    else:print(json.dumps(verify()))
