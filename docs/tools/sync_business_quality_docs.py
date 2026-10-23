"""Publish current bilingual guidance with exact archives of earlier READMEs."""
from pathlib import Path
from hashlib import sha256
import json
import os
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
BASE = 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
CHECKPOINT = ROOT / 'docs/quality/business-quality-checkpoint.json'
proof = json.loads(CHECKPOINT.read_text(encoding='utf-8'))
assert proof['status'] == 'verified_versioned_customer_review_and_scoped_quality_subflow'
archive = ROOT / 'docs/quality/history/before-stage78-docs'
assert not archive.exists(), 'Never overwrite an earlier documentation archive'
planned = []


def update(file, after):
    before = file.read_bytes()
    after = after.encode('utf-8')
    if before != after:
        planned.append((file, before, after))


def hash_bytes(value):
    return sha256(value).hexdigest()


total = proof['platform_tests']['tests']
desktop = Path(proof['selected']['desktop']).stem.rsplit('-', 1)[1]
quality = Path(proof['selected']['web_admin']).stem.rsplit('-', 1)[1]
extension = Path(proof['selected']['extension']).stem.rsplit('-', 1)[1]
roles = {
    'docs': ('主需求、架构、独立仓库与验收导航。', 'Primary requirements, architecture, independent repositories and acceptance navigation.'),
    'platform': ('公司 API、Codex 控制、身份权限、持久业务及计量账本。', 'Company API, Codex control, identity, durable business logic and metered ledgers.'),
    'web': ('轻度用户通过浏览器使用公司云端 Codex 与交付物。', 'Browser workspace for company-cloud Codex and deliverables.'),
    'admin': ('独立 MFA 管理后台，按明确范围管理用户、费用、VIP、内容及权限。', 'Separate MFA admin dashboard for scoped user, billing, VIP, content and access administration.'),
    'desktop': ('无边框 Windows 客户端，在客户电脑运行 Codex、文件、终端和浏览器工具。', 'Frameless Windows app running Codex, files, terminal and browser tools on the customer device.'),
    'extension': ('Chrome 原生右 Side Panel 的聊天、附件与获准文件上传，Agent 运行在公司云端。', 'Chat and authorized-file uploads in Chrome’s native right Side Panel, backed by company-cloud Codex.'),
    'delivery': ('原生服务启动、完整测试、实际录制及独立分支发布工具。', 'Native service startup, complete tests, actual captures and independent-branch publication tooling.'),
}
diagram = '''```mermaid
flowchart LR
    Web[Web and native Chrome Side Panel] --> Cloud[Company cloud Codex]
    Desktop[Frameless Desktop] --> Local[Customer-device Codex and local tools]
    Cloud --> AI[Company OpenAI-compatible AI gateway]
    Local --> AI
    Cloud --> Delivery[Output and fixed artifact versions]
    Local --> Delivery
    Delivery --> Review[Customer review and human-effort records]
    Review --> Metrics[Scoped quality and service costs]
    Admin[Admin usage permission and explicit denies] --> Metrics
```
'''
for component, (zh_role, en_role) in roles.items():
    repo = ROOT / 'docs' if component == 'docs' else DEV / ('copypaste-' + component)
    for name in ['README.md', 'README.en.md']:
        file = repo / name
        old = file.read_text(encoding='utf-8')
        english = name.endswith('.en.md')
        assert '<!-- business-quality-stage78 -->' not in old
        lines = old.splitlines(keepends=True)
        header = ''.join(lines[:4])
        original = ''.join(lines[4:])
        original = re.sub(r'^\*\*(当前实现：|Current implementation:)\*\*', '**Historical stage-77 implementation:**' if english else '**阶段 77 历史实现：**', original, count=1, flags=re.M)
        role = en_role if english else zh_role
        title = 'Current delivery review and usage' if english else '当前交付审阅与使用流程'
        text = (f'{role} Reviews now retain the exact current delivery version, with accept, changes requested and discard decisions. Customers can report baseline minutes, cumulative human effort and revisions independently. Project usage and the scoped Admin quality dashboard distinguish technical success, customer acceptance, recorded reuse and company service costs.\n\n' if english else
                f'{role} 新增接受、需修改、弃用的版本化交付审阅；人工基线、累计投入和修改次数独立填报。项目用量与后台交付品质面板分别显示技术成功、客户接受、实际读取复用及公司服务成本。\n\n')
        text += ('Desktop remains customer-local Codex with explicit revocable full local access, no Electron menu/frame, no visible vertical or horizontal scrollbar rails, and real wheel/keyboard access. Content reflows, focused inputs remain visible at 800×600, and the composer and receipt stay accessible. The previous progress-bar constraint is withdrawn; truthful progress remains. Extension remains independent native right Side Panel chat/file upload to cloud Codex. Every AI request uses the company gateway.\n\n' if english else
                 'Desktop 保持客户本机 Codex、明确可撤销的完整本机权限及无边框/无 Electron 菜单。隐藏纵横滚动条外观，保留真实滚轮/键盘访问；内容重排，800×600 下聚焦输入框、聊天输入区和费用回执可见。此前进度条约束已撤销，保留真实进度。Extension 仍为独立原生右侧栏，聊天及获准文件上传至云端 Codex；所有 AI 请求走公司网关。\n\n')
        steps = ('''1. Sign in, choose a tenant/project and create a task in its correct execution location. Desktop needs an explicit folder and local permission; the Extension needs no Desktop installation.
2. Inspect the actual result and open “Review this delivery” (Desktop) or the task review form. Save acceptance, requested changes or discard with optional feedback. Task/version or delivery changes return a conflict requiring reload.
3. Optionally record cumulative human figures. Blank means unknown; zero means explicitly none. Refresh preserves the open effort form and visible input access.
4. Inspect project usage or Admin → Delivery quality within your permission scope. Incomplete costs stay incomplete; service costs exclude refund offsets, outside services and labor. No ROI or retention is inferred.
''' if english else '''1. 登录并选择企业/项目，在正确执行位置创建任务。Desktop 另选本机目录并明确授权；Extension 不要求安装 Desktop。
2. 查看真实结果，打开 Desktop「审阅本次交付」或任务评价表单，保存接受、需修改或弃用及可选意见。任务或交付换版时需重新载入后审阅。
3. 按需填写累计人工数字。空值为未知，0 为明确没有投入；保存后保留展开的表单与输入访问。
4. 在项目用量或 Admin「交付品质」查看当前有权范围；未确认费用不冒充完整成本。服务成本不含退款抵减、外部服务及人工，不推断 ROI 或续费。
''')
        setup = ('Apply additive SQL095 before publishing the dependent API/UI; published SQL001–094 and the original task OpenAPI are unchanged. Legacy acceptance without a delivery snapshot requires a new customer review. The original review endpoint remains compatible; current forms require both task version and delivery digest plus idempotency. Customer review requires project approval authority. Admin can read scoped aggregates under `admin.usage.read` but cannot accept for a customer, read feedback through aggregates or grant OS access.\n\n' if english else
                 '上线依赖接口/界面前先应用增量 SQL095；SQL001–094 与原任务 OpenAPI 保持原样。未固定交付版本的旧接受状态需客户重新审阅。保留原评价接口，当前表单强制任务版本、交付摘要及幂等键。写评价需要项目 approve 权限；Admin 的 `admin.usage.read` 仅查看授权范围汇总，不能代客户接受、从汇总读取意见正文或授予 OS 权限。\n\n')
        checks = (f'Current source qualification: {total}/{total} platform cases across 67 files/17 batches, 68 client units, 26 actual packaged-Desktop checks, four Web/Admin checks and {proof["extension_checks"]} native Side Panel checks. The retained 17-case native-supervisor proof has all 57 bound files unchanged. These scopes are separate and not additive. Actual auth, database, files, billing and local Codex run; model/business/customer inputs and native-dialog decisions are explicit fixtures. TC-056 real-task baselines/blind review, all 18 roles/29 Skills, complete OS/Codex Desktop parity and production gates remain unproven. Original 102 requirements/102 cases and 81 partial / 21 unproven / 0 fully accepted remain.\n\n' if english else
                  f'当前源码验证：平台 {total}/{total} 项（67 文件/17 批）、客户端 68 项、实际打包 Desktop 26 项、Web/Admin 四项及原生侧栏 {proof["extension_checks"]} 项分别通过，不相加。保留的 17 项原生内核证据中 57 份绑定源码均未变化。身份、数据库、文件、费用和本机 Codex 真实运行；模型/业务/客户输入与系统对话框决定明确为夹具。TC-056 真实任务基线/盲审、18 角色/29 Skill 的全专业交付、完整 OS/Codex Desktop 对齐及生产门槛继续未证明；原 102 REQ/102 TC 和 81 部分/21 未证明/0 完整验收保持。\n\n')
        checks += ('The Desktop31 and Web/Admin07 journeys retain their original bytes. Their only later bound-file difference is two migration-test expectations updated from 94 to 95, archived and checked exactly; all runtime, UI and journey sources remain unchanged. Platform21 freshly reruns the updated tests. See the checkpoint for this explicit qualification.\n\n' if english else
                   'Desktop31 与 Web/Admin07 保留原始执行记录；其后仅一份迁移测试中的两个版本期望值从 94 更新为 95，前后字节已归档并逐字核对，运行代码、界面和旅程脚本均未变化。平台21重新执行更新后的全套测试；该保留证据边界见检查点。\n\n')
        if component == 'delivery':
            setup += ('Use fresh two-digit attempts: `node scripts/run-quality-ui.mjs NN`, `node scripts/run-extension-chat.mjs NN`, and `node scripts/run-desktop-local-ui.mjs NN` with the pinned absolute `COPYPASTE_LOCAL_CODEX_BIN`. Full platform qualification uses `run-desktop-platform-resumable.mjs NN --init`, one `--next` per planned batch and `--finish`, with `COPYPASTE_LOCAL_CODEX_TEST_BIN`. Run database/visual owners sequentially and keep bound sources frozen.\n\n' if english else
                      '使用新两位编号运行 `node scripts/run-quality-ui.mjs NN`、`node scripts/run-extension-chat.mjs NN`；配置固定绝对路径 `COPYPASTE_LOCAL_CODEX_BIN` 后运行 `node scripts/run-desktop-local-ui.mjs NN`。完整平台回归使用 `run-desktop-platform-resumable.mjs NN --init`、逐批 `--next`、`--finish` 与 `COPYPASTE_LOCAL_CODEX_TEST_BIN`。数据库/视觉拥有者顺序运行，期间冻结覆盖源码。\n\n')
        if component == 'platform':
            setup += ('The backend independently typechecks and compiles. Full integration qualification also compares local contracts with the authoritative sibling `docs/contracts`; check out the documented complete workspace before running that suite. Native PostgreSQL only; never adopt an occupied test database or use Docker/WSL.\n\n' if english else
                      'backend 可独立类型检查和编译。完整集成验收还会比较仓库内契约与权威的同级 `docs/contracts`，执行整套测试前需按指南检出完整工作区。仅使用原生 PostgreSQL，不接管占用中的测试数据库，不使用 Docker/WSL。\n\n')
        if component == 'desktop':
            setup += ('Build independently with `npm ci`, the approved `COPYPASTE_LOCAL_CODEX_BIN`, `npm run runtime:prepare`, `npm run build` and `npm start`. Use `npm run package:dir` for the unsigned candidate. Runtime version/hash, company origins and native setup details remain in the full guide below. Signing and human installation/upgrade acceptance remain pending.\n\n' if english else
                      '独立构建入口为 `npm ci`、批准的 `COPYPASTE_LOCAL_CODEX_BIN`、`npm run runtime:prepare`、`npm run build`、`npm start`；未签名候选使用 `npm run package:dir`。固定版本/摘要、公司入口及原生配置详见下方完整指南；签名及人工安装/升级验收继续待完成。\n\n')
        target = component if component in ['web', 'admin', 'desktop', 'extension'] else 'desktop'
        stem = f'workmate-local-{desktop}-delivery-review-compact-en' if target == 'desktop' else f'workmate-chat-{extension}-delivery-review-en' if target == 'extension' else f'workmate-quality-{quality}-summary-en' if target == 'admin' else f'workmate-quality-{quality}-review-en'
        prefix = 'design/implementation/' if component == 'docs' else 'assets/screenshots/' if target == component else f'https://github.com/copypasteltd/workmate/blob/{target}/assets/screenshots/'
        recording = f'workmate-local-{desktop}-local-agent' if target == 'desktop' else f'workmate-chat-{extension}-cloud-chat' if target == 'extension' else f'workmate-quality-{quality}-delivery-quality' if target == 'admin' else f'workmate-quality-{quality}-delivery-review'
        # Use recording filenames from the actual receipt rather than guessing.
        recording_files = next(m['files'] for m in proof['recordings'] if m['component'] == target and ('native-browser' not in m.get('name', '')))
        gif = next(Path(v['path']).name for v in recording_files if v['path'].endswith('.gif'))
        mp4 = next(Path(v['path']).name for v in recording_files if v['path'].endswith('.mp4'))
        gallery = f'![Actual {target} interface]({prefix}{stem}.png)\n\n![Actual {target} interaction]({prefix}{gif})\n\n[MP4]({prefix}{mp4})\n\n'
        if target == 'desktop':
            gallery = f'![Actual frameless Desktop at 1440 by 980]({prefix}workmate-local-{desktop}-layout-1440-en.png)\n\n' + gallery
        links = f'[Design]({BASE}technical/78-business-delivery-quality.md) · [Contract]({BASE}contracts/business-quality-openapi.json) · [Exact source and media evidence]({BASE}quality/business-quality-checkpoint.json) · [Changes]({BASE}changes/2026-10-23-business-delivery-quality.md)\n\n'
        historical = 'Full setup, architecture and historical verification records (earlier counts/captures retain their original scope)' if english else '完整安装、架构与历史验证记录（较早计数和截图保留原时点范围）'
        after = header + '<!-- business-quality-stage78 -->\n\n## ' + title + '\n\n' + text + steps + '\n' + setup + diagram + '\n' + checks + gallery + links + '<details>\n<summary>' + historical + '</summary>\n\n' + original + '\n</details>\n'
        update(file, after)

for name in ['00-document-map.md', 'DELIVERY.md', 'technical/01-architecture-and-stack.md', 'technical/08-development-and-delivery.md', 'technical/12-implementation-and-repositories.md', 'requirements/03-client-execution-amendment.md', 'requirements/04-desktop-layout-and-scroll.md', 'product/03-information-architecture-and-interactions.md', 'modules/07-web-extension-desktop.md', 'quality/02-requirements-traceability.md', 'quality/09-implementation-alignment-audit.md']:
    file = ROOT / 'docs' / name
    text = file.read_text(encoding='utf-8')
    link = os.path.relpath(ROOT / 'docs/technical/78-business-delivery-quality.md', file.parent).replace('\\', '/')
    note = f'**阶段 78 当前增量：** 补齐固定交付版本的接受/修改/弃用、独立人工投入、实际读取复用及带范围的后台品质汇总，修正控制端来源检查。Desktop 保留本机 Codex、无边框、真实进度和隐藏滚动条；紧凑窗口实际聚焦输入、输入区及回执可用。平台 {total}、客户端 68、打包 26、Web/Admin 4、原生侧栏 {proof["extension_checks"]} 项分别验证。新增 SQL095 和六项接口（434 总计），SQL001–094 与原规范不变。102 REQ/102 TC、81/21/0、G01–G10 及 TC-056 真实业务验收边界保留。见 [方案与当前证据]({link})。'
    text = text.replace('**阶段 77 当前增量：**', '**阶段 77 历史基线：**')
    update(file, text.split('\n', 1)[0] + '\n\n' + note + '\n' + text.split('\n', 1)[1])

file = ROOT / 'docs/quality/requirements-alignment-progress.json'
progress = json.loads(file.read_text(encoding='utf-8'))
progress['business_quality_repair'] = {'stage': 78, 'checkpoint': 'business-quality-checkpoint.json', 'status': proof['status'], 'platform_tests': total, 'client_tests': 68, 'packaged_ui_checks': 26, 'web_admin_checks': 4, 'extension_checks': proof['extension_checks'], 'TC_056_real_business_acceptance': 'not_run'}
progress['current_source_qualification'] = {'stage': 78, 'checkpoint': 'business-quality-checkpoint.json', 'note': 'Versioned customer review and scoped quality subflow, with actual native/Desktop/Web/Admin interfaces and explicit model/business fixtures. Full original acceptance remains unproven.'}
repair = {'cluster': 'versioned_customer_review_and_quality', 'verified_subflow': '固定当前文本/资产版本的接受、修改、弃用与历史；双版本前提、幂等并发、私有范围、后台显式拒绝、空值/零人工记录、失败/未知费用及实际读取复用；真实 Web/Admin、打包 Desktop 与原生 Side Panel。', 'evidence': ['business_quality_repair'], 'implementation_docs': ['technical/78-business-delivery-quality.md']}
for requirement in progress['requirements']:
    if requirement['requirement_id'] in ['REQ-012', 'REQ-022', 'REQ-056']:
        requirement['verified_repairs'].append(repair)
        requirement['acceptance_evidence'].append('business_quality_repair')
        if requirement['requirement_id'] == 'REQ-056':
            requirement['finding'] = '版本化业务评价、人工投入、服务成本与实际读取复用的独立记录及有范围汇总已验证；三类各十个真实任务、人工基线、盲审及续用证据未执行，不证明完整业务质量验收。'
            requirement['remaining_complete_acceptance_conditions'] = '按原 TC-056 完成三类各十个真实代表任务、人工基线与盲审；提供真实可用性交付、人工返工和持续使用证据。'
update(file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')

file = ROOT / 'docs/technical/78-business-delivery-quality.md'
text = file.read_text(encoding='utf-8').replace('状态：实现和最终源码验证中。', f'状态：版本化客户审阅与范围化品质子流程已通过当前源码验证。平台 {total}/{total}、客户端 68、实际打包 Desktop 26、Web/Admin 4、原生侧栏 {proof["extension_checks"]} 项分别通过，不相加；原生内核 17 项保留证据的 57 份源码均未变化。见 [源码与媒体检查点](../quality/business-quality-checkpoint.json)。')
update(file, text)

archive.mkdir()
manifest = []
for file, before, after in planned:
    saved = archive / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.txt')
    saved.write_bytes(before)
    file.write_bytes(after)
    manifest.append({'path': file.relative_to(ROOT).as_posix(), 'archive': saved.relative_to(ROOT).as_posix(), 'before_sha256': hash_bytes(before), 'after_sha256': hash_bytes(after)})
(archive / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
selected = [s for s in proof['screenshots'] if any(token in s['path'] for token in ['delivery-review', f'workmate-local-{desktop}-layout-', f'workmate-quality-{quality}-', f'workmate-chat-{extension}-delivery-review'])]
for item in selected + [f for m in proof['recordings'] for f in m['files']]:
    source = DEV / item['path']
    component = item['path'].split('/')[0].removeprefix('copypaste-')
    filename = (component + '-' if component in ['web', 'admin'] else '') + source.name
    target = ROOT / 'docs/design/implementation' / filename
    assert not target.exists() and hash_bytes(source.read_bytes()) == item['sha256']
    shutil.copyfile(source, target)
    proof['documentation_media'].append({'source': source.relative_to(ROOT).as_posix(), 'path': target.relative_to(ROOT).as_posix(), 'sha256': item['sha256']})
CHECKPOINT.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
changes = ROOT / 'docs/changes/2026-10-23-business-delivery-quality.md'
assert not changes.exists()
changes.write_text(f'''# 版本化客户交付审阅与品质汇总 / Versioned delivery review and quality

实现固定输出及资产版本的接受、需修改与弃用，保留追加历史；任务版本与交付摘要同时检查，幂等重试不重复写记录或费用。人工基线、累计投入与修改次数独立填报，空值与零不同；复用只统计其他任务实际读取的固定版本。后台以 MFA 与原 `admin.usage.read` 范围读取汇总，显式拒绝仍优先，不能代客户接受或从汇总读取意见正文。修正后台缺少客户上下文时错误排除有效来源的逻辑。

Web、实际打包 Desktop、Chrome 原生右 Side Panel 及 Admin 接通对应流程。Desktop 保留客户本机 Codex、明确完整授权、无边框和真实进度；隐藏滚动条，重排长内容，修复保存后表单收起，并验证 800×600 下输入框真正可见/聚焦、输入区及回执留在窗口内。角色、权限与预算控件统一品牌样式。Extension 始终独立使用云端 Codex和获准文件上传。

先安装 SQL095 再发布依赖 API/UI，SQL001–094 原字节及原任务 OpenAPI 不变。实际 HTTP 方法/路径由 428 增至 434，新增六项质量操作。旧单值接受状态没有交付快照，升级后需要客户重新审阅。均摊服务成本只在费用完整确认且有接受交付时显示；不含退款抵减、外部服务与人工费用，不推断 ROI。

当前范围：{total}/{total} 平台测试、68 客户端单元、26 打包旅程、4 Web/Admin 及 {proof['extension_checks']} 原生侧栏检查，分别计数；保留的 17 项原生监督器证据中 57 份绑定源码不变。SQL、原规范、源码、实际媒体摘要及资源清理见[检查点](../quality/business-quality-checkpoint.json)。阶段 77 的 851 项测试全部保留，新增十项。模拟的是模型、业务/客户输入和系统对话框决定；身份、数据库、本机 Codex、进程、文件及费用真实执行。

失败与未选记录保留：定向 01/02 分别为验证夹具 JSON 和私有任务范围错误；页面 01/02 为服务运行目录错误，03 发现后台来源统计问题，04 暴露最初修正中 SQL 函数对未授权内层函数的计划检查，均已修复。页面 05 的主题重载被测试初始化覆盖，06 的静态截图捕获按钮颜色过渡，不采用为最终图片。Desktop 29 为表单展开保持修复前的通过记录；30 在改尺寸后的滚轮检查超时，原验证器只等待 innerWidth 而未等待稳定命中区域；改为稳定悬停、真实命中检查及可信滚轮诊断后在最终 31 重跑通过。未把局部通过或历史媒体冒充最终全量结果。

平台20第十批两项迁移测试仍断言最新版本 094，在正确执行 SQL095 后失败。仅将该测试文件的两个期望值更新为 95，原文件及前后摘要单独保留，平台21重新验证全部测试。Desktop31、Web/Admin07 的运行代码、界面与旅程脚本不变，其绑定清单中这一项测试文件差异逐字审核，保留原实际截图/录制和原始执行记录，明确为有此测试差异的证据，不冒充在后来测试字节上重新执行。

原 102 REQ/102 TC、81 部分/21 未证明/0 完整验收及 G01–G10 保持。REQ-056 的独立记录与汇总已有局部实现证据，三类各十个真实代表任务、人工基线、盲审和续用证据仍未执行；18 角色/29 Skill 的完整专业交付、正式模型和生产验收亦未证明。

## English

Customer reviews now bind current output and artifact versions and preserve append-only accept/change/discard history. Product forms enforce both task version and delivery digest; idempotent retry adds neither duplicate facts nor charges. Reported human baseline, cumulative effort and revisions retain unknown versus zero. Reuse requires another task's observed fixed-version read. The MFA Admin dashboard returns scoped metadata under its existing usage permission and explicit denies; it cannot review on a customer's behalf. Control aggregates validate task lineage without borrowing customer session scope.

Actual Web, packaged local-Codex Desktop and native Chrome right Side Panel flows are connected. Frameless Desktop preserves explicit local permission, truthful progress, native scrolling and keyboard access with hidden rails. Compact focused inputs, composer and receipt remain visible; effort-form refresh and branded controls are corrected. Extension independently uploads authorized files to cloud Codex. Apply SQL095 before the dependent API/UI; all 94 published migrations and the original task contract are unchanged. Six additive operations bring the actual route inventory to 434. Legacy unversioned acceptance requires a current customer review. Company service costs exclude refund offsets, external services and labor; incomplete settlement never becomes a complete cost or ROI claim.

Separate current checks cover {total} platform cases, 68 client units, 26 packaged-Desktop scenarios, four Web/Admin scenarios and {proof['extension_checks']} native Side Panel scenarios; the retained 17-case native-supervisor proof has all 57 bound files unchanged. All 851 previous platform cases remain. Earlier fixture, scope, working-directory, SQL planning, theme-initialization, transition-capture and resize-hit-testing failures are retained. Final proof binds current source and actual media, with owned browsers, processes and databases closed. Models, campaign/customer input and native-dialog decisions are explicit fixtures. TC-056 real representative tasks/baselines/blind review, complete professional/OS parity and original production gates remain unproven.

Platform20 batch10 exposed two stale expected-latest-version assertions, 94 after SQL095 had correctly applied. Only those two test values changed, with exact before/after archives, and Platform21 freshly reruns all tests. Desktop31 and Web/Admin07 retain their original journeys and real media with this one reviewed non-runtime test-file difference; every runtime, UI and journey source remains unchanged. Earlier receipts are never rewritten or represented as executed on later test bytes.
''', encoding='utf-8')
print(json.dumps({'documents': len(planned), 'documentation_media': len(proof['documentation_media'])}))
