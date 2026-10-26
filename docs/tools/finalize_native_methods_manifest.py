"""Publish committed native-method sources and exact evidence through the existing eight-ref publisher."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

from finalize_desktop_browser_manifest import committed_blobs
from finalize_desktop_company_tool_manifest import MAP, git, digest, read

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
QUALITY = ROOT / 'docs/quality'


def ref(p):
    return {'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)}


def main():
    output = QUALITY / 'workmate-publication.json'
    previous = QUALITY / 'history/stage97-previous-publication.json'
    assert not previous.exists()
    checkpoint = QUALITY / 'native-methods-checkpoint.json'
    cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_native_methods'
    for name, expected in cp['source_files'].items():
        assert digest(ROOT/name) == expected, name
    audit_file = QUALITY / 'native-methods-docs-audit-01.json'
    audit = read(audit_file)
    assert audit['status']=='passed' and audit['bilingual_readmes']==14 and audit['checkpoint']['sha256']==digest(checkpoint)
    assert audit['verifier_sha256']==digest(ROOT/'docs/tools/record_native_methods.py')
    assert len(audit['recordings'])==2 and all(v['fully_decoded'] for v in audit['recordings'])
    reviews = {}
    for filename, verifier in [
        ('desktop-browser-staged-credentials-33.json','scan_desktop_browser_staged_credentials.py'),
        ('desktop-browser-whitespace-31.json','record_native_methods_whitespace.py'),
        ('archive-link-audit-19.json','audit_archive_links.py'),
    ]:
        p = QUALITY / filename
        value = read(p)
        assert value['status']=='passed' and value['verifier_sha256']==digest(ROOT/'docs/tools'/verifier)
        reviews[filename] = ref(p)
    components, normalizations, cache = [], [], {}
    checked = 0
    for component, branch in MAP.items():
        repo = DEV / ('copypaste-' + component)
        assert not git(repo,'status','--porcelain'), component
        local = git(repo,'branch','--show-current').decode().strip()
        assert local in [branch,'codex/'+branch]
        names = [v.decode('utf-8') for v in git(repo,'diff-tree','--no-commit-id','--name-only','-r','-z','HEAD').split(b'\0') if v]
        blobs = committed_blobs(repo,names,cache)
        for name in names:
            blob, disk = blobs[name], (repo/name).read_bytes()
            if blob != disk:
                raw = git(repo,'check-attr','-z','text','eol','filter','--',name).split(b'\0')
                attrs = {raw[i+1].decode():raw[i+2].decode() for i in range(0,len(raw)-1,3)}
                assert attrs['text'] in ['set','auto'] and attrs['eol']=='lf' and attrs['filter']=='unspecified'
                assert b'\0' not in disk and b'\r\n' in disk and blob==disk.replace(b'\r\n',b'\n'),name
                normalizations.append({'path':(repo/name).relative_to(DEV).as_posix(),'transformation':'declared_git_crlf_to_lf_only','qualified_working_sha256':sha256(disk).hexdigest(),'committed_blob_sha256':sha256(blob).hexdigest()})
            checked += 1
        components.append({'component':component,'branch':branch,'local_branch':local,'directory':repo.relative_to(ROOT).as_posix(),
            'commit':git(repo,'rev-parse','HEAD').decode().strip(),'tree':git(repo,'rev-parse','HEAD^{tree}').decode().strip(),
            'readmes':[{'path':n,'sha256':digest(repo/n)} for n in ['README.md','README.en.md']],
            'branch_url':'https://github.com/copypasteltd/workmate/tree/'+branch})
    old = read(output)
    proofs = {(v['repository'],v['path']):v for v in old['proofs']}

    def proof(p, branch, repo):
        name = p.relative_to(repo).as_posix()
        proofs[(branch,name)] = {'repository':branch,'path':name,'sha256':digest(p),'url':'https://github.com/copypasteltd/workmate/blob/'+branch+'/'+name}

    delivery = DEV/'copypaste-delivery'
    for p in (delivery/'evidence').glob('native-methods-*'):
        if p.is_file(): proof(p,'delivery',delivery)
        else:
            for child in p.rglob('*'):
                if child.is_file(): proof(child,'delivery',delivery)
    for row in cp['screenshots']+[v for recording in cp['recordings'] for v in recording['files']]:
        p = DEV/row['path']
        component = p.relative_to(DEV).parts[0].removeprefix('copypaste-')
        proof(p,MAP[component],DEV/('copypaste-'+component))
    refresh = read(QUALITY/'native-methods-documentation-refresh.json')
    for row in refresh['media_copies']:
        p = ROOT/row['target']
        if p.is_relative_to(DEV):
            component = p.relative_to(DEV).parts[0].removeprefix('copypaste-')
            proof(p,MAP[component],DEV/('copypaste-'+component))
        else: proof(p,'docs',ROOT)
    progress = read(QUALITY/'requirements-alignment-progress.json')
    assert progress['summary']=={'partial_verified':86,'completion_not_proven':16}
    assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
    result = {**old,'at':datetime.now(timezone.utc).isoformat(),'status':'ready_for_remote_verification','previous_plan_sha256':digest(output),
        'scope':cp['scope'],'components':components,'source_bindings_checked':{'current_files':len(cp['source_files']),'qualification_scopes':cp['qualification_scopes']},
        'latest_component_committed_files_checked':checked,'latest_component_committed_files_equal_disk':checked-len(normalizations),
        'declared_git_line_ending_normalizations':normalizations,'unique_committed_blobs_read':len(cache),
        'committed_blob_read_mode':'Exact qualified bytes, or explicitly declared text CRLF-to-LF transformation only',
        'current_full_platform_regression_rerun':False,
        'full_regression_scope':'Stage97 reruns nine related integration suites (124 checks), 49 Desktop unit checks, two actual pinned local Codex protocol probes and six actual packaged Desktop method checks. Historical whole-product evidence keeps its original scope.',
        'recording_scope':'Actual packaged local Desktop method preparation, local file execution, observed fees, customer exact-delivery acceptance and publication; three screenshots including the 800x600 Chinese dark native shell and one fully decoded GIF/MP4 pair. Synthetic provider and test credit; native dialogs use bounded fixture decisions.',
        'native_methods':{'checkpoint':ref(checkpoint),'documentation_audit':ref(audit_file),'reviews':reviews,'selected':cp['selected'],'core_tests':cp['core_tests'],
            'desktop_unit_tests':cp['desktop_unit_tests'],'native_tests':cp['native_tests'],'ui_checks':6,'screenshots':3,'recordings':1,'fully_decoded_recording_files':2,
            'new_migrations':cp['new_migrations'],'original_complete_acceptance':'not_proven'},
        'acceptance_baseline':{**old['acceptance_baseline'],'requirements':102,'acceptance_cases':102,'partial':86,'unproven':16,'fully_accepted':0,'qualified_roles':0,'G01_G10':'not_proven'},
        'proofs':list(proofs.values()),'verifier_sha256':digest(Path(__file__))}
    previous.write_bytes(output.read_bytes())
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'status':result['status'],'components':len(components),'sources':len(cp['source_files']),'proofs':len(proofs)}))


if __name__=='__main__':main()
