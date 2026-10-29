"""Read-only source/evidence reconciliation; preserve every earlier review and run."""

from __future__ import annotations

import hashlib
import json
import socket
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
PREVIOUS = ROOT / "docs/quality/remaining-work-current-review-125-v4.json"
OUTPUT = ROOT / "docs/quality/remaining-work-current-review-125-v5"
REPOS = {
    "backend": DEV / "copypaste-platform-publication-125",
    "web": DEV / "copypaste-web-publication-125",
    "admin": DEV / "copypaste-admin-publication-125",
    "desktop": DEV / "copypaste-desktop-publication-125",
    "extension": DEV / "copypaste-extension-publication-125",
    "delivery": DEV / "copypaste-delivery",
}
PREFIXES = {
    "copypaste-platform": REPOS["backend"],
    **{f"copypaste-{name}": REPOS[name] for name in REPOS if name != "backend"},
}


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            hasher.update(block)
    return hasher.hexdigest()


def identity(path: Path) -> dict:
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path)}


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def git(directory: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args],
        cwd=directory, text=True, encoding="utf-8", timeout=90,
    ).strip()


def receipt(repo: str, relative: str, prefixed: bool = False) -> dict:
    path = REPOS[repo] / relative
    data = read(path)
    different = []
    for name, expected in data["source_files"].items():
        if prefixed:
            prefix, suffix = name.split("/", 1)
            current = PREFIXES[prefix] / suffix
        else:
            current = REPOS[repo] / name
        if not current.is_file() or digest(current) != expected:
            different.append(name)
    result = {
        **identity(path),
        "at": data["at"], "status": data["status"],
        "scope": data.get("scope"), "counts": data["counts"],
        "source_unchanged_during_run": data["source_unchanged"],
        "captured_source_count": len(data["source_files"]),
        "captured_files_different_now": different,
        "captured_files_match_now": not different,
        "commands": data.get("commands", data.get("checks", [])),
        "scope_limit": "Only the recorded checks and captured bytes; not full product, native UI or professional-quality acceptance.",
    }
    for key in ["raw_report", "journey", "verifier", "journey_verifier", "fixture_cleanup"]:
        if isinstance(data.get(key), dict) and data[key].get("path"):
            original = data[key]
            actual = REPOS[repo] / original["path"]
            assert digest(actual) == original["sha256"], (path, key)
            result[key] = {**identity(actual), **{k: v for k, v in original.items() if k not in ["path", "sha256"]}}
    for key in ["owned_database_shutdown", "owned_database_port_closed", "ports_closed", "owned_previews_closed"]:
        if key in data:
            result[key] = data[key]
    return result


def closed(port: int) -> bool:
    with socket.socket() as stream:
        stream.settimeout(0.3)
        return stream.connect_ex(("127.0.0.1", port)) != 0


def main() -> None:
    assert ROOT == Path("D:/dev/copypasted/自有agent")
    assert not OUTPUT.with_suffix(".json").exists()
    assert not OUTPUT.with_suffix(".md").exists()
    old = read(PREVIOUS)
    rows = old["requirements"]
    assert len(rows) == len({r["id"] for r in rows}) == 102
    required = [r for r in rows if not r["optional"] and r["requirement_origin"] == "existing_requirement"]
    suggestions = [r for r in rows if r["requirement_origin"] == "expanded_design_suggestion"]
    optional = [r for r in rows if r["optional"]]
    assert (len(required), len(suggestions), len(optional)) == (89, 12, 1)
    assert Counter(r["recorded_assessment"] for r in required) == {"partial_verified": 77, "completion_not_proven": 12}

    latest = {
        "backend_focused_06": receipt("backend", ".data/publications-125/backend-06.json"),
        "extension_02": receipt("extension", ".data/publications-125/extension-02.json"),
        "desktop_02": receipt("desktop", ".data/publications-125/media-02.json"),
        "actual_web_admin_ui_03": receipt("delivery", "evidence/publications-ui-03.json", True),
    }
    assert latest["extension_02"]["counts"]["pass"] == 70
    assert latest["desktop_02"]["counts"]["pass"] == 21
    ui = latest["actual_web_admin_ui_03"]
    assert ui["status"] == "failed" and ui["counts"] == {"journey_checks": 1, "errors": 1}
    journey = read(ROOT / ui["journey"]["path"])
    assert all(journey[key] for key in ["browser_closed", "api_closed", "fixture_closed"])
    ports = {key: closed(int(key)) for key in ui["ports_closed"]}
    assert all(ports.values())

    updates = {
        "REQ-010": "完成外部发布的实际用户确认、撤销及恢复闭环；当前Web实际旅程卡在模拟账户OAuth回跳，Desktop及Extension新增发布流程仍缺原生端验收；其余外部写动作仍待覆盖。",
        "REQ-034": "统一其余外部写动作的防重复、未知结果核对、人工处置与恢复；发布专项06为29/29，完整相关05仍为107通过、2失败、1取消，修正后完整回归未完成。",
        "REQ-039": "完成公司签名安装、更新、卸载及约定OS/DPI验收；新增媒体逻辑21/21通过，已构建未签名目录包，不能替代实际Electron发布流程或正式安装验收。",
        "REQ-048": "补齐其余资源正文管理、受控客服协助及整个后台；发布管理类型检查及构建通过，实际Admin页面旅程未完成，授权CLI和完整权限覆盖待验。",
        "REQ-060": "完成独立检出复现、本轮六组件源码整合、双语README、实际截图/GIF、提交推送及最终源码交付；远端组件仍为阶段124。",
        "REQ-074": "完成逐角色全部输入输出、实际文件、流程及异常验收；发布工具和版本化Skill已有代码，后端专项通过不能替代专业角色资格。",
        "REQ-075": "完成全部角色、团队、计划及恢复分支的实际Codex执行；四个新发布工具缺实际Codex调用，05原生分析角色RPC超时及另一角色超时取消尚未解决。",
    }
    for row in rows:
        if row["id"] in updates:
            row["current_audit_remaining"] = updates[row["id"]]
        row["full_acceptance"] = "open"

    packages = [
        ("125-01", "后端与Codex运行", "修正原生角色RPC超时并重新完成完整相关回归；06专项29/29保留，不能替代05的失败/取消。", "REQ-010、034、044、074、075"),
        ("125-02", "媒体与权限", "验证所有配额/存储/撤权组合及三端实际媒体；06实际JPEG/Admin读取为限定历史证据。", "REQ-002、014、049、050、057、089、102"),
        ("125-03", "未知结果与恢复", "完成全部外部写动作和灾难恢复；实际JPEG/密封回执专项恢复已通过。", "REQ-009、034、049、053"),
        ("125-04", "工具与角色", "实际调用四个Codex发布工具、本机接入、至少十二个角色的专业任务及异常资格。", "REQ-043、044、073、074、075、080"),
        ("125-05", "Web发布流程", "解决模拟OAuth授权回跳阻塞，再完成客户明确确认、未知结果、撤权、响应式、键盘与实际录制。03实际检查仅1项通过，流程失败。", "REQ-010、035、055、081、082"),
        ("125-06", "Desktop原生流程", "21/21逻辑检查及未签名目录包已完成；实际Electron媒体协议、发布、本机Codex、无边框和无可见滚动条验收待完成。", "REQ-010、039、040、041、055、082"),
        ("125-07", "Extension原生流程", "新增只读列表/详情和受限Web跳转；70/70逻辑检查与构建通过。实际右侧Side Panel、账号切换、文件云端接续和录制待完成。", "REQ-010、036、037、038、041"),
        ("125-08", "Admin实际验收", "页面/策略/正文与媒体分权/原请求恢复已有代码；丢失响应时关闭遮挡弹窗已修正。实际页面、授权CLI与完整权限矩阵仍待验。", "REQ-048、090、092、094"),
        ("125-09", "整合与源码交付", "生成成功旅程的真实截图/GIF，更新六组件双语README和说明，独立检出复现，整合提交并推送产品分支。", "REQ-054、055、060、081、082"),
    ]
    remotes = {}
    for line in git(ROOT, "ls-remote", "origin", *[f"refs/heads/{name}" for name in ["main", "docs", *REPOS]]).splitlines():
        commit, ref = line.split()
        remotes[ref.removeprefix("refs/heads/")] = commit
    package = REPOS["desktop"] / "release/win-unpacked/CopyPaste.exe"
    report = {
        "schema_version": 5,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "audit_kind": "open_acceptance_inventory_reconciled_with_latest_terminal_receipts_and_captured_source_bytes",
        "previous_review": identity(PREVIOUS), "summary": old["summary"],
        "required_priorities": old["required_priorities"], "module_groups": old["module_groups"],
        "requirements": rows,
        "publication_in_progress": [dict(zip(["id", "module", "remaining", "overlapping_requirements"], row)) for row in packages],
        "latest_bounded_evidence": latest,
        "latest_full_related_backend_execution": old["latest_full_related_backend_execution"],
        "actual_browser_failure": {
            "stage": journey["stage"], "checks": journey["checks"], "errors": journey["errors"],
            "browser_closed": journey["browser_closed"], "api_closed": journey["api_closed"],
            "fixture_closed": journey["fixture_closed"], "owned_ports_closed_at_review": ports,
            "diagnostic": "Synthetic consent form submission is blocked by browser form-action policy; the attempted CSP correction did not pass run03. Root cause/fix remains open.",
        },
        "desktop_development_package": {**identity(package), "signed": False, "native_publishing_ui_accepted": False},
        "component_heads": {name: git(directory, "rev-parse", "HEAD") for name, directory in REPOS.items()},
        "remote_before_this_documentation_update": remotes,
        "user_authorized_synthetic_data": True, "new_full_acceptance_closures": 0,
        "verifier_sha256": digest(Path(__file__).resolve()),
        "limits": [
            "89 required open acceptance records are not 89 uncoded modules or a code completion percentage.",
            "The 12 unconfirmed design suggestions and one optional cloud-computer record are counted separately from mandatory delivery.",
            "The 77/12 assessment comes from the existing acceptance ledger, not a new full-product test run.",
            "Current byte matching covers captured files only, not added-file membership or untested behavior.",
            "Synthetic provider/model data is authorized; live-provider and professional-quality acceptance remains separate.",
            "The failed actual UI attempts and all previous raw reports/verifiers remain unchanged.",
            "This is a documentation audit; no product source was modified or newly published by this verifier.",
        ],
    }
    OUTPUT.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# 全部未完成项核查 · 阶段125 v5 / All open work review", "",
        "**必需需求89条尚未完成整体验收：77条部分验证、12条未证完成。另列12条未确认扩展建议与1条可选项；共102条开放记录。**", "",
        "这是需求验收口径，不等于89个模块尚未编码，也不能换算为代码完成百分比。本次没有关闭任何原始整体验收项。", "",
        "| 分类 | 部分验证 | 未证完成 | 未关闭合计 |", "| --- | ---: | ---: | ---: |",
        "| 必需交付 | 77 | 12 | 89 |", "| 未确认扩展建议 | 9 | 3 | 12 |", "| 可选 | 0 | 1 | 1 |", "| 总计 | 86 | 16 | 102 |", "",
        "| 模块 | 必需未完成 | 扩展建议 | 可选 |", "| --- | ---: | ---: | ---: |",
    ]
    for group in old["module_groups"]:
        lines.append(f"| {group['module_group']} | {group['required_open']} | {group['unconfirmed_suggestions']} | {group['optional_open']} |")
    lines += [
        "", "最新限定证据：Extension类型检查、构建和70/70逻辑检查通过；Desktop主进程/渲染层类型检查及21/21逻辑检查通过，未签名开发目录包已构建。两组当前捕获源码匹配仍需以JSON核对；这些均不代表原生发布页面验收。", "",
        "Web/Admin实际页面03执行失败：客户邮箱/OTP登录一项通过，随后模拟账户OAuth授权回跳被浏览器表单策略阻断。尝试的CSP修正尚未通过；Admin后续页面未执行，不记为通过。03源码未变化，自建浏览器、API、夹具和数据库已回收，相关端口本次复核已关闭。", "",
        "平台/Web/Admin本次类型检查和构建通过。后端05完整相关回归仍为110项中107通过、2失败、1取消；06发布专项29/29通过，但后续源码已变化，作为对应旧源码的限定证据保留。原生Codex超时与修正后的完整相关回归仍开放。", "",
        "远端六组件仍为阶段124，本轮125产品源码未完成整合提交和推送。正式账户、真实模型、专业业务质量与签名安装另行验收；当前继续采用用户已授权的假数据。", "",
        "以下9个工作包与原需求重叠，不增加102条总数。", "",
        "| 编号 | 模块 | 尚需完成 | 对应需求 |", "| --- | --- | --- | --- |",
    ]
    for entry in packages:
        lines.append("| " + " | ".join(entry) + " |")
    for title, collection in [("必需未完成项（89条）", required), ("未确认扩展建议（12条，不计入89条必需交付）", suggestions), ("可选项（1条）", optional)]:
        lines += ["", f"## {title}", "", "| 编号 | 优先级 | 模块 | 状态 | 尚需完成 |", "| --- | --- | --- | --- | --- |"]
        for row in collection:
            lines.append(f"| {row['id']} | {row['priority']} | {row['module']} | {row['audit_status']} | {row['current_audit_remaining']} |")
    lines += ["", "## 核查边界 / Audit limits", "", *[f"- {limit}" for limit in report["limits"]], "", "[结构化证据 / Structured evidence](remaining-work-current-review-125-v5.json) · [保留的v4 / Previous review](remaining-work-current-review-125-v4.md)", ""]
    OUTPUT.with_suffix(".md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"summary": report["summary"], "captured_source_matches": {k: v["captured_files_match_now"] for k, v in latest.items()}, "ui_status": ui["status"], "ports_closed": ports, "written": [OUTPUT.with_suffix(ext).relative_to(ROOT).as_posix() for ext in [".json", ".md"]]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
