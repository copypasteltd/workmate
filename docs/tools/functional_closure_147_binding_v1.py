"""Bind a targeted test-context correction without repeating unchanged product checks.

The failed original TAP remains failed. Ninety-two existing checks on identical
product bytes and three current concurrency checks are separate executions.
"""
from pathlib import Path
from hashlib import sha256
import json
import re

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / 'dev/copypaste-delivery'
RAW = DELIVERY / 'evidence/functional-closure-147'
ADDED_TEST = 'copypaste-platform/tests/task-local-handoff-concurrency-147-v2.test.ts'
BASELINE = 'backend-10'
EXPECTED_FAILURES = {
    "a heartbeat waiting on the real native child cannot make its owner's source manifest fail NOWAIT",
    'handoff withdrawal waits for actual authorization readers and still denies later native inference without another fee',
}
sha = lambda body: sha256(body).hexdigest()
read = lambda path: json.loads(path.read_bytes())


def report(stem):
    path = RAW / (stem + '.json')
    row = read(path)
    for key in ['source_manifest', 'raw_report', 'verifier']:
        item = row[key]
        assert sha((DELIVERY / item['path']).read_bytes()) == item['sha256']
    assert row['source_unchanged'] and row['owned_database_shutdown']
    assert row['owned_database_port_closed']
    assert row['fixture_cleanup']['status'] == 'passed' and row['fixture_cleanup']['exit_code'] == 0
    assert all(item['exit_code'] == 0 for item in row['checks'])
    return row, read(DELIVERY / row['source_manifest']['path'])


def counts(row):
    text = (DELIVERY / row['raw_report']['path']).read_text(encoding='utf-8')
    result = {}
    for label in ['tests', 'pass', 'fail']:
        values = re.findall(r'^# ' + label + r' (\d+)\r?$', text, re.M)
        assert len(values) == 1
        result[label] = int(values[0])
    return result, text


def qualify_backend(stem):
    current, sources = report(stem)
    assert current['status'] == 'passed' and current['result_exit_code'] == 0
    actual, current_text = counts(current)
    assert actual == {'tests': 3, 'pass': 3, 'fail': 0}
    original, old_sources = report(BASELINE)
    assert original['status'] == 'failed' and original['result_exit_code'] == 1
    old_counts, old_text = counts(original)
    assert old_counts == {'tests': 95, 'pass': 93, 'fail': 2}
    failures = set(re.findall(r'^not ok \d+ - (.+)\r?$', old_text, re.M))
    assert failures == EXPECTED_FAILURES
    for name in EXPECTED_FAILURES:
        assert re.search(r'^ok \d+ - ' + re.escape(name) + r'\r?$', current_text, re.M)
    prefix = 'copypaste-platform/'
    old = {name: item['sha256'] for name, item in old_sources.items() if name.startswith(prefix)}
    new = {name: item['sha256'] for name, item in sources.items() if name.startswith(prefix)}
    assert set(new) - set(old) == {ADDED_TEST} and not set(old) - set(new)
    assert all(new[name] == digest for name, digest in old.items()), 'No product, old test or fixture changes are permitted'
    platform = ROOT / 'dev/copypaste-platform'
    v1 = (platform / 'tests/task-local-handoff-concurrency-147-v1.test.ts').read_text(encoding='utf-8')
    v2 = (platform / 'tests/task-local-handoff-concurrency-147-v2.test.ts').read_text(encoding='utf-8')
    extra_imports = 'import type { Tx } from "../src/db.js";\nimport { hash } from "../src/lib.js";\n'
    assert extra_imports in v2
    unscoped = v2.replace(extra_imports, '', 1)
    start = unscoped.index('// A raw held connection needs the same transaction-local caller context as\n')
    end = unscoped.index('async function bounded<T>', start)
    unscoped = unscoped[:start] + unscoped[end:]
    assert unscoped.count('    await scopeHolder(holder, f);\n') == 3
    unscoped = unscoped.replace('    await scopeHolder(holder, f);\n', '')
    assert unscoped == v1, 'Only explicit Database.tx context setup may differ; every original assertion stays identical'
    return {
        'status': 'passed', 'mode': 'unchanged_product_with_targeted_test_context_correction',
        'current_report': {'path': (RAW / (stem + '.json')).relative_to(ROOT).as_posix(), 'sha256': sha((RAW / (stem + '.json')).read_bytes())},
        'baseline_report': {'path': (RAW / (BASELINE + '.json')).relative_to(ROOT).as_posix(), 'sha256': sha((RAW / (BASELINE + '.json')).read_bytes())},
        'baseline_actual_counts': old_counts, 'current_actual_counts': actual,
        'superseded_context_failures': sorted(EXPECTED_FAILURES), 'unchanged_existing_cases': 92,
        'current_concurrency_cases': 3, 'verified_case_coverage': 95,
        'added_test': {'path': 'dev/' + ADDED_TEST, 'sha256': new[ADDED_TEST]},
        'original_assertions_unchanged': True, 'product_source_changes': 0,
        'scope': '92 existing cases passed on these exact product bytes in backend10; the original two context failures remain failed. Backend11 separately reruns all three unchanged concurrency assertions with the missing transaction caller context. This is 95-case coverage across separate executions, not a new 95-case full rerun.'
    }


def compare_ui_sources(backend, ui):
    old = {name: item['sha256'] for name, item in ui.items() if name.startswith('copypaste-platform/')}
    new = {name: item['sha256'] for name, item in backend.items() if name.startswith('copypaste-platform/')}
    assert set(new) - set(old) == {ADDED_TEST} and not set(old) - set(new)
    assert all(new[name] == digest for name, digest in old.items())
    return [ADDED_TEST]
