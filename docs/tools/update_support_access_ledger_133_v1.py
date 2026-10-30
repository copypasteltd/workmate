"""Retain every original requirement identity; update only evidenced support scope."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
PREVIOUS = QUALITY / "remaining-work-stage132.json"
CP = QUALITY / "support-access-checkpoint-133.json"
TARGET = QUALITY / "remaining-work-stage133.json"
assert not TARGET.exists() and not TARGET.with_suffix(".md").exists()
old, cp = json.loads(PREVIOUS.read_bytes()), json.loads(CP.read_bytes())
assert cp["status"] == "verified_bounded_controlled_support"
value = copy.deepcopy(old)
scopes = {
    "REQ-003": "本轮独立管理员邮箱/TOTP和实际Windows客户OTP/PKCE、真实到期与撤销已验证；企业身份正式部署、签名安装登录及全部三端过期、换账号、断网和竞争组合仍需验收。",
    "REQ-039": "本轮实际未签名Desktop独立创建/撤销客户支持授权，验证三个原生窗口宽度、无边框、无默认菜单/可见滚动条/横向溢出；签名安装、更新卸载、OS/DPI及全部本机工具完整旅程继续开放。",
    "REQ-048": "后台完整历史阅读及本轮受控客服来源、正文版本、原生客户授权/撤销链路已补齐；全部资源运营、完整后台权限与运营矩阵、各页面无障碍和异常恢复仍需完整验收。",
    "REQ-055": "本轮客户原生支持表单的实际键盘切换、Admin四档宽度、繁中深色及三个原生窗口宽度通过；全关键路径键盘、100%/200%缩放、对比、读屏与reduced-motion继续验收。",
    "REQ-060": "本轮59项后台相关检查与13项真实Admin/Web/原生Desktop旅程、6截图和3组实时GIF/MP4绑定确切源码并保留失败；双语README和普通推送回执同步，独立检出复现及全平台完整交付验收继续开放。",
    "REQ-090": "会话/专家/记忆完整历史及受控客服共享任务读取已补齐，本轮撤回来源会隐藏诊断标题和正文入口；其余资源完整历史、关联显示、运营动作及全内容矩阵继续验收。",
    "REQ-091": "本轮客服读取原始文件隔离、保留到期、版本擦除、任务隔离和审计期间来源撤回均拒绝保留正文，页面清空实际打开结果；全部导出/分享/索引/模型读取与备份恢复组合仍待完整验收。",
    "REQ-094": "本轮支持读取核对实际管理员会话、客户授权和独立正文权限，版本指纹仅向有正文权限者返回，审计期间变化及实际迟到响应已验证；全部动作/字段/异步路径的完整权限竞争矩阵继续开放。",
    "REQ-095": "独立原生Desktop客户授权/撤销旅程、实际Admin任务/会话迟到响应、正文版本和来源撤回、真实时钟到期已验证；全部客服范围/成员/管理员权限并发组合、异常恢复、200%缩放及读屏的完整TC-095验收仍开放。",
    "REQ-098": "本轮Admin/Web/原生Desktop支持链路、中英主题、四档Admin布局、三档原生窗口及迟到正文/会话隔离通过；全模块运营、异常恢复、键盘读屏和完整产品可用性继续验收。",
}
for row in value["requirements"]:
    if row["id"] in scopes:
        row["current_audit_remaining"] = scopes[row["id"]]
        row["current_review_note"] = "阶段133受控客服来源/版本与原生客户授权增量；完整验收记录保持开放。"
assert len(value["requirements"]) == 102
assert [r["id"] for r in value["requirements"]] == [r["id"] for r in old["requirements"]]
assert all(r["full_acceptance"] == "open" for r in value["requirements"])
value["schema_version"] = 15
value["reviewed_at"] = datetime.now(timezone.utc).isoformat()
value["previous_review"] = {"path": PREVIOUS.relative_to(ROOT).as_posix(), "sha256": sha256(PREVIOUS.read_bytes()).hexdigest()}
value["checkpoint"] = {"path": CP.relative_to(ROOT).as_posix(), "sha256": sha256(CP.read_bytes()).hexdigest()}
value["new_full_acceptance_closures"] = 0
value["current_increment"] = {"stage": 133, "counts": cp["counts"], "required_open": 89,
    "unconfirmed_suggestions": 12, "optional_open": 1, "whole_platform_runtime_rerun": False,
    "full_acceptance_closures": 0, "updated_scope_records": list(scopes)}
with TARGET.open("x", encoding="utf-8", newline="\n") as stream:
    json.dump(value, stream, ensure_ascii=False, indent=2)
    stream.write("\n")
intro = """# 当前完整编号待办 · 阶段133

继承全部102条原始完整验收记录：89条必需、12条未确认建议、1条可选。这是完整验收记录数量，不是102个未编码模块。本轮更新有证据的10条范围，不提前关闭完整验收。

[机器可读清单](remaining-work-stage133.json) · [本轮检查点](support-access-checkpoint-133.json) · [原始证据](support-access-evidence-133/index.json) · [本轮变更](../changes/133-controlled-support-source-and-native-access.md)

本轮59项相关后台检查和13项实际Admin/Web/原生Desktop旅程通过。实际客户OTP/PKCE、管理员邮箱/TOTP、授权/撤销、来源撤回、版本冲突、迟到正文/会话与真实时钟到期均有原始记录。6张截图、3组实时GIF/MP4保留。Windows包未签名；业务数据与保留结果为明确合成夹具，模型没有运行，未重跑全平台完整回归。

| 编号 | 优先级 | 模块 | 当前状态 | 尚未完整完成的范围 |
| --- | --- | --- | --- | --- |
"""
lines = [f'| {r["id"]} | {r["priority"]} | {r["module"]} | {r["audit_status"]} | {r["current_audit_remaining"].replace("|", "／")} |'
         for r in value["requirements"]]
with TARGET.with_suffix(".md").open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(intro + "\n".join(lines) + "\n")
print(json.dumps({"records": 102, "scope_records_updated": len(scopes), "required_open": 89, "full_acceptance_closures": 0}))
