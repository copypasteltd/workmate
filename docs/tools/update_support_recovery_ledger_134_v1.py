"""Close only the original TC-095, retaining every original requirement identity."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
PREVIOUS = QUALITY / "remaining-work-stage133.json"
CP = QUALITY / "support-recovery-checkpoint-134.json"
ACCEPTANCE = QUALITY / "tc095-acceptance-134.json"
TARGET = QUALITY / "remaining-work-stage134.json"
assert not TARGET.exists() and not TARGET.with_suffix(".md").exists()
old, cp, acceptance = [json.loads(p.read_bytes()) for p in [PREVIOUS, CP, ACCEPTANCE]]
assert cp["status"] == "verified_support_recovery_and_original_tc095"
assert acceptance["status"] == "accepted_original_scope" and all(r["status"] == "passed" for r in acceptance["criteria"])
value = copy.deepcopy(old)
scopes = {
    "REQ-003": "本轮实际客户OTP/PKCE、管理员邮箱/TOTP及授权响应丢失／刷新／切换企业恢复通过；正式企业身份部署、签名安装登录及全部三端会话异常组合继续验收。",
    "REQ-039": "实际未签名Windows桌面包完成授权提交后丢失响应与刷新查收、客户撤销；本机200%缩放、三档窗口无边框／默认菜单／可见滚动条／横向溢出通过；签名安装、OS／DPI及全部本机工具完整旅程仍待验收。",
    "REQ-048": "客服协助原始REQ-095已完成逐条综合验收；全部后台资源运营、其他权限和运营矩阵、各页面异常恢复及无障碍继续按所属需求验收。",
    "REQ-055": "支持页面键盘操作、Web／Admin CSS 200%文字放大和Desktop实际原生200%缩放通过；全关键路径浏览器缩放、读屏、对比与reduced-motion仍待完整验收。",
    "REQ-060": "本轮65项相关后端、1项原生桥边界及18项实际Admin／Web／Windows旅程绑定确切源码，9截图与5组实时GIF／MP4保留；完整独立检出复现、正式安装和全源码交付综合验收仍待完成。",
    "REQ-094": "原始客服只读上下文及新增本人／企业授权回执查收已有跨身份、当前权限、并发与事务证据；全平台角色／动作／字段／导出／异步权限矩阵仍待完整验收，不再计入TC-095。",
    "REQ-095": "原始TC-095十二条条件已逐条通过；当前源码复测65项后端与18项实际多端旅程。全平台无障碍、完整权限矩阵及正式安装按REQ-055／094／039独立跟踪。",
    "REQ-098": "客服工作台原始业务验收及客户响应丢失／刷新／企业切换恢复通过，支持表单键盘与定向放大通过；其他全部运营页面及完整后台可用性继续验收。",
}
for row in value["requirements"]:
    if row["id"] in scopes:
        row["current_audit_remaining"] = scopes[row["id"]]
        row["current_review_note"] = "阶段134客户授权恢复与原始TC-095逐条综合验收；其他需求保留自身完整验收边界。"
    if row["id"] == "REQ-095":
        assert row["full_acceptance"] == "open" and not row["optional"]
        row["full_acceptance"] = "accepted"
        row["audit_status"] = "原始验收已完成"
        row["acceptance_evidence"] = {"path": ACCEPTANCE.relative_to(ROOT).as_posix(), "sha256": sha256(ACCEPTANCE.read_bytes()).hexdigest()}
assert len(value["requirements"]) == 102
assert [r["id"] for r in value["requirements"]] == [r["id"] for r in old["requirements"]]
assert sum(r["full_acceptance"] == "accepted" for r in value["requirements"]) == 1
assert sum(r["full_acceptance"] == "open" for r in value["requirements"]) == 101
for key in ["required_open", "required_partial", "all_open_records", "all_partial"]:
    value["summary"][key] -= 1
value["summary"]["fully_accepted"] = 1
value["required_priorities"]["P0"] -= 1
group = value["module_groups"][-1]
for key in ["open", "partial_verified", "required_open"]:
    group[key] -= 1
value["schema_version"] = 16
value["reviewed_at"] = datetime.now(timezone.utc).isoformat()
value["previous_review"] = {"path": PREVIOUS.relative_to(ROOT).as_posix(), "sha256": sha256(PREVIOUS.read_bytes()).hexdigest()}
value["checkpoint"] = {"path": CP.relative_to(ROOT).as_posix(), "sha256": sha256(CP.read_bytes()).hexdigest()}
value["new_full_acceptance_closures"] = 1
value["current_increment"] = {"stage": 134, "counts": cp["counts"], "required_open": 88,
    "unconfirmed_suggestions": 12, "optional_open": 1, "whole_platform_runtime_rerun": False,
    "full_acceptance_closures": 1, "accepted_requirements": ["REQ-095"], "updated_scope_records": list(scopes)}
with TARGET.open("x", encoding="utf-8", newline="\n") as stream:
    json.dump(value, stream, ensure_ascii=False, indent=2)
    stream.write("\n")
intro = """# 当前完整编号清单 · 阶段134

保留全部102条原始需求身份：本轮完成原始REQ-095／TC-095，88条必需、12条未确认建议、1条可选记录仍开放。这是完整验收记录数量，不代表101个未编码模块；已编码及已验证范围见各条记录。本轮按原始条件结案客服协助，不把REQ-055全平台无障碍及REQ-094全部权限矩阵重复计入这一项。

[逐条TC-095验收](tc095-acceptance-134.json) · [机器可读清单](remaining-work-stage134.json) · [检查点](support-recovery-checkpoint-134.json) · [原始证据](support-recovery-evidence-134/index.json) · [变更](../changes/134-support-grant-recovery-and-acceptance.md)

本轮65项相关后台检查、1项原生桥边界、18项实际Admin／Web／Windows旅程及10条构建命令通过。9截图、5组实时GIF／MP4绑定确切源码，原失败与全部历史身份保留。业务使用假数据，模型未运行；Windows包未签名，不宣称完整生产或全平台回归通过。

| 编号 | 优先级 | 模块 | 当前状态 | 原始完整验收的当前结论及余项 |
| --- | --- | --- | --- | --- |
"""
lines = [f'| {r["id"]} | {r["priority"]} | {r["module"]} | {r["audit_status"]} | {r["current_audit_remaining"].replace("|", "／")} |' for r in value["requirements"]]
with TARGET.with_suffix(".md").open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(intro + "\n".join(lines) + "\n")
print(json.dumps({"records": 102, "required_open": 88, "original_tc095_accepted": True, "full_acceptance_closures": 1}))
