"""Verify repaired index bytes and unchanged quality objects against the actual scan."""
import argparse
from datetime import datetime, timezone
from hashlib import sha1, sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SCAN = ROOT / 'docs/quality/history/stage83-quality-bytes-before-repair.json'
ATTRIBUTE = 'docs/quality/history/stage83-geo-inventory-gap/dev/copypaste-delivery/scripts/.gitattributes'
ARCHIVE = 'docs/quality/history/stage83-geo-inventory-gap/dev/copypaste-delivery/scripts/qa-desktop-local.ts'


def git(*args):
    result = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', *args],
                            cwd=ROOT, capture_output=True, check=True)
    return result.stdout


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def blob_id(content):
    return sha1(b'blob ' + str(len(content)).encode('ascii') + b'\0' + content).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', default='geo-archive-byte-preservation-01.json')
    args = parser.parse_args()
    assert Path(args.report).name == args.report and args.report.endswith('.json')
    observed = read(SCAN)
    baseline = observed['repository_commit']
    assert baseline == '0c2e9cfcc854344e7d0093b3c588b2288d952862'
    old_tree = {}
    for entry in git('ls-tree', '-rz', baseline, '--', 'docs/quality').split(b'\0'):
        if entry:
            metadata, name = entry.split(b'\t', 1)
            mode, kind, oid = metadata.split()
            assert kind == b'blob' and mode == b'100644'
            old_tree[name.decode('utf-8')] = oid.decode('ascii')
    assert len(old_tree) == observed['files_checked'] == 7175
    index = {}
    for entry in git('ls-files', '--stage', '-z').split(b'\0'):
        if entry:
            metadata, name = entry.split(b'\t', 1)
            mode, oid, stage = metadata.split()
            assert stage == b'0'
            index[name.decode('utf-8')] = oid.decode('ascii')
    expected = {row['path'] for row in observed['mismatches']}
    assert len(expected) == 18 and ARCHIVE in expected
    changed = {name for name, oid in old_tree.items() if index.get(name) != oid}
    # The publication plan is a separately generated control file, never source evidence.
    assert changed - {'docs/quality/workmate-publication.json'} == expected
    rows, json_count = [], 0
    for item in observed['mismatches']:
        name = item['path']
        data = (ROOT / name).read_bytes()
        before = git('show', baseline + ':' + name)
        assert item['only_crlf_to_lf'] and digest(ROOT / name) == item['disk_sha256'], name
        assert b'\r\n' in data and before == data.replace(b'\r\n', b'\n'), name
        assert index[name] == blob_id(data) and old_tree[name] == blob_id(before), name
        attribute_values = git('check-attr', '--cached', '-z', 'text', 'filter', '--', name).split(b'\0')
        attrs = {attribute_values[i + 1].decode(): attribute_values[i + 2].decode()
                 for i in range(0, len(attribute_values) - 1, 3)}
        assert attrs == {'text': 'unset', 'filter': 'unspecified'}, (name, attrs)
        if name.endswith('.json'):
            assert json.loads(data) == json.loads(before), name
            json_count += 1
        rows.append({'path': name, 'original_working_sha256': item['disk_sha256'],
                     'previous_normalized_blob': old_tree[name], 'exact_index_blob': index[name],
                     'working_bytes_unchanged': True, 'only_prior_crlf_to_lf_conversion': True})
    captured = read(ROOT / 'docs/quality/history/stage83-geo-inventory-gap/receipt.json')
    assert any(item['archive'] == ARCHIVE and item['sha256'] == digest(ROOT / ARCHIVE)
               for item in captured['files'])
    metadata = (ROOT / ATTRIBUTE).read_bytes()
    assert index[ATTRIBUTE] == blob_id(metadata) and b'* -text whitespace=cr-at-eol\n' in metadata
    assert not any(item['archive'] == ATTRIBUTE for item in captured['files'])
    publication = read(ROOT / 'docs/quality/workmate-publication.json')
    components = []
    for item in publication['components']:
        repo = ROOT / item['directory']
        prefix = ['-C', str(repo)]
        assert git(*prefix, 'rev-parse', 'HEAD').decode().strip() == item['commit']
        assert not git(*prefix, 'status', '--porcelain'), item['component']
        components.append({'component': item['component'], 'commit': item['commit'], 'clean': True})
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed_exact_byte_preservation',
              'baseline_commit': baseline, 'initial_scan': {'path': SCAN.relative_to(ROOT).as_posix(),
                  'sha256': digest(SCAN), 'quality_files_read': 7175, 'mismatches_found': 18},
              'verification_strategy': 'The initial actual read-only scan compared all 7175 working quality files to their committed Git object IDs. This follow-up verifies all 18 exact repairs against those original bytes and confirms every other baseline quality index object is unchanged, except the explicitly regenerated publication control plan. No second whole-disk scan is claimed.',
              'unchanged_original_quality_objects': len(old_tree) - len(changed),
              'restored_files': rows, 'json_documents_semantically_equal': json_count,
              'working_original_bytes_changed': False,
              'generated_preservation_metadata': {'path': ATTRIBUTE, 'sha256': digest(ROOT / ATTRIBUTE),
                  'scope': 'New archive preservation metadata; not an original captured source. The captured parent attributes remain byte-exact.'},
              'components_unchanged': components, 'product_tests_rerun': False,
              'product_test_scope': 'No product/runtime or test byte changed. Existing bound core/client/native/full-regression receipts remain valid within their declared scopes.',
              'verifier_sha256': digest(Path(__file__))}
    with (ROOT / 'docs/quality' / args.report).open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'restored_files': len(rows),
                      'unchanged_original_quality_objects': result['unchanged_original_quality_objects'],
                      'json_documents_semantically_equal': json_count, 'components_unchanged': len(components)}))


if __name__ == '__main__':
    main()
