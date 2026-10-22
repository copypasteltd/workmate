"""Refresh current client docs and all bilingual READMEs; preserve their prior bytes."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
checkpoint = json.loads((ROOT / 'docs/quality/desktop-local-execution-checkpoint.json').read_text(encoding='utf-8'))
assert checkpoint['status'] == 'verified_native_desktop_product_subset'
attempt = checkpoint['selected']['ui']
control_tests = checkpoint['control_tests']['tests']
archive = ROOT / 'docs/quality/history/before-desktop-local-product-docs'
assert not archive.exists(), 'Preserve original document archives'
preserved = []
planned = []
base = 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
design = base + 'technical/72-desktop-local-execution-and-control-plane.md'
proof = base + 'quality/desktop-local-execution-checkpoint.json'

def update(file, fn):
    original = file.read_bytes()
    target = archive / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.txt')
    preserved.append({'source': file.relative_to(ROOT).as_posix(), 'archive': target.relative_to(ROOT).as_posix(), 'sha256': sha256(original).hexdigest()})
    text = fn(original.decode('utf-8'))
    assert text != original.decode('utf-8'), file
    planned.append((file, target, original, text))

zh = f'**当前实现：** Desktop 已接入本机 Codex、主进程授权、文件/终端、同线程继续、停止及公司网关费用通道；37 项客户端测试、10 项原生监督器测试、{control_tests} 项服务端与云端兼容检查、7 项实际打包 Electron 旅程检查通过。模型回合及系统选目录/授权决定是明确测试夹具。首批 5 个本机角色可用，完整 18 角色/媒体、生产签名与全部客户端验收继续跟踪。Extension 保持原生右侧栏云端对话与文件上传。见 [实现和边界]({design})。'
en = f'**Current implementation:** Desktop integrates local Codex, main-process consent, file/terminal tools, same-thread follow-up, stop and company-gateway billing. Validation covers 37 client tests, 10 native-supervisor tests, {control_tests} server/cloud-compatibility tests and seven actual packaged-Electron journey checks. Model turns and native chooser/consent decisions are explicit fixtures. Five local specialists are admitted; all eighteen roles/media tools, production signing and complete client acceptance remain open. The Extension keeps native Side Panel cloud conversations and file uploads. See [implementation and limits]({design}).'

diagram = '''```mermaid
flowchart LR
  Desktop[Frameless Desktop] --> Main[Trusted local permission and session control]
  Main --> Native[Customer-device Codex and local tools]
  Main --> Control[Company identity / role / budget control]
  Native --> Gateway[Company scoped AI gateway]
  Web[Web] --> Cloud[Cloud Codex and business tools]
  Extension[Native right Side Panel and selected-file uploads] --> Cloud
  Cloud --> Gateway
  Gateway --> Ledger[Server-observed usage and ledger]
```'''

def desktop(english):
    return f'''# Workmate · CopyPaste Desktop

[{'中文' if english else 'English'}]({'README.md' if english else 'README.en.md'}) · [Documentation]({base}README.en.md) · [Desktop branch](https://github.com/copypasteltd/workmate/tree/desktop)

{en if english else zh}

## {'Product and execution location' if english else '产品与执行位置'}

{('A frameless Windows Desktop Agent whose Codex process, session loop, file tools and terminal run on the customer computer. Inference uses the company internal OpenAI-compatible server. The Web application and Chrome Extension run cloud Codex; their file-upload service is not a substitute for the local Desktop kernel.' if english else 'Windows 无边框本机 Agent。Codex 进程、会话循环、文件和终端工具在客户电脑运行；推理使用公司内部 OpenAI 兼容服务器。Web 与 Chrome Extension 使用云端 Codex；上传文件服务不能替代 Desktop 本机内核。')}

{diagram}

## {'Sign-in and usage' if english else '登录与使用流程'}

1. {('Open Desktop, complete email/enterprise identity in the fixed company browser page, then return through localhost PKCE. Choose a company and project.' if english else '启动 Desktop，在固定公司浏览器页面完成邮箱/企业身份与 PKCE 授权，通过 localhost 回调返回，选择企业和项目。')}
2. {('Choose a supported local specialist and a workspace using the native directory chooser. Folder selection grants no execution permission.' if english else '选择已支持本机工具的角色，通过系统目录窗口选择工作目录；选目录本身不授予执行权限。')}
3. {('Choose read-only, workspace-write or full local access and confirm the native permission dialog. Full access defaults to Cancel and explicitly covers resources outside the workspace under the current OS user.' if english else '选择唯读、目录内读写或完整本机权限，在系统对话框确认。完整权限默认取消，明确涵盖当前 OS 用户可访问的工作目录外资源。')}
4. {('Enter the request and per-turn budget. Main reserves once, receives a task-scoped credential and launches the pinned bundled Codex. Watch messages, terminal output, file changes and company billing receipts.' if english else '输入要求和每轮预算。主进程预留一次预算，取得任务级凭据并启动随包锁定 Codex；查看消息、终端输出、文件变更及公司费用记录。')}
5. {('Continue the same local thread. Stop a running turn; change permission while idle or revoke at any time. Signing out revokes local grants. Network retries never blindly rerun accepted local actions.' if english else '在同一本机线程继续追问。可停止运行、空闲时调整权限或随时撤权；退出账号撤销本机授权。网络重试不会盲目重跑已接受的本机动作。')}

{('Company Admin can manage service access, VIP and fees, but cannot grant local OS permission. Full access is `danger-full-access` / `never`, without repeated command approval after consent; it does not elevate the OS account. Grants last until revocation/sign-out, independent of the optional legacy file bridge\'s one-hour/create-only grants.' if english else '公司 Admin 可管理服务、VIP 和费用，但不能代授本机 OS 权限。完整模式为 `danger-full-access` / `never`，授权后不逐命令重复确认，也不会提升系统账号权限。授权持续至撤权/登出，与可选旧文件桥的一小时、仅新建权限相互独立。')}

## {'Implementation and recovery' if english else '实现结构与恢复'}

- `src/main.ts`: {'trusted identity, native dialogs, IPC and lifecycle.' if english else '可信身份、系统对话框、IPC 和生命周期。'}
- `src/local-agent.ts`: {'encrypted journal, stable request keys, ownership, permission and result synchronization.' if english else '加密会话日志、稳定请求键、归属、授权与结果同步。'}
- `src/local-codex.ts`: {'native app-server, pinned Skills, checkpoint, sandbox, streaming, interruption and owned-process shutdown.' if english else '原生 app-server、固定 Skill、检查点、沙箱、流式事件、中断和自有进程关闭。'}
- `src/preload.cts` / `renderer/src/local-agent.tsx`: {'restricted bridge and local work UI; no credential or executable path crosses IPC.' if english else '受限桥与本机界面；凭据和二进制路径不经 IPC 传给页面。'}
- `src/window-controls.ts`: {'custom 40px title bar; `frame:false`, `thickFrame:false`, no Electron/Alt menu.' if english else '40px 自绘标题栏；`frame:false`、`thickFrame:false`，无 Electron/Alt 菜单。'}

{('Each native turn has an immutable desktop execution owner. Desktop-native authentication cannot enqueue a cloud Agent task; unsupported local tools require an explicit Web handoff. Native output is client-reported; fees use only server-observed usage. A lost settlement response retries only the saved receipt. Unknown effects, expired leases or missing provider usage keep a reconciliation hold and block automatic replay.' if english else '每个本机回合有不可变的 desktop 执行归属。Desktop 原生登录不能入队云端 Agent 任务；尚不支持的本机工具需要明确前往 Web。操作结果标记为客户设备上报，费用只用公司服务端观测。结算响应丢失只重传结果；未知操作、租约过期或缺少 usage 保留待核对预留，禁止自动重跑。')}

{('contextIsolation and sandbox are enabled, nodeIntegration is disabled. The generic renderer API rejects native execution/inference routes and encoded path aliases. Local history is encrypted, scoped to account/session epoch/company/project; sign-out stops owned runtimes. Renderer-only reload preserves the same-account history. No Docker, WSL, VM, PATH fallback or alternate kernel.' if english else '开启 contextIsolation/sandbox，关闭 nodeIntegration。通用页面 API 禁止原生执行/推理接口及编码别名。本机日志加密并绑定账号、登录 epoch、企业和项目；登出停止自有运行时，同账号页面刷新可恢复历史。禁止 Docker/WSL/虚拟机、PATH 回退与替代内核。')}

## {'Checkout, configure and run' if english else '检出、配置与启动'}

```powershell
git clone --single-branch --branch desktop git@github.com:copypasteltd/workmate.git copypaste-desktop
cd copypaste-desktop
npm ci
$env:COPYPASTE_LOCAL_CODEX_BIN = 'D:\\approved-runtime\\codex.exe'
npm run runtime:prepare
npm run build
npm start
```

{('Use Windows x64, Node.js ≥22.14 and the exact version/hash in `contracts/local-codex-runtime.json` (`0.163.0-alpha.11`). The path above is an explicit example: supply your approved binary with its adjacent native helpers. Preparation verifies version/hash, copies native resources into ignored `.data/runtime/windows-x64` and writes a resource manifest. Nothing is downloaded or read from PATH. The cloud runtime has its own independent version lock.' if english else '使用 Windows x64、Node.js ≥22.14 和 `contracts/local-codex-runtime.json` 指定的版本/摘要（`0.163.0-alpha.11`）。上述路径为显式示例，需提供已批准的二进制及相邻原生辅助程序。准备脚本验证版本/摘要，将原生资源写入忽略的 `.data/runtime/windows-x64` 并生成清单；不下载、不搜索 PATH。云端运行时有独立版本锁。')}

{('Company origins and extension ID are configured through `deployment.json` or `COPYPASTE_API_ORIGIN`, `COPYPASTE_WEB_ORIGIN`, `COPYPASTE_EXTENSION_ID`. Production requires company HTTPS origins. Provider master keys stay on the server. Backend migration 092 must be applied by the native migration runbook.' if english else '通过 `deployment.json` 或 `COPYPASTE_API_ORIGIN`、`COPYPASTE_WEB_ORIGIN`、`COPYPASTE_EXTENSION_ID` 配置公司入口和扩展 ID；生产需公司 HTTPS。供应商主密钥保留服务器。后端按原生迁移流程应用 092。')}

```powershell
npm run typecheck
npm test
$env:COPYPASTE_LOCAL_CODEX_TEST_BIN = $env:COPYPASTE_LOCAL_CODEX_BIN
npm run test:local
npm run package:dir
npm run package
```

{('Packaging includes Codex and native helpers in `resources/local-codex`. `package` builds NSIS Setup and Portable under ignored `release/`; current automated evidence qualifies a separate unsigned unpacked candidate whose exact path/ASAR/native hashes are in the checkpoint. Signing, human install/upgrade/uninstall and production provider qualification remain open. Do not copy local credentials or state into Git.' if english else '打包把 Codex 及辅助程序放入 `resources/local-codex`。`package` 在忽略的 `release/` 生成 NSIS Setup 与 Portable；当前自动化证据验证的是独立未签名 unpacked 候选程序，确切路径/ASAR/原生摘要见检查点。签名、人工安装/升级/卸载和真实供应商资格仍待验收，不把本地凭据或状态提交 Git。')}

{('The native renderer is maintained in this repository and builds independently. `renderer:sync` refuses to overwrite it with the Web snapshot; merge shared changes explicitly and run `node scripts/record-renderer.mjs` to record actual source hashes.' if english else '原生界面在本仓库独立维护、独立构建；`renderer:sync` 拒绝用 Web 快照覆盖。共享变更需显式合并，再运行 `node scripts/record-renderer.mjs` 记录实际源码摘要。')}

## {'Current screenshots and interaction' if english else '当前实际页面与交互'}

{('Actual packaged Electron and native Codex; real auth, database, local files, sandbox and ledger. Model responses and native chooser/dialog decisions are explicit fixtures, not human-click or live-provider acceptance.' if english else '实际打包 Electron 与真实原生 Codex；身份、数据库、本机文件、沙箱和账本真实运行。模型响应、系统选目录和授权决定为明确测试夹具，不等同人工点击或正式供应商验收。')}

![Local full access](assets/screenshots/workmate-local-{attempt}-full-access-en.png)

![Read-only downgrade](assets/screenshots/workmate-local-{attempt}-read-only-en.png)

![Stopped task and reconciliation hold](assets/screenshots/workmate-local-{attempt}-stopped-en.png)

![Chinese local workspace](assets/screenshots/workmate-local-{attempt}-workspace-zh.png)

![Actual local interaction](assets/screenshots/workmate-local-{attempt}-local-agent.gif)

[MP4](assets/screenshots/workmate-local-{attempt}-local-agent.mp4) · [Source and capture checkpoint]({proof}) · [Design and recovery]({design})

## {'Coverage and remaining work' if english else '覆盖与剩余范围'}

{('The five native specialists are fullstack, frontend, backend-api, software-qa and landing-page. All eighteen product roles and twenty-nine Skills remain in scope; complete native media/design/marketing integrations and app/browser automation need separate qualification. The earlier 802-test full Platform regression and old cloud/file-bridge recordings retain their historical source scope. The original 102 REQ/102 TC, NFR and G01–G10 baseline remains 81 partial, 21 unproven and zero fully accepted.' if english else '首批本机角色为 fullstack、frontend、backend-api、software-qa、landing-page。产品 18 角色及 29 Skill 目标全部保留；完整本机媒体/设计/营销、应用与浏览器自动化须分别接入验证。旧 802 项平台完整回归和云端/文件桥录屏只覆盖当时源码。原 102 REQ/102 TC、NFR、G01–G10 仍为 81 项局部验证、21 项未证明、0 项完整验收。')}

{('The optional Native Messaging file companion remains separate. It does not confer full local Agent access and is not required for the Extension\'s selected-file upload/cloud conversation flow. Close task-owned browser pages after use and preserve user tabs.' if english else '可选 Native Messaging 文件桥继续独立存在，不授予完整 Agent 权限，也不是 Extension 选文件上传/云端对话的前置。使用浏览器后关闭本任务不再需要的页面，保留用户标签页。')}

[{'Update notes' if english else '更新说明'}]({base}changes/2026-10-22-desktop-local-execution{'.en' if english else ''}.md) · [Repository and branch policy]({base}governance/04-git-branches-and-publication.md) · [Requirements]({base}requirements/03-client-execution-amendment.md)

{('Keep bilingual README, affected captures and release notes in sync, commit and push the mapped branch, then verify remote SHAs. No force-push. Local state, dependencies, native binaries and installers stay ignored.' if english else '后续同步中英 README、受影响截图/GIF 和更新说明，提交并推送对应分支，核对远程 SHA，不强推。本地状态、依赖、原生二进制及安装器保持忽略。')}
'''

readmes = [p for folder in (ROOT / 'docs', *(ROOT / 'dev').glob('copypaste-*')) for name in ('README.md', 'README.en.md') if (p := folder / name).is_file()]
for file in readmes:
    english = file.name == 'README.en.md'
    if file.parent.name == 'copypaste-desktop':
        update(file, lambda _, en=english: desktop(en))
        continue
    def edit(text, english=english):
        text, count = re.subn(r'^\*\*(?:当前实现：|Current implementation:).*?$', en if english else zh, text, count=1, flags=re.M)
        assert count == 1
        text = re.sub(r'```mermaid\nflowchart LR\n  Web\[Web workspace\].*?```', diagram, text, count=1, flags=re.S)
        text = text.replace('当前平台完整回归 **802/802**', '历史源码平台完整回归 **802/802**（后端已更新，此回执不作为新源码的完整回归）')
        text = text.replace('平台完整 **802/802**', '历史源码的平台完整 **802/802**')
        text = text.replace('**802/802** full Platform tests and', 'Historical-source **802/802** full Platform tests and')
        text = text.replace('The current Platform regression passes **802/802** tests', 'The historical-source Platform regression passed **802/802** tests (the backend has since changed; this is not a full regression of the new source)')
        text = text.replace('现有 Desktop 包尚未实现本机 Codex 和完整本机权限。', '当前本机候选包的执行、权限与费用验证见本次检查点；旧包保持原范围。')
        text = text.replace('The existing Desktop package does not yet implement local Codex or full local permission.', 'The new local candidate is qualified within the linked checkpoint; earlier packages retain their original scope.')
        text = text.replace('Target execution split; local Codex and full local access are not implemented in the current Desktop package.', 'Current execution split. The new Desktop candidate integrates local Codex and full local access within the linked qualification scope; earlier packages retain their original scope.')
        text = text.replace('Customer-device Codex / pending implementation', 'Customer-device Codex / native candidate')
        text = text.replace('本机 supervisor 的实现、实际权限测试与剩余产品接入见', '本机 supervisor 的实现及历史原生权限测试见')
        text = text.replace('另有独立本机 Codex supervisor **9 项**原生测试通过，尚未接入完整客户端授权/费用流程。', '本次另有 10 项原生监督器及 7 项打包 Electron 本机旅程检查，已接入客户授权和公司费用通道；完整资格仍按新检查点跟踪。')
        text = text.replace('Separately, **9** real-native Codex supervisor checks pass; complete Electron consent and billing integration remain pending.', 'The new checkpoint adds ten real-native supervisor checks and seven packaged Electron journey checks, including consent and company billing; full qualification remains open.')
        text += ('\nLatest Desktop local execution: [design](' + design + ') · [source-bound proof](' + proof + '). Prior recordings below retain their original source scopes.\n' if english else '\n本次 Desktop 本机执行：[具体方案](' + design + ') · [源码与真实旅程证据](' + proof + ')；既有媒体保持原始源码范围。\n')
        if file.parent.name == 'copypaste-platform':
            text += ('\n## Desktop execution admission\n\nMigration 092 separates immutable cloud/desktop execution ownership. Only the Desktop native login family may create/start/heartbeat/report a local execution; web/extension/Admin cannot grant OS permission. Task creation remains in the common reservation/role/Skill/frozen-pricing domain. Local tasks never enter the cloud queue. Native scoped Responses recheck auth, ownership, lease, capabilities and server budget on admission/dispatch; hosted or unknown native tools are denied. Finish fences admission before closing upstream and settles only company-observed usage. Unknown local/provider outcomes remain reconciling. See the linked design for strict routes, RLS, idempotency and recovery.\n' if english else '\n## Desktop 本机执行准入\n\n迁移 092 固定 cloud/desktop 执行归属；只有 Desktop 原生登录 family 可创建/开始/续租/上报本机执行，Web/Extension/Admin 不能代授 OS 权限。创建仍复用角色/Skill、原价和费用预留；本机任务不入云队列。原生 scoped Responses 在准入/派发重验身份、归属、租约、能力及服务端预算，拒绝未知/托管工具。完成先封锁推理，再关闭上游，仅按公司观测结算；未知本机/供应商结果保留待核对预留。严格路由、RLS、幂等和恢复见上方方案。\n')
        if file.parent.name == 'copypaste-delivery':
            text += ('\n## Local Desktop verification\n\nSet explicit locked `COPYPASTE_LOCAL_CODEX_BIN` and `COPYPASTE_LOCAL_CODEX_TEST_BIN`. Run `node scripts/run-desktop-execution-checks.mjs NN`, `node scripts/run-local-codex-checks.mjs NN`, and `node scripts/run-desktop-local-ui.mjs NN` using fresh two-digit attempt IDs. Reports refuse overwrite, bind before/after source hashes and retain failed attempts. The UI runner packages a new unsigned candidate under Desktop `.data/local-candidates/`, uses an isolated native PostgreSQL fixture, actual Electron and an owned browser, then closes them and proves fixture cleanup. Never run database-owning suites on occupied ports. Native dialog decisions/provider messages are fixtures; real local tools and billing are exercised.\n' if english else '\n## 本机 Desktop 验证\n\n明确设置与运行锁一致的 `COPYPASTE_LOCAL_CODEX_BIN`、`COPYPASTE_LOCAL_CODEX_TEST_BIN`，用未用过的两位编号运行 `node scripts/run-desktop-execution-checks.mjs NN`、`node scripts/run-local-codex-checks.mjs NN`、`node scripts/run-desktop-local-ui.mjs NN`。报告禁止覆盖，绑定前后源码摘要并保留失败。UI 启动器在 Desktop `.data/local-candidates/` 新建未签名候选，使用隔离原生 PostgreSQL、真实 Electron 和自有浏览器，关闭并核对夹具回收；不接管占用端口的服务。授权决定及供应商文本是夹具，本机工具和费用真实执行。\n')
        return text
    update(file, edit)

for name in ('docs/00-document-map.md', 'docs/technical/69-desktop-local-codex-and-extension-direction.md', 'docs/technical/70-desktop-native-codex-supervisor.md', 'docs/technical/12-implementation-and-repositories.md'):
    file = ROOT / name
    update(file, lambda text: text.split('\n', 1)[0] + '\n\n**最新实现（阶段 72）：** Desktop 已接入本机 Codex、客户授权、主进程 IPC、公司网关费用及实际打包旅程。原文保留其初始/历史范围，当前方案与证据见 [本机执行及控制面](' + ('technical/' if file.parent.name == 'docs' else '') + '72-desktop-local-execution-and-control-plane.md)。下列旧回执不自动认定为新源码通过。\n' + text.split('\n', 1)[1])

file = ROOT / 'docs/technical/01-architecture-and-stack.md'
update(file, lambda text: text.replace('下图为目标架构；本机 Codex/full permission 仍待实现，历史运行证据不因此升级。', '下图为当前执行分工；阶段 72 已接入本机 Codex/完整权限及公司费用通道，限定证据与待验收范围见 [本机执行及控制面](72-desktop-local-execution-and-control-plane.md)。历史回执保留原始源码范围。').replace('尚不能用现有云端任务 API 冒充已实现。', '本机入口使用独立 desktop-executions 契约，旧云端任务 API 不承接 Desktop 原生登录的 Agent 请求。'))
file = ROOT / 'docs/technical/02-runtime-and-ai-gateway.md'
update(file, lambda text: text.replace('当前 Desktop 只有文件桥接，本机 Codex 集成仍待实现，见 [方向检查](69-desktop-local-codex-and-extension-direction.md)。', '阶段 72 已接入独立本机 Codex、客户授权和任务级公司推理凭据；原有文件桥保持可选，具体实现和资格边界见 [本机执行及控制面](72-desktop-local-execution-and-control-plane.md)。'))
for name in ('docs/DELIVERY.md', 'docs/quality/09-implementation-alignment-audit.md', 'docs/quality/02-requirements-traceability.md'):
    file = ROOT / name
    relative = 'technical/' if file.parent.name == 'docs' else '../technical/'
    update(file, lambda text, relative=relative: text.split('\n', 1)[0] + '\n\n**阶段 72 更新：** 本机 Desktop 的主进程授权、实际 Codex/文件/终端、同线程继续、停止及公司账本已接入，并以限定模拟供应商/系统对话框决定的实际打包旅程验证。Extension 保持右侧栏云端对话和附件上传。当前证据及未完成范围见 [方向落实与验收边界](' + relative + '72-desktop-local-execution-and-control-plane.md#7-方向检查与验收边界)。下文旧检查保留其原始时点和源码；原 102 项完整验收状态未提升。\n' + text.split('\n', 1)[1])

file = ROOT / 'docs/requirements/03-client-execution-amendment.md'
update(file, lambda text: text.replace('该库尚未接入完整客户端授权/费用流程；以下产品级判断继续有效。', '后续阶段 72 已接入主进程、客户授权、公司推理和费用通道，并验证实际打包程序，见 [本机执行及控制面](../technical/72-desktop-local-execution-and-control-plane.md)。以下历史检查保留原范围；全角色/工具和完整 DESK-L01–L08 仍须继续逐项验收。').replace('本次检查确认：Desktop 当前只有云端执行和受限文件桥接，DESK-L01–L08 **尚未完整实现/验证**；', '初始方向检查时 Desktop 只有云端执行和受限文件桥接。阶段 72 已接入本机执行、完整权限、同线程继续和费用；仍不将首批 5 角色及自动化夹具范围提升为 DESK-L01–L08 全量验收。'))
file = ROOT / 'docs/governance/04-git-branches-and-publication.md'
update(file, lambda text: text.replace('无边框 Electron、本机 Codex 内核及独立文件桥；产品流程接入中', '无边框 Electron、本机 Codex、客户授权/费用及独立可选文件桥'))
file = ROOT / 'docs/quality/requirements-alignment-progress.json'
def progress(text):
    data = json.loads(text)
    data['desktop_local_product_repair'] = {'at': datetime.now(timezone.utc).isoformat(), 'checkpoint': 'desktop-local-execution-checkpoint.json', 'status': checkpoint['status'],
        'control_tests': control_tests, 'unit_tests': 37, 'native_tests': 10, 'packaged_ui_checks': 7,
        'scope': 'Actual local Codex, Electron/IPC, consent contract, same-thread follow-up, local files, sandbox, company inference and server ledger; synthetic model/native dialog decisions',
        'remaining': checkpoint['limits'], 'baseline': {'requirements': 102, 'acceptance_cases': 102, 'partial': 81, 'unproven': 21, 'fully_accepted': 0}}
    data['current_source_qualification'] = {'stage': 72, 'checkpoint': 'desktop-local-execution-checkpoint.json',
        'note': 'Current bounded local Desktop/control-plane regression only. Earlier complete Platform and client/Extension receipts retain their historical source scopes. All original acceptance conditions remain.'}
    return json.dumps(data, ensure_ascii=False, indent=2) + '\n'
update(file, progress)
for file, target, original, text in planned:
    assert file.read_bytes() == original, 'Document changed during preflight: ' + str(file)
archive.mkdir(parents=True, exist_ok=False)
for file, target, original, text in planned:
    target.write_bytes(original)
for file, target, original, text in planned:
    file.write_text(text, encoding='utf-8', newline='\n')
(archive / 'manifest.json').write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'files': preserved}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'updated_readmes': len(readmes), 'preserved_documents': len(preserved)}))
