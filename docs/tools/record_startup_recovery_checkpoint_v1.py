"""Record bounded Stage128 delivery without closing broader product requirements."""
from pathlib import Path
from datetime import datetime, timezone
from hashlib import sha256
import json
import archive_startup_recovery_evidence_v1 as evidence
from record_audio_accounting_v2 import git

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / 'docs/quality'
OUTPUT = QUALITY / 'startup-recovery-checkpoint-128.json'
REPOS = {'backend': 'platform', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}


def main():
    assert not OUTPUT.exists()
    verification = evidence.verify(); index = evidence.read(evidence.INDEX)
    prior_file = QUALITY / 'local-startup-checkpoint-127.json'; prior = evidence.read(prior_file)
    sources = {**prior['source_files'], **index['current_sources']}; commits = {}
    for branch, component in REPOS.items():
        repo = ROOT / 'dev' / ('copypaste-' + component)
        assert not git(repo, 'status', '--porcelain'), branch
        assert git(repo, 'branch', '--show-current').decode().strip() == 'codex/' + branch
        commits[branch] = git(repo, 'rev-parse', 'HEAD').decode().strip()
        for name in ['README.md', 'README.en.md', '.gitattributes']:
            p = repo / name; sources[p.relative_to(ROOT).as_posix()] = sha256(p.read_bytes()).hexdigest()
    for item in index['media']:
        p = ROOT / 'dev/copypaste-desktop/assets/screenshots' / Path(item['original']).name
        assert sha256(p.read_bytes()).hexdigest() == item['sha256']; sources[p.relative_to(ROOT).as_posix()] = item['sha256']
    publisher = ROOT / 'dev/copypaste-delivery/scripts/publish-workmate-v11.mjs'
    sources[publisher.relative_to(ROOT).as_posix()] = sha256(publisher.read_bytes()).hexdigest()
    assert sources['dev/copypaste-desktop/.gitattributes'] == '82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e'
    for name, expected in sources.items(): assert sha256((ROOT / name).read_bytes()).hexdigest() == expected, name
    counts = {'controller_related': verification['unit_counts'], 'actual_local_codex': verification['native_counts'],
              'current_compiler_checks': verification['current_compiler_checks'],
              'related_backend_sql': verification['sql_counts'], 'actual_packaged_desktop': verification['actual_packaged_ui_checks']}
    value = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'verified_bounded_customer_local_pre_turn_recovery', 'scope': index['scope'],
        'counts': counts, 'source_files': sources, 'component_commits': commits, 'evidence_index': evidence.ref(evidence.INDEX),
        'archive_verifier': evidence.ref(Path(evidence.__file__)), 'archive_verification': verification,
        'qualification_source_differences': index['qualification_source_differences'],
        'previous_checkpoint': evidence.ref(prior_file), 'previous_publication': index['previous_publication'],
        'current_full_platform_regression_rerun': False, 'new_actual_ui_qualified': True,
        'desktop_startup_lease_qualified': True, 'desktop_startup_revocation_qualified': True, 'desktop_pre_turn_recovery_qualified': True,
        'original_full_acceptance_open': 102, 'required_open': 89, 'unconfirmed_suggestions': 12, 'optional_open': 1,
        'fully_accepted': 0, 'professional_roles_fully_qualified': 0, 'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest(),
        'limits': ['Actual pinned customer-local Codex and native SQL; synthetic provider and consent decisions.',
                   'Controller/native execution bytes match the packaged run; the renderer presentation fix has current compilation/UI qualification, and the SQL-only assertion has current SQL qualification.',
                   'One pre-turn transport recovery only, at most two native launches under one task/hold/deadline.',
                   'Main and workflow-child controller paths covered; actual packaged journey covers a main task.',
                   'No whole-platform rerun, signed installer, live provider, all-node crash matrix or full professional-role acceptance.']}
    evidence.write_new(OUTPUT, value)
    previous_file = QUALITY / 'remaining-work-stage127.json'; previous = evidence.read(previous_file); rows = previous['requirements']
    updates = {
        'REQ-003': '本轮实际打包Desktop再次走通浏览器OTP/PKCE、企业工作区创建、明确本机授权及待响应启动撤权；企业身份正式部署、安装后登录和全部过期/换账号/断网/竞争组合仍待完整验收。',
        'REQ-008': '本轮补齐Desktop启动传输故障的一次安全恢复，沿用原任务与费用预留；全部业务步骤、部分产物及多节点故障矩阵仍待完整验收。',
        'REQ-009': '已验证Desktop轮次准入前最多一次启动恢复、旧凭证隔离与原费用；任意运行中暂停、全部崩溃检查点、未知本机副作用和跨节点恢复仍待完整验收。',
        'REQ-010': '本轮实际打包Desktop验证初始化故障恢复、原费用与待响应撤权，三个窗口宽度无边框、无菜单、无可见滚动条；其他跨端审批、外部写动作和格式组合继续开放。',
        'REQ-039': '本轮新目录包实际Electron初始化故障恢复、撤权和三个真实窗口宽度已验证；签名安装、更新卸载、约定OS/DPI及完整本机工具仍待验收。',
        'REQ-060': '本轮安全启动恢复、91项控制层、43项真实Codex、30项原生SQL及6项打包交互检查绑定源码、双语说明和截图/GIF；远端同步以最终SHA回执为准。独立检出复现与原始完整交付验收仍待完成。',
        'REQ-075': '已补齐Desktop主任务/工作流子任务的一次启动恢复、公司端原子零准入证明与旧权限隔离，实际固定版本Codex和打包主任务通过；四发布工具完整本机组合、偶发底层延迟根因及全部角色/团队/计划/崩溃恢复组合仍待完成。',
    }
    for row in rows:
        if row['id'] in updates: row['current_audit_remaining'] = updates[row['id']]
        row['full_acceptance'] = 'open'
    ledger = {**previous, 'schema_version': 11, 'reviewed_at': value['at'], 'requirements': rows,
              'previous_review': evidence.ref(previous_file), 'checkpoint': evidence.ref(OUTPUT), 'new_full_acceptance_closures': 0}
    evidence.write_new(QUALITY / 'remaining-work-stage128.json', ledger)
    lines = ['# 当前未完成项 · 阶段128 / Current open work', '',
        '89条必需整体验收、12条未确认扩展建议和1条可选项仍开放，共102条；这些记录并非102个完全未编码模块。', '',
        '本轮补齐Desktop轮次前一次安全启动恢复、旧权限隔离、原任务预算与真实原生/SQL/打包界面验证。全部业务与完整崩溃恢复继续开放。', '']
    for title, collection in [('必需交付（89条）', [r for r in rows if not r['optional'] and r['requirement_origin'] == 'existing_requirement']),
        ('未确认扩展建议（12条）', [r for r in rows if r['requirement_origin'] == 'expanded_design_suggestion']), ('可选项（1条）', [r for r in rows if r['optional']])]:
        lines += ['## ' + title, '', '| 编号 | 优先级 | 模块 | 当前状态 | 尚需完成 |', '| --- | --- | --- | --- | --- |']
        lines += [f"| {r['id']} | {r['priority']} | {r['module']} | {r['audit_status']} | {r['current_audit_remaining']} |" for r in collection]; lines.append('')
    lines += ['[本轮证据](startup-recovery-checkpoint-128.json) · [结构化清单](remaining-work-stage128.json) · [上一轮原表](remaining-work-stage127.md)', '']
    p = QUALITY / 'remaining-work-stage128.md'
    with p.open('x', encoding='utf-8', newline='\n') as f: f.write('\n'.join(lines))
    print(json.dumps({'status': value['status'], 'counts': counts, 'sources': len(sources), 'required_open': 89, 'all_open': 102}))


if __name__ == '__main__': main()
