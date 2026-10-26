"""Finalize the managed audio releases from actual index/HEAD objects."""
from pathlib import Path
from hashlib import sha1, sha256
from datetime import datetime, timezone
import argparse
import json
import subprocess
from record_managed_audio import ROOT, DEV, QUALITY, CP, BASE, read, ref, digest, git
from finalize_cloud_schedules_manifest import REPOS, attr_normalization
from finalize_desktop_company_tool_manifest import MAP
from finalize_desktop_browser_manifest import committed_blobs

MANIFEST = QUALITY / 'workmate-publication.json'


def staged_blobs(names, cache):
    index = {}
    for entry in git(ROOT, 'ls-files', '--stage', '-z').split(b'\0'):
        if entry:
            metadata, _, name = entry.partition(b'\t')
            mode, oid, stage = metadata.split()
            assert stage == b'0'
            index[name.decode('utf-8')] = oid.decode()
    pending = list(dict.fromkeys(index[n] for n in names if index[n] not in cache))
    if pending:
        result = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-c',
                                 'core.untrackedCache=false', 'cat-file', '--batch'],
                                cwd=ROOT, input=('\n'.join(pending) + '\n').encode(), capture_output=True, check=True)
        output, offset = result.stdout, 0
        for oid in pending:
            end = output.index(b'\n', offset)
            actual, kind, size = output[offset:end].split()
            assert actual.decode() == oid and kind == b'blob'
            size = int(size)
            offset = end + 1
            body = output[offset:offset + size]
            assert len(body) == size and output[offset + size:offset + size + 1] == b'\n'
            algorithm = sha1 if len(oid) == 40 else sha256
            assert algorithm(b'blob ' + str(size).encode() + b'\0' + body).hexdigest() == oid
            cache[oid] = body
            offset += size + 1
        assert offset == len(output)
    return {name: cache[index[name]] for name in names}


def finalize():
    cp = read(CP)
    audit_path = QUALITY / 'managed-audio-docs-audit-01.json'
    audit = read(audit_path)
    assert cp['status'] == 'verified_managed_audio' and audit['status'] == 'passed'
    assert cp['verifier_sha256'] == digest(ROOT / 'docs/tools/record_managed_audio.py')
    assert audit['checkpoint'] == ref(CP)
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected, name
    reviews = {}
    for name, tool in [('desktop-browser-staged-credentials-51.json', 'scan_desktop_browser_staged_credentials.py'),
                       ('audio-whitespace-01.json', 'record_managed_audio_whitespace.py'),
                       ('archive-link-audit-35.json', 'audit_archive_links.py')]:
        path = QUALITY / name
        value = read(path)
        assert value['status'] == 'passed' and value['verifier_sha256'] == digest(ROOT / 'docs/tools' / tool)
        reviews[name] = ref(path)
    old = read(MANIFEST)
    previous = QUALITY / 'history/stage108-previous-publication.json'
    assert not previous.exists()
    previous.write_bytes(MANIFEST.read_bytes())
    git(ROOT, 'add', '--', previous.relative_to(ROOT).as_posix())
    proofs = {(r['repository'], r['path']): r for r in old['proofs']}
    cache, normalizations, components = {}, [], []

    def proof(branch, name, body):
        repo = REPOS[branch]
        disk = (repo / name).read_bytes()
        row = {'repository': branch, 'path': name, 'sha256': sha256(body).hexdigest(),
               'url': 'https://github.com/copypasteltd/workmate/blob/' + branch + '/' + name}
        if body != disk:
            attr_normalization(repo, name, body, disk)
            row.update(qualified_working_sha256=sha256(disk).hexdigest(), transformation='declared_git_crlf_to_lf_only')
            normalizations.append({'repository': branch, 'path': name, 'working_sha256': row['qualified_working_sha256'], 'committed_sha256': row['sha256']})
        proofs[(branch, name)] = row

    for component, branch in MAP.items():
        repo = REPOS[branch]
        assert not git(repo, 'status', '--porcelain'), component
        local = git(repo, 'branch', '--show-current').decode().strip()
        assert local in [branch, 'codex/' + branch]
        changed = [v.decode('utf-8') for v in git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').split(b'\0') if v]
        qualified = [Path(n).relative_to(Path('dev') / ('copypaste-' + component)).as_posix() for n in cp['source_files'] if n.startswith('dev/copypaste-' + component + '/')]
        names = sorted(set(changed + qualified))
        blobs = committed_blobs(repo, names, cache)
        for name in names:
            proof(branch, name, blobs[name])
        components.append({'component': component, 'branch': branch, 'local_branch': local,
                           'directory': repo.relative_to(ROOT).as_posix(),
                           'commit': git(repo, 'rev-parse', 'HEAD').decode().strip(),
                           'tree': git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(),
                           'readmes': [{'path': n, 'sha256': digest(repo / n)} for n in ['README.md', 'README.en.md']],
                           'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    assert not git(ROOT, 'ls-files', '--others', '--exclude-standard'), 'Stage all supplemental documentation first'
    names = [v.decode('utf-8') for v in git(ROOT, 'diff', '--cached', '--name-only', '--diff-filter=ACM', '-z').split(b'\0') if v]
    names = [n for n in names if n != 'docs/quality/workmate-publication.json']
    blobs = staged_blobs(names, cache)
    for name in names:
        proof('docs', name, blobs[name])
    result = {**old, 'at': datetime.now(timezone.utc).isoformat(), 'status': 'ready_for_remote_verification',
              'previous_plan_sha256': digest(previous), 'scope': cp['scope'], 'components': components,
              'source_bindings_checked': {'current_files': len(cp['source_files']), 'selected_core': cp['selected_positive'], 'selected_ui': cp['selected_ui'], 'compiled_build_probe': cp['compiled_build_probe'], 'post_core_asset_packaging_correction': cp['post_core_asset_packaging_correction'], 'retained_stage106': cp['retained_stage106']},
              'declared_git_line_ending_normalizations': normalizations,
              'current_full_platform_regression_rerun': False,
              'full_regression_scope': 'Stage108 runs twelve affected backend suites, six Admin form checks and eight actual browser flows including the background Worker and original crashed POST. Stage107 and Stage106 retain their original source/time, including the unattributed full-run timeout and passing unchanged two-case replay. Synthetic models/accounts and protocol tones; no live audio quality or complete-product acceptance.',
              'managed_audio': {'checkpoint': ref(CP), 'documentation_audit': ref(audit_path), 'reviews': reviews,
                                      'tests': cp['tests'], 'admin_tests': cp['admin_tests'], 'actual_ui_checks': cp['actual_ui_checks'], 'selected_positive': cp['selected_positive'], 'selected_ui': cp['selected_ui'], 'compiled_build_probe': cp['compiled_build_probe'], 'retained_stage106': cp['retained_stage106'], 'new_UI_recordings': len(cp['recordings'])},
              'proofs': list(proofs.values()), 'verifier_sha256': digest(Path(__file__))}
    MANIFEST.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'ready_for_remote_verification', 'proofs': len(proofs), 'sources': len(cp['source_files'])}))


def verify(report):
    value, cp = read(MANIFEST), read(CP)
    assert value['status'] == 'ready_for_remote_verification'
    assert value['verifier_sha256'] == digest(Path(__file__))
    assert value['managed_audio']['checkpoint'] == ref(CP)
    assert cp['verifier_sha256'] == digest(ROOT / 'docs/tools/record_managed_audio.py')
    for review in value['managed_audio']['reviews'].values():
        assert review == ref(ROOT / review['path'])
    groups, cache, heads, count, normalizations = {}, {}, {}, 0, 0
    for row in value['proofs']:
        groups.setdefault(row['repository'], []).append(row)
    for branch, repo in REPOS.items():
        assert not git(repo, 'status', '--porcelain'), branch
        heads[branch] = git(repo, 'rev-parse', 'HEAD').decode().strip()
        rows = groups[branch]
        blobs = committed_blobs(repo, [r['path'] for r in rows], cache)
        for row in rows:
            body = blobs[row['path']]
            assert sha256(body).hexdigest() == row['sha256'], (branch, row['path'])
            if row.get('transformation'):
                assert row['transformation'] == 'declared_git_crlf_to_lf_only'
                disk = (repo / row['path']).read_bytes()
                assert sha256(disk).hexdigest() == row['qualified_working_sha256']
                attr_normalization(repo, row['path'], body, disk)
                normalizations += 1
            count += 1
    assert committed_blobs(ROOT, ['docs/quality/workmate-publication.json'], cache)['docs/quality/workmate-publication.json'] == MANIFEST.read_bytes()
    for component in value['components']:
        assert component['commit'] == heads[component['branch']]
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected, name
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
              'manifest_sha256': digest(MANIFEST), 'proofs_checked_from_actual_committed_git_blobs': count,
              'current_source_files_rehashed': len(cp['source_files']), 'declared_normalizations_checked': normalizations,
              'repositories': heads, 'unique_blobs': len(cache),
              'scope': 'All actual HEAD objects and seven clean repositories; current qualification sources and all declared normalizations rehashed. Historical checkout copies are covered by content-addressed HEAD objects and clean indexes.',
              'verifier_sha256': digest(Path(__file__))}
    if report:
        output = Path(report).resolve()
        assert output.is_relative_to((DEV / 'copypaste-delivery/.data/publication').resolve())
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
    print(json.dumps({'status': 'passed', 'committed_proofs': count, 'sources': len(cp['source_files'])}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['finalize', 'verify'])
    parser.add_argument('--report')
    args = parser.parse_args()
    finalize() if args.action == 'finalize' else verify(args.report)
