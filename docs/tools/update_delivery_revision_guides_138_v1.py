"""Update bilingual usage guides after the exact revision checkpoint passes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
CP = ROOT / 'docs/quality/delivery-revision-checkpoint-138.json'
cp = json.loads(CP.read_bytes())
assert cp['status'] == 'verified_source_bound_delivery_revisions'
previous = ROOT / 'docs/quality/remaining-work-stage137.json'
old = json.loads(previous.read_bytes())
value = copy.deepcopy(old)
scopes = {
    'REQ-002': '阶段138验证修订来源的跨企业、私有会话、只读／编辑权限、共享成果同事修改及来源撤回；既有完整品牌／连接器／异步权限矩阵继续开放。',
    'REQ-022': '阶段138三端可由原交付发起修改、确认新预算、保持固定来源及角色、生成新交付并下载；专业媒体实际编辑、全部工程依赖和跨环境恢复继续开放。',
    'REQ-035': '阶段138Web原会话可选文字、图片区域和实解码MP4时段，提交修改及重试丢失受理回执，新成果回到原会话并下载；全业务首单及专业质量继续开放。',
    'REQ-036': '阶段138实际Chrome原生右侧栏由原聊天发起引用文字修改、云端执行、新成果回到原会话及原生下载，保持繁英界面且不新增普通面板页签；完整网页协作、浏览器及安装权限矩阵继续开放。',
    'REQ-039': '阶段138实际未签名Windows包运行本机Codex读取固定来源、执行本机命令保留原文件并建立新文件、提交新交付和下载；完整本机授权可撤销，三档原生窗口无边框／菜单／可见滚动轨。全部工具、OS／DPI与签名安装仍开放。',
    'REQ-046': '阶段138预览无新增任务、预留或模型调用；同键同正文云端受理一次，本机受理／结果跨重启核对且不同要求冲突；所有生产费率、媒体及未知费用矩阵继续开放。',
    'REQ-060': '阶段138同步六组件及文档中英README、修改逻辑图、实际三端截图／GIF／MP4、原始失败及确切源码绑定；本机Codex及原生右侧栏真实执行。完整独立检出复现、签名安装和生产综合交付继续开放。',
    'REQ-068': '阶段138收口固定原交付继续工作子流程：按任务版本／交付摘要选择整份、答复、文件、Unicode文字、图片区域或视频时段；新预算、原角色、原会话、原文件保留；源换版／撤回阻断，云端与本机运行位置固定。全类型专业编辑、完整版本对比／审阅／存项目及分享生命周期仍按原范围开放。',
    'REQ-073': '阶段138所有既有交付格式可按完整成果提出修改并保持来源；文字／图片／视频位置通过统一输入约束。十八候选角色的完整专业输出／修改／异常矩阵继续开放。',
    'REQ-078': '阶段138新增来源消费、文字原文、区域与时段边界、同源改版、撤权、实际三端新交付的定向验收；全角色输入／输出／异常及工程来源矩阵继续开放。',
}
for row in value['requirements']:
    if row['id'] in scopes:
        row['current_audit_remaining'] = scopes[row['id']]
        row['current_review_note'] = '阶段138收口原成果修改及新交付子流程；原始完整验收范围与身份保留。'
assert [r['id'] for r in value['requirements']] == [r['id'] for r in old['requirements']]
assert len(value['requirements']) == 102 and value['summary'] == old['summary']
assert [r['id'] for r in value['requirements'] if r['full_acceptance'] == 'accepted'] == ['REQ-095']
value.update(schema_version=20, reviewed_at=datetime.now(timezone.utc).isoformat(),
    previous_review={'path': previous.relative_to(ROOT).as_posix(), 'sha256': sha256(previous.read_bytes()).hexdigest()},
    checkpoint={'path': CP.relative_to(ROOT).as_posix(), 'sha256': sha256(CP.read_bytes()).hexdigest()}, new_full_acceptance_closures=0,
    current_increment={'stage': 138, 'counts': cp['counts'], 'required_open': 88, 'unconfirmed_suggestions': 12, 'optional_open': 1,
        'whole_platform_runtime_rerun': False, 'full_acceptance_closures': 0, 'updated_scope_records': list(scopes)})
ledger = ROOT / 'docs/quality/remaining-work-stage138.json'
assert not ledger.exists() and not ledger.with_suffix('.md').exists()
ledger.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
c = cp['counts']
validation = f"{c['backend_integration_tests']}项当前后端检查（含13项新增修改测试）、{c['extension_state_tests']}项扩展状态检查、{c['desktop_state_tests']}项桌面控制／下载回归及9项三端实际旅程通过。11张实际截图、3组GIF／MP4、7档布局和3个独立解压的下载包绑定{len(cp['source_files'])}份确切源码。"
validation_en = f"{c['backend_integration_tests']} current backend checks including 13 new revision cases, {c['extension_state_tests']} extension checks, {c['desktop_state_tests']} native controller/download checks and nine actual client journey checks passed. Eleven actual screenshots, three GIF/MP4 pairs, seven layouts and three independently extracted revised archives bind {len(cp['source_files'])} exact source files."
intro = '# 当前完整编号清单 · 阶段138\n\n保留102条原始身份。REQ-095维持原验收；88条必需、12条未确认建议和1条可选记录继续按原完整范围验收，不能将这些完整验收记录理解为101个未编码模块。本轮补齐三端原交付修改及新成果交付子流程。\n\n' + validation + ' 业务／模型内容为已授权假数据，登录、权限、文件、Windows本机Codex及Chrome右侧栏实际执行。完整专业输出、真实公司模型／广告账户、工程恢复及签名安装继续独立验收。\n\n[检查点](delivery-revision-checkpoint-138.json) · [原始证据](delivery-revision-evidence-138/index.json) · [机器清单](remaining-work-stage138.json) · [变更](../changes/138-source-bound-delivery-revisions.md)\n\n| 编号 | 优先级 | 模块 | 当前状态 | 原始完整验收的结论及余项 |\n| --- | --- | --- | --- | --- |\n'
lines = [f"| {r['id']} | {r['priority']} | {r['module']} | {r['audit_status']} | {r['current_audit_remaining'].replace('|', '／')} |" for r in value['requirements']]
ledger.with_suffix('.md').write_text(intro + '\n'.join(lines) + '\n', encoding='utf-8', newline='\n')

base = 'https://github.com/copypasteltd/workmate/blob/main/docs/'
links = f'[需求]({base}requirements/15-delivery-revisions.md) · [方案与使用逻辑]({base}technical/138-source-bound-delivery-revisions.md) · [源码与原始证据]({base}quality/delivery-revision-checkpoint-138.json) · [全部编号]({base}quality/remaining-work-stage138.md)'
links_en = f'[Requirements]({base}requirements/15-delivery-revisions.md) · [Architecture and usage]({base}technical/138-source-bound-delivery-revisions.md) · [Exact source and evidence]({base}quality/delivery-revision-checkpoint-138.json) · [All original identities]({base}quality/remaining-work-stage138.md)'
specific = {
    'platform': ('API新增固定来源核对、预览及幂等修改受理，修改任务复用现有Worker；新增SQL136保护来源绑定不可改写。先备份并运行匹配代码的迁移，再启动API与Worker；不要使用旧API连接新schema。完整API字段及升级顺序见方案。', 'The API adds fixed-source context, previews and idempotent revision admission; revisions reuse the existing Worker. New SQL136 protects immutable source bindings. Back up and apply the matching forward migration before starting the API and Worker; an older API rejects the newer schema. See the architecture for exact input fields and upgrade order.'),
    'web': ('从原聊天或任务审阅点击“以这份成果继续修改”，选择原成果及位置，填写要求和预算并确认。新成果回到原会话，可下载新的完整交付包。结果未知时重试原要求，先核对已有工作再重新选择。', 'Choose Request changes to this delivery in the original chat or task review, select the output and location, describe the changes and confirm a budget. Revised results return to the original conversation and have their own complete delivery package. Retry the original request after an unknown outcome; check existing work before reselecting.'),
    'admin': ('新修改作为独立用户任务进入既有任务、消耗和审计体系，保留父任务和固定来源；预算预留及费用仍由原钱包及计划控制。管理员沿用精细权限和私有内容访问流程，不能通过修改入口替用户取得本机权限。运营界面及用户／费用／VIP管理的既有说明保留在后文。', 'Revisions enter the existing task, usage and audit system as separate customer tasks with parent and source identities. The same wallet, plan and project limits control spending. Admins retain granular permissions and private-content access procedures; this endpoint cannot grant local OS permission for a customer. Existing dashboard, users, fees and VIP management guidance follows below.'),
    'desktop': ('原本机会话完成工作后，展开交付审阅并提出修改。新工作使用当前有效本机权限、原目录和原Codex线程，由客户本机Codex执行；授权可撤销。修改受理记录跨重启保存。无边框、无Electron菜单及无可见滚动轨要求保留，禁止云端Agent替代本机执行。', 'After local work completes, open its delivery review and request changes. The new work uses the current local grant, original folder and exact Codex thread, and executes Codex on the customer computer. Grants are revocable and revision dispatch records survive restart. Frameless presentation, no Electron menu and no visible scrolling rails are retained. A cloud Agent never substitutes for local execution.'),
    'extension': ('扩展仍以原生浏览器右侧栏打开；原聊天的修改入口在侧栏内显示表单。文件读取／上传职责保留，修改Agent运行云端。表单及回执按当前用户／企业／项目隔离，切换工作区关闭失效表单；新成果回到原聊天并由Chrome下载管理器保存。', 'The extension still opens Chrome’s native right side panel. Its original-chat action opens a revision form inside the panel. File approval/upload remains in the extension and the revision Agent runs in the cloud. Form state and receipts are scoped to the current user, tenant and project; workspace changes close stale forms. Revised results return to the original chat and use Chrome’s download manager.'),
    'delivery': ('执行`npm run qa:delivery-revision-backend -- <新两位编号>`验证原生数据库及相关回归，执行`npm run qa:delivery-revision -- <新两位编号>`完整构建并操作实际三端。需要本机Node、原生PostgreSQL运行库、Chrome、FFmpeg及已锁定的本机Codex。每次尝试单独保留，不改写原失败；不调度Docker或WSL。', 'Run `npm run qa:delivery-revision-backend -- <new two-digit attempt>` for the native-database regressions, or `npm run qa:delivery-revision -- <new two-digit attempt>` for complete builds and actual client journeys. Native Node/PostgreSQL runtimes, Chrome, FFmpeg and the pinned local Codex are required. Every attempt is retained separately, including failures. Docker and WSL are not used.'),
    'docs': ('所有开发位于D盘的唯一工作区，实际代码位于dev，各端独立Git仓库；本目录为权威需求、设计、开发、编号验收和发布说明。完整功能状态以本阶段编号清单为准，不用定向流程测试替代全部原始验收。', 'Development stays in the single D-drive workspace, with product code under dev and independent client repositories. This directory retains authoritative requirements, design, development, numbered acceptance and release guidance. The current numbered ledger preserves every original acceptance scope; targeted workflow checks do not replace full acceptance.'),
}
diagram = '''```mermaid
flowchart LR
  A[Original delivery] --> B[Select exact source and anchor]
  B --> C[Confirm changes and new budget]
  C --> D{Original execution location}
  D --> E[Cloud Codex: Web and Extension]
  D --> F[Local Codex: Desktop]
  E --> G[New delivery, original retained]
  F --> G
  G --> H[Original conversation and new ZIP]
```

'''
guides = [(ROOT / 'dev' / ('copypaste-' + component) / name, component) for component in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery'] for name in ['README.md', 'README.en.md']]
guides += [(ROOT / 'docs' / name, 'docs') for name in ['README.md', 'README.en.md']]
archive = ROOT / 'docs/quality/history/stage138-guides-before'
assert not archive.exists()
for file, component in guides:
    raw = file.read_bytes(); saved = archive / component / file.name; saved.parent.mkdir(parents=True, exist_ok=True); saved.write_bytes(raw)
    text = raw.decode('utf-8'); assert '<!-- delivery-revision-stage138 -->' not in text
    english = file.name == 'README.en.md'
    section = '<!-- delivery-revision-stage138 -->\n## ' + ('Source-bound revisions and new delivery · Stage138' if english else '原成果修改与新版本交付 · 阶段138') + '\n\n'
    section += (specific[component][1 if english else 0]) + '\n\n'
    section += ('Choose a complete delivery, answer, file, Unicode text quote, image region or verified video interval. Previewing does not call AI or reserve money. Confirming a revision creates a separate budgeted task with the fixed original role and source; original files and charges remain. Changed or withdrawn sources fence later reads and completion. Shared project editors may revise authorized shared work; private conversations retain their original owner. Unknown-outcome retries retain their original immutable request.\n\n' if english else '可选择整份交付、答复、单文件、Unicode文字选段、图片区域或有效视频时段。预览不调用AI或预留费用；确认后建立单独预算的新任务，沿用原角色与来源，保留原成果及费用。源文件换版或撤回将阻断后续读取与完成交付。获准项目编辑可修改共享工作，私有会话保留原归属。结果未知时继续核对原请求。\n\n')
    section += ('Text previews are limited to 1 MiB and inline image/MP4 previews to 4 MiB. Larger or unsupported previews can still be downloaded and revised as complete files. Complete-delivery references allow at most 20 files; video intervals require retained valid duration. Image/video anchors identify requested locations and do not approve an editing operation or prove professional output quality. Specialist workflows retain their own approvals.\n\n' if english else '文字预览上限1 MiB，图片／MP4内嵌预览4 MiB；更大或不支持预览的文件可下载后按完整文件提出修改。整份修改最多引用20个文件，视频时段须有保留的有效时长。图片／视频位置是修改意见，不能视为编辑操作审批或专业质量通过；专门工作流保留原确认步骤。\n\n')
    section += (validation_en if english else validation) + '\n\n'
    section += ('Business/model responses and native dialog selections are explicitly controlled fixtures. Login, database permissions, exact files, actual packaged local Codex, native Windows surfaces, Chrome SIDE_PANEL and revised ZIP downloads run for real. The Windows package is unsigned. Real company models/accounts, full professional-role output quality, installation matrices and complete project recovery remain separately open.\n\n' if english else '业务／模型答复及原生文件／授权窗口选择为明确受控的假数据；登录、数据库权限、确切文件、实际打包本机Codex、Windows原生窗口、Chrome右侧栏和新成果下载实际运行。Windows包未签名。真实公司模型／账户、完整专业角色输出、安装矩阵和工程恢复继续独立验收。\n\n')
    section += diagram + (links_en if english else links) + '\n\n'
    media_component = component if component in ['web', 'desktop', 'extension'] else 'web'
    chosen = [m for m in cp['media_files'] if m['path'].startswith('copypaste-' + media_component + '/') and (m['path'].endswith('selected-text-en.png') or m['path'].endswith('local-revision-en.png') or m['path'].endswith('.gif'))]
    section += ('Actual product interaction, with synthetic business content:\n\n' if english else '实际产品操作，业务内容为假数据：\n\n')
    for item in chosen:
        rel = item['path'].split('/', 1)[1]
        label = ('Actual client revision' if media_component == component else 'Customer Web revision for operating context') if english else ('本端实际修改流程' if media_component == component else '客户Web修改流程，供运营理解')
        section += f'![{label}](https://github.com/copypasteltd/workmate/blob/{media_component}/{rel})\n\n'
    more = [m for m in cp['media_files'] if m['path'].startswith('copypaste-' + media_component + '/') and m not in chosen]
    if more:
        section += ('Additional actual screenshots and MP4 recording:\n\n' if english else '其他实际页面截图及MP4录屏：\n\n')
        for item in more:
            rel = item['path'].split('/', 1)[1]
            section += f"- [{Path(rel).name}](https://github.com/copypasteltd/workmate/blob/{media_component}/{rel})\n"
        section += '\n'
    first, _, rest = text.partition('\n'); file.write_text(first + '\n\n' + section + rest.lstrip('\n'), encoding='utf-8', newline='\n')
print(json.dumps({'stage': 138, 'original_identities': 102, 'required_open': 88, 'guides_updated': len(guides), 'counts': c}))
