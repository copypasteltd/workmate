"""Bind actual document conversion, three-client evidence and final Git source bytes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
from concurrent.futures import ThreadPoolExecutor
import argparse,json,re
from record_business_history_144_v1 import check_sources
from record_source_build_reproduction_v1 import credentials,scan
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery'
RAW=DELIVERY/'evidence/document-preview-146';OUT=ROOT/'docs/quality/document-preview-evidence-146';CP=ROOT/'docs/quality/document-preview-checkpoint-146.json'
PREVIOUS=DELIVERY/'.data/workflow-handoff-145/publication-f0618e47-e175-4a26-a4cb-089a00477a63/receipt.json'
sha=lambda b:sha256(b).hexdigest()
read=lambda p:json.loads(p.read_bytes())
encoded=lambda v:(json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode()
ref=lambda p:{'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p.read_bytes())}
def report(stem):
    row=read(RAW/(stem+'.json'))
    for key in ['source_manifest','raw_report','verifier']:
        item=row[key];assert sha((DELIVERY/item['path']).read_bytes())==item['sha256']
    return row,read(DELIVERY/row['source_manifest']['path'])
def passed(row):
    assert row['status']=='passed' and row['source_unchanged'] and row['result_exit_code']==0
    assert row['owned_database_shutdown']
    assert row.get('owned_database_port_closed',all(row.get('ports_closed',{}).values()))
    assert row['fixture_cleanup']['status']=='passed' and row['fixture_cleanup']['exit_code']==0
    assert all(x['exit_code']==0 for x in row.get('checks',row.get('commands',[])))
def record(backend,ui):
    assert not CP.exists() and not OUT.exists()
    selected={'backend':'backend-'+backend,'ui':'ui-'+ui};b,bs=report(selected['backend']);u,us=report(selected['ui']);passed(b);passed(u)
    differences=sorted(name for name,value in bs.items()if not name.startswith('copypaste-delivery/')and us.get(name,{}).get('sha256')!=value['sha256'])
    assert differences==[]
    journey=read(DELIVERY/u['journey']['path']);assert ref(DELIVERY/u['journey']['path'])['sha256']==u['journey']['sha256']
    assert journey['status']=='passed' and len(journey['checks'])==4 and len(journey['screenshots'])==9
    assert all(journey[k]for k in ['browser_closed','desktop_closed','extension_closed','api_closed','fixture_closed'])
    assert len(journey['layouts'])==6 and all(x['no_horizontal_overflow']for x in journey['layouts'])
    assert len(journey['recordings'])==3 and all(x['distinct_frames']>1 and x['skipped_capture_errors']==0 for x in journey['recordings'])
    media=[*journey['screenshots'],*[f for row in journey['recordings']for f in row['files']]]
    sources={'dev/'+name:value['sha256']for name,value in us.items()if not name.startswith('copypaste-delivery/')}
    sources['dev/copypaste-desktop/.gitattributes']='82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e'
    extra={'dev/'+name:value['sha256']for name,value in us.items()if name.startswith('copypaste-delivery/')}
    filenames=['package.json','package-lock.json','tsconfig.json','.gitattributes']
    for pattern in ['scripts/qualify-document-preview*146*.mjs','scripts/qa-document-preview-146-v*.ts']:
        filenames.extend(p.relative_to(DELIVERY).as_posix()for p in DELIVERY.glob(pattern))
    for filename in filenames:
        file=DELIVERY/filename;extra[file.relative_to(ROOT).as_posix()]=sha(file.read_bytes())
    for name,digest in {**sources,**extra}.items():assert sha((ROOT/name).read_bytes())==digest,name
    previous=read(PREVIOUS);assert previous['status']=='pushed_and_verified' and previous['remote_after']['docs']=='20852b1a9796916f5a5e163fe64dca1e2ade19b3'
    objects={}
    for file in RAW.glob('*-sources.json'):
        for item in read(file).values():
            assert item['path']not in objects or objects[item['path']]==item['sha256'];objects[item['path']]=item['sha256']
    def check(item):name,digest=item;assert sha((DELIVERY/name).read_bytes())==digest
    with ThreadPoolExecutor(max_workers=16)as pool:list(pool.map(check,objects.items()))
    for file in RAW.glob('*.json'):
        if re.fullmatch(r'(backend|ui)-\d{2}\.json',file.name):report(file.stem)
    runtime=read(DEV/'copypaste-platform/.data/document-preview/runtime.json');assert b['document_runtime']==u['document_runtime']
    assert b['document_runtime']['manifest_sha256']==sha((DEV/'copypaste-platform/.data/document-preview/runtime.json').read_bytes())
    for p,k in [('office_path','office_sha256'),('host_path','host_sha256')]:assert sha(Path(runtime[p]).read_bytes())==runtime[k]
    assert sha((DEV/'copypaste-platform/src/document-preview-host.cs').read_bytes())==runtime['host_source_sha256']
    assert runtime['msi_sha256']=='ff4b911403b67ee9e6249f820f9782c44bb32c94fdaa45b0da53a8e419e5307a'
    OUT.mkdir(parents=True);originals=[];needles=credentials()
    def retain(file):
        body=file.read_bytes();digest=sha(body);archive='blobs/'+digest+'.blob';target=OUT/archive;scan(file.relative_to(ROOT).as_posix(),body,needles);target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():assert target.read_bytes()==body
        else:
            with target.open('xb')as stream:stream.write(body)
        item={'source':file.relative_to(ROOT).as_posix(),'archive':archive,'sha256':digest,'bytes':len(body)};originals.append(item);return item
    attempts=[]
    for file in sorted(RAW.rglob('*')):
        if not file.is_file()or'objects'in file.relative_to(RAW).parts:continue
        retain(file)
        if re.fullmatch(r'(backend|ui)-\d{2}\.json',file.name):attempts.append({'source':file.relative_to(ROOT).as_posix(),'status':read(file)['status']})
    for file in RAW.glob('ui-??-journey.json'):
        j=read(file)
        for item in [*j['screenshots'],*[f for row in j['recordings']for f in row['files']]]:retain(DEV/item['path'])
    copies=read(ROOT/'docs/quality/document-preview-media-copies-146.json');retain(ROOT/'docs/quality/document-preview-media-copies-146.json')
    for item in copies:
        assert sha((ROOT/item['path']).read_bytes())==item['sha256']==sha((ROOT/item['source']).read_bytes());retain(ROOT/item['path'])
    prior=retain(PREVIOUS);retain(PREVIOUS.with_name('commands.log'));retain(ROOT/previous['incremental_history_and_links']['path'])
    index={'at':datetime.now(timezone.utc).isoformat(),'recorder_sha256':sha(Path(__file__).read_bytes()),'originals':originals,'attempts':attempts}
    with (OUT/'index.json').open('xb')as stream:stream.write(encoded(index))
    log=(DELIVERY/b['raw_report']['path']).read_text(encoding='utf-8');counts=[int(n)for n in re.findall(r'^# tests (\d+)\r?$',log,re.M)];failures=[int(n)for n in re.findall(r'^# fail (\d+)\r?$',log,re.M)];assert len(counts)==1 and counts[0]>=16 and failures==[0]
    value={'at':datetime.now(timezone.utc).isoformat(),'status':'verified_document_preview_slice','selected_attempts':selected,'evidence_index':ref(OUT/'index.json'),'source_files':sources,'qualification_sources':extra,'media_files':media,'shared_media_copies':copies,'previous_publication_receipt':prior,'backend_case_counts':counts,'ui_checks':journey['checks'],'git_source_proofs':check_sources(sources,extra),'backend_vs_ui_source_differences':differences,'difference_scope':'All final backend and client source bytes are identical across selected backend and UI qualification. The immutable Windows package comes from its byte-identical current client build; the final backend is rebuilt and its real Windows lock handling is qualified.','historical_attempts':attempts,'document_runtime':b['document_runtime'],'scope':'Actual document page conversion and source selection with current authorization, native SQL and three actual clients. No model calls; not full native Codex/OS or production acceptance.','new_full_acceptance_closures':0,'recorder_sha256':sha(Path(__file__).read_bytes())}
    with CP.open('xb')as stream:stream.write(encoded(value))
    print(json.dumps({'status':'recorded','sources':len(sources),'originals':len(originals),'targeted_cases':sum(counts),'client_journeys':len(journey['checks'])}))
def verify():
    cp,index=read(CP),read(OUT/'index.json');assert cp['status']=='verified_document_preview_slice'
    assert cp['evidence_index']==ref(OUT/'index.json')and cp['recorder_sha256']==index['recorder_sha256']==sha(Path(__file__).read_bytes());needles=credentials()
    for item in index['originals']:
        body=(OUT/item['archive']).read_bytes();assert len(body)==item['bytes']and sha(body)==item['sha256'];scan(item['source'],body,needles)
    for name,digest in {**cp['source_files'],**cp['qualification_sources']}.items():assert sha((ROOT/name).read_bytes())==digest,name
    for item in cp['media_files']:assert sha((DEV/item['path']).read_bytes())==item['sha256']
    for item in cp['shared_media_copies']:assert sha((ROOT/item['path']).read_bytes())==item['sha256']==sha((ROOT/item['source']).read_bytes())
    for stem in cp['selected_attempts'].values():row,_=report(stem);passed(row)
    assert check_sources(cp['source_files'],cp['qualification_sources'])==cp['git_source_proofs']
    return {'status':'passed','source_files':len(cp['source_files']),'backend_cases':sum(cp['backend_case_counts']),'ui_checks':len(cp['ui_checks']),'media_files':len(cp['media_files']),'originals':len(index['originals']),'new_full_acceptance_closures':0}
if __name__=='__main__':
    p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True);g.add_argument('--record',action='store_true');g.add_argument('--verify',action='store_true');p.add_argument('--backend');p.add_argument('--ui');a=p.parse_args()
    if a.record:record(a.backend,a.ui)
    else:print(json.dumps(verify()))
