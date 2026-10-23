"""Update bilingual delivery docs and actual media after workflow qualification."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
checkpoint_path = ROOT / "docs/quality/desktop-workflow-checkpoint.json"
checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
assert checkpoint["status"] == "verified_bounded_native_workflow_subset"
ui = checkpoint["selected"]["ui"]
total = checkpoint["platform_tests"]["tests"]
focused = checkpoint["focused_overlapping_tests"]["tests"]
base = "https://github.com/copypasteltd/workmate/blob/docs/docs/"
design = base + "technical/76-desktop-native-workflows.md"
proof = base + "quality/desktop-workflow-checkpoint.json"
archive = ROOT / "docs/quality/history/before-stage76-docs"
assert not archive.exists(), "Preserve the existing documentation update"
planned = []


def update(file, edit):
    before = file.read_bytes()
    after = edit(before.decode("utf-8")).encode("utf-8")
    if before != after:
        planned.append((file, before, after))


zh = f"**当前实现：** Desktop 在客户本机运行 Codex，提供明确完整授权、本机文件/终端、同线程继续、原生追问及公司图片/设计/视频工具。流程顾问现可使用不可变私有流程、追加子步骤费用确认、人工逐步审批和真实本机角色子 Codex；支持真实 SOP/JSON/恢复说明下载、Stop/撤权及内容来源治理。当前验证为平台 {total} 项、重叠定向 {focused} 项、真实父子流程 3 项、本机内核回归 17 项、客户端 56 项和实际打包旅程 19 项；这些范围分别报告，不相加。18 个角色已通过本机协议准入，全部 18 角色/29 Skill 的完整专业交付、浏览器/第三方应用操作与 Codex Desktop 全面能力对齐、真实模型及生产验收继续跟踪。模型响应与系统窗口决定明确模拟。Extension 保持 ChatGPT 式原生右侧栏、获选文件读取上传和云端 Agent，无需 Desktop；本轮未重新执行 Extension UI。见 [实现方案]({design})、[源码与媒体检查点]({proof})。"
en = f"**Current implementation:** Desktop runs Codex on the customer device with explicit full access, local files/terminal, persistent threads, native questions and governed image/design/video tools. The workflow consultant now uses immutable private workflows, separate child-step fee consent, human step approvals and actual native specialist children, with real SOP/JSON/recovery downloads, Stop/revoke and source governance. Qualification covers {total} platform tests, {focused} overlapping focused checks, 3 real parent/child workflow checks, 17 native-supervisor regressions, 56 client tests and 19 actual packaged-journey checks; scopes are separate and not additive. All 18 roles have native protocol admission. Full professional delivery across 18 roles/29 Skills, complete browser/third-party application operations and Codex Desktop parity, live models and production acceptance remain pending. Model responses and native-dialog choices are explicit fixtures. Extension retains ChatGPT-style right Side Panel cloud chat and selected-file reading/upload without Desktop; its UI was not rerun this stage. See [design]({design}) and [source/media checkpoint]({proof})."
readmes = []
for component in ("docs", "platform", "web", "admin", "desktop", "extension", "delivery"):
    repo = ROOT / "docs" if component == "docs" else DEV / ("copypaste-" + component)
    for name in ("README.md", "README.en.md"):
        english = name.endswith(".en.md")
        file = repo / name
        readmes.append(file)
        def edit(text, english=english, component=component):
            assert "desktop-native-workflow-stage76" not in text
            assert "<!-- client01-direction -->" in text or (component == "desktop" and ("frameless" in text.lower() or "无边框" in text))
            text, n = re.subn(r"^\*\*(?:当前实现：|Current implementation:)\*\*.*$", en if english else zh, text, count=1, flags=re.M)
            assert n == 1
            text = re.sub(r"^17 个角色接通软件开发.*$", f"18 个角色现可在客户本机启动 Codex，流程顾问使用本机子角色执行。协议准入、Skill 摘要及本轮有界流程验证不等同全部专业成果验收。当前平台 {total} 项、重叠定向 {focused} 项、真实父子流程 3 项、本机内核 17 项、客户端 56 项、打包旅程 19 项分别通过。18 角色/29 Skill、完整浏览器/应用操作及原 102 REQ/TC、NFR、G01–G10 保留；81 部分 / 21 未证明 / 0 完整验收。", text, flags=re.M)
            text = re.sub(r"^Seventeen native role registrations.*$", f"All 18 roles now admit customer-device Codex; the workflow consultant uses actual native specialist children. Protocol admission and Skill hashes are not complete professional qualification. Current evidence covers {total} platform tests, {focused} overlapping focused checks, 3 real workflow cases, 17 supervisor regressions, 56 client tests and 19 packaged checks. All 18 roles/29 Skills, full browser/application operation and the original 102 REQ/TC, NFR and G01–G10 remain in scope at 81 partial / 21 unproven / zero fully accepted.", text, flags=re.M)
            text = text.replace("The full Platform inventory is currently 64 files/16 batches/830 tests.", "The stage-75 full Platform inventory was 64 files/16 batches/830 tests.")
            text = text.replace("当前平台完整清单为 64 文件/16 批次/830 项。", "阶段 75 当时的平台完整清单为 64 文件/16 批次/830 项。")
            text = text.replace("It fixes all 64 test files and source hashes before execution", "It fixes the complete actual test-file inventory and source hashes before execution")
            text = text.replace("records sixteen independently owned batches", f"records {checkpoint['inventory']['batches']} independently owned batches for the current inventory")
            text = text.replace("The current company-tool checkpoint selects", "The historical stage-73 company-tool checkpoint selected")
            prefix = "assets/screenshots/" if component == "desktop" else "design/implementation/" if component == "docs" else "https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/"
            gallery = f"![{'Native workflow fee confirmation' if english else '本机流程费用确认'}]({prefix}workmate-local-{ui}-workflow-fees-en.png)\n\n![{'Native workflow complete' if english else '本机流程完成'}]({prefix}workmate-local-{ui}-workflow-completed-zh.png)\n\n"
            if component in ("desktop", "docs"):
                gallery += f"![{'Actual packaged interaction' if english else '实际打包客户端交互'}]({prefix}workmate-local-{ui}-local-agent.gif)\n\n[MP4]({prefix}workmate-local-{ui}-local-agent.mp4) · [800×600]({prefix}workmate-local-{ui}-workflow-compact-en.png)\n\n"
            if english:
                details = "Choose Workflow consultant, select a folder and explicitly grant the desired local permission. Describe the work and agree its frozen steps. Review the separate per-child budgets and approve the exact version before a child can reserve money or run. Approve any concrete human step before the next specialist starts. Review real files, private SOP/workflow JSON/recovery downloads and company usage; this conversation and incomplete steps have separate charges. Stop or revoke to terminate local parent and child processes; unknown accepted actions retain reconciliation state and never replay automatically.\n\nThe first workflow subset permits up to eight sequential native Codex, human approval or analytics-summary steps. Every child uses its own approved role Skills, company tools and scoped credentials while retaining the current explicit local grant. Local full access does not grant another customer's data, project rights or unlimited budget. Company cloud Workers and schedules cannot take over native workflows. Each immutable version freezes actual external input provenance across new sessions and derived SOPs, without depending on the creator task lifetime. Source withdrawal also governs first reads, cached calls, child admission and private or explicitly published derivatives; administrators use existing permission/MFA/reason/audit controls. Closing the app fences requests still waiting for their local journal write.\n\n"
                details += f"Current platform inventory: {checkpoint['inventory']['test_files']} actual test files / {checkpoint['inventory']['batches']} complete batches / {total} passing tests; all 830 stage-75 cases remain covered. SQL001–093 remain unchanged; SQL094 adds native workflow provenance and immutable versions. The actual 428-route inventory retains all prior 415 routes. Original 102 REQ/102 TC, NFR and G01–G10 remain open at 81 partial / 21 unproven / 0 fully accepted. Earlier evidence and media retain their original source scope.\n\n"
            else:
                details = "选择「流程顾问」、本机目录并明确授予所需本机权限。描述要求并确认冻结的流程步骤；执行前另行查看每个子角色的预算和合计，批准具体版本后才预留费用、启动本机子 Codex。遇到人工审批步骤须再次明确批准，之后才运行下一角色。查看真实本机文件、私有 SOP/流程 JSON/恢复说明下载与公司用量记录；顾问对话及未完成步骤分别计费。Stop 或撤权会终止本机父子进程；已受理但结果未知的操作保留待对账状态，不会自动重放。\n\n首个子集支持最多八步的顺序本机 Codex、人工审批及广告汇总。每个子角色使用独立的 Skills、公司工具和推理凭据，沿用客户当前明确授予的目录及本机权限。完整本机权限不扩大公司的客户数据、项目权限或预算；云端 Worker 与定时任务不能接管本机流程。每个流程版本从真实读取账本冻结外部来源，复用到新会话及派生 SOP 时仍保留；旧创建任务删除不会替代外部来源的有效性判断。来源停用同时约束首次读取、缓存、子任务启动和私有或明确发布的衍生成果；管理员继续遵守权限、MFA、原因及审计控制。关闭应用也会阻止仍等待日志落盘的请求稍后启动。\n\n"
                details += f"当前平台完整清单为 {checkpoint['inventory']['test_files']} 个实际测试文件、{checkpoint['inventory']['batches']} 个完整批次、{total} 项通过，保留阶段 75 全部 830 项回归。SQL001–093 未改写；SQL094 增加本机流程来源与不可变版本。实际 428 条接口清单保留此前全部 415 条。原 102 REQ/102 TC、NFR 和 G01–G10 维持 81 项部分验证 / 21 项未证明 / 0 项完整验收；旧证据及媒体仅证明其原始源码。\n\n"
            diagram = "```mermaid\nflowchart LR\n    User[Customer] --> Consent[Desktop main: permission and fee consent]\n    Consent --> Local[Local consultant Codex]\n    Local --> API[Company identity, sources and usage]\n    API --> Consent\n    Consent --> Children[Local role Codex children]\n    Children --> API\n    Children --> Approval[Human step approval]\n    Approval --> Consent\n    Children --> Files[Real files and private deliveries]\n    Extension[Chrome right Side Panel and files] --> Cloud[Company cloud Codex]\n```\n\n"
            if component == "delivery":
                details += ("Run each database-owning verifier sequentially with a fresh two-digit NN and an absolute pinned `COPYPASTE_LOCAL_CODEX_TEST_BIN`. Use `node scripts/run-desktop-workflow-checks.mjs NN` for focused API/provenance checks, add `--native` for the three actual workflow cases, and use `node scripts/run-local-codex-checks.mjs NN` for supervisor regressions. For the complete inventory, initialize `node scripts/run-desktop-platform-resumable.mjs NN --init`, run `--next` once per planned batch and then `--finish`; do not edit covered sources during a run. For actual packaged interaction, set `COPYPASTE_LOCAL_CODEX_BIN` to that same pinned binary and run `node scripts/run-desktop-local-ui.mjs NN`. These owned checks refuse occupied ports and reclaim only their UUID fixtures. Failures remain immutable.\n\n" if english else "按顺序运行各数据库核查，每次使用新的两位编号 NN，并设置绝对路径 `COPYPASTE_LOCAL_CODEX_TEST_BIN` 为固定摘要的真实 Codex。定向接口/来源检查：`node scripts/run-desktop-workflow-checks.mjs NN`；追加 `--native` 执行三项真实父子流程；`node scripts/run-local-codex-checks.mjs NN` 检查本机内核。完整清单使用 `node scripts/run-desktop-platform-resumable.mjs NN --init`，按计划逐批运行 `--next`，最后 `--finish`；期间不修改覆盖源码。实际打包旅程另设 `COPYPASTE_LOCAL_CODEX_BIN` 为相同二进制，运行 `node scripts/run-desktop-local-ui.mjs NN`。核查拒绝采用占用端口，仅回收其 UUID 夹具；失败证据不可覆盖。\n\n")
            return text + "\n<!-- desktop-native-workflow-stage76 -->\n\n" + ("## Native workflows and verification\n\n" if english else "## 本机流程与核查\n\n") + details + diagram + gallery + f"[{'Design and lifecycle' if english else '设计与生命周期'}]({design}) · [{'Bound evidence' if english else '绑定证据'}]({proof}) · [{'Change notes' if english else '更新说明'}]({base}changes/2026-10-23-desktop-native-workflows.md)\n"
        update(file, edit)

names = ("00-document-map.md", "technical/01-architecture-and-stack.md", "technical/05-local-executor-and-browser.md", "technical/08-development-and-delivery.md", "technical/12-implementation-and-repositories.md", "technical/69-desktop-local-codex-and-extension-direction.md", "technical/70-desktop-native-codex-supervisor.md", "technical/72-desktop-local-execution-and-control-plane.md", "technical/73-desktop-native-company-tools.md", "technical/74-desktop-native-user-input.md", "technical/75-desktop-private-video.md", "product/03-information-architecture-and-interactions.md", "modules/07-web-extension-desktop.md", "requirements/03-client-execution-amendment.md", "quality/09-implementation-alignment-audit.md", "quality/02-requirements-traceability.md", "DELIVERY.md")
for name in names:
    file = ROOT / "docs" / name
    target = "technical/76-desktop-native-workflows.md" if file.parent.name == "docs" else "76-desktop-native-workflows.md" if file.parent.name == "technical" else "../technical/76-desktop-native-workflows.md"
    note = f"**阶段 76 当前增量：** Desktop 流程由本机父子 Codex 执行，新增不可变私有版本、独立子费用确认、人工审批、真实成果下载、Stop/撤权与来源治理；平台 {total} 项、重叠定向 {focused} 项、真实父子流程 3 项、原生内核 17 项、客户端 56 项、实际打包旅程 19 项通过。18 个本机角色协议准入不代表完整专业验收；102 REQ/102 TC、NFR、G01–G10 和 81/21/0 保留。Extension 继续原生右侧栏获选文件上传与云端 Agent，本轮按相同产品及验证器字节复核，未增加其 UI 计数。见 [实现与证据]({target})。"
    update(file, lambda text, note=note: text.split("\n", 1)[0] + "\n\n" + note + "\n" + text.split("\n", 1)[1].replace("**阶段 75 当前增量：**", "**阶段 75 历史基线：**"))

def progress(text):
    data = json.loads(text)
    assert len(data["requirements"]) == 102 and data["fully_accepted_requirements"] == 0
    data["desktop_native_workflow_repair"] = {"stage": 76, "checkpoint": "desktop-workflow-checkpoint.json", "status": checkpoint["status"], "platform_tests": total, "focused_overlapping_tests": focused, "actual_native_children": 3, "native_supervisor_tests": 17, "client_tests": 56, "packaged_ui_checks": 19, "native_role_admissions": 18, "professional_acceptance": "pending"}
    data["current_source_qualification"] = {"stage": 76, "checkpoint": "desktop-workflow-checkpoint.json", "note": "Bounded native workflow subset; original acceptance unchanged. See exact source differences and explicit synthetic provider/dialog scope."}
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"

update(ROOT / "docs/quality/requirements-alignment-progress.json", progress)
update(ROOT / "docs/technical/76-desktop-native-workflows.md", lambda text: text.replace("状态：实现中，尚未开放本机流程顾问；上一轮通过的 17 个角色与 SQL001–093 保持历史证据。本文记录 CLIENT01 下的修复目标，不表示新增功能已验收。", f"状态：已验证有界本机流程子集；18 个角色通过本机协议准入，完整专业交付仍待验收。平台 {total} 项、重叠定向 {focused} 项、真实父子流程 3 项、本机内核 17 项、客户端 56 项和实际打包旅程 19 项分别通过。权威源码及媒体范围见 [检查点](../quality/desktop-workflow-checkpoint.json)。SQL001–093 保留。")
    .replace("Implementation in progress; native workflow admission remains closed until verification.", "The bounded native workflow subset is verified with explicit synthetic Responses and customer-dialog decisions; full professional and production acceptance remains pending."))

archive.mkdir()
manifest = []
for file, before, after in planned:
    saved = archive / (file.relative_to(ROOT).as_posix().replace("/", "__") + ".txt")
    saved.write_bytes(before)
    file.write_bytes(after)
    manifest.append({"path": file.relative_to(ROOT).as_posix(), "archive": saved.relative_to(ROOT).as_posix(), "before_sha256": sha256(before).hexdigest(), "after_sha256": sha256(after).hexdigest()})
(archive / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
for item in checkpoint["screenshots"] + checkpoint["media"]["files"]:
    source = DEV / item["path"]
    assert sha256(source.read_bytes()).hexdigest() == item["sha256"]
    target = ROOT / "docs/design/implementation" / source.name
    assert not target.exists()
    shutil.copyfile(source, target)
    checkpoint["documentation_media"].append({"source": source.relative_to(ROOT).as_posix(), "path": target.relative_to(ROOT).as_posix(), "sha256": item["sha256"]})
checkpoint_path.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
changes = ROOT / "docs/changes/2026-10-23-desktop-native-workflows.md"
assert not changes.exists()
changes.write_text(f"""# 本机流程顾问 / Native workflow consultant

Desktop 的流程顾问现在由客户本机的父子 Codex 执行。公司服务管理不可变私有版本、当前身份与内容权限、独立费用预留和使用收据；云端 Worker 与定时任务不会接管本机步骤。首个子集支持最多八步的本机 Codex、人工审批和广告汇总。

客户先授予本机目录与权限，再确认当前顾问对话之外的子步骤预算；遇到人工审批须再次确认具体事项。真实本机开发与 QA 子角色使用独立 Skills、公司工具和推理凭据。SOP、可执行流程 JSON 与恢复说明可私有下载。完整 OS 权限不扩大公司数据或预算权限。

Stop 与撤权的真实检查确认父子进程均退出，等待 10 秒后没有出现已中止命令预定的后续写入。已受理但结果未知的公司工具保留未知错误及费用核对状态，不会为使界面成功而伪造结果。另修复应用关闭与请求落盘竞态：关闭之后不能再启动仍在等待落盘的任务。

SQL094 新增流程版本、读取来源、运行修订、父子绑定与取消传播，不改写 SQL001–093。来源隔离会约束缓存读取、子任务启动、私有交付和明确发布的衍生 SOP。管理员沿用既有权限、MFA、原因和审计控制，预览增加本机版本及运行信息。实际接口清单同步至 428 条，保留此前全部 415 条。

复查还修复了可复用流程遗漏原始外部来源的缺口：每个版本从真实读取账本冻结来源，新会话、派生版本及 SOP 发布继续继承。原文件隔离后首次读取、缓存、子任务和下载均受约束；旧创建任务删除后仍可保留合法可复用流程。来源由数据库计算且不可改写，受控擦除同时清理来源正文。发现缺口后停止了完整回归 17 的驱动，活动第 13 批正常结束并关闭自有数据库；13/17 批共 707 项通过只作为历史部分运行保留。修复后重新执行完整清单及定向、真实父子流程与打包交互，旧通过结果不作为修改后来源逻辑的证明。

当前选定证据：平台 {total}/{total}；重叠定向 {focused}/{focused}；真实父子流程 3/3；本机内核 17/17；客户端 56/56；实际打包旅程 19/19。交互包含费用、逐步审批、真实下载、双语重载及实际 800×600 窗口。模型响应、系统对话框选择和部分设计输入明确采用已获授权的假数据；二进制、文件、身份、权限、公司收据、合成及下载字节实际运行。

保留定向 01/02、原生流程 01/02 和完整回归 16 第 10 批的失败证据；原生 01 因夹具误读追加 Skills 消息与错误清理而中断，仅清理其精确 UUID 测试数据库及自有进程，不计验证覆盖。原生 02 暴露核查脚本错误期待取消返回成功，修正脚本后继续保留产品未知结果语义。回归 16 的两处迁移测试仍断言最新版本 93，已仅改为新增版本 94，原财务/历史保留断言不变，并从头重新执行完整清单。当前检查点列出每份原始报告和源码范围；选定的定向、本机父子流程、打包交互与完整回归均执行于来源修复后的冻结源码。独立内核回归仅覆盖未变化的 Desktop 源码，不把旧后端证据当作执行了新增迁移或测试。

Extension 的 31 项产品/构建/测试文件和三项验证器与既有通过记录逐字节相同；仍为 ChatGPT 式 Chrome 原生右侧栏、客户明确选取文件并上传公司云端 Codex，无需 Desktop。本轮没有新增 Extension UI 运行。

18 个角色的本机协议准入不代表全部专业成果验收。18 角色/29 Skill、原 102 REQ/102 TC、NFR、G01–G10 保留；状态仍为 81 部分 / 21 未证明 / 0 完整验收。完整浏览器/第三方应用操作、跨设备与定时本机流程、真实内部模型和完整生产交付继续跟踪。

## English

Desktop now runs the bounded workflow consultant and specialist children on the customer's computer. Immutable private versions, explicit additional child budgets, human step approvals, real local developer/QA files, private SOP/JSON/recovery downloads and company usage receipts are verified. The cloud Worker cannot take over. Stop and revoke terminate both native processes and prevent delayed writes; unknown accepted actions retain reconciliation state and never replay automatically. App shutdown now fences requests still awaiting journal persistence.

SQL094 adds native provenance and immutable versions while SQL001–093 remain unchanged. Source withdrawal governs cached reads and published derivatives. The actual 428-route inventory retains all 415 prior routes. Evidence covers {total} platform, {focused} overlapping focused, 3 actual workflow, 17 supervisor, 56 client and 19 packaged-journey checks. Synthetic model/dialog decisions are explicit; binary, filesystem, auth, permission, ledger and download behavior is real. Failed attempts remain preserved. Extension sources/verifiers are unchanged; no new Extension UI run is claimed. Native admission for 18 roles is not full professional or production acceptance; the original 102 requirements and all acceptance gates remain intact.

Review also found and fixed missing external provenance when a saved native workflow was reused in a new session. Database-computed immutable snapshots now retain original inputs through derived versions and published SOPs, without requiring the creator task to live forever. First reads, cached calls, child admission and downloads reject withdrawn sources. Control17 was superseded after 13/17 batches and 707 passing cases, with its active batch finishing and closing its database normally; this partial run is retained, not counted as a current full regression. The selected full, focused, native-workflow and packaged-UI proofs were rerun after the correction.

[设计](../technical/76-desktop-native-workflows.md) · [检查点](../quality/desktop-workflow-checkpoint.json) · [真实交互 GIF](../design/implementation/workmate-local-{ui}-local-agent.gif)
""", encoding="utf-8")
print(json.dumps({"bilingual_readmes": len(readmes), "documents_updated": len(planned), "actual_media_copied": len(checkpoint["documentation_media"])}))
