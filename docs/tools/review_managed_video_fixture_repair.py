"""Verify the exact harness-only repair and retain all earlier run boundaries."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
OUTPUT = ROOT / 'docs/quality/managed-video-fixture-repair-review.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def current(name):
    return ROOT / name if name.startswith(('dev/', 'docs/')) else DEV / name


def main():
    assert not OUTPUT.exists()
    archive_file = ROOT / 'docs/quality/history/stage81-before-fixture-port-repair/receipt.json'
    archive = read(archive_file)
    repaired = {}
    for row in archive['files']:
        before = ROOT / row['archive']
        assert digest(before) == row['sha256']
        old = before.read_bytes()
        if row['path'].endswith('capability-video-fixture.ts'):
            nl = b'\r\n' if b'\r\n' in old else b'\n'
            a = b'import { hash } from "../src/lib.js";' + nl
            substitutions = [(a, a + b'import { listenLoopbackHTTP } from "../src/loopback-http.js";' + nl),
                (b'  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));', b'  const port = await listenLoopbackHTTP(server);'),
                (b'origin: "http://127.0.0.1:" + (server.address() as any).port + "/v1"', b'origin: "http://127.0.0.1:" + port + "/v1"')]
        else:
            substitutions = [(b'    await started;', b'    await Promise.race([started, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Owned create request did not arrive")), 30000); timer.unref(); })]);')]
        for source, replacement in substitutions:
            assert old.count(source) == 1
            old = old.replace(source, replacement, 1)
        file = ROOT / row['path']
        assert old == file.read_bytes(), 'Only the recorded harness substitutions may change'
        name = file.relative_to(DEV).as_posix()
        repaired[name] = {'path': name, 'before_sha256': row['sha256'], 'after_sha256': digest(file), 'archive': row['archive']}
    assert len(repaired) == 2
    plan = read(DELIVERY / 'evidence/desktop-execution-control-29-plan.json')
    changes = {name for name, value in plan['source_files'].items() if digest(current(name)) != value}
    assert changes == set(repaired)
    selected = []
    for filename in ['managed-video-capabilities-04.json', 'managed-video-capability-ui-02.json']:
        file = DELIVERY / 'evidence' / filename
        report = read(file)
        assert report['status'] == 'passed' and report['source_unchanged']
        differences = []
        for name, value in report['source_files'].items():
            actual = digest(current(name))
            if actual == value:
                continue
            if name in repaired:
                assert value == repaired[name]['before_sha256'] and actual == repaired[name]['after_sha256']
                differences.append(repaired[name])
            else:
                assert filename == 'managed-video-capability-ui-02.json' and name == 'copypaste-platform/contracts/implemented-routes.json'
                route = read(ROOT / 'docs/quality/managed-video-route-inventory.json')
                assert value == route['before_sha256'] and actual == route['after_sha256']
        assert {row['path'] for row in differences} == set(repaired)
        selected.append({'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file), 'later_harness_differences': differences,
            'scope': 'All product source and the actual executed compatibility/UI verifier retain their bytes; only these two separately requalified test-harness files differ. UI also retains its separately reviewed descriptive route-inventory refresh.'})
    core_file = DELIVERY / 'evidence/managed-video-capabilities-05.json'
    core = read(core_file)
    assert core['status'] == 'passed' and core['source_unchanged'] and core['owned_database_shutdown']
    assert core['counts']['tests'] == core['counts']['pass'] == 17
    assert all(core['counts'][key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    for name, value in core['source_files'].items():
        assert digest(current(name)) == value, name
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'verified_harness_only_repair',
        'archive': {'path': archive_file.relative_to(ROOT).as_posix(), 'sha256': digest(archive_file)},
        'changed_files': list(repaired.values()), 'product_source_changes': 0, 'assertions_removed': 0, 'test_names_changed': 0,
        'current_harness_core': {'path': core_file.relative_to(ROOT).as_posix(), 'sha256': digest(core_file), 'tests': 17},
        'retained_compatibility_and_ui': selected,
        'scope': 'The failed 29/07 attempt remains failed. A fresh complete platform qualification must execute all 71 files/18 batches after the exact port/wait repair. No old passing batch is relabeled as the new run.',
        'verifier_sha256': digest(Path(__file__))}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'harness_files': 2, 'product_source_changes': 0, 'current_core_cases': 17}))


if __name__ == '__main__':
    main()
