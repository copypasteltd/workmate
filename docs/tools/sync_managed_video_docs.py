"""Refresh current bilingual delivery without rewriting historical acceptance."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from sync_generated_video_docs import quickstart

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
ARCHIVE = ROOT / 'docs/quality/history/before-stage81-docs'
OUTPUT = ROOT / 'docs/quality/managed-video-documentation-refresh.json'


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    assert not OUTPUT.exists()
    checkpoint_file = ROOT / 'docs/quality/managed-video-checkpoint.json'
    proof = json.loads(checkpoint_file.read_text(encoding='utf-8'))
    assert proof['status'] == 'verified_managed_video_subflow'
    records = []

    def save(file, text):
        archive = ARCHIVE / file.relative_to(ROOT)
        assert not archive.exists()
        archive.parent.mkdir(parents=True, exist_ok=True)
        before = file.read_bytes()
        archive.write_bytes(before)
        file.write_text(text, encoding='utf-8', newline='\n')
        records.append({'path': file.relative_to(ROOT).as_posix(), 'archive': archive.relative_to(ROOT).as_posix(),
                        'before_sha256': sha256(before).hexdigest(), 'after_sha256': digest(file)})

    counts = proof['platform_tests']['tests']
    compatibility = proof['compatibility_tests']['tests']
    shot = next(item for item in proof['screenshots'] if 'video-resumed-en' in item['path'])
    recording = next(item for item in proof['recordings'] if item['name'] == 'video-cancellation-and-cost-recovery')
    media = [shot, *recording['files']]
    docs_base = 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
    for component in ['root', 'platform', 'web', 'admin', 'desktop', 'extension', 'delivery']:
        repo = ROOT if component == 'root' else DEV / ('copypaste-' + component)
        links = []
        for item in media:
            source = DEV / item['path']
            assert digest(source) == item['sha256']
            if component == 'root':
                target = ROOT / 'docs/design/implementation' / ('copypaste-admin__' + source.name)
                assert digest(target) == item['sha256']
            elif component == 'admin':
                target = source
            else:
                target = repo / 'assets/screenshots' / ('stage81-admin-' + source.name)
                assert not target.exists()
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
            links.append(target.relative_to(ROOT / 'docs' if component == 'root' else repo).as_posix())
        for english in [False, True]:
            file = (ROOT / 'docs' if component == 'root' else repo) / ('README.en.md' if english else 'README.md')
            title, old = file.read_text(encoding='utf-8').split('\n', 1)
            assert '<!-- managed-video-stage81 -->' not in old
            design = ('technical/81-managed-video-capability-releases.md' if component == 'root' else docs_base + 'technical/81-managed-video-capability-releases.md')
            evidence = ('quality/managed-video-checkpoint.json' if component == 'root' else docs_base + 'quality/managed-video-checkpoint.json')
            contract = ('contracts/capability-releases.openapi.json' if component == 'root' else docs_base + 'contracts/capability-releases.openapi.json')
            start = quickstart(component, english).replace('SQL097', 'SQL098')
            if english:
                body = f'''This repository is one independently versioned part of Workmate. Admin can now manage video models through the same immutable draft, actual verification, independent approval, publication and rollback flow as text and images. Web, local Desktop and the native Chrome Side Panel consume published versions; existing tasks keep their frozen model and rates.

{start}

1. Sign in to Admin using its separate email/TOTP identity. Open **Catalog → Model capabilities → Create configuration**, select **Video generation**, enter the company model alias, a positive HKD price per billable second and an operation reason. Codex and the company internal gateway are fixed; a draft cannot add an endpoint, secret or another kernel.
2. Open **Configuration & validation**, enter the reason and run validation. The API immediately saves a durable receipt. Its 16 cases quote up to 184 seconds from the **platform verification budget**. Closing this view does not stop execution. Progress counts actually verified cases, with actual size/duration, full MP4/H264 decoding and observed cancellation; no simulated percentage represents real service progress.
3. **Recheck original job** queries the existing operation. **Stop this validation suite** stops new calls and checks already-dispatched usage. An unknown result keeps its budget/capacity hold and blocks another validation in this view. Once expense is known, an explicitly new validation creates a new receipt and new billable calls. The live cost and the receipt at the immutable eligibility decision remain distinct.
4. After all cases pass, **Preview publication** compares the model and price. Current permission, recent MFA, exact version and reason are checked again; another administrator must approve. Requesters cannot approve themselves. Rollback appends a new publication fact. Scoped access and explicit denies retain priority; read-only administrators cannot mutate configurations.
5. A stopped worker resumes original operations and confirmed content, without another generation POST. SQL098 preserves the old budget functions' identities and all prior shared accounting. Apply SQL098 using backend `npm run db:migrate` before deployment. SQL001–097 and both original OpenAPI files retain their own bytes. Company gateway credentials remain server-side. Managed publication can provide a verified video capability while the legacy environment switch is false; a live supplier still requires its own qualification.

Desktop remains frameless, runs Codex on the customer's own device and supports explicit revocable full local permission. No visible vertical/horizontal scrollbar rails appear; wheel, keyboard, focus and truthful task/video progress remain available. Extension opens in Chrome's native right Side Panel, uses ChatGPT-style chat/attachments, reads/uploads authorized files and runs its Agent in the cloud without a Desktop dependency.

Current platform qualification: **{counts}/{counts}** cases, all previous 912 retained, 71 files/18 batches. Separate checks: **{compatibility}/{compatibility}** legacy capability/gateway/customer-video compatibility, **7** contract checks and **7** actual Admin browser checks. Captures below show the **Admin** component, including when copied into a client repository for the shared setup workflow. Historical stage-80 client sources/captures retain their original scope; they are not relabeled as a new full-stack browser run. The new Admin journey uses real authentication, PostgreSQL, native pinned Codex version checks and actual MP4 decoding with an explicit synthetic company service/video fixture.

Original **102 REQ/102 TC remain 83 partially verified, 19 unproven and zero fully accepted**; G01–G10 remain open. Live company service, all professional roles, full original video acceptance, signed installers and complete Codex Desktop operation parity are still unproven. All owned browser contexts/instances, previews and native databases close; no Docker/WSL/VM is used.
'''
            else:
                body = f'''本仓库是 Workmate 的一个独立版本组件。后台已补齐视频模型的不可变草稿、实际验证、独立审批、发布与回滚，沿用文字和图片的管理流程。Web、本机 Desktop 和原生 Chrome 侧栏使用已发布版本，已有任务保留原模型和费率快照。

{start}

1. 使用独立邮箱／TOTP 后台身份登录，进入「目录 → 模型能力 → 建立配置」，选择「影片生成」，填写公司模型别名、正数每秒港币费率和操作原因。Codex 与公司内部网关固定，草稿不能增加地址、密钥或其他内核。
2. 在「配置与验证」填写原因后执行验证，接口立即保存持久回执。全套 16 案例最多报价 184 秒，使用**平台验证预算**；关闭对话框不结束后台执行。进度只计实际验证的案例，可查看尺寸、时长、完整 MP4/H264 解码与取消后的实际观察，不用虚构百分比表示真实进度。
3. 「重新核对原作业」只查现有 operation；「停止此套验证」停止新调用，已发出作业仍须核对费用。结果未知时保留预算／容量占用，页面阻止再次验证；费用确认后，明确重新验证才会建立新回执和新的付费调用。当前费用与资格决定时的不可变回执分别显示。
4. 全部通过后「发布预览」比较模型与费率，再复核当前权限、近期 MFA、精确版本和原因，并由另一位管理员审批；申请人不能自审。回滚追加新发布事实，不重写历史。范围授权及显式拒绝保持，只有读取权限的管理员不能操作配置。
5. 服务退出后复用原作业和已确认内容，不重复生视频。SQL098 保留旧预算函数入口及全部原共享核账行为。部署前在后端执行 `npm run db:migrate` 应用 SQL098；SQL001–097 和两份原 OpenAPI 各自字节保持。公司网关凭据只留在服务器。版本化发布可在旧环境核验开关为 false 时提供已验证能力，真实供应商仍须独立验收。

Desktop 保持无边框，在客户本机运行 Codex，并支持客户主动授予、可撤销的完整本机权限。产品不出现可见纵向／横向滚动条，保留滚轮、键盘、焦点及真实任务／视频进度。Extension 使用 Chrome 原生右侧栏、ChatGPT 式对话和附件，获取／读取／上传获准文件，Agent 在云端运行，不依赖 Desktop。

当前平台 **{counts}/{counts}** 项，保留原 912 项，71 文件／18 批；另有旧能力发布／网关／客户视频兼容 **{compatibility}/{compatibility}**、契约 **7**、真实后台页面 **7** 项。下方图片和录像明确为 **Admin**，复制到客户端仓库用于共享配置使用说明；阶段 80 客户端源码和画面保留原验证范围，不冒充新全栈页面测试。本次后台使用真实身份、PostgreSQL、固定原生 Codex 版本检查及实际 MP4 解码，内部模型服务和视频内容为明确假数据。

原 **102 REQ/102 TC 保持 83 部分验证、19 未证明、0 完整验收**，G01–G10 保留。真实公司供应商、全部专业角色、完整视频业务、签名安装及完整 Codex Desktop 操作对标仍未证明。自建浏览器上下文／实例、页面服务和原生数据库均关闭，未使用 Docker／WSL／虚拟机。
'''
            body += ('\nThe first combined qualification failed because its synthetic HTTP fixture received port 2049, which this Node Fetch runtime rejects before HTTP. That failed TAP, live port witness and owned-worker/fixture cleanup remain retained. The fixture now uses the existing safe loopback listener and a bounded test-arrival wait; no product source, assertion or test name changed for this repair. The complete platform run and 17-case core run execute the repaired harness afresh. Earlier compatibility/UI recordings retain their exact product and verifier bytes, with the two later harness-only changes explicitly reviewed rather than presented as a fresh browser recording.\n' if english else
                     '\n首次组合回归因假服务被分配到本机 Node Fetch 在 HTTP 前拒绝的 2049 端口而失败，原失败 TAP、实际端口观察和自建进程／夹具清理记录全部保留。假服务已复用现有安全端口工具，测试到达信号等待加上时限；这项修复未修改产品源码、测试断言或测试名称。完整平台与 17 项专项使用修复后的夹具重新执行。此前兼容／页面录制的产品和验证器字节保持，两处后续测试夹具差异单独核对，不冒充重新录制页面。\n')
            diagram = '''
```mermaid
flowchart LR
    Draft[Immutable video model and rate] --> Grant[Permission / MFA / frozen plan]
    Grant --> Intent[Original durable operation and quote]
    Intent --> Company[Company internal service]
    Company --> Observe[Original lookup / retrieve / cancel]
    Observe --> Decode[Actual MP4 hash and full decode]
    Observe --> Cost[Confirmed expense or retained unknown]
    Decode --> Approval[Independent preview and approval]
    Approval --> Publish[Versioned publication / rollback]
    Publish --> Clients[New Web / local Desktop / cloud Side Panel tasks]
```
'''
            labels = ('Design and authority', 'Exact evidence', 'Supplemental API', 'Actual Admin screenshot', 'Admin interaction GIF', 'Actual recorded MP4', 'Historical stage-80 usage and installation reference; counts keep their original scope') if english else ('方案与权限', '精确证据', '增量接口', '实际 Admin 截图', '后台交互 GIF', '实际录制 MP4', '阶段 80 历史使用与完整安装参考；旧计数保留原范围')
            gif = next(value for value in links if value.endswith('.gif'))
            mp4 = next(value for value in links if value.endswith('.mp4'))
            block = f'''\n<!-- managed-video-stage81 -->
## {'Managed video capabilities and current delivery' if english else '后台视频能力与当前交付'}

{body}
[{labels[0]}]({design}) · [{labels[1]}]({evidence}) · [{labels[2]}]({contract})
{diagram}
![{labels[3]}]({links[0]})

[{labels[4]}]({gif}) · [{labels[5]}]({mp4})

<details>
<summary>{labels[6]}</summary>

{old.strip()}

</details>
'''
            save(file, title + '\n' + block)

    progress_file = ROOT / 'docs/quality/requirements-alignment-progress.json'
    progress = json.loads(progress_file.read_text(encoding='utf-8'))
    assert progress['summary'] == {'partial_verified': 83, 'completion_not_proven': 19}
    assert progress['fully_accepted_requirements'] == 0 and all(item['full_acceptance'] == 'not_proven' for item in progress['gates'])
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['current_source_qualification'] = {'stage': 81, 'checkpoint': 'managed-video-checkpoint.json', 'note': proof['scope']}
    progress['managed_video_repair'] = {'stage': 81, 'checkpoint': 'managed-video-checkpoint.json', 'status': proof['status'], 'platform_tests': counts,
        'compatibility_tests': compatibility, 'admin_browser_checks': 7, 'contract_checks': 7, 'original_full_acceptance': 'not_proven'}
    requirement = next(item for item in progress['requirements'] if item['requirement_id'] == 'REQ-019')
    requirement['acceptance_evidence'].append('managed_video_repair')
    requirement['verified_repairs'].append({'cluster': 'managed_company_video_capability', 'verified_subflow': proof['scope'],
        'evidence': ['managed_video_repair'], 'implementation_docs': ['technical/81-managed-video-capability-releases.md']})
    requirement['remaining_complete_acceptance_conditions'] = '后台视频能力受控发布已在明确假服务与真实媒体下局部验证。真实公司视频供应商、全部影片规格／参考素材及专业角色端到端、真实客户成果接受与完整 TC-019 仍未证明。'
    save(progress_file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')
    active = ['docs/00-document-map.md', 'docs/DELIVERY.md', 'docs/product/01-prd.md', 'docs/product/02-user-journeys.md',
        'docs/product/03-information-architecture-and-interactions.md', 'docs/product/04-release-and-commercial-model.md', 'docs/product/08-admin-dashboard.md',
        'docs/technical/01-architecture-and-stack.md', 'docs/technical/06-media-and-data-pipelines.md', 'docs/technical/08-development-and-delivery.md',
        'docs/technical/11-admin-control-plane.md', 'docs/technical/12-implementation-and-repositories.md', 'docs/technical/53-controlled-capability-releases.md',
        'docs/technical/80-generated-video-jobs.md', 'docs/quality/02-requirements-traceability.md', 'docs/quality/04-implementation-acceptance.md', 'docs/quality/09-implementation-alignment-audit.md']
    for name in active:
        file = ROOT / name
        title, rest = file.read_text(encoding='utf-8').split('\n', 1)
        rest = rest.replace('**阶段 80 当前增量：**', '**阶段 80 历史基线：**')
        link = '81-managed-video-capability-releases.md' if file.parent.name == 'technical' else 'technical/81-managed-video-capability-releases.md' if file.parent == ROOT / 'docs' else '../technical/81-managed-video-capability-releases.md'
        lead = f'**阶段 81 当前增量：** 后台视频模型不可变配置、16 案例异步验证、原作业恢复、费用核对、独立审批、发布及回滚已在明确假服务和真实 MP4 下验证。平台 {counts} 项（原 912 项保留）、兼容 {compatibility}、契约 7、真实后台页面 7 项分别通过；新增 SQL098，SQL001–097 与两份原 OpenAPI 保持。Desktop 本机 Codex、无边框、隐藏纵横滚动条并保留滚动／键盘／真实进度；原生侧栏仍是云端 Agent。102 REQ/102 TC 保持 83 部分／19 未证明／0 完整验收，G01–G10 保留。见[当前方案及证据]({link})。'
        save(file, title + '\n\n' + lead + '\n' + rest)
    contract_readme = ROOT / 'docs/contracts/README.md'
    save(contract_readme, contract_readme.read_text(encoding='utf-8') + '\n## Stage81 后台视频模型 / Managed video models\n\n[能力发布增量契约](capability-releases.openapi.json) 现在含文字／图片／视频定义、异步逐案例回执及两个原作业停止／重查命令，13 条路径／23 个严格模式；原 OpenAPI 不修改。[真实配置服务路由](implemented-routes.json) 为 447 项，加一项保留的演示条件声明；路由清单不代替完整产品设计 API。见[执行与权限](../technical/81-managed-video-capability-releases.md)。\n')
    governance = ROOT / 'docs/governance/04-git-branches-and-publication.md'
    governance_text = governance.read_text(encoding='utf-8')
    obsolete = 'python docs/tools/finalize_workmate_manifest.py --update'
    assert governance_text.count(obsolete) == 2
    governance_text = governance_text.replace(obsolete, 'python docs/tools/finalize_managed_video_manifest.py')
    governance_text += '\n## 当前版本清单 / Current publication manifest\n\n阶段 81 使用上方 `finalize_managed_video_manifest.py`：先完成当前检查点、文档核对及七仓库暂存检查，再提交六个组件，由此工具绑定已提交组件与当前证据，最后提交主文档并运行 Delivery 发布器。旧阶段工具保留用于解释各自历史回执，不能直接套用于新的源码。以后更新须使用与当次检查点匹配的清单工具，并保留其真实验证范围。\n\nFor stage 81, complete the current checkpoint, documentation audit and staged checks, commit the six components, run the manifest tool shown above, then commit documentation and invoke the Delivery publisher. Earlier tools explain their own historical receipts. Subsequent updates must bind their own current sources and qualification rather than reuse stale source assumptions.\n'
    save(governance, governance_text)
    plan = ROOT / 'docs/quality/01-test-and-acceptance-plan.md'
    save(plan, plan.read_text(encoding='utf-8') + f'\n## 阶段 81 局部证据 / Managed-video subflow evidence\n\n原编号、步骤、完整条件及 TC 状态保持。{counts} 项平台代码检查保留原 912 项；后台视频模型异步验证、原操作恢复、服务退出暂停、实际解码、独立发布／回滚及当前费用已局部验证。7 项真实后台页面和 7 项契约检查不等同于 102 项原产品验收。真实供应商、专业成果、完整 TC-019／TC-056 与全部 G01–G10 保留。见[精确检查点](managed-video-checkpoint.json)。\n')
    technical = ROOT / 'docs/technical/81-managed-video-capability-releases.md'
    old = technical.read_text(encoding='utf-8')
    assert '状态：实施中，尚未验收。' in old
    old = old.replace('状态：实施中，尚未验收。', '状态：局部实现与假服务场景已验证，完整业务及生产验收保留。', 1)
    old = old.replace('Until current-source test receipts, screenshots and publication records are linked here, this document remains an implementation plan.',
                      'Current-source receipts and actual captures are linked below for the bounded implementation; complete live-service and original acceptance remain open.')
    old += f'\n## 当前运行证据 / Current bounded execution\n\n[检查点](../quality/managed-video-checkpoint.json) 绑定当前 {counts} 项完整平台测试、{compatibility} 项既有能力／网关／客户视频兼容、7 项严格契约与 7 项真实后台操作，以及实际截图、3 段 GIF／MP4 和清理回执。所有此前 912 项平台案例保留；SQL001–097、原两份 OpenAPI 和三客户端原有受验源码字节已独立核对。首次组合回归的 2049 禁用端口失败保留，修复只涉及假服务端口选择和测试等待边界，未修改断言／名称或产品源码；当前 17/17 专项及全部 71 文件重新执行。早期兼容与页面的产品／验证器字节保持，两处后续测试夹具差异有独立[核对](../quality/managed-video-fixture-repair-review.json)，不冒充新页面录制。真实公司服务、完整业务与生产门槛未据此关闭。\n'
    save(technical, old)
    change = ROOT / 'docs/changes/2026-10-24-managed-video-capabilities.md'
    assert not change.exists()
    change.write_text(f'''# 后台视频能力发布 / Managed video capability releases

后台原能力管理只接受文字／图片，本次增加视频模型与正数秒费率的不可变草稿，16 案例的持久异步验证，以及现有独立审批、发布、回滚。每次 HTTP 前记录原 operation 和平台预算报价；失联、租约接管和服务退出均复用原作业，不重复生成。两小时冻结授权复核原会话、权限、网关、Codex 摘要及数据库时钟；只有原资源查询／取消可以继续核对已发出作业费用。

新增 SQL098 保留旧预算函数 OID，使升级前的 prepared queries 也计入视频占用。原输入计数、审核覆盖层、用户视频、并发和分钟速率语义保持。取消确认之后必须另行读取原资源；15 个生成案例须核对真实 MP4/H264 摘要、尺寸、时长并完整解码。费用未知不能视为免费；超报价留下不可变违规事实，不能发布。

Admin 显示当前费用与资格决定时的原回执、逐案例真实进度、停止和重查。未知用量期间禁用再次验证；费用确认后明确新验证会创建新付费回执。页面有英文／繁中、深浅主题和窄屏，只有读取权限的管理员无变更入口。视觉复核统一了操作选择器样式，并在费用确认后结束待核对提示。

English: Video configurations now use durable platform-funded verification with 15 real decoded media probes plus one cancellation followed by a separate resource observation. Original-operation recovery survives lost replies, processor fencing and graceful shutdown without duplicate generation. Existing tasks retain frozen model/rates. Independent preview/approval/publication/rollback continues to reject self-review and recheck current authority. Live costs can be reconciled without rewriting immutable eligibility.

验证 / Validation: {counts}/{counts} current platform cases in 71 files/18 batches, all original 912 retained; {compatibility}/{compatibility} separate compatibility checks, seven contract checks and seven actual Admin UI checks. Native PostgreSQL, auth/TOTP, pinned Codex version and actual MP4 decoding are real; service/model/video content is explicit synthetic data. Historical client captures retain their original qualification scope. Owned browsers, previews and databases close; no Docker/WSL/VM.

部署前应用 SQL098。SQL001–097 与两份原 OpenAPI 字节保持。14 份中英 README、方案、流程图、真实截图和 3 段 GIF／MP4 同步。原 102 REQ/102 TC 保持 83 部分、19 未证明、0 完整验收；真实供应商、完整专业业务、TC-019／TC-056、签名安装及 G01–G10 保留。

主文档仓库只忽略根目录 `/dev/`，保留文档历史中用于核查的同名源码归档。The documentation repository anchors its development-directory ignore rule to the root, so exact source archives nested under documentation history remain publishable.

首次完整回归的假服务分配到 2049 端口，Node Fetch 在 HTTP 前拒绝请求；该失败保持失败，实际端口／错误观察及仅自建进程和精确夹具清理记录保留。修复仅将假服务接入现有安全端口工具，并给测试信号等待增加时限，未删断言、改测试名或改产品代码。当前专项 17 项及完整 71 文件重新运行；旧兼容和页面保留自身原始执行，明确记录后续两处夹具差异，不冒充新录制。

The original combined-run failure remains failed. Its live owned-port witness proves Fetch rejected 2049 before HTTP. Only safe fixture-port selection and a bounded test wait changed; assertions, test names and product bytes remain intact. Current core and complete-platform runs re-execute the repaired harness. Earlier passing compatibility/UI receipts retain their original run scope with exact later harness differences reviewed.

[方案 / Design](../technical/81-managed-video-capability-releases.md) · [精确证据 / Evidence](../quality/managed-video-checkpoint.json) · [严格契约 / API](../contracts/capability-releases.openapi.json)
''', encoding='utf-8', newline='\n')
    OUTPUT.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'stage': 81, 'readmes': 14, 'files': records,
        'scope': 'Current bounded usage and exact pre-edit archives; all original requirements, acceptance conditions and gate definitions retained.',
        'verifier_sha256': digest(Path(__file__))}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'updated', 'readmes': 14, 'archives': len(records)}))


if __name__ == '__main__':
    main()
