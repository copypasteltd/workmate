"""Bind qualified local startup code, media and original company accounting to sources."""
from pathlib import Path
from datetime import datetime, timezone
from hashlib import sha256
import json

import archive_local_startup_evidence_v1 as evidence
from record_audio_accounting_v2 import git

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / 'docs/quality'
OUTPUT = QUALITY / 'local-startup-checkpoint-127.json'
REPOS = {'backend': 'platform', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}


def write_new(file, value):
    with file.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2); stream.write('\n')


def main():
    assert not OUTPUT.exists()
    verification = evidence.verify()
    index = evidence.read(evidence.INDEX)
    old_file = QUALITY / 'native-publication-checkpoint-126.json'
    old = evidence.read(old_file)
    sources = {**old['source_files'], **index['current_sources']}
    commits = {}
    for branch, component in REPOS.items():
        repo = ROOT / 'dev' / ('copypaste-' + component)
        assert not git(repo, 'status', '--porcelain'), branch
        assert git(repo, 'branch', '--show-current').decode().strip() == 'codex/' + branch
        commits[branch] = git(repo, 'rev-parse', 'HEAD').decode().strip()
        for name in ['README.md', 'README.en.md', '.gitattributes']:
            file = repo / name; sources[file.relative_to(ROOT).as_posix()] = sha256(file.read_bytes()).hexdigest()
    for item in index['media']:
        file = ROOT / 'dev/copypaste-desktop/assets/screenshots' / Path(item['path']).name
        sources[file.relative_to(ROOT).as_posix()] = item['sha256']
    publisher = ROOT / 'dev/copypaste-delivery/scripts/publish-workmate-v10.mjs'
    sources[publisher.relative_to(ROOT).as_posix()] = sha256(publisher.read_bytes()).hexdigest()
    assert sha256((ROOT / 'dev/copypaste-desktop/.gitattributes').read_bytes()).hexdigest() == '82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e'
    for name, expected in sources.items(): assert sha256((ROOT / name).read_bytes()).hexdigest() == expected, name
    counts = {'controller_related': verification['unit_counts'], 'actual_local_codex': verification['native_counts'], 'actual_packaged_desktop': verification['actual_packaged_ui_checks']}
    value = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'verified_customer_local_startup_lease_and_revocation', 'scope': index['scope'],
             'counts': counts, 'source_files': sources, 'component_commits': commits, 'evidence_index': evidence.ref(evidence.INDEX),
             'archive_verifier': evidence.ref(Path(evidence.__file__)), 'archive_verification': verification, 'previous_checkpoint': evidence.ref(old_file),
             'previous_publication': index['previous_publication'], 'current_full_platform_regression_rerun': False, 'new_actual_ui_qualified': True,
             'desktop_startup_lease_qualified': True, 'desktop_startup_revocation_qualified': True, 'desktop_pre_turn_recovery_qualified': False,
             'original_full_acceptance_open': 102, 'required_open': 89, 'unconfirmed_suggestions': 12, 'optional_open': 1,
             'fully_accepted': 0, 'professional_roles_fully_qualified': 0, 'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest(),
             'limits': ['Actual pinned customer-local Codex and native SQL; synthetic model responses and local dialog decisions.',
                        'Main and workflow-child controller leases are covered; actual packaged journey covers a main task and startup revocation.',
                        'No automatic Desktop startup retry: atomic company zero-request and revoked-authority proof is still required.',
                        'No whole-platform rerun, signed installer, live provider or full professional-role acceptance.']}
    write_new(OUTPUT, value)
    previous_file = QUALITY / 'remaining-work-stage126.json'; previous = evidence.read(previous_file); rows = previous['requirements']
    updates = {
        'REQ-003': '本轮实际打包Desktop再次走通浏览器OTP/PKCE与企业工作区创建，并验证启动期间撤销本机权限；企业身份正式部署、安装后登录及全部过期/换账号/断网/竞争组合仍待完整验收。',
        'REQ-010': '本轮实际打包Desktop验证延迟启动、一次账务与撤权，在1000/1240/1440窗口宽度保持无边框、无菜单、无可见滚动条；其他跨端审批、外部写动作和全部格式组合仍待完整验收。',
        'REQ-060': '本轮本机启动修复、真实原生回归、实际打包交互与账务均绑定确切源码、双语说明及截图/GIF；远端同步以最终SHA回执为准。独立检出复现与原始完整交付验收仍待完成。',
        'REQ-075': '本轮修复Desktop主任务及工作流子任务启动时的45秒租约保活；关闭/撤权可阻止准备后迟到启动、打断待响应原生RPC并回收锁。实际打包主任务超过45秒仍只执行一次并结算原预留。Desktop自动启动恢复仍缺公司端原子零请求/旧权限撤销证明，四发布工具本机组合、偶发底层延迟根因及完整角色/团队/计划/恢复组合仍待完成。',
    }
    for row in rows:
        if row['id'] in updates: row['current_audit_remaining'] = updates[row['id']]
        row['full_acceptance'] = 'open'
    ledger = {**previous, 'schema_version': 10, 'reviewed_at': value['at'], 'requirements': rows, 'previous_review': evidence.ref(previous_file), 'checkpoint': evidence.ref(OUTPUT), 'new_full_acceptance_closures': 0}
    write_new(QUALITY / 'remaining-work-stage127.json', ledger)
    lines = ['# 当前未完成项 · 阶段127 / Current open work', '',
             '89条必需整体验收、12条未确认扩展建议和1条可选项仍开放，共102条；它们并非102个完全未编码模块。', '',
             '本轮补齐Desktop主任务/工作流子任务启动保活、准备与原生RPC等待期间撤权、真实Codex回归及实际打包主任务的一次账务。自动启动恢复与原始完整交付继续开放。', '']
    for title, collection in [('必需交付（89条）', [r for r in rows if not r['optional'] and r['requirement_origin'] == 'existing_requirement']),
                              ('未确认扩展建议（12条）', [r for r in rows if r['requirement_origin'] == 'expanded_design_suggestion']), ('可选项（1条）', [r for r in rows if r['optional']])]:
        lines += ['## ' + title, '', '| 编号 | 优先级 | 模块 | 当前状态 | 尚需完成 |', '| --- | --- | --- | --- | --- |']
        lines += [f"| {r['id']} | {r['priority']} | {r['module']} | {r['audit_status']} | {r['current_audit_remaining']} |" for r in collection]; lines.append('')
    lines += ['[本轮证据](local-startup-checkpoint-127.json) · [结构化清单](remaining-work-stage127.json) · [上一轮原表](remaining-work-stage126.md)', '']
    with (QUALITY / 'remaining-work-stage127.md').open('x', encoding='utf-8', newline='\n') as stream: stream.write('\n'.join(lines))
    print(json.dumps({'status': value['status'], 'counts': counts, 'sources': len(sources), 'required_open': 89, 'all_open': 102}))


if __name__ == '__main__': main()
