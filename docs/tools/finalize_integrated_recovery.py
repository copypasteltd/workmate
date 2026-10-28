"""Losslessly shard Stage120 publication proofs and bind actual independent Git objects."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
from record_audio_accounting_v2 import ROOT, DEV, QUALITY, read, ref, digest, git
from finalize_cloud_schedules_manifest import REPOS, attr_normalization
from finalize_desktop_company_tool_manifest import MAP
from finalize_desktop_browser_manifest import committed_blobs
from finalize_native_pairings import staged_blobs
from publication_proofs import load_proofs, write_shards, encoded

MANIFEST = QUALITY / 'workmate-publication.json'
CP = QUALITY / 'integrated-recovery-checkpoint.json'


def finalize():
    cp = read(CP); audit_path = QUALITY / 'integrated-recovery-docs-audit-01.json'; audit = read(audit_path)
    assert cp['status'] == 'verified_integrated_recovery' and audit['status'] == 'passed'
    assert cp['verifier_sha256'] == digest(ROOT / 'docs/tools/record_integrated_recovery.py') and audit['checkpoint'] == ref(CP)
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    reviews = {}
    for name, tool in [('desktop-browser-staged-credentials-68.json', 'scan_desktop_browser_staged_credentials.py'), ('integrated-recovery-whitespace-02.json', 'record_integrated_recovery_whitespace_v2.py'), ('integrated-recovery-git-roundtrip-01.json', 'check_integrated_recovery_git_roundtrip.py')]:
        p = QUALITY / name; value = read(p)
        assert value['status'] == 'passed' and value['verifier_sha256'] == digest(ROOT / 'docs/tools' / tool)
        reviews[name] = ref(p)
    old = read(MANIFEST); previous = QUALITY / 'history/stage120-previous-publication.json'
    assert cp['previous_publication'] == ref(previous) and previous.read_bytes() == MANIFEST.read_bytes()
    prior_rows = load_proofs(old, ROOT)
    proofs = {(r['repository'], r['path']): r for r in prior_rows}
    cache, normalizations, components = {}, [], []

    def proof(branch, name, body):
        repo = REPOS[branch]; disk = (repo / name).read_bytes()
        row = {'repository': branch, 'path': name, 'sha256': sha256(body).hexdigest(), 'url': 'https://github.com/copypasteltd/workmate/blob/' + branch + '/' + name}
        if body != disk:
            attr_normalization(repo, name, body, disk)
            row.update(qualified_working_sha256=sha256(disk).hexdigest(), transformation='declared_git_crlf_to_lf_only')
            normalizations.append({'repository': branch, 'path': name, 'working_sha256': row['qualified_working_sha256'], 'committed_sha256': row['sha256']})
        proofs[(branch, name)] = row

    for component, branch in MAP.items():
        repo = REPOS[branch]; assert not git(repo, 'status', '--porcelain'), component
        local = git(repo, 'branch', '--show-current').decode().strip(); assert local in [branch, 'codex/' + branch]
        baseline = next(c['commit'] for c in old['components'] if c['component'] == component)
        git(repo, 'merge-base', '--is-ancestor', baseline, 'HEAD')
        changed = [v.decode('utf-8') for v in git(repo, 'diff', '--name-only', '--diff-filter=ACM', '-z', baseline, 'HEAD').split(b'\0') if v]
        qualified = [Path(n).relative_to(Path('dev') / ('copypaste-' + component)).as_posix() for n in cp['source_files'] if n.startswith('dev/copypaste-' + component + '/')]
        names = sorted(set(changed + qualified)); blobs = committed_blobs(repo, names, cache)
        for name in names: proof(branch, name, blobs[name])
        components.append({'component': component, 'branch': branch, 'local_branch': local, 'directory': repo.relative_to(ROOT).as_posix(), 'commit': git(repo, 'rev-parse', 'HEAD').decode().strip(), 'tree': git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(), 'readmes': [{'path': n, 'sha256': digest(repo / n)} for n in ['README.md', 'README.en.md']], 'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    assert not git(ROOT, 'ls-files', '--others', '--exclude-standard'), 'Stage all supplemental documents first'
    names = [v.decode('utf-8') for v in git(ROOT, 'diff', '--cached', '--name-only', '--diff-filter=ACM', '-z').split(b'\0') if v]
    names = [n for n in names if n != 'docs/quality/workmate-publication.json' and not n.startswith('docs/quality/publication-proofs/stage120/')]
    blobs = staged_blobs(names, cache)
    for name in names: proof('docs', name, blobs[name])
    rows = list(proofs.values()); shards = write_shards(rows, ROOT, 120)
    # The original snapshot remains byte-for-byte retained. Existing live-path
    # entries advance exactly as in the legacy map; no historical identity vanishes.
    assert set(proofs).issuperset((r['repository'], r['path']) for r in prior_rows)
    unchanged = [r for r in prior_rows if proofs[(r['repository'], r['path'])] == r]
    result = {**old, **shards, 'at': datetime.now(timezone.utc).isoformat(), 'publication_encoding': 'sharded_utf8_json_all_proofs_retained',
        'previous_plan_sha256': digest(previous), 'scope': cp['scope'], 'components': components,
        'source_bindings_checked': {'current_files': len(cp['source_files']), 'selected_core': cp['selected_core'], 'extension_units': cp['extension_units'], 'selected_ui': cp['selected_ui'], 'client_builds': cp['client_builds'], 'retained_stage119': cp['retained_stage119']},
        'declared_git_line_ending_normalizations': normalizations, 'current_full_platform_regression_rerun': True,
        'full_regression_scope': cp['scope'],
        'integrated_recovery': {'checkpoint': ref(CP), 'documentation_audit': ref(audit_path), 'reviews': reviews,
            'backend_full_counts': cp['full_counts'], 'extension_counts': cp['counts'],
            'actual_ui_checks': cp['actual_ui_checks'], 'measured_layout_states': len(cp['layouts']),
            'selected_ui': cp['selected_ui'], 'retained_stage119': cp['retained_stage119']},
        'proof_sharding': {'previous_snapshot': ref(previous), 'previous_proofs': len(prior_rows), 'previous_rows_sha256': sha256(encoded(prior_rows)).hexdigest(), 'unchanged_previous_rows': len(unchanged), 'historical_identities_removed': 0, 'maximum_shard_bytes': 20 * 1024 * 1024, 'reader': ref(ROOT / 'docs/tools/publication_proofs.py'), 'publisher': ref(DEV / 'copypaste-delivery/scripts/publish-workmate-v3.mjs'), 'adversarial_test_cases': 7},
        'recording_scope': cp['recording_scope'],
        'verifier_sha256': digest(Path(__file__))}
    assert load_proofs(result, ROOT) == rows
    body = encoded(result); assert len(body) < 100 * 1024 * 1024
    MANIFEST.write_bytes(body)
    print(json.dumps({'status': result['status'], 'proofs': len(rows), 'shards': len(result['proof_shards']), 'sources': len(cp['source_files']), 'previous_proofs_retained': len(prior_rows)}))


def verify(report):
    value, cp = read(MANIFEST), read(CP)
    assert value['status'] == 'ready_for_remote_verification_sharded' and value['verifier_sha256'] == digest(Path(__file__))
    assert value['integrated_recovery']['checkpoint'] == ref(CP)
    assert cp['verifier_sha256'] == digest(ROOT / 'docs/tools/record_integrated_recovery.py')
    for review in value['integrated_recovery']['reviews'].values(): assert review == ref(ROOT / review['path'])
    previous = value['proof_sharding']['previous_snapshot']; assert previous == ref(ROOT / previous['path'])
    prior_rows = load_proofs(read(ROOT / previous['path']), ROOT); rows = load_proofs(value, ROOT)
    assert len(prior_rows) == value['proof_sharding']['previous_proofs'] and sha256(encoded(prior_rows)).hexdigest() == value['proof_sharding']['previous_rows_sha256']
    by_key = {(r['repository'], r['path']): r for r in rows}
    assert set(by_key).issuperset((r['repository'], r['path']) for r in prior_rows)
    assert sum(by_key[(r['repository'], r['path'])] == r for r in prior_rows) == value['proof_sharding']['unchanged_previous_rows']
    for name in ['reader', 'publisher']:
        r = value['proof_sharding'][name]; assert r == ref(ROOT / r['path'])
    groups, cache, heads, count, normalizations = {}, {}, {}, 0, 0
    for row in rows: groups.setdefault(row['repository'], []).append(row)
    for branch, repo in REPOS.items():
        assert not git(repo, 'status', '--porcelain'), branch
        heads[branch] = git(repo, 'rev-parse', 'HEAD').decode().strip(); selected = groups[branch]
        blobs = committed_blobs(repo, [r['path'] for r in selected], cache)
        for row in selected:
            body = blobs[row['path']]; assert sha256(body).hexdigest() == row['sha256'], (branch, row['path'])
            if row.get('transformation'):
                assert row['transformation'] == 'declared_git_crlf_to_lf_only'; disk = (repo / row['path']).read_bytes()
                assert sha256(disk).hexdigest() == row['qualified_working_sha256']; attr_normalization(repo, row['path'], body, disk); normalizations += 1
            count += 1
    names = ['docs/quality/workmate-publication.json'] + [r['path'] for r in value['proof_shards']]
    committed = committed_blobs(ROOT, names, cache)
    for name in names: assert committed[name] == (ROOT / name).read_bytes(), name
    for component in value['components']: assert component['commit'] == heads[component['branch']]
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'manifest_sha256': digest(MANIFEST), 'proofs_checked_from_actual_committed_git_blobs': count, 'proof_shards_checked': len(value['proof_shards']), 'previous_proofs_retained': len(prior_rows), 'historical_identities_removed': 0, 'current_source_files_rehashed': len(cp['source_files']), 'declared_normalizations_checked': normalizations, 'repositories': heads, 'unique_blobs': len(cache), 'scope': 'All actual HEAD proofs in seven clean independent repositories, every committed hash-bound shard and original historical proof identity, and current full-regression and attachment-recovery qualified sources; historical evidence keeps its original scope.', 'verifier_sha256': digest(Path(__file__))}
    if report:
        output = Path(report).resolve(); assert output.is_relative_to((DEV / 'copypaste-delivery/.data/publication').resolve()); output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf-8', newline='\n') as stream: json.dump(result, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({'status': 'passed', 'committed_proofs': count, 'shards': len(value['proof_shards']), 'sources': len(cp['source_files'])}))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['finalize', 'verify']); parser.add_argument('--report'); a = parser.parse_args()
    finalize() if a.action == 'finalize' else verify(a.report)
