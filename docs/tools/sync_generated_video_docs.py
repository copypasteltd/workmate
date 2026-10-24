"""Update bilingual usage, real captures and original requirement progress."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
CHECKPOINT = ROOT / 'docs/quality/generated-video-checkpoint.json'
ARCHIVE = ROOT / 'docs/quality/history/before-stage80-docs'
MANIFEST = ROOT / 'docs/quality/generated-video-documentation-refresh.json'


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def quickstart(component, english):
    name = 'delivery' if component == 'root' else component
    folder = (DEV / ('copypaste-' + name)).as_posix()
    layout = 'governance/04-git-branches-and-publication.md' if component == 'root' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/governance/04-git-branches-and-publication.md'
    lead = ('Run these commands in the checked-out component. The complete workspace has the six independent repositories side by side under `dev/`; see the [branch and checkout layout](' + layout + '). Use Windows x64, Node.js >=22.14, npm/Git and the documented native PostgreSQL, FFmpeg/FFprobe and pinned Codex resources. Preserve existing local configuration/data. No Docker/WSL/VM is used.' if english else
            '以下命令在已检出的对应仓库内执行。完整工作区将六个独立仓库并列放在 `dev/`，见[分支与检出布局](' + layout + ')。使用 Windows x64、Node.js >=22.14、npm/Git，以及文档约束的原生 PostgreSQL、FFmpeg/FFprobe 与固定 Codex 资源；保留已有本地配置和数据，不使用 Docker/WSL/虚拟机。')
    commands = ['Set-Location ' + "'" + folder + "'", 'npm ci']
    if name == 'platform':
        commands += ['npm run setup:local', 'npm run db:local']
        tail = ('Keep that database terminal open. In a second terminal in the same repository, run `npm run db:migrate` and then `npm run dev`. API: `http://localhost:4310`. SQL097 must be applied before upgrading clients. Create/enrol an administrator with the existing `admin:create` runbook and current MFA; no shared default Admin credentials are supplied.' if english else
                '保持数据库终端开启，在同一仓库的第二个终端运行 `npm run db:migrate`，再运行 `npm run dev`。API 为 `http://localhost:4310`。升级客户端前应用 SQL097。后台管理员按现有 `admin:create` 流程创建并登记 MFA，不提供共用默认后台账号。')
    elif name in ['web', 'admin']:
        commands += ['npm run dev']
        port = 4317 if name == 'web' else 4318
        tail = (f'Start the backend first, then open `http://localhost:{port}`. Use `npm run build` for the static build. ' + ('Sign in with email/OTP and select a workspace/project.' if name == 'web' else 'Use a separately enrolled Admin account with MFA and assigned permissions.') if english else
                f'先启动后端，再打开 `http://localhost:{port}`；静态构建使用 `npm run build`。' + ('通过邮箱/验证码登录并选择企业/项目。' if name == 'web' else '使用独立登记、具备 MFA 及对应权限的 Admin 账号。'))
    elif name == 'desktop':
        commands += ["$env:COPYPASTE_LOCAL_CODEX_BIN = 'D:/approved-runtime/codex.exe'", 'npm run runtime:prepare', 'npm run build', 'npm start']
        tail = ('Start the backend first. The binary path is an example: supply the exact approved binary and adjacent helpers matching `contracts/local-codex-runtime.json`. Configure company origins in `deployment.json`. `npm run package:dir` builds an unpacked candidate; `npm run package` builds the installers. Current evidence covers an unsigned unpacked candidate; signing and human install/upgrade/uninstall remain open. The renderer builds independently; preserve its native overlays.' if english else
                '先启动后端。上述内核路径是示例，需提供符合 `contracts/local-codex-runtime.json` 的固定二进制及相邻辅助资源；公司地址配置在 `deployment.json`。`npm run package:dir` 构建解包候选，`npm run package` 构建安装包。当前证据覆盖未签名解包候选，签名及人工安装/升级/卸载验收仍保留。渲染器可独立构建，须保留本机覆盖层。')
    elif name == 'extension':
        commands += ['npm run build']
        tail = ('Start the backend and Web first. In Chrome 120+, open `chrome://extensions`, enable Developer mode and load this repository\'s `dist/` as an unpacked extension. Pin/click its icon to open the native right Side Panel. Keep the built Extension ID aligned with backend authorization; configure company HTTPS origins through `COPYPASTE_API_ORIGIN`/`COPYPASTE_WEB_ORIGIN` before production builds. Sign in, select a workspace/project and attach authorized files. Desktop installation is unnecessary.' if english else
                '先启动后端和 Web。在 Chrome 120+ 打开 `chrome://extensions`，启用开发者模式并加载本仓库 `dist/`，固定并点击图标后打开原生右侧栏。构建的 Extension ID 须与后端授权登记一致；生产构建前通过 `COPYPASTE_API_ORIGIN`/`COPYPASTE_WEB_ORIGIN` 配置公司 HTTPS 地址。登录后选择企业/项目并附加获准文件，无需安装 Desktop。')
    else:
        commands += ['npm run bootstrap', 'npm run demo']
        tail = ('Open Web `http://localhost:4317` and Admin `http://localhost:4318`; API is `4310`, controller `4319`, native PostgreSQL `55432`. Stop with `npm run stop`, which closes only controller-owned processes and checkpoints its database. The built-in demo simulates text/images and supports editing/template video; generated video requires the configured company contract. Current generation acceptance uses an explicit media fixture. Local Desktop additionally requires its independently pinned native runtime.' if english else
                'Web 为 `http://localhost:4317`，Admin 为 `http://localhost:4318`；API 端口 4310、控制器 4319、原生 PostgreSQL 55432。结束时使用 `npm run stop`，仅关闭控制器自建进程并正常停止数据库。内置示范模拟文本/图片并可使用剪辑/模板影片；生成式影片须配置公司契约，当前生成验收使用明确的媒体夹具。本机 Desktop 另需独立固定的原生内核。')
    return ('### Local startup\n\n' if english else '### 本地启动\n\n') + lead + '\n\n```powershell\n' + '\n'.join(commands) + '\n```\n\n' + tail + ('\n\n### Use the current workflow' if english else '\n\n### 当前使用流程')


def main():
    proof = json.loads(CHECKPOINT.read_text(encoding='utf-8'))
    assert proof['status'] == 'verified_generated_video_subflow' and not MANIFEST.exists()
    records = []

    def save(file, text):
        archive = ARCHIVE / file.relative_to(ROOT)
        assert not archive.exists(), str(archive)
        archive.parent.mkdir(parents=True, exist_ok=True)
        previous = file.read_bytes()
        archive.write_bytes(previous)
        file.write_text(text, encoding='utf-8', newline='\n')
        records.append({'path': file.relative_to(ROOT).as_posix(), 'archive': archive.relative_to(ROOT).as_posix(),
                        'before_sha256': sha256(previous).hexdigest(), 'after_sha256': digest(file)})

    counts = proof['platform_tests']['pass']
    roles = {
        'root': ('主文档组织完整需求、三端使用与独立后台和后端。', 'The primary documentation covers the complete requirements, three customer clients and independent backend/Admin.'),
        'platform': ('后端新增持久生成式影片作业、统一任务预算、原 operation 查询/取消、认证回调及真实 MP4 校验。', 'The backend adds durable generated-video jobs, shared task budgets, original-operation queries/cancellation, authenticated observations and actual MP4 validation.'),
        'web': ('在影片专家的新任务中选择生成方式，直接查看真实进度、费用、播放及下载。', 'Select generation in a new video-specialist task, then review reported progress, costs, playback and downloads.'),
        'admin': ('后台按独立权限和企业/项目范围查看影片作业、费用并重查原作业；对账沿用独立审核与审计。', 'Admin separately scopes job metadata, costs and original-job rechecks by workspace/project; settlement retains independent review and audit.'),
        'desktop': ('Desktop 在客户本机运行 Codex；影片设置默认收起，展开为紧凑面板，完整本机授权由客户主动授予并可撤销。', 'Desktop runs Codex on the customer device. Video settings start collapsed and expand into a compact panel; customers explicitly grant and can revoke full local permission.'),
        'extension': ('Chrome 原生右侧栏独立提供 ChatGPT 式聊天、获准文件读取上传和云端影片的状态、播放及保存。', 'The independent native Chrome right Side Panel provides ChatGPT-style chat, authorized file read/upload and cloud-video status, playback and save.'),
        'delivery': ('交付工具执行独立原生数据库、真实客户端交互和完整文件清单的可恢复测试，保留失败及中断证据。', 'Delivery runs isolated native databases, actual client interactions and resumable tests across the complete test-file inventory, preserving failed/interrupted evidence.'),
    }
    doc_base = 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
    for component, intro in roles.items():
        repo = ROOT if component == 'root' else DEV / ('copypaste-' + component)
        actual = 'desktop' if component in ['root', 'delivery'] else 'web' if component == 'platform' else component
        candidates = [item for item in proof['screenshots'] if item['path'].startswith('copypaste-' + actual + '/')]
        preferred = {'desktop': 'generated-form-1440-en', 'web': 'playback-en', 'admin': 'cost-rechecked-en', 'extension': 'generated-video'}[actual]
        shot = next((item for item in candidates if preferred in item['path']), candidates[0])
        recording = next(item for item in proof['recordings'] if item['component'] == actual and (actual != 'desktop' or item['name'] == 'local-agent'))
        media = [shot, next(item for item in recording['files'] if item['path'].endswith('.gif')), next(item for item in recording['files'] if item['path'].endswith('.mp4'))]
        links = []
        for item in media:
            source = DEV / item['path']
            assert digest(source) == item['sha256']
            if component == 'root':
                target = ROOT / 'docs/design/implementation' / (Path(item['path']).parts[0] + '__' + source.name)
                assert digest(target) == item['sha256']
            elif component in ['platform', 'delivery']:
                target = repo / 'assets/screenshots' / ('stage80-' + actual + '-' + source.name)
                assert not target.exists()
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
            else:
                target = source
            links.append(target.relative_to(ROOT / 'docs' if component == 'root' else repo).as_posix())
        for english in [False, True]:
            file = (ROOT / 'docs' if component == 'root' else repo) / ('README.en.md' if english else 'README.md')
            title, old = file.read_text(encoding='utf-8').split('\n', 1)
            assert '<!-- generated-video-stage80 -->' not in old
            design = ('technical/80-generated-video-jobs.md' if component == 'root' else doc_base + 'technical/80-generated-video-jobs.md')
            checkpoint = ('quality/generated-video-checkpoint.json' if component == 'root' else doc_base + 'quality/generated-video-checkpoint.json')
            contract = ('contracts/generated-video-openapi.json' if component == 'root' else 'contracts/generated-video-openapi.json' if component == 'platform' else doc_base + 'contracts/generated-video-openapi.json')
            if english:
                body = f'''{intro[1]}

{quickstart(component, True)}

1. Sign in using the existing email/OTP flow, select a workspace/project and start a **Video and motion** task. New tasks use the versioned R16 1.2.0 role and its `video-generation` Skill. Frozen older tasks retain their original role/Skill; start a new task to use generation.
2. In Web or Desktop select **Generate a video**, a supported duration (4/8/12/16/20 seconds) and format (landscape, portrait or square), then supply the brief and confirm the task budget. Template/FFmpeg composition remains a separate option. Desktop settings start collapsed so the conversation and composer retain space. In Extension, open the existing cloud video task from the same workspace/project's task history to review its status, play it and save the result.
3. Codex uses the company's internal service. The server persists an immutable original operation and a quote before HTTP, sharing the same budget with reasoning/image requests. Input counting, reasoning, image and video also share admission limits; completed calls retain their rolling-minute rate charge after concurrency slots release. Independently reviewed termination facts affect slot usage while preserving the original requests. Only service-reported progress is shown. Pending or unknown usage retains the original hold; missing usage is never free.
4. **Stop this generation** requests cancellation of that same operation. A later confirmed usage observation can still report a charge. Retries/recovery query the original operation and do not submit another generation. A real state change rejects a stale control revision; leases and unchanged polls do not invalidate it.
5. A completed status becomes a deliverable only after real SHA/size, format, dimensions, duration and full native decode checks. Play and save the actual MP4. Withdrawal, source quarantine or lost authority removes the current preview/download; no fabricated success file is supplied. Inline preview is bounded to 20 MB.
6. Admin opens **Provider controls → Generated video jobs**. Metadata, cost reads and original-job rechecks require separate scoped permissions; recheck requires current MFA and an audited reason. It cannot create a replacement video or grant access to the prompt/reference/media. Original task settlement retains independent approval and immutable provider facts.

Apply the additive **SQL097** with backend `npm run db:migrate` before upgrading clients. Existing SQL001–096 and each original OpenAPI file keep their own published bytes. Set the company's `AI_BASE_URL`, allowed hosts/key, exact `AI_VIDEO_MODEL`, explicit `AI_VIDEO_VERIFIED`, positive `AI_VIDEO_HKD_MICROS_PER_SECOND` and optional signed-callback secret. Until a company capability is explicitly configured/verified, generation remains unavailable. No vendor key belongs in a renderer or Extension. Public Sora 2/Videos API retired on 2026-09-24; `company-video-jobs-v1` is an internal contract, with no silent public-provider fallback. Complete managed video capability verification/publication is still outstanding.

Desktop is frameless with no native Electron menu. No visible vertical or horizontal scrollbar rails appear in the product; content still scrolls and reflows, with wheel, Home/End, keyboard focus and actual last-action access. Actual 800×600, 1280×800 and 1440×980 windows, English/Traditional Chinese and light/dark themes are exercised. Truthful task/video progress remains. Desktop Codex runs locally with explicit revocable full local permission. Extension keeps the native right Side Panel and cloud Codex; it requires no Desktop/local-Agent dependency.

Validation: **{counts}/{counts}** platform cases, all previous 874 retained; **60/60** focused video/gateway cases; **69** client unit cases; **32** packaged Desktop, **5** Web/Admin and **9** native Side Panel checks; **17/17** native supervisor cases. These are separate scopes, not an additive acceptance count. Native Codex, identity, database, storage, media decode and ledger are real; reasoning, video content, customer data and selected native consent decisions are explicit fixtures. All owned browsers/databases close; no Docker/WSL/VM is used. The original **102 REQ/102 TC remain 83 partially verified, 19 unproven, zero fully accepted**. Live company media, full TC-019/TC-056, all professional roles and G01–G10 remain open.

The complete 70-file/18-batch platform inventory uses a reviewed same-source re-execution: Windows error 1455 interrupted one batch; all four files passed on a fresh owned database, while the other seventeen complete passing batches retain exactly the same source, tests, harness and native binary. The original failed attempt stays failed and contributes no passing coverage. Each selected receipt retains its own plan hash; raw TAP files are neither combined nor relabeled.
'''
            else:
                body = f'''{intro[0]}

{quickstart(component, False)}

1. 使用现有邮箱/验证码流程登录，选择企业/项目，创建「影片与动效」专家任务。新任务固定 R16 1.2.0 与 `video-generation` Skill；旧任务保留原角色和 Skill，使用生成式能力时需新建任务。
2. 在 Web 或 Desktop 选择「生成式影片」、时长（4/8/12/16/20 秒）及横向/纵向/正方形，填写需求并确认任务预算。模板/FFmpeg 合成是独立选项。Desktop 设置默认收起，展开后采用紧凑面板，留出会话和输入空间。Extension 在同一企业/项目的任务历史中打开已有云端影片任务，使用状态、播放和保存操作。
3. Codex 经公司内部服务调用。提交 HTTP 前持久保存原 operation 和报价，与推理/图片共用同一任务预算。输入计数、推理、图片与视频也共用准入限制；已完成调用释放并发后仍计入分钟速率，独立审核确认的终止事实参与并发计数，原请求记录保留。只显示服务回报的真实进度。用量未确认或结果不明时保留原预留，缺失 usage 不计为免费。
4. 「停止这次生成」只取消同一原作业，之后确认的用量仍可能产生费用。重试/恢复查原 operation，不重提生成。真实状态变化拒绝旧控制版本；后台续租和无变化的轮询不会使用户操作过期。
5. 完成状态须通过真实摘要、大小、格式、尺寸、时长及原生完整解码后才交付。可播放、保存真实 MP4；源文件隔离、成果撤回或授权失效后移除当前预览及下载，不用虚构文件冒充成功。内嵌预览限制 20 MB。
6. Admin 进入「调用管理 → 生成式影片作业」。元数据、费用和原作业重查按独立权限及企业/项目范围控制；重查需要近期 MFA、原因和审计，不发起新生成，也不获得提示词、参考图或视频正文。原任务费用结算保留独立审批与不可变用量事实。

升级前在后端执行 `npm run db:migrate` 应用新增 **SQL097**。已发布 SQL001–096 与两份原 OpenAPI 各自字节保持。配置公司 `AI_BASE_URL`、允许域名/密钥、精确 `AI_VIDEO_MODEL`、显式 `AI_VIDEO_VERIFIED`、正数秒费率 `AI_VIDEO_HKD_MICROS_PER_SECOND` 及可选回调签名密钥。公司能力未显式配置/核验时仅生成步骤不可用，凭据不进入渲染器或 Extension。公开 Sora 2/Videos API 已于 2026-09-24 停用，`company-video-jobs-v1` 是公司内部契约，不静默切换公开供应商。完整的管理后台视频能力验证/发布流程仍需补齐。

Desktop 无原生边框和 Electron 菜单，产品界面不出现可见纵向或横向滚动条。内容保持滚轮、Home/End、键盘聚焦、换行及最后操作可达；实际检查 800×600、1280×800、1440×980，英文/繁中及浅深主题。真实任务与视频进度保留。Codex 在客户本机执行，完整本机权限由客户主动授予并可撤销。Extension 保留原生右侧 Side Panel 和云端 Codex，不依赖 Desktop 或本地 Agent。

验证：平台 **{counts}/{counts}** 项，保留原 874 项；影片/网关专项 **60/60**；客户端单元 **69**；打包 Desktop **32**、Web/Admin **5**、原生侧栏 **9**；本机监督进程 **17/17**。各计数范围独立，不相加为产品验收。原生 Codex、身份、数据库、文件、媒体解码与账本是真实执行，模型推理/视频内容、客户数据与部分原生同意决定为明确夹具。自建浏览器/数据库均关闭，未使用 Docker/WSL/虚拟机。原 **102 REQ/102 TC 为 83 部分验证、19 未证明、0 完整验收**；真实公司媒体、完整 TC-019/TC-056、全部专业角色及 G01–G10 仍保留。

平台完整 70 文件、18 批采用已审查的同源码复核：一批遇到 Windows 1455 资源错误后，四个文件在新的自建数据库全部重跑通过；其余十七个完整通过批次的源码、测试、工具及内核字节完全相同。原失败尝试继续标记失败，不计入通过；每份选用回执保留原计划摘要，原始 TAP 不拼接、不改标。
'''
            diagram = '''
```mermaid
flowchart LR
    SignIn[Sign in and select workspace] --> Client[Web / local Desktop / Side Panel]
    Client --> Codex[Cloud or customer-device Codex]
    Codex --> Intent[Original durable operation]
    Intent --> Budget[Shared task budget]
    Budget --> Company[Company internal video service]
    Company --> Observe[Query / signed observation / cancel]
    Observe --> Validate[Actual MP4 decode and immutable file]
    Observe --> Cost[Confirmed cost or retained unknown hold]
    Validate --> Review[Authorized playback and save]
```
'''
            labels = ('Design and protocol', 'Exact evidence', 'Additive API', 'Actual screenshot', 'Interaction GIF', 'Recorded MP4', 'Previous stage-79 documentation and full installation reference; historical counts retain their original scope') if english else ('方案与协议', '精确证据', '增量接口', '实际截图', '交互 GIF', '实际录制 MP4', '阶段 79 历史文档与完整安装参考；旧计数保留原验证范围')
            block = f'''\n<!-- generated-video-stage80 -->
## {'Generated video, scoped costs and compact Desktop' if english else '生成式影片、费用控制与紧凑桌面布局'}

{body}
[{labels[0]}]({design}) · [{labels[1]}]({checkpoint}) · [{labels[2]}]({contract})
{diagram}
![{labels[3]}]({links[0]})

[{labels[4]}]({links[1]}) · [{labels[5]}]({links[2]})

<details>
<summary>{labels[6]}</summary>

{old.strip()}

</details>
'''
            save(file, title + '\n' + block)

    progress_file = ROOT / 'docs/quality/requirements-alignment-progress.json'
    progress = json.loads(progress_file.read_text(encoding='utf-8'))
    assert progress['summary'] == {'partial_verified': 82, 'completion_not_proven': 20}
    requirement = next(item for item in progress['requirements'] if item['requirement_id'] == 'REQ-019')
    assert requirement['assessment'] == 'completion_not_proven' and requirement['acceptance_case_execution'] == 'not_completed'
    requirement['assessment'] = 'partial_verified'
    requirement['finding'] = '已验证公司生成式视频原 operation 的持久提交/查询/取消/认证观察、未知费用保留、共享预算、真实 MP4 及费用结算，以及 Web/Admin/本机 Desktop/原生侧栏实际界面。模型与视频内容为明确夹具，完整真实业务验收未证明。'
    requirement['source_inspection_candidates'] += ['dev/copypaste-platform/src/video-jobs.ts', 'dev/copypaste-platform/src/video-job-routes.ts', 'dev/copypaste-platform/src/video-job-media.ts', 'dev/copypaste-platform/migrations/097-generated-video-jobs.sql', 'dev/copypaste-platform/tests/generated-video-jobs.test.ts', 'dev/copypaste-web/src/generated-videos.tsx', 'dev/copypaste-extension/src/generated-videos.ts']
    requirement['acceptance_evidence'].append('generated_video_repair')
    requirement['verified_repairs'].append({'cluster': 'company_generated_video_jobs', 'verified_subflow': proof['scope'], 'evidence': ['generated_video_repair'], 'implementation_docs': ['technical/80-generated-video-jobs.md']})
    requirement['remaining_complete_acceptance_conditions'] = '真实公司视频供应商能力验证、完整管理后台视频能力受控发布、全部影片规格/参考素材及角色端到端接入、真实客户成果接受与完整 TC-019 仍未证明；现有证据使用明确模拟模型/视频内容。'
    progress['summary'] = dict(Counter(item['assessment'] for item in progress['requirements']))
    assert progress['summary'] == {'partial_verified': 83, 'completion_not_proven': 19}
    assert progress['fully_accepted_requirements'] == 0 and all(item['full_acceptance'] == 'not_proven' for item in progress['gates'])
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['current_source_qualification'] = {'stage': 80, 'checkpoint': 'generated-video-checkpoint.json', 'note': proof['scope']}
    progress['generated_video_repair'] = {'stage': 80, 'checkpoint': 'generated-video-checkpoint.json', 'status': proof['status'], 'platform_tests': counts,
                                          'focused_tests': 60, 'client_tests': 69, 'packaged_ui_checks': 32, 'web_admin_checks': 5, 'extension_checks': 9, 'original_full_acceptance': 'not_proven'}
    save(progress_file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')

    active = ['docs/00-document-map.md', 'docs/DELIVERY.md', 'docs/modules/03-brand-assets-and-deliverables.md', 'docs/modules/07-web-extension-desktop.md',
              'docs/technical/01-architecture-and-stack.md', 'docs/technical/06-media-and-data-pipelines.md', 'docs/technical/08-development-and-delivery.md', 'docs/technical/10-frontend-design-system.md',
              'docs/technical/11-admin-control-plane.md', 'docs/technical/12-implementation-and-repositories.md', 'docs/product/01-prd.md', 'docs/product/02-user-journeys.md',
              'docs/product/03-information-architecture-and-interactions.md', 'docs/product/05-web-agent-workbench.md', 'docs/product/06-role-templates-and-skill-presets.md',
              'docs/product/07-brand-design-system.md', 'docs/product/08-admin-dashboard.md', 'docs/requirements/03-client-execution-amendment.md', 'docs/requirements/04-desktop-layout-and-scroll.md',
              'docs/quality/02-requirements-traceability.md', 'docs/quality/04-implementation-acceptance.md', 'docs/quality/09-implementation-alignment-audit.md']
    for name in active:
        file = ROOT / name
        title, rest = file.read_text(encoding='utf-8').split('\n', 1)
        rest = rest.replace('**阶段 79 当前增量：**', '**阶段 79 历史基线：**')
        link = '80-generated-video-jobs.md' if file.parent.name == 'technical' else 'technical/80-generated-video-jobs.md' if file.parent == ROOT / 'docs' else '../technical/80-generated-video-jobs.md'
        current = f'**阶段 80 当前增量：** 生成式视频原作业、共享预算与未知费用保留、取消/对账、真实 MP4 和三端预览；Desktop 设置紧凑、无边框、无可见纵横滚动条且保留滚动/键盘与真实进度。平台 {counts}、专项 60、客户端 69、打包 32、Web/Admin 5、侧栏 9、本机监督进程 17 项分别通过，模型与媒体内容为明确夹具。SQL097 新增，SQL001–096 与各原 OpenAPI 字节保留。原 102 REQ/102 TC 为 83 部分/19 未证明/0 完整验收，G01–G10 保留。见 [方案和证据]({link})。'
        text = title + '\n\n' + current + '\n' + rest
        if name == 'docs/00-document-map.md':
            text += '\n## Stage80 生成式影片 / Generated video\n\n- [方案 / Design](technical/80-generated-video-jobs.md)\n- [增量契约 / API](contracts/generated-video-openapi.json)\n- [真实源码/媒体证据 / Evidence](quality/generated-video-checkpoint.json)\n- [更新说明 / Changes](changes/2026-10-24-generated-video-jobs.md)\n'
        if name == 'docs/DELIVERY.md':
            text += f"\n## Stage80 当前本机候选 / Current local candidate\n\nDelivery 相对路径 `{proof['packaged']['executable']}`，实际执行 32 项打包检查。`app.asar` SHA-256 `{proof['packaged']['app_asar_sha256']}`。候选包本地忽略，不代替签名安装验收；按 Desktop README 配置公司接口和固定 Codex 后重建。先应用 SQL097。\n"
        if name == 'docs/product/06-role-templates-and-skill-presets.md':
            text += '\n## R16 当前执行版本 / Current executable binding\n\n新任务使用 `video-motion` 1.2.0：固定 `video-storyboard` 1.0.0、`template-video-composition` 1.0.0、`video-generation` 1.1.0 和 `delivery-core` 1.0.0。模板/时间线制作与生成式影片分别执行；后者依赖明确启用的 `internal-video-v1` / `company-video-jobs-v1`。旧 R16 1.1.0 及其冻结任务保留原绑定，使用新生成能力时新建任务。其余十七个预设角色不随此次更新升级。此执行版本及局部工具证据不把 `design_only` 改称完整专业角色验收；配音、抠像及真实供应商仍按各自能力与证据启用。详见[作业、版本与权限方案](../technical/80-generated-video-jobs.md)。\n\nEnglish: New R16 tasks bind the four exact Skill versions above. Frozen older tasks retain their original bindings; the other seventeen presets are unchanged. This is an executable, partially verified binding, without a complete professional-role or live-provider qualification claim.\n'
        if name == 'docs/technical/06-media-and-data-pipelines.md':
            text += '\n## 生成式影片当前管线 / Current generated-video pipeline\n\n`company-video-jobs-v1` 当前固定横向 1280×720、纵向 720×1280、正方形 1024×1024，时长 4/8/12/16/20 秒；PNG/JPEG 参考图在明确授权和像素/字节边界内读取。提交前保存原 operation 和共享预算报价，断线恢复只查询原作业；真实用量与取消事实分别记录，未知费用保留。实际摘要、大小、MP4/H264、可选 AAC、尺寸、时长及完整原生解码通过后保存不可变成果，再允许预览与下载；内嵌预览限 20 MB。模板工程导出与此作业是分别验证的路径，TTS/ASR、抠像和全视频规格不据此视为已接入。见[完整协议及限定证据](80-generated-video-jobs.md)。\n'
        if name == 'docs/requirements/04-desktop-layout-and-scroll.md':
            text += '\n## 当前实现与画面 / Current implementation evidence\n\n影片参数默认收起，展开在输入区上方，按可用高度限制面板并保持真实滚动；窄窗仍可访问需求、预算、开始/停止与成果。任务和影片进度继续反映真实服务状态。布局补充同时要求隐藏滚动条与实际操作可达，二者在最终打包客户端分别检查。见[实际截图与交互复核](../quality/generated-video-visual-review.md)和[精确版本检查点](../quality/generated-video-checkpoint.json)。\n'
        save(file, text)
    plan = ROOT / 'docs/quality/01-test-and-acceptance-plan.md'
    save(plan, plan.read_text(encoding='utf-8') + f'\n## 阶段 80 局部证据 / Bounded generated-video evidence\n\n原 TC 编号、步骤、完整条件均保持。REQ-019 的提交/查询/取消/对账、真实 MP4 与各端界面已部分验证；TC-019 仍为 `not_completed`。{counts} 项代码测试不代替原 102 项产品验收。真实供应商、全格式/角色、客户成果、TC-056 及 G01–G10 另行证明。见 [精确检查点](generated-video-checkpoint.json)。\n\nThe original acceptance definitions remain; explicit model/video/customer fixtures do not qualify a live provider or complete TC-019.\n')
    contracts = ROOT / 'docs/contracts/README.md'
    save(contracts, contracts.read_text(encoding='utf-8') + '\n## Stage80 生成式视频 / Generated video\n\n[增量契约](generated-video-openapi.json) 从运行时 Zod 模型导出七项操作、十项模式，并以实际响应验证。公司自有 `company-video-jobs-v1` 扩展不是已停用的公开 Videos API。公开 `revision` 不随无变化轮询/续租递增，实际控制仍进行并发校验。当前 [实际路由清单](implemented-routes.json) 为 445 项配置服务操作及一项仅 DEMO_MODE 的既有声明；不作为完整设计 OpenAPI。两份原 OpenAPI 各自原样保留。\n')
    technical = ROOT / 'docs/technical/80-generated-video-jobs.md'
    old = technical.read_text(encoding='utf-8')
    assert old.endswith('目前为实现约束，尚无本阶段运行通过声明。\n')
    save(technical, old.removesuffix('目前为实现约束，尚无本阶段运行通过声明。\n') + f'当前 [检查点](../quality/generated-video-checkpoint.json) 绑定 {counts} 项完整平台、60 项专项、17 项本机监督进程、69 项客户端单元、32 项打包 Desktop、5 项 Web/Admin 及 9 项原生 Side Panel 的独立证据，并绑定真实截图、录制与原生候选包。SQL001–096 和各自原 OpenAPI 已核对字节。原 REQ-019 已记录部分验证，完整 TC-019、真实公司供应商、管理后台完整视频能力受控发布、全格式/角色和生产门槛保持未完成。\n\nEnglish: Durable operation, budget, authorization, actual native MP4 decode and client interactions are exercised with explicit reasoning/media/customer fixtures. Actual native Codex is used in native tools and packaged Desktop; Web/Extension UI reasoning is substituted. This does not establish live-provider, complete professional or production acceptance.\n')
    change = ROOT / 'docs/changes/2026-10-24-generated-video-jobs.md'
    assert not change.exists()
    change.write_text(f'''# 生成式视频与紧凑桌面 / Generated video and compact Desktop

新增公司 `company-video-jobs-v1` 持久作业与 SQL097：固定原 operation、角色/Skill/能力/费率与来源版本；提交前持久保存报价，与推理和图片共享预算。断线恢复不重提生成；未知用量保留费用，确认用量后沿用原账本结算。实际摘要、文件大小、MP4/H264、时长/尺寸和完整解码通过后才交付。后台元数据、费用、重查与审批按独立权限和范围管理，不暴露客户正文。

Desktop 本机 Codex、无边框和完整本机权限保留。影片参数默认收起，窄窗口中展开仍可访问会话/输入。隐藏可见纵横滚动条，真实滚轮、键盘和进度保留。Web/本机 Desktop/原生右侧栏均可预览真实 MP4；后台窄屏卡片按可用宽度重排。

实际检查修复了完成页 React key 重复和后台续租导致取消按钮频繁版本冲突；公开控制版本与运行租约分离，真正状态改变仍拒绝旧版本。原生工作流子任务结算前停止并等待心跳，避免将正常完成误判为撤权而停止父流程；加入可确定复现该竞争的单元测试。长录像 GIF 改为两遍流式编码，保留真实时间，避免缓存整段帧。内置演示网关撤下不支持的视频核验标记；侧栏检查在配置服务模式下调用明确夹具的真实公司网关并消费用量回执。失败和中断回执按原样保留，不能计入通过。

统一限流保留原有生成请求、输入 token 计数和独立审核后的并发状态，再加入视频作业；已完成的请求继续计入分钟速率。新增跨视频/推理的实际请求回归。

English: Video admission extends the existing canonical provider projection, including input-token counting and independently reviewed termination facts. Completed calls release concurrency while retaining their rolling-minute rate charge. A new actual-request regression checks both the completed counting/reasoning rate boundary and video-to-counting concurrency, without weakening the original provider tests.

两项升级测试的最终迁移版本断言随新增迁移更新为 97，其余历史夹具、迁移摘要和财务事实断言原样保留，并重新执行完整文件清单。Earlier UI journeys did not execute this migration-test file; a hash-bound receipt records the exact two assertion changes, and the fresh complete platform run executes the final test inventory.

Skill 目录保留 29 类方法与 30 个不可变版本包，同时保留 `video-generation` 1.0.0 和 1.1.0；版本计数测试增加逻辑键与唯一版本 ID 断言，原项目范围、安装权限、幂等与冻结绑定断言保留。完整回归可以先选择计划内批次，最后仍须每个文件全部通过，失败与重复批次不能计入通过。

平台阶段 27 的一批在 Windows 1455 共享内存错误后发生 Node 子进程异常退出，原回执与日志保持失败。阶段 28 在完全相同的完整源码、测试、工具和固定内核下重新执行该批全部四个文件，56/56 通过；其余十七批沿用逐一核对字节一致的完整通过回执。独立复核脚本验证 70 个文件、18 个批次、不重复计数、各自原计划摘要、原始 TAP 和清理证明；没有重写原失败尝试或拼接虚构 TAP。见[复核记录](../quality/generated-video-platform-requalification.json)。

English: A Windows 1455 shared-memory failure interrupted one stage-27 batch. The complete four-file batch passed 56/56 in stage 28 with byte-identical application, tests, harness and native binary. The other seventeen complete passing batches keep their original receipts and plan hashes. The failed attempt remains failed and is excluded; the reviewed aggregate verifies every file, raw report and cleanup without fabricating a single TAP stream.

原生浏览器 GIF 核验发现额外编码尾帧，原 GIF/MP4 和执行记录保留；展示单独标识、由实际 MP4 按原时间重编码的 GIF（24.17 秒，对应 MP4 24.20 秒），没有加速或造帧。A separate timing-corrected GIF removes only an encoder tail; raw media remains hash-bound in the [media receipt](../quality/generated-video-media-normalization.json).

Current validation: {counts} platform cases (all previous 874 preserved), 60 focused video/gateway cases, 17 native supervisor cases, 69 client unit cases, 32 packaged Desktop, five Web/Admin and nine native Side Panel checks. Real native Codex, auth, DB, files, media decoding and ledger use explicit reasoning/video/customer fixtures. Source hashes, raw evidence, screenshots, GIF/MP4 and the unsigned local candidate are in the [checkpoint](../quality/generated-video-checkpoint.json).

升级先应用 SQL097，再按双语 README 配置公司视频别名、费率及明确核验开关。公开 Sora 2/Videos API 已停用，不能直接沿用公开服务。视频管理后台完整能力发布、真实供应商、全格式/角色和真实客户接受仍未证明。原 102 REQ/102 TC 为 83 部分、19 未证明、零完整验收；TC-019/TC-056 与全部 G01–G10 保留。未使用 Docker/WSL/VM，所有自建浏览器及测试数据库已关闭。

[方案 / Design](../technical/80-generated-video-jobs.md) · [接口 / API](../contracts/generated-video-openapi.json) · [需求进度 / Progress](../quality/requirements-alignment-progress.json)
''', encoding='utf-8', newline='\n')
    MANIFEST.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'stage': 80, 'readmes': 14, 'files': records,
                                   'scope': 'Exact pre-edit documentation bytes archived; all original requirement and acceptance fields and unclosed gates preserved.',
                                   'verifier_sha256': digest(Path(__file__))}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'updated', 'readmes': 14, 'archived_files': len(records)}))


if __name__ == '__main__':
    main()
