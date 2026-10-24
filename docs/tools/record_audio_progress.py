"""Record actual audio candidate evidence without closing original acceptance."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    evidence_path = ROOT / 'dev/copypaste-delivery/evidence/audio-production-checks-06.json'
    evidence = json.loads(evidence_path.read_text(encoding='utf-8'))
    assert evidence['status'] == 'passed' and evidence['source_unchanged'] and evidence['owned_database_shutdown']
    assert evidence['counts'] == {'tests': 43, 'pass': 43, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    baseline = json.loads((ROOT / 'docs/quality/history/stage84-before-audio/receipt.json').read_text(encoding='utf-8'))
    for name, value in baseline['published_migrations'].items():
        assert digest(ROOT / 'dev/copypaste-platform/migrations' / name) == value
    for name, value in baseline['original_openapi'].items():
        assert digest(ROOT / name) == value
    for record in baseline['files']:
        assert digest(ROOT / record['archive']) == record['sha256']
    path = ROOT / 'docs/quality/requirements-alignment-progress.json'
    progress = json.loads(path.read_text(encoding='utf-8'))
    assert len(progress['requirements']) == 102
    assessments = Counter(row['assessment'] for row in progress['requirements'])
    assert assessments == {'partial_verified': 83, 'completion_not_proven': 19}
    row = next(row for row in progress['requirements'] if row['requirement_id'] == 'REQ-021')
    assert row['assessment'] == 'completion_not_proven' and row['acceptance_case_execution'] == 'not_completed'
    row['finding'] = '候选实现已提供公司内部配音/文件转写、语言/声音白名单、原始回答与字幕版本、预算与来源门控；43 项核心检查通过。各端实际交互、完整回归、音频能力后台发行及未知请求专属对账仍在验证或待补齐，不关闭 TC-021。'
    row['remaining_complete_acceptance_conditions'] = '完成各端实际音频/字幕交互与回归，补齐音频能力后台验证发行和未知请求证据核对，验证真实语言/声音质量及授权用途；TC-021 和原完整验收未完成。'
    progress['audio_production_repair'] = {
        'stage': 84, 'status': 'in_progress_core_verified_clients_pending',
        'core_evidence': evidence_path.relative_to(ROOT).as_posix(), 'core_sha256': digest(evidence_path),
        'core_tests': 43, 'published_migrations_preserved': 100, 'original_openapi_preserved': True,
        'original_full_acceptance': 'not_proven', 'assessment_counts_unchanged': True,
        'scope': 'Real native PostgreSQL/Codex, synthetic company audio service, actual WAV decode, transcription/subtitle versions, source/privacy/cost/body permissions. Client UI and full regression remain separate evidence.',
    }
    progress['at'] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'core_recorded_clients_pending', 'requirements': 102, 'summary_unchanged': dict(assessments), 'core_tests': 43}))


if __name__ == '__main__':
    main()
