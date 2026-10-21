"""Publish current bounded SEO delivery notes and byte-identical screenshots."""
import argparse
import shutil
from refresh_stage52_capabilities import ROOT, DEV, DELIVERY, read, git, digest

BASES = {'platform': '794c9d371501df69db3ad4df23efc223c82489fb', 'web': '7e25969174aaebd4fea5a027ce5df69372902438', 'admin': 'cb1181aa459e0cdc2435e6d3d605bead3b418022', 'desktop': 'f1f0b81cec174a7fe857ee5afed165ac30ffc23c', 'extension': '2fd85ce4841efd85818312f4f1f00c85a996f3b4', 'delivery': '370fef0b1361a72914928f3f306b111e111a0cc9'}


def prepend(path, text):
    marker = '<!-- stage62-scoped-seo -->'
    old = path.read_text(encoding='utf-8').replace('\r\n', '\n')
    assert marker not in old
    title, body = old.split('\n\n', 1)
    path.write_text(title+'\n\n'+marker+'\n'+text.strip()+'\n\n'+body, encoding='utf-8', newline='\n')


def main():
    p = argparse.ArgumentParser()
    for name in ('integration', 'full', 'ui', 'native', 'clients', 'upgrade'):
        p.add_argument('--'+name, required=True)
    a = p.parse_args()
    runs = {name: read(DELIVERY/f'evidence/scoped-seo-{kind}-{getattr(a, name)}.json') for name, kind in [('integration', 'integration'), ('full', 'regression'), ('ui', 'ui'), ('native', 'native'), ('clients', 'clients'), ('upgrade', 'upgrade')]}
    assert all(r['status'] == 'passed' for r in runs.values())
    count, total = runs['integration']['counts']['pass'], runs['full']['counts']['pass']
    ui, native = runs['ui']['counts']['checks'], runs['native']['counts']['checks']
    zh = f'''## 有范围约束的网站诊断与复查（阶段 62）

在「行销分析 → 网站诊断与复查」确认起始网址、精确主机、路径前缀、页面请求数和 AI 预算，再明确授权启动。工作台显示范围、请求进度、未检查页面和访问限制；问题保留逐 URL 原文、取回时间、HTTP/字符编码及摘要，支持真实 JSON/HTML 下载。修复后明确建立相同范围的新复查，仅对实际检查的页面判定变化，旧版本保持不可变。

按当前授权使用**模拟业务和 AI 数据**。抓取在非生产夹具执行真实原生 HTTP；Codex 是唯一 Agent 内核，报告由实际 Codex 进程经公司内部 OpenAI 兼容模拟网关生成。公网部署和真实模型质量尚未验收。仅公开获准主机/路径，每个 DNS 回答和重定向校验地址范围；不转发登录凭证、不执行脚本或提交表单。robots、登录、错误、剩余范围和串行抓取限制明确显示。存储不足停止抓取并释放未使用的模型预留。

来源、缓存祖先、复查历史、报告及主动发布副本受当前私有权限、保留期、隔离和删除约束；读取存储后再次检查身份。Admin 的企业/项目范围、元数据、正文和内容操作权限分别执行，隔离来源同时阻止客户继续读取派生证据。完整「保存修改任务」、Search Console 连接指标、GEO 观测、规范 TaskDTO 和原全部验收条件继续保留。

**Desktop 无边框**，保留自绘拖动区、最小化/最大化/关闭，无 Electron 默认边框、应用菜单或 Alt 菜单。登录使用邮箱验证码会话（本地测试邮箱投递）与实际 PKCE 流程；下载通过当前租户认证桥和原生保存窗口。**Extension 工具栏开关 Chrome 原生 Side Panel**，默认右侧并遵循 Chrome 的位置偏好；「网站诊断与复查」仅打开固定公司工作台，临时测试标签页在验收后关闭。

验证：专项 **{count}/{count}**，完整平台 **{total}/{total}**，保留前一阶段全部 **674 项**命名测试；实际 Web/Admin **{ui} 项**、当前新包原生 **{native} 项**。两库 SQL077→079 保留原 **164 张**公共表全部行摘要和 SQL001–077，三张新增表为空并强制 RLS。完整产品仍为 81 项有局部证据、21 项未证明完成、0 项完整验收。

当前 localhost 预览：Desktop `release/scoped-seo-62-02/`；Extension `release/scoped-seo-62-02/CopyPaste-0.5.0-sidepanel.zip`。已执行 unpacked Desktop 与真正的 Chrome 侧栏；Setup/Portable 未签名，未执行安装、商店发布或生产验收。以下较早章节为历史记录，其「当前」只指当时的源码和包。
'''
    en = f'''## Scoped website audits and rechecks (stage 62)

Open Marketing insights → Website audits & rechecks. Confirm seed URLs, exact hosts, path prefixes, page-request and AI budgets, then explicitly authorize collection. Inspect progress, uncovered URLs, access limits and URL findings with original quotes, capture times, HTTP/charset facts and hashes. Download actual JSON/HTML attachments. An explicitly requested same-scope recheck creates immutable new history and confirms changes only for pages actually inspected.

Business and AI data remain **synthetic as authorized**. The non-production fixture performs actual native HTTP; a real locked Codex process interprets retained facts through the company's internal OpenAI-compatible synthetic gateway. Public deployment and live model quality remain unqualified. Every DNS answer and redirect is scoped. Collection submits no credentials/forms and executes no scripts. Robots, login pages, errors, unvisited scope and sequential collection limits stay explicit. Storage exhaustion stops collection and releases the unused inference reservation.

Private sources, cache ancestors, recheck history, reports and deliberately published copies retain current authorization, retention, quarantine and erasure controls. Identity is checked again after storage I/O. Admin tenant/project scope, metadata, body access and content operations remain separate. Quarantining a source fences derived customer evidence. Saved website change tasks, Search Console connection metrics, GEO observations, canonical TaskDTO and complete original acceptance remain tracked.

**Desktop stays frameless**, with custom dragging and minimize/maximize/close controls, no Electron native frame, application menu or Alt menu. Email-code sessions use local test mailbox delivery, with actual PKCE identity and tenant-bound authenticated native saves. The extension toolbar toggles **Chrome's native Side Panel**, right by default and subject to Chrome preferences. Its Website audits & rechecks action opens only the fixed company workspace. Owned temporary test tabs are closed.

Validation: **{count}/{count} focused checks, {total}/{total} Platform tests**, retaining all **674** previous named tests; **{ui} actual Web/Admin and {native} newly packaged native checks**. Both native databases upgrade SQL077→079 while retaining all rows in **164** prior public tables and SQL001–077. Three added tables are empty with FORCE RLS. Original product tracking remains 81 partially verified, 21 not proven complete and zero fully accepted requirements.

Current localhost previews: Desktop `release/scoped-seo-62-02/`; Extension `release/scoped-seo-62-02/CopyPaste-0.5.0-sidepanel.zip`. The unpacked Desktop and actual native Side Panel were run. Setup/Portable remain unsigned and were not installed, published or production-qualified. Earlier sections retain historical source/package scope.
'''
    diagram = '''```mermaid
flowchart LR
  Login[Email / PKCE and current project] --> Confirm[Confirm host / path / request and AI budgets]
  Confirm --> Crawl[Durable bounded HTTP / robots / DNS pinning]
  Crawl --> Evidence[Immutable URL findings and raw source versions]
  Evidence --> Codex[Locked Codex / internal gateway / bound facts]
  Codex --> Download[JSON and validated HTML downloads]
  Evidence --> Recheck[Explicit same-scope immutable recheck]
  Recheck --> Compare[Observed repairs / persistent / unknown]
  Desktop[Frameless Desktop / native authenticated save] --> Download
  Panel[Toolbar / Chrome native Side Panel] --> Confirm
  Admin[Scoped Admin / separate metadata and body permissions] --> Govern[Quarantine / retention / erasure]
  Govern --> Evidence
```'''
    gallery = {
        'web': [(f'scoped-seo-{a.ui}-findings-en.png', 'Actual URL findings and retained quotes'), (f'scoped-seo-{a.ui}-recheck-zh-narrow.png', 'Traditional Chinese narrow recheck')],
        'admin': [(f'scoped-seo-{a.ui}-source-metadata-en.png', 'Scoped Admin metadata without body access'), (f'scoped-seo-{a.ui}-source-body-en.png', 'Separately authorized source body review')],
        'desktop': [(f'seo-native-{a.native}-seo-source-en.png', 'Actual packaged frameless Desktop source inspection'), (f'seo-native-{a.native}-seo-findings-en.png', 'Actual Desktop URL findings')],
        'extension': [(f'seo-native-{a.native}-sidepanel-en.png', 'Actual native Chrome Side Panel'), (f'seo-native-{a.native}-seo-workspace-en.png', 'Fixed authorized website workspace opened by the Side Panel')],
    }
    context = {
        'platform': ('本仓库提供云端 API、持久任务、预算与来源治理。客户通过 Web 或 Desktop 确认网站范围；后台抓取与 Codex 解释分别执行，并复用现有企业身份和计费约束。', 'This repository provides cloud APIs, durable tasks, budgets and source governance. Customers confirm scope in Web or Desktop. Collection and Codex interpretation execute separately under existing enterprise identity and billing rules.'),
        'web': ('本仓库是用户的云端工作台。登录并选择企业/项目后，从「行销分析」进入「网站诊断与复查」，确认范围，再查看证据、报告和复查记录。', 'This repository is the customer cloud workspace. Sign in, choose a workspace/project, then open Marketing insights → Website audits & rechecks to confirm scope and inspect evidence, reports and recheck history.'),
        'admin': ('本仓库是运营管理后台。网站来源通过「内容与资源」目录按企业/项目审阅；账户、用量、费用及 VIP 管理继续使用各自的权限和审批。下述网站抓取流程由客户工作台发起，管理员通过独立的元数据、正文和内容操作权限管理其来源。', 'This repository is the operator dashboard. Review website sources in the tenant/project-scoped content directory. Accounts, usage, fees and VIP retain their own permissions and approvals. Customers initiate the audit workflow below; operators govern its sources through separate metadata, body and content-operation permissions.'),
        'desktop': ('本仓库是 Windows Desktop 客户端，使用隔离主进程、受限认证桥和同步的独立 renderer。当前包的自绘窗口和原生保存流程均已实际执行；启动路径见下方当前预览，之后保留的旧包路径属于历史记录。', 'This repository is the Windows Desktop client with an isolated main process, restricted authenticated bridge and self-contained renderer snapshot. Its custom window and native saves were actually exercised. Use the current preview below; later old package paths retain their historical scope.'),
        'extension': ('本仓库是 Chrome MV3 原生侧栏扩展。点击工具栏图标即可打开/收起侧栏；从侧栏选择已登录的企业和项目，或主动进入固定的公司工作台。文件与 Native Messaging 继续遵守显式授权和既有范围控制。', 'This repository is the Chrome MV3 native Side Panel extension. Its toolbar icon opens/closes the panel. Choose the signed-in workspace/project or explicitly open the fixed company workspace. Files and Native Messaging retain explicit grants and existing scope controls.'),
        'delivery': ('本仓库保存跨端运行脚本、原始回执和来源前像。脚本使用原生工具及独立测试夹具，结束后关闭自建应用、浏览器和服务。每次验证使用新编号；失败记录与以前的源码和包继续保留。', 'This repository retains cross-client launchers, raw receipts and source preimages. Native tools and isolated fixtures close their owned apps, browsers and services. Each execution uses a fresh attempt ID; failures and previous source/package evidence remain preserved.'),
    }
    for repo in ('platform', 'delivery'):
        folder = DEV/('copypaste-'+repo)/'assets/screenshots'; folder.mkdir(parents=True, exist_ok=True)
        image = gallery['web'][0][0]
        shutil.copyfile(DEV/'copypaste-web/assets/screenshots'/image, folder/image)
        gallery[repo] = [(image, 'Actual Web consumer of the scoped website API')]
    images = ROOT/'docs/design/implementation/scoped-seo-62'; images.mkdir(parents=True, exist_ok=True)
    for repo, entries in gallery.items():
        for image, _ in entries:
            source = DEV/('copypaste-'+repo)/'assets/screenshots'/image
            shutil.copyfile(source, images/image)
            assert digest(source) == digest(images/image)
    for repo, commit in BASES.items():
        directory = DEV/('copypaste-'+repo)
        for filename, content in (('README.md', zh), ('README.en.md', en)):
            original = git(directory, 'show', commit+':'+filename).decode().replace('\r\n', '\n')
            title, body = original.split('\n\n', 1)
            extras = '\n\n'+diagram
            if repo == 'delivery':
                extras += f'\n\n[Full regression](evidence/scoped-seo-regression-{a.full}.json) · [Actual Web/Admin](evidence/scoped-seo-ui-{a.ui}.json) · [Actual native clients](evidence/scoped-seo-native-{a.native}.json) · [Current artifacts](evidence/scoped-seo-artifacts.json)'
                extras += '\n\n```powershell\nnode scripts/run-scoped-seo-ui.mjs <new-attempt>\nnode scripts/run-scoped-seo-native.mjs <new-attempt>\nnode scripts/run-scoped-seo-checks.mjs <new-attempt> --full\n```'
            extras += '\n\n'+'\n\n'.join(f'![{label}](assets/screenshots/{image})' for image, label in gallery[repo])
            preface = context[repo][0 if filename == 'README.md' else 1]
            (directory/filename).write_text(title+'\n\n'+preface+'\n\n'+content.strip()+extras+'\n\n'+body, encoding='utf-8', newline='\n')
    status = f'''阶段 62 新增[有范围约束的网站诊断与复查](technical/62-scoped-seo-audits.md)：实际原生模拟 HTTP、逐 URL 问题/原文、Codex 内部模拟网关报告、不可变复查和来源治理。专项 **{count}/{count}**，完整平台 **{total}/{total}**，保留原全部 674 项命名测试；实际 Web/Admin **{ui} 项**、新包原生 **{native} 项**。Desktop 无边框、无 Electron/Alt 菜单；扩展工具栏打开/收起真正 Chrome 原生 Side Panel，增加固定网站工作台入口。两库 077→079 保留 164 张原表全部行摘要及 SQL001–077，三张新表为空并强制 RLS。当前包在各端 `release/scoped-seo-62-02/`；见[当前回执](quality/scoped-seo-checkpoint.json)和[包清单](quality/scoped-seo-artifacts.json)。修改任务、GEO、正式站点/模型、安装发布及全部原 TC/NFR/G01–G10 继续保留，未宣称完整产品验收。下方较早阶段只代表当时的源码和包。'''
    for file in ('README.md', 'DELIVERY.md', '00-document-map.md'):
        prepend(ROOT/'docs'/file, status)
    index = ROOT/'docs/README.md'
    text = index.read_text(encoding='utf-8')
    row = '| 技术 | [62 网站诊断与复查](technical/62-scoped-seo-audits.md) | 确认范围、逐 URL 原文、来源治理、不可变复查与原生客户端 |\n'
    assert row not in text
    lines = text.splitlines(keepends=True)
    position = next(i for i, line in enumerate(lines) if line.startswith('| 技术 | [61 '))
    lines.insert(position, row)
    index.write_text(''.join(lines), encoding='utf-8', newline='\n')
    for file in ('quality/09-implementation-alignment-audit.md', 'technical/30-native-window-and-browser-sidepanel.md'):
        prepend(ROOT/'docs'/file, status.replace('(technical/', '(../technical/').replace('(quality/', '(../quality/'))
    prepend(ROOT/'docs/modules/05-analytics-seo-geo.md', '本阶段已实现的范围见[网站诊断与复查](../technical/62-scoped-seo-audits.md)和[实际回执](../quality/scoped-seo-checkpoint.json)。GEO 的固定提示、模型、产品、地区、语言和检索观测仍单独跟踪；普通 HTML 检查不能替代 GEO。完整修改任务与规范 TaskDTO 仍待交付。')
    prepend(ROOT/'docs/quality/02-requirements-traceability.md', '阶段 62 为 REQ-029 增加受限网站抓取、逐 URL 原文、私有来源治理及不可变复查的局部证据，并补强 Codex、权限、报告和三端入口。见[当前绑定回执](scoped-seo-checkpoint.json)；原始 102 项需求、完整 TC、NFR 和 G01–G10 保留，完整修改任务、GEO、正式网站及整体验收继续跟踪。')
    prepend(ROOT/'docs/contracts/README.md', '新增 [scoped-seo-openapi.json](scoped-seo-openapi.json)：8 个补充操作、14 个严格结构，绑定当前模型/路由源码及真实 HTTP 响应样本。原规范 openapi.json 保持原摘要；补充契约不代表完整规范 TaskDTO 与 POST /v1/tasks 已对齐。')
    print('Published current bilingual delivery instructions, native appearance rules and exact actual screenshots; all original acceptance retained.')


if __name__ == '__main__':
    main()
