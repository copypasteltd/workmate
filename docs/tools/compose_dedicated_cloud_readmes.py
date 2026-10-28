"""Replace chronological README accumulation with current bilingual runbooks.

Keep every previous README byte in central history before changing a component.
"""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import re

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
HISTORY = ROOT / 'docs/quality/history/stage121-readmes-before'
BASE = 'https://github.com/copypasteltd/workmate/blob/'
DOCS = BASE + 'docs/docs/'
COMPONENTS = ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']
BRANCH = {'platform': 'backend', **{name: name for name in COMPONENTS if name != 'platform'}}
EN_NAMES = ['Full-stack developer', 'Frontend developer', 'Backend/API engineer', 'Software QA engineer',
            'UI/UX designer', 'Designer', 'Brand visual designer', 'Ad creative designer',
            'E-commerce designer', 'Social content designer', 'Illustration/IP designer',
            'Typography/layout designer', 'Presentation designer', 'Landing-page designer',
            'Information/data designer', 'Video/motion designer', 'Marketing analyst', 'Workflow consultant']
STEPS = {
    'platform': (
        ['校验登录、成员资格与项目范围，创建私有会话并固定角色、Skill、品牌和输入版本。',
         '以同一请求身份建立任务与费用预留，再由持久队列领取；每次工具、推理和下载重新核对当前授权。',
         '固定 Codex 调用公司 Responses API；文件、分析、媒体、审批与结果由注册工具提供，不能换用另一个内核。',
         '记录真实文件、事件、来源、实际消耗与未知费用；继续修改沿用原任务关系，结果未知的外部写入进入对账。',
         '通过独立 Admin 身份处理用户、内容、人工费用与 VIP；后台权限不替代客户本机授权。'],
        ['Verify identity, current membership and project scope; create a private session and pin role, Skill, brand and input versions.',
         'Create the durable task and original-payer hold under a stable request identity; recheck authority at inference, tools and downloads.',
         'Run pinned Codex through the company Responses API with registered file, analysis, media, approval and delivery tools.',
         'Persist actual files, events, provenance, usage and unknown-cost holds. Revisions keep task lineage; uncertain external writes reconcile.',
         'Use a separate Admin identity for users, content, manual funds and VIP; it cannot grant customer OS authority.']),
    'web': (
        ['访问工作台，完成注册/登录，创建企业或接受邀请，再选择所属项目。',
         '选择默认助手或专业模板，填写 brief，明确选择文件、品牌、数据账户和预算；补充输入继续原会话。',
         '确认后提交云端 Codex 工作，查看持久状态、待答问题、实际文件和费用；审阅后下载或继续修改。',
         '需要专属电脑时进入独立资源页，先核对方案、付款方、时长、确切文件和终端/可视/Agent 范围。',
         '接受限时报价才预留资源费用；可选 Codex 工作另行确认指令和 AI 预算，入口点击本身不会购买资源。'],
        ['Visit the workspace, sign in/register, create a company or accept an invitation, then choose its project.',
         'Choose the assistant or a specialist; supply the brief, approved files, brand, accounts and budget. Missing input continues the original session.',
         'Confirm cloud Codex work; inspect durable status, questions, actual files and costs, then review/download or request a revision.',
         'For an optional dedicated computer, review its plan, payer, duration, exact files and terminal/visual/Agent permissions.',
         'Accept the expiring resource quote before reservation. Codex work has a separate instruction and AI-budget confirmation; entry alone buys nothing.']),
    'admin': (
        ['使用独立管理员账号与 MFA 登录；普通用户身份不自动获得后台权限。',
         '按用户、企业和权限范围搜索列表，核对关联项目、任务、内容与消耗；敏感正文需要单独权限。',
         '人工费用先预览精确主体、金额、资金来源和原因，再沿用同一幂等键确认；余额、实收、授信与 VIP 分开记录。',
         '开通、延期、暂停或撤销指定主体的 VIP，确认有效期及权益；不得借 VIP 静默赠额。',
         '对内容、任务、批量、能力发布及专属节点执行获准动作；敏感操作检查近期 MFA、原因、版本和必要的独立审批。'],
        ['Sign in with a separate administrator identity and MFA; a customer session grants no Admin access.',
         'Search scoped users/workspaces and inspect permitted projects, tasks, content and consumption; sensitive bodies require separate access.',
         'Preview exact subject, amount, funding source and reason before confirming the same idempotency key. Balance, cash, credit and VIP remain separate.',
         'Grant, extend, suspend or revoke subject-specific VIP with explicit expiry/entitlements; a VIP change does not silently grant money.',
         'Perform permitted content/task/batch/capability/node actions with current MFA, reason, version checks and independent approval where required.']),
    'desktop': (
        ['安装或启动无边框客户端，以浏览器 PKCE 登录后选择企业、项目和本机工作目录。',
         '选择只读、目录内读写或完整本机权限；完整权限由客户主动确认，默认取消，可随时撤销。',
         '本机 Codex 操作客户本机文件、终端和浏览器；需要固定外部程序时，由客户选择实际程序并确认。',
         '查看原线程问题、真实进程输出、文件变更、成果和费用；停止或撤权结束所属执行，不把不确定结果改写为成功。',
         '目录自动工作先保存为暂停，再独立确认自动费用；重新打开应用保留队列和限额，重新确认后继续。'],
        ['Launch/install the frameless client, complete browser PKCE and select company, project and local workspace.',
         'Choose read-only, workspace-write or full local authority. The customer explicitly confirms full permission; Cancel is the default and revocation stays available.',
         'Local Codex operates local files, terminal and browser. An external program must be selected and confirmed by the customer.',
         'Inspect original-thread questions, actual output, files, artifacts and billing. Stop/revocation ends owned work; uncertain outcomes stay uncertain.',
         'Folder rules save paused and need a separate automatic-spend confirmation. Reopening retains queue/limits and requires confirmation to resume.']),
    'extension': (
        ['点击扩展图标，在 Chrome 原生右侧 Side Panel 中登录并选择企业/项目，不需要 Desktop。',
         '使用对话与附件结构；选择文件或资料夹后先核对相对路径、字节数和勾选内容，确认前不上传。',
         '确认后分片上传至本人私有会话；失败展示具体恢复入口，回包丢失沿用原上传身份精确重试。',
         '附件全部完成或移除失败项后，客户另按发送，才建立云端 Codex 工作；私有附件不自动成为项目共享。',
         '可选专属电脑入口仅打开固定公司 Web 页面；普通发送不能伪造电脑操作员任务或代替费用确认。'],
        ['Click the extension icon to open Chrome’s native right Side Panel; sign in and choose a workspace without Desktop.',
         'Use chat and attachments. Review selected relative paths, exact sizes and checkboxes before any directory upload.',
         'Confirm chunked upload into the customer’s private session. Failures expose recovery; lost responses retry the original upload identity.',
         'Finish attachments or remove failed items, then separately press Send to create cloud Codex work. Private attachments never become shared implicitly.',
         'The optional computer entry opens only the fixed company Web page. Ordinary Send cannot forge computer-operator work or bypass cost consent.']),
    'delivery': (
        ['将六个分支分别检出为 dev 下的独立仓库，安装各自锁定依赖，保留现有配置与数据。',
         'bootstrap 校验目录并构建；demo 启动自有原生数据库、API、Worker、假模型服务及 Web/Admin。',
         '逐文件运行后端回归；各端另跑类型、构建、单元、真实本机 Codex 与实际 UI，保留源码、原始日志和失败。',
         '对所有者、端口、进程、目录和浏览器独立核对清理；录制使用真实墙上时间，说明假数据与真实执行边界。',
         '绑定六个实际 Git 提交、双语 README、媒体和全部历史证据，再通过发布器正常原子推送并核对八个分支。'],
        ['Check out six branches as independent sibling repositories under dev, install locked dependencies and preserve existing configuration/data.',
         'Bootstrap validates/builds the layout. Demo starts its owned native database, API, worker, synthetic provider and Web/Admin.',
         'Run the complete backend inventory, client types/builds/units, actual local Codex and UI checks; retain source bytes, raw logs and failures.',
         'Verify owned ports/processes/directories/browsers are cleaned. Record actual wall-clock interaction and distinguish fixture data from native execution.',
         'Bind six actual Git commits, bilingual READMEs, media and historical proofs, then atomically push normal explicit refs and verify all eight heads.']),
}
DIAGRAMS = {
    'platform': 'Identity[Identity and current membership] --> Scope[Private session and pinned versions]\n  Scope --> Hold[Idempotent task and payer hold]\n  Hold --> Worker[Durable queue and pinned Codex]\n  Worker --> Company[Company Responses and media APIs]\n  Worker --> Tools[Scoped registered tools]\n  Tools --> Result[Files, revisions and usage receipts]\n  Admin[Separate MFA Admin] --> Policy[Users, funds, VIP, content and audit]\n  Policy --> Scope',
    'web': 'Visit[Visit and sign in] --> Workspace[Company and project]\n  Workspace --> Role[Assistant or specialist]\n  Role --> Inputs[Brief, approved references and budget]\n  Inputs --> Cloud[Cloud Codex]\n  Cloud --> Review[Review, revise and download]\n  Workspace --> Quote[Optional fixed-duration computer quote]\n  Quote --> Consent[Explicit resource cost and scopes]\n  Consent --> AI[Separate Codex instruction and AI budget]',
    'admin': 'MFA[Independent Admin and MFA] --> Access[Permission, scope and field checks]\n  Access --> Users[Users and workspaces]\n  Access --> Content[Content and task controls]\n  Access --> Preview[Exact funds or VIP preview]\n  Preview --> Confirm[Idempotent reasoned confirmation]\n  Confirm --> Ledger[Separate money and entitlement records]\n  Access --> Infra[Versioned plans, nodes and reconciliation]\n  Content --> Audit[Immutable audit]\n  Ledger --> Audit\n  Infra --> Audit',
    'desktop': 'Login[Browser PKCE and local session] --> Grant[Customer local permission]\n  Grant --> Codex[Codex process on customer computer]\n  Codex --> Local[Local files, terminal and browser]\n  Codex --> Company[Company inference and media APIs]\n  Local --> Receipt[Actual files, process receipts and cost]\n  Grant --> Revoke[Customer stop or revoke]\n  Revoke --> Cleanup[End owned work and retain truthful outcome]',
    'extension': 'Icon[Extension toolbar icon] --> SidePanel[Native right Side Panel]\n  SidePanel --> Login[PKCE and private session]\n  Login --> Select[Browser file or directory picker]\n  Select --> Review[Review exact files before upload]\n  Review --> Confirm[Explicit upload confirmation]\n  Confirm --> Upload[Private chunked upload and exact retry]\n  Upload --> Send[Separate customer Send]\n  Send --> Cloud[Cloud Codex and private file tools]',
    'delivery': 'Sources[Six independent repositories] --> Build[Locked dependencies and native builds]\n  Build --> Checks[Complete tests and actual UI]\n  Checks --> Evidence[Exact source, raw receipts and recordings]\n  Evidence --> Commits[Reviewed six component commits]\n  Commits --> Manifest[Lossless sharded proof manifest]\n  Manifest --> Audit[Committed-byte and credential audit]\n  Audit --> Push[Atomic normal push of eight refs]\n  Push --> Verify[Verify remote SHAs]',
}


def main():
    assert not HISTORY.exists(), 'Keep previous README history immutable; use a new version'
    bodies, hashes = {}, {}
    for name in COMPONENTS:
        for filename in ['README.md', 'README.en.md']:
            file = DEV / ('copypaste-' + name) / filename
            body = file.read_bytes(); bodies[(name, filename)] = body
            backup = HISTORY / name / filename; backup.parent.mkdir(parents=True, exist_ok=True)
            with backup.open('xb') as stream: stream.write(body)
            hashes[backup.relative_to(ROOT).as_posix()] = sha256(body).hexdigest()
    catalog = json.loads((DEV / 'copypaste-platform-recovery-120/catalog/role-preset-catalog.json').read_text(encoding='utf-8'))
    assert len(catalog['roles']) == 18
    client = json.loads((DEV / 'copypaste-delivery/.data/dedicated-delivered-121/clients-01.json').read_text(encoding='utf-8'))
    assert client['status'] == 'passed' and client['source_unchanged']
    output = {}
    for component in COMPONENTS:
        repo = DEV / ('copypaste-' + component)
        for english in [False, True]:
            filename = 'README.en.md' if english else 'README.md'
            original = bodies[(component, filename)].decode('utf-8-sig')
            product = '## Product and boundaries' if english else '## 产品与边界'
            setup = '## Setup' if english else '## 启动与使用'
            programs = '## Customer-local programs and browser resources' if english else '## Desktop 本机程序与浏览器'
            config = '## Configuration, UI and verification' if english else '## 配置、界面和验证'
            overview = original[original.index(product):original.index(setup)].strip()
            startup = original[original.index(setup):original.index(config if component == 'desktop' else programs)].strip()
            lines = [f'# Workmate · CopyPaste Enterprise Agent · {component}', '',
                     '[简体中文](README.md) · [English](README.en.md)', '', overview, '']
            lines += ['## Repositories and execution' if english else '## 仓库与执行位置', '',
                      '| Branch | Directory | Runtime |', '| --- | --- | --- |']
            runtimes = ['Fastify / PostgreSQL / cloud Codex', 'React / Vite / cloud workspace',
                        'React / separate Admin identity', 'Electron / customer-local Codex',
                        'Chrome MV3 / native Side Panel / cloud Codex', 'Native development, QA and publication tools']
            for name, runtime in zip(COMPONENTS, runtimes, strict=True):
                lines.append(f'| [{BRANCH[name]}](https://github.com/copypasteltd/workmate/tree/{BRANCH[name]}) | `dev/copypaste-{name}` | {runtime} |')
            lines += ['', 'The component is an independent Git repository. Keep the sibling layout and use the documented native tools; Docker, WSL and VMs are prohibited.' if english else
                      '各组件为独立 Git 仓库，保留上述并列布局。项目仅使用原生工具；禁止 Docker、WSL 和虚拟机。', '',
                      '## User workflow' if english else '## 使用逻辑', '']
            lines += [f'{i}. {text}' for i, text in enumerate(STEPS[component][1 if english else 0], 1)]
            lines += ['', '```mermaid', 'flowchart TD', '  ' + DIAGRAMS[component], '```', '', startup, '']
            lines += ['## Configuration and authority' if english else '## 配置、权限与费用', '']
            lines += [('The candidate requires the complete additive SQL001–129 history. API/worker schema admission rejects missing, changed or unsupported versions; recovery identity is fenced independently. Company model aliases, verified media capabilities, exact tariffs and provider secrets live on the backend. Unconfigured capabilities remain unavailable. Current development uses explicitly authorized synthetic data.' if english else
                       '本候选要求完整 SQL001–129 增量历史。API/Worker 准入拒绝缺失、变更或不支持的版本，并独立检查恢复环境身份。公司模型别名、已验证媒体能力、精确费率及供应商密钥只在后端配置；未配置能力保持不可用。当前开发继续使用已授权假数据。'), '',
                      ('Web/Admin use `VITE_API_BASE` or their same-origin proxy; default development ports are 4317/4318. Desktop/Extension compile fixed `COPYPASTE_API_ORIGIN` and `COPYPASTE_WEB_ORIGIN` values; Desktop also pins `COPYPASTE_EXTENSION_ID`. HTTPS is required outside the allowed loopback-development case. No renderer or extension receives company provider secrets.' if english else
                       'Web/Admin 使用 `VITE_API_BASE` 或同源代理，开发端口为 4317/4318。Desktop/Extension 构建时固定 `COPYPASTE_API_ORIGIN`、`COPYPASTE_WEB_ORIGIN`，Desktop 另固定 `COPYPASTE_EXTENSION_ID`。除获准回环开发场景外使用 HTTPS；渲染器与扩展不持有公司供应商密钥。'), '',
                      ('Files remain private unless the customer explicitly shares them. Authorization is checked on new requests, worker claims, tools and downloads. Source/body revocation is not bypassed by old history. Money uses exact HKD micros; budget, balance, credits, recorded payments and VIP are distinct. Stable request identities prevent duplicate grants, tasks and reservations. Unknown usage or physical cleanup retains its reconciliation hold.' if english else
                       '文件默认私有，项目共享需要客户明确操作。新请求、Worker 领取、工具及下载重新核验权限；旧历史不能绕过撤权或正文治理。金额使用精确港币微单位；预算、余额、授信、实收与 VIP 分开记录。稳定请求身份防止重复赠额、建任务和预留；未知费用或物理清理保留待核对。'), '']
            if component == 'platform':
                lines += [('Create an administrator only through `npm run admin:create -- <email> [role]` after migrations. The one-time MFA enrollment is stored under the owned `.data/enrolment/` path; there is no shared default administrator. See `.env.example`, `contracts/` and `migrations/` for current configuration and contracts.' if english else
                           '迁移完成后使用 `npm run admin:create -- <email> [role]` 创建管理员。一次性 MFA 登记写入自有 `.data/enrolment/`，不提供共享默认管理员。当前配置与接口见 `.env.example`、`contracts/`、`migrations/`。'), '']
            if component == 'admin':
                lines += ['### Admin control matrix' if english else '### 后台控制矩阵', '',
                          '| Scope | Controls |', '| --- | --- | --- |',
                          '| Identity | Separate session, MFA, revocation, CSRF, scoped roles and explicit deny |',
                          '| Users / workspaces | Search, membership, freeze/restore and permitted task/content links |',
                          '| Funds / consumption | Exact usage, grants, credits, recorded payments, compensation, refund and reconciliation |',
                          '| VIP / entitlements | Subject, plan version, start/expiry, extension, suspension and revocation |',
                          '| Content / tasks | Separate metadata/body access, revisions, quarantine, erasure, pause/cancel and batch outcomes |',
                          '| Platform | Versioned models/skills/content releases; distinct infrastructure/read/stop/reconcile permissions |',
                          '| Sensitive changes | Reason, current MFA, compare-and-swap, idempotency, audit and independent approval when required |', '',
                          'Node credentials are shown once and cleared on close/unmount. Resource metadata access grants no customer pixels or private body access.' if english else
                          '节点凭证仅显示一次，关闭或离开页面后清除；资源元数据权限不授予客户画面或私有正文访问。', '']
            lines += ['## Preset roles and Skills' if english else '## 预设角色与 Skill', '',
                      'The catalog defines 18 professional presets plus the default assistant. Every run pins exact Skill versions and registered tools. These definitions are not a claim that twelve full professional qualifications have passed.' if english else
                      '目录定义 18 个专业预设及默认助手，每次执行固定 Skill 版本和注册工具。模板数量不等于至少十二个角色已通过完整专业资格验收。', '',
                      '| ID | Role | Required Skill bindings |', '| --- | --- | --- |']
            for row, name in zip(catalog['roles'], EN_NAMES, strict=True):
                skills = ', '.join('`' + s['skill_key'] + '@' + s['version'] + '`' for s in row['skill_bindings'] if s['required'])
                lines.append(f"| {row['catalog_id']} | {name if english else row['display_name']} | {skills} |")
            lines += ['', 'Designer combines Codex, design Skills and the company Image 2 capability. Optional R19 computer-operator work needs its own confirmed cloud lease and AI budget; native Desktop excludes it and retains customer-local execution.' if english else
                      '设计师组合为 Codex＋设计 Skill＋公司 Image 2。可选 R19 云端电脑操作员必须绑定另行确认的租约与 AI 预算；本机 Desktop 不提供该创建入口，继续由客户本机执行。', '',
                      f'[Role contract]({BASE}backend/catalog/role-preset-catalog.json) · [Skill packages]({BASE}backend/catalog/skill-packages.json)', '']
            if component in ['web', 'admin', 'platform', 'delivery']:
                lines += ['## Optional dedicated cloud computer' if english else '## 可选专属云电脑', '',
                          'Review an immutable plan/quote, payer, fixed duration, exact private files and separate terminal/visual/Agent scopes. Agent control defaults off. Explicit consent reserves resource cost; a later Codex instruction has a separate exact AI ceiling. No automatic renewal occurs. Stop/expiry/revocation fences subsequent actions; measured usage and verified cleanup settle, uncertainty reconciles.' if english else
                          '先核对不可变方案/报价、付款方、固定时长、确切私有文件及终端/可视/Agent 独立范围，Agent 默认未授权。明确同意后预留资源费，后续 Codex 指令另有精确 AI 上限。无自动续期。停止、到期或撤权阻断后续操作；实际用量和清理证据齐全才结算，未知进入核对。', '',
                          'The Linux physical-node source uses native Node22/systemd, cgroups, XFS project quotas and bounded desktop tools. No Linux host was started for the local Windows qualification. Build a fresh numbered source bundle with `node native/build-package.mjs NN` in Delivery; verify the externally pinned bundle digest before installation. The installer defaults to no service start and supports exact-UUID recovery.' if english else
                          'Linux 物理节点源码使用原生 Node22/systemd、cgroup、XFS project quota 和有界桌面工具。本地 Windows 核查未启动 Linux 主机。Delivery 中以新编号运行 `node native/build-package.mjs NN` 构建源码包；安装前核对外部固定摘要，默认不启动服务，恢复要求确切安装 UUID。', '']
            lines += ['## Actual interface and interaction' if english else '## 实际界面与交互录制', '',
                      'These are actual unretouched product screenshots and wall-clock recordings. Customer/model/media responses are explicit fixtures; native Codex, files, database and billing paths run where stated. Synthetic node pixels do not qualify an actual remote Linux desktop.' if english else
                      '下列为真实产品界面截图和按墙上时间录制的交互。客户、模型、媒体响应明确使用假数据；所注明的原生 Codex、文件、数据库和账务路径实际运行。假节点画面不代表真实 Linux 远端桌面已验收。', '']
            media = {
                'web': [('workmate-dedicated-cloud-12-session-en.png', 'workmate-12-dedicated-cloud-consent.gif')],
                'admin': [('workmate-dedicated-cloud-12-plan-editor-en.png', 'workmate-12-dedicated-cloud-plan.gif')],
                'desktop': [('workmate-dedicated-desktop-06-layout-800-en.png', 'workmate-dedicated-desktop-06-local-cloud-boundary.gif')],
                'extension': [('workmate-dedicated-extension-03-review-zh.png', 'workmate-dedicated-extension-03-folder-response.gif')],
            }
            media_component = component if component in media else ('admin' if component == 'platform' else 'extension')
            if media_component != component:
                lines += [f'Linked {media_component} product UI demonstrates this headless component’s integration; it is not a separate {component} screen.' if english else
                          f'此无界面组件引用 {media_component} 的实际产品交互，展示配套集成流程；不是独立 {component} 页面。', '']
            prefix = 'assets/screenshots/' if media_component == component else BASE + media_component + '/assets/screenshots/'
            for png, gif in media[media_component]:
                lines += [f'![Actual product UI]({prefix}{png})', '', f'![Actual interaction]({prefix}{gif})', '',
                          f'[Original MP4]({prefix}{gif[:-4]}.mp4)', '']
            lines += ['## Verification and delivery status' if english else '## 验证与交付状态', '',
                      'The integrated clients/tool inventory passed 338 checks: Web 20, Admin 9, Extension 63, Desktop 180, actual local Codex 22 and Delivery 44; corresponding types/builds passed. Native Desktop, Web/Admin and native Side Panel each have eight bounded actual UI checks, with 29 screenshots and five GIF/MP4 pairs. Complete backend success requires its final complete-inventory report; the checkpoint records actual outcomes and retains failed attempts.' if english else
                      '整合后的客户端/工具共 338 项通过：Web 20、Admin 9、Extension 63、Desktop 180、实际本机 Codex 22、Delivery 44，对应类型/构建通过。Desktop、Web/Admin、原生侧栏各有 8 项限定实际 UI 检查，共 29 张截图与 5 组 GIF/MP4。后端完整成功须有最终完整清单回执，检查点记录实际结果并保留失败。', '',
                      'Run this component’s `npm run typecheck`, `npm run build` and documented test scripts with installed native prerequisites. Delivery’s default `npm test` covers native-surface integrity; the complete Delivery unit inventory is `node --test --test-concurrency=1 tests/*.test.mjs`. `node scripts/qualify-delivered-clients-v1.mjs NN` uses a fresh two-digit attempt and the sibling layout for all integrated client inventories. Candidate-specific historical runners preserve their original directory requirements.' if english else
                      '安装原生前置依赖后执行本仓库 `npm run typecheck`、`npm run build` 及测试脚本。Delivery 默认 `npm test` 仅覆盖原生界面完整性，完整单元清单使用 `node --test --test-concurrency=1 tests/*.test.mjs`。`node scripts/qualify-delivered-clients-v1.mjs NN` 在 Delivery 使用新两位编号及并列布局检查完整客户端清单；历史候选专项执行器保留原目录要求。', '',
                      'Full product acceptance remains open: twelve professional-role qualifications, complete permissions/business/compatibility matrices, live service quality, signed installers/updates, production load/restore and customer business acceptance. Use the numbered inventory rather than test counts as a completion claim. Owned browsers/processes are closed; user resources are preserved.' if english else
                      '完整产品验收仍开放：至少十二个专业角色资格、全权限/业务/兼容矩阵、真实服务质量、签名安装更新、生产负载恢复及客户业务接受。以编号清单管理完成条件，不以测试数量推算完成率；使用后清理自建浏览器/进程，保留用户资源。', '',
                      f'[Implementation / 方案]({DOCS}technical/121-dedicated-cloud-and-client-execution.md) · [Checkpoint / 证据]({DOCS}quality/dedicated-cloud-checkpoint.json) · [Open requirements / 未完成项]({DOCS}quality/remaining-work-2026-10-29.md) · [Branch layout / 检出布局]({DOCS}governance/04-git-branches-and-publication.md)', '']
            text = '\n'.join(lines)
            assert len(text) > 2500 and '\ufffd' not in text and 'SQL103 before' not in text
            assert '```mermaid' in text and '![Actual interaction]' in text
            for target in re.findall(r'\]\(([^)]+)\)', text):
                if '://' not in target:
                    assert (repo / target).is_file(), (component, target)
            file = repo / filename; file.write_text(text, encoding='utf-8', newline='\n')
            output[file.relative_to(ROOT).as_posix()] = sha256(file.read_bytes()).hexdigest()
    record = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'composed', 'previous_readmes': hashes,
              'readmes': output, 'professional_definitions': 18, 'formal_professional_qualification': 'pending',
              'original_readme_bytes_preserved': True, 'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()}
    target = ROOT / 'docs/quality/dedicated-cloud-readmes.json'
    with target.open('x', encoding='utf-8', newline='\n') as stream: json.dump(record, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({'status': 'composed', 'bilingual_readmes': len(output), 'previous_readmes_preserved': len(hashes)}))


if __name__ == '__main__': main()
