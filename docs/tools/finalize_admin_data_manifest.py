"""Bind stage 103 components and verify actual Git blobs before publication."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
from collections import defaultdict
from finalize_desktop_browser_manifest import committed_blobs
from finalize_desktop_company_tool_manifest import MAP, git, digest, read

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
QUALITY=ROOT/'docs/quality'
OUTPUT=QUALITY/'workmate-publication.json'
REPOS={'docs':ROOT,**{branch:DEV/('copypaste-'+name) for name,branch in MAP.items()}}
def ref(p):return {'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)}
def names(data):return [v.decode('utf-8') for v in data.split(b'\0') if v]
def attr_normalization(repo,name,blob,disk):
    raw=git(repo,'check-attr','-z','text','eol','filter','--',name).split(b'\0')
    attrs={raw[i+1].decode():raw[i+2].decode() for i in range(0,len(raw)-1,3)}
    assert attrs['text'] in ['set','auto'] and attrs['eol']=='lf' and attrs['filter']=='unspecified',name
    assert b'\0' not in disk and b'\r\n' in disk and blob==disk.replace(b'\r\n',b'\n'),name

def finalize():
    cp=read(QUALITY/'admin-data-jobs-checkpoint.json');audit=read(QUALITY/'admin-data-docs-audit-01.json')
    assert cp['status']=='verified_scoped_admin_data_jobs' and audit['status']=='passed'
    assert cp['verifier_sha256']==digest(ROOT/'docs/tools/record_admin_data_jobs.py')
    assert audit['checkpoint']['sha256']==digest(QUALITY/'admin-data-jobs-checkpoint.json')
    for name,expected in cp['source_files'].items():assert digest(ROOT/name)==expected,name
    reviews={}
    for filename,tool in [('desktop-browser-staged-credentials-45.json','scan_desktop_browser_staged_credentials.py'),('admin-data-whitespace-01.json','record_admin_data_whitespace.py'),('archive-link-audit-29.json','audit_archive_links.py')]:
        p=QUALITY/filename;v=read(p);assert v['status']=='passed' and v['verifier_sha256']==digest(ROOT/'docs/tools'/tool);reviews[filename]=ref(p)
    old=read(OUTPUT);previous=QUALITY/'history/stage103-previous-publication.json';assert not previous.exists();previous.write_bytes(OUTPUT.read_bytes())
    proofs={(v['repository'],v['path']):v for v in old['proofs']};cache={};normalizations=[];components=[];checked=0
    def proof(path,branch,blob=None):
        repo=REPOS[branch];name=path.relative_to(repo).as_posix();disk=path.read_bytes()
        entry={'repository':branch,'path':name,'sha256':sha256(blob if blob is not None else disk).hexdigest(),'url':'https://github.com/copypasteltd/workmate/blob/'+branch+'/'+name}
        if blob is not None and blob!=disk:
            attr_normalization(repo,name,blob,disk);entry['qualified_working_sha256']=sha256(disk).hexdigest();entry['transformation']='declared_git_crlf_to_lf_only';normalizations.append({'repository':branch,'path':name,'working_sha256':entry['qualified_working_sha256'],'committed_sha256':entry['sha256']})
        proofs[(branch,name)]=entry
    for component,branch in MAP.items():
        repo=REPOS[branch];assert not git(repo,'status','--porcelain'),component
        local=git(repo,'branch','--show-current').decode().strip();assert local in [branch,'codex/'+branch]
        changed=names(git(repo,'diff-tree','--no-commit-id','--name-only','-r','-z','HEAD'))
        qualified=[Path(v).relative_to(Path('dev')/('copypaste-'+component)).as_posix() for v in cp['source_files'] if v.startswith('dev/copypaste-'+component+'/')]
        current=sorted(set(changed+qualified));blobs=committed_blobs(repo,current,cache)
        for name in current:proof(repo/name,branch,blobs[name]);checked+=1
        components.append({'component':component,'branch':branch,'local_branch':local,'directory':repo.relative_to(ROOT).as_posix(),'commit':git(repo,'rev-parse','HEAD').decode().strip(),'tree':git(repo,'rev-parse','HEAD^{tree}').decode().strip(),'readmes':[{'path':n,'sha256':digest(repo/n)} for n in ['README.md','README.en.md']],'branch_url':'https://github.com/copypasteltd/workmate/tree/'+branch})
    roots=set(names(git(ROOT,'diff','--cached','--name-only','--diff-filter=ACM','-z'))+names(git(ROOT,'ls-files','--others','--exclude-standard','-z')))
    roots.add(previous.relative_to(ROOT).as_posix())
    for name in sorted(roots):
        if name=='docs/quality/workmate-publication.json':continue
        path=ROOT/name
        if path.is_file():proof(path,'docs')
    result={**old,'at':datetime.now(timezone.utc).isoformat(),'status':'ready_for_remote_verification','previous_plan_sha256':digest(OUTPUT),'scope':cp['scope'],'components':components,'source_bindings_checked':{'current_files':len(cp['source_files']),'qualification_scopes':cp['qualification_scopes']},'latest_component_committed_files_checked':checked,'latest_component_committed_files_equal_disk':checked-len(normalizations),'declared_git_line_ending_normalizations':normalizations,'unique_committed_blobs_read':len(cache),'current_full_platform_regression_rerun':False,'full_regression_scope':'Stage103 reruns six related backend suites (94 checks) and seven actual Admin browser journeys. Historical whole-product and native-client qualification retain their original scopes.','recording_scope':'Actual Admin email/MFA, frozen target/version review, partial item results, failed-only child retry, queued cancellation, exact CSV/manifest downloads, live permission revocation, Chinese/dark compact layouts. Six unedited PNGs and two GIF/MP4 pairs; synthetic accounts and zero model calls.','admin_data_jobs':{'checkpoint':ref(QUALITY/'admin-data-jobs-checkpoint.json'),'documentation_audit':ref(QUALITY/'admin-data-docs-audit-01.json'),'reviews':reviews,'selected':cp['selected'],'core_tests':cp['core_tests'],'ui_checks':7,'screenshots':6,'recordings':2,'fully_decoded_recording_files':4,'new_migrations':cp['new_migrations'],'api_contract':cp['api_contract'],'original_complete_acceptance':'not_proven'},'proofs':list(proofs.values()),'verifier_sha256':digest(Path(__file__))}
    OUTPUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'status':result['status'],'components':len(components),'sources':len(cp['source_files']),'proofs':len(proofs),'normalizations':len(normalizations)}))

def verify(report):
    manifest=read(OUTPUT);groups=defaultdict(list)
    for row in manifest['proofs']:groups[row['repository']].append(row)
    checked=0;cache={}
    for branch,rows in groups.items():
        repo=REPOS[branch];assert not git(repo,'status','--porcelain'),branch
        blobs=committed_blobs(repo,[r['path'] for r in rows],cache)
        for row in rows:
            blob=blobs[row['path']];assert sha256(blob).hexdigest()==row['sha256'],(branch,row['path'],'committed proof mismatch')
            disk=(repo/row['path']).read_bytes()
            if blob!=disk:
                assert row.get('transformation')=='declared_git_crlf_to_lf_only' and row.get('qualified_working_sha256')==sha256(disk).hexdigest(),(branch,row['path'])
                attr_normalization(repo,row['path'],blob,disk)
            checked+=1
    cp=read(QUALITY/'admin-data-jobs-checkpoint.json')
    for name,expected in cp['source_files'].items():assert digest(ROOT/name)==expected,name
    result={'at':datetime.now(timezone.utc).isoformat(),'status':'passed','manifest_sha256':digest(OUTPUT),'proofs_checked_from_actual_committed_git_blobs':checked,'source_files_rehashed':len(cp['source_files']),'unique_committed_blobs_read':len(cache),'repositories':{branch:git(repo,'rev-parse','HEAD').decode().strip() for branch,repo in REPOS.items()},'scope':'Actual HEAD tree and content-addressed Git blobs in all seven clean repositories; declared line-ending transformations checked explicitly. No working-file-only reachability claim.','verifier_sha256':digest(Path(__file__))}
    if report:
        path=(ROOT/report).resolve();allowed=(DEV/'copypaste-delivery/.data/publication').resolve();assert path.is_relative_to(allowed)
        path.parent.mkdir(parents=True,exist_ok=True)
        with path.open('x',encoding='utf-8',newline='\n') as f:json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps({'status':'passed','committed_proofs':checked,'sources':len(cp['source_files']),'unique_blobs':len(cache)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['finalize','verify']);parser.add_argument('--report');args=parser.parse_args();finalize() if args.action=='finalize' else verify(args.report)
