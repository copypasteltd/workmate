"""Repair declared LF normalization; verify every actual HEAD blob and current source.

Historical checkout copies need not be read again: all seven repositories must
be clean, and each published content digest is checked against its HEAD blob.
Current qualification sources and every declared normalization are also read
from disk. No product source or frozen verifier is changed.
"""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import subprocess
from finalize_desktop_browser_manifest import committed_blobs
from finalize_cloud_schedules_manifest import REPOS, ROOT, DEV, QUALITY, attr_normalization

MANIFEST = QUALITY / 'workmate-publication.json'
REPORT = QUALITY / 'cloud-schedule-publication-repair-01.json'
ARCHIVE = QUALITY / 'history/stage104-publication-line-endings'


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c',
                                    'core.untrackedCache=false', *args], cwd=repo)


def digest(data):
    return sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def reference(path):
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path.read_bytes())}


def write(path, value, exclusive=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x' if exclusive else 'w', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def staged_roots():
    raw = git(ROOT, 'diff', '--cached', '--name-only', '--diff-filter=ACM', '-z')
    raw += git(ROOT, 'ls-files', '--others', '--exclude-standard', '-z')
    return sorted({v.decode('utf-8') for v in raw.split(b'\0') if v})


def root_proof(path, body):
    disk = (ROOT / path).read_bytes()
    result = {'repository': 'docs', 'path': path, 'sha256': digest(body),
              'url': 'https://github.com/copypasteltd/workmate/blob/docs/' + path}
    if body != disk:
        attr_normalization(ROOT, path, body, disk)
        result.update(qualified_working_sha256=digest(disk),
                      transformation='declared_git_crlf_to_lf_only')
    return result


def repair():
    assert not REPORT.exists() and not ARCHIVE.exists()
    current = read(MANIFEST)
    roots = [r for r in current['proofs'] if r['repository'] == 'docs']
    blobs = committed_blobs(ROOT, [r['path'] for r in roots], {})
    changes = []
    proofs = {(r['repository'], r['path']): r for r in current['proofs']}
    for row in roots:
        body = blobs[row['path']]
        if digest(body) == row['sha256']:
            continue
        disk = (ROOT / row['path']).read_bytes()
        assert digest(disk) == row['sha256'], row['path']
        attr_normalization(ROOT, row['path'], body, disk)
        replacement = root_proof(row['path'], body)
        proofs[('docs', row['path'])] = replacement
        changes.append({'path': row['path'], 'before': row['sha256'],
                        'committed': replacement['sha256'],
                        'working': replacement['qualified_working_sha256']})
    assert {r['path'] for r in changes} == {
        'docs/tools/finalize_cloud_schedules_manifest.py',
        'docs/tools/record_cloud_schedule_whitespace.py',
        'docs/tools/record_cloud_schedules.py'}
    ARCHIVE.mkdir()
    before = MANIFEST.read_bytes()
    saved = ARCHIVE / 'publication.json'
    saved.write_bytes(before)
    write(ARCHIVE / 'receipt.json', {'files': [{
        'path': MANIFEST.relative_to(ROOT).as_posix(),
        'archive': saved.relative_to(ROOT).as_posix(), 'before_sha256': digest(before)}]})
    write(REPORT, {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
                  'prior_manifest': reference(saved), 'changes': changes,
                  'scope': 'Only three declared text:auto/eol:lf CRLF-to-LF transformations. '
                           'Working bytes, product sources and frozen verifiers are preserved.',
                  'verifier_sha256': digest(Path(__file__).read_bytes())})
    current['proofs'] = list(proofs.values())
    current['publication_line_ending_repair'] = {
        'report': reference(REPORT), 'tool': reference(Path(__file__)),
        'verification': 'Every actual committed HEAD blob; clean repositories; '
                        'current qualification sources and declared normalization bytes rehashed.'}
    write(MANIFEST, current, exclusive=False)
    print(json.dumps({'status': 'repaired', 'normalizations': len(changes)}))


def bind():
    current = read(MANIFEST)
    assert read(REPORT)['verifier_sha256'] == digest(Path(__file__).read_bytes())
    reviews = {}
    for name, tool in [
        ('desktop-browser-staged-credentials-47.json', 'scan_desktop_browser_staged_credentials.py'),
        ('cloud-schedule-whitespace-02.json', 'record_cloud_schedule_whitespace.py'),
        ('archive-link-audit-31.json', 'audit_archive_links.py')]:
        path = QUALITY / name
        value = read(path)
        assert value['status'] == 'passed'
        assert value['verifier_sha256'] == digest((QUALITY.parent / 'tools' / tool).read_bytes())
        reviews[name] = reference(path)
    proofs = {(r['repository'], r['path']): r for r in current['proofs']}
    for name in staged_roots():
        if name == 'docs/quality/workmate-publication.json':
            continue
        # This action is run after staging all supplemental files. Read the
        # selected index objects, including Git's declared LF normalization.
        body = git(ROOT, 'show', ':' + name)
        proofs[('docs', name)] = root_proof(name, body)
    current['proofs'] = list(proofs.values())
    current['publication_line_ending_repair']['reviews'] = reviews
    current['at'] = datetime.now(timezone.utc).isoformat()
    write(MANIFEST, current, exclusive=False)
    print(json.dumps({'status': 'bound', 'proofs': len(proofs)}))


def verify(report):
    current = read(MANIFEST)
    assert current['status'] == 'ready_for_remote_verification'
    fix = current['publication_line_ending_repair']
    assert fix['tool'] == reference(Path(__file__)) and fix['report'] == reference(REPORT)
    for value in fix['reviews'].values():
        assert reference(ROOT / value['path']) == value
    groups = {}
    for row in current['proofs']:
        groups.setdefault(row['repository'], []).append(row)
    cache, count, normalizations, heads = {}, 0, 0, {}
    for branch, repo in REPOS.items():
        assert not git(repo, 'status', '--porcelain'), branch
        heads[branch] = git(repo, 'rev-parse', 'HEAD').decode().strip()
        rows = groups[branch]
        blobs = committed_blobs(repo, [r['path'] for r in rows], cache)
        for row in rows:
            body = blobs[row['path']]
            assert digest(body) == row['sha256'], (branch, row['path'])
            if row.get('transformation'):
                assert row['transformation'] == 'declared_git_crlf_to_lf_only'
                disk = (repo / row['path']).read_bytes()
                assert digest(disk) == row['qualified_working_sha256']
                attr_normalization(repo, row['path'], body, disk)
                normalizations += 1
            count += 1
    for component in current['components']:
        assert component['commit'] == heads[component['branch']]
    cp = read(QUALITY / 'private-cloud-schedules-checkpoint.json')
    for name, expected in cp['source_files'].items():
        assert digest((ROOT / name).read_bytes()) == expected, name
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
              'manifest_sha256': digest(MANIFEST.read_bytes()),
              'proofs_checked_from_actual_committed_git_blobs': count,
              'current_source_files_rehashed': len(cp['source_files']),
              'declared_normalizations_checked': normalizations,
              'repositories': heads, 'unique_blobs': len(cache),
              'scope': 'All actual HEAD objects, seven clean repositories, all current '
                       'qualification source bytes and every declared normalization. '
                       'Historical checkout copies are covered by clean Git indexes and '
                       'the same content-addressed HEAD objects, not re-read individually.',
              'verifier_sha256': digest(Path(__file__).read_bytes())}
    if report:
        output = Path(report).resolve()
        assert output.is_relative_to((DEV / 'copypaste-delivery/.data/publication').resolve())
        write(output, result)
    print(json.dumps({'status': 'passed', 'committed_proofs': count,
                      'sources': len(cp['source_files']), 'normalizations': normalizations}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['repair', 'bind', 'verify'])
    parser.add_argument('--report')
    args = parser.parse_args()
    {'repair': repair, 'bind': bind, 'verify': lambda: verify(args.report)}[args.action]()
