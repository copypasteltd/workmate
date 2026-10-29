"""Record qualified profile revisions without closing broader original requirements."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from collections import Counter
import json

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / 'docs/quality'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def ref(path):
    return {'path': path.relative_to(ROOT).as_posix(),
            'sha256': sha256(path.read_bytes()).hexdigest()}


def main():
    output = QUALITY / 'remaining-work-stage124.json'
    markdown = output.with_suffix('.md')
    assert not output.exists() and not markdown.exists()
    previous = QUALITY / 'remaining-work-current-review-124.json'
    cp_path = QUALITY / 'admin-profile-checkpoint-124.json'
    cp = read(cp_path)
    assert cp['status'] == 'verified_bounded_admin_profile_delivery'
    assert cp['backend_counts'] == {'tests': 68, 'pass': 68, 'fail': 0,
                                    'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert cp['actual_ui_checks'] == 8 and cp['layout_observations'] == 14
    assert cp['counts']['admin_unit'] == {'tests': 11, 'pass': 11, 'fail': 0,
                                         'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert cp['layout_viewports_verified'] == [375, 768, 1024, 1440]
    assert cp['screenshots'] == 8 and cp['recordings'] == 3
    source = read(previous)
    rows = source['requirements']
    assert [r['id'] for r in rows] == [f'REQ-{n:03}' for n in range(1, 103)]
    updates = {
        'REQ-048': '团队、共享说明、方法、专家、品牌和记忆六类修订已有限定后端及实际页面证据；其他资源正文管理、受控客服协助和整个后台仍待完整覆盖。',
        'REQ-090': '六类结构化修订、差异确认、独立来源、历史、原请求恢复及撤权已有通过证据；其余资源修订、跨资源完整治理和全部用户内容管理待补齐。',
        'REQ-094': '六类修订的权限交集、MFA、显式拒绝和实时撤权通过；本轮另验证企业记忆广域授权及项目deny。全动作、对象状态、额度、导出及异步矩阵待完整验收。',
        'REQ-096': '三类新增版本的独立管理员来源、实际SQL摘要、原子审计、角色不可伪造、回滚和记忆快照擦除通过；其他敏感路径及生产留存仍待完整验收。',
    }
    for row in rows:
        row['remaining'] = updates.get(row['id'], row['current_audit_remaining'])
        row['current_audit_remaining'] = row['remaining']
        assert row['full_acceptance'] == 'open'
    suggestions = [r for r in rows if r['requirement_origin'] == 'expanded_design_suggestion']
    optional = [r for r in rows if r['optional']]
    required = [r for r in rows if not r['optional'] and r['requirement_origin'] != 'expanded_design_suggestion']
    statuses = Counter(r['recorded_assessment'] for r in required)
    assert len(suggestions) == 12 and len(optional) == 1 and len(required) == 89
    assert statuses == {'partial_verified': 77, 'completion_not_proven': 12}
    assert source['summary']['all_open_records'] == 102 and source['summary']['fully_accepted'] == 0
    completed = [
        {'id': '124-01', 'work': '专家、品牌与五种记忆的修订服务', 'evidence': '复用六条路由及当前权限/MFA/预览/确认/原请求恢复；保持客户拥有者和执行输入。'},
        {'id': '124-02', 'work': '不可变管理员来源及事务约束', 'evidence': '迁移131、实际SQL摘要、角色不可伪造、原子审计、失败回滚、客户后续编辑和记忆快照擦除。'},
        {'id': '124-03', 'work': '后台结构化表单与可读差异', 'evidence': '专家工具子集、品牌实际PNG/字体/事实、精确HK$128.90和明确HKT时间；旧版权利声明须明确补齐。'},
        {'id': '124-04', 'work': '真实断线恢复及权限撤回', 'evidence': '实际提交后丢失响应、刷新恢复一次、只保存元数据；实时项目deny清空私人内容，无任务/预留/AI增加。'},
        {'id': '124-05', 'work': '完整相关文件及实际页面验证', 'evidence': '五个完整相关后端文件68/68、后台单元11/11、实际页面8/8；不冒充全部后端或完整产品验收。'},
        {'id': '124-06', 'work': '四档布局、截图及交互录制', 'evidence': '375/768/1024/1440px共14次观察，8PNG、3GIF、3MP4及原始帧；所属浏览器和原生服务关闭。'},
        {'id': '124-07', 'work': '中英双语文档和原始证据', 'evidence': '方案、README、逻辑图、精确源码、原始TAP、旧失败和第三批历史通过全部保留。'},
        {'id': '124-08', 'work': '组件分支与V7发布流程', 'evidence': '当前提交/源码证明、历史证明身份保留、普通八引用原子推送及实际SHA读取；发布成功只以执行器最终回执为准。'},
    ]
    historical_groups = read(QUALITY / 'remaining-work-stage123.json')['module_groups']
    groups = []
    for old in historical_groups:
        prefix = old['range'].replace('–', '-').replace('—', '-')
        import re
        bounds = [int(n) for n in re.findall(r'REQ-(\d+)', prefix)]
        assert len(bounds) == 2
        selected = [r for r in rows if bounds[0] <= int(r['id'][4:]) <= bounds[1]]
        groups.append({**old,
                       'required_open': sum(r in required for r in selected),
                       'unconfirmed_suggestions': sum(r in suggestions for r in selected),
                       'optional_open': sum(r in optional for r in selected)})
    assert sum(g['required_open'] for g in groups) == 89
    value = {
        'schema_version': 1, 'reviewed_at': datetime.now(timezone.utc).isoformat(),
        'audit_kind': 'bounded_admin_profile_progress_preserving_full_acceptance',
        'previous_review': ref(previous), 'checkpoint': ref(cp_path),
        'summary': source['summary'], 'counts_this_stage': cp['counts'],
        'completed_bounded_work_this_stage': completed,
        'module_groups': groups, 'requirements': rows,
        'user_authorized_synthetic_data': True,
        'publication': {'executor': 'dev/copypaste-delivery/scripts/publish-workmate-v7.mjs',
                        'receipt_directory': 'dev/copypaste-delivery/.data/publication',
                        'remote_status_authority': 'The executor final receipt and actual remote SHA readback; this ledger records implementation qualification.'},
        'limits': [
            '89 required records remain open: 77 partial and 12 completion-not-proven. These are whole acceptance records, not uncoded module counts or a code completion percentage.',
            'The complete ledger retains 102 open records, including 12 unconfirmed expanded suggestions and one optional cloud computer record.',
            'Current qualification covers five complete related backend files and actual Admin UI, not all backend files or live professional quality.',
            'All historical failures and superseded passes retain exact original sources and scope.',
            'Full product, signed installation, real accounts/providers, production operations and customer quality remain separate.',
        ],
        'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    with output.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    lines = ['# 当前全部未关闭项 · 阶段124 / All open acceptance records', '',
             '**89条必需整体验收仍未关闭：77条部分验证、12条未证完成、0条完整关闭。** 另有12条尚未逐项确认的展开设计建议和1条可选项，完整台账合计102条。此数字不是未编写模块数或代码完成百分比。', '',
             '本轮完成以下八项限定工作，与原需求重叠，不额外累加。五个完整相关后端文件68/68、后台单元11/11、实际Admin页面8/8、四档布局14次观察通过；保留8PNG和3组GIF/MP4。', '',
             '| 编号 | 本轮完成 | 实际范围 |', '| --- | --- | --- |']
    for row in completed:
        lines.append(f"| {row['id']} | {row['work']} | {row['evidence']} |")
    lines += ['', '待验收数量按模块如下；“部分验证”包括已有实现和限定证据，“未证完成”指整条需求缺少充分完成证明。', '',
              '| 编号范围 | 模块 | 必需待验收 | 未确认建议 | 可选 |', '| --- | --- | ---: | ---: | ---: |']
    for group in groups:
        lines.append(f"| {group['range']} | {group['module_group']} | {group['required_open']} | {group['unconfirmed_suggestions']} | {group['optional_open']} |")
    lines += ['', '以下保留全部102条编号；设计建议和可选项单独标明。', '',
              '| 编号 | 优先级 | 模块 | 归属 | 当前状态 | 尚需完成 |', '| --- | --- | --- | --- | --- | --- |']
    for row in rows:
        origin = '可选' if row['optional'] else '未确认设计建议' if row['requirement_origin'] == 'expanded_design_suggestion' else '必需'
        lines.append(f"| {row['id']} | {row['priority']} | {row['module']} | {origin} | {row['audit_status']} | {row['remaining']} |")
    lines += ['', '本轮所属浏览器、API、预览、原生数据库和端口已关闭，所属测试资料回收通过。没有调度Docker/WSL/虚拟机。假模型、假媒体授权继续有效；真实服务、完整流程和业务质量单独验收。', '',
              '[完整数据](remaining-work-stage124.json) · [限定检查点](admin-profile-checkpoint-124.json) · [方案](../technical/124-admin-profile-revisions.md) · [更新说明](../changes/124-admin-profile-revisions.md)', '',
              'There are 89 open required acceptance records: 77 partial and 12 completion-not-proven, with none fully closed. Twelve unconfirmed expanded design suggestions and one optional record remain separately identified, for 102 records in the complete numbered ledger. These are whole acceptance records, not uncoded module counts. Stage 124 adds eight overlapping bounded work items; all 68 checks across five complete related backend files, 11 Admin unit checks, eight actual Admin UI flows and 14 viewport observations passed. Historical failures and raw source snapshots remain. Publication success follows the executor receipt and actual remote SHA readback.', '']
    with markdown.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write('\n'.join(lines))
    print(json.dumps({'status': 'recorded', 'completed_bounded_items': len(completed),
                      'required_acceptance_open': 89, 'all_acceptance_open': len(rows), 'fully_accepted': 0}))


if __name__ == '__main__':
    main()
