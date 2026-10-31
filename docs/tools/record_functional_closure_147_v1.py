"""Preserve actual functional journeys, original attempts and exact committed source bytes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import argparse, json, re
from record_business_history_144_v1 import check_sources
from record_source_build_reproduction_v1 import credentials, scan
from functional_closure_147_binding_v1 import qualify_backend, compare_ui_sources

ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery'
RAW=DELIVERY/'evidence/functional-closure-147';OUT=ROOT/'docs/quality/functional-closure-evidence-147';CP=ROOT/'docs/quality/functional-closure-checkpoint-147.json'
PREVIOUS=DELIVERY/'.data/document-preview-146/publication-2258cc2b-b3cf-4d14-9b0b-e772d91e8874/receipt.json'
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
    assert row['owned_database_shutdown'] and row.get('owned_database_port_closed',all(row.get('ports_closed',{}).values()))
    assert row['fixture_cleanup']['status']=='passed' and row['fixture_cleanup']['exit_code']==0
    assert all(i['exit_code']==0 for i in row.get('checks',row.get('commands',[])))

def record(backend,ui,native):
    assert not CP.exists() and not OUT.exists()
    selected={'backend':'backend-'+backend,'ui':'ui-'+ui,'native':'native-'+native,'extension':'extension-unit-01'}
    b,bs=report(selected['backend']);u,us=report(selected['ui']);n,ns=report(selected['native']);e,es=report(selected['extension']);passed(b);passed(u)
    assert n['status']=='passed' and n['source_unchanged'] and n['exit_code']==0
    assert e['status']=='passed' and e['source_unchanged'] and e['exit_code']==0
    for name,item in ns.items():assert us['copypaste-desktop/'+name]['sha256']==item['sha256'],name
    for name,item in es.items():assert us['copypaste-extension/'+name]['sha256']==item['sha256'],name
    binding=qualify_backend(selected['backend'])
    differences=compare_ui_sources(bs,us)
    j=read(DELIVERY/u['journey']['path']);assert ref(DELIVERY/u['journey']['path'])['sha256']==u['journey']['sha256']
    assert j['status']=='passed' and len(j['checks'])==5 and len(j['screenshots'])>=11 and len(j['recordings'])==5
    assert all(j[k]for k in ['browser_closed','desktop_closed','extension_closed','api_closed','fixture_closed','provider_closed'])
    assert len(j['layouts'])==6 and all(i['no_horizontal_overflow']for i in j['layouts'])
    assert all(i['distinct_frames']>1 and i['skipped_capture_errors']==0 for i in j['recordings'])
    build_file=DELIVERY/u['client_build']['path'];build=read(build_file);assert ref(build_file)['sha256']==u['client_build']['sha256']
    assert build['status']=='passed' and build['source_unchanged'] and u['package_unchanged']
    for name,digest in build['package_files'].items():assert sha((Path(build['package_root'])/name).read_bytes())==digest
    for name,item in read(DELIVERY/build['source_manifest']['path']).items():assert us[name]['sha256']==item['sha256']
    media=[*j['screenshots'],*[f for r in j['recordings']for f in r['files']]]
    sources={'dev/'+name:item['sha256']for name,item in us.items()if not name.startswith('copypaste-delivery/')}
    for name in differences:sources['dev/'+name]=bs[name]['sha256']
    sources['dev/copypaste-desktop/.gitattributes']='82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e'
    extra={'dev/'+name:item['sha256']for name,item in us.items()if name.startswith('copypaste-delivery/')}
    filenames=['package.json','package-lock.json','tsconfig.json','.gitattributes']
    for pattern in ['scripts/*functional*147*v*.mjs','scripts/qa-functional-closure-147-v*.ts']:
        filenames.extend(p.relative_to(DELIVERY).as_posix()for p in DELIVERY.glob(pattern))
    for name in filenames:extra[(DELIVERY/name).relative_to(ROOT).as_posix()]=sha((DELIVERY/name).read_bytes())
    for name,digest in {**sources,**extra}.items():assert sha((ROOT/name).read_bytes())==digest,name
    objects={}
    for file in RAW.glob('*-sources.json'):
        for item in read(file).values():
            assert item['path']not in objects or objects[item['path']]==item['sha256'];objects[item['path']]=item['sha256']
    def check(item):name,digest=item;assert sha((DELIVERY/name).read_bytes())==digest
    with ThreadPoolExecutor(max_workers=16)as pool:list(pool.map(check,objects.items()))
    previous=read(PREVIOUS);assert previous['status']=='pushed_and_verified' and previous['remote_after']['docs']=='8755c105dbc831149cefb9e065b3f6e0cf45097c'
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
        if re.fullmatch(r'(backend|ui|build|native|extension-unit)-\d{2}\.json',file.name):
            report(file.stem);attempts.append({'source':file.relative_to(ROOT).as_posix(),'status':read(file)['status']})
    for file in RAW.glob('ui-??-journey.json'):
        old=read(file)
        for item in [*old['screenshots'],*[f for r in old['recordings']for f in r['files']]]:retain(DEV/item['path'])
    for file in RAW.glob('ui-??-interruption.json'):
        old=read(file)
        for item in old.get('orphan_media',[]):
            target=DEV/item['path'];assert sha(target.read_bytes())==item['sha256'];retain(target)
    copies_file=ROOT/'docs/quality/functional-closure-media-copies-147.json';copies=read(copies_file);retain(copies_file)
    for item in copies:
        assert sha((ROOT/item['path']).read_bytes())==item['sha256']==sha((ROOT/item['source']).read_bytes());retain(ROOT/item['path'])
    prior=retain(PREVIOUS);retain(PREVIOUS.with_name('commands.log'));retain(ROOT/previous['incremental_history_and_links']['path'])
    index={'at':datetime.now(timezone.utc).isoformat(),'recorder_sha256':sha(Path(__file__).read_bytes()),'originals':originals,'attempts':attempts}
    with (OUT/'index.json').open('xb')as stream:stream.write(encoded(index))
    def counts(row):
        log=(DELIVERY/row['raw_report']['path']).read_text(encoding='utf-8');total=[int(x)for x in re.findall(r'^# tests (\d+)\r?$',log,re.M)];fail=[int(x)for x in re.findall(r'^# fail (\d+)\r?$',log,re.M)];assert len(total)==1 and fail==[0];return total
    totals=counts(b);native_counts=counts(n);extension_counts=counts(e);assert totals==[3] and binding['verified_case_coverage']==95
    value={'at':datetime.now(timezone.utc).isoformat(),'status':'verified_functional_closure_slice','selected_attempts':selected,'evidence_index':ref(OUT/'index.json'),
        'source_files':sources,'qualification_sources':extra,'media_files':media,'shared_media_copies':copies,'previous_publication_receipt':prior,'backend_case_counts':totals,'backend_qualification':binding,'binding_helper':ref(ROOT/'docs/tools/functional_closure_147_binding_v1.py'),'native_case_counts':native_counts,'extension_case_counts':extension_counts,
        'ui_checks':j['checks'],'git_source_proofs':check_sources(sources,extra),'backend_vs_ui_source_differences':differences,'historical_attempts':attempts,
        'client_build':u['client_build'],'package_files':build['package_files'],'package_root':build['package_root'],
        'difference_scope':'All product, old test and fixture bytes match backend10 and successful UI08. The sole new file is the corrected concurrency test, independently executed by backend11 with every prior assertion unchanged. Actual Windows package binds identical client sources. No repeated full-suite claim.',
        'scope':'Actual original paid cloud Codex requests local material, actual local packaged Codex writes an approved local CSV, explicit private upload returns exact versions and original paid thread continues; typed workflow review/full output and native Side Panel recurring named inputs. Explicit synthetic internal model; workflow UI separately scripted. Not full production or OS/professional acceptance.',
        'new_full_acceptance_closures':0,'recorder_sha256':sha(Path(__file__).read_bytes())}
    with CP.open('xb')as stream:stream.write(encoded(value))
    print(json.dumps({'status':'recorded','sources':len(sources),'originals':len(originals),'backend_case_coverage':binding['verified_case_coverage'],'current_backend_cases':totals[0],'native_cases':native_counts[0],'client_journeys':len(j['checks'])}))

def verify():
    cp,index=read(CP),read(OUT/'index.json');assert cp['status']=='verified_functional_closure_slice'
    assert cp['binding_helper']==ref(ROOT/'docs/tools/functional_closure_147_binding_v1.py') and cp['backend_qualification']==qualify_backend(cp['selected_attempts']['backend'])
    assert cp['evidence_index']==ref(OUT/'index.json')and cp['recorder_sha256']==index['recorder_sha256']==sha(Path(__file__).read_bytes());needles=credentials()
    for item in index['originals']:
        body=(OUT/item['archive']).read_bytes();assert len(body)==item['bytes']and sha(body)==item['sha256'];scan(item['source'],body,needles)
    for name,digest in {**cp['source_files'],**cp['qualification_sources']}.items():assert sha((ROOT/name).read_bytes())==digest,name
    for item in cp['media_files']:assert sha((DEV/item['path']).read_bytes())==item['sha256']
    for item in cp['shared_media_copies']:assert sha((ROOT/item['path']).read_bytes())==item['sha256']==sha((ROOT/item['source']).read_bytes())
    for kind,stem in cp['selected_attempts'].items():
        row,_=report(stem)
        if kind in ['native','extension']:assert row['status']=='passed' and row['source_unchanged'] and row['exit_code']==0
        else:passed(row)
    assert check_sources(cp['source_files'],cp['qualification_sources'])==cp['git_source_proofs']
    return {'status':'passed','source_files':len(cp['source_files']),'backend_case_coverage':cp['backend_qualification']['verified_case_coverage'],'current_backend_cases':sum(cp['backend_case_counts']),'native_cases':sum(cp['native_case_counts']),'ui_checks':len(cp['ui_checks']),'media_files':len(cp['media_files']),'originals':len(index['originals']),'new_full_acceptance_closures':0}

if __name__=='__main__':
    p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True);g.add_argument('--record',action='store_true');g.add_argument('--verify',action='store_true');p.add_argument('--backend');p.add_argument('--ui');p.add_argument('--native',default='01');a=p.parse_args()
    if a.record:record(a.backend,a.ui,a.native)
    else:print(json.dumps(verify()))
