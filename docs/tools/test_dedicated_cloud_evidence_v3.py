"""Adversarial checks for the portable, lossless evidence reader."""
from contextlib import ExitStack
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json
import unittest

import archive_dedicated_cloud_evidence_v3 as evidence

COUNTS = {'tests': 1, 'pass': 1, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
BASE = 'copypaste-delivery-cloud-121'


def tap():
    return 'TAP version 13\nok 1 - actual test\n1..1\n' + ''.join(f'# {key} {value}\n' for key, value in COUNTS.items())


class ArchiveFixture:
    def __init__(self, root):
        self.root = Path(root)
        self.out = self.root / 'docs/quality/dedicated-cloud-evidence-121'
        self.index = {'entries': {}, 'selected': {}}
        self.source = {'copypaste-platform-recovery-120/tests/a.test.ts': 'a' * 64}
        self.verifier = 'b' * 64

    def put(self, original, value):
        body = value.encode() if isinstance(value, str) else (json.dumps(value) + '\n').encode()
        digest = sha256(body).hexdigest()
        name = f'docs/quality/dedicated-cloud-evidence-121/blobs/{digest[:2]}/{digest}.blob'
        target = self.root / name; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        self.index['entries'][original] = {'sha256': digest, 'bytes': len(body), 'blob': name}
        return {'path': original.split('/', 1)[1], 'sha256': digest}

    def build(self):
        cleanup = {'status': 'passed', 'workers_exited': True, 'actual_filesystem_checked': True, 'results': [{'reclaimed': True}]}
        cleanup_ref = self.put(BASE + '/.data/cleanup.json', cleanup)
        marker = {**cleanup_ref, 'exit_code': 0}
        raw_ref = self.put(BASE + '/.data/a.tap', tap() + '# owned_fixture_cleanup ' + json.dumps(marker) + '\n')
        plan = {'test_files': ['tests/a.test.ts'], 'source_files': self.source, 'verifier_sha256': self.verifier, 'source_fingerprint': 'c' * 64}
        plan_ref = self.put(BASE + '/.data/plan.json', plan)
        epoch = {'id': '0001', 'plan_sha256': plan_ref['sha256'], 'files': plan['test_files']}
        epoch_ref = self.put(BASE + '/.data/epoch.json', epoch)
        closed = {'status': 'passed', 'native_port_closed': True, 'mode': 'actual_child_exit', 'database_started': True, 'database_exit': 0, 'checks': [{'exit_code': 0}], 'epoch': epoch_ref}
        closed_ref = self.put(BASE + '/.data/closed.json', closed)
        self.row = {'test_file': 'tests/a.test.ts', 'status': 'passed', 'exit_code': 0, 'source_unchanged': True,
                    'source_fingerprint': plan['source_fingerprint'], 'verifier_sha256': self.verifier,
                    'args': ['--env-file=.env', 'scripts/run-tests-owned.mjs', 'tests/a.test.ts'], 'epoch': '0001',
                    'raw_report': raw_ref, 'counts': COUNTS.copy(), 'fixture_cleanup': marker, 'fixture_cleanup_report': cleanup_ref}
        row_ref = self.put(BASE + '/.data/row.json', self.row)
        self.inventory = {'format': 'source_bound_complete_inventory_v2', 'plan': plan_ref,
                          'test_files': plan['test_files'], 'epochs': [closed_ref], 'file_receipts': [row_ref], 'counts': COUNTS.copy()}
        inventory_ref = self.put(BASE + '/.data/index.json', self.inventory)
        self.backend = {'verification_mode': self.inventory['format'], 'source_files': self.source, 'verifier_sha256': self.verifier,
                        'test_files': plan['test_files'], 'raw_report': inventory_ref, 'counts': COUNTS.copy()}
        self.put(BASE + '/.data/full.json', self.backend)
        self.index['selected']['backend'] = BASE + '/.data/full.json'
        for key in ['desktop_units', 'client_units', 'integrated_clients']:
            base = 'copypaste-delivery' if key == 'integrated_clients' else BASE
            ref = self.put(base + '/.data/' + key + '.tap', tap())
            original = base + '/.data/' + key + '.json'
            self.put(original, {'checks': [{'exit_code': 0, 'raw_report': ref, 'counts': COUNTS.copy()}]})
            self.index['selected'][key] = original
        for key in ['native_node_contracts', 'sqlite_deep_path']:
            ref = self.put(BASE + '/.data/' + key + '.tap', tap())
            original = BASE + '/.data/' + key + '.json'
            self.put(original, {'raw_report': ref, 'counts': COUNTS.copy()})
            self.index['selected'][key] = original
        return self

    def rewrite_row(self):
        ref = self.put(BASE + '/.data/row.json', self.row)
        self.inventory['file_receipts'] = [ref]
        ref = self.put(BASE + '/.data/index.json', self.inventory)
        self.backend['raw_report'] = ref
        self.put(BASE + '/.data/full.json', self.backend)


class EvidenceReaderTests(unittest.TestCase):
    def test_paths_reject_escape_and_windows_interpretations(self):
        for name in ['../x', '/x', 'a//b', 'a/./b', 'a/../b', 'C:/x', 'a\\b', 'a\nb', '']:
            with self.subTest(name=name), self.assertRaises(AssertionError): evidence.relative(name)

    def test_tap_requires_one_complete_passing_summary(self):
        self.assertEqual(evidence.parse_tap(tap(), 'valid'), COUNTS)
        for raw in [tap() + '# pass 1\n', tap().replace('# todo 0\n', ''), tap().replace('# pass 1', '# pass 0'),
                    tap().replace('# skipped 0', '# skipped 1'), tap().replace('# tests 1', '# tests 0'),
                    tap().replace('ok 1 - actual test', 'not ok 1 - actual test')]:
            with self.subTest(raw=raw), self.assertRaises(AssertionError): evidence.parse_tap(raw, 'forged')

    def test_portable_archive_independently_checks_all_raw_references(self):
        self.with_fixture(lambda fixture: evidence.verify_archived_reports(fixture.index))

    def test_tampered_blob_is_rejected(self):
        def check(fixture):
            item = fixture.index['entries'][BASE + '/.data/a.tap']
            (fixture.root / item['blob']).write_text('forged')
            with self.assertRaises(AssertionError): evidence.verify_archived_reports(fixture.index)
        self.with_fixture(check)

    def test_failed_child_cannot_become_green_by_rehashing_metadata(self):
        def check(fixture):
            fixture.row['exit_code'] = 1; fixture.rewrite_row()
            with self.assertRaises(AssertionError): evidence.verify_archived_reports(fixture.index)
        self.with_fixture(check)

    def test_wrong_cleanup_cannot_become_green_by_rehashing_metadata(self):
        def check(fixture):
            ref = fixture.put(BASE + '/.data/cleanup.json', {'status': 'passed', 'workers_exited': False, 'actual_filesystem_checked': True, 'results': []})
            fixture.row['fixture_cleanup_report'] = ref; fixture.row['fixture_cleanup'] = {**ref, 'exit_code': 0}
            fixture.row['raw_report'] = fixture.put(BASE + '/.data/a.tap', tap() + '# owned_fixture_cleanup ' + json.dumps(fixture.row['fixture_cleanup']) + '\n')
            fixture.rewrite_row()
            with self.assertRaises(AssertionError): evidence.verify_archived_reports(fixture.index)
        self.with_fixture(check)

    def test_omitting_an_inventory_file_is_rejected(self):
        def check(fixture):
            fixture.inventory['file_receipts'] = []
            fixture.backend['raw_report'] = fixture.put(BASE + '/.data/index.json', fixture.inventory)
            fixture.put(BASE + '/.data/full.json', fixture.backend)
            with self.assertRaises(AssertionError): evidence.verify_archived_reports(fixture.index)
        self.with_fixture(check)

    def with_fixture(self, action):
        parent = evidence.PRIMARY_DELIVERY / '.data/evidence-reader-tests'
        parent.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=parent) as directory, ExitStack() as stack:
            fixture = ArchiveFixture(directory).build()
            stack.enter_context(patch.object(evidence, 'ROOT', fixture.root))
            stack.enter_context(patch.object(evidence, 'OUT', fixture.out))
            action(fixture)


if __name__ == '__main__': unittest.main(verbosity=2)
