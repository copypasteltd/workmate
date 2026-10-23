"""Update bilingual delivery docs only after the selected video qualification."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
checkpoint = json.loads((ROOT / "docs/quality/desktop-video-checkpoint.json").read_text(encoding="utf-8"))
assert checkpoint["status"] == "verified_native_private_video_subset"
assert checkpoint["platform_tests"]["tests"] == 830 and checkpoint["native_ui_checks"] == 18
ui = checkpoint["selected"]["ui"]
base = "https://github.com/copypasteltd/workmate/blob/docs/docs/"
design = base + "technical/75-desktop-private-video.md"
proof = base + "quality/desktop-video-checkpoint.json"
archive = ROOT / "docs/quality/history/before-desktop-video-docs"
assert not archive.exists()
planned = []


def update(file, change):
    before = file.read_bytes()
    after = change(before.decode("utf-8")).encode()
    assert before != after, file
    planned.append((file, before, after))


zh = f"**当前实现：** Desktop 在客户本机运行 Codex，提供明确完整授权、文件/终端、同线程继续、原生追问和公司工具/费用；视频角色现支持私有工程、实际合成、播放、原生保存、版本修改和停止/撤权拦截。当前验证为平台 830 项、视频定向 58 项、真实原生 17 项、客户端 47 项及实际打包旅程 18 项；定向与全量重叠，不相加。17 个本机角色准入不等于完整专业验收；流程顾问、完整浏览器/应用自动化、18 角色/29 Skill 和生产验收继续跟踪。模型/图片响应及系统窗口决定明确模拟。Extension 保持原生右侧栏云端对话和获选文件上传。见 [实现方案]({design})、[源码与媒体检查点]({proof})。"
en = f"**Current implementation:** Desktop runs Codex on the customer device with explicit full access, local files/terminal, persistent threads, native questions and company tools/billing. The video role now supports private projects, actual composition/playback, native saves, version edits and stop/revocation fencing. Qualification covers 830 platform tests, 58 overlapping focused tests, 17 real-native tests, 47 client tests and 18 actual packaged-journey checks; counts overlap and are not additive. Seventeen native role admissions are not full professional acceptance. Workflow tools, complete browser/application automation, all eighteen roles/twenty-nine Skills and production acceptance remain open. Model/image responses and native-dialog choices are explicit fixtures. Extension retains right Side Panel cloud conversations and selected-file uploads. See [design]({design}) and [source/media checkpoint]({proof})."

for component in ("docs", "copypaste-platform", "copypaste-web", "copypaste-admin", "copypaste-desktop", "copypaste-extension", "copypaste-delivery"):
    directory = ROOT / "docs" if component == "docs" else ROOT / "dev" / component
    for english in (False, True):
        file = directory / ("README.en.md" if english else "README.md")
        def edit(text, english=english, component=component):
            text, count = re.subn(r"\*\*(?:当前实现：|Current implementation:)\*\*[^\n]*", en if english else zh, text, count=1)
            assert count == 1
            text = text.replace("下方架构图表示已实现的云端/文件桥接基线，不是 Desktop 本机 Agent 的目标架构。", "Desktop 在客户本机运行 Codex；Web 和 Extension 由公司云端执行。下方架构图按这一执行边界呈现。")
            text = text.replace("固定 Codex `0.163.0-alpha.10.2` 与 FFmpeg/FFprobe", "云端锁定 Codex `0.163.0-alpha.10.2` 与 FFmpeg/FFprobe；Desktop 独立锁定 `0.163.0-alpha.11`，以其运行时清单为准")
            text = text.replace("pinned Codex `0.163.0-alpha.10.2` and FFmpeg/FFprobe", "cloud-pinned Codex `0.163.0-alpha.10.2` and FFmpeg/FFprobe; Desktop independently pins `0.163.0-alpha.11` in its runtime manifest")
            text = text.replace("Desktop 当前选择 16 个已接通本机协议的预设", "Desktop 当前选择 17 个已接通本机协议的预设")
            text = text.replace("Desktop currently admits sixteen presets with the native protocol connected", "Desktop currently admits seventeen presets with the native protocol connected")
            text = text.replace("其中后端源码未变。阶段 74 另验证当前 Desktop", "阶段 74 时后端源码未变；阶段 74 另验证当时 Desktop")
            text = text.replace("its backend source is unchanged. Stage 74 separately verifies current Desktop", "backend source remained unchanged through stage 74. Stage 74 separately verifies its original Desktop source")
            text = text.replace("Latest company-tool update:", "Stage 73 company-tool update:").replace("Latest Desktop local execution:", "Stage 73 Desktop local execution:")
            text = text.replace("本次公司工具更新：", "阶段 73 公司工具历史更新：").replace("本次 Desktop 本机执行：", "阶段 73 Desktop 本机执行：")
            text = text.replace("验收后刷新未打包的界面源码摘要索引", "阶段 74 历史记录：当时验收后刷新未打包的界面源码摘要索引")
            text = text.replace("The unbundled renderer hash index was refreshed after qualification", "During stage 74, the unbundled renderer hash index was refreshed after qualification")
            if component == "docs":
                for label in ("Native supervisor evidence", "Current local candidate bytes", "本机内核证据", "本机候选包字节"):
                    text = text.replace(f"[{label}](quality/desktop-native-input-checkpoint.json)", f"[{label}](quality/desktop-video-checkpoint.json)")
            if component in ("docs", "copypaste-desktop"):
                text = text.replace("workmate-local-12-", f"workmate-local-{ui}-")
                text = text.replace("design/implementation/workmate/desktop-native-12-", f"design/implementation/workmate-local-{ui}-")
                text = text.replace("阶段 74：实际本机追问、回答继续、等待中止和撤权，以及既有本机文件/公司工具流程", "阶段 75：实际本机视频、版本修改、预览/原生保存、停止和撤权，以及既有本机追问、文件和公司图片流程")
                text = text.replace("Stage 74: actual native questions, answers, waiting cancellation/revocation and existing local file/company tools", "Stage 75: actual native video, revisions, playback/native saves, stop and revocation, plus native questions, files and company image tools")
                lines = text.splitlines(keepends=True)
                for index, line in enumerate(lines):
                    if line.startswith("[MP4](") and f"workmate-local-{ui}-" in line:
                        lines[index] = line.replace("desktop-native-input-checkpoint.json", "desktop-video-checkpoint.json").replace("technical/74-desktop-native-user-input.md", "technical/75-desktop-private-video.md")
                text = "".join(lines)
                prefix = f"assets/screenshots/workmate-local-{ui}-" if component == "copypaste-desktop" else f"design/implementation/workmate-local-{ui}-"
                marker = "![Actual local interaction]" if component == "copypaste-desktop" else "![desktop interaction]"
                assert marker in text
                gallery = f"![Actual private video playback]({prefix}video-ready-en.png)\n\n![Native video at 800x600]({prefix}video-compact-en.png)\n\n![Revoked native video]({prefix}video-revoke-en.png)\n\n"
                text = text.replace(marker, gallery + marker, 1)
            if component == "copypaste-desktop":
                coverage = ("Seventeen native role registrations cover software/page work, visual design, marketing analysis and private template-video tools. Admission and Skill hashes do not establish full professional qualification. Native workflow-consultant tools remain to be integrated. All eighteen product roles and twenty-nine Skills remain in scope, including full professional outcomes and browser/application automation. Current qualification covers 830 Platform tests, 58 overlapping video checks, 17 real-native tests, 47 client tests and 18 packaged-journey checks. Earlier 802/818-test reports and old cloud/file-bridge recordings retain their historical source scopes. The original 102 REQ/102 TC, NFR and G01–G10 baseline remains 81 partial, 21 unproven and zero fully accepted." if english else "17 个角色接通软件开发、页面、视觉设计、营销分析及私有模板视频的本机协议；准入及 Skill 摘要验证不等同完整专业工作流验收。workflow-consultant 本机工具仍待接通。产品 18 角色及 29 Skill 目标全部保留，包括完整专业效果及应用/浏览器自动化。当前限定验证为平台 830 项、重叠视频定向 58 项、真实原生 17 项、客户端 47 项及实际打包旅程 18 项。较早 802/818 项报告和云端/文件桥录屏保持当时源码范围。原 102 REQ/102 TC、NFR、G01–G10 仍为 81 项局部验证、21 项未证明、0 项完整验收。")
                text, count = re.subn(r"^(?:Sixteen native role registrations|16 个角色接通)[^\n]*", coverage, text, count=1, flags=re.M)
                assert count == 1
                text += ("\n## Private video projects\n\nChoose **Video & motion designer**, select a folder and grant the local access you want. Local Codex uses seven company tools: list, read, queue, status, edit, render and cancel. Queued means the composition is still pending; no download appears until all six private deliveries are available. The actual MP4 plays inline; authenticated MP4/timeline/script/storyboard/subtitle/check downloads use the native save chooser.\n\nFollow-up edits freeze a new expected version and preserve the earlier MP4. Explicit retries create a new render; status refresh never rerenders. Active task stop or revocation cancels only that task's pending origin jobs and fences late encoder publication. Revoking idle OS permission does not revoke an already accepted remote composition: its card can still cancel using current company project permissions. Same-project members cannot read the private definition or outputs.\n\nThe company service uses actual FFmpeg composition with zero AI media charge in this flow. Native reasoning retains its original server-observed budget and usage. Renderer profile 2 fixes minimum-landscape CTA layout; frozen profile 1 remains readable and requires an explicit new version to change its renderer. `renderer/src/local-video.tsx` owns the bounded state cards; `src/local-codex.ts` projects only safe ids and versions from actual tool results.\n" if english else "\n## 私有视频工程\n\n选择 **影片与动效设计师**、目录及所需本机授权。本机 Codex 使用列出、读取、排队、状态、修改、重做和取消七项公司工具。已排队仍表示制作未完成；六项私有产物全部可用后才显示下载。真实 MP4 可内嵌播放，成片、时间线、脚本、分镜、字幕和检查文件均经鉴权，并由原生保存窗口选路径。\n\n同线程修改基于明确版本，保留旧 MP4；明确重做创建新制作，刷新状态不会重做。活动任务停止/撤权只取消原任务未完成制作，并阻止迟到编码结果发布。空闲回合撤回 OS 权限不撤销已受理的公司制作，卡片仍可按当前公司项目权限取消。同项目其他成员不能读取私有定义和输出。\n\n公司服务实际运行 FFmpeg，本流程没有 AI 媒体费用；本机推理继续按原预算和服务端使用量结算。Renderer profile 2 修复最小横版 CTA 布局，旧 profile 1 可读取，升级渲染器需明确新版本。`renderer/src/local-video.tsx` 处理有界状态卡片；`src/local-codex.ts` 只从实际工具结果提取安全 id 与版本。\n")
            text += (f"\nStage 75 private-video update: [release notes]({base}changes/2026-10-23-desktop-private-video.en.md) · [current checkpoint]({proof}). Earlier reports retain their actual source scopes; platform/main-process qualification and later UI qualification are explicitly separated.\n" if english else f"\n阶段 75 私有视频更新：[更新说明]({base}changes/2026-10-23-desktop-private-video.md) · [当前检查点]({proof})。旧报告保留原始源码范围，平台/本机主进程验证与后续界面验证明确记录。\n")
            if component == "copypaste-delivery":
                text = text.replace("all 63 test files", "all 64 test files").replace("全部 63 个测试文件", "全部 64 个测试文件")
                text += ("\nFor the 58 overlapping private-video checks, run `node scripts/run-desktop-video-checks.mjs NN` with a fresh attempt. The full Platform inventory is currently 64 files/16 batches/830 tests. Actual native window sizes remain strict 800x600 assertions; failed attempts remain available and contribute no successful journey coverage.\n" if english else "\n视频定向 58 项检查使用 `node scripts/run-desktop-video-checks.mjs NN`，每次使用新编号；与全量重叠，不相加。当前平台完整清单为 64 文件/16 批次/830 项。实际窗口继续采用严格 800x600 断言；失败记录继续保留，不计成功旅程覆盖。\n")
            return text
        update(file, edit)

names = ("docs/00-document-map.md", "docs/technical/01-architecture-and-stack.md", "docs/technical/05-local-executor-and-browser.md",
    "docs/technical/08-development-and-delivery.md", "docs/technical/12-implementation-and-repositories.md",
    "docs/technical/69-desktop-local-codex-and-extension-direction.md", "docs/technical/70-desktop-native-codex-supervisor.md",
    "docs/technical/72-desktop-local-execution-and-control-plane.md", "docs/technical/73-desktop-native-company-tools.md", "docs/technical/74-desktop-native-user-input.md",
    "docs/product/03-information-architecture-and-interactions.md", "docs/modules/07-web-extension-desktop.md", "docs/requirements/03-client-execution-amendment.md",
    "docs/quality/09-implementation-alignment-audit.md", "docs/quality/02-requirements-traceability.md", "docs/DELIVERY.md")
for name in names:
    file = ROOT / name
    target = "technical/75-desktop-private-video.md" if file.parent.name == "docs" else "75-desktop-private-video.md" if file.parent.name == "technical" else "../technical/75-desktop-private-video.md"
    note = f"**阶段 75 当前增量：** Desktop 保持本机 Codex，视频角色接通七项公司工具、私有工程、真实合成、播放/保存、版本修改及停止/撤权控制。平台 830 项、重叠定向 58 项、原生 17 项、客户端 47 项和实际打包旅程 18 项通过；当前 17 个本机角色准入不等于全专业验收。见 [实现与源码证据]({target})。原 102 REQ/102 TC、NFR、G01–G10 和 81/21/0 状态保留；较早记录沿用其原始源码范围。"
    def edit_doc(text, note=note):
        first, rest = text.split("\n", 1)
        return first + "\n\n" + note + "\n" + rest.replace("**阶段 74 当前增量：**", "**阶段 74 历史基线：**")
    update(file, edit_doc)


def progress(text):
    data = json.loads(text)
    assert data["summary"] == {"partial_verified": 81, "completion_not_proven": 21}
    assert len(data["requirements"]) == 102 and data["fully_accepted_requirements"] == 0
    data["desktop_private_video_repair"] = {"at": datetime.now(timezone.utc).isoformat(), "stage": 75,
        "checkpoint": "desktop-video-checkpoint.json", "status": checkpoint["status"], "platform_tests": 830, "focused_overlapping_tests": 58,
        "native_tests": 17, "client_tests": 47, "packaged_ui_checks": 18, "native_role_admissions": 17, "baseline": checkpoint["baseline"], "remaining": checkpoint["limits"]}
    data["current_source_qualification"] = {"stage": 75, "checkpoint": "desktop-video-checkpoint.json", "note": "Backend/native main-process complete regression; explicit later UI-only changes separately qualified by actual packaged Electron. No reduction in original professional/production acceptance."}
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


update(ROOT / "docs/quality/requirements-alignment-progress.json", progress)
archive.mkdir(exist_ok=False)
manifest = []
for file, before, after in planned:
    saved = archive / (file.relative_to(ROOT).as_posix().replace("/", "__") + ".txt")
    saved.write_bytes(before)
    manifest.append({"path": file.relative_to(ROOT).as_posix(), "archive": saved.relative_to(ROOT).as_posix(), "before_sha256": sha256(before).hexdigest(), "after_sha256": sha256(after).hexdigest()})
for file, _, after in planned:
    file.write_bytes(after)
(archive / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
technical = ROOT / "docs/technical/75-desktop-private-video.md"
technical.write_text(technical.read_text(encoding="utf-8").replace("workmate-local-15-", f"workmate-local-{ui}-"), encoding="utf-8", newline="\n")
assert f"workmate-local-{ui}-video-ready-en.png" in technical.read_text(encoding="utf-8")
with technical.open("a", encoding="utf-8", newline="\n") as stream:
    stream.write("\n当前限定验证：平台 **830/830**（64 个测试文件、16 个固定批次），视频定向 **58/58**（与全量重叠），固定真实 Codex **17/17**，客户端 **47/47**，实际打包 Electron **18/18**。后端和本机主进程的全量检查之后有五项明确的界面/QA 源码调整，已由新的实际打包流程覆盖；旧全量报告未改写，其余平台及本机源码逐项未变。17 张截图及实际 GIF/MP4 按摘要与源码绑定。\n")
for english in (False, True):
    target = ROOT / ("docs/changes/2026-10-23-desktop-private-video.en.md" if english else "docs/changes/2026-10-23-desktop-private-video.md")
    text = ("# Native Desktop private video delivery\n\nThe local video specialist can now create private versioned projects, queue actual company composition, read status, edit, explicitly render and cancel. Six deliveries remain private; same-project members cannot read them. Active task stop/revocation fences late publication. After normal turn completion, explicit card cancellation uses company project permission even if idle OS permission was revoked.\n\nActual packaged Electron verifies native tool result roundtrips, real MP4 playback, native MP4/timeline saves, version preservation, stop and revocation, plus existing image/input/login flows. Renderer profile 2 fixes minimum-landscape CTA overflow without silently changing frozen profile 1. Earlier failed attempts and exact source scopes are retained.\n\nValidation: 830/830 platform tests across all 64 files and 16 batches; 58/58 overlapping focused tests; 17/17 real-native tests; 47/47 client tests; 18/18 packaged-journey checks; 17 actual screenshots and full GIF/MP4 decode. Five later UI-only sources are separately qualified by the current package; backend/native main-process sources remain unchanged. Model/image responses and native-dialog decisions are explicit fixtures.\n\nOriginal 102 REQ/TC, NFR and G01–G10 remain; 81 partial, 21 unproven, zero fully accepted. Workflow-consultant tools, complete browser/application automation, all-role professional outcomes and production distribution remain pending.\n\n[Implementation](../technical/75-desktop-private-video.md) · [Current checkpoint](../quality/desktop-video-checkpoint.json)\n" if english else "# Desktop 本机私有视频交付\n\n本机视频角色现可创建私有版本工程、排队实际公司制作、查询状态、修改、明确重做和取消。六项产物保持私有，同项目其他成员不能读取。活动任务停止/撤权拦截迟到发布；正常回合结束后，即使撤回空闲 OS 权限，客户仍可按公司项目权限点击卡片取消。\n\n实际打包 Electron 验证原生工具结果回传、真实 MP4 播放、原生 MP4/时间线保存、版本保留、停止和撤权，并重跑既有图片、追问和登录流程。Renderer profile 2 修复最小横版 CTA 溢出，不静默更改冻结的 profile 1。保留此前失败记录及确切源码范围。\n\n验证：64 文件、16 批次的平台 830/830 项；重叠定向 58/58 项；真实原生 17/17 项；客户端 47/47 项；实际打包旅程 18/18 项；17 张实际截图及 GIF/MP4 完整解码。全量检查后的五项界面源码另由当前打包验证，后端及本机主进程源码未变。模型/图片响应和系统窗口决定明确模拟。\n\n原 102 REQ/TC、NFR、G01–G10 保留，仍为 81 部分、21 未证明、0 项完整通过。流程顾问本机工具、完整浏览器/应用自动化、全部角色专业效果和生产分发继续验收。\n\n[实现细则](../technical/75-desktop-private-video.md) · [当前检查点](../quality/desktop-video-checkpoint.json)\n")
    with target.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(text)
print(json.dumps({"updated": len(planned), "readmes": 14, "acceptance_baseline": checkpoint["baseline"]}))
