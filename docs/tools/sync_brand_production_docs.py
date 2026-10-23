"""Publish bilingual stage-79 guidance using only the selected actual receipts."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
PROOF = ROOT / 'docs/quality/brand-production-checkpoint.json'
proof = json.loads(PROOF.read_text(encoding='utf-8'))
assert proof['status'] == 'verified_fixed_brand_production_subflow'
assert proof['platform_tests']['pass'] == 874
ARCHIVE = ROOT / 'docs/quality/history/before-stage79-docs'
MANIFEST = ROOT / 'docs/quality/brand-production-documentation-refresh.json'
assert not MANIFEST.exists(), 'Do not replace earlier documentation refresh evidence'
records = []
doc_url = 'https://github.com/copypasteltd/workmate/blob/docs/docs/'


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def save(path, text):
    relative = path.relative_to(ROOT)
    archive = ARCHIVE / relative
    before = path.read_bytes()
    assert not archive.exists(), str(archive)
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.write_bytes(before)
    path.write_text(text, encoding='utf-8', newline='\n')
    records.append({'path': relative.as_posix(), 'archive': archive.relative_to(ROOT).as_posix(),
                    'before_sha256': sha256(before).hexdigest(), 'after_sha256': digest(path)})


roles = {
    'root': ('主需求、产品架构、独立仓库及验收导航。', 'Requirements, architecture, independent repositories and acceptance navigation.'),
    'platform': ('后端提供真实不可变品牌版本、生产检查、任务绑定与来源治理。', 'The backend implements immutable brand versions, production checks, task binding and source governance.'),
    'web': ('云端工作台新增可直接操作的品牌资料编辑、历史版本选择和生产前检查。', 'The cloud workbench adds a usable brand editor, historical version selection and production preflight.'),
    'admin': ('Admin 保留完整范围鉴权；品牌元数据管理、受授权正文中的版本历史与质量汇总使用各自权限。', 'Admin retains scoped authorization: brand metadata management, version history inside explicitly granted support body access, and quality summaries have separate permissions.'),
    'desktop': ('客户本机 Codex 与无边框窗口保持；新增品牌管理表单，同时验证小窗口的隐藏滚动条和键盘访问。', 'Customer-device Codex and the frameless window remain; the new brand form is exercised with compact-window hidden scrollbar rails and keyboard access.'),
    'extension': ('独立 Chrome 原生右侧栏继续负责聊天与获准文件读取上传，由公司云端 Codex 执行；本轮重新运行侧栏旅程，未新增侧栏品牌编辑页。', 'The independent native Chrome Side Panel provides chat and authorized file reads/uploads to company cloud Codex. Its journey is rerun; this phase adds no Side Panel brand editor.'),
    'delivery': ('本仓库负责真实 UI 旅程、原生候选包、独立原生数据库与按完整测试文件清单的可恢复核查。', 'This repository runs actual UI journeys, the native candidate, isolated native databases and resumable qualification over the complete test-file inventory.'),
}


def select_media(component):
    shots = [item for item in proof['screenshots'] if item['path'].startswith('copypaste-' + component + '/')]
    preferred = {'desktop': 'layout-1440-en', 'web': 'fixed-v1-preflight',
                 'admin': 'quality', 'extension': 'conversation'}[component]
    shot = next((item for item in shots if preferred in item['path']), shots[0])
    recordings = [item for item in proof['recordings'] if item['component'] == component]
    recording = next((item for item in recordings if item['name'] == 'brand-library'), recordings[0])
    gif = next(item for item in recording['files'] if item['path'].endswith('.gif'))
    video = next(item for item in recording['files'] if item['path'].endswith('.mp4'))
    return shot, gif, video


for component in roles:
    repo = ROOT if component == 'root' else DEV / ('copypaste-' + component)
    actual_component = 'desktop' if component in ['root', 'delivery'] else 'web' if component == 'platform' else component
    selected_media = select_media(actual_component)
    targets = []
    for item in selected_media:
        source = DEV / item['path']
        assert digest(source) == item['sha256']
        if component == 'root':
            target = ROOT / 'docs/design/implementation' / (Path(item['path']).parts[0] + '__' + source.name)
            assert digest(target) == item['sha256']
        elif component in ['platform', 'delivery']:
            target = repo / 'assets/screenshots' / ('stage79-' + actual_component + '-' + source.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            assert not target.exists(), str(target)
            target.write_bytes(source.read_bytes())
        else:
            target = source
        base = ROOT / 'docs' if component == 'root' else repo
        targets.append(target.relative_to(base).as_posix())
    for english in [False, True]:
        readme = (ROOT / 'docs' if component == 'root' else repo) / ('README.en.md' if english else 'README.md')
        old = readme.read_text(encoding='utf-8')
        assert '<!-- brand-production-stage79 -->' not in old
        marker = old.index('<!-- business-quality-stage78 -->')
        heading, historical = old[:marker], old[marker:]
        label = 'Previous stage-78 delivery and installation reference; older counts retain their original scope' if english else '阶段 78 交付及完整安装参考：旧计数保留原验证范围'
        title = 'Fixed brand versions and production checks' if english else '固定品牌版本与生产检查'
        intro = roles[component][1 if english else 0]
        if english:
            body = f'''{intro}

1. Sign in, select the tenant/project, and open **Brand library** in Web or Desktop. Add identity, colors, fonts and declared usage rights, approved product facts/prices, promotion expiry, channels/locales and optional fixed Logo files. Uploaded fonts must be shared in the selected project.
2. Publish an immutable version. Further edits publish a new version; stale concurrent edits conflict. Existing specialists and tasks retain their pinned version. Explicitly adopt a newer specialist version when desired.
3. Select a historical version and check sample text or a fixed fact. Missing glyphs identify their Unicode codepoint; expired offers or font declarations block new production. Price facts supply the stored text and amount; no silent font or price substitution.
4. Brand-bound cloud design tasks must carry the matching brand/version and channel/locale. Text uses the fixed declared font configuration; explicit fact keys produce the stored statement and price. Outputs retain source dependencies and editable JSON; SVG text is outlined, PNG and the limited single-page PDF review output are actual renders. Font declarations do not prove copyright ownership.

Apply **SQL096** with `npm run db:migrate` in the configured backend before starting dependent clients. Published SQL001–095 and each original OpenAPI file retain their own bytes. The additive brand contract documents four operations; the configured service inventory has 438 operations plus one demo-credit operation only when `DEMO_MODE=true`. Legacy brand bodies remain readable under current access rules, without invented history or rights. Publish explicit schema-v2 guidance and adopt a new specialist version before fixed-font production; existing tasks stay pinned.

Desktop runs Codex on the customer's machine with explicit revocable full local permission, no native frame/menu, and no visible vertical or horizontal scrollbar rails. Wheel, keyboard and focus access remain functional, including actual 800×600, 1280×800 and 1440×980 windows. Truthful progress feedback remains. Extension runs cloud Codex through the native right Side Panel. All AI requests use the company gateway. Testing creates and closes only owned browser instances; no Docker/WSL/VM is used.

Current separate results: **874/874 platform cases** in 68 files/17 batches (all prior 861 retained, 13 new), 68 client unit cases, 30 packaged Desktop checks, four brand Web checks, four Web/Admin quality checks and eight native Side Panel checks. Retained native supervisor evidence has 17 cases and all 57 bound sources unchanged. Real database/auth/files/ledger/local Codex run with explicit model/customer/business fixtures. Original 102 REQ/102 TC remain: 82 partially verified, 20 not proven, zero fully accepted; G01–G10 and real TC-056 blind review remain unproven. Desktop brand UI evidence does not establish every local professional role's brand enforcement.
'''
        else:
            body = f'''{intro}

1. 登录并选企业/项目，在 Web 或 Desktop 打开「品牌资料」。设置名称、色彩、字体及使用声明、核准产品事实/价格、促销期限、渠道/语言和可选固定 Logo 文件。上传字体须共享至当前项目。
2. 发布不可变版本。以后编辑会产生新版；并发旧版编辑报冲突。已有专家和任务继续使用绑定版本，需要升级时显式采用新的专家版本。
3. 选历史版本检查文字或固定事实。缺字定位到 Unicode 码点，过期促销或字体声明阻止新生产；价格事实使用存储文字和金额，不静默换字体或价格。
4. 绑定品牌的云端设计任务必须携带匹配的品牌/版本和渠道/语言。文字使用固定声明字体配置，显式引用事实键时使用存储文字和价格。产物保留来源依赖和可编辑 JSON；SVG 文字转路径，PNG 和有限的单页 PDF 审阅稿是真实渲染。字体登记只记录客户声明，不证明版权。

启动依赖客户端前，在已配置后端使用 `npm run db:migrate` 应用 **SQL096**。已发布 SQL001–095 与两份原有 OpenAPI 各自的字节保留。新增品牌契约包含四项操作；配置服务共 438 项，`DEMO_MODE=true` 时另有一项演示额度操作。旧品牌在当前权限下保留可读，不补造历史版本或许可；固定字体生产前需明确发布 v2 资料并采用新的专家版本，旧任务不自动改绑。

Desktop 在客户本机运行 Codex，提供明确可撤销的完整本机权限，无原生边框/菜单；纵横滚动条外观隐藏，同时保留滚轮、键盘、焦点定位及 800×600、1280×800、1440×980 实际窗口访问。保留真实进度。Extension 是云端 Codex 的原生右侧栏。全部 AI 请求经公司网关；测试后关闭自建浏览器，禁止 Docker/WSL/虚拟机。

当前分别通过：**平台 874/874 项**（68 文件/17 批，保留此前 861 项并新增 13 项）、客户端 68 项、打包 Desktop 30 项、品牌 Web 四项、Web/Admin 品质四项及原生侧栏八项。保留原生内核 17 项的 57 份绑定源码均未变化。数据库、身份、文件、账本和本机 Codex 真实运行，模型/客户/业务数据为明确夹具。原 102 REQ/102 TC 为 82 部分验证、20 未证明、0 完整验收；G01–G10、TC-056 真实客户盲审继续未证明。Desktop 品牌表单证据不等于全部本机专业角色的品牌约束已验收。
'''
        if component == 'admin':
            body += ('\nBrand body/history access still requires a time-limited support grant; metadata or quality permissions cannot read customer body or accept a delivery on their behalf. Existing user/content/usage/fee/VIP controls retain their scoped command and approval flows.\n' if english else '\n品牌正文及历史读取仍须限时支持授权；元数据/品质权限不能读取客户正文或代客户接受成果。原有用户、内容、消耗、费用与 VIP 管理继续使用各自范围命令及审批。\n')
        elif component == 'delivery':
            body += ('\nReproduction: use fresh two-digit evidence IDs with `node scripts/run-brand-library-ui.mjs NN` and `node scripts/run-desktop-local-ui.mjs NN`. Supply the configured pinned local binary for the Desktop run. Full platform qualification uses `run-desktop-platform-resumable.mjs NN --init`, then `--next` once per planned batch, then `--finish`; its environment is `COPYPASTE_LOCAL_CODEX_TEST_BIN`. Never edit bound sources during a run. Existing scripts retain failed receipts and close only their owned database/browser resources.\n' if english else '\n复现：为 `node scripts/run-brand-library-ui.mjs NN` 和 `node scripts/run-desktop-local-ui.mjs NN` 使用新的两位证据编号；Desktop 提供配置中固定的本机内核。全平台用 `run-desktop-platform-resumable.mjs NN --init`，按计划逐批 `--next`，最后 `--finish`；内核环境变量为 `COPYPASTE_LOCAL_CODEX_TEST_BIN`。运行时不改绑定源码，保留失败记录，仅关闭各脚本拥有的数据库/浏览器。\n')
        body += ('\nDesktop33, brand Web02 and Web/Admin08 retain their actual receipts with one explicitly reviewed later difference: an unrelated extension test file now waits for document readiness and logs login failures. Their application/UI and executing journey/verifier bytes are unchanged. The selected fresh extension run and full platform23 use the updated harness. Exact before/after bytes and scope are recorded in the checkpoint.\n' if english else '\nDesktop33、品牌 Web02 和 Web/Admin08 保留实际收据；其后只有一个未被这些旅程执行的扩展测试文件补充加载等待和登录诊断，前后字节及无关范围已单独核对。它们的应用/界面和执行旅程/验证器未变；新扩展运行及平台23使用更新后的测试文件，精确边界见检查点。\n')
        caption = ('Actual ' + actual_component + ' client; explicit customer/model fixtures, real controls and API writes') if english else ('实际 ' + actual_component + ' 客户端；客户/模型为明确夹具，控件与 API 写入真实执行')
        block = f'''<!-- brand-production-stage79 -->

## {title}

{body}
```mermaid
flowchart LR
    Library[Brand library] --> Version[Immutable brand version]
    Version --> Task[Frozen specialist and cloud task]
    Task --> Check[Actual font, fact, expiry and scope checks]
    Check --> Output[Source document and rendered output]
    Output --> Review[Versioned customer review]
    Sources[Current source permissions] --> Check
    Sources --> Output
```

![{caption}]({targets[0]})

![Actual interaction / 实际交互]({targets[1]})

[MP4]({targets[2]}) · [Design / 方案]({doc_url}technical/79-versioned-brand-production.md) · [Contract / 契约]({doc_url}contracts/brand-production-openapi.json) · [Evidence / 证据]({doc_url}quality/brand-production-checkpoint.json) · [Changes / 更新]({doc_url}changes/2026-10-24-versioned-brand-production.md)

<details>
<summary>{label}</summary>

{historical}

</details>
'''
        save(readme, heading + block)

current = '**阶段 79 当前增量：** 不可变品牌版本、固定专家/云端设计任务、真实字体/价格/渠道/期限检查与来源治理；Web/打包 Desktop 品牌表单已实际执行。平台 874、客户端 68、打包 30、品牌 Web 4、Web/Admin 4、原生侧栏 8 项分别通过。SQL096 为新增迁移，SQL001–095 与原规范各自字节保留。原 102 REQ/102 TC 为 82 部分/20 未证明/0 完整验收，G01–G10 与 TC-056 仍未证明。Desktop 保留本机 Codex、无边框、真实进度及无可见纵横滚动条、可滚动和键盘访问。见 [方案与限定证据]({link})。'
active = [
    'docs/00-document-map.md', 'docs/DELIVERY.md',
    'docs/modules/03-brand-assets-and-deliverables.md',
    'docs/modules/07-web-extension-desktop.md',
    'docs/technical/01-architecture-and-stack.md', 'docs/technical/06-media-and-data-pipelines.md',
    'docs/technical/08-development-and-delivery.md', 'docs/technical/10-frontend-design-system.md',
    'docs/technical/11-admin-control-plane.md', 'docs/technical/12-implementation-and-repositories.md',
    'docs/product/01-prd.md', 'docs/product/02-user-journeys.md',
    'docs/product/03-information-architecture-and-interactions.md',
    'docs/product/05-web-agent-workbench.md', 'docs/product/06-role-templates-and-skill-presets.md',
    'docs/product/07-brand-design-system.md', 'docs/product/08-admin-dashboard.md',
    'docs/requirements/03-client-execution-amendment.md', 'docs/requirements/04-desktop-layout-and-scroll.md',
    'docs/quality/02-requirements-traceability.md', 'docs/quality/04-implementation-acceptance.md',
    'docs/quality/09-implementation-alignment-audit.md',
]
for name in active:
    path = ROOT / name
    old = path.read_text(encoding='utf-8')
    assert '**阶段 79 当前增量：**' not in old
    old = old.replace('**阶段 78 当前增量：**', '**阶段 78 历史基线：**')
    heading, rest = old.split('\n', 1)
    link = ('79-versioned-brand-production.md' if path.parent.name == 'technical'
            else 'technical/79-versioned-brand-production.md' if path.parent == ROOT / 'docs'
            else '../technical/79-versioned-brand-production.md')
    updated = heading + '\n\n' + current.format(link=link) + '\n' + rest
    if name == 'docs/00-document-map.md':
        updated += '''
## Stage79 品牌生产导航 / Brand production navigation

- [固定品牌实现 / Implementation](technical/79-versioned-brand-production.md)
- [增量接口 / Additive API](contracts/brand-production-openapi.json)
- [精确运行证据 / Source and execution proof](quality/brand-production-checkpoint.json)
- [实际界面复核 / Actual visual review](quality/brand-production-visual-review.md)
- [更新说明 / Changes](changes/2026-10-24-versioned-brand-production.md)
'''
    elif name == 'docs/DELIVERY.md':
        updated += ('\n## Stage79 当前本机候选 / Current local candidate\n\n'
                    + '实际执行候选位于此工作区 Delivery 目录相对路径 `' + proof['packaged']['executable'] + '`。该目录由打包器生成，不纳入 Git 源码；其他设备按 Desktop 双语 README 配置公司接口与固定本机 Codex 后执行 `npm run package:dir` 重建。部署客户端前先在后端应用 SQL096。\n\n'
                    + '`app.asar` SHA-256: `' + proof['packaged']['app_asar_sha256'] + '`。\n\n'
                    + 'Codex SHA-256: `' + proof['packaged']['native_binary_sha256'] + '`。\n\n'
                    + 'Actual unsigned candidate, 30 packaged checks and 68 unit cases; authenticated company services are required. This local candidate and explicit model/business fixtures do not establish signed installation or production qualification. See the [exact checkpoint](quality/brand-production-checkpoint.json) and [current changes](changes/2026-10-24-versioned-brand-production.md).\n')
    elif name == 'docs/quality/09-implementation-alignment-audit.md':
        updated += ('\n## Stage79 当前差异更新\n\nREQ-013 的固定品牌/字体/事实生产子流程已取得当前代码与页面证据，状态从未证明调整为部分验证。历史发现保留用于对照；当前 82 部分、20 未证明、0 完整验收以 [逐项进度](requirements-alignment-progress.json) 和 [新检查点](brand-production-checkpoint.json) 为准。完整设计格式、所有本机角色品牌执行、语义事实、完整历史管理及真实客户接受仍需独立证据，原 TC-013 与其他原始验收定义保持。\n')
    save(path, updated)

plan = ROOT / 'docs/quality/01-test-and-acceptance-plan.md'
old = plan.read_text(encoding='utf-8')
save(plan, old + '\n## 阶段 79 局部执行证据 / Bounded execution\n\n'
     + '原 TC 编号、步骤和完整验收条件保持。REQ-013/TC-013 已取得固定版本/字体/事实的局部链路证据，仍为 `not_completed`；874 项代码测试不替代 102 项完整产品验收。实际 Web、打包 Desktop、Admin、原生 Side Panel 及精确源码/媒体边界见 [新检查点](brand-production-checkpoint.json)。字体使用记录仅为客户声明，其他格式、全本机角色、真实客户任务及 G01–G10 另行验证。\n\n'
     + 'Original TC definitions are preserved. This bounded brand-production chain does not complete TC-013 or all product acceptance; real customers, complete formats, every local role, and production gates remain unproven.\n')

technical = ROOT / 'docs/technical/79-versioned-brand-production.md'
old = technical.read_text(encoding='utf-8').replace('REQ013', 'REQ-013').replace('TC013', 'TC-013')
save(technical, old + '''
## 当前证据 / Current evidence

[检查点](../quality/brand-production-checkpoint.json) 逐项绑定当前源码、真实运行、候选包、截图和录制。平台完整 874/874 项，保留此前 861 项，新增 13 项；68 文件/17 批逐批原生独立数据库，均退出并回收测试资料。另有客户端 68 项、打包 Desktop 30 项、品牌 Web 4 项、Web/Admin 4 项和侧栏 8 项，不相加。原生 supervisor 保留 17 项、57 文件逐份未变的原证据。

增量 SQL096 之前的 95 份 SQL 逐字节对照 Stage78 执行21 保留。原权威 OpenAPI 与原运行目录 OpenAPI 各自原样保留，不能称二者相等。新 [品牌契约](../contracts/brand-production-openapi.json) 与运行副本相同；测试对真实注册路由与实例响应校验。配置服务 438 项，另有仅演示模式的一项额度接口。

| Operation | Behavior |
| --- | --- |
| `POST /v1/tenants/{tenant}/projects/{project}/brand/definitions` | Publish a schema-v2 brand with fixed source files and rights declarations |
| `PUT /v1/tenants/{tenant}/projects/{project}/brand/{id}` | Compare-and-swap publication using `expected_version` and idempotency key |
| `GET /v1/tenants/{tenant}/projects/{project}/brand/{id}/versions` | Scoped immutable history, latest 100; complete pagination remains outstanding |
| `POST /v1/tenants/{tenant}/projects/{project}/brand/{id}/versions/{version}/check` | Read-only actual glyph, fixed fact, expiry and usage checks |

具体路由参数名称、认证与响应以契约为准。后端应用 `npm run db:migrate` 后再启动新界面。旧品牌资料和原 POST 保持兼容；旧版未登记生产约束时显式标识 `legacy_unverified`，不能默认为新版合格。管理员正文仍需限时支持授权。

English: Immutable versions freeze identity, Logo/font file versions, declared rights, facts, amounts, expiry, channels and locales. Fixed specialists/cloud design tasks read their original brand version; editing a brand never silently changes an existing task. Actual standalone TTF/OTF cmap4/12 checks and real rendered outputs are bounded evidence, not universal font shaping or copyright verification. Current source permissions still fence later reads, outputs and publication. Desktop has the actual brand form and compact-window checks; enforcing the brand chain across every local professional role is not established here. All original acceptance definitions remain and no gate is closed.
''')

change = ROOT / 'docs/changes/2026-10-24-versioned-brand-production.md'
assert not change.exists()
change.write_text('''# 固定品牌生产增量 / Versioned brand production

Stage79 修复原品牌仅可变正文、历史任务不能可靠读取旧版、字体/促销生产约束缺失的问题。新增 SQL096、真实 font cmap 检查、固定版本事实渲染、受来源治理的 Logo/字体依赖及 Web/本机 Desktop 品牌表单。并发发布、重放、跨范围拒绝、缺字/过期、删除传播和真实云端工具任务已验证。Desktop 保留无边框、无可见滚动条及真实进度，滚轮/键盘和紧凑窗口继续可用。

Current code qualification: 874 platform cases, all prior 861 preserved and 13 new; 68 client unit cases; 30 packaged Desktop checks; four brand Web, four Web/Admin and eight native Side Panel checks. Native supervisor proof retains 17 cases and 57 unchanged bound sources. Real auth/database/files/ledger/local Codex use explicit synthetic model/customer/business content. Original 102 requirements/cases remain 82 partially verified, 20 unproven, zero fully accepted; no G01–G10 gate is closed.

升级：先在配置后端应用 SQL096。SQL001–095 与原 OpenAPI 的各自字节保留，新品牌契约为增量。字体使用资料是客户声明；其他设计格式、完整历史分页、全本机角色品牌生产、语义事实识别、真实客户验收和生产资格仍需独立证据。

[方案 / Design](../technical/79-versioned-brand-production.md) · [精确源码及真实媒体 / Evidence](../quality/brand-production-checkpoint.json) · [增量契约 / Contract](../contracts/brand-production-openapi.json) · [需求进度 / Requirements](../quality/requirements-alignment-progress.json)
''', encoding='utf-8', newline='\n')

progress = ROOT / 'docs/quality/requirements-alignment-progress.json'
prior_progress = ARCHIVE / 'docs/quality/requirements-alignment-progress.json'
assert prior_progress.exists()
records.append({'path': progress.relative_to(ROOT).as_posix(), 'archive': prior_progress.relative_to(ROOT).as_posix(),
                'before_sha256': digest(prior_progress), 'after_sha256': digest(progress)})
MANIFEST.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'stage': 79,
                               'readmes': 14, 'files': records,
                               'scope': 'Exact pre-edit bytes archived; original TC and requirement definitions retained.'},
                              ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'status': 'updated', 'readmes': 14, 'archived_files': len(records)}))
