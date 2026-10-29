"""Reconcile the complete open ledger with terminal Stage125 evidence only."""

from __future__ import annotations

import importlib.util
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "docs/tools/record_open_work_review_125_v6.py"
spec = importlib.util.spec_from_file_location("preserved_review_v6", HELPER)
assert spec is not None and spec.loader is not None
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
OUTPUT = ROOT / "docs/quality/remaining-work-current-review-125-v7"


def main() -> None:
    assert ROOT == Path("D:/dev/copypasted/自有agent")
    for suffix in [".json", ".md"]:
        assert not OUTPUT.with_suffix(suffix).exists(), "Never overwrite a review"
    previous = ROOT / "docs/quality/remaining-work-current-review-125-v6.json"
    old = base.read(previous)
    rows = old["requirements"]
    assert len(rows) == len({row["id"] for row in rows}) == 102
    required = [row for row in rows if not row["optional"] and row["requirement_origin"] == "existing_requirement"]
    suggestions = [row for row in rows if row["requirement_origin"] == "expanded_design_suggestion"]
    optional = [row for row in rows if row["optional"]]
    assert (len(required), len(suggestions), len(optional)) == (89, 12, 1)
    assert Counter(row["recorded_assessment"] for row in required) == {"partial_verified": 77, "completion_not_proven": 12}

    latest = {
        "backend_full_related_09": base.receipt("backend", ".data/publications-125/backend-09.json", True),
        "admin_upgrade_cli_07": base.receipt("backend", ".data/publications-125/backend-07.json", True),
        "analysis_native_roles_08": base.receipt("backend", ".data/publications-125/backend-08.json", True),
        "desktop_media_03": base.receipt("desktop", ".data/publications-125/media-03.json"),
        "extension_02": base.receipt("extension", ".data/publications-125/extension-02.json"),
        "actual_web_admin_ui_10": base.receipt("delivery", "evidence/publications-ui-10.json", True),
    }
    for key, count in [("backend_full_related_09", 117), ("admin_upgrade_cli_07", 5), ("analysis_native_roles_08", 12), ("desktop_media_03", 21), ("extension_02", 70)]:
        evidence = latest[key]
        assert evidence["status"] == "passed"
        assert evidence["counts"]["tests"] == evidence["counts"]["pass"] == count
    assert all(item["source_unchanged_during_run"] and item["captured_files_match_now"] for item in latest.values())

    ui = latest["actual_web_admin_ui_10"]
    assert ui["status"] == "failed" and ui["counts"] == {"journey_checks": 5, "errors": 1}
    journey_path = ROOT / ui["journey"]["path"]
    journey = base.read(journey_path)
    assert all(journey[key] for key in ["browser_closed", "api_closed", "fixture_closed"])
    observed = sorted({item["width"] for item in journey["layouts"] if item["component"] == "web-preview"})
    assert observed == [375, 768]
    assert "Published" in journey["errors"][0]
    web_status = base.REPOS["web"] / "src/publication-data.ts"
    assert 'succeeded: ["平台已確認發布", "Publication confirmed by provider"]' in web_status.read_text(encoding="utf-8")

    consent_path = base.REPOS["delivery"] / "evidence/publication-consent-03.json"
    consent = base.read(consent_path)
    assert consent["status"] == "passed" and len(consent["checks"]) == 3
    assert consent["source_unchanged"] and consent["browser_closed"] and consent["fixture_closed"]
    assert consent["callback_requests"] == consent["web_landings"] == 2 and consent["hostile_posts"] == 0
    for name, expected in consent["source_files"].items():
        prefix, suffix = name.split("/", 1)
        assert base.digest(base.PREFIXES[prefix] / suffix) == expected
    latest["browser_consent_03"] = {**base.identity(consent_path), "status": consent["status"], "checks": consent["checks"], "source_files": consent["source_files"], "captured_files_match_now": True, "browser_closed": True, "fixture_closed": True, "ports_closed": consent["ports_closed"]}

    ports = set(ui["ports_closed"]) | set(consent["ports_closed"])
    for key in ["backend_full_related_09", "admin_upgrade_cli_07", "analysis_native_roles_08"]:
        item = latest[key]
        assert item["owned_database_shutdown"] and item["owned_database_port_closed"]
        raw = base.read(ROOT / item["path"])
        ports.add(str(raw["owned_native_port"]))
    closed_ports = {port: base.closed(int(port)) for port in sorted(ports, key=int)}
    assert all(closed_ports.values()) and ui["owned_previews_closed"]

    updates = {
        "REQ-010": "完成其余外部写动作和三端实际客户确认、撤销与恢复。Web10已有实际发布回执，但检查器仍等待错误文案，完整旅程失败；原生Desktop/Extension发布尚未验收。",
        "REQ-034": "统一其余外部写动作的防重复、未知结果核对、人工处置与恢复。当前发布完整相关后端09为117/117通过，不能替代全部外部动作验收。",
        "REQ-039": "完成公司签名安装、更新、卸载及约定OS/DPI验收；当前媒体/会话21/21及最新未签名目录包通过，实际Electron新增发布流程仍待验。",
        "REQ-048": "补齐其余资源正文管理、受控客服协助与完整后台；显式授权CLI五项通过，新增发布Admin实际页面尚未执行完成。",
        "REQ-060": "完成独立检出复现、本轮六组件整合、双语README、成功旅程真实截图/GIF、提交推送及最终源码交付；产品远端仍为阶段124。",
        "REQ-074": "完成逐角色全部输入输出、实际文件、业务流程及异常资格；当前发布工具/版本化Skill已有代码，相关回归不等于专业角色资格。",
        "REQ-075": "完成全部角色、团队、计划和恢复分支的实际Codex执行，四个新增发布工具仍缺实际Codex调用。当前分析08为12/12、相关完整09为117/117；此前偶发超时根因未确定。",
        "REQ-082": "全组件状态、四档宽度、缩放、键盘、对比和动画设置验收。Web10的四档检查声明无效：记录仅375/768px，1024/1440px必须实际重验。",
        "REQ-094": "全动作、对象状态、额度、导出和异步权限矩阵仍待完整验收；新增显式发布授权、旧会话撤销、重复/并发及拒绝组合CLI五项已通过。",
    }
    for row in rows:
        if row["id"] in updates:
            row["current_audit_remaining"] = updates[row["id"]]
        row["full_acceptance"] = "open"

    completed = [
        ("125-D01", "模拟OAuth浏览器回跳", "实际批准、取消及未配置目标阻断，3/3通过。"),
        ("125-D02", "账户范围刷新竞态", "Web/Desktop增加当前快照等待；实际延迟响应检查通过，避免新策略编辑器被旧响应关闭。"),
        ("125-D03", "Admin显式授权与会话撤销", "实际原生数据库及子进程CLI，5/5通过；新增授权原子撤销旧会话，重复/并发不重复授权。"),
        ("125-D04", "完整相关后端回归", "09为117/117通过；分析角色专项08为12/12，包含两个实际原生Codex角色。"),
        ("125-D05", "Desktop逻辑和开发包", "当前类型检查及媒体/会话21/21通过，最新未签名目录包已构建。"),
        ("125-D06", "Extension逻辑和构建", "当前70/70通过；只读发布查看、受限跳转和私有详情清理已实现。"),
    ]
    packages = [
        ("125-01", "Web/Admin实际旅程", "修正检查器状态文案与并发录制/视口变更，实际重验四档宽度，再完成JPEG、未知结果、Admin权限/取消恢复及撤权。"),
        ("125-02", "Desktop原生验收", "实际Electron媒体协议、发布确认、本机Codex工具、无边框与无可见滚动条；正式签名安装另验。"),
        ("125-03", "Extension原生验收", "实际Chrome右侧Side Panel查看、账号/项目切换、撤权、文件云端接续及录制。"),
        ("125-04", "Codex工具与角色", "实际调用四个新增发布工具，完成至少十二个角色专业任务、修改、异常与费用资格；保留此前偶发超时诊断。"),
        ("125-05", "权限、媒体及恢复完整矩阵", "全部跨企业/项目/来源、额度、配额、撤权、异步与存储/备份组合及其余外部动作。"),
        ("125-06", "源码整合和交付", "成功截图/GIF、六组件双语说明、独立检出复现、提交及普通推送；本轮产品分支仍未发布。"),
    ]
    remote = {}
    for line in base.git(ROOT, "ls-remote", "origin", *[f"refs/heads/{name}" for name in ["main", "docs", *base.REPOS]]).splitlines():
        commit, ref = line.split()
        remote[ref.removeprefix("refs/heads/")] = commit
    package_root = base.REPOS["desktop"] / "release/publications-125-02/win-unpacked"
    report = {
        "schema_version": 7, "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "audit_kind": "all_open_requirements_reconciled_with_terminal_exact_source_bounded_evidence",
        "previous_review": base.identity(previous), "helper": base.identity(HELPER),
        "verifier_sha256": base.digest(Path(__file__).resolve()),
        "summary": old["summary"], "required_priorities": old["required_priorities"], "module_groups": old["module_groups"],
        "requirements": rows, "latest_bounded_evidence": latest,
        "this_round_implemented": [dict(zip(["id", "module", "result"], item)) for item in completed],
        "overlapping_work_packages": [dict(zip(["id", "module", "remaining"], item)) for item in packages],
        "actual_ui_limit": {"status": "failed", "checks": journey["checks"], "errors": journey["errors"], "admin_publishing_pages_reached": False, "requested_preview_widths": [375, 768, 1024, 1440], "observed_preview_widths": observed, "four_width_claim_valid": False, "wrong_status_locator": "Published", "actual_status_label": "Publication confirmed by provider", "screenshots_are_successful_full_journey_evidence": False},
        "current_owned_ports_closed": closed_ports,
        "desktop_development_package": {"executable": base.identity(package_root / "CopyPaste.exe"), "application_archive": base.identity(package_root / "resources/app.asar"), "signed": False, "native_publishing_ui_accepted": False},
        "component_heads": {key: base.git(directory, "rev-parse", "HEAD") for key, directory in base.REPOS.items()},
        "remote_before_this_documentation_update": remote,
        "user_authorized_synthetic_data": True, "new_full_acceptance_closures": 0,
        "limits": ["89 open required records are acceptance units, not 89 uncoded modules or a code completion percentage.", "Twelve unconfirmed suggestions and one optional item are excluded from the 89 mandatory records.", "Current source matching covers captured files only, not added-file membership or untested behavior.", "117/117 is the complete related backend scope, not a new full-product regression.", "Passing diagnostic and subsequent full related runs do not establish the cause or permanent fix of an earlier intermittent Codex timeout.", "UI10 remains failed; its four-width claim is invalid and later Admin checks were not reached.", "Synthetic providers/models are authorized; live services and professional quality remain separately unaccepted.", "All earlier verifiers, failures, reports and captures remain unchanged.", "This documentation verifier does not change or publish product source."],
    }
    OUTPUT.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    lines = ["# 全部未完成项核查 · 阶段125 v7 / All open work review", "", "**89条必需需求仍未完成整体验收：77条部分验证、12条未证完成。另有12条未确认扩展建议及1条可选项，共102条开放记录。**", "", "这是需求验收口径，不是89个尚未编码的模块；本轮没有关闭任何完整需求。继续使用用户已授权的假数据，不把真实服务及专业效果未验收混为代码未实现。", "", "| 分类 | 部分验证 | 未证完成 | 未关闭合计 |", "| --- | ---: | ---: | ---: |", "| 必需交付 | 77 | 12 | 89 |", "| 未确认扩展建议 | 9 | 3 | 12 |", "| 可选 | 0 | 1 | 1 |", "| 合计 | 86 | 16 | 102 |", "", "| 模块 | 必需未完成 | 扩展建议 | 可选 |", "| --- | ---: | ---: | ---: |"]
    for group in old["module_groups"]:
        lines.append(f"| {group['module_group']} | {group['required_open']} | {group['unconfirmed_suggestions']} | {group['optional_open']} |")
    lines += ["", "## 本轮已实现及限定验证", "", "| 编号 | 模块 | 实际结果 |", "| --- | --- | --- |"]
    lines += ["| " + " | ".join(item) + " |" for item in completed]
    lines += ["", "上述回执捕获的当前源码均逐字节匹配。Web/Admin10终态仍失败：5项检查已记录通过，等待发布成功状态时使用错误文案；实际源码文案为`Publication confirmed by provider`。其四档布局声明不能采用，原始观察只有375/768px；必须修正检查器并实际重验1024/1440px。后续Instagram及Admin发布页尚未完成，失败录制不能作为成功整旅程证据。浏览器、API、夹具、原生数据库及预览进程均已关闭，相关自建端口本次复核关闭。", "", "后端09完整相关117/117和分析08的12/12已通过，不再将旧05的失败算作当前回归结果。旧失败永久保留；此前偶发Codex超时根因仍未确定，不声称已永久修复。Desktop目录包未签名，Desktop/Extension新增发布流程的原生页面仍未验收。远端六组件仍为阶段124，本轮125产品源码尚未整合推送。", "", "## 当前增量待办（与原需求重叠，不增加102条总数）", "", "| 编号 | 模块 | 尚需完成 |", "| --- | --- | --- |"]
    lines += ["| " + " | ".join(item) + " |" for item in packages]
    for title, collection in [("必需未完成项（89条）", required), ("未确认扩展建议（12条，不计入必需交付）", suggestions), ("可选项（1条）", optional)]:
        lines += ["", "## " + title, "", "| 编号 | 优先级 | 模块 | 状态 | 尚需完成 |", "| --- | --- | --- | --- | --- |"]
        lines += [f"| {row['id']} | {row['priority']} | {row['module']} | {row['audit_status']} | {row['current_audit_remaining']} |" for row in collection]
    lines += ["", "## 核查边界 / Audit limits", "", *["- " + item for item in report["limits"]], "", "[结构化证据](remaining-work-current-review-125-v7.json) · [保留v6](remaining-work-current-review-125-v6.md) · [当前发布方案](../technical/125-controlled-publishing-and-native-media.md)", ""]
    OUTPUT.with_suffix(".md").write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(json.dumps({"summary": report["summary"], "current_source_matches": {key: value["captured_files_match_now"] for key, value in latest.items()}, "owned_ports_closed": closed_ports, "ui_status": ui["status"], "valid_four_width_claim": False, "written": [OUTPUT.with_suffix(suffix).relative_to(ROOT).as_posix() for suffix in [".json", ".md"]]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
