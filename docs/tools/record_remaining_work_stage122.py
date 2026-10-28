"""Write every open requirement; attach bounded new evidence without closing acceptance."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from collections import Counter
import json

ROOT = Path(__file__).resolve().parents[2]
Q = ROOT / 'docs/quality'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def ref(path):
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': sha256(path.read_bytes()).hexdigest()}


def main():
    previous = Q / 'remaining-work-stage121-published.json'
    cp_path = Q / 'runtime-startup-checkpoint-122.json'
    cp, old = read(cp_path), read(previous)
    assert cp['status'] == 'verified_bounded_runtime_startup_delivery'
    rows = old['requirements']
    assert len(rows) == 102 and len({r['id'] for r in rows}) == 102
    assert all(r['full_acceptance'] == 'open' for r in rows)
    observed = {
        'REQ-009': '初始化恢复限制在零派发／旧进程关闭前提，保留原期限；不重放已提交线程或轮次。',
        'REQ-011': 'RPC 失败仅记录安全元数据，嵌套原生错误正文不进入诊断。',
        'REQ-035': 'Web 增加连接恢复与失败的繁中／英文事件文案，20 项现有单元通过。',
        'REQ-039': '新检出目录 pretest 构建 Native Host；180 单元、25 原生及 8 打包 UI 检查通过。',
        'REQ-044': '云端 12 项原生恢复／作用域及 Desktop 25 项原生检查；旧超时根因仍未证明。',
        'REQ-046': '实际 Worker 初始化恢复后原 task／attempt／fencing／费用预留及单次结算专项通过。',
        'REQ-055': '当前实际打包 Desktop 三档窗口没有可见滚动条或横向溢出；未扩大至全可访问性矩阵。',
        'REQ-057': '工具／增量／用量／完成与当前线程轮次绑定，前置或其他作用域的消息拒绝。',
        'REQ-060': '本轮源码、双语说明、6 PNG 和 1 GIF／MP4 归档；远端结果单独以发布器回执核对。',
        'REQ-081': '实际打包 Desktop 繁英截图和三档窗口检查，继续沿用现有 CopyPaste 视觉。',
    }
    for row in rows:
        if row['id'] in observed:
            row['stage122_bounded_evidence'] = observed[row['id']]
    # The latest delta documentation is complete; independent reproduction and
    # final full delivery remain open under the same original requirement.
    next(r for r in rows if r['id'] == 'REQ-060')['remaining'] = '独立检出复现、后续增量持续同步及最终完整交付验收。'
    decisions = Counter(r['recorded_assessment'] for r in rows)
    assert decisions == {'partial_verified': 86, 'completion_not_proven': 16}
    group_ranges = [
        ('基础账户、Agent 与文件', 1, 14), ('营销创作与素材交付', 15, 22),
        ('营销数据、SEO/GEO 与自动化', 23, 34), ('Web、Extension 与 Desktop', 35, 42),
        ('内核、计费、运维与质量', 43, 60), ('工作台、协作与角色模板', 61, 80),
        ('品牌与管理后台', 81, 102),
    ]
    groups = []
    for label, start, end in group_ranges:
        selected = rows[start - 1:end]
        groups.append({'module_group': label, 'range': f'REQ-{start:03d}–REQ-{end:03d}',
                       'open': len(selected),
                       'partial_verified': sum(r['recorded_assessment'] == 'partial_verified' for r in selected),
                       'completion_not_proven': sum(r['recorded_assessment'] == 'completion_not_proven' for r in selected)})
    assert sum(g['open'] for g in groups) == 102
    done = [
        ('122-01', '云端有界初始化恢复', '原生恢复、真实超时、取消、明确拒绝及禁止重放场景通过。'),
        ('122-02', '云端／Desktop 轮次隔离', '当前 thread／turn 核验、错误作用域拒绝、合法原生工具流程通过。'),
        ('122-03', 'Desktop 丢失响应和脱敏', '保留原生完成恢复；嵌套错误不进入诊断。'),
        ('122-04', '新检出目录测试准备', '补齐 Native Host；180 单元及 25 原生通过，首轮失败保留。'),
        ('122-05', '原任务及原账本回归', str(cp['counts']['worker_billing']['pass']) + ' 项账务／SEO／网关／请求控制回归通过。'),
        ('122-06', '实际页面、媒体和文档', '8 打包 UI、三档窗口、6 PNG、1 GIF／MP4、双语说明和源证据归档。'),
    ]
    value = {
        'schema_version': 1, 'reviewed_at': datetime.now(timezone.utc).isoformat(),
        'audit_kind': 'bounded_runtime_startup_progress_preserving_full_acceptance',
        'previous_review': ref(previous), 'checkpoint': ref(cp_path),
        'summary': {'original_requirements': 102, 'partial_verified': 86, 'completion_not_proven': 16,
                    'fully_accepted': 0, 'open': 102, 'required_open_acceptance_records': 101,
                    'optional_open_acceptance_records': 1,
                    'priorities': dict(Counter(r['priority'] for r in rows)),
                    'assessment_note': 'Formal open acceptance records; not wholly uncoded modules or implementation percentages.'},
        'counts_this_stage': cp['counts'], 'completed_bounded_work_this_stage': done,
        'module_groups': groups,
        'requirements': rows, 'user_authorized_synthetic_data': True,
        'publication': 'Qualification snapshot. Ordinary eight-ref publication and actual remote readback are recorded in the immutable publisher receipt.',
        'limits': cp['limitations'], 'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    json_path = Q / 'remaining-work-stage122.json'
    with json_path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    md = ('# 当前全部未关闭项 · 阶段 122 / All open acceptance records\n\n'
          '**102 项完整验收仍未关闭：101 项必需、1 项可选；86 项已有部分实现验证、16 项未证明整体完成、0 项完整验收关闭。** '
          '这些是原需求的验收记录，不能理解为 102 个尚未编写的模块，也不是代码完成百分比。REQ-059 为可选项。P0 共 78 项、P1 共 23 项、P2 共 1 项。\n\n'
          '状态说明：**部分验证**表示已有实现和限定范围验证，右栏仍待补齐或验收；**未证完成**表示尚无足够证据确认该需求整体完成。已授权假数据继续有效，真实供应商效果与生产环境验证单独列在对应剩余工作中。\n\n'
          '| 范围 | 编号 | 未关闭 | 部分验证 | 未证完成 |\n| --- | --- | ---: | ---: | ---: |\n')
    md += ''.join('| ' + ' | '.join(str(g[key]) for key in ['module_group', 'range', 'open', 'partial_verified', 'completion_not_proven']) + ' |\n' for g in groups)
    md += ('\n本轮完成如下六项限定工作，与原始需求重合，不另加总。全部使用已授权假模型／媒体响应；真实原生、数据库和页面范围见 [checkpoint](runtime-startup-checkpoint-122.json)。\n\n'
           '| 编号 | 本轮完成 | 实际范围 |\n| --- | --- | --- |\n')
    md += ''.join('| ' + ' | '.join(row) + ' |\n' for row in done)
    md += ('\n源码与媒体已绑定；八引用普通推送及 SHA 读取结果以发布器的不可覆写回执为准。旧全量回归保留原版本范围，本轮没有重新执行全量后端回归。\n\n'
           '| 编号 | 优先级 | 模块 | 状态 | 已有实现／本轮补充 | 尚未完成或尚未证明完成 |\n| --- | --- | --- | --- | --- | --- |\n')
    for row in rows:
        state = '部分验证' if row['recorded_assessment'] == 'partial_verified' else '未证完成'
        cells = [row['id'], row['priority'], row['module'], state, row['implemented_scope'] + ('；本轮：' + observed[row['id']] if row['id'] in observed else ''), row['remaining']]
        md += '| ' + ' | '.join(cell.replace('|', '\\|').replace('\n', ' ') for cell in cells) + ' |\n'
    md += ('\n完整生产发行、真实供应商质量、至少十二个角色的专业效果、客户业务接受及实际部署性能仍未关闭。历史失败、源码快照与旧版本检查表均保留。\n\n'
           'All 102 full acceptance records stay open. The six bounded changes above overlap those requirements. Native Codex, filesystem, PostgreSQL and packaged UI evidence is real within the stated scopes; provider replies are synthetic. Earlier full regressions remain bound to their original source version.\n')
    with (Q / 'remaining-work-stage122.md').open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(md)
    print(json.dumps({'status': 'recorded', 'open': 102, 'bounded_changes': len(done)}))


if __name__ == '__main__':
    main()
