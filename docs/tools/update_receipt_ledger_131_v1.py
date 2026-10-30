"""Retain all 102 original full-acceptance records; update only evidenced scopes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
PREVIOUS = QUALITY / "remaining-work-stage130.json"
CP = QUALITY / "receipt-sync-checkpoint-131.json"
TARGET = QUALITY / "remaining-work-stage131.json"
assert not TARGET.exists() and not TARGET.with_suffix(".md").exists()
old, checkpoint = json.loads(PREVIOUS.read_bytes()), json.loads(CP.read_bytes())
assert checkpoint["status"] == "verified_bounded_desktop_durable_receipt_sync"
value = copy.deepcopy(old)
scopes = {
    "REQ-003": "本轮实际打包Desktop完成浏览器OTP/PKCE、企业创建，并验证保留同一登录族的完整应用退出/重启后同步；企业身份正式部署、签名安装后登录、所有过期/换账号/断网/竞争组合仍需验收。",
    "REQ-008": "已补齐已知本机子任务完成报告的持久补交，实际验证请求未送达、结算后响应丢失、撤权与重启；全部业务步骤、部分产物、任意崩溃和多节点路径继续开放。",
    "REQ-009": "本轮验证只补原回执、不重启Codex/模型/QA，已存子任务结果在重启及撤权后保留；任意运行中暂停、所有崩溃检查点、旧进程回收、跨登录族及跨节点恢复仍需完整验收。",
    "REQ-039": "实际未签名Desktop完整退出/重启、待同步双语说明、撤权后同步、三个原生窗口宽度及无边框/默认菜单/可见滚动条/横向溢出已验证；签名安装、更新卸载、OS/DPI、全部本机工具及完整状态文案/使用引导继续开放。",
    "REQ-046": "已知本机子任务丢失完成回执后沿用原报告和原预留，只结算一次；未知父任务保留原预留待核对。全部并行/媒体/本机竞争、父任务完整核对、所有未知费用与生产模型费率矩阵继续开放。",
    "REQ-054": "本轮源码、真实未签名包、失败/通过证据、双语README及实际截图/GIF绑定；完整灰度、旧客户端兼容、签名更新和生产回滚继续开放。",
    "REQ-060": "本轮124控制层、43实际固定Codex、3原生SQL流程、2编译、8打包界面与旧/新版对照绑定源码、双语说明及4截图/2组GIF和MP4；远端结果以实际推送回执为准。独立检出复现及原始完整交付验收继续开放。",
    "REQ-075": "本轮实际父任务与开发子任务加载固定Codex/Skill并执行文件命令，回执丢失后只补报告且不建立QA；四发布工具、全部角色/团队/计划、未知副作用、任意崩溃/多节点和跨登录族组合继续开放。",
}
for row in value["requirements"]:
    if row["id"] in scopes:
        row["current_audit_remaining"] = scopes[row["id"]]
        row["current_review_note"] = "阶段131有界增量；该完整验收记录保持开放，参见当前检查点与原始证据。"
assert len(value["requirements"]) == 102
assert [r["id"] for r in value["requirements"]] == [r["id"] for r in old["requirements"]]
assert all(r["full_acceptance"] == "open" for r in value["requirements"])
value["schema_version"] = 13
value["reviewed_at"] = datetime.now(timezone.utc).isoformat()
value["previous_review"] = {"path": PREVIOUS.relative_to(ROOT).as_posix(), "sha256": sha256(PREVIOUS.read_bytes()).hexdigest()}
value["checkpoint"] = {"path": CP.relative_to(ROOT).as_posix(), "sha256": sha256(CP.read_bytes()).hexdigest()}
value["new_full_acceptance_closures"] = 0
value["current_increment"] = {"stage": 131, "counts": checkpoint["counts"], "required_open": 89, "unconfirmed_suggestions": 12,
    "optional_open": 1, "whole_platform_runtime_rerun": False, "full_acceptance_closures": 0, "updated_scope_records": list(scopes)}
with TARGET.open("x", encoding="utf-8", newline="\n") as file:
    json.dump(value, file, ensure_ascii=False, indent=2); file.write("\n")
intro = """# 当前完整编号待办 · 阶段131

继承全部102条完整验收记录：89条必需、12条未确认建议、1条可选；本轮未提前关闭任何完整验收记录。这些记录不等于102个功能尚未编码。仅更新本轮有实际证据的8条范围，其余评估及原始来源保持不变。

[机器可读清单](remaining-work-stage131.json) · [当前检查点](receipt-sync-checkpoint-131.json) · [原始证据](receipt-sync-evidence-131/index.json) · [本轮变更](../changes/131-desktop-durable-receipt-sync.md)

本轮通过124项控制层、43项实际固定Codex、3条原生/SQL回执丢失流程、2项编译和8项实际未签名Desktop界面检查；旧/新版对照确认原缺陷。实际完整退出/重启、撤销本机权限后补交原回执，不重跑命令、模型或QA。已知子任务结算一次；未知父任务保持原预算待核对。模型和对话框选择为测试输入，未重跑全平台完整回归。

| 编号 | 优先级 | 模块 | 当前状态 | 尚未完整完成的范围 |
| --- | --- | --- | --- | --- |
"""
lines = [f'| {row["id"]} | {row["priority"]} | {row["module"]} | {row["audit_status"]} | {row["current_audit_remaining"].replace("|", "／")} |'
         for row in value["requirements"]]
with TARGET.with_suffix(".md").open("x", encoding="utf-8", newline="\n") as file:
    file.write(intro + "\n".join(lines) + "\n")
print(json.dumps({"records": 102, "scope_records_updated": len(scopes), "full_acceptance_closures": 0, "required_open": 89}))
