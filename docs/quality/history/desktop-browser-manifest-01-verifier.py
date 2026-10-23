"""Bind the final independent commits to current native browser/layout proof."""
from datetime import datetime,timezone
from hashlib import sha256
import json
from pathlib import Path
from finalize_desktop_company_tool_manifest import MAP,git,digest,read

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
DELIVERY=DEV/'copypaste-delivery'

def main():
    path=ROOT/'docs/quality/desktop-browser-checkpoint.json'
    checkpoint=read(path)
    assert checkpoint['status']=='verified_bounded_native_browser_and_desktop_layout'
    assert digest(ROOT/'docs/tools/record_desktop_browser.py')==checkpoint['verifier_sha256']
    audit_path=ROOT/'docs/quality/desktop-browser-docs-audit-01.json'
    audit=read(audit_path)
    assert audit['status']=='passed' and audit['bilingual_readmes']==14 and audit['original_requirement_records_unchanged']==102
    assert digest(ROOT/audit['visual_review']['path'])==audit['visual_review']['sha256']
    credential_path=ROOT/'docs/quality/desktop-browser-staged-credentials-01.json'
    credential=read(credential_path)
    assert credential['status']=='passed' and credential['staged_files_checked']>0
    assert digest(ROOT/'docs/tools/scan_desktop_browser_staged_credentials.py')==credential['verifier_sha256']
    direction_path=ROOT/'docs/quality/client-direction-source-review-77.json'
    direction=read(direction_path)
    assert direction['desktop']['checkpoint_sha256']==digest(path)
    for name,value in {**checkpoint['source_files'],**direction['extension']['unchanged_product_sources'],**direction['extension']['unchanged_journey_verifier_sources']}.items():
        assert digest(DEV/name)==value,name
    for media in [checkpoint['media'],checkpoint['native_browser_media'],checkpoint['browser_media']]:
        for item in media['files']:
            assert digest(DEV/item['path'])==item['sha256']
    for item in checkpoint['screenshots']:
        assert digest(DEV/item['path'])==item['sha256']
    for item in checkpoint['documentation_media']:
        assert digest(ROOT/item['source'])==digest(ROOT/item['path'])==item['sha256']
    candidate=(DELIVERY/checkpoint['packaged']['executable']).resolve()
    assert digest(candidate.parent/'resources/app.asar')==checkpoint['packaged']['app_asar_sha256']
    assert digest(candidate.parent/'resources/local-codex/codex.exe')==checkpoint['packaged']['native_binary_sha256']
    whitespace_path=ROOT/'docs/quality/desktop-browser-whitespace-02.json'
    whitespace=read(whitespace_path)
    assert whitespace['status']=='passed' and whitespace['source_and_readme_whitespace_issues']==0 and whitespace['raw_bytes_changed'] is False
    assert digest(ROOT/'docs/tools/record_desktop_browser_whitespace.py')==whitespace['verifier_sha256']
    for item in whitespace['raw_files']:
        repo=ROOT if item['repository']=='docs' else DEV/('copypaste-'+item['repository'])
        assert digest(repo/item['path'])==item['sha256'] and item['staged_bytes_equal_disk']
    components,normalizations,checked=[],[],0
    for component,branch in MAP.items():
        repo=DEV/('copypaste-'+component)
        assert not git(repo,'status','--porcelain'),component
        local=git(repo,'branch','--show-current').decode().strip()
        assert local in [branch,'codex/'+branch]
        for raw in git(repo,'diff-tree','--no-commit-id','--name-only','-r','-z','HEAD').split(b'\0'):
            if not raw:
                continue
            name=raw.decode('utf-8')
            blob=git(repo,'show','HEAD:'+name)
            disk=(repo/name).read_bytes()
            if blob!=disk:
                values=git(repo,'check-attr','-z','text','eol','filter','--',name).split(b'\0')
                attributes={values[i+1].decode():values[i+2].decode() for i in range(0,len(values)-1,3)}
                assert attributes['text'] in ['set','auto'] and attributes['eol']=='lf' and attributes['filter']=='unspecified'
                assert b'\0' not in disk and b'\r\n' in disk and blob==disk.replace(b'\r\n',b'\n'),name
                normalizations.append({'path':(repo/name).relative_to(DEV).as_posix(),'transformation':'declared_git_crlf_to_lf_only','qualified_working_sha256':sha256(disk).hexdigest(),'committed_blob_sha256':sha256(blob).hexdigest()})
            checked+=1
        components.append({'component':component,'branch':branch,'local_branch':local,'directory':repo.relative_to(ROOT).as_posix(),'commit':git(repo,'rev-parse','HEAD').decode().strip(),'tree':git(repo,'rev-parse','HEAD^{tree}').decode().strip(),'readmes':[{'path':name,'sha256':digest(repo/name)} for name in ['README.md','README.en.md']],'branch_url':'https://github.com/copypasteltd/workmate/tree/'+branch})
    output=ROOT/'docs/quality/workmate-publication.json'
    old=read(output)
    previous=digest(output)
    selected=checkpoint['selected']
    names=[f"evidence/desktop-execution-control-{selected['control']}.json",f"evidence/local-codex-native-{selected['native']}.json",f"evidence/desktop-local-ui-{selected['ui']}.json",f"evidence/desktop-local-ui-{selected['ui']}-journey.json",f"evidence/desktop-browser-{selected['browser']}.json"]
    platform=read(DELIVERY/names[0])
    index=read(DELIVERY/platform['raw_report']['path'])
    names.extend([platform['raw_report']['path'],platform['verifier']['path'],index['plan']['path'],index['setup']['path']])
    names.extend(item['path'] for item in index['batches'])
    proofs={(item['repository'],item['path']):item for item in old['proofs']}
    for name in names:
        proofs[('delivery',name)]={'repository':'delivery','path':name,'sha256':digest(DELIVERY/name),'url':'https://github.com/copypasteltd/workmate/blob/delivery/'+name}
    result={**old,'at':datetime.now(timezone.utc).isoformat(),'previous_plan_sha256':previous,
        'scope':'CLIENT01 customer-device Codex browser and DESK-UI01 frameless layout without visible scrollbar rails, real files/downloads, company gateway/usage, native Stop/revoke and bilingual themes. Explicit synthetic model/business/dialog fixtures; full professional and production acceptance remains pending.',
        'components':components,'source_bindings_checked':{'current_files':len(checkpoint['source_files']),'qualification_scopes':checkpoint['qualification_scopes']},'latest_component_committed_files_checked':checked,'latest_component_committed_files_equal_disk':checked-len(normalizations),'declared_git_line_ending_normalizations':normalizations,
        'preserved_regression_cases':848,'full_regression_cases':checkpoint['platform_tests']['tests'],
        'desktop_native_browser_and_layout':{'checkpoint':path.relative_to(ROOT).as_posix(),'checkpoint_sha256':digest(path),'selected':selected,'documentation_audit':{'path':audit_path.relative_to(ROOT).as_posix(),'sha256':digest(audit_path)},'visual_review':audit['visual_review'],'platform_tests':checkpoint['platform_tests']['tests'],'native_supervisor_tests':17,'client_tests':68,'standalone_browser_checks':10,'packaged_journeys':25,'browser_tools':12,'native_roles_admitted':18,'complete_professional_acceptance':'pending'},
        'desktop_native_browser_raw_whitespace':{'path':whitespace_path.relative_to(ROOT).as_posix(),'sha256':digest(whitespace_path),'raw_files':len(whitespace['raw_files']),'raw_bytes_changed':False},
        'desktop_native_browser_precommit_credentials':{'path':credential_path.relative_to(ROOT).as_posix(),'sha256':digest(credential_path),'scope':credential['scope']},
        'desktop_native_workflows':{**old['desktop_native_workflows'],'source_scope':'historical_stage76; current complete platform and packaged native journey retain workflow files/fees/approvals'},
        'client_direction':{**old['client_direction'],'native_supervisor':path.relative_to(ROOT).as_posix(),'current_direction_review':{'path':direction_path.relative_to(ROOT).as_posix(),'sha256':digest(direction_path),'extension_product_sources_unchanged':31,'extension_journey_verifiers_unchanged':3,'new_extension_ui_run':False},'desktop_native_browser_subset':'verified_with_synthetic_provider_and_customer_decisions','complete_Desktop_operation_parity':'pending'},
        'proofs':list(proofs.values()),'verifier_sha256':digest(Path(__file__))}
    with (ROOT/'docs/quality/history/stage77-previous-publication.json').open('xb') as stream:
        stream.write(output.read_bytes())
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':result['status'],'components':len(components),'sources':len(checkpoint['source_files']),'committed_files':checked,'proofs':len(proofs)}))

if __name__=='__main__':
    main()
