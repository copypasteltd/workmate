"""Publish committed cloud-browser sources and exact evidence through the existing eight-ref publisher."""
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
    previous = QUALITY / 'history/stage101-previous-publication.json'
    assert not previous.exists()
    checkpoint = QUALITY / 'cloud-browser-checkpoint.json'
    cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_cloud_browser'
    for name, expected in cp['source_files'].items():
        assert digest(ROOT/name) == expected, name
    audit_file = QUALITY / 'cloud-browser-docs-audit-01.json'
    audit = read(audit_file)
    assert audit['status']=='passed' and audit['bilingual_readmes']==14 and audit['checkpoint']['sha256']==digest(checkpoint)
    assert audit['verifier_sha256']==digest(ROOT/'docs/tools/record_cloud_browser.py')
    assert len(audit['recordings'])==2 and all(v['fully_decoded'] for v in audit['recordings'])
    reviews = {}
    for filename, verifier in [
        ('desktop-browser-staged-credentials-40.json','scan_desktop_browser_staged_credentials.py'),
        ('cloud-browser-whitespace-01.json','record_cloud_browser_whitespace.py'),
        ('archive-link-audit-24.json','audit_archive_links.py'),
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
    for p in (delivery/'evidence').glob('cloud-browser-*'):
        if p.is_file(): proof(p,'delivery',delivery)
        else:
            for child in p.rglob('*'):
                if child.is_file(): proof(child,'delivery',delivery)
    for row in cp['screenshots']+[v for recording in cp['recordings'] for v in recording['files']]:
        p = DEV/row['path']
        component = p.relative_to(DEV).parts[0].removeprefix('copypaste-')
        proof(p,MAP[component],DEV/('copypaste-'+component))
    for attempt in cp['all_attempts']:
        report = read(ROOT/attempt['path'])
        if not report.get('journey'):
            continue
        journey = read(delivery/report['journey']['path'])
        for row in journey.get('screenshots',[]) + journey.get('media',{}).get('files',[]):
            p = DEV/row['path']
            assert digest(p) == row['sha256'], p
            component = p.relative_to(DEV).parts[0].removeprefix('copypaste-')
            proof(p,MAP[component],DEV/('copypaste-'+component))
    refresh = read(QUALITY/'cloud-browser-documentation-refresh.json')
    for row in refresh['media_copies']:
        p = ROOT/row['target']
        if p.is_relative_to(DEV):
            component = p.relative_to(DEV).parts[0].removeprefix('copypaste-')
            proof(p,MAP[component],DEV/('copypaste-'+component))
        else: proof(p,'docs',ROOT)
    for name in ['cloud-browser-checkpoint.json','cloud-browser-documentation-refresh.json','cloud-browser-docs-audit-01.json']:
        proof(QUALITY/name,'docs',ROOT)
    for name in ['record_cloud_browser.py','record_cloud_browser_whitespace.py','finalize_cloud_browser_manifest.py']:
        proof(ROOT/'docs/tools'/name,'docs',ROOT)
    proof(ROOT/'docs/technical/101-cloud-browser-preview.md','docs',ROOT)
    for p in (QUALITY/'history/stage101-documents').rglob('*'):
        if p.is_file(): proof(p,'docs',ROOT)
    for row in cp['new_migrations']:
        proof(ROOT/row['path'],'backend',DEV/'copypaste-platform')
    for name in ['contracts/cloud-browser-runtime.json','catalog/software-toolchain-release-v1.json']:
        proof(DEV/'copypaste-platform'/name,'backend',DEV/'copypaste-platform')
    for package in read(DEV/'copypaste-platform/catalog/software-toolchain-release-v1.json')['skill_packages']:
        proof(DEV/'copypaste-platform'/package['path'],'backend',DEV/'copypaste-platform')
    progress = read(QUALITY/'requirements-alignment-progress.json')
    assert progress['summary']=={'partial_verified':86,'completion_not_proven':16}
    assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
    result = {**old,'at':datetime.now(timezone.utc).isoformat(),'status':'ready_for_remote_verification','previous_plan_sha256':digest(output),
        'scope':cp['scope'],'components':components,'source_bindings_checked':{'current_files':len(cp['source_files']),'qualification_scopes':cp['qualification_scopes']},
        'latest_component_committed_files_checked':checked,'latest_component_committed_files_equal_disk':checked-len(normalizations),
        'declared_git_line_ending_normalizations':normalizations,'unique_committed_blobs_read':len(cache),
        'committed_blob_read_mode':'Exact qualified bytes, or explicitly declared text CRLF-to-LF transformation only',
        'current_full_platform_regression_rerun':False,
        'full_regression_scope':f"Stage101 reruns fourteen related suites ({cp['core_tests']['pass']} checks), including actual native Chromium interactions, HTTP, SQLite, Skill lifecycle and role history checks, plus four authenticated Web journey checks. The Desktop renderer is independently built and packaged; this stage does not claim a new local Desktop protocol run. Historical whole-product evidence retains its original scope.",
        'recording_scope':'Actual authenticated Web task showing failed and repaired page assertions, an actual Chromium PNG, stale-source warning, expanded output, exact receipt and PNG/source ZIP downloads, and automatic refresh without duplicate panels. Three unedited screenshots include 390-pixel Chinese dark UI; one fully decoded GIF/MP4 pair with actual wall-clock timing. Actual cloud Codex and native Chromium; synthetic provider and credit.',
        'cloud_browser_execution':{'checkpoint':ref(checkpoint),'documentation_audit':ref(audit_file),'reviews':reviews,'selected':cp['selected'],'core_tests':cp['core_tests'],
            'ui_checks':4,'screenshots':3,'recordings':1,'fully_decoded_recording_files':2,'browser_guardian':cp['browser_guardian'],'browser_contract':cp['browser_contract'],'software_release':cp['software_release'],
            'new_migrations':cp['new_migrations'],'original_complete_acceptance':'not_proven'},
        'acceptance_baseline':{**old['acceptance_baseline'],'requirements':102,'acceptance_cases':102,'partial':86,'unproven':16,'fully_accepted':0,'qualified_roles':0,'G01_G10':'not_proven'},
        'proofs':list(proofs.values()),'verifier_sha256':digest(Path(__file__))}
    previous.write_bytes(output.read_bytes())
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'status':result['status'],'components':len(components),'sources':len(cp['source_files']),'proofs':len(proofs)}))


if __name__=='__main__':main()
