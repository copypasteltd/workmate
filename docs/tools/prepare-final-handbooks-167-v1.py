"""Prepare bilingual v0.1.0 handbooks without rewriting historical evidence."""
from pathlib import Path
from datetime import datetime, timezone
import json

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
VERSION = 'v0.1.0'
COMPONENTS = {'backend': 'platform', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}


def new(p, text):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('x', encoding='utf-8', newline='\n') as f:
        f.write(text)


def replace_once(text, old, replacement):
    assert old in text, old[:100]
    return text.replace(old, replacement, 1)


def main():
    guide = (ROOT / 'docs/releases/v0.1.0-rc.5.md').read_text(encoding='utf-8')
    guide = guide.replace('v0.1.0-rc.5', VERSION).replace('dev\\rc5\\', 'dev\\release-v010\\')
    guide = replace_once(guide, '# Workmate v0.1.0 · 冻结交付 / Frozen handoff', '# Workmate v0.1.0 · 首个冻结交付版 / Initial frozen release')
    guide = replace_once(guide, '本版在上一冻结版上补齐首次创建工作区的丢响应恢复、Admin费用/VIP用户目标，以及用户目录筛选保留，并整理六仓双语README；历史README保留在docs/history。', '本版统一冻结当前全部端及源码，纳入首次工作区丢响应恢复、Admin费用/VIP正确用户目标、用户目录条件恢复，以及最新按用户创建者查看任务和二十类内容的入口。六仓均配中英README、逻辑图及真实截图/交互录制。')
    guide = replace_once(guide, 'This candidate adds lost-reply workspace recovery, correct Admin billing/VIP user targets and persistent directory filters, with organized bilingual handbooks and archived historical READMEs.', 'This release freezes all current clients and source, including workspace recovery, correct Admin fee/VIP targets, persistent directory filters and creator-filtered user tasks/content. Each component includes bilingual handbooks, logic diagrams and actual interface/interaction media.')
    guide = guide.replace('Windows 包为未签名候选版', 'Windows 包未签名').replace('Windows executables are unsigned', 'Windows executables are unsigned')
    guide = guide.replace('release-freeze-checkpoint-165.json', 'release-freeze-checkpoint-167.json').replace('remaining-work-stage165.md', 'remaining-work-stage167.md')
    a = guide.index('本版只运行与收口直接相关的七项SQL/HTTP检查')
    b = guide.index('## 本版交互恢复', a)
    guide = guide[:a] + '''本轮重新构建全部六仓。Desktop当前主程序和界面输出与rc.5已验收产物逐文件相同；核对完整目录87个文件、Portable、Setup及固定Codex后复用这些Windows字节。纳入阶段166已有八项原生SQL/API与八组实际Admin页面检查，冻结前核对其源码和原始回执摘要；这些是继承结果，不是本轮重新执行。按要求跳过全量历史重复回归。

All six components are rebuilt. Current Desktop main/renderer outputs exactly match the previously qualified rc.5 build. Its87 unpacked files, Portable, Setup and pinned Codex are verified and reused. Stage166's eight native SQL/API cases and eight actual Admin checks are inherited with exact source/evidence hashes, not relabelled as new runs. Broad historical repeat regression is omitted as requested.

''' + guide[b:]
    guide = replace_once(guide, '本版不以全量任务/内容链接替代尚未完成的用户专属筛选入口。', '用户详情可直接进入该用户创建的任务与内容；用户范围和资源范围同时鉴权，正文/下载权限独立。搜索/分页/刷新保留用户，返回恢复原目录；切换用户清空旧正文。品牌按首版实际作者归属，不把旧未知作者资料算给任意用户。扩展注册/活跃/VIP到期/消费范围组合筛选仍在后续清单。')
    guide = replace_once(guide, 'A unified user-filtered task/content entry remains pending.', 'User detail now opens creator-filtered tasks/content under the intersection of current user and resource scopes. Body/download authority stays separate. Search/paging/reload retain the target; returning restores directory filters and changing users clears old bodies. Brands use their original author; unknown legacy authors remain unattributed. Advanced registration/activity/VIP-expiry/spend filters remain tracked.')
    guide += '''
## 用户任务与内容 / User tasks and content

![实际用户内容 / Actual user content](../assets/admin-user-resources-166/workmate-admin-user-resources-166-02-user-resources-04-original-user-content.png)

![实际用户交互 / Actual user interaction](../assets/admin-user-resources-166/workmate-admin-user-resources-166-02-user-task-content-scope.gif)

[MP4](../assets/admin-user-resources-166/workmate-admin-user-resources-166-02-user-task-content-scope.mp4) · [本轮冻结 / Freeze details](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/development/167-final-release-freeze.md)

## 冻结后的开发 / Development after this freeze

`v0.1.0`及六个组件标签固定本次交付；后续修复通过分支、新提交和新版本发布，绝不覆盖本包或移动旧标签。组件包保留各自实际版本（例如Desktop0.7.1），总交付版号为v0.1.0，不伪造已签名或正式服务状态。

The release and six component tags remain immutable. Further work advances branches and a new version. Component package versions remain their actual values (for example Desktop0.7.1); v0.1.0 identifies the overall delivery without implying signing or production-provider qualification.
'''
    new(ROOT / 'docs/releases/v0.1.0.md', guide)

    for branch, component in COMPONENTS.items():
        repo = DEV / ('copypaste-' + component)
        for lang in ['zh', 'en']:
            p = repo / ('README.md' if lang == 'zh' else 'README.en.md')
            text = p.read_text(encoding='utf-8')
            top, rest = text.split('\n', 4)[:4], text.split('\n', 4)[4]
            text = '\n'.join(line.replace('v0.1.0-rc.5', VERSION) for line in top) + '\n' + rest
            if lang == 'zh':
                text = text.replace('## 当前分支增量 · 阶段166', '## 本版用户任务与内容 · 阶段166')
                text = text.replace('这是 rc.5 发布后的源码增量，不在已冻结的 rc.5 ZIP 内。冻结标签与下载保持原样。', '该功能已纳入v0.1.0源码与分发包；旧rc.5包和标签保持原样。')
                text = text.replace('用户专属任务/内容的统一筛选入口仍待补齐。', '用户详情可进入创建者限定的任务/内容；搜索、分页、刷新和返回保留目标与目录条件，正文权限独立。')
                banner = f'''## 当前冻结版 · v0.1.0

本版统一交付所有端、后端和六仓源码，包含最新用户任务/内容入口。六仓重新构建；当前Desktop输出与已验收Windows完整目录/Portable/Setup逐文件一致，核对后复用。近期阶段166八项SQL/API与八组实际页面检查保留其源码及原始证据；本轮不重跑全部历史用例。

分支`{branch}`，本版固定标签`v0.1.0-{branch}`。[完整源码与安装包](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0) · [冻结记录](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/quality/release-freeze-checkpoint-167.json) · [待办](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/quality/remaining-work-stage167.md)。AI/媒体/广告/支付为已授权假数据；Windows未签名。截图/GIF/MP4保留其原实际采集范围，不宣称新增全端安装或专业质量验收。

'''
                text = replace_once(text, '## 方案与结构\n', banner + '## 方案与结构\n')
                text = text.replace('本次运行七项定向SQL、四项创建草稿检查和实际Web/Admin操作，重建六仓与Windows unpacked/Portable/Setup，核对ASAR和固定Codex。', '以下为历史rc.5记录：当时运行七项定向SQL、四项创建草稿检查和实际Web/Admin操作，重建六仓与Windows unpacked/Portable/Setup，核对ASAR和固定Codex。')
                text = text.replace('## 验证与发布', '## 历史rc.5验证与发布')
            else:
                text = text.replace('## Current branch increment · stage166', '## Included user tasks/content · stage166')
                text = text.replace('This source increment follows rc.5 and is not inside its frozen ZIP. Frozen tags/downloads stay unchanged.', 'This functionality is included in v0.1.0 sources/distributions. Previous rc.5 tags/downloads stay unchanged.')
                text = text.replace('Unified user-filtered task/content entries remain pending.', 'User detail opens creator-filtered tasks/content. Search, paging, reload and return retain the target and directory conditions; body authority remains separate.')
                text = text.replace('A unified user-filtered task/content entry remains pending.', 'User detail opens creator-filtered tasks/content with separate body authority and preserved navigation.')
                banner = f'''## Current frozen release · v0.1.0

All clients, backend and six source trees are delivered together, including the latest creator-filtered Admin tasks/content. Six components are rebuilt. Rebuilt Desktop outputs match the qualified Windows app/Portable/Setup byte for byte, so those verified binaries are reused. Stage166's eight SQL/API cases and eight actual UI checks retain their source-bound original evidence; broad historical regression is not rerun.

Branch`{branch}`, frozen tag`v0.1.0-{branch}`. [Source and installers](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0) · [Freeze record](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/quality/release-freeze-checkpoint-167.json) · [Open work](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/quality/remaining-work-stage167.md). AI/media/ads/payments use the authorized synthetic mode; Windows is unsigned. Existing screenshots/GIF/MP4 retain their actual capture scope and do not imply new full installation/professional qualification.

'''
                text = replace_once(text, '## Architecture and responsibilities\n', banner + '## Architecture and responsibilities\n')
                text = text.replace('Seven focused SQL cases, four draft-state cases and actual Web/Admin interactions accompany six builds and Windows unpacked/Portable/Setup packaging.', 'Historical rc.5 record: seven focused SQL cases, four draft-state cases and actual Web/Admin interactions accompanied six builds and Windows unpacked/Portable/Setup packaging.')
                text = text.replace('## Qualification and publication', '## Historical rc.5 qualification and publication')
            p.write_text(text, encoding='utf-8', newline='\n')

    old = json.loads((ROOT / 'docs/quality/remaining-work-stage166.json').read_bytes())
    old['schema_version'] += 1
    old['reviewed_at'] = datetime.now(timezone.utc).isoformat()
    old['stage167_note'] = 'Frozen v0.1.0 source and all distributions now include stage166. No original full acceptance requirement is newly closed; advanced directory filters and original production/OS/professional scopes remain.'
    new(ROOT / 'docs/quality/remaining-work-stage167.json', json.dumps(old, ensure_ascii=False, indent=2) + '\n')
    ledger = (ROOT / 'docs/quality/remaining-work-stage166.md').read_text(encoding='utf-8')
    ledger = ledger.replace('# 阶段166 · 原编号验收与用户管理闭环', '# 阶段167 · v0.1.0冻结后的原编号验收')
    ledger = ledger.replace('本轮：按用户创建者的任务/二十类内容入口、品牌作者、权限交集和导航恢复已实现。', '本轮：全部端、最新后台用户任务/二十类内容入口、六仓源码、双语文档和真实媒体统一纳入v0.1.0冻结包。')
    new(ROOT / 'docs/quality/remaining-work-stage167.md', ledger)

    new(ROOT / 'docs/development/167-final-release-freeze.md', '''# 167 · v0.1.0最终冻结与交付

按最新指示停止扩展本版功能，冻结当前主流程：Web/Extension云端Codex，Desktop本机Codex和主动完整权限，独立Admin MFA及用户/用量/费用/VIP/内容管理，角色/Skill、营销/设计/分析及企业流程模块。最新166用户任务/内容创建者入口进入分发包，不再仅留在分支。

## 构建与必要核对

六仓生产构建。当前Desktop主进程/renderer输出必须与165原冻结检查点逐文件相同，且原Windows87文件及Portable/Setup摘要相同才可复用；否则本工具失败，不把不同源码配旧二进制。固定Codex0.163.0-alpha.11及辅助程序保持。Extension保留原生side_panel，无popup。

166八项SQL/API和八组实际Admin旅程只在源码及原回执摘要相同情况下继承，原失败与媒体不变。按要求省略全历史重复回归，不新增浏览器/数据库，不用Docker/WSL。旧浏览器采集记录保留原关闭证明；本轮不宣称再测全部原生能力。

## 源码、标签与包

六仓当前双语README同步v0.1.0，图和媒体保留真实来源；七个新固定标签与八个分支普通原子推送，之后读取远端SHA。七类归档包含Windows、Web、Admin、Extension、后端、完整可构建源码、固定runtime；总包附版本/逐文件清单及SHA256SUMS。Git元数据、依赖、本地秘密、数据库、私人证据不进源码包，完整历史仍在独立分支。冻结源码提交后才打包，发布回执可以另推进docs/main，标签不移动。

## 保持的边界

AI/媒体/广告/支付使用用户已授权假数据；Windows未签名。v0.1.0是本次交付标识，各组件保留真实包版本。正式模型/广告/支付接入、签名安装更新、其他OS、扩展目录筛选及完整专业验收均继续按原编号跟踪，不把源码包齐备写作全部产品验收通过。
''')
    new(ROOT / 'docs/changes/167-final-release-freeze.md', '''# 167 · v0.1.0冻结更新

|编号|本轮处理|状态|
|---|---|---|
|1|将166用户任务/内容、权限交集和导航恢复纳入同一发行包|冻结源码|
|2|六仓生产构建；Windows当前输出与原验收包核对后复用|检查点记录|
|3|六仓双语README、逻辑图、实际截图/GIF/MP4及安装使用说明|同步|
|4|完整源码、固定Codex、七类归档、总ZIP、逐文件校验|新版本封装|
|5|八分支及七个v0.1.0标签普通发布；保留旧版本|发布回执记录|
|6|正式外部服务、签名更新、跨OS及完整专业验收|后续；假数据已获授权|
|7|用户目录注册/活跃/VIP到期/消费范围等扩展组合筛选|后续；不扩大本次冻结范围|

按最新指示加速冻结，仅做必要构建、源码/字节/回执核对，省略全历史重复回归。原102编号、88项必选完整验收范围保持；后者不是88个未开发模块。This release packages the current complete source and supported flows while preserving original unclosed acceptance scopes.
''')
    for lang in ['zh', 'en']:
        p = ROOT / ('docs/README.md' if lang == 'zh' else 'docs/README.en.md')
        text = '''# Workmate · v0.1.0 · 冻结交付 / Frozen delivery

[中文使用 / Bilingual guide](releases/v0.1.0.md) · [完整Release / Release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0) · [完整ZIP / Complete ZIP](https://github.com/copypasteltd/workmate/releases/download/v0.1.0/workmate-v0.1.0-complete.zip) · [SHA256](https://github.com/copypasteltd/workmate/releases/download/v0.1.0/workmate-v0.1.0-complete.zip.sha256)

统一冻结所有端、后端及六仓可构建源码，纳入最新后台用户任务/内容入口。Web/Chrome右侧栏使用云端Codex；无边框Desktop在客户本机运行Codex，客户主动授予完整本机权限。Admin独立MFA管理用户、费用、VIP和内容。AI/媒体/广告/支付使用已授权假数据，Windows未签名。

All clients, backend and six buildable source trees are frozen together, including creator-filtered Admin tasks/content. Web/Side Panel execute cloud Codex; frameless Desktop executes locally with explicitly granted full permission. Admin has independent MFA. Authorized synthetic services; unsigned Windows.

## 使用与资料 / Usage and references

1. 下载完整ZIP及校验文件，按指南合并源码和runtime。
2. 第一次写配置前选空闲数据库端口；Delivery依次执行`demo:preflight`、`bootstrap:demo`、`demo:check`和`demo`，结束运行`npm run stop`。不用Docker/WSL。
3. Web邮箱登录→企业/项目→角色/输入/预算→执行→审阅下载。Admin单独开户和TOTP；普通用户不获得后台权限。

|文档 / Document|入口 / Link|
|---|---|
|产品 / Product|[PRD](product/01-prd.md) · [用户流程](product/02-user-journeys.md)|
|角色与Skill / Presets|[角色模板](product/06-role-templates-and-skill-presets.md)|
|品牌 / Brand|[设计系统](product/07-brand-design-system.md)|
|管理后台 / Admin|[管理设计](product/08-admin-dashboard.md) · [用户任务/内容](requirements/27-admin-user-resource-context.md)|
|技术 / Architecture|[架构](technical/01-architecture-and-stack.md) · [内核/API](technical/02-runtime-and-ai-gateway.md) · [本机/云端职责](requirements/03-client-execution-amendment.md)|
|当前冻结 / Freeze|[实现说明](development/167-final-release-freeze.md) · [本轮编号更新](changes/167-final-release-freeze.md)|
|必要检查 / Focused evidence|[冻结检查点](quality/release-freeze-checkpoint-167.json) · [166原始功能检查](quality/admin-user-resources-166.json)|
|原编号待办 / Acceptance ledger|[102项完整台账](quality/remaining-work-stage167.md)|
|路径与Git / Workspace|[路径规范](governance/03-workspace-and-path-policy.md) · [分支发布](governance/04-git-branches-and-publication.md)|

## 独立仓库 / Independent repositories

|Branch|Directory|Frozen tag|
|---|---|---|
'''
        for b, c in COMPONENTS.items():
            text += f'|[{b}](https://github.com/copypasteltd/workmate/tree/{b})|`dev/copypaste-{c}`|`v0.1.0-{b}`|\n'
        text += '''
全部开发根目录为`D:/dev/copypasted/自有agent/`，代码/配套开发脚本在`dev/`，主文档在`docs/`；各仓自带中英README、逻辑图和真实截图/GIF/MP4。源码包不含依赖、秘密、数据库或Git元数据；完整历史在上述分支。

Six fresh builds; byte-identical qualified Windows binaries are verified and reused. Recent source-identical focused checks are inherited, not rerun. Full historical regression is omitted. Frozen tags/bytes remain immutable; later work uses new commits/releases.

## 后续与历史 / Open work and history

正式外部服务、签名安装更新、其他OS、专业质量及用户目录扩展组合筛选仍在原编号台账。保留102原编号与88项必选完整验收范围；88不是未实现模块数。本版交付齐全不表示全部专业/生产验收通过。

Production providers, signing/update, other OSes, advanced directory filters and full professional acceptance remain tracked without changing original requirement scope.

[保留rc.5 / Preserved rc.5](releases/v0.1.0-rc.5.md) · [rc.5发布回执](quality/release-publication-165.json) · [166源码发布回执](quality/admin-user-resources-publication-166.json)
'''
        p.write_text(text, encoding='utf-8', newline='\n')
    print('Prepared current six-repository bilingual handbooks, release guide and unchanged-scope ledger.')


if __name__ == '__main__':
    main()
