"""Update current project pointers without changing original acceptance records."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ACTIVE = ["docs/00-document-map.md", "docs/DELIVERY.md", "docs/product/01-prd.md", "docs/product/02-user-journeys.md",
    "docs/product/03-information-architecture-and-interactions.md", "docs/product/08-admin-dashboard.md",
    "docs/requirements/03-client-execution-amendment.md", "docs/requirements/04-desktop-layout-and-scroll.md",
    "docs/technical/01-architecture-and-stack.md", "docs/technical/06-media-and-data-pipelines.md",
    "docs/technical/08-development-and-delivery.md", "docs/technical/11-admin-control-plane.md", "docs/technical/12-implementation-and-repositories.md",
    "docs/quality/02-requirements-traceability.md", "docs/quality/04-implementation-acceptance.md", "docs/quality/09-implementation-alignment-audit.md"]


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/audio-production-project-docs.json"
    assert not output.exists()
    checkpoint_file = ROOT / "docs/quality/audio-production-checkpoint.json"
    proof = read(checkpoint_file)
    assert proof["status"] == "verified_internal_audio_subflow"
    baseline = read(ROOT / "docs/quality/history/stage84-before-audio/receipt.json")
    originals = {row["source"]: row for row in baseline["files"]}
    updates = []
    for name in ACTIVE:
        file = ROOT / name
        before = file.read_bytes()
        assert digest(file) == originals[name]["sha256"]
        title, old = before.decode("utf-8").split("\n", 1)
        assert "阶段 84 当前增量" not in old
        old = old.replace("阶段 83 当前增量", "阶段 83 历史基线")
        link = "84-internal-audio-production.md" if file.parent.name == "technical" else "technical/84-internal-audio-production.md" if file.parent == ROOT / "docs" else "../technical/84-internal-audio-production.md"
        lead = f"**阶段 84 当前增量：** 公司内部配音/文件转写、原始音讯和真实字幕时间、无 AI 的版本修订、共享预算与未知费用保留、来源门控及独立后台正文/费用权限已在明确假数据下局部核对。平台 {proof['platform_tests']['tests']} 项保留原 968 项，音频/网关 43、兼容 80、客户端 {proof['client_counts']}、真实 Web/Admin/原生侧栏 10、打包本机 Desktop 40 项分别通过。新增 SQL101，SQL001–100 和两份原 OpenAPI 保持。Desktop 本机 Codex、可撤销全权限、无边框/菜单、无可见纵横滚动条，保留真实滚动、键盘、缩放后焦点与真实进度。原生侧栏继续云端 Codex 与获准文件上传。真实音质、独立人工声音授权、音频能力后台发行及未知 POST 专属对账仍待补齐；原 102 REQ/102 TC 保持 83 部分／19 未证明／0 完整验收，G01–G10 保留。见[方案与限定证据]({link})。"
        if name == "docs/requirements/04-desktop-layout-and-scroll.md":
            old = old.replace("../quality/geo-observation-visual-review.md", "../quality/audio-production-visual-review.md").replace("../quality/geo-observation-checkpoint.json", "../quality/audio-production-checkpoint.json")
            old += "\n\n字幕编辑器在实际 OS 窗口缩放后保留当前控件的焦点可见性；较矮窗口采用紧凑标题与布局，避免消息区被固定区域挤占。实际字幕末项保存、滚轮和键盘按新回执分别核对，不能只隐藏滚动条。\n"
        if name == "docs/DELIVERY.md":
            package = proof["packaged"]
            lead += f"\n\n当前 Stage84 未签名打包候选：以 `dev/copypaste-delivery/` 为基准的 `{package['executable']}`；`app.asar` SHA-256 为 `{package['app_asar_sha256']}`。实际运行 40 项原生交互检查；使用前需启动已迁移至 SQL101 的后端并配置公司地址。候选保持本地忽略，不代替签名、人工安装/升级/卸载与商店验收；源码按 Desktop 双语 README 重建。"
        file.write_text(title.rstrip("\r") + "\n\n" + lead + "\n\n" + old.lstrip(), encoding="utf-8", newline="\n")
        updates.append({"path": name, "before_sha256": sha256(before).hexdigest(), "after_sha256": digest(file)})
    progress_file = ROOT / "docs/quality/requirements-alignment-progress.json"
    progress = read(progress_file)
    counts = Counter(row["assessment"] for row in progress["requirements"])
    assert len(progress["requirements"]) == 102 and counts == {"partial_verified": 83, "completion_not_proven": 19}
    assert progress["fully_accepted_requirements"] == 0
    row = next(row for row in progress["requirements"] if row["requirement_id"] == "REQ-021")
    assert row["assessment"] == "completion_not_proven" and row["acceptance_case_execution"] == "not_completed"
    row["finding"] = "内部配音/文件转写、原始回答/真实字幕时间、人工版本修订、费用与来源门控、实际三端和独立 Admin 正文权限已在假服务下局部验证。真实音质、独立人工声音授权、后台音频发行及未知 POST 专属对账仍未完成，不关闭 TC-021。"
    row["remaining_complete_acceptance_conditions"] = "补齐音频能力后台核验/发布/回滚、未知请求外部证据与独立审批/恢复交付、独立人工权利确认，验证真实语音/粤语质量和完整专业业务交付；TC-021 与原完整验收未完成。"
    progress["audio_production_repair"] = {"stage": 84, "status": proof["status"], "checkpoint": "audio-production-checkpoint.json", "checkpoint_sha256": digest(checkpoint_file),
        "original_full_acceptance": "not_proven", "assessment_counts_unchanged": True, "scope": proof["scope"]}
    progress["current_source_qualification"] = {"stage": 84, "checkpoint": "audio-production-checkpoint.json", "note": proof["scope"]}
    progress["at"] = datetime.now(timezone.utc).isoformat()
    progress_file.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    technical_file = ROOT / "docs/technical/84-internal-audio-production.md"
    technical_before = digest(technical_file)
    technical = technical_file.read_text(encoding="utf-8")
    technical = technical.replace("The implementation and its complete validation are pending until actual evidence is recorded; synthetic service tests do not establish live professional quality or original complete acceptance.",
        "The bounded implementation and actual client checks are recorded below; synthetic service tests do not establish live professional quality or original complete acceptance.")
    technical = technical.replace("4. 需要保存实际 Web、Admin、原生 Side Panel 与打包 Desktop 截图和交互录制，并完成相应回归。旧阶段截图或其他业务通过不能替代本增量证明。",
        "4. 本增量的实际 Web、Admin、原生 Side Panel 与打包 Desktop 截图、交互录制及完整回归已另行保存，见下方精确版本检查点；这些假服务证据不代替真实业务质量与完整客户验收。")
    technical = technical.split("## 已执行检查 / Recorded checks", 1)[0] + f'''## 已执行检查 / Recorded checks

当前精确版本的音频/网关 **43**、旧视频/来源/角色/迁移/能力发行兼容 **80**、客户端 **{proof['client_counts']}** 项，以及真实 Web/Admin/原生右侧栏 **10**、打包本机 Desktop **40** 项分别通过。完整平台 **{proof['platform_tests']['tests']}** 项覆盖 **{proof['platform_files']}** 个测试文件、**{proof['platform_batches']}** 个独立原生数据库批次，保留全部原 **968** 个用例。实际回执、原始日志、当前源码和媒体逐项绑定于[检查点](../quality/audio-production-checkpoint.json)。

Desktop 的真实 OS 窗口在 1440×980、1280×800、800×600 下无可见纵横滚动条，保留滚轮/Home/End、末项下载和焦点访问；修正缩放后同一字幕保存按钮的可见性，并实际复核繁中深色主题。原生 Side Panel 通过浏览器工具栏打开真实右侧栏，与 Web/Admin 分别实际操作。四组 GIF/MP4 由真实观察时间录制并完整解码，见[画面复核](../quality/audio-production-visual-review.md)。

失败、过时或录制标签错误的原始回执保留：Desktop 第 49 轮因测试输出路径冲突停止，第 50 轮暴露窗口缩放后焦点可见性问题；第 51 轮音频画面的主题标签与实际画面不一致，已通过真实主题断言和重新录制修正，见[主题修正记录](../quality/audio-capture-correction.md)。第 10 轮兼容用例虽全数通过，但运行期间辅助脚本变化使源码资格失效，保持失败状态；当前采用新的完整兼容回执。此前 Web 定位器和 Admin 审计列名错误也按原失败回执保留，不改写为通过。

完整平台第 35 轮第 17 批发现旧测试仍断言 30 个版本；实际新增配音 Skill 后为 31 个版本、29 类 Skill。仅更新两处总数断言，另加旧、新配音版本共存断言，业务源码和旧功能断言不变。第 36 轮重新执行受影响的完整四文件批次及剩余批次；前 16 批的运行时、实际执行测试和辅助代码字节保持一致，按明确范围复用。客户端和 UI 回执中该未执行测试的旧快照保留，不伪称原始全局指纹相同；见[测试增量复核](../quality/audio-production-skill-expectation-review.json)。失败回执不计入通过覆盖。

旧角色 1.2.0、模板角色 1.1.0 及原始 Skills 保留。完整媒体角色使用有界的 32 项工具上限，继续检查重复名称、规格、总大小和每次调用权限。SQL001–100 与两份原 OpenAPI 保持各自已发布字节；七项音频路由使用增量 OpenAPI。原 102 REQ/102 TC 和 G01–G10 的完整验收状态保持不变。
'''
    technical_file.write_text(technical, encoding="utf-8", newline="\n")
    updates.append({"path": technical_file.relative_to(ROOT).as_posix(), "before_sha256": technical_before, "after_sha256": digest(technical_file)})
    changes_file = ROOT / "docs/changes/2026-10-24-internal-audio-and-desktop-layout.md"
    assert not changes_file.exists()
    changes_file.write_text(f'''# 内部音频与 Desktop 布局更新 / Internal audio and Desktop layout

本次补齐公司内部配音、文件转写与人工字幕版本：Web/原生 Chrome 右侧栏使用云端 Codex，Desktop 使用本机固定 Codex。模型请求只经过公司内部 OpenAI 兼容网关，角色 1.3.0 加载 speech-production 1.1.0，原有角色/Skill 版本保留。原始 WAV/JSON/实际字幕时间不可覆盖，客户可按固定版本修订文字和时间，无额外 AI 调用。

Desktop 延续 CopyPaste 视觉、无边框/无 Electron 菜单和客户主动可撤销完整本机权限。遵循用户更正：真实任务/上传/影片进度继续显示；侧栏、消息、成果与弹层无可见纵向滚动条，各处无横向滚动条。长内容换行，滚轮/键盘与末项操作保持可用。较矮窗口改用紧凑布局，并修复窗口缩放后聚焦的字幕保存按钮移出可视区的问题。三种真实窗口尺寸与繁中深色主题均实际复核。

后台按企业/项目范围和独立元数据、费用、正文权限管理音频作业；敏感原文读取需近期 MFA 并审计。共享任务预算、独立音频 slots/RPM、派发前持久记录、未知 POST 保留预留和禁止自动重发、来源隔离/删除/失权门控均保留。长原始 JSON 在实际 Admin 弹窗内完整换行。

升级先应用新增 SQL101，配置公司配音/转写别名、已核验语言/声音/协议、正数费率，并按既有独立审批发布音频容量（初始 0）。标准 demo 不自动提供本次音频假服务。所有密钥保持服务端。SQL001–100 与原 OpenAPI 字节保留。

当前验证：平台 {proof['platform_tests']['tests']}（全部原 968 用例保留）、音频/网关 43、兼容 80、客户端 {proof['client_counts']}、真实 Web/Admin/侧栏 10、打包 Desktop 40。实际截图、四组 GIF/MP4、精确源码、完整测试清单和自建资源关闭均保留；失败回执不覆盖。14 份中英双语 README 与主文档同步。

假服务为可解码合成音调、固定转写和推理内容。真实声线/粤语质量、独立人工声音授权确认、音频能力后台核验/发布/回滚、未知请求外部账单证据/独立审批/恢复交付仍待完成。原 102 REQ/102 TC 保持 83 部分、19 未证明、0 完整验收，G01–G10 保留。

English: Adds company-gateway speech, file transcription and immutable manual subtitle revisions across cloud Web/native Side Panel and local-Codex Desktop. Admin independently scopes metadata, costs and recent-MFA audited original bodies. Shared budgets, durable submission, unknown-cost holds, source gates and audio capacity remain enforced. Apply additive SQL101 and explicitly verified company configuration; initial audio capacity is zero. Original migrations/OpenAPI and historical role/skill versions are retained.

Desktop keeps CopyPaste styling, its frameless window, no Electron menu and explicit revocable full local permission. The user's corrected constraint preserves truthful progress while hiding scrollbar rails; content still wraps and real wheel/keyboard/last-action access works. A compact layout and focus preservation fix the subtitle-save control after real OS resizing. Actual 1440×980, 1280×800, 800×600 and Traditional Chinese dark captures are verified.

Evidence covers {proof['platform_tests']['tests']} platform cases preserving all 968 earlier cases, 43 audio/gateway, 80 compatibility, {proof['client_counts']} client tests, 10 Web/Admin/Side Panel checks and 40 packaged native checks. Four original GIF/MP4 pairs, bilingual READMEs and exact-source receipts are retained. Synthetic media does not prove live professional voice quality, independent human rights confirmation, managed audio release, unknown-POST external reconciliation, signed installers or complete original acceptance. Original 83/19/0 and G01–G10 remain unchanged.

[方案与配置](../technical/84-internal-audio-production.md) · [实际画面](../quality/audio-production-visual-review.md) · [精确版本检查点](../quality/audio-production-checkpoint.json)
''', encoding="utf-8", newline="\n")
    updates.append({"path": changes_file.relative_to(ROOT).as_posix(), "before_sha256": None, "after_sha256": digest(changes_file)})
    output.write_text(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "status": "updated_current_audio_project_pointers", "documents": updates,
        "original_assessments_unchanged": dict(counts), "verifier_sha256": digest(Path(__file__))}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": "updated_current_audio_project_pointers", "documents": len(updates), "original_counts_unchanged": True}))


if __name__ == "__main__":
    main()
