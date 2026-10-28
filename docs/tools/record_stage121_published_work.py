"""Append a numbered status review only after the eight reviewed refs are published.

Preserve the earlier status review and its formal acceptance decisions. This
addendum records scoped progress; it never turns a synthetic test into live or
whole-product acceptance. No existing checkpoint, source binding or proof file
is rewritten.
"""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from collections import Counter
import argparse
import copy
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
Q = ROOT / 'docs/quality'
PREFIX = Q / 'remaining-work-stage121-published'
PREVIOUS = Q / 'remaining-work-2026-10-29.json'
CP = Q / 'dedicated-cloud-checkpoint.json'
MANIFEST = Q / 'workmate-publication.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def ref(file):
    return {'path': file.relative_to(ROOT).as_posix(),
            'sha256': sha256(file.read_bytes()).hexdigest()}


def git(*args):
    return subprocess.check_output(
        ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', *args],
        cwd=ROOT).decode('utf-8').strip()


def save(file, body):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open('xb') as stream:
        stream.write(body)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--receipt', required=True)
    args = parser.parse_args()
    assert not PREFIX.with_suffix('.json').exists()
    assert not PREFIX.with_suffix('.md').exists()
    change = ROOT / 'docs/changes/121-source-publication-review.md'
    assert not change.exists()
    receipt_file = (ROOT / args.receipt).resolve()
    allowed = (ROOT / 'dev/copypaste-delivery/.data/publication').resolve()
    assert receipt_file.is_relative_to(allowed) and receipt_file.name == 'receipt.json'
    receipt = read(receipt_file)
    assert receipt['status'] == 'pushed_and_verified' and receipt['mode'] == '--push'
    assert receipt['remote'] == 'git@github.com:copypasteltd/workmate.git'
    assert receipt['manifest_sha256'] == ref(MANIFEST)['sha256']
    branches = {item['branch']: item['commit'] for item in receipt['branches']}
    assert set(branches) == {'main', 'docs', 'backend', 'web', 'admin', 'desktop', 'extension', 'delivery'}
    assert all(receipt['remote_after'][branch] == commit for branch, commit in branches.items())
    assert branches['docs'] == branches['main'] == git('rev-parse', 'HEAD')
    current = dict(line.split()[::-1] for line in git('ls-remote', '--heads', 'origin').splitlines())
    assert all(current['refs/heads/' + branch] == commit for branch, commit in branches.items())
    cp = read(CP)
    manifest = read(MANIFEST)
    assert manifest['dedicated_cloud']['checkpoint'] == ref(CP)
    assert cp['status'] == 'verified_bounded_dedicated_cloud_delivery'
    assert len(cp['backend_files']) == 112
    counts = cp['backend_counts']
    assert counts['tests'] == counts['pass'] and counts['pass'] > 0
    assert all(counts[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    assert cp['integrated_client_tests'] == 338 and cp['integrated_backend_tests'] == 24
    assert cp['actual_ui_checks'] == 24
    assert len(cp['media']['screenshots']) == 29 and len(cp['media']['movies']) == 5
    assert cp['professional_definitions'] == 18 and cp['formal_professionally_qualified_roles'] == 0
    assert cp['original_full_acceptance_open'] == 102
    assert not cp['live_provider_qualified'] and not cp['actual_linux_host_qualified']
    previous = read(PREVIOUS)
    requirements = copy.deepcopy(previous['requirements'])
    assert [row['id'] for row in requirements] == [f'REQ-{i:03}' for i in range(1, 103)]
    assert Counter(row['recorded_assessment'] for row in requirements) == {
        'partial_verified': 86, 'completion_not_proven': 16}
    assert all(row['full_acceptance'] == 'open' for row in requirements)
    assert sum(row['optional'] for row in requirements) == 1
    resource = next(row for row in requirements if row['id'] == 'REQ-059')
    resource['previous_implemented_scope'] = resource['implemented_scope']
    resource['previous_remaining'] = resource['remaining']
    resource['implemented_scope'] = '阶段 121 方案／报价／租约／控制／计费／节点源码已整合发布；24 项资源事务回归和限定 UI 已通过。'
    resource['remaining'] = '真实 Linux 物理节点安装／回滚、独占操作与清理结算的实机验收，以及完整跨端异常与专业使用验收。'
    tasks = copy.deepcopy(previous['delivery_tasks'])
    updates = [
        ('bounded_passed_full_acceptance_open',
         f"112 个完整后端文件的 {counts['pass']} 项测试全部通过，最终后端目录另有 24 项专属资源回归通过；OpenAPI 增量为 20 路径／24 操作／11 Schema。此前失败原样留档。完整接口与业务验收矩阵仍未关闭。"),
        ('bounded_passed_full_acceptance_open',
         '最终源码客户端／交付工具 338 项测试、后端目录 24 项及三组实际 UI 24 项通过。完整跨端异常、安装、可访问性及系统矩阵仍待验收。'),
        ('completed_for_current_source_delivery',
         '六个独立仓库已整合并绑定最终版本，复制核对 185 个代码／配置文件、39 个最新媒体文件；保留历史文件，无递归删除。当前源码整合完成。'),
        ('completed_for_current_source_delivery',
         '六仓库及中央文档共 14 份双语 README 已更新方案、运行逻辑、流程图和实际媒体；29 张 PNG、5 组 GIF／MP4 及原始执行器／源码快照已归档核对。'),
        ('completed_for_current_source_delivery',
         '六产品分支与 docs/main 共八个引用已正常原子推送并重新读取核对，未强推。该结论是源码发布，不代表签名生产发行。'),
        ('open',
         '签名安装与更新、声明系统兼容、实际部署压测、生产环境恢复、真实供应商／广告账户质量、至少 12 个角色专业效果及客户业务接受仍待完成；可选物理 Linux 节点尚未实机验证。继续使用获准假数据。'),
    ]
    for task, (state, status) in zip(tasks, updates, strict=True):
        task.update(delivery_state=state, status=status)
    publication = {
        'status': receipt['status'], 'finished_at': receipt['finished_at'],
        'remote': receipt['remote'], 'manifest_sha256': receipt['manifest_sha256'],
        'branches': branches, 'remote_after': {key: receipt['remote_after'][key] for key in branches},
        'local_receipt': ref(receipt_file),
        'scope': 'Eight refs verified before this documentation-only addendum. Later docs/main commits do not change these component commits.',
    }
    publication_file = Q / 'dedicated-cloud-published-121.json'
    assert not publication_file.exists()
    value = {
        'schema_version': 1, 'reviewed_at': datetime.now(timezone.utc).isoformat(),
        'audit_kind': 'post_publication_status_addendum_preserving_formal_acceptance',
        'previous_review': ref(PREVIOUS), 'checkpoint': ref(CP), 'manifest': ref(MANIFEST),
        'summary': {**previous['summary'], 'integrated_components_of_six': 6,
                    'backend_complete_test_files': 112, 'backend_passed_tests': counts['pass'],
                    'integrated_backend_passed_tests': 24,
                    'current_delivery_categories_completed': 3,
                    'current_delivery_categories_bounded_passed_full_acceptance_open': 2,
                    'current_delivery_categories_open': 1},
        'user_authorized_synthetic_data': True,
        'requirements': requirements, 'delivery_tasks': tasks,
        'native_startup_reliability': cp['native_startup_reliability'],
        'publication': publication,
        'limits': [
            '102 counts open formal acceptance records, not wholly uncoded modules or a code completion percentage.',
            'The six delivery categories overlap original requirements and must not be added to 102.',
            'Bounded fixture-based passes do not establish live supplier quality, actual Linux operation or whole-product acceptance.',
            'The earlier failed raw runs and earlier dated status reviews remain unchanged.',
            'One observed native Codex initialization timeout remains unexplained; three fresh protocol diagnostics passed without changing the RPC deadline.',
            'This new addendum records current source publication; it does not rewrite existing qualification/proof bytes.',
        ],
        'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    lines = [
        '# 全部未关闭项与本轮交付 / Open acceptance and current delivery', '',
        '**原始需求仍有 102 项整体验收未关闭：101 项必需、1 项可选。**86 项已有部分验证，16 项完成尚未证实；这不是 102 个空白功能，也不是代码完成百分比。', '',
        f"本轮限定验证与发布已完成：后端 112 文件／{counts['pass']} 项，整合客户端 338 项，最终后端目录 24 项，实际 UI 24 项；六个产品分支与 docs/main 已推送核对。29 张截图、5 组 GIF／MP4。模型和节点响应继续使用明确假数据。", '',
        '已观察到的未关闭问题：一次原生 Codex 初始化超时，三个独立新目录的初始化诊断通过，原超时根因仍未确定。该问题归入现有 Codex／运行可靠性验收范围，不额外增加需求总数；失败与实际清理证据留档。', '',
        'This addendum preserves all original acceptance decisions. Source integration, bounded test completion and remote source publication are distinguished from full product, live supplier and customer acceptance.', '',
        '| 编号 | 本轮交付工作 | 当前状态和剩余范围 |',
        '| --- | --- | --- |',
    ]
    for task in tasks:
        lines.append(f"| {task['id']} | {task['task']} | {task['status']} |")
    lines += ['', '以下是全部 102 条未关闭需求；六项交付工作与它们重合，不另加总。每一行保留原始验收要求，限定测试通过不能自动关闭整项。', '',
              '| 编号 | 优先级 | 模块 | 已有实现／验证范围 | 尚未完成或尚未证明完成的内容 |',
              '| --- | --- | --- | --- | --- |']
    for row in requirements:
        lines.append(f"| {row['id']} | {row['priority']} | {row['module']} | {row['implemented_scope']} | {row['remaining']} |")
    lines += ['', 'G01—G10 与非功能验收仍保留在原需求中；不作为新增功能重复计数。自动支付订阅是后续扩展，不增加当前人工费用／VIP版本的数量。', '',
              '[结构化清单](remaining-work-stage121-published.json) · [源码发布回执](dedicated-cloud-published-121.json) · [当前限定验收](dedicated-cloud-checkpoint.json) · [不可变原始证据](dedicated-cloud-evidence-121/index.json) · [上一份带日期快照](remaining-work-2026-10-29.md)', '']
    save(publication_file, (json.dumps(publication, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    save(PREFIX.with_suffix('.json'), (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    save(PREFIX.with_suffix('.md'), '\n'.join(lines).encode('utf-8'))
    save(change, ('# 源码发布核对与待办补充 / Source publication and open-work addendum\n\n'
                  '六产品分支及 docs/main 的八个引用已正常原子推送并重新读取核对。新增发布回执和逐条编号待办；此前快照、失败执行及源绑定证据均保留原字节。\n\n'
                  'All eight reviewed refs were atomically pushed and read back. This documentation-only addendum records the source publication and all open acceptance items without rewriting earlier qualification, source bindings or historical evidence.\n\n'
                  '[全部编号待办 / All numbered open items](../quality/remaining-work-stage121-published.md) · '
                  '[发布回执 / Publication receipt](../quality/dedicated-cloud-published-121.json)\n\n'
                  '源码发布与限定测试不关闭原始整体验收、真实供应商、实际 Linux 节点及签名生产发行。\n').encode('utf-8'))
    print(json.dumps({'status': 'recorded', 'formal_acceptance_open': 102,
                      'published_refs': len(branches), 'backend_tests': counts['pass']}))


if __name__ == '__main__':
    main()
