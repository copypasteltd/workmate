"""Refresh current product/development pointers, preserving original acceptance."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

from sync_audio_project_docs import ACTIVE

ROOT = Path(__file__).resolve().parents[2]


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/audio-authorizations-project-docs.json"
    assert not output.exists()
    checkpoint_file = ROOT / "docs/quality/audio-authorizations-checkpoint.json"
    proof = read(checkpoint_file)
    assert proof["status"] == "verified_independent_customer_audio_confirmation"
    baseline = read(ROOT / "docs/quality/history/stage85-before-audio-controls/receipt.json")
    originals = {row["source"]: row for row in baseline["files"]}
    updates = []
    role_docs = ["docs/product/06-role-templates-and-skill-presets.md", "docs/technical/19-project-skill-lifecycle.md",
        "docs/technical/25-role-template-registry-and-runtime-binding.md", "docs/modules/00-catalog.md"]
    for name in [*ACTIVE, "docs/governance/04-git-branches-and-publication.md", *role_docs]:
        file = ROOT / name
        before = file.read_bytes()
        assert digest(file) == originals[name]["sha256"], name
        title, old = before.decode("utf-8").split("\n", 1)
        assert "阶段 85 当前增量" not in old
        old = re.sub(r"阶段 (\d+) 当前增量", r"阶段 \1 历史基线", old)
        link = "85-audio-rights-and-administration.md" if file.parent.name == "technical" else "technical/85-audio-rights-and-administration.md" if file.parent == ROOT / "docs" else "../technical/85-audio-rights-and-administration.md"
        lead = f"**阶段 85 当前增量：** 原任务中的音频提案需原客户以当前登录会话独立确认精确内容和公司报价；默认不勾选，权利依据/用途为空。模型与 Admin 不能代签。拒绝、截止、停止及撤权阻断派发，撤回阻断交付但保留真实或未知费用。新增 SQL102，保留 SQL001–101、四份已发布契约及旧角色/Skill。平台 {proof['platform_tests']['tests']}（全部原 988 用例保留）、核心 56、兼容 80、客户端 124、真实 Web/Admin/原生侧栏 13、打包 Desktop 41 分别通过；全部选定源码摘要精确相符。Desktop 保持客户本机 Codex、主动可撤销全权限、无边框/菜单，无可见纵横滚动条，保留滚轮/键盘/末项焦点及真实进度。原生右侧栏保持云端 Codex 和获准文件上传。真实声音/粤语质量、后台音频发行和未知 POST 外部证据结算仍保留；原 102 REQ/102 TC 为 83 部分／19 未证明／0 完整验收，G01–G10 不变。见[当前方案与限定证据]({link})。"
        if name in role_docs:
            old = old.replace("当前共 29 个随附 Skill", "阶段 60 当时共 29 个随附 Skill")
            lead += "\n\n当前目录为 18 个专业角色、29 类 Skill、32 个包版本；影片角色 1.4.0 绑定 speech-production 1.2.0，旧角色 1.3.0 和 31 个已发布包完整保留。见[当前可执行目录副本](../contracts/role-preset-catalog-current.json)。原设计目录和历史版本保持各自范围；角色登记及假服务运行不等于最低 12 个专业角色的完整真实业务验收。"
        if name.endswith("04-desktop-layout-and-scroll.md"):
            old = old.replace("../quality/audio-production-visual-review.md", "../quality/audio-authorizations-visual-review-02.md").replace("../quality/audio-production-checkpoint.json", "../quality/audio-authorizations-checkpoint.json")
            lead += "\n\n客户已经撤回先前关于进度条的限制。真实任务、上传和媒体进度继续展示；隐藏的是各处可见的纵向/横向滚动条轨道。禁止用裁切隐藏必须操作的内容：长文本和表格换行，消息/侧栏/成果/弹层保持真实滚动，Tab/Home/End 可到末项；新的独立确认表单也在三种实际 OS 窗口尺寸核对。"
        if name == "docs/DELIVERY.md":
            package = proof["packaged"]
            lead += f"\n\n当前 Stage85 未签名候选（相对 dev/copypaste-delivery/）：{package['executable']}；app.asar SHA-256：{package['app_asar_sha256']}。实际本机交互 41 项通过。先启动迁移至 SQL102 的后端并按双语 README 重建/配置公司地址；本地忽略候选不替代签名、人工安装/升级/卸载和商店验收。"
        if name.endswith("04-git-branches-and-publication.md"):
            old = old.replace("finalize_audio_manifest.py", "finalize_audio_authorizations_manifest.py")
            lead += "\n\n本次先提交六个组件，再执行 python -X utf8 docs/tools/finalize_audio_authorizations_manifest.py，最后提交主文档。随后在 Delivery 执行 node scripts/publish-workmate.mjs --push，按发布回执核对 backend/web/admin/desktop/extension/delivery/docs/main 八个远程 SHA；docs 与 main 必须相同。历史工具/回执保持原阶段范围，常规同步沿用既有授权，禁止强推。"
        file.write_text(title.rstrip("\r") + "\n\n" + lead + "\n\n" + old.lstrip(), encoding="utf-8", newline="\n")
        updates.append({"path": name, "before_sha256": sha256(before).hexdigest(), "after_sha256": digest(file)})
    progress_file = ROOT / "docs/quality/requirements-alignment-progress.json"
    progress = read(progress_file)
    counts = Counter(row["assessment"] for row in progress["requirements"])
    assert len(progress["requirements"]) == 102 and counts == {"partial_verified": 83, "completion_not_proven": 19}
    assert progress["fully_accepted_requirements"] == 0
    row = next(row for row in progress["requirements"] if row["requirement_id"] == "REQ-021")
    assert row["assessment"] == "completion_not_proven" and row["acceptance_case_execution"] == "not_completed"
    row["finding"] = "公司音频、原文/真实时间与版本修订保留；新增客户当前会话独立确认精确提案及报价，三端实际默认未勾选/空白输入、拒绝/截止/停止/撤回、迟到费用与后台独立审计已在假服务下局部验证。真实音质、后台音频发行与未知 POST 专属证据结算仍未完成，不关闭 TC-021。"
    row["remaining_complete_acceptance_conditions"] = "补齐音频能力后台核验/发布/回滚、未知请求外部证据及独立审批/恢复交付；验证真实语音/香港粤语质量、权属审核与完整专业业务交付。独立登录确认不代表法律权属证明；TC-021 与原完整验收仍未完成。"
    progress["audio_authorizations_repair"] = {"stage": 85, "status": proof["status"], "checkpoint": "audio-authorizations-checkpoint.json",
        "checkpoint_sha256": digest(checkpoint_file), "original_full_acceptance": "not_proven", "assessment_counts_unchanged": True, "scope": proof["scope"]}
    progress["current_source_qualification"] = {"stage": 85, "checkpoint": "audio-authorizations-checkpoint.json", "note": proof["scope"]}
    progress["at"] = datetime.now(timezone.utc).isoformat()
    progress_file.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    technical_file = ROOT / "docs/technical/85-audio-rights-and-administration.md"
    before = digest(technical_file)
    technical = technical_file.read_text(encoding="utf-8").replace("本阶段修改后的源码需要重新验证。当前文档描述候选实现，实际结果以本阶段检查点和失败、成功原始回执为准。",
        "本阶段源码已按新的实际检查点重新核对，失败及成功原始回执均保留；假服务证据不代表原始完整业务验收。")
    technical += f"""

## 已执行检查 / Recorded evidence

当前平台 **{proof['platform_tests']['tests']}** 项覆盖 78 个测试文件与 20 个独立原生数据库批次，保留全部原 **988** 个用例。核心音频/网关/升级 **56**、兼容 **80**、客户端 **124**、实际 Web/Admin/原生右侧栏 **13**、打包本机 Desktop **41** 分别通过。当前选定回执记录的全部源码摘要逐项精确相同，没有将旧快照重新标为当前。见[检查点](../quality/audio-authorizations-checkpoint.json)、[实际画面](../quality/audio-authorizations-visual-review-02.md)、[新增契约](../contracts/audio-authorizations-openapi.json)及[实际 HTTP 校验](../quality/{Path(proof['contract_validation']['path']).name})。

实际客户表单默认未勾选、依据/用途为空。Web 和 Side Panel 由原登录客户操作；Desktop 的固定本机 Codex 保持原工具等待，经实际 UI 确认才继续。Desktop 已核对三种实际窗口、真实滚轮/Home/End、焦点及完整末项操作，无可见纵横滚动条；真实进度保留。四组原始 GIF/MP4 记录客户确认流程并完整解码，自建浏览器/窗口/数据库均按回执关闭。

SQL101 已有 prepared/dispatched/completed 数据的真实升级检查验证：未派发取消为零，派发未知保留预留，已完成字节及费用不变；不补造客户确认。审计记录既受普通服务数据库权限保护，也受数据库不可变触发器保护。旧角色 1.3.0、31 个已发布包及原功能断言均保留；新角色 1.4.0、speech-production 1.2.0、总包版本 32 的断言增量另行复核。

第 14 轮核心检查发现新增 Skill 包缺少已审阅目录定义，服务启动拒绝；补齐定义，保持启动校验。第 15 轮发现旧数据测试读取未返回的存储字段、审计测试错误匹配过窄；改为读取实际存储键，并分别验证普通服务权限拒绝和 owner 不可变触发器拒绝。两轮失败原始回执保留，不计入通过覆盖。

第 20 轮兼容性进程中断，没有最终 TAP 汇总、源码核对或资源关闭回执；随后实际查询确认原进程消失且 55432 无监听，才以第 21 轮重新执行。第 20 轮原始日志及核查说明保留，不计为通过，不用于当前覆盖。

另通过真实 PostgreSQL 行锁复现恢复与续租竞争：恢复扫描先读到过期租约，随后等待正在续租的任务锁，旧逻辑会在续租提交后仍取消有效授权。第 18 轮在同一用例实际失败；修复只增加取得锁后的当前期限/任务状态复查，第 19 轮相同测试及其余核心检查通过。第 37 轮完整回归的自动循环在前两批后停止，自建数据库正常关闭；117 项历史批次不充当本次完整回归。后续完整回归另用新编号和新源码，见[真实锁竞争记录](../quality/audio-authorizations-recovery-race.json)。

English: Current evidence binds {proof['platform_tests']['tests']} platform cases preserving all 988 earlier cases, 56 focused cases, 80 compatibility cases, 124 client tests, 13 actual Web/Admin/native Side Panel checks and 41 packaged local Desktop checks. All selected recorded source hashes match exactly. Real customer forms, native OS window sizes, wheel/keyboard/focus access, original media decoding and owned-resource cleanup are recorded. The populated SQL101 upgrade preserves completed bytes/fees without backfilling consent. Failed attempts remain failed. This evidence does not establish live professional quality or close the original 102-case acceptance.
"""
    technical_file.write_text(technical, encoding="utf-8", newline="\n")
    updates.append({"path": technical_file.relative_to(ROOT).as_posix(), "before_sha256": before, "after_sha256": digest(technical_file)})
    changes_file = ROOT / "docs/changes/2026-10-25-customer-audio-confirmation.md"
    assert not changes_file.exists()
    changes_file.write_text("""# 客户音频确认与 Desktop 布局复核 / Customer audio confirmation and Desktop layout

原音频工具参数中的权利声明不能代表客户确认。现在在原本机/云端 Codex 任务中等待原客户，通过当前登录会话确认固定提案、报价、权利依据与用途；默认未勾选，输入为空。管理员和模型不能代签。拒绝、截止、停止、失权阻断派发，撤回阻断交付但不抹掉已派发的未知或真实费用。旧提交不自动重发，历史原文/音频/字幕版本保留。

新增 SQL102；保留 SQL001–101 和四份已发布契约。旧未派发作业取消，旧派发未知保留费用预留，旧完成结果保留原字节且标记历史模型声明，不补造人工授权。角色 1.4.0 加载 speech-production 1.2.0，旧角色与 31 个已发布包保留。

Desktop 继续在客户本机执行 Codex，支持客户主动授予及撤回完整本机权限；无边框、无 Electron 菜单。遵照客户更正保留真实进度，各处无可见纵横滚动条；实际三种 OS 窗口中的滚轮/键盘/末项焦点与新确认表单已核对。Chrome 原生右侧栏继续 ChatGPT 式对话、获准文件上传和云端 Codex，无 Desktop 依赖。Admin 按独立元数据、费用、敏感正文权限审计查看客户确认，不提供代签。

验证：平台 1001（原 988 保留）、核心 56、兼容 80、客户端 124、实际 Web/Admin/侧栏 13、打包 Desktop 41；四组实际 GIF/MP4、截图和自建资源清理均保存，七仓库双语 README 同步。假声音/推理/转写与原生对话框夹具不代表真实粤语/专业质量。后台音频核验/发行/回滚、未知 POST 外部费用证据及独立结算/恢复交付仍待完成。原 102 REQ/102 TC 保持 83 部分、19 未证明、0 完整验收，G01–G10 保留。

English: The original local/cloud Codex task now waits for the originating authenticated customer to approve an exact audio proposal and quote using an unchecked form with blank rights/use fields. Models and Admin cannot sign for customers. Decline, expiry, Stop and lost authority block dispatch; withdrawal blocks delivery while preserving submitted unknown or actual fees. SQL102 preserves published history and never backfills consent. Desktop retains local execution, explicit revocable full native permission, a frameless menu-free UI, wrapping content and complete wheel/keyboard/focus access without visible scrollbar rails. Truthful progress remains. The native right Chrome Side Panel remains a cloud chat/upload client.

Recorded evidence: 1001 platform cases preserving 988, 56 focused, 80 compatibility, 124 client tests, 13 actual Web/Admin/Side Panel and 41 packaged Desktop checks, plus four original GIF/MP4 pairs. All seven bilingual README sets are updated. Synthetic evidence does not close live voice/Cantonese quality, legal ownership review, managed audio release, unknown-cost external reconciliation, signed installers or original 83/19/0 acceptance.

[当前方案](../technical/85-audio-rights-and-administration.md) · [实际画面](../quality/audio-authorizations-visual-review-02.md) · [精确版本检查点](../quality/audio-authorizations-checkpoint.json)
""", encoding="utf-8", newline="\n")
    updates.append({"path": changes_file.relative_to(ROOT).as_posix(), "before_sha256": None, "after_sha256": digest(changes_file)})
    output.write_text(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "status": "updated_current_audio_authorization_pointers",
        "documents": updates, "original_assessments_unchanged": dict(counts), "verifier_sha256": digest(Path(__file__))}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": "updated_current_audio_authorization_pointers", "documents": len(updates), "original_counts_unchanged": True}))


if __name__ == "__main__":
    main()
