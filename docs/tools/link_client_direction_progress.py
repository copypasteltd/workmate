"""Link the user amendment without changing prior requirement/acceptance records."""
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / 'docs/quality'


def update(path, data):
    previous = path.read_bytes()
    newline = '\r\n' if b'\r\n' in previous else '\n'
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    path.write_bytes(rendered.replace('\n', newline).encode('utf-8'))


def main():
    amendment = QUALITY / 'client-execution-amendment.json'
    audit = QUALITY / 'client-direction-audit.json'
    for file in (amendment, audit):
        assert file.is_file()
    historic_path = QUALITY / 'requirements-amendments.json'
    historic = json.loads(historic_path.read_text(encoding='utf-8'))
    old_changes = json.dumps(historic['changes'], ensure_ascii=False, sort_keys=True)
    link = {
        'id': 'CLIENT01', 'recorded_at': '2026-10-22',
        'path': 'docs/quality/client-execution-amendment.json',
        'sha256': sha256(amendment.read_bytes()).hexdigest(),
        'scope': 'Desktop local Codex and opt-in full access; Extension conversation and file upload',
    }
    historic['subsequent_amendments'] = [
        entry for entry in historic.get('subsequent_amendments', []) if entry['id'] != 'CLIENT01'
    ] + [link]
    assert json.dumps(historic['changes'], ensure_ascii=False, sort_keys=True) == old_changes
    update(historic_path, historic)
    progress_path = QUALITY / 'requirements-alignment-progress.json'
    progress = json.loads(progress_path.read_text(encoding='utf-8'))
    untouched = json.dumps({key: value for key, value in progress.items() if key != 'client_direction_amendment'}, ensure_ascii=False, sort_keys=True)
    progress['client_direction_amendment'] = {
        **link,
        'audit': 'docs/quality/client-direction-audit.json',
        'audit_sha256': sha256(audit.read_bytes()).hexdigest(),
        'priority': 'implement_desktop_local_codex_full_access_and_extension_conversation_attachments',
        'desktop_local_kernel_and_full_access': 'not_implemented',
        'extension_conversation_attachment_acceptance': 'not_complete',
        'additional_runtime_acceptance': 'not_run',
        'original_requirement_and_test_records': 'preserved_without_promoting_acceptance',
    }
    assert json.dumps({key: value for key, value in progress.items() if key != 'client_direction_amendment'}, ensure_ascii=False, sort_keys=True) == untouched
    update(progress_path, progress)
    print('Linked CLIENT01; previous amendment changes and all existing progress records are unchanged.')


if __name__ == '__main__':
    main()
