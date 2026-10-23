"""Update bilingual delivery docs from the selected real Desktop captures."""
from datetime import datetime,timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
checkpoint_path=ROOT/'docs/quality/desktop-browser-checkpoint.json'
checkpoint=json.loads(checkpoint_path.read_text(encoding='utf-8'))
assert checkpoint['status']=='verified_bounded_native_browser_and_desktop_layout'
ui=checkpoint['selected']['ui']
total=checkpoint['platform_tests']['tests']
base='https://github.com/copypasteltd/workmate/blob/docs/docs/'
design=base+'technical/77-desktop-native-browser.md'
proof=base+'quality/desktop-browser-checkpoint.json'
ux=base+'requirements/04-desktop-layout-and-scroll.md'
changes=base+'changes/2026-10-23-desktop-native-browser.md'
archive=ROOT/'docs/quality/history/before-stage77-docs'
assert not archive.exists(),'Preserve the existing documentation checkpoint'
planned=[]

def update(file,edit):
    before=file.read_bytes()
    after=edit(before.decode('utf-8')).encode('utf-8')
    if before!=after:
        planned.append((file,before,after))

zh=f'**当前实现：** Desktop 在客户本机运行 Codex，提供客户明确完整授权、本机文件/终端、同线程继续、原生追问、公司设计/视频工具与本机父子流程。新增十二项本机浏览器工具，可真实导航、操作、上传、截图和下载；停止/撤权回收任务页面。Desktop 隐藏可见滚动条，成果、代码和表格自动换行，保留纵向滚动与键盘访问；已撤销此前进度条约束，保留真实进度反馈。当前分别验证平台 {total} 项、客户端 68 项、原生内核 17 项、独立 Electron 浏览器 10 项和实际打包旅程 25 项，不相加。18 角色/29 Skill 的完整专业交付、全部 OS 应用与 Codex Desktop 全面能力对齐、真实模型及生产验收仍待证明。Extension 继续独立的 ChatGPT 式原生右侧栏、获准文件上传与云端 Codex，本轮未重跑其 UI。见 [方案]({design})、[界面约束]({ux})及 [源码/媒体检查点]({proof})。'
en=f'**Current implementation:** Desktop runs Codex on the customer device with explicit full access, local files/terminal, persistent threads, native questions, company design/video tools and native workflow children. Twelve local browser tools now perform actual navigation, interaction, upload, screenshots and downloads; Stop/revoke reclaim owned pages. Desktop hides scrollbar rails and reflows artifacts, code and tables while preserving vertical scrolling and keyboard access. The previous progress-bar constraint is withdrawn; truthful progress feedback remains. Separate qualification covers {total} platform, 68 client, 17 native-supervisor, 10 standalone Electron-browser and 25 packaged-journey checks; counts are not additive. Full professional delivery across 18 roles/29 Skills, complete OS-application/Codex Desktop parity, live models and production remain pending. Extension retains independent ChatGPT-style native right Side Panel cloud chat and authorized-file upload; its UI was not rerun. See [design]({design}), [layout requirements]({ux}) and [source/media checkpoint]({proof}).'

readmes=[]
for component in ['docs','platform','web','admin','desktop','extension','delivery']:
    repo=ROOT/'docs' if component=='docs' else DEV/('copypaste-'+component)
    for name in ['README.md','README.en.md']:
        english=name.endswith('.en.md')
        file=repo/name
        readmes.append(file)
        def edit(text,component=component,english=english):
            assert '<!-- desktop-native-browser-stage77 -->' not in text
            text,n=re.subn(r'^\*\*(?:当前实现：|Current implementation:)\*\*.*$',en if english else zh,text,count=1,flags=re.M)
            assert n==1,file
            marker='<!-- desktop-native-workflow-stage76 -->'
            assert text.count(marker)==1
            before,history=text.split(marker)
            history=history.replace('当前平台完整清单为','阶段 76 当时的平台清单为').replace('Current platform inventory:','Historical stage-76 inventory:')
            prefix='assets/screenshots/' if component=='desktop' else 'design/implementation/' if component=='docs' else 'https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/'
            heading='Native browser and scrollbar-free Desktop' if english else '本机浏览器与 Desktop 界面'
            details=('Start a new local session, select a folder and explicitly grant Full local access. Ask the local Codex to work in a browser. The trusted frameless address bar and remote page run in separate customer-device renderers. The tool namespace `copypaste_browser` v1 includes tabs/open/navigate/history/snapshot/screenshot/interact/evaluate/wait/dialog/downloads/close; interact supports real click, fill/type/select, keys, scroll/drag and exact local-file upload. Completed downloads remain in the selected workspace’s browser-downloads directory. Model screenshots capture the actual page; README browser media uses actual OS window capture, with no compositing.\n\nCurrent local permission, company identity, project access, origin and budget are rechecked. Web content cannot grant OS access or acquire company inference credentials. Call IDs bind exact operations; unknown accepted actions never replay automatically. Stop, revoke, sign-out or exit close owned pages and pending downloads, preserving completed files and the customer’s original windows. Existing threads retain their original tool binding; create a new session for browser tools.\n\nThe previous progress-bar constraint is withdrawn. Truthful upload/task/workflow/video feedback remains. Hidden scrollbar rails do not disable native scrolling. Artifacts wrap into rows, code and tables reflow, scroll areas have keyboard focus, and the composer/receipt remain usable in actual 800×600, 1280×800 and 1440×980 windows. Real wheel/Home/End and last-download focus are verified, alongside compact billing/devices/account pages and English/Traditional Chinese light/dark controls. Physical touchpad hardware and every display-scaling configuration are not claimed by these automated checks.\n\n' if english else
                '新建本机会话，选择工作目录并明确授予「完整本机权限」，再描述浏览器工作。本机 Codex 使用版本化 `copypaste_browser` 命名空间的十二项工具：页面列表、打开、导航、历史、快照、截图、交互、隔离脚本、等待、对话框、下载及关闭。交互包含真实点击、填写/输入/选择、按键、滚动/拖动及明确本机文件上传。可信无边框地址栏与远程网页使用独立渲染器。完成的下载保留在所选目录的 browser-downloads；模型截图直接捕获真实网页，README 浏览器录制使用真实 OS 窗口捕获，不拼接页面。\n\n当前本机授权、公司身份、项目权限、调用归属和预算逐次核验；网页不能授予 OS 权限或取得公司推理凭据。调用 ID 绑定具体操作，结果未知不自动重放。Stop、撤权、登出和退出关闭任务页面及未完成下载，保留已完成文件和客户原有窗口。旧线程保留原工具绑定；使用浏览器工具须新建会话。\n\n此前进度条约束已撤销；真实上传、任务、流程和视频反馈继续显示。隐藏滚动条外观不禁用原生滚动。成果换行、代码与表格重排，重点滚动区可聚焦；800×600、1280×800、1440×980 实际窗口保留输入与费用操作。检查包含真实滚轮、Home/End、最后一个下载按钮焦点，及紧凑费用/设备/账户页面和英文/繁中浅深主题；自动化未宣称实测物理触控板或每种系统缩放。\n\n')
            details+=(f'Current complete inventory: 66 test files / 17 batches / {total} passing cases, retaining all 848 prior cases. SQL001–094 and all 428 HTTP routes remain unchanged. The isolated UI fixture alone allocates 32 user/platform/tenant slots and appends immutable provider-policy version 2 with 32 slots and 10,000 requests/minute, retaining intentional unknown cancellation holds. Bootstrap policy and production defaults/enforcement remain unchanged. Synthetic Responses, campaign content and native-dialog choices are explicit. Original 102 REQ/102 TC, NFR and G01–G10 remain at 81 partial / 21 unproven / 0 fully accepted. Extension product/verifier bytes are unchanged; no new Extension UI claim.\n\n' if english else
                f'当前完整清单为 66 个测试文件 / 17 批 / {total} 项通过，保留此前全部 848 项。SQL001–094 和 428 条 HTTP 接口均未变。仅 UI 自有夹具的用户/平台/企业容量配置为 32，并新增不可变网关策略版本 2（32 槽位、每分钟 10,000 请求），以保留多次取消后的未知结果和费用预留；初始策略、生产默认及容量控制不变。模型响应、业务页面与系统对话框决定明确模拟。原 102 REQ/102 TC、NFR 和 G01–G10 仍为 81 部分 / 21 未证明 / 0 完整验收。Extension 产品和验证器字节未变，本轮没有新增其 UI 结论。\n\n')
            if component=='delivery':
                details+=('Run `node scripts/run-desktop-browser-checks.mjs NN` for the real standalone browser. Set the pinned absolute `COPYPASTE_LOCAL_CODEX_TEST_BIN` for `node scripts/run-local-codex-checks.mjs NN` and the resumable full platform verifier (`--init`, one `--next` per batch, then `--finish`). Set `COPYPASTE_LOCAL_CODEX_BIN` for `node scripts/run-desktop-local-ui.mjs NN`. Use a fresh two-digit attempt, run database/visual owners sequentially, and keep covered sources frozen. Only UUID-owned test resources are reclaimed; no Docker/WSL.\n\n' if english else '独立浏览器使用 `node scripts/run-desktop-browser-checks.mjs NN`。设置绝对路径 `COPYPASTE_LOCAL_CODEX_TEST_BIN` 后运行内核 `node scripts/run-local-codex-checks.mjs NN`，完整平台回归沿用可恢复验证器（`--init`、逐批 `--next`、`--finish`）。打包旅程使用相同固定二进制的 `COPYPASTE_LOCAL_CODEX_BIN` 与 `node scripts/run-desktop-local-ui.mjs NN`。每次使用新两位编号，数据库/视觉拥有者顺序执行，期间冻结覆盖源码；仅回收自有 UUID 资源，禁止 Docker/WSL。\n\n')
            diagram='```mermaid\nflowchart LR\n    Customer --> Permission[Explicit local permission]\n    Permission --> Native[Customer-device Codex]\n    Native --> Gateway[Company identity, budget and AI gateway]\n    Native --> Browser[Owned local browser and real websites]\n    Browser --> Files[Actual uploads, screenshots and downloads]\n    Stop[Stop, revoke, sign-out, exit] --> Cleanup[Close task-owned pages]\n    Extension[Native Chrome right Side Panel and selected files] --> Cloud[Company cloud Codex]\n```\n\n'
            gallery=f"![{'Actual compact Desktop' if english else '实际紧凑 Desktop'}]({prefix}workmate-local-{ui}-layout-800-en.png)\n\n![{'Actual local browser' if english else '实际本机浏览器'}]({prefix}workmate-local-{ui}-browser-saved-en.png)\n\n"
            if component in ['desktop','docs']:
                gallery+=f"![{'Actual native interaction' if english else '实际本机交互'}]({prefix}workmate-local-{ui}-local-agent.gif)\n\n[MP4]({prefix}workmate-local-{ui}-local-agent.mp4) · [Browser GIF]({prefix}workmate-local-{ui}-native-browser.gif) · [Browser MP4]({prefix}workmate-local-{ui}-native-browser.mp4) · [繁中深色]({prefix}workmate-local-{ui}-layout-compact-zh-dark.png)\n\n"
            section='<!-- desktop-native-browser-stage77 -->\n\n## '+heading+'\n\n'+details+diagram+gallery+f'[Design]({design}) · [Requirements]({ux}) · [Evidence]({proof}) · [Changes]({changes})\n\n'
            summary='Stage 76 historical implementation and captures (previous scrollbar layout)' if english else '阶段 76 历史实现与截图（旧滚动条布局）'
            return before+section+'<details>\n<summary>'+summary+'</summary>\n\n'+marker+history+'\n</details>\n'
        update(file,edit)

normative=['00-document-map.md','DELIVERY.md','technical/01-architecture-and-stack.md','technical/05-local-executor-and-browser.md','technical/08-development-and-delivery.md','technical/12-implementation-and-repositories.md','technical/69-desktop-local-codex-and-extension-direction.md','technical/70-desktop-native-codex-supervisor.md','technical/72-desktop-local-execution-and-control-plane.md','technical/73-desktop-native-company-tools.md','technical/74-desktop-native-user-input.md','technical/75-desktop-private-video.md','technical/76-desktop-native-workflows.md','requirements/03-client-execution-amendment.md','product/03-information-architecture-and-interactions.md','modules/07-web-extension-desktop.md','quality/02-requirements-traceability.md','quality/09-implementation-alignment-audit.md']
for name in normative:
    file=ROOT/'docs'/name
    link=os.path.relpath(ROOT/'docs/technical/77-desktop-native-browser.md',file.parent).replace('\\','/')
    note=f'**阶段 77 当前增量：** Desktop 新会话接入十二项客户本机浏览器工具，真实操作/上传/截图/下载经本机 Codex 与公司网关；Stop/撤权回收页面。Desktop 取消旧进度条约束，保留真实进度，隐藏滚动条并重排成果/代码/表格，验证三种实际窗口、滚轮/键盘及双语浅深主题。平台 {total}、客户端 68、内核 17、独立浏览器 10、打包旅程 25 项分别通过；SQL001–094、428 条接口、102 REQ/102 TC 与 81/21/0 保留。Extension 仍为原生右侧栏获准文件上传与云端 Codex，无新 UI 计数。见 [当前方案与限定证据]({link})。'
    update(file,lambda text,note=note:text.split('\n',1)[0]+'\n\n'+note+'\n'+text.split('\n',1)[1].replace('**阶段 76 当前增量：**','**阶段 76 历史基线：**'))

def progress(text):
    value=json.loads(text)
    value['desktop_native_browser_and_layout_repair']={'stage':77,'checkpoint':'desktop-browser-checkpoint.json','status':checkpoint['status'],'platform_tests':total,'client_tests':68,'native_supervisor_tests':17,'native_browser_checks':10,'packaged_ui_checks':25,'progress_bar_constraint':'withdrawn','scrollbar_requirement':'DESK-UI01','full_professional_acceptance':'pending'}
    value['current_source_qualification']={'stage':77,'checkpoint':'desktop-browser-checkpoint.json','note':'Bounded native browser and Desktop layout subset. Original acceptance unchanged; exact source and explicit fixtures recorded.'}
    return json.dumps(value,ensure_ascii=False,indent=2)+'\n'
update(ROOT/'docs/quality/requirements-alignment-progress.json',progress)
update(ROOT/'docs/technical/77-desktop-native-browser.md',lambda text:text.replace('状态：实现与核查中，不构成浏览器或完整 OS 操作验收。',f'状态：已验证有界本机浏览器与 Desktop 布局子集，不构成全部网站、全部 OS 应用或完整产品验收。平台 {total} 项、客户端 68 项、内核 17 项、独立浏览器 10 项、实际打包旅程 25 项分别通过。权威源码与实际媒体见 [检查点](../quality/desktop-browser-checkpoint.json)。').replace('Implementation and verification are in progress.','The bounded native-browser/layout subset is verified with explicit synthetic model, campaign and native-dialog fixtures.').replace('## 功能与界面计划','## 功能与界面').replace('## 验证计划','## 验证范围'))
update(ROOT/'docs/changes/2026-10-23-desktop-native-browser.md',lambda text:text.replace('状态：实现与最终源码核查中；尚未发布本增量。阶段 76 为此前已发布范围。',f'状态：有界浏览器与布局子集已通过最终源码核查。平台 {total}/{total}、客户端 68/68、内核 17/17、独立浏览器 10/10、实际打包旅程 25/25；各范围不相加。阶段 76 保留为历史证据。').replace('Implementation and final source qualification are in progress.',f'The bounded native-browser/layout subset passed final source qualification: {total}/{total} platform cases, 68/68 client units, 17/17 native-supervisor cases, 10/10 standalone-browser checks and 25/25 packaged-journey checks. These separate scopes are not additive. The UI fixture alone appends immutable provider-policy version 2 and allocates 32 user/platform/tenant/provider slots with 10,000 requests/minute; bootstrap policy and production capacity defaults/enforcement remain unchanged.').replace('失败记录保留其原始结果，','裸浏览器 01–13、打包 22–27 的失败记录保留；22 为验证器按钮名称错误，23 为测试转译辅助函数缺失，24/25 为自有测试企业容量限制，26 为保留取消后未知费用预留所触发的网关限额，27 暴露工作区导航遗漏焦点标记，修正实际导航后重新验证。未伪造结算或删除费用预留。最终仅在隔离 UI 数据库配置 32 个用户/平台/企业槽位并新增不可变网关策略版本 2（32 槽位、每分钟 10,000 请求），初始策略、生产默认及限制测试不变。早期浏览器 11 的错误弹窗由精确归属检查后回收其 Electron 子进程，不能写成正常退出。未选用媒体逐字节移至本地忽略归档，并有重定位摘要。失败记录保留其原始结果，'))

archive.mkdir()
manifest=[]
for file,before,after in planned:
    saved=archive/(file.relative_to(ROOT).as_posix().replace('/','__')+'.txt')
    saved.write_bytes(before)
    file.write_bytes(after)
    manifest.append({'path':file.relative_to(ROOT).as_posix(),'archive':saved.relative_to(ROOT).as_posix(),'before_sha256':sha256(before).hexdigest(),'after_sha256':sha256(after).hexdigest()})
(archive/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
media=checkpoint['screenshots']+checkpoint['media']['files']+checkpoint['native_browser_media']['files']
for item in media:
    source=DEV/item['path']
    assert sha256(source.read_bytes()).hexdigest()==item['sha256']
    target=ROOT/'docs/design/implementation'/source.name
    assert not target.exists()
    shutil.copyfile(source,target)
    checkpoint['documentation_media'].append({'source':source.relative_to(ROOT).as_posix(),'path':target.relative_to(ROOT).as_posix(),'sha256':item['sha256']})
checkpoint_path.write_text(json.dumps(checkpoint,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'readmes':len(readmes),'documents':len(planned),'actual_media':len(media)}))
