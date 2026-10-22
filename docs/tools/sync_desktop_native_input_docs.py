"""Refresh current product docs after a verified native-input checkpoint."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
checkpoint = json.loads((ROOT / "docs/quality/desktop-native-input-checkpoint.json").read_text(encoding="utf-8"))
assert checkpoint["status"] == "verified_native_input_subset"
ui = checkpoint["selected"]["ui"]
base = "https://github.com/copypasteltd/workmate/blob/docs/docs/"
design = base + "technical/74-desktop-native-user-input.md"
proof = base + "quality/desktop-native-input-checkpoint.json"
archive = ROOT / "docs/quality/history/before-desktop-native-input-docs"
assert not archive.exists()
planned = []


def update(file, change):
    before = file.read_bytes()
    result = change(before.decode("utf-8"))
    assert result != before.decode("utf-8"), file
    planned.append((file, before, result.encode("utf-8")))


zh = f"**当前实现：** Desktop 在客户本机运行 Codex，支持明确完整授权、文件/终端、同线程继续和公司工具/费用；现已接通原生追问、选择/自填回答，以及等待时停止和撤权。当前源码通过 47 项客户端测试、17 项真实原生测试和 12 项实际打包 Electron 旅程检查。后端源码未变，沿用阶段 73 的 818 项完整回归范围。16 角色的本机协议接通不等于完整专业验收；视频/流程工具、完整浏览器/应用自动化、18 角色/29 Skill 及生产验收继续跟踪。供应商响应和系统窗口决定明确模拟。Extension 继续使用原生右侧栏云端对话与获选文件上传。见 [实现方案]({design})、[源码和媒体证据]({proof})。"
en = f"**Current implementation:** Desktop runs Codex on the customer device with explicit full access, local files/terminal, persistent threads and company tools/billing. Native questions now support explicit options/free text, stop and revocation while waiting. Current source passes 47 client tests, 17 real-native tests and 12 actual packaged-Electron journey checks. Unchanged backend source retains its stage 73 complete 818-test regression scope. Sixteen admitted native role protocols are not full professional qualification; video/workflow tools, complete browser/application automation, all eighteen roles/twenty-nine Skills and production acceptance remain open. Provider responses and native-dialog decisions are explicit fixtures. Extension retains native right Side Panel cloud conversations and selected-file uploads. See [design]({design}) and [source/media evidence]({proof})."

for folder in (ROOT / "docs", *(ROOT / "dev").glob("copypaste-*")):
    for name in ("README.md", "README.en.md"):
        file = folder / name
        if not file.is_file():
            continue
        english = name == "README.en.md"

        def edit(text, english=english, component=folder.name):
            text, count = re.subn(r"^\*\*(?:当前实现：|Current implementation:).*?$", en if english else zh, text, count=1, flags=re.M)
            assert count == 1
            text = text.replace("Desktop 支持同一本机线程继续，原生等待输入界面仍待接入", "Desktop 支持同一本机线程继续，并可在原任务/回合回答原生追问")
            text = text.replace("Desktop supports same-local-thread follow-up; native waiting-input UI remains to be integrated.", "Desktop supports same-thread follow-up and answering native questions in the original task and turn.")
            text = text.replace("完整本机媒体/设计/营销、本机等待输入界面、应用与浏览器自动化须分别接入验证。", "完整本机媒体/设计/营销、应用与浏览器自动化继续逐项接入验证；原生追问已按阶段 74 的当前源码检查点验证。")
            text = text.replace("complete native media/design/marketing integrations and native waiting-input UI and app/browser automation need separate implementation and qualification.", "complete native media/design/marketing integrations and app/browser automation need separate implementation and qualification. Native questions are verified for the current stage 74 source.")
            if component in ("docs", "copypaste-desktop"):
                text = text.replace("desktop-native-09-", "desktop-native-" + ui + "-").replace("workmate-local-09-", "workmate-local-" + ui + "-")
                text = text.replace("阶段 73：实际打包本机 Codex、完整权限流程、公司图片与私有下载；模型/图片响应及系统窗口决定为明确夹具。", "阶段 74：实际本机追问、回答继续、等待中止和撤权，以及既有本机文件/公司工具流程；模型/图片及系统窗口决定为明确夹具。")
                text = text.replace("Stage 73: actual packaged local Codex, full-access flow, company images and private downloads; model/image responses and native dialog decisions are explicit fixtures.", "Stage 74: actual native questions, answers, waiting cancellation/revocation and existing local file/company tools; model/image responses and native-dialog choices are explicit fixtures.")
                prefix = "assets/screenshots/workmate-local-" + ui + "-" if component == "copypaste-desktop" else "design/implementation/workmate/desktop-native-" + ui + "-"
                marker = "![Actual local interaction]" if component == "copypaste-desktop" else "![desktop interaction]"
                gallery = f"![Native customer question]({prefix}waiting-input-en.png)\n\n![Explicit answer at minimum window size]({prefix}input-compact-en.png)\n\n"
                assert marker in text
                text = text.replace(marker, gallery + marker, 1)
            if component == "copypaste-desktop":
                text += ("\n## Native questions and continuing work\n\nQuestions appear inside the local conversation without a preselected answer. Answer every question, then choose **Answer and continue**; the same native task/thread/turn and reservation continue. Renderer reload preserves a live question. Stop, revocation, sign-out and app close cancel it; stale or duplicate answers are rejected. Question/answer fields are temporary main-process state, but submitted answers still reach native Codex history and company model context. At the minimum window size the inactive composer and large page heading collapse to leave room for questions; fixed Stop and the budget remain available.\n\nThe narrow `answer` IPC carries only the session id, one-time request id and validated answers. `src/local-input.ts` bounds the protocol; `local-codex.ts` keeps human waiting outside the event queue; `local-agent.ts` rechecks ownership, permission and the company execution before delivery.\n" if english else "\n## 本机追问与继续工作\n\n问题出现在本机对话中，选项不预选。完整回答后点击 **回答并继续**，沿用原任务、原线程、原回合和原预留。刷新页面保留仍在等待的问题；停止、撤权、登出和关闭清除等待，旧回答和重复提交被拒绝。问题/答案字段只作主进程临时状态，但提交内容仍会进入 Codex 本机记录和公司模型上下文。最小窗口等待时收起不可用输入框和大标题，给问题留出空间；固定停止和预算仍可访问。\n\n受限 `answer` IPC 只传会话 id、一次性问题 id 和校验后的答案。`src/local-input.ts` 负责有界协议，`local-codex.ts` 保证人工等待不阻塞事件队列，`local-agent.ts` 在交付前重验归属、权限和公司执行状态。\n")
            text += (f"\nStage 74 native-input update: [release notes]({base}changes/2026-10-23-desktop-native-input.en.md) · [current checkpoint]({proof}). Earlier reports/media retain their original source scopes.\n" if english else f"\n阶段 74 本机追问更新：[更新说明]({base}changes/2026-10-23-desktop-native-input.md) · [当前源码检查点]({proof})。较早报告及媒体保留原始源码范围。\n")
            return text
        update(file, edit)

names = (
    "docs/00-document-map.md", "docs/technical/01-architecture-and-stack.md", "docs/technical/05-local-executor-and-browser.md",
    "docs/technical/08-development-and-delivery.md", "docs/technical/12-implementation-and-repositories.md",
    "docs/technical/69-desktop-local-codex-and-extension-direction.md", "docs/technical/70-desktop-native-codex-supervisor.md",
    "docs/technical/72-desktop-local-execution-and-control-plane.md", "docs/technical/73-desktop-native-company-tools.md",
    "docs/product/03-information-architecture-and-interactions.md", "docs/modules/07-web-extension-desktop.md",
    "docs/requirements/03-client-execution-amendment.md", "docs/quality/09-implementation-alignment-audit.md",
    "docs/quality/02-requirements-traceability.md", "docs/DELIVERY.md",
)
for name in names:
    file = ROOT / name
    target = Path("technical/74-desktop-native-user-input.md") if file.parent.name == "docs" else Path("74-desktop-native-user-input.md") if file.parent.name == "technical" else Path("../technical/74-desktop-native-user-input.md")
    note = f"**阶段 74 当前增量：** 本机 Codex 的追问、选择/自填回答、同任务回合继续、等待时停止及撤权已接通；当前 Desktop 有 47 项客户端、17 项真实原生和 12 项实际打包旅程检查。后端源码未变，沿用阶段 73 的 818 项完整回归范围。详见 [方案与限定证据]({target.as_posix()})。18 角色/29 Skill 及全部原始验收范围保留，以下较早记录保持各自原始源码边界。"
    def edit_doc(text, note=note):
        first, rest = text.split("\n", 1)
        return first + "\n\n" + note + "\n" + rest.replace("**阶段 73 当前增量：**", "**阶段 73 历史基线：**")
    update(file, edit_doc)


def progress(text):
    data = json.loads(text)
    data["desktop_native_input_repair"] = {
        "at": datetime.now(timezone.utc).isoformat(), "stage": 74, "checkpoint": "desktop-native-input-checkpoint.json",
        "status": checkpoint["status"], "native_tests": 17, "client_tests": 47, "packaged_ui_checks": 12,
        "unchanged_backend_regression_tests": 818, "baseline": checkpoint["baseline"], "remaining": checkpoint["limits"],
    }
    data["current_source_qualification"] = {"stage": 74, "checkpoint": "desktop-native-input-checkpoint.json", "note": "Current native Desktop input lifecycle and actual packaged UI; unchanged backend retains stage 73 complete regression. Professional and production acceptance remain open."}
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


update(ROOT / "docs/quality/requirements-alignment-progress.json", progress)
archive.mkdir(parents=True, exist_ok=False)
manifest = []
for file, before, after in planned:
    relative = file.relative_to(ROOT).as_posix()
    saved = relative.replace("/", "__") + ".txt"
    (archive / saved).write_bytes(before)
    manifest.append({"path": relative, "archive": saved, "before_sha256": sha256(before).hexdigest(), "after_sha256": sha256(after).hexdigest()})
for file, _, after in planned:
    file.write_bytes(after)
(archive / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"updated": len(planned), "readmes": sum(file.name.startswith("README") for file, _, _ in planned)}))
