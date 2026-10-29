"""Record bounded delivery progress without closing unproved original requirements."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / 'docs/quality'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def ref(path):
    return {'path': path.relative_to(ROOT).as_posix(),
            'sha256': sha256(path.read_bytes()).hexdigest()}


def main():
    output = QUALITY / 'remaining-work-stage123.json'
    markdown = output.with_suffix('.md')
    assert not output.exists() and not markdown.exists()
    previous = QUALITY / 'remaining-work-audit-2026-10-29-v3.json'
    cp_path = QUALITY / 'admin-content-checkpoint-123.json'
    cp = read(cp_path)
    assert cp['status'] == 'verified_bounded_admin_content_delivery'
    assert cp['backend_counts'] == {'tests': 75, 'pass': 75, 'fail': 0,
                                    'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert cp['actual_ui_checks'] == 7 and cp['layout_observations'] == 7
    assert cp['layout_viewports_verified'] == [375, 768, 1024, 1440]
    source = read(previous)
    rows = source['requirements']
    assert [r['id'] for r in rows] == [f'REQ-{n:03}' for n in range(1, 103)]
    updates = {
        'REQ-048': '三类修订及原请求恢复已通过限定后台和实际页面验证；全部资源的管理、正文修订及受控客服协助仍待完整覆盖。',
        'REQ-090': '三类结构化修订、差异确认、历史、原请求恢复及当前撤权已有通过证据；其余资源修订与完整治理覆盖待补齐。',
        'REQ-094': '本次修订权限交集、MFA、显式拒绝及实际页面撤权已通过；全动作、对象状态、额度、导出及异步矩阵待完整验收。',
        'REQ-096': '本次独立管理员来源、原子审计、不可变性及回滚已有通过证据；其他敏感路径和生产留存仍待完整验收。',
    }
    for row in rows:
        row['remaining'] = updates.get(row['id'], row['current_audit_remaining'])
        row['current_audit_remaining'] = row['remaining']
        assert row['full_acceptance'] == 'open'
    completed = [
        {'id': '123-01', 'work': '不可变修订事实与独立管理员来源', 'evidence': '迁移 130、版本/作用域/摘要约束、数据库角色和不可变性专项通过。'},
        {'id': '123-02', 'work': '团队、共享说明、方法的六类 API', 'evidence': '固定依赖、来源隔离、客户原流程、稳定历史分页和全部相关文件通过。'},
        {'id': '123-03', 'work': '结构化表单、参照搜索及明确差异确认', 'evidence': '实际邮件/MFA 登录，三种对象提交和客户读取，新旧任务版本分别核对。'},
        {'id': '123-04', 'work': '断线后恢复原提交及保留成功回执', 'evidence': '实际已提交响应丢失后刷新恢复，不保存正文，不重复修改；首次失败保留。'},
        {'id': '123-05', 'work': '当前权限撤回与无费用副作用', 'evidence': '实际项目 deny 清空私人内容；任务、预留和网关请求数不增加。'},
        {'id': '123-06', 'work': '四档布局及真实媒体', 'evidence': '375/768/1024/1440px 共 7 次边界观察、6 PNG、2 GIF、2 MP4；原始帧和旧截图保留。'},
        {'id': '123-07', 'work': '双语文档与精确证据归档', 'evidence': '领域方案、README、逻辑图、源码快照、原始 TAP、失败尝试及资源回收记录。'},
        {'id': '123-08', 'work': '独立分支合并与 V6 发布流程', 'evidence': '精确源码及提交证明、旧证明身份保留、普通八引用推送和实际 SHA 读取；远端结果以执行器最终回执为准。'},
    ]
    value = {
        'schema_version': 1, 'reviewed_at': datetime.now(timezone.utc).isoformat(),
        'audit_kind': 'bounded_admin_content_progress_preserving_full_acceptance',
        'previous_review': ref(previous), 'checkpoint': ref(cp_path),
        'summary': {**source['summary'], 'expanded_design_suggestion_records': 12},
        'counts_this_stage': cp['counts'], 'completed_bounded_work_this_stage': completed,
        'module_groups': source['module_groups'], 'requirements': rows,
        'user_authorized_synthetic_data': True,
        'workspace_residue_archive': cp['workspace_residue_archive'],
        'publication': {'executor': 'dev/copypaste-delivery/scripts/publish-workmate-v6.mjs',
                        'receipt_directory': 'dev/copypaste-delivery/.data/publication',
                        'remote_status_authority': 'The executor final receipt and actual remote SHA readback; this ledger records implementation qualification.'},
        'limits': [
            'All 102 formal acceptance records stay open; 86 partial and 16 completion-not-proven records are not a code completion percentage.',
            'REQ-059 is optional; REQ-061–072 are expanded design suggestions rather than individually confirmed original instructions.',
            'Current qualification covers five complete related backend files, not every backend file or live professional quality.',
            'All historical failures and weaker UI captures retain their original source and scope.',
            'Full product, signed installation, real accounts/providers, production operations and customer quality remain separate.',
        ],
        'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = ['# 当前全部未关闭项 · 阶段 123 / All open acceptance records', '',
             '**102 条整体验收仍未关闭：86 条部分验证、16 条未证完成、0 条完整关闭。** 原台账的 101 必需/1 可选口径保留；REQ-059 为可选，REQ-061–072 为未逐项确认的展开设计建议。此数字统计验收记录，不是未编写模块数或代码完成百分比。', '',
             '本轮完成下列八项限定工作，与原需求重叠，不额外累加。相关后端 75/75、实际 Admin 页面 7/7、四档布局 7 次观察通过；6 PNG 和 2 组 GIF/MP4 已保留。', '',
             '| 编号 | 本轮完成 | 实际范围 |', '| --- | --- | --- |']
    for row in completed:
        lines.append(f"| {row['id']} | {row['work']} | {row['evidence']} |")
    lines += ['', '完整剩余事项如下。“部分验证”包含已有实现和限定证据，“未证完成”表示该需求整体完成仍未获充分证明。', '',
              '| 编号 | 优先级 | 模块 | 当前状态 | 尚需完成 |', '| --- | --- | --- | --- | --- |']
    for row in rows:
        name = row['module'] + ('（设计建议）' if row['requirement_origin'] == 'expanded_design_suggestion' else '')
        lines.append(f"| {row['id']} | {row['priority']} | {name} | {row['audit_status']} | {row['remaining']} |")
    lines += ['', '本轮测试所属浏览器、API、预览、原生数据库和端口已关闭，所属测试资料回收通过。没有新启动 Docker/WSL/虚拟机。假模型、假媒体授权继续有效，真实服务和业务质量验收单独列明。', '',
              '工作区整理 OPS-01 已完成可恢复归档，不计入 102 条产品记录：失效临时目录已从工作区入口移入所属 .data 归档，保留原资料，没有递归删除。详见 [操作回执](workspace-residue-stage123.json)。', '',
              '[完整数据](remaining-work-stage123.json) · [限定检查点](admin-content-checkpoint-123.json) · [方案](../technical/123-admin-content-revisions.md) · [更新说明](../changes/123-admin-content-revisions.md)', '',
              'All 102 full acceptance records remain open: 86 partial and 16 completion-not-proven, with none fully closed. Stage 123 adds eight overlapping bounded work items; 75 related backend checks, seven actual Admin UI flows and seven viewport observations passed. The optional cloud computer and twelve expanded design suggestions are distinguished. Historical failures, raw source snapshots and weaker captures are preserved. Remote publication status follows the executor receipt and actual SHA readback; live providers, professional quality and full product acceptance remain separate.', '']
    markdown.write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({'status': 'recorded', 'completed_bounded_items': len(completed),
                      'original_acceptance_open': len(rows), 'fully_accepted': 0}))


if __name__ == '__main__':
    main()
