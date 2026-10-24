"""Publish bounded bilingual usage and actual captures, retaining historical evidence."""
from datetime import datetime, timezone
from pathlib import Path
from hashlib import sha256
import json

from sync_generated_video_docs import quickstart

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
ARCHIVE = ROOT / 'docs/quality/history/before-stage82-docs'


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / 'docs/quality/creative-feedback-documentation-refresh.json'
    assert not output.exists()
    proof = json.loads((ROOT / 'docs/quality/creative-feedback-checkpoint.json').read_text(encoding='utf-8'))
    assert proof['status'] == 'verified_confirmed_creative_feedback_subflow'
    records = []

    def save(file, text):
        archive = ARCHIVE / file.relative_to(ROOT)
        assert not archive.exists()
        archive.parent.mkdir(parents=True, exist_ok=True)
        raw = file.read_bytes()
        archive.write_bytes(raw)
        file.write_text(text, encoding='utf-8', newline='\n')
        records.append({'path': file.relative_to(ROOT).as_posix(), 'archive': archive.relative_to(ROOT).as_posix(),
            'before_sha256': sha256(raw).hexdigest(), 'after_sha256': digest(file)})

    counts = proof['platform_tests']['tests']
    core = proof['core_tests']['tests']
    compatibility = proof['compatibility_tests']['tests']
    clients = proof['client_counts']
    docs_base = 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
    for component in ['root', 'platform', 'web', 'admin', 'desktop', 'extension', 'delivery']:
        repo = ROOT if component == 'root' else DEV / ('copypaste-' + component)
        native = component != 'web'
        captures = [v for v in proof['screenshots'] if v['path'].startswith('copypaste-' + ('desktop' if native else 'web') + '/')]
        shot = next(v for v in captures if v['path'].endswith('-report-en.png'))
        compact = next(v for v in captures if v['path'].endswith('-report-zh-dark-compact.png'))
        recording = next(v for v in proof['recordings'] if v['files'][0]['path'].startswith('copypaste-' + ('desktop' if native else 'web') + '/'))
        gif = next(v for v in recording['files'] if v['path'].endswith('.gif'))
        video = next(v for v in recording['files'] if v['path'].endswith('.mp4'))
        links = []
        for item in [shot, compact, gif, video]:
            source = DEV / item['path']
            assert digest(source) == item['sha256']
            if component == 'root':
                target = ROOT / 'docs/design/implementation' / (Path(item['path']).parts[0] + '__' + source.name)
                assert digest(target) == item['sha256']
            elif source.is_relative_to(repo):
                target = source
            else:
                target = repo / 'assets/screenshots' / ('stage82-desktop-' + source.name)
                assert not target.exists()
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
            links.append(target.relative_to(ROOT / 'docs' if component == 'root' else repo).as_posix())
        native_links = []
        if component in ['root', 'desktop']:
            for suffix in ['-layout-800-en.png', '-generated-progress-en.png']:
                item = next(v for v in proof['layout_screenshots'] + proof['progress_screenshots'] if v['path'].endswith(suffix))
                source = DEV / item['path']
                target = ROOT / 'docs/design/implementation' / (Path(item['path']).parts[0] + '__' + source.name) if component == 'root' else source
                assert digest(source) == digest(target) == item['sha256']
                native_links.append(target.relative_to(ROOT / 'docs' if component == 'root' else repo).as_posix())
        for english in [False, True]:
            file = (ROOT / 'docs' if component == 'root' else repo) / ('README.en.md' if english else 'README.md')
            title, old = file.read_text(encoding='utf-8').split('\n', 1)
            assert '<!-- creative-feedback-stage82 -->' not in old
            prefix = '' if component == 'root' else docs_base
            design = prefix + 'technical/82-confirmed-creative-feedback.md'
            evidence = prefix + 'quality/creative-feedback-checkpoint.json'
            contract = prefix + 'contracts/creative-feedback-openapi.json'
            start = quickstart(component, english).replace('SQL097', 'SQL099')
            if english:
                body = f'''Creative assets now have an explicit feedback loop: a user confirms the exact asset version, ad identity and date range before any advertising facts contribute. Same-name creatives in different accounts remain separate. Identity is user-attested; the current official connectors provide campaign-level facts and cannot establish creative performance automatically.

{start}

1. Sign in using the existing email flow and choose the enterprise/project. In **Marketing insights → Creative & ad feedback**, upload a shared creative first and import an ad-level Google/Meta CSV with an explicit account, currency, timezone, attribution and conversion definition. Campaign-only or incomplete sources are not selectable. Source choices show at most 100 recent eligible items; mappings and reports have explicit pagination.
2. **New candidate** pins one shared asset version, dataset, exact ad/channel/campaign, creative ID, date range and review note. A similar name or user-supplied provider metadata is a candidate basis only. Review the frozen hashes and scope, then explicitly check the initially unchecked single-creative attestation and give a reason. Incorrect identity requires withdrawal and a new candidate; confirmed history is immutable.
3. Select up to 40 confirmed mappings and create a dated feedback report. BigInt-derived decimal strings preserve exact amounts. Account/platform/currency/timezone/attribution/conversion/creative/version scopes stay separate. Identical ad-days are deduplicated; conflicting facts, competing allocations and overlapping correction snapshots reject. Missing conversions stay unknown and unobserved days are not zero. No cross-scope total or causal uplift is inferred.
4. Download the actual frozen JSON or select its shared file as an explicit input to the next Codex task. Actual model reads and downstream managed outputs retain source lineage. Withdrawal, quarantine, source expiry or lost authorization stop managed reads/downloads and queued reuse. Copies already exported outside the service remain the customer's responsibility.
5. Admin content metadata, independent `admin.content.body.read`, scoped quarantine/restore/delete and auditable actions cover mappings and feedback reports. Metadata access does not grant body access. Restoring a mapping does not silently republish an old quarantined report. Retention defaults to 90 days; the existing erasure journal orders report-file cleanup before clearing parent bodies. Admin cannot rewrite frozen identity or the original confirmation through metadata controls.

Desktop runs Codex locally with explicit, revocable full local permission. It stays frameless with no Electron menu or visible vertical/horizontal scrollbar rails. Wrapping tables/code and compact layouts preserve wheel, Home/End, focus and actual task/video progress. Native packaged windows at 800×600, 1280×800 and 1440×980 were exercised. Extension remains ChatGPT-style chat/attachments in Chrome's native right Side Panel, uploading authorized files to cloud Codex; its new feedback entry opens the full cloud workspace without depending on Desktop.

Apply **SQL099** through backend `npm run db:migrate` before deployment. Published SQL001–098 and both original OpenAPI files retain their bytes. Seven additive feedback operations have their own contract; the observed inventory is 454 configured operations plus the retained conditional demo operation. Company gateway secrets stay server-side.

Current bounded qualification: platform **{counts}/{counts}**, all previous **929** cases retained; feedback core **{core}/{core}**, separate legacy analytics/source compatibility **{compatibility}/{compatibility}**, client checks **{clients}**, actual Web journey **4** and actual packaged Desktop journey **36**. Each count has its own scope. Screenshots and GIF/MP4 below are **{'Desktop' if native else 'Web'}** captures, including copies in other component repositories. Advertising identities/facts and model content are explicit fixtures; native execution, files, identity, database, arithmetic and media capture are actual.

Original **102 REQ/102 TC remain 83 partial, 19 unproven, 0 fully accepted**; NFR and G01–G10 remain open. Live provider creative verification, professional marketing quality, signed installers and complete Codex Desktop operation parity require further evidence. Owned browsers, previews and native databases are closed; no Docker/WSL/VM is used.

All selected core, compatibility, client, Web/native UI and complete-platform receipts execute the current exact source bytes. A separate review binds the native sidebar/preferences repair, capture serialization, settled-theme report framing and Windows whole-page Ctrl+Home. Focused native-log Home/End and existing reachability conditions remain; additional end-of-page checks require navigation and preferences to remain visible. Earlier and failed attempts keep their original scopes and do not supply current-source coverage.
'''
                labels = ['Confirmed creative feedback and native layout', 'Design and permissions', 'Exact evidence', 'Additive API', 'Actual feedback', 'Compact Chinese/dark', 'Actual interaction GIF', 'Recorded MP4', 'Historical stage 81 usage and complete setup reference; original scopes retained']
            else:
                body = f'''补齐素材到广告反馈的明确流程：用户先确认具体素材版本、广告身份及日期，再纳入投放事实。同名素材在不同账户下分别计算。身份仍属用户确认；当前官方连接为活动级数据，不能自动认领为某个 creative 的效果。

{start}

1. 沿用邮箱登录并选择企业／项目，进入「行销分析 → 创意与广告反馈」。先准备共享素材，再导入有明确账户、币种、时区、归因和转化定义的 Google／Meta 广告级 CSV。活动级或口径不完整的来源不能选取。最多展示最近 100 项合资格来源；映射和报告提供分页。
2. 「建立候选」固定共享素材版本、来源、具体广告／渠道／活动、creative ID、日期及核对备注。相似名称和用户提供的平台资料只构成候选依据。检查冻结摘要及口径后，主动勾选默认未选中的单一创意声明并填写原因。更正身份须撤销后另建候选，原确认历史不可改写。
3. 选取最多 40 项已确认映射，建立指定日期的反馈。精确整数计算和十进制字符串保留金额精度；账户、平台、币种、时区、归因、转化、创意与素材版本分别呈现。相同广告日去重，冲突事实／竞争身份／重叠更正快照拒绝。缺失转化保持未知，没有观测的日期不当成零，不推断跨口径总计或因果提升。
4. 下载实际冻结 JSON，或在共享文件中明确选用报告作为下一轮 Codex 工作附件。模型实际读取及后续成果保留来源链；撤销、隔离、过期或授权失效阻止管理范围内的读取、下载和排队续作。已导出的外部副本由客户自行管理。
5. 后台内容列表、独立正文权限 `admin.content.body.read`、范围隔离／恢复／删除和审计覆盖映射及报告。元数据权限不授予正文读取。恢复映射不会静默重新公开旧隔离报告。保留期默认 90 天；删除日志先完成报告文件清理，再清除上级正文。元数据操作不能重写冻结身份或原确认。

Desktop 在客户本机运行 Codex，完整本机权限由客户主动授予并可撤销。保持无边框、无 Electron 菜单、无可见纵向／横向滚动条；表格／代码换行、紧凑布局保留滚轮、Home/End、焦点和真实任务／影片进度。实际打包窗口验证 800×600、1280×800、1440×980。Extension 继续 Chrome 原生右侧栏中的 ChatGPT 式对话／附件，获准文件上传给云端 Codex；新反馈入口打开完整云端工作台，不依赖 Desktop。

部署前在后端执行 `npm run db:migrate` 应用 **SQL099**。已发布 SQL001–098 和两份原 OpenAPI 字节保持。七项新增操作使用独立契约；实际配置服务为 454 项路由，另保留一项条件演示声明。公司网关凭据不进入渲染器或侧栏。

当前局部核对：平台 **{counts}/{counts}**，此前 **929** 项保留；反馈专项 **{core}/{core}**、既有分析／来源兼容 **{compatibility}/{compatibility}**、客户端检查 **{clients}**、真实 Web **4**、打包 Desktop **36** 项。各计数范围独立。下方画面明确为 **{'Desktop' if native else 'Web'}**，复制到其他组件仓库仍保持该来源；广告身份／事实及模型内容为明确假数据，本机执行、文件、登录、数据库、精确计算与录制是真实运行。

原 **102 REQ/102 TC 保持 83 部分验证、19 未证明、0 完整验收**；NFR 和 G01–G10 保留。真实平台身份核验、专业营销成果、签名安装和完整 Codex Desktop 操作对标仍需后续证据。自建浏览器、页面服务及原生数据库均关闭，未使用 Docker／WSL／虚拟机。

所选专项、兼容、客户端、Web／打包 Desktop 和完整平台回执均针对当前精确源码重新执行。独立核对记录长页侧栏／偏好控件定位、原生录屏串行、主题过渡完成后的报告取景和 Windows 整页 Ctrl+Home。聚焦本机会话的 Home/End 及既有可达性条件保留，并新增页面末端导航与偏好控件可见检查。早期与失败记录保留原范围，不用于冒充当前源码通过。
'''
                labels = ['已确认创意反馈与桌面布局', '设计和权限', '精确证据', '增量接口', '实际反馈', '紧凑繁中深色', '实际交互 GIF', '实际录制 MP4', '阶段 81 历史使用与完整安装参考；保留原范围']
            native_media = ''
            if native_links:
                captions = ['Actual 800×600 native conversation', 'Provider-reported progress retained'] if english else ['实际 800×600 本机会话', '保留上游报告的真实进度']
                native_media = '\n\n'.join(f'![{caption}]({target})' for caption, target in zip(captions, native_links, strict=True))
            block = f'''\n<!-- creative-feedback-stage82 -->
## {labels[0]}

{body}
[{labels[1]}]({design}) · [{labels[2]}]({evidence}) · [{labels[3]}]({contract})

```mermaid
flowchart LR
    Version[Shared exact asset version] --> Candidate[Ad identity and dated source]
    Candidate --> Review[Explicit user attestation]
    Review --> Metrics[Independent exact scopes]
    Metrics --> JSON[Frozen managed JSON]
    JSON --> Codex[Explicit next Codex task]
    Withdraw[Withdraw / quarantine / expiry] --> Fence[Recheck actual reads and outputs]
    Fence --> JSON
    Fence --> Codex
```

![{labels[4]}]({links[0]})

![{labels[5]}]({links[1]})

![{labels[6]}]({links[2]})

[{labels[7]}]({links[3]})

{native_media}

<details>
<summary>{labels[8]}</summary>

{old.strip()}

</details>
'''
            save(file, title + '\n' + block)

    progress_file = ROOT / 'docs/quality/requirements-alignment-progress.json'
    progress = json.loads(progress_file.read_text(encoding='utf-8'))
    assert progress['summary'] == {'partial_verified': 83, 'completion_not_proven': 19} and progress['fully_accepted_requirements'] == 0
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['current_source_qualification'] = {'stage': 82, 'checkpoint': 'creative-feedback-checkpoint.json', 'note': proof['scope']}
    progress['confirmed_creative_feedback_repair'] = {'checkpoint': 'creative-feedback-checkpoint.json', 'stage': 82, 'status': proof['status'], 'original_full_acceptance': 'not_proven'}
    requirement = next(v for v in progress['requirements'] if v['requirement_id'] == 'REQ-031')
    requirement['acceptance_evidence'].append('confirmed_creative_feedback_repair')
    requirement['verified_repairs'].append({'cluster': 'confirmed_ad_creative_feedback', 'verified_subflow': proof['scope'], 'evidence': ['confirmed_creative_feedback_repair'], 'implementation_docs': ['technical/82-confirmed-creative-feedback.md']})
    requirement['remaining_complete_acceptance_conditions'] = '用户明确确认的广告级身份、精确反馈及来源治理已在假数据下局部验证；真实提供方身份核实、专业营销判断、真实客户成果闭环与完整 TC-031 仍未证明。'
    save(progress_file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')
    active = ['docs/00-document-map.md', 'docs/DELIVERY.md', 'docs/product/01-prd.md', 'docs/product/02-user-journeys.md',
        'docs/product/03-information-architecture-and-interactions.md', 'docs/product/08-admin-dashboard.md',
        'docs/requirements/03-client-execution-amendment.md', 'docs/requirements/04-desktop-layout-and-scroll.md',
        'docs/technical/01-architecture-and-stack.md', 'docs/technical/06-media-and-data-pipelines.md', 'docs/technical/08-development-and-delivery.md',
        'docs/technical/11-admin-control-plane.md', 'docs/technical/12-implementation-and-repositories.md',
        'docs/quality/02-requirements-traceability.md', 'docs/quality/04-implementation-acceptance.md', 'docs/quality/09-implementation-alignment-audit.md']
    for name in active:
        file = ROOT / name
        title, rest = file.read_text(encoding='utf-8').split('\n', 1)
        rest = rest.replace('阶段 81 当前增量', '阶段 81 历史基线').replace('阶段 80 当前增量', '阶段 80 历史基线')
        if name == 'docs/requirements/04-desktop-layout-and-scroll.md':
            rest = rest.replace('见[实际截图与交互复核](../quality/generated-video-visual-review.md)和[精确版本检查点](../quality/generated-video-checkpoint.json)。', '见[当前实际截图与交互复核](../quality/creative-feedback-visual-review.md)和[当前精确版本检查点](../quality/creative-feedback-checkpoint.json)。')
            rest += '\n## 实际键盘访问 / Actual keyboard access\n\n长会话等已聚焦的局部滚动区域以 Home/End 核对首末项；Windows 外层整页返回顶部以 Ctrl+Home 核对，End 核对页面末端。两种范围各自验证真实 scrollTop，不能用自动定位、截断内容或脚本伪造按键通过。截图等待实际绘制，并直接捕获 Electron 原生窗口表面；录制与 OS 尺寸调整串行，避免 CDP 截图更改视口。\n\nFocused native conversation regions retain Home/End checks. Windows whole-page navigation independently verifies Ctrl+Home and End against actual scroll positions. Static captures wait for paint; native surface capture shares serialization with real OS resizing. Content reachability and overflow checks remain independent of scrollbar styling.\n'
        link = '82-confirmed-creative-feedback.md' if file.parent.name == 'technical' else 'technical/82-confirmed-creative-feedback.md' if file.parent == ROOT / 'docs' else '../technical/82-confirmed-creative-feedback.md'
        lead = f'**阶段 82 当前增量：** 精确素材版本与用户明确确认的广告级身份、独立口径反馈、实际 JSON 下载／模型读取继承来源、撤销和保留期清理已局部核对。平台 {counts} 项保留原 929 项，专项 {core}、兼容 {compatibility}、真实 Web 4、打包 Desktop 36 项分别通过；SQL099 新增，SQL001–098 及原 OpenAPI 保持。Desktop 本机 Codex、无边框、无可见纵横滚动条，保留实际滚动／键盘／真实进度；原生 Side Panel 为云端 Codex 和文件上传。102 REQ/102 TC 保持 83 部分／19 未证明／0 完整验收，G01–G10 保留。见[当前方案及证据]({link})。'
        save(file, title + '\n\n' + lead + '\n' + rest)
    plan = ROOT / 'docs/quality/01-test-and-acceptance-plan.md'
    save(plan, plan.read_text(encoding='utf-8') + f'\n## 阶段 82 局部证据 / Confirmed creative feedback\n\n原 102 REQ/102 TC、完整条件、NFR 与 G01–G10 不变。{counts} 项平台代码检查保留全部原 929 项；实际 Web 4、打包 Desktop 36 和精确广告级反馈专项各有独立范围。默认不从活动级数据、名称相似或相关性推导 creative 效果。真实提供方身份／专业成果／完整 TC 仍未证明。见[当前检查点](creative-feedback-checkpoint.json)。\n')
    contract = ROOT / 'docs/contracts/README.md'
    save(contract, contract.read_text(encoding='utf-8') + '\n## Stage82 已确认广告反馈 / Confirmed creative feedback\n\n[新增契约](creative-feedback-openapi.json) 描述 7 项操作，严格映射／决定／回执模式实际由 HTTP 响应进行 AJV 核对；options 和报告列表的结构描述不冒充全面严格响应验证。[实际路由](implemented-routes.json) 为 454 项配置服务，另保留一项条件演示声明。原 OpenAPI 不替换。见[流程和边界](../technical/82-confirmed-creative-feedback.md)。\n')
    design = ROOT / 'docs/technical/82-confirmed-creative-feedback.md'
    save(design, design.read_text(encoding='utf-8').replace('状态：实现与验证中。', '状态：当前代码与明确假数据的局部流程已验证；完整业务验收保留。', 1).replace('Implementation and qualification are in progress; no original acceptance gate is closed by this plan.', 'Bounded implementation and mock-data qualification are linked below; all original complete acceptance gates remain open.') + '\n当前回执、实际截图和录像见[检查点](../quality/creative-feedback-checkpoint.json)。Published SQL001–098, original OpenAPI bytes and original acceptance definitions remain intact. No campaign-only allocation, provider-verified identity or causal uplift is claimed.\n\n本次完整回归中，部分既有网站变更边界用例的整体耗时高于阶段 81；检查点保留相同用例名称、两次原始 TAP 摘要及实际毫秒值。源码版本、数据与宿主状态不同，不能据此认定具体原因，也不构成受控性能基准。功能检查通过不替代响应时间与容量 NFR 验收。Some legacy website-change cases took longer in this run. Bound raw timings are observational; performance and capacity acceptance remain unproven.\n')
    governance = ROOT / 'docs/governance/04-git-branches-and-publication.md'
    governance_text = governance.read_text(encoding='utf-8').replace('python docs/tools/finalize_managed_video_manifest.py', 'python docs/tools/finalize_creative_feedback_manifest.py')
    governance_text = governance_text.replace('阶段 81 使用上方 `finalize_managed_video_manifest.py`', '阶段 82 使用上方 `finalize_creative_feedback_manifest.py`').replace('For stage 81, complete the current checkpoint', 'For stage 82, complete the current checkpoint')
    save(governance, governance_text + '\n阶段 82 当前发布使用 `finalize_creative_feedback_manifest.py` 绑定已提交组件、当前回执、双语文档及暂存核查；旧阶段工具和回执保留自身历史范围。Stage 82 binds current receipts and committed components before non-force publication; earlier evidence is retained under its original scope.\n')
    change = ROOT / 'docs/changes/2026-10-24-confirmed-creative-feedback.md'
    assert not change.exists()
    change.write_text(f'''# 已确认广告创意反馈 / Confirmed creative feedback

素材版本与广告事实之间原本缺少可审查的身份确认。本次新增候选、明确单一 creative 声明、不可改写确认历史、撤销及独立口径反馈。精确十进制计算、重叠去重和冲突拒绝避免同名素材／跨账户／更正快照重复计数。真实官方连接仍为活动级，用户声明的 CSV 广告身份不冒充提供方核实。

报告是实际版本化 JSON 文件。模型实际读取产生的任务和后续成果保留来源；撤销／隔离／过期会阻止新读、下载、已排队续作及新发布。默认保留 90 天，现有删除日志先清理报告文件再清父正文。后台元数据、独立正文权限、项目范围、内容控制和审计覆盖新类型。

English: Frozen creative versions now link to explicitly user-confirmed ad-level facts. Exact scoped metrics, unknown values, deduplication and conflict rejection retain measurement meaning. Managed reports carry transitive actual-read lineage; revocation fences future reuse. Existing Admin scope/body controls and durable erasure govern the new content. Desktop remains native Codex, frameless, without visible scrollbar rails; actual wheel/keyboard/focus behavior and truthful progress remain available. Side Panel keeps cloud Codex and authorized uploads, with a full-workspace feedback entry.

验证 / Validation: platform {counts}/{counts}, all 929 prior cases retained; core {core}, compatibility {compatibility}, Web 4 and packaged Desktop 36 checks have distinct scopes. Actual screenshots and two GIF/MP4 pairs accompany bilingual READMEs. Synthetic ad facts/model content are labeled. Original 102 requirements/cases remain 83 partial, 19 unproven, zero fully accepted; G01–G10 remain open.

SQL099 is additive; SQL001–098 and both original OpenAPI files retain their bytes. Initial failed tests and raw media remain retained. The first Web screenshot assertion omitted the nested HKD label and was corrected to inspect the actual amount with currency. The nested source test now performs a real second model read before checking lineage, rather than treating a queued attachment as model consumption. The first new Desktop feedback fixture double-encoded a native bridge request; the real API correctly rejected it. Its 31 passing earlier checks do not turn that failed journey into a passing one. The corrected fixture uses the documented object/idempotency/tenant bridge fields and is re-executed in a fresh complete native journey.

The following native attempt reached 33 checks, then concurrent CDP recording interfered with renderer viewport restoration while the real OS window was already 1440×980. That attempt remains failed. The helper now uses Electron's native surface capture serialized with real window resizing. Attempt 41 exposed an incorrect whole-page return shortcut: the wheel and End reached the actual report bottom, but bare Home did not return the outer Windows page to its top. The helper uses Ctrl+Home with the same scrollTop criterion and retains independent focused-log Home/End. Attempt 42 passed functional checks, but visual review found that the transformed scroll root let the sidebar leave the viewport; a theme-transition frame also reduced button contrast. Native preload now counter-scrolls navigation/preferences and reserves scroll padding below them. Static captures wait for actual theme transitions and align the report. Additional end-of-page checks require navigation/preferences to remain visible. Failure geometry is collected before restoring the prior route. Fresh core, compatibility, client, Web/native and complete-platform receipts bind the current exact bytes; historical receipts are not relabeled as current qualifications.

Attempt 43 stopped at 29 checks because the older shared brand recorder still used concurrent CDP screenshots, leaving a 1440×980 renderer inside an actual 800×600 OS window. It remains failed. All native journey screenshots and the brand recording now receive the shared serialized Electron capture function; Web defaults are preserved. Existing assert statements remain byte-equivalent, and fresh full native execution supplies the current result.

部分既有网站变更边界用例在本次完整回归中耗时高于上次。检查点保留两个原始 TAP 的摘要和六个相同用例名称的实际耗时；源码、数据与宿主条件不相同，不能将观察归因为某项代码，也不能宣布性能和容量 NFR 已通过。Some legacy website-change cases ran slower; exact wall times are retained as observations, not a controlled benchmark or performance acceptance.

[方案 / Design](../technical/82-confirmed-creative-feedback.md) · [证据 / Evidence](../quality/creative-feedback-checkpoint.json) · [契约 / API](../contracts/creative-feedback-openapi.json)
''', encoding='utf-8', newline='\n')
    output.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'stage': 82, 'readmes': 14, 'files': records,
        'verifier_sha256': digest(Path(__file__)), 'scope': 'Bounded actual feedback and native layout; original acceptance definitions and assessment retained.'}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'updated', 'readmes': 14, 'archives': len(records)}))


if __name__ == '__main__':
    main()
