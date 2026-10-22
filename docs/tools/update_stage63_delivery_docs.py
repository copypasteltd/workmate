"""Update bilingual delivery notes only after bound executions pass."""
import argparse
import re
import shutil
from pathlib import Path
from refresh_stage52_capabilities import ROOT, DEV, DELIVERY, read, digest

MARKER = 'stage63-source-governed-website-changes'


def prepend(path, body):
    text = path.read_text(encoding='utf-8')
    start, end = '<!-- ' + MARKER + ':start -->', '<!-- ' + MARKER + ':end -->'
    block = start + '\n' + body.strip() + '\n' + end
    if start in text:
        text = re.sub(re.escape(start) + r'.*?' + re.escape(end), lambda _: block, text, count=1, flags=re.S)
    else:
        title, rest = text.split('\n', 1)
        text = title + '\n\n' + block + '\n' + rest
    path.write_text(text, encoding='utf-8', newline='\n')


def copy_exact(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        assert digest(source) == digest(target)
    else:
        shutil.copyfile(source, target)
    assert digest(source) == digest(target)


def main():
    parser = argparse.ArgumentParser()
    for key in ('full','ui','native','clients','upgrade'):
        parser.add_argument('--' + key, required=True)
    a = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', getattr(a,key)) for key in ('full','ui','native','clients','upgrade'))
    runs = {name: read(DELIVERY / f'evidence/seo-change-{kind}-{getattr(a,name)}.json') for name,kind in [('full','regression'),('ui','ui'),('native','native'),('clients','clients'),('upgrade','upgrade')]}
    assert all(r['status'] == 'passed' for r in runs.values())
    total, ui, native = runs['full']['counts']['pass'], runs['ui']['counts']['checks'], runs['native']['counts']['checks']
    zh = f'''## 网站修改任务（阶段 63）

从「行销分析 → 网站诊断与复查」选择 1–20 个问题，确认冻结的原始证据、修改目标和独立 AI 预算，保存为私有任务。可暂停/继续尚未开始的任务、取消任务、查看原始证据、下载 JSON 和 HTML 修改草稿，再明确发起同范围复查。草稿需要人工审核；网站修改和 CMS 写回需要另行实施与授权。未改动的模拟页面在复查中仍显示问题持续存在。

仅使用 **Codex**，全部 AI 请求经公司内部 OpenAI 兼容网关。当前按授权使用**模拟业务与 AI 数据**；代码确实执行登录、权限、原生 HTTP 夹具、Codex 子进程、计费回执和文件保存。草稿必须完整覆盖实际读取的所选问题；伪造、未读、遗漏或重复引用不能生成交付资产。来源、缓存祖先、隔离、保留期、撤权和删除约束同时覆盖草稿与主动发布副本；Admin 的元数据、正文与内容操作权限分别执行。

**Desktop 无边框、无 Electron 默认菜单和 Alt 菜单**，使用自绘拖动区与窗口控制，文件通过当前租户的受限认证桥和原生保存窗口下载。**Extension 点击工具栏打开/收起 Chrome 原生 Side Panel**，默认右侧并遵循浏览器位置偏好；固定公司入口打开网站工作台。

验证：完整平台 **{total}/{total}**，保留前阶段全部 **716 项**命名测试；当前实际 Web/Admin **{ui} 项**、新包原生 **{native} 项**，六仓库 13 项检查通过。两库原生 SQL079→080 保留 **167 张**原表全部行摘要和 SQL001–079；新增表为空且强制 RLS。安装包位于 Desktop `release/seo-changes-63-02/`，扩展位于 Extension `release/seo-changes-63-02/CopyPaste-0.5.0-sidepanel.zip`。

已运行当前 unpacked Desktop 和真正 Chrome 侧栏。Setup/Portable 未签名，安装、商店发布、正式站点/模型及完整产品验收仍待完成。原 102 项需求、TC/NFR/G01–G10 保留；81 项有局部证据、21 项未证明完成、0 项完整验收。下方较早阶段的说明、截图与回执仅代表当时的源码和包。'''
    en = f'''## Source-governed website change tasks (stage 63)

Open Marketing insights → Website audits & rechecks. Select 1–20 findings, confirm the frozen original evidence, change objective and separate AI budget, then save a private task. Pause/resume unclaimed work, cancel, inspect original evidence and download JSON/HTML drafts. Explicitly request a same-scope recheck after separately implementing and authorizing website changes. Drafts require human review; unchanged fixture pages correctly retain persistent findings.

**Codex is the only kernel**, with every AI request sent through the company's internal OpenAI-compatible gateway. Business and AI data remain **synthetic as authorized**. Authentication, authorization, native HTTP fixtures, Codex processes, metering receipts and saved files actually run. Drafts must cover every selected, actually read finding; fabricated, unread, missing or duplicated references cannot publish artifacts. Original sources, cache ancestors, quarantine, retention, revocation and erasure govern private drafts and explicitly published copies. Admin metadata, private-body access and content actions retain separate permissions.

**Desktop remains frameless**, with custom dragging and window controls, no Electron application or Alt menu. Downloads use the current tenant's restricted authenticated bridge and native save dialog. The extension toolbar toggles **Chrome's native Side Panel**, right by default and subject to browser preferences; its fixed company link opens the website workspace.

Validation: **{total}/{total} Platform tests**, retaining all **716** prior named tests; **{ui} actual Web/Admin and {native} newly packaged native checks**, plus 13 checks across six repositories. Native SQL079→080 preserves every row digest in **167** prior public tables and SQL001–079 in both databases. The new table is empty with FORCE RLS. Desktop previews: `release/seo-changes-63-02/`; extension: `release/seo-changes-63-02/CopyPaste-0.5.0-sidepanel.zip`.

The current unpacked Desktop and real Chrome Side Panel were exercised. Setup/Portable remain unsigned; installation, store publication, live websites/models and full product acceptance remain open. All original 102 requirements and TC/NFR/G01–G10 remain: 81 partially verified, 21 not proven complete and zero fully accepted. Earlier sections, screenshots and receipts retain their historical source/package scope.'''
    diagram = '''```mermaid
flowchart LR
  Login[Current identity and project] --> Select[Select frozen original findings]
  Select --> Confirm[Confirm objective and separate AI budget]
  Confirm --> Task[Private normal task / frozen skills and capabilities]
  Task --> Facts[Codex / paginated selected facts / internal gateway]
  Facts --> Draft[Read-bound JSON / escaped HTML / human review]
  Draft --> Save[Web download / authenticated native save]
  Draft --> Review[Separate manual implementation and authorization]
  Review --> Recheck[Explicit same-scope recheck / persistent or observed repairs]
  Admin[Scoped Admin / separate metadata and body permissions] --> Source[Quarantine / retention / revocation / erasure]
  Source --> Task
  Source --> Draft
  Frame[Frameless Desktop] --> Confirm
  Panel[Toolbar / Chrome native Side Panel] --> Select
```'''
    roles = {
        'platform': ('本仓库提供受限网站诊断、私有修改任务、Codex 执行、计费与来源治理 API。新增迁移为 SQL080；既有 SQL001–079 保持原字节。', 'This repository implements scoped website audits, private change tasks, Codex execution, billing and source lifecycle APIs. SQL080 is additive; SQL001–079 retain their original bytes.'),
        'web': ('本仓库是用户云端工作台。登录并选择企业和项目后，从网站问题清单保存修改任务、审阅草稿、下载和复查。', 'This repository is the customer cloud workspace. Sign in and select a workspace/project, then save change tasks from website findings, review drafts, download and explicitly recheck.'),
        'admin': ('本仓库是管理后台。企业/项目范围、用户与费用/VIP 管理继续适用；网站来源与新增草稿使用独立元数据、正文和内容处置权限，隔离源内容后派生产物停止提供。', 'This repository is the Admin dashboard. Existing workspace/project scope, users, usage, billing and VIP controls remain applicable. Website sources and new drafts use separate metadata/body/action permissions; source quarantine fences dependent artifacts.'),
        'desktop': ('本仓库含独立 renderer 快照，构建无需相邻 Web 源码。用户在无边框客户端完成相同流程，JSON/HTML 通过认证桥与系统保存窗口写入本地。', 'This repository includes an independent renderer snapshot and builds without sibling Web sources. Users complete the flow in a frameless client; JSON/HTML downloads use its authenticated bridge and native save dialog.'),
        'extension': ('本仓库是 Chrome MV3 扩展。工具栏按钮切换原生侧栏，固定入口进入已授权公司工作台；本地文件能力继续要求明确的设备/目录权限。', 'This repository is the Chrome MV3 extension. Its toolbar toggles a native Side Panel; fixed links open the authorized company workspace. Local files continue to require explicit device/folder grants.'),
        'delivery': ('本仓库协调原生本地启动、独立测试夹具、构建、当前包验证和交付。严禁 Docker/WSL；浏览器与服务只清理本次创建的资源。', 'This repository coordinates native local startup, isolated fixtures, builds, current package verification and delivery. Docker/WSL are prohibited; cleanup closes only resources owned by this run.'),
    }
    images = {
        'platform': [f'assets/screenshots/seo-change-{a.ui}-change-draft-en.png'],
        'web': [f'assets/screenshots/seo-change-{a.ui}-change-draft-en.png',f'assets/screenshots/seo-change-{a.ui}-change-draft-zh-narrow.png'],
        'admin': [f'assets/screenshots/seo-change-{a.ui}-change-draft-body-en.png'],
        'desktop': [f'assets/screenshots/seo-change-native-{a.native}-change-draft-en.png',f'assets/screenshots/seo-change-native-{a.native}-change-draft-zh-dark.png'],
        'extension': [f'assets/screenshots/seo-change-native-{a.native}-sidepanel-en.png'],
        'delivery': ['assets/screenshots/seo-change-draft-en.png','assets/screenshots/seo-change-native-draft-en.png'],
    }
    copy_exact(DEV/'copypaste-web'/images['web'][0], DELIVERY/images['delivery'][0])
    copy_exact(DEV/'copypaste-desktop'/images['desktop'][0], DELIVERY/images['delivery'][1])
    for name, (preface_zh, preface_en) in roles.items():
        directory = DEV / ('copypaste-' + name)
        for image in images[name]:
            assert (directory / image).is_file(), str(directory / image)
        pictures = '\n\n'.join('![Actual product capture](' + image + ')' for image in images[name])
        for filename, preface, section in [('README.md',preface_zh,zh),('README.en.md',preface_en,en)]:
            prepend(directory/filename,preface+'\n\n'+section+'\n\n'+diagram+'\n\n'+pictures)
    docs_images = ROOT / 'docs/design/implementation/seo-changes-63'
    for repo, files in images.items():
        if repo == 'delivery':
            continue
        for image in files:
            copy_exact(DEV/('copypaste-'+repo)/image,docs_images/Path(image).name)
    status = f'''阶段 63 补齐 UC05「保存修改任务」子流程：选取冻结问题、确认独立预算、私有普通任务、Codex 分页事实、不可变修改草稿、原始来源治理、真实下载与明确复查。完整平台 **{total}/{total}**，保留前全部 **716 项**命名测试；实际 Web/Admin **{ui} 项**、当前新包原生 **{native} 项**。Desktop 无边框且无 Electron/Alt 菜单；工具栏切换真正 Chrome 侧栏。两库 SQL079→080 保留原 167 张公共表全部行摘要，新增一张空的强制 RLS 表。见[实现与范围](technical/63-source-governed-website-change-tasks.md)、[当前证据](quality/seo-change-checkpoint.json)和[当前包清单](quality/seo-change-artifacts.json)。原 102 项需求和完整 TC/NFR/G01–G10 保留；正式模型、站点、公网部署、CMS 写回和完整产品验收继续跟踪。'''
    prepend(ROOT/'docs/README.md',status)
    prepend(ROOT/'docs/DELIVERY.md',status)
    prepend(ROOT/'docs/modules/05-analytics-seo-geo.md','当前已补齐来源治理的「保存修改任务」子流程：选定冻结问题、独立预算、私有普通任务、Codex 草稿、下载和明确复查。见[实现细则](../technical/63-source-governed-website-change-tasks.md)及[绑定证据](../quality/seo-change-checkpoint.json)。网站/CMS 写回须另行授权；Search Console 在诊断内的连接指标、GEO 观测、正式站点与完整 TC-029 保留。下方前期范围说明是历史记录。')
    prepend(ROOT/'docs/quality/02-requirements-traceability.md','阶段 63 为 UC05/REQ-029 新增来源治理的修改任务与真实客户端证据，见[绑定回执](seo-change-checkpoint.json)。完整范围保持 102 项需求、全部 TC、NFR 与 G01–G10，81 项局部验证、21 项未证明完成、0 项完整验收。原需求文本、原验收条件与原始发现保持原值。')
    prepend(ROOT/'docs/technical/30-native-window-and-browser-sidepanel.md',f'当前阶段 63 新包完成 **{native} 项**实际原生检查，见[修改任务与来源治理](63-source-governed-website-change-tasks.md)、[当前回执](../quality/seo-change-checkpoint.json)和[包清单](../quality/seo-change-artifacts.json)。Desktop 无边框、无 Electron/Alt 菜单，自绘拖动和窗口控制保留；修改任务 JSON/HTML 使用当前租户认证桥与原生保存。扩展工具栏切换真实 Chrome 原生 Side Panel，默认右侧并遵循浏览器偏好。Setup/Portable 为未签名 localhost 预览。下方较早检查仅代表当时的源码和包。')
    implementation = ROOT/'docs/technical/63-source-governed-website-change-tasks.md'
    text = implementation.read_text(encoding='utf-8').replace('阶段 63，实施中。','阶段 63，所列本地模拟子流程已完成并绑定当前源码与包。')
    implementation.write_text(text,encoding='utf-8',newline='\n')
    prepend(implementation, f'''## 当前执行与交付

完整平台 **{total}/{total}**，前阶段全部 **716 项**命名测试保留；实际 Web/Admin **{ui} 项**、当前新包原生 **{native} 项**，六仓库 13 项检查通过。两库 SQL079→080 保留原 167 张公共表全部行摘要，新增表为空且强制 RLS。失败执行和旧源码回执保留，不作为当前包的通过证明。

见[当前绑定回执](../quality/seo-change-checkpoint.json)、[包及 SHA 清单](../quality/seo-change-artifacts.json)和[四操作补充契约](../contracts/seo-change-tasks-openapi.json)。本阶段验证采用已授权的模拟 AI/业务数据；实际运行当前 unpacked Desktop 与 Chrome 原生侧栏。Setup/Portable 安装、签名、商店及正式环境仍待完成。完整 102 项需求、TC/NFR/G01–G10 不缩减。

{diagram}

![实际 Web 修改草稿](../design/implementation/seo-changes-63/seo-change-{a.ui}-change-draft-en.png)

![实际无边框 Desktop 修改草稿](../design/implementation/seo-changes-63/seo-change-native-{a.native}-change-draft-en.png)

![实际 Chrome 原生右侧栏](../design/implementation/seo-changes-63/seo-change-native-{a.native}-sidepanel-en.png)''')
    print({'status':'passed','readmes':12,'full':total,'web_admin':ui,'native':native})


if __name__ == '__main__':
    main()
