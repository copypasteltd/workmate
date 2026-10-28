"""Preserve every historical proof identity and bind bounded runtime startup delivery."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import contextlib
import io
import json

from record_audio_accounting_v2 import ROOT, DEV, QUALITY, read, ref, digest, git
from finalize_cloud_schedules_manifest import REPOS, attr_normalization
from finalize_desktop_company_tool_manifest import MAP
from finalize_desktop_browser_manifest import committed_blobs
from finalize_native_pairings import staged_blobs
from publication_proofs import load_proofs, write_shards, encoded

MANIFEST = QUALITY / 'workmate-publication.json'
CP = QUALITY / 'runtime-startup-checkpoint-122.json'
PREVIOUS = QUALITY / 'history/stage122-previous-publication.json'


def checkpoint():
    cp = read(CP)
    assert cp['status'] == 'verified_bounded_runtime_startup_delivery'
    assert cp['verifier_sha256'] == digest(ROOT / 'docs/tools/record_runtime_startup_checkpoint.py')
    assert cp['previous_publication'] == ref(PREVIOUS)
    assert cp['current_full_platform_regression_rerun'] is False
    assert cp['original_full_acceptance_open'] == 102 and cp['fully_accepted'] == 0
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected, name
    import archive_runtime_startup_evidence as evidence
    with contextlib.redirect_stdout(io.StringIO()):
        evidence.verify(True)
    assert cp['evidence_index'] == ref(evidence.INDEX)
    # The older full run is historical. Its current-source check must not be
    # applied to a newer runtime and its passing totals must not be relabeled.
    assert cp['historical_full_regression'] == ref(QUALITY / 'dedicated-cloud-checkpoint.json')
    import archive_dedicated_cloud_evidence_v3 as historical
    with contextlib.redirect_stdout(io.StringIO()):
        historical.verify(False)
    return cp


def finalize():
    cp = checkpoint()
    assert MANIFEST.read_bytes() == PREVIOUS.read_bytes()
    old = read(PREVIOUS)
    prior_rows = load_proofs(old, ROOT)
    proofs = {(row['repository'], row['path']): row for row in prior_rows}
    cache, normalizations, components = {}, [], []

    def proof(branch, name, body):
        repo = REPOS[branch]
        disk = (repo / name).read_bytes()
        row = {'repository': branch, 'path': name, 'sha256': sha256(body).hexdigest(),
               'url': 'https://github.com/copypasteltd/workmate/blob/' + branch + '/' + name}
        if body != disk:
            attr_normalization(repo, name, body, disk)
            row.update(qualified_working_sha256=sha256(disk).hexdigest(), transformation='declared_git_crlf_to_lf_only')
            normalizations.append({'repository': branch, 'path': name,
                                   'working_sha256': row['qualified_working_sha256'], 'committed_sha256': row['sha256']})
        proofs[(branch, name)] = row

    for component, branch in MAP.items():
        repo = REPOS[branch]
        assert not git(repo, 'status', '--porcelain'), component
        local = git(repo, 'branch', '--show-current').decode().strip()
        assert local in [branch, 'codex/' + branch]
        baseline = next(c['commit'] for c in old['components'] if c['component'] == component)
        git(repo, 'merge-base', '--is-ancestor', baseline, 'HEAD')
        changed = [name.decode('utf-8') for name in git(repo, 'diff', '--name-only', '--diff-filter=ACM', '-z', baseline, 'HEAD').split(b'\0') if name]
        prefix = 'dev/copypaste-' + component + '/'
        qualified = [name.removeprefix(prefix) for name in cp['source_files'] if name.startswith(prefix)]
        names = sorted(set(changed + qualified))
        blobs = committed_blobs(repo, names, cache)
        for name in names:
            proof(branch, name, blobs[name])
        components.append({'component': component, 'branch': branch, 'local_branch': local,
                           'directory': repo.relative_to(ROOT).as_posix(),
                           'commit': git(repo, 'rev-parse', 'HEAD').decode().strip(),
                           'tree': git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(),
                           'readmes': [{'path': name, 'sha256': digest(repo / name)} for name in ['README.md', 'README.en.md']],
                           'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    assert not git(ROOT, 'ls-files', '--others', '--exclude-standard'), 'Stage every new central document first'
    # Documentation-only publications after Stage120 are part of this manifest,
    # even though they were already committed before the current index changes.
    baseline = git(ROOT, 'rev-list', '-n', '1', 'HEAD', '--', 'docs/quality/workmate-publication.json').decode().strip()
    assert git(ROOT, 'show', baseline + ':docs/quality/workmate-publication.json') == PREVIOUS.read_bytes()
    committed_changes = git(ROOT, 'diff', '--name-only', '--diff-filter=ACM', '-z', baseline, 'HEAD')
    staged_changes = git(ROOT, 'diff', '--cached', '--name-only', '--diff-filter=ACM', '-z')
    names = sorted({name.decode('utf-8') for name in (committed_changes + staged_changes).split(b'\0') if name})
    names = [name for name in names if name != 'docs/quality/workmate-publication.json' and not name.startswith('docs/quality/publication-proofs/stage122/')]
    blobs = staged_blobs(names, cache)
    for name in names:
        proof('docs', name, blobs[name])
    rows = list(proofs.values())
    shards = write_shards(rows, ROOT, 122)
    assert set(proofs).issuperset((row['repository'], row['path']) for row in prior_rows)
    unchanged = sum(proofs[(row['repository'], row['path'])] == row for row in prior_rows)
    result = {**old, **shards, 'at': datetime.now(timezone.utc).isoformat(),
              'publication_encoding': 'sharded_utf8_json_all_proofs_retained',
              'previous_plan_sha256': digest(PREVIOUS), 'scope': cp['scope'], 'components': components,
              'source_bindings_checked': {'current_files': len(cp['source_files']), 'evidence_index': cp['evidence_index']},
              'declared_git_line_ending_normalizations': normalizations,
              'current_full_platform_regression_rerun': False,
              'full_regression_scope': 'Historical Stage 121 full run; no new full platform run in Stage 122',
              'runtime_startup': {'checkpoint': ref(CP), 'evidence_index': cp['evidence_index'],
                                  'counts': cp['counts'], 'original_full_acceptance_open': 102,
                                  'actual_linux_host_qualified': False, 'live_provider_qualified': False},
              'dedicated_cloud': {**old['dedicated_cloud'], 'historical_source_version': True},
              'historical_dedicated_cloud': old['dedicated_cloud'],
              'proof_sharding': {'previous_snapshot': ref(PREVIOUS), 'previous_proofs': len(prior_rows),
                                 'previous_rows_sha256': sha256(encoded(prior_rows)).hexdigest(),
                                 'unchanged_previous_rows': unchanged, 'historical_identities_removed': 0,
                                 'maximum_shard_bytes': 20 * 1024 * 1024,
                                 'reader': ref(ROOT / 'docs/tools/publication_proofs.py'),
                                 'publisher': ref(DEV / 'copypaste-delivery/scripts/publish-workmate-v5.mjs'),
                                 'adversarial_test_cases': 7, 'previous_root_manifest_commit': baseline},
              'recording_scope': cp['scope'], 'verifier_sha256': digest(Path(__file__))}
    assert load_proofs(result, ROOT) == rows
    body = encoded(result)
    assert len(body) < 100 * 1024 * 1024
    MANIFEST.write_bytes(body)
    print(json.dumps({'status': result['status'], 'proofs': len(rows), 'shards': len(result['proof_shards']),
                      'sources': len(cp['source_files']), 'previous_proofs_retained': len(prior_rows)}))


def verify(report=None):
    cp = checkpoint()
    value = read(MANIFEST)
    assert value['status'] == 'ready_for_remote_verification_sharded'
    assert value['verifier_sha256'] == digest(Path(__file__))
    assert value['runtime_startup']['checkpoint'] == ref(CP)
    assert value['runtime_startup']['evidence_index'] == cp['evidence_index']
    assert value['runtime_startup']['counts'] == cp['counts']
    assert value['current_full_platform_regression_rerun'] is False
    assert value['proof_sharding']['previous_snapshot'] == ref(PREVIOUS)
    prior_rows = load_proofs(read(PREVIOUS), ROOT)
    rows = load_proofs(value, ROOT)
    assert len(prior_rows) == value['proof_sharding']['previous_proofs']
    assert sha256(encoded(prior_rows)).hexdigest() == value['proof_sharding']['previous_rows_sha256']
    by_key = {(row['repository'], row['path']): row for row in rows}
    assert set(by_key).issuperset((row['repository'], row['path']) for row in prior_rows)
    assert sum(by_key[(row['repository'], row['path'])] == row for row in prior_rows) == value['proof_sharding']['unchanged_previous_rows']
    for name in ['reader', 'publisher']:
        item = value['proof_sharding'][name]
        assert item == ref(ROOT / item['path'])
    groups, cache, heads, count, normalizations = {}, {}, {}, 0, 0
    for row in rows:
        groups.setdefault(row['repository'], []).append(row)
    for branch, repo in REPOS.items():
        assert not git(repo, 'status', '--porcelain'), branch
        heads[branch] = git(repo, 'rev-parse', 'HEAD').decode().strip()
        selected = groups[branch]
        blobs = committed_blobs(repo, [row['path'] for row in selected], cache)
        for row in selected:
            body = blobs[row['path']]
            assert sha256(body).hexdigest() == row['sha256'], (branch, row['path'])
            if row.get('transformation'):
                assert row['transformation'] == 'declared_git_crlf_to_lf_only'
                disk = (repo / row['path']).read_bytes()
                assert sha256(disk).hexdigest() == row['qualified_working_sha256']
                attr_normalization(repo, row['path'], body, disk)
                normalizations += 1
            count += 1
    names = ['docs/quality/workmate-publication.json'] + [row['path'] for row in value['proof_shards']]
    committed = committed_blobs(ROOT, names, cache)
    for name in names:
        assert committed[name] == (ROOT / name).read_bytes(), name
    for component in value['components']:
        assert component['commit'] == heads[component['branch']]
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
              'manifest_sha256': digest(MANIFEST), 'proofs_checked_from_actual_committed_git_blobs': count,
              'proof_shards_checked': len(value['proof_shards']), 'previous_proofs_retained': len(prior_rows),
              'historical_identities_removed': 0, 'current_source_files_rehashed': len(cp['source_files']),
              'declared_normalizations_checked': normalizations, 'repositories': heads,
              'unique_blobs': len(cache), 'scope': cp['scope'], 'verifier_sha256': digest(Path(__file__))}
    if report:
        output = Path(report).resolve()
        assert output.is_relative_to((DEV / 'copypaste-delivery/.data/publication').resolve())
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
    print(json.dumps({'status': 'passed', 'committed_proofs': count, 'shards': len(value['proof_shards']), 'sources': len(cp['source_files'])}))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['finalize', 'verify'])
    parser.add_argument('--report')
    args = parser.parse_args()
    finalize() if args.action == 'finalize' else verify(args.report)
