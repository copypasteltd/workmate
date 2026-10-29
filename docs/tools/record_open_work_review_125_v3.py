"""Record all open acceptance records without converting limited passes into closure."""
from __future__ import annotations

import collections
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
BACKEND = ROOT / "dev/copypaste-platform-publication-125"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args],
        cwd=repo, text=True, encoding="utf-8", errors="strict",
    ).strip()


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def report_at(path: Path, repo: Path, prefix: str = ""):
    data = read(path)
    raw_path = repo / data["raw_report"]["path"] if "raw_report" in data else path.with_suffix(".tap")
    expected_raw_sha = data["raw_report"]["sha256"] if "raw_report" in data else data["tap_sha256"]
    assert sha(raw_path) == expected_raw_sha
    current, different = 0, []
    for name, expected in data.get("source_files", data.get("source_sha256", {})).items():
        if prefix and "source_files" in data:
            assert name.startswith(prefix)
            name = name[len(prefix):]
        assert ".." not in Path(name).parts
        file = repo / name
        if file.is_file() and sha(file) == expected:
            current += 1
        else:
            different.append(name)
    return {
        "path": relative(path), "sha256": sha(path),
        **{key: data.get(key) for key in ("at", "status", "counts", "source_unchanged", "owned_database_shutdown", "owned_database_port_closed")},
        "raw_report": {"path": relative(raw_path), "sha256": sha(raw_path)},
        "currently_matching_source_files": current,
        "currently_different_source_files": different,
        "acceptance_scope": "Only this execution's exact captured sources and checks; not full-product acceptance.",
    }


def main():
    outputs = [QUALITY / f"remaining-work-current-review-125-v3.{kind}" for kind in ("json", "md")]
    assert not any(path.exists() for path in outputs), "Executed reviews must be preserved; use a new version."
    previous_path = QUALITY / "remaining-work-current-review-125-v2.json"
    previous = read(previous_path)
    rows = copy.deepcopy(previous["requirements"])
    assert [row["id"] for row in rows] == [f"REQ-{n:03}" for n in range(1, 103)]
    required = [row for row in rows if row["requirement_origin"] == "existing_requirement" and not row["optional"]]
    suggestions = [row for row in rows if row["requirement_origin"] == "expanded_design_suggestion"]
    optional = [row for row in rows if row["optional"]]
    assert (len(required), len(suggestions), len(optional)) == (89, 12, 1)
    assert collections.Counter(row["recorded_assessment"] for row in required) == {"partial_verified": 77, "completion_not_proven": 12}
    assert all(row["full_acceptance"] == "open" for row in rows)

    history = []
    for name in ("backend-01", "backend-02", "backend-03", "protocol-04", "backend-04"):
        history.append(report_at(BACKEND / f".data/publications-125/{name}.json", BACKEND, "copypaste-platform/"))
    assert history[-1]["counts"] == {"tests": 109, "pass": 99, "fail": 10, "cancelled": 0, "skipped": 0, "todo": 0}
    assert all(history[-1][key] for key in ("source_unchanged", "owned_database_shutdown", "owned_database_port_closed"))

    clients = {}
    for label, folder, filename, count in (
        ("desktop", "copypaste-desktop-publication-125", "media-01", 21),
        ("web", "copypaste-web-publication-125", "web-01", 20),
    ):
        repo = ROOT / "dev" / folder
        item = report_at(repo / f".data/publications-125/{filename}.json", repo)
        assert item["status"] == "passed" and item["source_unchanged"] is True
        assert not item["currently_different_source_files"]
        assert item["counts"] == {"tests": count, "pass": count, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}
        clients[label] = item

    running_path = BACKEND / ".data/publications-125/backend-05.json"
    if running_path.exists():
        latest_run = {"terminal": True, **report_at(running_path, BACKEND, "copypaste-platform/")}
        history.append(latest_run)
        backend_note = f"后端05已结束：{latest_run['counts']['tests']}项，{latest_run['counts']['pass']}通过、{latest_run['counts']['fail']}失败；以原始回执为准，完整回归尚不能按通过交付。"
    else:
        live_path = BACKEND / ".data/publications-125/backend-05.tap"
        raw = live_path.read_bytes()
        observation = QUALITY / "remaining-work-review-125-v3-backend-05-observed.tap"
        observation.write_bytes(raw)
        observed_failures = re.findall(r"(?m)^not ok \d+ - (.+)\r?$", raw.decode("utf-8"))
        latest_run = {
            "terminal": False, "status": "in_progress",
            "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "partial_log": {"path": relative(observation), "sha256": sha(observation)},
            "observed_failure_titles": observed_failures,
            "final_counts": None, "cleanup_confirmed": False,
            "limit": "A point-in-time log observation is not a final result or independent defect count. Do not restart the live owned execution.",
        }
        backend_note = f"后端05仍在运行；观察到{len(observed_failures)}项失败（Codex RPC/用例超时），总数及清理状态未定。此处保留当时日志快照，不写成通过或最终失败总数。"

    notes = {
        "REQ-010": "Web及Desktop发布页面已有工作分支代码；Web构建/20项现有客户端回归、Desktop类型检查/21项媒体与会话检查通过。实际页面、原生Electron、Extension及全外部动作闭环仍待验。",
        "REQ-034": "发布意图、独立回执与未知核对已有代码和限定历史测试；本轮后端完整回归仍未通过，其他写动作及恢复组合仍开放。",
        "REQ-048": "发布管理API及显式管理员授权CLI已有代码；Admin发布管理页面尚未实现，CLI和完整权限矩阵待验。",
        "REQ-049": "新增实际JPEG/加密发布回执备份恢复用例；旧04因缺少备份工具失败，已按锁定校验安装工具，新05回归结果尚不能作为完整通过。",
        "REQ-074": "已修正发布角色/Skill摘要，04启动校验及相关发布检查通过；不能由此关闭所有角色组合的整体验收。",
        "REQ-075": "新增四个发布工具尚缺实际Codex调用闭环；05另观察到两个既有分析角色实际Codex检查失败，完整执行资格保持开放。",
    }
    for row in rows:
        row["current_review_note"] = notes.get(row["id"], "")

    progress = [
        ("125-01", "发布后端", "角色摘要已修复；04为109项99通过10失败，失败均来自缺少原生备份工具。05继续回归，Codex RPC/超时问题需处理。", "REQ-010、034、044、074、075"),
        ("125-02", "媒体配额与读取", "衍生JPEG计量、并发预览上限、范围读取和权限撤回已有限定后端通过证据；当前完整集成与跨端仍待验。", "REQ-002、014、049、050、057、089、102"),
        ("125-03", "未知结果与备份恢复", "已补实际JPEG及加密发布回执恢复用例并按锁定校验安装原生备份工具；新完整回归和组合验收待完成。", "REQ-009、034、049、053"),
        ("125-04", "Codex工具和角色", "新增四个工具和版本化Skill已写入代码；实际Codex调用、本机接入和超时处理仍待验。", "REQ-043、044、074、075"),
        ("125-05", "Web发布页面", "账户、策略、内容编辑、实际媒体、确认及核对页面已有代码；构建和20项现有客户端回归通过。实际页面、响应式、键盘和录制尚未完成。", "REQ-010、035、055、081、082"),
        ("125-06", "Desktop发布页面", "已接入页面及专用主进程媒体流；类型检查和21项媒体/会话检查通过。实际Electron协议、完整原生操作和无滚动条视觉验收待完成。", "REQ-010、039、040、041、055、082"),
        ("125-07", "Extension发布流程", "尚未接入本轮发布流程；需原生右侧Side Panel中的查看/跳转确认及文件到云端链路验收。", "REQ-010、036、037、038、041"),
        ("125-08", "Admin发布管理", "API及显式管理员授权CLI已有代码；管理页面、CLI实际资格、MFA/范围/正文权限完整矩阵待完成。", "REQ-048、090、092、094"),
        ("125-09", "验证、文档与推送", "新增实际截图/GIF/录制、独立检出、双语README、本轮整合和产品源码提交推送尚未完成；远端组件仍为阶段124。", "REQ-054、055、060、081、082"),
    ]
    repositories = {}
    for label, folder in (
        ("backend", "copypaste-platform-publication-125"),
        ("web", "copypaste-web-publication-125"),
        ("desktop", "copypaste-desktop-publication-125"),
    ):
        repo = ROOT / "dev" / folder
        repositories[label] = {"path": relative(repo), "head": git(repo, "rev-parse", "HEAD"), "status": git(repo, "status", "--short", "--branch")}
    remote = {}
    for line in git(ROOT, "ls-remote", "origin", *[f"refs/heads/{name}" for name in ("main", "docs", "backend", "web", "admin", "desktop", "extension", "delivery")]).splitlines():
        commit, ref = line.split()
        remote[ref.removeprefix("refs/heads/")] = commit
    assert len(remote) == 8 and remote["main"] == remote["docs"]
    for label in ("backend", "web", "desktop"):
        assert repositories[label]["head"] == remote[label]
    review = {
        "schema_version": 3, "reviewed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "audit_kind": "source_and_execution_checkpoint_with_all_open_acceptance_records",
        "previous_review": {"path": relative(previous_path), "sha256": sha(previous_path)},
        "summary": copy.deepcopy(previous["summary"]),
        "required_priorities": copy.deepcopy(previous["required_priorities"]),
        "module_groups": copy.deepcopy(previous["module_groups"]), "requirements": rows,
        "publication_in_progress": [dict(zip(("id", "module", "remaining", "overlapping_requirements"), item)) for item in progress],
        "historical_test_reports": history, "current_client_checks": clients,
        "latest_backend_execution": latest_run, "current_repositories": repositories,
        "remote_before_this_documentation_update": remote,
        "user_authorized_synthetic_data": True, "new_full_acceptance_closures": 0,
        "verifier_sha256": sha(Path(__file__)),
        "limits": [
            "89 required open acceptance records do not mean 89 modules have no source.",
            "77 partial and 12 completion-not-proven records are whole-acceptance classifications, not a code completion percentage.",
            "12 expanded suggestions and one optional item remain separate from required scope.",
            "Stage125 work packages overlap original records and do not increase the total.",
            "Client source checks and historical backend passes do not prove actual browser/Electron journeys or professional provider quality.",
            "Backend run05 is reported at its actual observed state; a partial log has no final counts or cleanup claim.",
            "Current uncommitted product source has not replaced the published Stage124 component refs.",
        ],
    }
    outputs[0].write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# 全部未完成项核查 · 阶段125 v3 / All open work review", "",
        "**89条必需需求尚未完成整体验收：77条部分验证，12条未证完成。另有12条未确认扩展建议及1条可选项，共102条。**", "",
        "这不是89个未写代码的模块，也不能换算成代码完成百分比。保留已有实现和有限通过证据；未证完成也不代表完全没有代码。", "",
        "| 范围 | 部分验证 | 未证完成 | 未关闭合计 |", "| --- | ---: | ---: | ---: |",
        "| 必需 | 77 | 12 | 89 |", "| 未确认扩展建议 | 9 | 3 | 12 |", "| 可选 | 0 | 1 | 1 |", "| 总计 | 86 | 16 | 102 |", "",
        "| 模块 | 必需未完成 | 扩展建议 | 可选 |", "| --- | ---: | ---: | ---: |",
    ]
    for group in review["module_groups"]:
        lines.append(f"| {group['module_group']} | {group['required_open']} | {group['unconfirmed_suggestions']} | {group['optional_open']} |")
    lines += ["", "本轮源码进展：Web构建及20项现有客户端回归通过；Desktop两侧类型检查及21项媒体/会话检查通过。它们均逐文件匹配本次报告的源码，尚不能替代实际页面或完整产品验收。", "", "后端04是109项99通过10失败，10项均因工作分支缺少锁定的原生备份工具而在恢复用例钩子失败，已安装校验工具并保留失败。" + backend_note, "", "以下9项与原需求重叠，不增加102条总数。", "", "| 编号 | 模块 | 当前尚需完成 | 对应需求 |", "| --- | --- | --- | --- |"]
    for item in progress:
        lines.append("| " + " | ".join(item) + " |")
    for title, group in (("必需未完成项（89条）", required), ("未确认扩展建议（12条）", suggestions), ("可选项（1条）", optional)):
        lines += ["", f"## {title}", "", "| 编号 | 优先级 | 模块 | 状态 | 尚需完成 |", "| --- | --- | --- | --- | --- |"]
        for row in group:
            detail = row["current_audit_remaining"] + (" " + row["current_review_note"] if row["current_review_note"] else "")
            lines.append("| " + " | ".join(str(value).replace("|", "\\|").replace("\n", " ") for value in (row["id"], row["priority"], row["module"], row["audit_status"], detail)) + " |")
    lines += ["", "## 证据与发布范围", "", "- 新核查不覆盖v1/v2、历史失败、已执行的检查器或原始源码快照。", "- 客户允许使用假数据，故可继续开发；真实供应商、专业质量和正式运营验收仍需分别证明。", "- 新页面尚未完成截图与交互录制；未打开新的浏览器，也没有本轮浏览器页面需要关闭。", "- 本轮产品源码仍在工作分支，正式组件分支保持阶段124；本文档同步不等于产品已发布。", "", "[结构化台账](remaining-work-current-review-125-v3.json) · [保留v2](remaining-work-current-review-125-v2.md)", ""]
    outputs[1].write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"summary": review["summary"], "client_passes": {key: value["counts"]["pass"] for key, value in clients.items()}, "backend_terminal": latest_run["terminal"], "outputs": [relative(path) for path in outputs]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
