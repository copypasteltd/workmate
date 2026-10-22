"""Update current documentation after source-bound stage 73 checks pass."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
checkpoint = json.loads((ROOT / 'docs/quality/desktop-company-tools-checkpoint.json').read_text(encoding='utf-8'))
assert checkpoint['status'] == 'verified_native_company_tool_subset'
attempt = checkpoint['selected']['ui']
count = checkpoint['platform_tests']['tests']
base = 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
design = base + 'technical/73-desktop-native-company-tools.md'
proof = base + 'quality/desktop-company-tools-checkpoint.json'
archive = ROOT / 'docs/quality/history/before-desktop-company-tool-docs'
assert not archive.exists()
planned = []


def update(file, fn):
    data = file.read_bytes()
    result = fn(data.decode('utf-8'))
    assert result != data.decode('utf-8'), file
    planned.append((file, data, result))


zh = f'**当前实现：** Desktop 在本机运行 Codex，支持客户完整授权、文件/终端、同线程继续、停止及公司费用通道；本次新增公司图片/设计/资料工具和私有产物下载。37 项客户端测试、14 项真实原生测试、{count} 项平台完整回归及 9 项实际打包 Electron 旅程检查通过。16 个角色已接通本机工具协议，不等同完整专业验收；视频与流程顾问本机集成、全 18 角色/29 Skill、生产签名及全部客户端验收继续跟踪。模型/图片响应和系统对话框决定明确使用假数据夹具。Extension 保持原生右侧栏云端对话与获选文件上传。见 [方案与边界]({design})、[源码及媒体证据]({proof})。'
en = f'**Current implementation:** Desktop runs Codex locally with user-granted full access, local files/terminal, same-thread follow-up, stop and company billing. Company image/design/data tools and private-artifact downloads are now connected. Validation passes 37 client tests, 14 real-native tests, {count} full Platform regression tests and nine actual packaged-Electron journey checks. Sixteen roles have the native tool protocol connected; this is not complete professional qualification. Native video/workflow integration, all eighteen roles/twenty-nine Skills, signing and full client acceptance remain open. Model/image responses and native dialog decisions are explicit synthetic fixtures. The Extension retains native Side Panel cloud conversations and selected-file uploads. See [design and limits]({design}) and [source/media evidence]({proof}).'


for folder in (ROOT / 'docs', *(ROOT / 'dev').glob('copypaste-*')):
    for name in ('README.md', 'README.en.md'):
        file = folder / name
        if not file.is_file():
            continue
        english = name == 'README.en.md'

        def edit(text, english=english, component=folder.name):
            text, matches = re.subn(r'^\*\*(?:当前实现：|Current implementation:).*?$', en if english else zh, text, count=1, flags=re.M)
            assert matches == 1
            text = text.replace('## Current client direction — implementation gap', '## Current client direction and qualified scope')
            text = text.replace('The architecture diagram below describes the implemented cloud/file-bridge baseline; it is not the target Desktop local-agent architecture.', 'Desktop runs the native Agent locally; the Web and Extension run cloud Codex. The linked stage 73 proof states the tested scope.')
            text = text.replace('The following describes the implemented cloud/file-bridge baseline. Desktop local Codex and full local access require separate implementation and acceptance under CLIENT01.', 'The following describes the shared company workflow. Desktop local permission, persistent threads and company tools follow the stage 73 design and source-bound checkpoint.')
            text = text.replace('以下操作描述当前云端/文件桥接基线；Desktop 的本机 Codex 与完整权限按 CLIENT01 改造后另行验收。', '以下为平台通用流程；Desktop 的本机授权、持续线程及公司业务工具使用流程见阶段 73 方案和本次证据。')
            text = text.replace(base + 'technical/72-desktop-local-execution-and-control-plane.md', design)
            text = text.replace(base + 'quality/desktop-local-execution-checkpoint.json', proof)
            if component == 'docs':
                text = text.replace('  LocalCodex --> Gateway[Internal OpenAI-compatible API]', '  LocalCodex --> Gateway[Internal OpenAI-compatible API]\n  LocalCodex --> MainTools[Company tools via trusted Desktop main]\n  MainTools --> API')
                text = text.replace('  Budget --> Codex[Version-pinned Codex]', '  Budget -->|Web / Extension cloud tasks only| Codex[Cloud version-pinned Codex]')
                text = text.replace('2. 选择默认助手、18 个角色预设或私人专员；', '2. Web/Extension 选择默认助手、18 个角色预设或私人专员；Desktop 当前选择 16 个已接通本机协议的预设。')
                text = text.replace('2. Select the default assistant, a preset among eighteen roles, or a personal specialist.', '2. Web/Extension offer the default assistant, eighteen role presets and personal specialists. Desktop currently admits sixteen presets with the native protocol connected.')
                text = text.replace('4. 明确计量且已完成的回合需要资料时，选择当前获准版本，沿用原任务、线程与预留继续；限制八轮、三十二项依赖，未知结果进入核对。', '4. Web/Extension 明确计量且已完成的回合需要资料时，选择当前获准版本，沿用原任务、线程与预留继续；限制八轮、三十二项依赖。Desktop 支持同一本机线程继续，原生等待输入界面仍待接入；两类任务的未知结果均进入核对。')
                text = text.replace('4. When a measured completed turn requests inputs, select authorized current versions and continue the original task/thread/hold. There are eight-round and thirty-two-dependency bounds. Unknown effects require reconciliation.', '4. In Web/Extension, when a measured completed turn requests inputs, select authorized current versions and continue the original task/thread/hold, within eight-round and thirty-two-dependency bounds. Desktop supports same-local-thread follow-up; native waiting-input UI remains to be integrated. Unknown effects in either execution path require reconciliation.')
                text = text.replace('本次另有 10 项原生监督器及 7 项打包 Electron 本机旅程检查，已接入客户授权和公司费用通道；完整资格仍按新检查点跟踪。', f'阶段 72 的 10 项原生监督器和 7 项 Electron 检查保留原源码范围；阶段 73 另绑定当前源码的 {count} 项平台完整回归、14 项真实原生、37 项客户端及 9 项打包旅程。完整资格仍按新检查点跟踪。')
                text = text.replace('The new checkpoint adds ten real-native supervisor checks and seven packaged Electron journey checks, including consent and company billing; full qualification remains open.', f'Stage 72 retained ten real-native supervisor and seven Electron checks for its historical source. Stage 73 binds current source to {count} full Platform regressions, fourteen real-native tests, thirty-seven client tests and nine packaged journey checks. Full qualification remains open.')
                text = text.replace('SQL001–091 保持不可改写。', 'SQL001–092 保持不可改写。').replace('Applied SQL001–091 remain immutable.', 'Applied SQL001–092 remain immutable.')
                text = text.replace('四端媒体记录既有云端/文件桥接界面，绑定真实捕获时间、摘要及清理结果。', '较早的四端媒体仍记录原云端/文件桥接源码范围；本次另有本机公司工具媒体，分别绑定捕获时间、摘要及清理结果。')
                text = text.replace('Four-client media records the existing cloud/file-bridge UI with actual capture timing, hashes and owned-client cleanup.', 'Earlier four-client media retains its original cloud/file-bridge source scope; new local company-tool media has its own timing, hashes and owned-client cleanup.')
                text = text.replace('(quality/local-codex-supervisor-checkpoint.json)', '(quality/desktop-company-tools-checkpoint.json)')
                text = text.replace('[候选包字节](quality/client-direction-package.json)', '[本机候选包字节](quality/desktop-company-tools-checkpoint.json)').replace('[Candidate package bytes](quality/client-direction-package.json)', '[Current local candidate bytes](quality/desktop-company-tools-checkpoint.json)')
                text = text.replace('design/implementation/workmate/desktop-workmate-10-input-ready-en.png', f'design/implementation/workmate/desktop-native-{attempt}-full-access-en.png')
                text = text.replace('design/implementation/workmate/desktop-workmate-10-interaction.gif', f'design/implementation/workmate/desktop-native-{attempt}-local-agent.gif')
                text = text.replace('design/implementation/workmate/desktop-workmate-10-interaction.mp4', f'design/implementation/workmate/desktop-native-{attempt}-local-agent.mp4')
                caption = ('Stage 73: actual packaged local Codex, full-access flow, company images and private downloads; model/image responses and native dialog decisions are explicit fixtures. Other client media below retain their historical source scopes.' if english else '阶段 73：实际打包本机 Codex、完整权限流程、公司图片与私有下载；模型/图片响应及系统窗口决定为明确夹具。其他客户端媒体保留历史源码范围。')
                text = text.replace('### Desktop\n\n', '### Desktop\n\n' + caption + '\n\n')
                text = text.replace(f'![desktop](design/implementation/workmate/desktop-native-{attempt}-full-access-en.png)', f'![desktop](design/implementation/workmate/desktop-native-{attempt}-full-access-en.png)\n\n![Company design artifacts](design/implementation/workmate/desktop-native-{attempt}-company-artifacts-en.png)\n\n![Minimum native window](design/implementation/workmate/desktop-native-{attempt}-compact-en.png)')
            if component == 'copypaste-desktop':
                text = text.replace('  Native --> Gateway[Company scoped AI gateway]', '  Native --> Gateway[Company scoped AI gateway]\n  Native --> CompanyTools[Company project and media tools via trusted main]\n  CompanyTools --> Artifacts[Private immutable artifacts and explicit native download]')
                text = text.replace('5. 在同一本机线程继续追问。', '5. 公司生图、设计与资料工具按当前角色开放；产物显示明确版本，点击下载并在系统窗口选择保存位置。本机文件和命令仍在客户电脑执行。\n6. 在同一本机线程继续追问。')
                text = text.replace('5. Continue the same local thread.', '5. Use company image/design/data tools allowed by the current specialist. Artifact buttons identify exact versions; choose their local destination in the native save dialog. Files and commands still run on this computer.\n6. Continue the same local thread.')
                text = text.replace('workmate-local-05-', 'workmate-local-' + attempt + '-')
                text = text.replace('![Read-only downgrade]', '![Company image edit and private artifacts](assets/screenshots/workmate-local-' + attempt + '-company-artifacts-en.png)\n\n![Read-only downgrade]')
                text = text.replace('![Chinese local workspace]', '![Minimum native window](assets/screenshots/workmate-local-' + attempt + '-compact-en.png)\n\n![Chinese local workspace]')
                text = text.replace('模型响应、系统选目录和授权决定为明确测试夹具', '模型/图片响应、系统选目录/授权/保存决定为明确测试夹具')
                text = text.replace('Model responses and native chooser/dialog decisions are explicit fixtures', 'Model/image responses and native chooser/consent/save decisions are explicit fixtures')
                text = text.replace(base + 'quality/desktop-local-execution-checkpoint.json', proof)
                text = text.replace(base + 'technical/72-desktop-local-execution-and-control-plane.md', design)
                text = text.replace('首批本机角色为 fullstack、frontend、backend-api、software-qa、landing-page。', '16 个角色接通软件开发、页面、图像/品牌/电商/社交/插画/排版/简报/资讯设计及营销分析的本机协议；准入及 Skill 摘要验证不等同完整专业工作流验收。video-motion、workflow-consultant 的本机工具仍待接通。')
                text = text.replace('The five native specialists are fullstack, frontend, backend-api, software-qa and landing-page.', 'Sixteen native role registrations cover software/page work, visual/brand/commerce/social/illustration/type/presentation/information design and marketing analysis. Admission and Skill hashes do not establish full professional qualification. Native video-motion and workflow-consultant tools remain to be integrated.')
                text = text.replace('应用与浏览器自动化须分别接入验证。', '本机等待输入界面、应用与浏览器自动化须分别接入验证。')
                text = text.replace('app/browser automation need separate qualification.', 'native waiting-input UI and app/browser automation need separate implementation and qualification.')
                text = text.replace('2026-10-22-desktop-local-execution', '2026-10-23-desktop-company-tools')
            detail = ('\n## Native company-tool contract\n\nThe Agent loop stays on the customer device. Main registers trusted `copypaste` dynamic tools for the pinned native runtime, binds each call to its task/call/thread/turn, and rechecks company permissions before effects and disclosure. Local read-only denies company mutations. Original business validation remains enforced after the native schema projection. Same-call retries reuse durable results; unknown accepted image operations stop further calls and retain reconciliation holds. Private artifact downloads use exact versions and a native save selection.\n' if english else '\n## 本机公司工具契约\n\nAgent 循环保持在客户电脑。主进程为锁定的原生运行时注册可信 `copypaste` 动态工具，绑定任务、调用、线程及回合，在效果前及返回前重验公司权限。本机唯读拒绝公司写入；原生 schema 投影不替代原始业务参数验证。同一调用重试复用持久结果，已接受而未知的图片操作阻断后续调用并保留费用核对。私有产物按明确版本下载，保存目标由系统窗口选择。\n')
            if component in ('copypaste-platform', 'copypaste-desktop', 'copypaste-delivery'):
                text += detail
            if component == 'copypaste-delivery':
                text = text.replace('新版本原生 UI 验证 `node scripts/run-paid-input-native.mjs NN --media`', '历史云端/文件桥兼容 UI 验证 `node scripts/run-paid-input-native.mjs NN --media`')
                text = text.replace('The current `node scripts/run-paid-input-native.mjs NN --media` UI journey', 'The historical compatibility `node scripts/run-paid-input-native.mjs NN --media` UI journey')
                text += ('\nThe current company-tool checkpoint selects a complete Platform run with `node scripts/run-desktop-execution-checks.mjs NN --full-platform`, plus the native and actual packaged UI runners. Use a new attempt ID, explicit pinned binaries and free owned ports; failed receipts remain immutable. Never modify covered source while a bound run is active.\n' if english else '\n当前公司工具检查点选择 `node scripts/run-desktop-execution-checks.mjs NN --full-platform` 的完整平台回归，以及原生与实际打包 UI 启动器。使用新的编号、明确锁定二进制和空闲自有端口；保留失败回执。绑定运行期间不得修改覆盖源码。\n')
                text += ('\nFor execution environments that interrupt long runs, the selected checkpoint uses the resumable runner: `node scripts/run-desktop-platform-resumable.mjs NN --init`, then `--next` for each planned batch, and `--finish`. It fixes all 63 test files and source hashes before execution, verifies six recovery-rule tests, and records sixteen independently owned batches. Every file must pass with unchanged source, separate complete TAP, fixture cleanup and database shutdown. Interrupted attempts contribute no coverage; only their unfinished batch is retried. A failed batch requires review and a new qualification. The final index sums the complete inventory without fabricating a single TAP stream.\n' if english else '\n长运行可能被执行环境中断时，本次检查点使用可恢复启动器：`node scripts/run-desktop-platform-resumable.mjs NN --init`，逐批执行 `--next`，最后 `--finish`。启动前固定全部 63 个测试文件与源码摘要，先验证六项恢复规则，再分 16 批独立运行。每个文件都须通过，并证明源码未变、独立完整 TAP、夹具清理和数据库关闭。中断记录不贡献覆盖，仅重跑未完成批；实际失败须复查并使用新资格编号。最终按完整清单汇总，不拼造单次 TAP。\n')
            text += ('\nLatest company-tool update: [release notes](' + base + 'changes/2026-10-23-desktop-company-tools.en.md) · [source-bound checkpoint](' + proof + '). Earlier reports and media retain their historical source scopes.\n' if english else '\n本次公司工具更新：[更新说明](' + base + 'changes/2026-10-23-desktop-company-tools.md) · [源码检查点](' + proof + ')；较早回执和媒体保持原始源码范围。\n')
            return text

        update(file, edit)


for name in ('docs/00-document-map.md', 'docs/technical/01-architecture-and-stack.md', 'docs/technical/05-local-executor-and-browser.md', 'docs/modules/07-web-extension-desktop.md', 'docs/technical/69-desktop-local-codex-and-extension-direction.md', 'docs/technical/70-desktop-native-codex-supervisor.md', 'docs/technical/71-extension-cloud-conversations.md', 'docs/technical/72-desktop-local-execution-and-control-plane.md', 'docs/requirements/03-client-execution-amendment.md', 'docs/quality/09-implementation-alignment-audit.md', 'docs/quality/02-requirements-traceability.md', 'docs/DELIVERY.md'):
    file = ROOT / name
    relative = 'technical/' if file.parent.name == 'docs' else '../technical/' if file.parent.name in ('quality', 'requirements', 'modules') else ''
    note = f'**阶段 73 当前增量：** Desktop 保持本机 Codex，接通公司图片/设计/资料工具和私有成果下载；16 个角色的本机协议可准入。真实原生 14 项、平台完整回归 {count} 项、打包 Electron 9 项旅程通过，供应商/系统对话框决定明确为假数据夹具。全 18 角色/29 Skill 和完整产品验收仍保留。见 [本机公司工具]({relative}73-desktop-native-company-tools.md)。下列阶段 72 及更早记录只证明原始源码范围。'
    def main_document(text, note=note, name=name):
        text = text.split('\n', 1)[0] + '\n\n' + note + '\n' + text.split('\n', 1)[1].replace('**最新实现（阶段 72）：**', '**历史实现（阶段 72）：**')
        if name == 'docs/technical/01-architecture-and-stack.md':
            text = text.replace('    C --> G[公司内部 AI 服务]', '    C --> I[公司任务级推理入口]\n    I --> G[公司内部 AI 服务]\n    C --> K[Desktop 主进程公司工具通道]\n    K --> A\n    A --> CT[本机任务的公司资料与媒体工具]\n    CT --> G\n    CT --> S')
            text = text.replace('    P --> O[Outbox dispatcher]', '    P -->|仅云端任务的 outbox| O[Outbox dispatcher]')
            text = text.replace('逻辑连线不意味着开放数据库或对象库给客户端。', 'Desktop 任务只保存本机执行归属与费用，不创建云端 Agent outbox；公司工具共享项目、产物和账本规则，不能接管本机执行循环。逻辑连线不意味着开放数据库或对象库给客户端。')
            text = text.replace('进程在事务提交后、投递前崩溃时，dispatcher 可重新扫描 outbox；', '仅对 Web/Extension 云端任务，进程在事务提交后、投递前崩溃时，dispatcher 可重新扫描 outbox；')
            text = text.replace('业务事务内同时写状态、事件和 outbox；费用变更同时写 reservation 与 ledger。', '云端任务在业务事务内同时写状态、事件和 outbox；Desktop 事务保存本机归属、控制事件与费用，不创建云端 Agent outbox。两类任务的费用变更均同时写 reservation 与 ledger。')
        return text
    update(file, main_document)


def progress(text):
    data = json.loads(text)
    data['desktop_company_tools_repair'] = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 73, 'checkpoint': 'desktop-company-tools-checkpoint.json', 'status': checkpoint['status'],
        'platform_tests': count, 'unit_tests': 37, 'native_tests': 14, 'packaged_ui_checks': 9, 'connected_native_roles': 16,
        'role_registration_is_full_qualification': False, 'remaining': checkpoint['limits'],
        'baseline': {'requirements': 102, 'acceptance_cases': 102, 'partial': 81, 'unproven': 21, 'fully_accepted': 0}}
    data['current_source_qualification'] = {'stage': 73, 'checkpoint': 'desktop-company-tools-checkpoint.json',
        'note': 'Complete Platform regression and bounded actual native/Desktop company-tool integration. Prior receipts retain original sources; professional/production/all-client acceptance remains open.'}
    return json.dumps(data, ensure_ascii=False, indent=2) + '\n'


update(ROOT / 'docs/quality/requirements-alignment-progress.json', progress)
for file, original, _ in planned:
    assert file.read_bytes() == original
archive.mkdir(parents=True, exist_ok=False)
preserved = []
for file, original, result in planned:
    saved = archive / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.txt')
    saved.write_bytes(original)
    preserved.append({'source': file.relative_to(ROOT).as_posix(), 'archive': saved.relative_to(ROOT).as_posix(), 'sha256': sha256(original).hexdigest()})
for file, _, result in planned:
    file.write_text(result, encoding='utf-8', newline='\n')
(archive / 'manifest.json').write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'files': preserved}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'updated_documents': len(planned), 'preserved': len(preserved), 'platform_tests': count, 'ui_attempt': attempt}))
