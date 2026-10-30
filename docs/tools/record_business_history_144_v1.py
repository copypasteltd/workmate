"""Bind the business-history increment to immutable attempts, real media and exact Git bytes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import argparse, json, re, subprocess
from io import BytesIO
from record_source_build_reproduction_v1 import credentials, scan

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'; DELIVERY=DEV/'copypaste-delivery'
RAW=DELIVERY/'evidence/business-history-144'
OUT=ROOT/'docs/quality/business-history-evidence-144'
CP=ROOT/'docs/quality/business-history-checkpoint-144.json'
PREVIOUS=DELIVERY/'.data/editable-projects-143/publication-ab9a5139-649d-405c-ba1a-7abf0a2f3672/receipt.json'

def sha(b):return sha256(b).hexdigest()
def read(p):return json.loads(p.read_bytes())
def ref(p):return {'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p.read_bytes())}
def encoded(v):return (json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode()

def check_sources(sources,qualification):
    """Read only the exact selected Git blobs through one batch per component."""
    expected={**sources,**qualification};results=[]
    for component in ['platform','web','admin','desktop','extension','delivery']:
        repo=DEV/('copypaste-'+component);branch='backend' if component=='platform' else component
        def git(*args,input=None):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',str(repo),*args],input=input,stderr=subprocess.PIPE)
        prefix='dev/copypaste-'+component+'/'
        subset={n.removeprefix(prefix):d for n,d in expected.items() if n.startswith(prefix)}
        stream=BytesIO(git('cat-file','--batch',input=b''.join(('HEAD:'+n+'\n').encode() for n in subset)))
        protected=0
        for name,digest in subset.items():
            header=stream.readline().split();assert len(header)==3 and header[1]==b'blob',name
            body=stream.read(int(header[2]));assert stream.read(1)==b'\n'
            local=(repo/name).read_bytes();assert sha(local)==digest,name
            if component=='desktop' and name=='.gitattributes':
                assert digest=='82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e'
                assert sha(body)=='e6824c658275e637fcb7950dcabb8d5d7f9c2295592ba552c0ee8ca91ad22aa8' and local.replace(b'\r\n',b'\n')==body
                protected+=1
            else:assert sha(body)==digest,'Git bytes differ: '+component+'/'+name
        assert not stream.read() and not git('diff','--cached','--name-only','HEAD','--')
        results.append({'branch':branch,'commit':git('rev-parse','HEAD').decode().strip(),'exact_paths':len(subset)-protected,'protected_metadata_paths':protected})
    assert sum(x['exact_paths']+x['protected_metadata_paths'] for x in results)==len(expected)
    assert sum(x['protected_metadata_paths'] for x in results)==1
    return results

def report(stem):
    r=read(RAW/(stem+'.json'))
    for key in ['source_manifest','raw_report','verifier']:
        item=r[key];assert sha((DELIVERY/item['path']).read_bytes())==item['sha256']
    sources=read(DELIVERY/r['source_manifest']['path'])
    def check(entry):assert sha((DELIVERY/entry['path']).read_bytes())==entry['sha256']
    with ThreadPoolExecutor(max_workers=16) as pool:list(pool.map(check,sources.values()))
    return r,sources

def passed(r):
    assert r['status']=='passed' and r['source_unchanged'] and r['result_exit_code']==0
    assert r['owned_database_shutdown'] and r['owned_database_port_closed']
    assert r['fixture_cleanup']['status']=='passed' and r['fixture_cleanup']['exit_code']==0
    assert all(x['exit_code']==0 for x in r['checks'])

def record(backend,ui):
    assert not CP.exists() and not OUT.exists()
    selected={'backend':'backend-'+backend,'ui':'ui-'+ui}
    b,bs=report(selected['backend']);u,us=report(selected['ui']);passed(b);passed(u)
    partial,_=report('backend-02');assert partial['status']=='failed' and partial['source_unchanged']
    partial_log=(DELIVERY/partial['raw_report']['path']).read_text(encoding='utf-8')
    for label,total in [('tests',105),('pass',95),('fail',10)]:
        assert [int(n) for n in re.findall(r'^# '+label+r' (\d+)\r?$',partial_log,re.M)]==[total]
    for name,item in bs.items():
        if name.startswith('copypaste-platform/'):assert us[name]['sha256']==item['sha256'],name
    journey=read(DELIVERY/u['journey']['path'])
    assert ref(DELIVERY/u['journey']['path'])['sha256']==u['journey']['sha256']
    assert journey['status']=='passed' and len(journey['checks'])==9 and journey['model_calls']==0
    assert all(journey[k] for k in ['browser_closed','api_closed','fixture_closed'])
    assert len(journey['layouts'])==3 and all(x['width']<=x['viewport']+1 for x in journey['layouts'])
    assert len(journey['recordings'])==2 and all(x['distinct_frames']>1 and x['skipped_capture_errors']==0 for x in journey['recordings'])
    media=[*journey['screenshots'],*[f for r in journey['recordings'] for f in r['files']]]
    sources={'dev/'+k:v['sha256'] for k,v in us.items() if not k.startswith('copypaste-delivery/')}
    sources['dev/copypaste-desktop/.gitattributes']='82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e'
    extra={'dev/'+k:v['sha256'] for k,v in us.items() if k.startswith('copypaste-delivery/')}
    for filename in ['scripts/qualify-business-history-144-v1.mjs','scripts/qualify-business-history-144-v2.mjs',
                     'scripts/qualify-business-history-144-v3.mjs','package.json','package-lock.json','tsconfig.json','.gitattributes']:
        p=DELIVERY/filename;extra[p.relative_to(ROOT).as_posix()]=sha(p.read_bytes())
    for name,digest in {**sources,**extra}.items():assert sha((ROOT/name).read_bytes())==digest,name
    previous=read(PREVIOUS);assert previous['status']=='pushed_and_verified' and previous['remote_after']['docs']=='721ef60cf884c432d5c401aac564a14e53d14102'
    OUT.mkdir(parents=True);originals=[];needles=credentials()
    def retain(p):
        body=p.read_bytes();digest=sha(body);archive='blobs/'+digest+'.blob';target=OUT/archive
        scan(p.relative_to(ROOT).as_posix(),body,needles);target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():target.write_bytes(body)
        else:assert target.read_bytes()==body
        value={'source':p.relative_to(ROOT).as_posix(),'archive':archive,'sha256':digest,'bytes':len(body)};originals.append(value);return value
    attempts=[]
    for p in sorted(RAW.rglob('*')):
        if not p.is_file() or 'objects' in p.relative_to(RAW).parts:continue
        retain(p)
        if re.fullmatch(r'(backend|ui)-\d{2}\.json',p.name):attempts.append({'source':p.relative_to(ROOT).as_posix(),'status':read(p)['status']})
    for p in RAW.glob('ui-??-journey.json'):
        j=read(p)
        for item in [*j['screenshots'],*[f for r in j['recordings'] for f in r['files']]]:retain(DEV/item['path'])
    copies=read(ROOT/'docs/quality/business-history-media-copies-144.json')
    retain(ROOT/'docs/quality/business-history-media-copies-144.json')
    for item in copies:
        assert sha((ROOT/item['path']).read_bytes())==item['sha256']==sha((ROOT/item['source']).read_bytes())
        retain(ROOT/item['path'])
    prior=retain(PREVIOUS);retain(PREVIOUS.with_name('commands.log'));retain(ROOT/previous['incremental_history_and_links']['path'])
    index={'at':datetime.now(timezone.utc).isoformat(),'recorder_sha256':sha(Path(__file__).read_bytes()),'originals':originals,'attempts':attempts}
    (OUT/'index.json').write_bytes(encoded(index))
    counts=[int(n) for n in re.findall(r'^# tests (\d+)\r?$',(DELIVERY/b['raw_report']['path']).read_text(encoding='utf-8'),re.M)]
    failures=[int(n) for n in re.findall(r'^# fail (\d+)\r?$',(DELIVERY/b['raw_report']['path']).read_text(encoding='utf-8'),re.M)]
    assert counts and sum(counts)>=10 and failures and sum(failures)==0
    value={'at':datetime.now(timezone.utc).isoformat(),'status':'verified_business_content_history_slice','selected_attempts':selected,
        'evidence_index':ref(OUT/'index.json'),'source_files':sources,'qualification_sources':extra,
        'media_files':media,'shared_media_copies':copies,'previous_publication_receipt':prior,'backend_case_counts':counts,
        'ui_checks':journey['checks'],'git_source_proofs':check_sources(sources,extra),
        'historical_partial_run':{'attempt':'backend-02','status':'failed','passed_cases':95,'failed_cases':10,
            'scope':'Original broad run: 95 related cases passed; ten new cases failed in their shared fixture due to its wrong brand update URL. This receipt is not relabelled as passing/current after subsequent source changes.'},
        'scope':'Five additional business resource kinds, all five creative project kinds, saved canvas snapshots, scoped bounded history and real administrator journeys. Historical proofs and whole acceptance scopes retained.',
        'new_full_acceptance_closures':0,'recorder_sha256':sha(Path(__file__).read_bytes())}
    CP.write_bytes(encoded(value));print(json.dumps({'status':'recorded','sources':len(sources),'originals':len(originals),'backend_cases':sum(counts),'ui_checks':len(journey['checks'])}))

def verify():
    cp,index=read(CP),read(OUT/'index.json');assert cp['status']=='verified_business_content_history_slice'
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
