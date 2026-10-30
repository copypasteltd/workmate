"""Keep the original 102 acceptance identities and update only evidenced scope."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
PREVIOUS = QUALITY / "remaining-work-stage131.json"
CP = QUALITY / "content-history-checkpoint-132.json"
TARGET = QUALITY / "remaining-work-stage132.json"
assert not TARGET.exists() and not TARGET.with_suffix(".md").exists()
old, checkpoint = json.loads(PREVIOUS.read_bytes()), json.loads(CP.read_bytes())
assert checkpoint["status"] == "verified_bounded_admin_content_history"
value = copy.deepcopy(old)
scopes = {
    "REQ-003": "本轮实际后台邮箱验证码和MFA登录、过期及撤销会话拒绝继续读取已验证；企业身份正式部署、签名安装后登录及全部三端过期、换账号、断网和竞争组合仍需验收。",
    "REQ-006": "本轮205版记忆经真实API创建并完整翻页，客户更新使旧游标失效，删除清除历史正文及定义；全部索引、历史引用、缓存和备份恢复后的删除一致性继续开放。",
    "REQ-048": "本轮补齐后台会话、专家和记忆的完整历史阅读、双语页面与撤权清空；全部资源运营、受控客服协助和完整后台权限/运营矩阵仍待完成，不以三类历史阅读替代完整后台验收。",
    "REQ-060": "本轮54项后端相关测试和9项实际后台旅程绑定源码、原始失败、5截图及2组实时GIF/MP4，双语说明和版本化发布工具同步；实际远端结果以推送回执为准，独立检出复现及全部交付验收继续开放。",
    "REQ-090": "专家和记忆超过200版已可完整分页读取，66条真实会话消息保留原顺序，管理员修订独立标注；其余资源的完整历史、关联展示、受控客服操作及全内容矩阵继续验收。",
    "REQ-091": "本轮验证任务来源隔离后清空已打开的助手正文，重新读取时隐藏来源不可用正文，删除记忆后不提供旧历史；全部导出、分享、索引、模型读取和备份恢复组合仍需验收。",
    "REQ-094": "三类历史每页复查MFA会话、正文权限交集、企业项目范围和显式拒绝，绑定身份的签名游标及实际撤权页面清空已验证；全部动作、字段和异步权限竞争矩阵继续开放。",
    "REQ-098": "本轮三类历史阅读器在375/768/1440宽度、键盘关闭、中英界面、迟到响应和权限/内容失效提示通过实际页面检查；全模块可用性、异常恢复、键盘读屏及完整运营路径继续开放。",
}
for row in value["requirements"]:
    if row["id"] in scopes:
        row["current_audit_remaining"] = scopes[row["id"]]
        row["current_review_note"] = "阶段132有界历史阅读增量；完整验收记录保持开放，以检查点和原始证据为准。"
assert len(value["requirements"]) == 102
assert [r["id"] for r in value["requirements"]] == [r["id"] for r in old["requirements"]]
assert all(r["full_acceptance"] == "open" for r in value["requirements"])
value["schema_version"] = 14
value["reviewed_at"] = datetime.now(timezone.utc).isoformat()
value["previous_review"] = {"path": PREVIOUS.relative_to(ROOT).as_posix(), "sha256": sha256(PREVIOUS.read_bytes()).hexdigest()}
value["checkpoint"] = {"path": CP.relative_to(ROOT).as_posix(), "sha256": sha256(CP.read_bytes()).hexdigest()}
value["new_full_acceptance_closures"] = 0
value["current_increment"] = {"stage": 132, "counts": checkpoint["counts"], "required_open": 89,
    "unconfirmed_suggestions": 12, "optional_open": 1, "whole_platform_runtime_rerun": False,
    "full_acceptance_closures": 0, "updated_scope_records": list(scopes)}
with TARGET.open("x", encoding="utf-8", newline="\n") as file:
    json.dump(value, file, ensure_ascii=False, indent=2)
    file.write("\n")
intro = """# 当前完整编号待办 · 阶段132

继承全部102条原始完整验收记录：89条必需、12条未确认建议、1条可选。它们不是102个未编码模块。本轮只更新有证据的8条范围，没有提前关闭完整验收记录。

[机器可读清单](remaining-work-stage132.json) · [本轮检查点](content-history-checkpoint-132.json) · [原始证据](content-history-evidence-132/index.json) · [本轮变更](../changes/132-admin-content-history.md)

本轮54项后端相关测试和9项实际后台旅程通过；205版专家/记忆历史及66条会话消息使用真实API数据，原生SQL和浏览器实际运行。5张截图、2组实时GIF/MP4和原始失败保留。助手来源撤回使用明确合成结果，模型没有运行，未重跑全平台完整回归。

| 编号 | 优先级 | 模块 | 当前状态 | 尚未完整完成的范围 |
| --- | --- | --- | --- | --- |
"""
lines = [f'| {r["id"]} | {r["priority"]} | {r["module"]} | {r["audit_status"]} | {r["current_audit_remaining"].replace("|", "／")} |'
         for r in value["requirements"]]
with TARGET.with_suffix(".md").open("x", encoding="utf-8", newline="\n") as file:
    file.write(intro + "\n".join(lines) + "\n")
print(json.dumps({"records": 102, "scope_records_updated": len(scopes), "full_acceptance_closures": 0, "required_open": 89}))
