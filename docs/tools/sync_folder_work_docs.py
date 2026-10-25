"""Publish concise current bilingual READMEs, retaining exact prior documents."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re

from sync_generated_video_docs import quickstart

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
ARCHIVE = ROOT / "docs/quality/history/stage87-current-documents"
BASE = "https://github.com/copypasteltd/workmate/blob/"
COMPONENTS = ("platform", "web", "admin", "desktop", "extension", "delivery")


def read(file):
    return json.loads(file.read_text(encoding="utf-8-sig"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/folder-work-documentation-refresh.json"
    assert not output.exists() and not ARCHIVE.exists()
    checkpoint_file = ROOT / "docs/quality/folder-work-checkpoint.json"
    proof = read(checkpoint_file)
    assert proof["status"] == "verified_local_folder_work_and_native_navigation"
    records, copies = [], []

    def save(file, text):
        previous = file.read_bytes() if file.exists() else None
        archived = None
        if previous is not None:
            archived = ARCHIVE / "files" / (file.relative_to(ROOT).as_posix().replace("/", "__") + ".snapshot")
            archived.parent.mkdir(parents=True, exist_ok=True)
            with archived.open("xb") as stream:
                stream.write(previous)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding="utf-8", newline="\n")
        records.append({"path": file.relative_to(ROOT).as_posix(), "before_sha256": sha256(previous).hexdigest() if previous else None,
                        "after_sha256": digest(file), "archive": archived.relative_to(ROOT).as_posix() if archived else None})

    progress_file = ROOT / "docs/quality/requirements-alignment-progress.json"
    progress = read(progress_file)
    original = read(ROOT / "docs/quality/history/stage87-before-folder-work/receipt.json")
    keys = ("requirement_id", "priority", "requirement", "acceptance_case", "acceptance_conditions")
    assert [{key: row[key] for key in keys} for row in progress["requirements"]] == original["original_requirements"]
    findings = {
        "REQ-040": ("目录监听、防抖去重、稳定原字节快照、持久批量队列、同线程回答/继续、真实应用重启后暂停、预算及撤销已有当前实际证据。",
                    "完整 TC-040 仍开放：结构化 argv 的批准程序注册/调用、完整冲突/崩溃/休眠/离线及全部 DESK-L01–L08 条件尚未齐。"),
        "REQ-042": ("当前打包客户端通过真实 Codex 浏览器成功/停止/撤权路径，按原窗口 ID 等待实际销毁，核对拥有的 Codex PID 退出及不再发起模型请求。",
                    "完整 TC-042 仍开放：全部失败/崩溃及用户既有页面矩阵、每任务默认三页与驱动四页硬上限的资源口径尚须对齐和验收。"),
    }
    for row in progress["requirements"]:
        if row["requirement_id"] in findings:
            finding, remaining = findings[row["requirement_id"]]
            row["assessment"] = "partial_verified"
            row["finding"] = finding + remaining
            row["remaining_complete_acceptance_conditions"] = remaining
            row["verified_repairs"].append({"stage": 87, "finding": finding, "checkpoint": "docs/quality/folder-work-checkpoint.json"})
            row["acceptance_evidence"].append({"path": "docs/quality/folder-work-checkpoint.json", "sha256": digest(checkpoint_file), "scope": "bounded native evidence; complete case remains open"})
            assert row["acceptance_case_execution"] == "not_completed"
    progress["summary"] = dict(Counter(row["assessment"] for row in progress["requirements"]))
    assert progress["summary"] == {"partial_verified": 86, "completion_not_proven": 16}
    progress["at"] = datetime.now(timezone.utc).isoformat()
    progress["folder_work_verification"] = {"checkpoint": "docs/quality/folder-work-checkpoint.json", "sha256": digest(checkpoint_file),
        "desktop_checks": 57, "desktop_unit_tests": 91, "client_unit_tests": 161,
        "retained_stage86_platform_cases": 1023, "platform_regression_rerun": False,
        "entire_product_acceptance": "not_proven", "original_requirements_unchanged": 102}
    save(progress_file, json.dumps(progress, ensure_ascii=False, indent=2) + "\n")

    old = read(ROOT / "docs/quality/shared-project-checkpoint.json")
    descriptions = {
        "root": ("面向香港企业 marketing 团队的多端 Codex Agent 产品及独立管理后台。", "A multi-client Codex Agent product and independent Admin for marketing teams in Hong Kong businesses."),
        "platform": ("身份、企业/项目、云端 Codex、业务工具、公司模型网关、计量与审计后端。", "Backend for identity, workspaces/projects, cloud Codex, business tools, the company AI gateway, metering and audits."),
        "web": ("在浏览器内选择专业角色，使用云端 Codex，管理项目、资料、工作及交付。", "Select specialists and use cloud Codex in a browser, with projects, references, tasks and deliverables."),
        "admin": ("独立 MFA 后台，按角色、企业、项目、字段和操作授权管理用户、内容、消耗、费用与 VIP。", "A separate MFA-protected Admin scopes users, content, consumption, fees and VIP by role, company, project, field and operation."),
        "desktop": ("无边框 Windows 客户端，在客户本机运行固定 Codex；完整本机权限由客户主动授予并可随时撤销。", "Frameless Windows Desktop runs pinned Codex on the customer device, with explicitly granted and revocable full local permission."),
        "extension": ("Chrome 原生右侧栏内的 ChatGPT 式聊天和附件，向云端 Codex 提供用户明确选择的私有文件。", "ChatGPT-style chat and attachments in Chrome's native right Side Panel provide explicitly selected private files to cloud Codex."),
        "delivery": ("并列独立仓库的原生启动、验证、真实截图/录制与非强制分支发布工具。", "Native startup, validation, actual screenshots/recordings and non-force branch publication for the independent repositories."),
    }
    component_details = {
        "root": ("全部代码在 `dev/` 的六个独立仓库内，主文档在 `docs/`；主文档仓库发布至 docs/main，代码分别发布至 backend/web/admin/desktop/extension/delivery。完整需求、验收门槛、角色资格与所有未完成项继续维护。", "Six independent code repositories live under `dev/`; primary documentation lives under `docs/`. The documentation repository publishes to docs/main, while code publishes to backend/web/admin/desktop/extension/delivery. Complete requirements, gates, professional-role qualifications and unfinished scope remain tracked."),
        "platform": ("使用 TypeScript、Fastify 和原生 PostgreSQL。应用身份不持有数据库 owner/BYPASSRLS 权限；HTTP、worker、下载和来源重用继续检查当前授权。任务账本、预留、实际消耗和未知费用分别记录，停止不伪造零费用。公司端配置模型、媒体能力、精确费率和允许地址；后端不允许客户端注入任意供应商密钥或任意模型地址。", "Uses TypeScript, Fastify and native PostgreSQL. Application roles have no owner/BYPASSRLS privilege; HTTP, workers, downloads and source reuse recheck current authority. Task ledgers distinguish reservations, actual usage and unknown cost; stopping never fabricates zero usage. Company model aliases, media capabilities, exact tariffs and allowed origins are backend configuration, not arbitrary client-supplied provider secrets or URLs."),
        "web": ("React、TypeScript、Vite 和 React Router 提供云端工作台。新用户创建企业或接受邀请，再选择项目、可用角色和明确输入；缺少必要资料时提示补齐，同号工作继续。项目管理页可保存/预览/发布共享指引、固定品牌和资料版本。工作历史保留版本、来源与费用，继续修改不静默换用后来的配置。", "React, TypeScript, Vite and React Router provide the cloud workspace. New users create a company or accept an invitation, select a project and available specialist, and provide explicit inputs. Missing dependencies request customer input and continuation keeps the original task. Project pages save, preview and publish guidance with exact brand/reference versions; histories retain versions, sources and costs without silently adopting later defaults."),
        "admin": ("使用独立后台账号及 MFA，用户端登录不自动获得管理权。元数据、敏感正文、消耗/费用、赠额/扣回、授信、退款、收款登记、VIP、隔离/恢复/永久擦除分别授权。人工开通先预览精确用户/企业、金额或权益、到期和原因，再以相同幂等键确认；预览不改余额，重放不重复赠额。支持访问不自动获得正文；关键动作保留独立审核、当前 MFA 和审计。Admin 不能替客户授予本机完整权限或签署媒体使用声明。", "Uses separately enrolled Admin identities and MFA; customer login grants no administration. Metadata, sensitive bodies, usage/cost, credits/reversals, credit limits, refunds, payment records, VIP, quarantine/restore and irreversible erasure have separate permissions. Preview exact users/workspaces, amounts or entitlements, expiry and reason before confirming the same idempotent operation. Preview changes no balance and replay grants no duplicate credit. Support access does not imply body access; sensitive operations retain independent review, current MFA and audit. Admin cannot grant customer-local full permission or sign a customer's media declaration."),
        "desktop": ("Electron 主进程管理 OS 授权、加密本机会话、固定 Codex 子进程、文件/终端、浏览器及 IPC；React 渲染器不持有通用 Node/任意进程调用。选择角色和工作目录后设置唯读、目录内读写或完整本机权限，原生确认默认取消。Codex 在客户电脑运行，推理/图片/视频/音频仍经公司服务器。真实待答问题默认不选择，客户回答继续原任务/线程/轮次；停止和撤权清除待答并结束拥有的子进程。", "The Electron main process owns OS grants, encrypted local sessions, pinned Codex children, files/terminal, browser tools and IPC; the React renderer has no generic Node/arbitrary-process API. Select a specialist/workspace and read-only, workspace-write or full local permission; native consent defaults to Cancel. Codex runs on the customer device while reasoning/image/video/audio requests use the company server. Questions start unselected, and explicit answers continue the same task/thread/turn. Stop/revoke clears prompts and ends owned children."),
        "extension": ("Chrome MV3 扩展使用原生右侧 Side Panel，点击扩展图标打开；不是网页内注入浮层。用户独立登录并选择企业/项目，不依赖 Desktop。附件先创建本人私有会话，再进行精确原字节/SHA-256 分片上传和恢复；不会因失败回退到项目共享。同项目另一位编辑者不能列出、读版本、下载或打开该私有会话。项目共享需要独立明确操作；只在客户选择/授权后读取文件或当前页。", "The Chrome MV3 extension opens the native right Side Panel from its toolbar icon, rather than injecting an in-page overlay. Sign in and select a workspace/project independently of Desktop. Attachments first create the actor's private conversation, then use exact-byte/SHA-256 resumable chunks; errors never fall back to project sharing. Another editor in the same project cannot list/read versions/download/open that private conversation. Project sharing is separate and explicit; files/current-page content are read only after customer selection or authorization."),
        "delivery": ("工具保留原始 TAP、失败报告、验证器、所选源码摘要和实际截图/GIF/MP4，区分假模型回复、原生 Codex 与真实文件/数据库/账本。原生测试只拥有自己的端口、进程、目录和数据库对象；关闭不用的自建浏览器并保留用户页面/服务。发布前检查七个仓库、双语 README、媒体、凭据、历史对象大小及提交清单；仅向明确映射分支普通推送并核对八个远程 SHA，不强推。", "Tools retain original TAP, failed receipts, verifier sources, selected source digests and actual screenshots/GIF/MP4, distinguishing synthetic model replies from native Codex and real files/database/ledgers. Native tests own only their ports, processes, folders and database fixtures; unused owned browsers close while user pages/services remain. Publication audits seven repositories, bilingual READMEs, media, credentials, historical object sizes and committed manifests, then uses ordinary explicit-ref pushes and verifies eight remote SHAs without force."),
    }
    diagram = """```mermaid
flowchart TD
  Login[Sign in and select company/project] --> Role[Available specialist and exact Skill version]
  Role --> Cloud[Web / native Side Panel: cloud Codex]
  Role --> Local[Frameless Desktop: customer-local Codex]
  Files[Explicit private attachment selection] --> Cloud
  Local --> Grant[Customer OS grant / local files and tools]
  Local --> Rules[Paused folder rule / explicit spend confirmation]
  Rules --> Queue[Stable snapshot / persistent serial queue]
  Queue --> Local
  Cloud --> Company[Company OpenAI-compatible API]
  Local --> Company
  Company --> Ledger[Original task / usage / unknown-cost hold]
  Admin[Separate Admin MFA and scoped permissions] --> Governance[Users / content / fees / VIP / audit]
```"""
    for component, intro in descriptions.items():
        repo = ROOT if component == "root" else DEV / ("copypaste-" + component)
        base_folder = ROOT / "docs" if component == "root" else repo
        doc = "" if component == "root" else BASE + "docs/docs/"
        surface = "desktop" if component in ("root", "desktop", "delivery") else "web" if component == "platform" else component
        current = surface == "desktop"
        media_proof = proof if current else old
        shots = [row for row in media_proof["screenshots"] if row["path"].startswith("copypaste-" + surface + "/")]
        suffixes = {"desktop": ["-history-1440x980-en.png", "-history-800x600-en.png"],
                    "web": ["-publication-preview-en.png", "-unavailable-reference-en.png"],
                    "admin": ["-admin-metadata-only.png", "-admin-exact-version-body.png"],
                    "extension": ["-native-accepted-v3-attachment-en.png", "-native-compact-settings-zh.png"]}[surface]
        items = [next(row for row in shots if row["path"].endswith(tail)) for tail in suffixes]
        recordings = [row for row in media_proof["recordings"] if row["component"] == surface and
                      (not current or row["name"] in ("native-folder-watch", "native-folder-restart"))]
        assert len(recordings) == (2 if current else 1)
        items += [item for recording in recordings for item in recording["files"]]
        links = []
        for item in items:
            source = DEV / item["path"]
            assert digest(source) == item["sha256"]
            if source.is_relative_to(repo) and component != "root":
                target = source
            else:
                target = base_folder / ("design/implementation" if component == "root" else "assets/workmate-current") / (Path(item["path"]).parts[0] + "__" + source.name)
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    assert digest(target) == item["sha256"]
                else:
                    target.write_bytes(source.read_bytes())
                copies.append({"source": item["path"], "target": target.relative_to(ROOT).as_posix(), "sha256": digest(target)})
            links.append(target.relative_to(base_folder).as_posix())
        for english in (False, True):
            language = 1 if english else 0
            start = quickstart(component, english).replace("SQL097", "SQL103")
            if english:
                body = f"""{intro[1]}

## Product and boundaries

The first customers are existing marketing teams. Scope includes image/design/typography, video/effects, advertising and website analysis, SEO/GEO, repeated business processes and software development. The catalog has 18 candidates with exact Skill bindings; at least twelve individually qualified professional presets remain an acceptance requirement. The designer combines Codex, design Skills and company Image 2. Codex is the only Agent core. All AI uses the company's OpenAI-compatible backend; development currently uses authorized synthetic providers, not a claim of live professional quality.

{component_details[component][1]}

## Setup

{start}

1. Complete sign-in, company membership/invitation and project selection. Native clients use browser PKCE; Admin uses separate MFA identities. Expired/revoked credentials must not silently change identity or company.
2. Select a specialist and supply the brief and explicitly authorized references/accounts. Missing inputs request customer action. Project owners can save, preview and explicitly publish immutable shared guidance; publication starts no AI and grants no new permission.
3. New tasks pin their accepted role, Skill, brand, reference and guidance versions. Existing work, including an originally absent configuration, retains its original state. Source revocation hides unavailable bodies and blocks later use; history is not a permission bypass.
4. Confirm budget and any required operation/media approval. View genuine status, progress, exact deliverables and original receipts. Continue requested edits in the same task lineage. Unknown usage remains reserved for reconciliation; it is never silently free or blindly replayed.
5. Admin can independently manage authorized user/workspace status, inspect permitted consumption, preview/confirm manual fees or credits and activate scoped VIP/expiry. Balances, recorded payments, credits, budgets and VIP are separate records. Idempotent confirmation and audit prevent duplicate grants.

## Customer-local folder work

In Desktop, choose a writable local session and open **Folder work**. Select an input folder inside the workspace and configure extensions, instructions, a quiet period, per-file/total limits and maximum runs. Existing files are excluded unless selected. Saving creates a **paused** rule; **Confirm and activate** opens a separate native automatic-spend confirmation that defaults to Cancel.

Stable native file events and bounded scans feed a persistent serial queue. Each job gets an exact snapshot, separate output directory, original task ID and company cost receipt. An unanswered native question is visible from Folder work; **Answer questions** returns to Conversation and requires the customer's explicit answer. Identical already-processed bytes and product outputs do not create another paid task. Unstarted old versions coalesce to the latest stable input.

Pause stops new dispatch and lets the current file finish. Revoke stops only that rule's owned work while keeping outputs/receipts. App closure stops watching; a real reopen retains the encrypted journal and allocated limits but requires fresh confirmation. Lost replies reuse original dispatch/create/start/finish keys; uncertain native actions block for review. Full OS permission remains the customer's grant, not an additional folder sandbox. Web/Extension keep cloud execution; folder work is a Desktop capability.

Limits: 20 rules; 1,000 history/200 queued items per rule; 1,000 dispatch receipts per session; 2,000 matching files/10,000 entries/12 levels per scan; 20 MiB per file and 64 MiB new reads per scan; at most 100 authorized runs, one scheduled job at a time. Limits do not reset on pause/restart. Outputs are under `.copypaste-local-jobs/<rule>/<job>/output/`. Symlinks/junctions, traversal, outside input, source replacement and conflicts block automatic work. Complete approved-program/structured-argv and crash/sleep/offline matrices remain open.

## Configuration, UI and verification

Apply SQL103 before client upgrades. This increment adds no HTTP route or migration; SQL001–103 and 532 recorded contracts remain byte-preserved. Set company gateways, exact model aliases, verified media capabilities and tariffs on the backend; consult its `.env.example` and the deployment runbook. Never embed company provider keys in a renderer/extension. Unconfigured capability is unavailable rather than silently redirected. Ordinary demo data does not activate every media fixture.

CopyPaste blue/cream, Manrope/Fraunces, English/Traditional Chinese and light/dark themes remain. Desktop has no Electron frame/menu or visible scrollbar rails. Real wheel/focus/last-action access and truthful progress remain. The narrow session guidance card separates its icon/version from the readable name. Focused page Home/End and Ctrl+Home/End act on that page; focused text fields keep caret navigation.

Fresh stage-87 scopes: **91 Desktop unit tests, 161 client unit tests and 57 actual packaged Desktop checks**, retaining all previous 50 native checks and 69 Desktop unit cases. Folder work executes real customer-local Codex, explicit same-turn answers, exact CSV outputs, an actual new-PID application restart, separately settled 90/60-micro-HKD tasks, original thread/version continuity and zero cloud replacement tasks. All 14 runtime assets/licenses match source bytes; repository screenshots/recordings stay outside the runtime ASAR. The archive shrinks from {proof['packaging']['old_app_asar_bytes']:,} to {proof['packaging']['new_app_asar_bytes']:,} bytes.

Retained stage-86 scopes: **1023 platform, 25 focused, 36 compatibility and 14 actual Web/Admin/native Side Panel checks**. Backend/Web/Admin/Extension product sources remain exact; this stage does not claim those complete suites were rerun. Native processes/files/database/ledger are real; model replies, ad/customer facts and selected native-dialog decisions are explicit fixtures. All owned browsers, API, previews and test DB close; no Docker/WSL/virtualization is used.

The original 102 requirements remain **86 partial / 16 unproven / 0 fully accepted**. REQ-040/042 gain bounded evidence without closing their original conditions. At least twelve professional-role qualifications, complete Admin breadth, teams/solution packages, full marketing workflows, live quality, signed installation/update/uninstall, load/restore exercises and G01–G10 remain open. Test counts are not a product-completion percentage. See the complete numbered gap assessment.
"""
                labels = ("Architecture", "Plan and limits", "Current-source checkpoint", "Complete numbered gaps", "Branch/checkout and publication", "Role catalog", "Skill packages", "Actual full window", "Actual compact window", "Actual interaction", "Original MP4")
                note = "Current stage-87 native folder media; unchanged pixels and observed-time captures, with synthetic provider/dialog decisions." if current else "Retained stage-86 media for unchanged product sources; this stage adds no fresh Web/Admin/Side Panel UI qualification."
            else:
                body = f"""{intro[0]}

## 产品与边界

首批面向现有客户的 marketing 团队，完整范围包含生图、设计/字体、视频/特效、广告和网站分析、SEO/GEO、企业重复流程及软件开发。目录已有 18 个精确 Skill 绑定的候选角色；至少十二个逐一完成专业任务、修改及异常处理的角色仍是验收要求。设计师由 Codex、设计 Skill 与公司 Image 2 组合。Agent 内核唯一使用 Codex；全部 AI 请求走公司 OpenAI 兼容后端。当前开发使用已授权假数据，不代表真实模型专业质量已经验收。

{component_details[component][0]}

## 启动与使用

{start}

1. 完成登录、企业成员/邀请和项目选择。原生端通过浏览器 PKCE 登录；Admin 使用独立 MFA 身份。过期、撤销、换企业不应静默切换身份和资料范围。
2. 选择专业角色，提供工作说明及明确获准的资料/账号。缺少必要输入时请求客户补齐。项目负责人可以保存草稿、核对依赖、预览并明确发布不可变共享指引；发布不启动 AI、不增加权限。
3. 新任务固定当时接受的角色、Skill、品牌、资料和指引版本。既有工作保留原版，包括原先没有共享配置的状态。来源被隔离、删除或撤权后隐藏失效正文并阻断后续使用；历史内容不是越权入口。
4. 确认预算和必要的操作/媒体授权，查看真实状态、进度、文件与原费用回执。修改沿原工作谱系继续。未知用量保持原预留供对账，不能当作免费或盲目重新执行。
5. Admin 可按独立权限管理用户/企业状态、查看获准消耗，预览并确认人工费用/赠额和 VIP 权益/到期。余额、实收记录、授信、预算和 VIP 分别保存；同一确认幂等，操作保留审计，不能因重放重复赠额。

## Desktop 本机目录工作

选择具备读写授权的本机会话，打开「目录工作」，选择工作目录内真实输入目录，配置扩展名、处理说明、稳定等待时间、每档/总授权上限和最多次数。已有文件默认不处理；客户明确勾选后才纳入。保存只建立**暂停**规则；「确认并启用」另行打开默认取消的原生自动收费确认。

本机文件事件与有界核对发现稳定输入，按持久队列逐档处理。每档保存精确快照、独立输出目录、原任务编号和公司费用回执。专家需要客户回答时，目录页显示待答入口；「回答问题」返回对话，客户明确选择后继续原任务/线程/轮次。同一规则中已处理的相同路径/内容不会再次收费，产品输出不成为输入；尚未开始的旧内容合并为最新稳定版本。

暂停停止新派发，已开始的一档可以完成；撤销只停止该规则拥有的工作，保留交付和费用。应用关闭后停止监听，真实重开保留加密账本及已分配上限，但必须再次确认。丢失回包复用原派发/创建/开始/结算键；未知本机动作阻断供核对。完整 OS 权限仍是客户主动授予的本机权限，目录规则没有额外创造一个 OS 沙箱。Web/Extension 保持云端执行，本机目录工作是 Desktop 能力。

明确上限：20 条规则；每规则 1,000 项历史/200 项排队，每会话 1,000 项派发回执；每次扫描 2,000 个匹配文件/10,000 项条目/12 层深度；每档 20 MiB、单次新读取 64 MiB；最多授权 100 次，目录调度同一时间执行一档。暂停或重启不重置上限。输出位于 `.copypaste-local-jobs/<rule>/<job>/output/`。越界、路径遍历、symlink/junction、源文件替换和冲突阻断自动执行。批准程序/结构化 argv 和完整崩溃/休眠/离线矩阵仍待补齐。

## 配置、界面和验证

升级客户端前应用 SQL103。本增量不新增 HTTP 路由或迁移，SQL001–103 与 532 个已记录契约保持原字节。公司网关、精确模型别名、已核验媒体能力和费率只配置在后端，详见后端 `.env.example` 和部署说明；不向渲染器/扩展写入公司供应商密钥。未配置的能力保持不可用，不静默改走其他提供方。普通示范不会自动启用全部专项媒体夹具。

保持 CopyPaste 蓝/奶白、Manrope/Fraunces、中英双语和浅深主题。Desktop 无 Electron 自带边框/菜单，不显示纵横滚动条轨道，仍保留真实滚轮、焦点、末项访问和进度。紧凑会话摘要将图标/版本和名称分行，保持可读；聚焦页面的 Home/End、Ctrl+Home/End 到达页面首末项，聚焦文本框时保留光标导航。

本阶段新验证：**Desktop 单元 91、客户端单元 161、实际打包 Desktop 57 项**，保留原 50 项实际检查及 69 个 Desktop 单元用例。目录工作由客户本机真实 Codex 执行，核对显式回答原轮次、CSV 原字节及输出、实际新 PID 重启、90/60 港币微额分别结算、原线程/版本延续和零云端替代任务。全部 14 个运行资产/许可证与源码原字节相符；截图/录屏留在仓库、不进入运行 ASAR。归档由 {proof['packaging']['old_app_asar_bytes']:,} 降为 {proof['packaging']['new_app_asar_bytes']:,} 字节。

保留阶段 86 的**平台 1023、核心 25、兼容 36、实际 Web/Admin/原生侧栏 14 项**历史范围；Backend/Web/Admin/Extension 产品源仍精确一致，本阶段没有宣称重新执行这些完整套件。原生进程、文件、数据库及账本是真实运行；模型回复、广告/客户事实及部分原生对话框决定为明确夹具。自建浏览器、API、预览和测试数据库均关闭；没有使用 Docker/WSL/虚拟化。

原 102 项需求登记为 **86 部分／16 未证明完整／0 完整验收**。REQ-040/042 获得限定证据，不关闭原完整条件。至少十二个专业角色、完整后台、团队/方案包、全部 marketing 流程、真实质量、签名安装/升级/卸载、负载/恢复演练和 G01–G10 继续开放，测试数不能换算产品完成率。详见完整编号差异表。
"""
                labels = ("架构逻辑", "方案与边界", "当前源码检查点", "完整编号差异", "分支/检出与发布", "角色目录", "Skill 包", "实际完整窗口", "实际紧凑窗口", "真实交互", "原始 MP4")
                note = "本阶段实际本机目录截图和按观察时间录制的交互，原像素保留；模型/原生对话框决定为明确夹具。" if current else "以下为阶段 86 未变化产品源的历史界面证据，本阶段未新增 Web/Admin/侧栏整体验收。"
            navigation = f"[{labels[1]}]({doc}technical/87-desktop-folder-work.md) · [{labels[2]}]({doc}quality/folder-work-checkpoint.json) · [{labels[3]}]({doc}quality/2026-10-25-goal-gap-assessment.md) · [{labels[4]}]({doc}governance/04-git-branches-and-publication.md)\n\n[{labels[5]}]({BASE}backend/catalog/role-preset-catalog.json) · [{labels[6]}]({BASE}backend/catalog/skill-packages.json)"
            media_text = f"{note}\n\n![{labels[7]}]({links[0]})\n\n![{labels[8]}]({links[1]})\n"
            for item, target in zip(items[2:], links[2:]):
                media_text += (f"\n![{labels[9]}]({target})\n" if target.endswith(".gif") else f"\n[{labels[10]}]({target})\n")
            title = "# Workmate · CopyPaste Enterprise Agent" + ("" if component == "root" else " · " + component)
            file = base_folder / ("README.en.md" if english else "README.md")
            save(file, title + "\n\n<!-- folder-work-stage87 -->\n\n" + body + "\n\n" + navigation + "\n\n## " + labels[0] + "\n\n" + diagram + "\n\n" + media_text)

    pointers = read(ROOT / "docs/quality/history/stage86-current-pointers/receipt.json")
    for item in pointers["files"]:
        file = ROOT / item["source"]
        title, previous = file.read_text(encoding="utf-8").split("\n", 1)
        previous = re.sub(r"阶段 (\d+) 当前增量", r"阶段 \1 历史基线", previous)
        link = os.path.relpath(ROOT / "docs/technical/87-desktop-folder-work.md", file.parent).replace("\\", "/")
        lead = f"**阶段 87 当前增量：** Desktop 目录监听、稳定快照、持久批量队列、原轮次客户回答、实际应用重启后暂停、原线程/固定版本继续、独立费用和预算/撤销已有限定验证。57 项打包 Desktop、91 项 Desktop 单元、161 项客户端单元通过；原 50/69 项保留。紧凑摘要分行及页面 Home/End 修复已核对；输入框保留光标操作。全部 14 个运行素材/许可证保留，仓库媒体不进入运行 ASAR。本阶段不新增 API/SQL；沿用阶段 86 未变化后端/Web/Admin/Extension 的历史 1023/25/36/14 范围，不宣称完整套件重跑。REQ-040/042 更新部分，原 102 项为 86 部分／16 未证明完整／0 完整验收；至少十二个专业角色和 G01–G10 继续开放。见[当前方案与精确证据]({link})。\n\n下文保留原规范和各阶段历史记录；历史「当前」及阶段专用命令仅解释其原始回执。新发布流程使用本阶段检查点、文档/媒体核对和提交清单。"
        save(file, title + "\n\n" + lead + "\n\n" + previous.lstrip())

    assessment_file = ROOT / "docs/quality/2026-10-25-goal-gap-assessment.md"
    text = assessment_file.read_text(encoding="utf-8")
    title, old_text = text.split("\n", 1)
    old_text = old_text.replace("## 第八次工作区复核：当前状态", "## 第八次工作区复核：历史状态")
    old_text = old_text.replace("本次为同日第八次复核，评估已发布的阶段 86 基线及尚未提交的 Desktop/Delivery 增量。", "前次第八次复核保留阶段 86 与当时未发布增量的历史；当前以本节阶段 87 为准。")
    for number in (40, 42):
        old_text = re.sub(rf"(\| REQ-{number:03} \| P1 \| )未证明完整( \|)", r"\1部分\2", old_text)
    old_text = old_text.replace("| 部分验证 | 84 项 |", "| 部分验证 | 86 项 |")
    old_text = old_text.replace("| 尚未证明完整达标 | 18 项 |", "| 尚未证明完整达标 | 16 项 |")
    old_text = re.sub(r"^\| 当前 Desktop 候选 / 实际打包流程 \|.*$", "| 当前 Desktop 增量 / 实际打包流程 | 91 项单元、57 项实际检查通过；客户端 161 项 | 目录调度和本次导航/可读性修复有限定证据；完整 DESK/原 TC 继续开放 |", old_text, flags=re.M)
    rows = {
        "GAP-02": "| GAP-02 | Desktop 本机能力；功能、流程待补 | 本机 Codex、主动可撤销全权限、文件/终端/浏览器/父子 SOP；目录监听、回答、结果、实际重启、预算及撤销通过本次实际 57 项中的 7 项 | 完整检查点、离线续做、结构化 argv 允许程序、全角色工具和应用操作仍不齐；一次正常关闭重启不代表全部崩溃恢复 | 完成原 DESK-L01–L08 与 TC-040 全部条件，身份/撤权/冲突/未知结果和费用一致 | P0 |",
        "GAP-04": "| GAP-04 | Codex 持续执行与恢复；流程待补 | 唯一 Codex、公司网关、原线程继续/停止；当前实际应用重启保留目录队列和预算、默认暂停，确认后沿原线程继续 | 已付费步骤检查点、安全暂停、多节点/完整崩溃及未知工具动作恢复仍未全覆盖 | 中断后继续原工作，保留原费用/结果，不重复付费步骤，内核保持 Codex | P0 |",
        "GAP-13": "| GAP-13 | 项目共享、记忆与云文件；流程、验收待补 | 不可变共享配置、固定版本和正文治理；本阶段实际 v3/v3/v4、原字节、独立费用与来源失效门控通过 | 长会话、个人偏好交集、Office/PDF、大目录及全部并发/撤权和客户接受仍待验收 | 新工作固定配置，旧工作保留原版或原先无配置；持续检查来源，完成原 TC-065 全部条件 | P1 |",
        "GAP-21": "| GAP-21 | CopyPaste 视觉、双语和可访问性；流程、验收待补 | 无边框/菜单/可见滚动轨道；紧凑摘要分行、页面 Home/End 与 Ctrl+Home/End、输入框光标和三种实际尺寸已有当前通过证据 | 此前窄列及 Ctrl+Home 故障已修复，完整全端状态/动态文案、200% 缩放、键盘/对比/reduced-motion 和目标 DPI 仍待验收 | 全端全部关键页面及错误/空态贴合品牌、持续可访问，保留滚动和真实进度 | P0 |",
        "GAP-23": "| GAP-23 | 安装、更新与正式交付；流程、发布验收待补 | 独立仓库/分支、重整双语 README、真实媒体及当前未签名解包应用验证 | 最终源码同步以本阶段提交清单/远程回执为准；签名安装、升级回滚、卸载、旧客户端兼容、目标系统/DPI 及扩展渠道验收未完成 | 在声明系统实际安装→登录→使用→升级/回滚→卸载，形成可复现发布和兼容证据 | P0 |",
        "GAP-25": "| GAP-25 | 文档与验收登记；持续维护与验收待补 | 本阶段重整双语 README、实际媒体、精确源码及限定验证；REQ-040/042 获得当前部分证据 | 原 102 项完整条件和 G01–G10 未关闭，历史归档/外部链接及持续交付仍须维护；代码推送不代替业务资格 | 按实际证据同步原 TC、README、媒体和提交版本；原字节保留历史和失败 | P1 |",
    }
    for gap, row in rows.items():
        old_text = re.sub(r"^\| " + gap + r" \|.*$", lambda _: row, old_text, flags=re.M)
    current = """评估更新：阶段 87，2026-10-25。Desktop 目录工作及两项明确界面故障已有当前通过证据：57 项实际打包检查、91 项 Desktop 单元、161 项客户端单元；此前失败 65–68 保留 failed。目录任务真正使用本机 Codex，验证显式回答、原字节、真实新 PID 重启、同线程/版本、预算与 90/60 港币微额结算，没有云端替代。紧凑摘要可读性和创意反馈页首末导航已修复；完整视觉/可访问性、专业角色和其余业务条件仍开放。

原登记现为 **86 部分／16 未证明完整／0 完整验收**，REQ-040/042 仅增加限定证据，原 102 项全部正文/条件不变。至少十二个合格角色、G01–G10 与全部 26 组差异保持。沿用阶段 86 未变化组件的历史结果，不称全平台本次重跑。

[当前精确检查点](folder-work-checkpoint.json) · [本阶段方案](../technical/87-desktop-folder-work.md)。最终发布状态以提交清单及实际远程回执为准。下方第八次及更早复核保留原始时间与失败事实。

"""
    save(assessment_file, title + "\n\n" + current + old_text.lstrip())
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "refreshed_bilingual_folder_work_documentation",
        "checkpoint": {"path": checkpoint_file.relative_to(ROOT).as_posix(), "sha256": digest(checkpoint_file)},
        "files": records, "media_copies": copies, "readmes": 14, "original_requirement_records_unchanged": 102,
        "acceptance": progress["summary"], "fully_accepted": 0, "qualified_roles": 0,
        "verifier_sha256": digest(Path(__file__))}
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    (ARCHIVE / "receipt.json").write_text(json.dumps({"files": records, "scope": "Exact pre-refresh current document bytes; historical product evidence retains its original scope."}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": result["status"], "readmes": 14, "documents": len(records), "media_copies": len(copies)}))


if __name__ == "__main__":
    main()
