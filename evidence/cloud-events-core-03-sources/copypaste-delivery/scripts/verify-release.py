"""Restore the local release bundles and check every artifact without network access."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import shutil
import stat
import subprocess
import tempfile
import zipfile

DELIVERY = Path(__file__).resolve().parents[1]
ROOT = DELIVERY.parent.resolve()
RELEASE = (DELIVERY / 'release').resolve()
MANIFEST = RELEASE / 'release-manifest.json'
REPORT = DELIVERY / 'evidence/release-restore.json'
checks = []


def git(directory, *args):
    return subprocess.check_output(['git', *args], cwd=directory, stderr=subprocess.PIPE)


def digest(file):
    checksum = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest()


data = json.loads(MANIFEST.read_text(encoding='utf-8'))
version = data['version']
temporary_root = (DELIVERY / '.data/release-restore').resolve()
if not temporary_root.is_relative_to((ROOT / 'copypaste-delivery/.data').resolve()):
    raise RuntimeError('Restore scratch directory escaped the delivery workspace')
temporary_root.mkdir(parents=True, exist_ok=True)
scratch = Path(tempfile.mkdtemp(prefix='verify-', dir=temporary_root)).resolve()
if not scratch.is_relative_to(temporary_root) or scratch == temporary_root:
    raise RuntimeError('Invalid restore target')
passed, failure, cleanup = False, None, False
try:
    artifacts = data['artifacts']
    if len(artifacts) != 11 or len(data['repositories']) != 6:
        raise RuntimeError('Expected six repositories and eleven release artifacts')
    for item in artifacts:
        file = (ROOT / item['file']).resolve()
        if not file.is_relative_to(RELEASE) or not file.is_file():
            raise RuntimeError('Artifact missing or outside the release directory')
        if file.stat().st_size != item['bytes'] or digest(file) != item['sha256']:
            raise RuntimeError(f'Artifact size/hash mismatch: {file.name}')
        check = {'artifact': file.name, 'status': 'passed', 'sha256_and_size': True}
        if file.suffix == '.zip':
            with zipfile.ZipFile(file) as archive:
                for name in archive.namelist():
                    target = (scratch / name).resolve()
                    if not target.is_relative_to(scratch):
                        raise RuntimeError('Archive contains an unsafe path')
                if archive.testzip() is not None:
                    raise RuntimeError(f'Archive CRC failure: {file.name}')
                if 'extension' in file.name:
                    manifest = json.loads(archive.read('manifest.json'))
                    if manifest['version'] != version or manifest['manifest_version'] != 3:
                        raise RuntimeError('Extension archive version/entry mismatch')
                elif 'index.html' not in archive.namelist():
                    raise RuntimeError('Static client entry is missing')
            check['zip_crc_and_entry'] = True
        checks.append(check)
    for repo in data['repositories']:
        name = repo['name']
        if Path(name).name != name or not name.startswith('copypaste-'):
            raise RuntimeError('Invalid repository name')
        bundle = RELEASE / f'{name}-{version}.bundle'
        git(DELIVERY, 'bundle', 'verify', str(bundle))
        target = (scratch / name).resolve()
        if not target.is_relative_to(scratch):
            raise RuntimeError('Invalid clone destination')
        git(scratch, 'clone', '--quiet', str(bundle), str(target))
        if git(target, 'rev-parse', 'HEAD').decode().strip() != repo['commit']:
            raise RuntimeError(f'Restored commit differs: {name}')
        if git(target, 'rev-parse', 'HEAD^{tree}').decode().strip() != repo['source_tree']:
            raise RuntimeError(f'Restored tree differs: {name}')
        if hashlib.sha256(git(target, 'ls-tree', '-rz', 'HEAD')).hexdigest() != repo['source_tree_index_sha256']:
            raise RuntimeError(f'Restored source index differs: {name}')
        if git(target, 'status', '--porcelain').strip():
            raise RuntimeError(f'Restored checkout is not clean: {name}')
        if git(target, 'branch', '--show-current').decode().strip() != repo['branch']:
            raise RuntimeError(f'Restored branch differs: {name}')
        for readme in ['README.md', 'README.en.md']:
            if not (target / readme).is_file():
                raise RuntimeError(f'Restored bilingual README is missing: {name}')
        checks.append({'repository': name, 'status': 'passed',
                       'offline_clone_commit_tree_index_and_clean_checkout': True})
    passed = True
except Exception as error:
    failure = str(error)
finally:
    # Delete only the unique scratch tree created above, after resolving its
    # boundary. Never remove a repository, release artifact or caller path.
    if scratch.is_relative_to(temporary_root) and scratch != temporary_root:
        try:
            def remove_readonly(function, filename, error):
                file = Path(filename).resolve()
                if not file.is_relative_to(scratch):
                    raise RuntimeError('Cleanup target escaped its owned scratch tree')
                if not isinstance(error[1], PermissionError):
                    raise error[1]
                file.chmod(stat.S_IWRITE | stat.S_IREAD)
                function(filename)
            shutil.rmtree(scratch, onerror=remove_readonly)
            cleanup = True
        except OSError:
            passed = False
            failure = 'Restore completed but the owned scratch directory could not be removed'
    REPORT.parent.mkdir(exist_ok=True)
    report = {'at': datetime.now(timezone.utc).isoformat(), 'version': version,
              'status': 'passed' if passed else 'failed',
              'scope': 'eleven artifact hashes, three ZIP CRC/entries and six actual offline Git restores',
              'manifest_sha256': digest(MANIFEST), 'checks': checks,
              'temporary_checkouts_removed': cleanup, 'network_used': False}
    if failure:
        report['failure'] = failure
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
if not passed:
    raise SystemExit(f'Release restore failed: {failure}')
print(f'Release {version}: eleven artifacts and six independent offline restores passed; scratch checkouts removed.')
