"""Publish only admitted matrix/native results without changing original cases."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / 'dev/copypaste-delivery'


def prepend(path, marker, paragraph):
    text = path.read_text(encoding='utf-8')
    if marker in text:
        return
    heading, body = text.split('\n\n', 1)
    path.write_text(heading + '\n\n' + marker + '\n' + paragraph + '\n\n' + body,
                    encoding='utf-8', newline='\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--native', required=True)
    args = parser.parse_args()
    native = json.loads((DELIVERY / f'evidence/creative-matrix-native-{args.native}.json').read_text(encoding='utf-8'))
    upgrade = json.loads((DELIVERY / 'evidence/creative-matrix-upgrade.json').read_text(encoding='utf-8'))
    assert native['status'] == upgrade['status'] == 'passed'
    assert native['counts']['checks'] >= 13
    marker = '<!-- stage59-creative-matrices -->'
    paragraph = ('阶段 59 的[营销设计矩阵](technical/59-creative-production-matrices.md)已完成确定性排版子流程：'
                 '创意 × 语言 × 尺寸最多 60 个独立单元，保存实际 PNG、SVG 与 JSON；失败、修改、重试与费用按格独立。'
                 '专项 **22/22** 纳入平台 **607/607**（保留原全部 588 项命名测试），实际 Web **10 项**及新打包原生客户端 '
                 f'**{native["counts"]["checks"]} 项**通过。修复了桌面长页面滚动后的弹窗定位，继续无边框、无默认菜单；'
                 '扩展实际按钮打开/关闭 Chrome 原生 Side Panel，并提供完整设计工作台入口。'
                 '两库 068→069 各保留 151 张原表全部行摘要及 SQL001–068。'
                 '新包位于各端 `release/matrices-59-02/`，旧包保留；未签名 localhost 预览不代表安装或生产资格。'
                 '排版不调用 AI，AI HK$0 不包括原素材上游费用；Codex 委派、专业媒体和字体资格仍独立跟踪。'
                 '[核查回执](quality/creative-matrix-checkpoint.json)保留全部失败与源码前像，原始 102 项、TC/NFR/G01–G10 的完整条件不变。')
    for file in ('docs/README.md', 'docs/DELIVERY.md'):
        prepend(ROOT / file, marker, paragraph)
    audit = paragraph.replace('(technical/', '(../technical/').replace('(quality/', '(')
    prepend(ROOT / 'docs/quality/09-implementation-alignment-audit.md', marker, audit)
    prepend(ROOT / 'docs/quality/02-requirements-traceability.md', marker,
            '阶段 59 在原 REQ-017/TC-017 条件下验证了本地排版子流程；关联 REQ-012/016/022/048/049/052 的独立输出、权限与删除。'
            '原表及原验收条件保持不变，当前执行与剩余项见[矩阵回执](creative-matrix-checkpoint.json)和[增量设计](../technical/59-creative-production-matrices.md)。')
    p = ROOT / 'docs/README.md'
    text = p.read_text(encoding='utf-8')
    row = '| 技术 | [59 营销设计矩阵](technical/59-creative-production-matrices.md) | 独立单元、真实排版、重试、权限与派生删除 |\n'
    if row not in text:
        lines = text.splitlines(keepends=True)
        index = next(i for i, line in enumerate(lines) if '[58 调用管理' in line)
        lines.insert(index + 1, row)
        p.write_text(''.join(lines), encoding='utf-8', newline='\n')
    p = ROOT / 'docs/quality/01-test-and-acceptance-plan.md'
    text = p.read_text(encoding='utf-8')
    start = text.index('### TC-017 ')
    end = text.index('### TC-018 ', start)
    part = text[start:end]
    if marker not in part:
        note = (marker + '\n阶段 59 执行记录：原 18 格、一格失败、另一格修改、原失败格重试及其余 16 格不变，'
                '并实际执行 60 格及超限拒绝，已在本地确定性排版中验证；实际 Web 与新打包 Desktop/原生侧栏均执行。'
                '详见[实际来源与记录](creative-matrix-checkpoint.json)。上方原始综合用例状态仍保留，'
                '本记录不代表 Codex 委派、其他媒体、商业字体或综合发行资格全部通过。\n\n')
        text = text[:end] + note + text[end:]
        p.write_text(text, encoding='utf-8', newline='\n')
    p = ROOT / 'docs/technical/59-creative-production-matrices.md'
    text = p.read_text(encoding='utf-8').replace('状态：实现中，尚未验收。', '状态：本地确定性排版子流程已验证；完整产品综合验收继续跟踪。', 1)
    if marker not in text:
        text += ('\n' + marker + '\n## 当前实际执行\n\n'
                 '专项 22/22、平台 607/607、实际 Web 10 项及新打包原生客户端 '
                 f'{native["counts"]["checks"]} 项通过，类型与既有 Web 8、Desktop 25、Extension 21、Delivery 12 项测试通过。'
                 '实际复查包括原生无菜单/窗口按钮/PKCE、长页面后的弹窗、单格修改、真实工具栏侧栏及双语。'
                 '两库升级保留 151 张原表、新三表强制 RLS。全部实际截图、来源绑定与失败记录见[核查回执](../quality/creative-matrix-checkpoint.json)。\n\n'
                 'Desktop 首次候选的滚动弹窗问题已保留在失败记录，修复仅位于原生 preload，未修改已通过 607 项的后端/Web 来源。'
                 '修复后单独重建 `release/matrices-59-02/` 并重新执行原生流程，旧 `matrices-59/` 与 `adoption-54/` 包保持原字节。\n\n'
                 f'![实际无边框桌面](../design/implementation/matrices-59/matrix-native-{args.native}-matrix-en.png)\n\n'
                 f'![实际 Chrome 原生侧栏](../design/implementation/matrices-59/matrix-native-{args.native}-sidepanel-en.png)\n\n'
                 '![实际 18 格矩阵](../design/implementation/matrices-59/creative-matrix-04-matrix-18-en.png)\n')
    p.write_text(text, encoding='utf-8', newline='\n')
    prepend(ROOT / 'docs/technical/30-native-window-and-browser-sidepanel.md', marker,
            '阶段 59 已重建并实际执行当前无边框 Desktop 与 Chrome 原生侧栏，新增设计矩阵入口和滚动后的弹窗定位修复。'
            f'本次 {native["counts"]["checks"]} 项原生流程通过，实际来源及包见[阶段 59 回执](../quality/creative-matrix-checkpoint.json)与[当前包清单](../quality/creative-matrix-artifacts.json)。'
            '当前包为各端 `release/matrices-59-02/`；下面阶段 54 的包和核对命令保留其原历史范围。'
            '右侧仍尊重 Chrome 用户设置，未签名 localhost 预览未代表安装、商店及生产验收。')
    print('Published admitted stage 59 design, delivery and scoped TC-017 notes.')


if __name__ == '__main__':
    main()
