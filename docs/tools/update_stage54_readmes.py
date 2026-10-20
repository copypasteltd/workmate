"""Update bilingual standalone repository entry points from successful stage54 receipts."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'


def main():
    p = argparse.ArgumentParser()
    for name in ('focused','full','ui','native','artifacts'):
        p.add_argument('--' + name, required=True)
    args = p.parse_args()
    evidence = DEV / 'copypaste-delivery/evidence'
    runs = {k: json.loads((evidence / f'agent-adoption-{v}-{getattr(args,k)}.json').read_text(encoding='utf-8')) for k,v in [('focused','candidate'),('full','regression'),('ui','ui'),('native','native'),('artifacts','artifacts')]}
    assert all(r['status'] == 'passed' for r in runs.values())
    full = runs['full']['counts']['tests']
    focused = runs['focused']['counts']['tests']
    native = runs['native']['counts']['checks']
    ui = runs['ui']['counts']['checks']
    for repo in ('platform','web','desktop','extension','delivery'):
        for en in (False, True):
            file = DEV / ('copypaste-' + repo) / ('README.en.md' if en else 'README.md')
            text = file.read_text(encoding='utf-8')
            title, rest = text.split('\n',1)
            assert 'Explicit adoption (stage 54)' not in text and '明确采用版本（阶段 54）' not in text
            if en:
                body = f'## Explicit adoption (stage 54)\n\nDefault assistant updates, specialist settings and conversation adoption now compare the exact models, effort, unit rates and Skill versions before explicit consent. Five-minute comparisons bind the real session and current configuration; stale comparisons are rejected. Retries use one persistent operation key. Previously accepted tasks keep their original versions and prices.\n\nCurrent backend regression: **{full}/{full}**, including all 462 prior named tests; focused **{focused}/{focused}** overlaps that total. Actual built Web: **{ui}/{ui}**; new packaged frameless Desktop and real native Chrome Side Panel: **{native}/{native}**. AI/media use the authorized simulated dependencies; identity, PostgreSQL, permissions and version transactions execute normally. All 102 original requirements remain tracked. Earlier sections below retain their historical source and artifact scope.\n\n'
            else:
                body = f'## 明确采用版本（阶段 54）\n\n默认助手更新、专家设置与会话采用先比较明确模型、推理强度、单价及 Skill 版本，再由用户确认。五分钟比较绑定实际登录会话与配置状态，过期或变化拒绝确认；重试使用持久幂等键。已接收任务继续原模型和原费率。\n\n当前平台完整回归 **{full}/{full}**，保留原 462 项测试；专项 **{focused}/{focused}** 与全量重叠，不相加。实际构建版 Web **{ui}/{ui}**，新版无边框打包 Desktop 与真实 Chrome 原生侧栏 **{native}/{native}**。AI/媒体使用已授权假数据，身份、PostgreSQL、权限与版本事务实际执行。原始 102 项综合验收继续跟踪；以下旧章节保留其时源码与产物范围。\n\n'
            if repo in ('web','desktop','extension'):
                image = {'web': f'adoption-{args.ui}-specialist-comparison-en.png', 'desktop': f'adoption-native-{args.native}-comparison-en.png', 'extension': f'adoption-native-{args.native}-sidepanel-en.png'}[repo]
                body += f'![Actual version review](assets/screenshots/{image})\n\n'
                if repo == 'web':
                    body += f'![390px Traditional Chinese dark review](assets/screenshots/adoption-{args.ui}-narrow-dark-zh.png)\n\n'
                if repo == 'desktop':
                    body += ("New local preview: `release/adoption-54/CopyPaste-0.5.0-x64-Setup.exe`, `CopyPaste-0.5.0-x64-Portable.exe` and `win-unpacked/CopyPaste.exe`. No native frame, Electron menu or Alt menu; custom controls remain active. The packaged executable was run; Setup/Portable were not installed. These are unsigned localhost previews. Previous `release/frameless/` bytes are retained.\n\n" if en else "新版本机预览位于 `release/adoption-54/`：`CopyPaste-0.5.0-x64-Setup.exe`、`CopyPaste-0.5.0-x64-Portable.exe` 与 `win-unpacked/CopyPaste.exe`。无系统边框、Electron 菜单或 Alt 菜单，保留自绘窗口控制。实际执行了解包程序，Setup/Portable 未安装；均为未签名 localhost 预览。原 `release/frameless/` 保留原字节。\n\n")
                if repo == 'extension':
                    body += ("Click the toolbar icon to open the actual native Side Panel (right side with default Chrome settings); click again to close. No action popup is configured. The new bilingual review button opens the company's fixed `/app/specialists` workspace; the panel uses its own compact renderer. Chrome controls left/right placement. New loadable ZIP: `release/adoption-54/CopyPaste-0.5.0-sidepanel.zip`; the previous `release/sidepanel/` bytes remain intact.\n\n" if en else "点击工具栏图标打开原生 Side Panel，默认右侧，再次点击收起；不设置 action popup。新增双语“檢視模型與費率版本”进入公司固定 `/app/specialists` 工作区，侧栏继续使用独立精简渲染器。左右位置由 Chrome 偏好决定。新版可加载 ZIP：`release/adoption-54/CopyPaste-0.5.0-sidepanel.zip`，原 `release/sidepanel/` 字节保留。\n\n")
                body += '```mermaid\nflowchart LR\n  Entry[Workspace / native entry] --> Compare[Freeze model and rate comparison]\n  Compare --> Consent[Explicit user consent]\n  Consent --> Save[Atomic version and receipt]\n  Save --> Future[Future tasks]\n  Existing[Already accepted tasks] --> Original[Original versions and prices]\n```\n\n'
            elif repo == 'platform':
                body += ("Migration `065-explicit-agent-adoption.sql` is forward-only: tenant/actor RLS, column-limited consumption and bounded Skill locks. Both existing databases retain all 131 pre-existing public tables and SQL001–064 byte checksums. No historical adoption facts are fabricated. Main implementation: `src/agent-adoption.ts`; semantic integration coverage: `tests/agent-adoption.test.ts`.\n\n" if en else "前向迁移 `065-explicit-agent-adoption.sql` 增加企业/用户 RLS、限定列消耗和有界 Skill 共享锁。两套现有数据库完整保留各自 131 张原公共表及 SQL001–064 字节和校验值，不补造历史采用事实。核心为 `src/agent-adoption.ts`，语义集成测试为 `tests/agent-adoption.test.ts`。\n\n")
            else:
                body += f'[Focused regression](evidence/agent-adoption-candidate-{args.focused}.json) · [Full regression](evidence/agent-adoption-regression-{args.full}.json) · [Built Web](evidence/agent-adoption-ui-{args.ui}.json) · [Native Desktop / Side Panel](evidence/agent-adoption-native-{args.native}.json) · [Artifact hashes](evidence/agent-adoption-artifacts-{args.artifacts}.json) · [Original-row preservation](evidence/agent-adoption-migrations.json)\n\n'
                body += ('Run a new numbered attempt; existing reports are never overwritten. Native QA uses an owned profile, real toolbar action and PKCE, then closes its own windows and processes. Setup/Portable provenance is checked without installation. No Docker or WSL is used.\n\n' if en else '复查须使用新编号，不覆盖报告。原生验证使用独立 profile、实际工具栏动作与 PKCE，结束后关闭自己的窗口和进程。Setup/Portable 核对字节来源，不代表安装验收；全程不使用 Docker/WSL。\n\n')
                body += '```powershell\nnode scripts/run-agent-adoption-candidate.mjs NEXT_ID\nnode scripts/run-agent-adoption-regression.mjs NEXT_ID\nnode scripts/run-agent-adoption-ui.mjs NEXT_ID\nnode scripts/run-agent-adoption-native.mjs NEXT_ID\n```\n\n'
                body += ('Replace `NEXT_ID` with a fresh two-digit number. Native extension QA uses the installed test Chromium under `.data/browsers/chromium-1248/chrome-win64/chrome.exe`; set `CHROME_BIN` to another Chromium build supporting unpacked extension testing when needed. The local database upgrade is already applied; its one-time before-state guard rejects repetition.\n\n' if en else '`NEXT_ID` 替换为未使用的两位编号。原生侧栏 QA 默认使用本机 `.data/browsers/chromium-1248/chrome-win64/chrome.exe` 测试运行时，也可设置 `CHROME_BIN` 为支持未打包扩展测试的 Chromium。本机升级已完成，一次性升级前态守卫会拒绝重复执行。\n\n')
            file.write_text(title+'\n\n'+body+rest.lstrip('\n'),encoding='utf-8',newline='\n')
    print(json.dumps({'updated_readmes':10,'platform_tests':full,'web_checks':ui,'native_checks':native}))


if __name__ == '__main__':
    main()
