"""Record a bounded source review; never turn existing UI tests into local-agent proof."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / 'docs/quality'


def digest(data):
    return sha256(data).hexdigest()


def git_bytes(path):
    return subprocess.run([
        'git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
        'show', f'HEAD:{path}',
    ], cwd=ROOT, check=True, capture_output=True).stdout


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write_new(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as output:
        output.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    output = QUALITY / 'client-direction-audit.json'
    amendment_path = QUALITY / 'client-execution-amendment.json'
    if output.exists() or amendment_path.exists():
        raise SystemExit('Retain the existing review. Use a new revision for changed sources.')
    sources = {
        'desktop': ['src/main.ts', 'src/files.ts', 'renderer/src/api.ts', 'package.json'],
        'extension': ['public/sidepanel.html', 'src/panel.ts', 'src/background.ts', 'scripts/build.mjs'],
        'platform': ['src/runtime.ts', 'src/canonical-tasks.ts', 'contracts/codex/v2/ThreadStartParams.json'],
    }
    captured = {}
    for component, files in sources.items():
        for file in files:
            name = f'dev/copypaste-{component}/{file}'
            captured[name] = {'sha256': digest((ROOT / name).read_bytes())}
    # These observations describe this source revision, not every possible deployment.
    main_source = read('dev/copypaste-desktop/src/main.ts')
    local_files = read('dev/copypaste-desktop/src/files.ts')
    panel = read('dev/copypaste-extension/public/sidepanel.html')
    upload = read('dev/copypaste-extension/src/panel.ts')
    cloud = read('dev/copypaste-platform/src/runtime.ts')
    task_api = read('dev/copypaste-platform/src/canonical-tasks.ts')
    assert 'pollDevices' in main_source and 'files.execute' in main_source
    assert 'app-server' not in main_source and 'new CodexRuntimeAdapter' not in main_source
    assert 'one hour' in main_source and 'Existing files cannot be overwritten' in main_source
    assert 'file.list' in local_files and '3600000' in local_files
    assert 'id="brief-form"' in panel and 'name="title"' in panel and 'name="budget"' in panel
    assert 'file.arrayBuffer()' in upload and '5 * 1024 * 1024' in upload
    assert 'sandbox_mode = "read-only"' in cloud and 'shell_tool = false' in cloud
    assert 'device_id' in task_api and 'TASK_CONTRACT_CAPABILITY_UNAVAILABLE' in task_api
    srs = (ROOT / 'docs/requirements/01-srs.md').read_bytes()
    baseline = git_bytes('docs/requirements/01-srs.md')
    pattern = re.compile(r'^\| REQ-\d{3} \|.*$', re.MULTILINE)
    original_rows = pattern.findall(baseline.decode('utf-8'))
    current_rows = pattern.findall(srs.decode('utf-8'))
    assert len(original_rows) == len(current_rows) == 102
    assert [line.rstrip('\r') for line in original_rows] == [line.rstrip('\r') for line in current_rows]
    row_hash = digest(('\n'.join(line.rstrip('\r') for line in original_rows) + '\n').encode())
    now = datetime.now(timezone.utc).isoformat()
    amendment = {
        'schema_version': '1.0', 'id': 'CLIENT01', 'recorded_at': now,
        'source': 'Explicit human direction in this project conversation on 2026-10-22',
        'instructions': [
            'Desktop 版本的内容，agent必须要在本地运行，并且允许客户向其提供 fully permission。要求最终的操作能力对标 codex desktop',
            'Extension版本的内容，核心内容应该是一个对标 chatgpt extension的样式和结构。但是承载了文件获取、读取并上传给云端的职能。',
        ],
        'normative_document': 'docs/requirements/03-client-execution-amendment.md',
        'development_document': 'docs/technical/69-desktop-local-codex-and-extension-direction.md',
        'supersedes': 'A01 and all older design defaults that make Desktop a cloud agent with a local file bridge',
        'desktop': {'execution_location': 'customer_device', 'kernel': 'codex', 'user_opt_in_full_local_access': True, 'operation_benchmark': 'Codex Desktop'},
        'extension': {'execution_location': 'company_cloud', 'kernel': 'codex', 'interaction': 'ChatGPT-style conversation and attachments in Chrome native right Side Panel', 'file_duties': ['acquire_user_selected_files', 'read', 'upload_to_company_cloud', 'bind_explicit_versions_to_message'], 'desktop_required_for_basic_upload': False},
        'ai_route': 'company_internal_openai_compatible_gateway_for_all_product_ai_calls',
        'existing_102_requirement_table_preserved': True,
        'existing_102_requirement_table_lf_sha256': row_hash,
        'existing_tc_and_historical_evidence_reclassified_as_passed': False,
        'additional_acceptance': {'desktop': [f'DESK-L{i:02}' for i in range(1, 9)], 'extension': [f'EXT-C{i:02}' for i in range(1, 7)]},
    }
    findings = [
        {'id': 'DIR-01', 'area': 'desktop_kernel', 'status': 'not_implemented', 'finding': 'Desktop uses cloud APIs and local file-command polling; no Desktop-owned local Codex app-server lifecycle was found in the reviewed entry point.'},
        {'id': 'DIR-02', 'area': 'desktop_full_local_access', 'status': 'not_implemented', 'finding': 'One-hour directory read/create grants do not provide a user-selectable full local filesystem and terminal mode.'},
        {'id': 'DIR-03', 'area': 'cloud_profile_reuse', 'status': 'desktop_reuse_would_be_incompatible', 'finding': 'Current cloud Codex uses read-only sandbox with shell disabled; this profile cannot represent Desktop full access.'},
        {'id': 'DIR-04', 'area': 'extension_surface', 'status': 'already_has_native_side_panel', 'finding': 'Existing MV3 side panel appearance can be retained.'},
        {'id': 'DIR-05', 'area': 'extension_conversation', 'status': 'restructure_required', 'finding': 'Primary UI is a task brief/title/budget form, rather than conversation history, a message stream and a bottom composer.'},
        {'id': 'DIR-06', 'area': 'extension_files', 'status': 'basic_upload_exists_full_flow_unproven', 'finding': 'Single-file 5 MiB browser reads and project uploads exist; explicit message/version binding and complete conversational recovery need implementation and verification.'},
        {'id': 'DIR-07', 'area': 'local_execution_api', 'status': 'not_implemented', 'finding': 'The current canonical task adapter rejects unsupported device_id semantics and must not be described as a local-agent API.'},
    ]
    report = {
        'schema_version': '1.0', 'checked_at': now, 'status': 'direction_misalignment_confirmed',
        'scope': 'bounded_source_and_document_review_only', 'amendment': 'docs/quality/client-execution-amendment.json',
        'findings': findings, 'source_hashes': captured,
        'additional_runtime_acceptance': 'not_run',
        'new_ui_or_local_agent_screenshots': 'not_created_because_the_revised_capabilities_are_not_yet_implemented',
        'existing_ui_and_native_receipts': 'retain_original_versions_and_cloud_agent_file_bridge_scope',
        'not_proven': ['desktop_local_codex_in_packaged_application', 'desktop_full_permission_tools_and_revocation', 'complete_extension_conversation_attachment_flow', 'production_deployment_or_entire_product_acceptance'],
        'verifier_sha256': digest(Path(__file__).read_bytes()),
    }
    write_new(amendment_path, amendment)
    write_new(output, report)
    print(json.dumps({'status': report['status'], 'findings': len(findings), 'sources': len(captured), 'original_requirement_rows_preserved': 102, 'runtime_acceptance': 'not_run'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
