"""Bind scoped inference repairs to executed source bytes without closing original acceptance."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from refresh_stage52_capabilities import (
    ROOT, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt,
    source_snapshot, verify_run,
)

BASELINE = 'f864aae'
PLATFORM_BASELINE = 'd753b74'
HISTORY = ROOT / 'docs/quality/history/stage54-before-inference'


def bound(entry):
    path = DELIVERY / entry['path']
    assert digest(path) == entry['sha256']
    return receipt(path)


def suite(name, *, current=False):
    data = read(DELIVERY / 'evidence' / (name + '.json'))
    result = verify_run(name, expected_status=data['status'],
                        verifier_snapshot=DELIVERY / data['verifier_snapshot'])
    assert data['schema_change'] is False
    cleanup = data['fixture_cleanup']
    assert cleanup and cleanup['status'] == 'passed'
    assert cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
    assert all(row['reclaimed'] for row in cleanup['results'])
    result['fixture_cleanup'] = bound(cleanup)
    if current:
        expected = source_snapshot()
        expected['.env.example'] = digest(PLATFORM / '.env.example')
        assert data['source_files'] == expected, 'Executed platform source differs'
        assert data['status'] == 'passed'
    return result


def names(path):
    return Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$',
                              path.read_text(encoding='utf-8'), re.M))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--focused', default='03')
    parser.add_argument('--full', default='02')
    parser.add_argument('--credential-scan', default='01')
    args = parser.parse_args()
    for value in (args.focused, args.full, args.credential_scan):
        assert re.fullmatch(r'\d{2}', value)

    baseline_bytes = git(ROOT, 'show', BASELINE + ':docs/quality/requirements-alignment-progress.json')
    baseline = json.loads(baseline_bytes)
    assert len(baseline['requirements']) == 102
    assert baseline['fully_accepted_requirements'] == baseline['qualified_live_roles'] == 0
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA

    focused = suite('inference-request-candidate-' + args.focused, current=True)
    full = suite('inference-request-regression-' + args.full, current=True)
    current_names = names(ROOT / full['raw_report']['path'])
    previous = baseline['explicit_agent_adoption_verification']['full_platform_regression']
    old_raw = ROOT / previous['raw_report']['path']
    assert digest(old_raw) == previous['raw_report']['sha256']
    assert not (names(old_raw) - current_names), 'A previously executed test disappeared'
    assert not (names(ROOT / focused['raw_report']['path']) - current_names)
    assert full['counts']['tests'] > previous['counts']['tests']

    migrations = {}
    for path in sorted((PLATFORM / 'migrations').glob('*.sql')):
        name = path.relative_to(PLATFORM).as_posix()
        assert path.read_bytes() == git(PLATFORM, 'show', PLATFORM_BASELINE + ':' + name)
        migrations[name] = digest(path)
    assert len(migrations) == 65

    scan_path = ROOT / 'docs/quality' / ('inference-request-credential-scan-' + args.credential_scan + '.json')
    scan = read(scan_path)
    assert scan['status'] == 'passed' and scan['matches'] == [] and scan['configured_patterns'] > 0
    assert digest(ROOT / 'docs/tools/scan_inference_credentials.mjs') == scan['verifier_sha256']
    for item in scan['files']:
        assert digest(ROOT / item['path']) == item['sha256']
    expected_evidence = {path.relative_to(ROOT).as_posix() for path in (DELIVERY / 'evidence').iterdir()
                         if path.is_file() and re.match(r'^inference-request-(core|candidate|regression|cancel-probe)-', path.name)}
    assert {item['path'] for item in scan['files']} == expected_evidence

    attempts = []
    for path in sorted((DELIVERY / 'evidence').glob('inference-request-*.json')):
        if re.fullmatch(r'inference-request-(core|candidate|regression)-\d{2}\.json', path.name):
            attempts.append(suite(path.stem))

    # Every changed historical execution needs an exact retained preimage.
    # A hash by itself does not preserve the implementation that was tested.
    preimages = []
    for attempt in attempts:
        data = read(ROOT / attempt['path'])
        for name, recorded in data['source_files'].items():
            if digest(PLATFORM / name) == recorded:
                continue
            preserved = DELIVERY / 'evidence' / (Path(attempt['path']).stem + '-' + name.replace('/', '__'))
            assert digest(preserved) == recorded, 'Missing historical source preimage: ' + name
            preimages.append(receipt(preserved))

    cancellation_probes = []
    for number, extension, accepted, known in (('01', 'ts', True, False), ('02', 'mjs', False, True)):
        stem = 'inference-request-cancel-probe-' + number
        probe_path = DELIVERY / 'evidence' / (stem + '.json')
        probe = read(probe_path)
        verifier = DELIVERY / 'evidence' / (stem + '-verifier.' + extension)
        assert digest(verifier) == probe['verifier_sha256']
        assert probe['actual_fixture_cleanup'] is True and probe['provider_calls'] == 0
        assert probe['code'] == 'CODEX_CANCELLED'
        assert probe['accepted'] is accepted and probe['usage_known'] is known
        assert probe['input_tokens'] == probe['output_tokens'] == 0
        binding = {**receipt(probe_path), 'verifier': receipt(verifier),
                   'provider_calls': 0, 'accepted': accepted, 'usage_known': known,
                   'actual_fixture_cleanup': True}
        if number == '02':
            assert probe['runtime_source_sha256'] == digest(PLATFORM / 'src/runtime.ts')
            assert digest(verifier) == digest(DELIVERY / 'scripts/probe-inference-cancel.mjs')
            binding['runtime_source_sha256'] = probe['runtime_source_sha256']
        else:
            # Probe 01 predates its explicit source-hash field. Retain that limit;
            # do not manufacture an execution-time source binding retroactively.
            binding['runtime_source_binding'] = 'Not recorded by the original diagnostic; raw failure and exact verifier retained'
        cancellation_probes.append(binding)

    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Bounded scoped inference repairs with actual Codex and native PostgreSQL; simulated AI/media; not original product acceptance',
        'documentation_verifier': receipt(Path(__file__).resolve()),
        'documentation_verifier_dependency': receipt(Path(__file__).with_name('refresh_stage52_capabilities.py').resolve()),
        'prior_checkpoint': receipt(ROOT / 'docs/quality/agent-adoption-checkpoint.json'),
        'original_scope': {'requirements': 102, 'summary': baseline['summary'],
                           'fully_accepted_requirements': 0, 'qualified_live_roles': 0,
                           'all_TC_NFR_G01_G10_retained': True},
        'focused': focused,
        'full_platform_regression': full,
        'all_prior_named_tests_retained': dict(names(old_raw)),
        'executions': attempts,
        'cancellation_diagnostics': cancellation_probes,
        'historical_source_preimages': preimages,
        'current_platform_sources': {**source_snapshot(), '.env.example': digest(PLATFORM / '.env.example')},
        'repository_heads': {name: git(PLATFORM.parent / name, 'rev-parse', 'HEAD').decode().strip()
                             for name in ('copypaste-platform', 'copypaste-delivery', 'copypaste-web', 'copypaste-admin', 'copypaste-desktop', 'copypaste-extension')},
        'immutable_migrations_001_065': migrations,
        'normative_openapi_sha256': OPENAPI_SHA,
        'configured_credential_scan': {**receipt(scan_path), 'files': len(scan['files']), 'matches': 0},
        'browser_scope': 'No browser, Electron or extension process opened in this stage; previous client UI evidence retains its recorded backend/source scope',
        'remaining': [
            'Durable provider request concurrency/rate limits shared across workers',
            'Per-paid-call budget allocation and durable usage facts; task reservations alone are insufficient',
            'Unknown in-flight provider capacity, complete Admin request-policy controls and production egress enforcement',
            'All remaining original business/API acceptance, TC/NFR/G01-G10, live-role qualification, signing and installation',
        ],
    }

    repair = {
        'cluster': 'scoped_internal_inference_requests',
        'verified_subflow': 'Codex 每运行短期范围凭证；逐请求当前用户/任务/租约/方案/能力/预算预留与后台实际会话/MFA复查；可信归属、模型/强度/工具声明及完整 SSE 调用校验、字节与超时限制；生成与编辑固定规格及真实 PNG 校验；本地拒绝保留先前已知费用，未知结果不自动重放。跨 Worker 供应商限额和逐次预算仍待实现，局部回归不关闭原完整验收。',
        'evidence': ['inference_request_verification'],
        'implementation_docs': ['technical/55-scoped-internal-inference-requests.md'],
        'source_files': ['dev/copypaste-platform/src/' + name for name in (
            'internal-ai-gateway.ts', 'runtime.ts', 'worker.ts',
            'capability-verification.ts', 'capability-releases.ts')],
    }
    target_ids = {f'REQ-{number:03}' for number in (1, 43, 44, 45, 46, 52, 79, 83, 96, 99, 102)}
    result = json.loads(baseline_bytes)
    for item in result['requirements']:
        if item['requirement_id'] in target_ids:
            item.setdefault('verified_repairs', []).append(repair)
    assert len(result['requirements']) == 102
    assert Counter(row['assessment'] for row in result['requirements']) == Counter(row['assessment'] for row in baseline['requirements'])
    for old, new in zip(baseline['requirements'], result['requirements']):
        assert all(new[key] == old[key] for key in old if key != 'verified_repairs')
        assert new.get('verified_repairs', [])[:len(old.get('verified_repairs', []))] == old.get('verified_repairs', [])
    result['at'] = checkpoint['at']
    result['inference_request_verification'] = checkpoint
    result['evidence']['platform_regression'] = full
    result['evidence_currentness_policy'] += ' Stage55: only the new platform report is bound to current backend bytes; all previous browser/native and original acceptance evidence retains its original source scope.'
    if args.write:
        HISTORY.mkdir(parents=True, exist_ok=True)
        history = HISTORY / 'requirements-alignment-progress.json'
        if history.exists():
            assert history.read_bytes() == baseline_bytes
        else:
            history.write_bytes(baseline_bytes)
        for path, data in (
            (ROOT / 'docs/quality/inference-request-checkpoint.json', checkpoint),
            (ROOT / 'docs/quality/requirements-alignment-progress.json', result),
        ):
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'passed', 'write': args.write, 'focused': focused['counts'],
                      'full': full['counts'], 'source_files': len(checkpoint['current_platform_sources']),
                      'old_tests_retained': previous['counts']['tests'], 'requirements': 102,
                      'fully_accepted_requirements': 0, 'immutable_migrations': 65}, ensure_ascii=False))


if __name__ == '__main__':
    main()
