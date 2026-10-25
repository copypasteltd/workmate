"""Refresh current navigation and REQ-065 while preserving original conditions."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/shared-project-current-pointers.json"
    assert not output.exists()
    checkpoint_file = ROOT / "docs/quality/shared-project-checkpoint.json"
    proof = read(checkpoint_file)
    assert proof["status"] == "verified_shared_project_guidance_and_private_chat"
    archive_file = ROOT / "docs/quality/history/stage86-current-pointers/receipt.json"
    archived = read(archive_file)
    updates = []
    for row in archived["files"]:
        file = ROOT / row["source"]
        before = file.read_bytes()
        assert digest(file) == row["sha256"] and digest(ROOT / row["archive"]) == row["sha256"]
        title, old = before.decode("utf-8").split("\n", 1)
        assert "阶段 86 当前增量" not in old
        old = re.sub(r"阶段 (\d+) 当前增量", r"阶段 \1 历史基线", old)
        link = ("86-shared-project-guidance-and-private-chat.md" if file.parent.name == "technical" else
                "technical/86-shared-project-guidance-and-private-chat.md" if file.parent == ROOT / "docs" else
                "../technical/86-shared-project-guidance-and-private-chat.md")
        lead = f"**阶段 86 当前增量：** 共享配置草稿/精确预览/不可变发布、新工作固定版本、旧任务保留原版或原先无配置状态，已在实际 Web、原生侧栏及本机 Codex 核对。本机三次执行采用 v3/v3/v4，资料工具与本地原字节、各自费用结算均检查。侧栏聊天附件先建立本人私有会话，分片校验与精确恢复回执不回退共享；同项目另一编辑者不能列出、下载、读取版本或访问私有会话。独立 Admin 正文/费用权限与隔离/恢复/永久擦除继续生效。平台 {proof['platform_tests']['tests']}（保留原 1001）、核心 25、兼容 36、客户端 139、实际 Web/Admin/侧栏 14、打包 Desktop 50 分别通过，选定源码精确相符。SQL103 增量保留 SQL001–102 和四份历史契约；487 配置路由加 1 条条件 demo 路由。REQ-065 更新为部分验证，原 102 项为 84 部分／18 未证明完整／0 完整验收，G01–G10 和其余全部差异保留。假模型证据不代表真实专业质量。见[当前方案与限定证据]({link})。"
        if file.name == "04-desktop-layout-and-scroll.md":
            lead += "\n\nDesktop 仍为客户本机 Codex、主动可撤销完整权限、无边框/原生菜单、无可见纵横滚动条；滚动、键盘、末项焦点和真实进度保留。生成视频同范围刷新保留播放器及暂停位置，请求失败/换范围仍清除旧内容。Chrome 原生右侧栏在两种语言、展开摘要/设置和实际紧凑窗口中核对输入、发送和当前页面命中区域；不以裁切隐藏必需操作。"
        if file.name == "04-git-branches-and-publication.md":
            lead += "\n\n本阶段先完成当前检查点、媒体/文档及暂存核查，提交六组件后执行 `python -X utf8 docs/tools/finalize_shared_configuration_manifest.py`，再提交主文档。在 Delivery 执行 `node scripts/publish-workmate.mjs --push`，核对八个实际远程 SHA。旧阶段工具仅解释历史回执，常规同步沿用用户既有授权，禁止强推。"
        if file.name == "DELIVERY.md":
            lead += f"\n\n当前未签名解包候选（相对 dev/copypaste-delivery/）：`{proof['packaged']['executable']}`，app.asar SHA-256 `{proof['packaged']['app_asar_sha256']}`。该候选已实际检查 50 项，源码可按双语 README 重建；不等于签名、人工安装/升级/卸载或商店验收。"
        context = "以下保留既有规范及历史记录；阶段专属命令仅解释当时回执，当前增量以前述方案、检查点和发布流程为准。 Existing specifications and historical records follow. Stage-specific commands explain their original receipts; the current increment uses the guidance, checkpoint and publication flow above."
        file.write_text(title.rstrip("\r") + "\n\n" + lead + "\n\n" + context + "\n\n" + old.lstrip(), encoding="utf-8", newline="\n")
        updates.append({"path": row["source"], "archive": row["archive"], "before_sha256": row["sha256"], "after_sha256": digest(file)})
    progress_file = ROOT / "docs/quality/requirements-alignment-progress.json"
    progress = read(progress_file)
    assert len(progress["requirements"]) == 102 and Counter(row["assessment"] for row in progress["requirements"]) == {"partial_verified": 83, "completion_not_proven": 19}
    assert progress["fully_accepted_requirements"] == progress["qualified_live_roles"] == 0
    row = next(row for row in progress["requirements"] if row["requirement_id"] == "REQ-065")
    assert row["assessment"] == "completion_not_proven" and not row["verified_repairs"]
    row["assessment"] = "partial_verified"
    row["finding"] = "共享配置草稿、CAS/幂等发布、精确依赖与继承摘要、旧/新任务版本和本机 v3/v3/v4 实际资料读取已通过；当前来源、私有附件、账号和本机权限仍独立检查。尚未执行同号完整业务验收。"
    row["source_inspection_candidates"] = ["dev/copypaste-platform/src/project-configuration.ts", "dev/copypaste-platform/migrations/103-shared-project-configuration.sql", "dev/copypaste-web/src/project-configuration.tsx", "dev/copypaste-desktop/renderer/src/project-configuration.tsx", "dev/copypaste-extension/src/chat-upload.ts"]
    row["verified_repairs"] = [{"cluster": "shared_project_guidance", "verified_subflow": proof["scope"],
        "evidence": ["shared_project_guidance_repair"], "implementation_docs": ["technical/86-shared-project-guidance-and-private-chat.md"]}]
    row["remaining_complete_acceptance_conditions"] = "继续验证完整项目共享/个人偏好交集、长会话及大目录/Office/PDF、全部并发与撤权矩阵、实际客户完整工作和专业角色质量。保留原 TC-065 的全部条件，当前局部证据不关闭同号完整验收。"
    assert row["acceptance_case_execution"] == "not_completed"
    progress["summary"] = dict(Counter(item["assessment"] for item in progress["requirements"]))
    progress["shared_project_guidance_repair"] = {"stage": 86, "status": proof["status"], "checkpoint": checkpoint_file.name,
        "checkpoint_sha256": digest(checkpoint_file), "scope": proof["scope"], "original_full_acceptance": "not_proven",
        "one_requirement_progressed_to_partial": "REQ-065", "original_requirement_and_acceptance_text_preserved": 102}
    progress["current_source_qualification"] = {"stage": 86, "checkpoint": checkpoint_file.name, "note": proof["scope"]}
    progress["evidence_currentness_policy"] += " Stage86: all selected platform, focused, compatibility, client and actual Web/Admin/Side Panel/local Desktop evidence is bound to exact current sources; previous attempts keep their original outcomes."
    progress["at"] = datetime.now(timezone.utc).isoformat()
    progress_file.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    updates.append({"path": progress_file.relative_to(ROOT).as_posix(), "after_sha256": digest(progress_file)})
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "updated_shared_project_current_pointers",
        "checkpoint": {"path": checkpoint_file.relative_to(ROOT).as_posix(), "sha256": digest(checkpoint_file)},
        "documents": updates, "original_requirements_preserved": 102, "summary": progress["summary"],
        "complete_acceptance": 0, "verifier_sha256": digest(Path(__file__))}
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"documents": len(updates), "summary": progress["summary"], "complete_acceptance": 0}))


if __name__ == "__main__":
    main()
