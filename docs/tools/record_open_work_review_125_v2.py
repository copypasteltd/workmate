"""Preserve the earlier audit and record all open work against terminal run 03."""
from __future__ import annotations

import collections
import copy
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
BACKEND = ROOT / "dev/copypaste-platform-publication-125"


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path: pathlib.Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def git(path: pathlib.Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args],
        cwd=path, text=True, encoding="utf-8", errors="strict",
    ).strip()


def main():
    outputs = [QUALITY / f"remaining-work-current-review-125-v2.{s}" for s in ("json", "md")]
    if any(p.exists() for p in outputs):
        raise SystemExit("Do not replace an executed review; create another version.")
    previous_path = QUALITY / "remaining-work-current-review-125.json"
    previous = read(previous_path)
    rows = copy.deepcopy(previous["requirements"])
    assert [r["id"] for r in rows] == [f"REQ-{n:03}" for n in range(1, 103)]
    required = [r for r in rows if r["requirement_origin"] == "existing_requirement" and not r["optional"]]
    suggestions = [r for r in rows if r["requirement_origin"] == "expanded_design_suggestion"]
    optional = [r for r in rows if r["optional"]]
    assert (len(required), len(suggestions), len(optional)) == (89, 12, 1)
    assert collections.Counter(r["recorded_assessment"] for r in required) == {"partial_verified": 77, "completion_not_proven": 12}
    assert all(r["full_acceptance"] == "open" for r in rows)

    reports = []
    for name in ("backend-01", "backend-02", "backend-03", "protocol-04"):
        path = BACKEND / f".data/publications-125/{name}.json"
        data = read(path)
        reports.append({
            "path": path.relative_to(ROOT).as_posix(), "sha256": sha(path),
            **{k: data.get(k) for k in ("at", "status", "counts", "scope", "source_unchanged", "owned_database_shutdown", "owned_database_port_closed")},
            "source_scope": "Only the exact source captured by this individual run; earlier passing scopes remain historical.",
        })
    latest = read(BACKEND / ".data/publications-125/backend-03.json")
    assert latest["counts"] == {"tests": 107, "pass": 21, "fail": 86, "cancelled": 0, "skipped": 0, "todo": 0}
    assert all(latest[k] is True for k in ("source_unchanged", "owned_database_shutdown", "owned_database_port_closed"))
    tap_path = BACKEND / ".data/publications-125/backend-03.tap"
    tap = tap_path.read_text(encoding="utf-8-sig")
    errors = collections.Counter(re.findall(r"(?m)^\s+error: (.*)$", tap))
    assert errors == {"'Publishing release does not match its retained role, Skill and permissions'": 86}
    current_matches = 0
    for key, digest in latest["source_files"].items():
        parts = pathlib.PurePosixPath(key).parts
        assert parts[0] == "copypaste-platform" and ".." not in parts
        assert sha(BACKEND.joinpath(*parts[1:])) == digest, key
        current_matches += 1

    progress = [
        ("125-01", "发布后端与新版角色校验", "最新107项回归21通过、86失败；86项均被同一个ROLE_RELEASE_INVALID启动校验阻断。需修复并按新运行完整复验。", "REQ-010、034、044、074、075"),
        ("125-02", "发布媒体配额", "衍生JPEG计量、延迟落盘、退休对象持续计费及20预览上限已有源码；并发上限等新增检查被03启动错误阻断，待复验。", "REQ-014、049、089、102"),
        ("125-03", "媒体读取与来源权限", "已修正任务上下文并新增受保护媒体信息接口；范围读取在历史02有通过证据，新接口与当前源码整体待复验。", "REQ-002、050、057"),
        ("125-04", "未知结果、删除与恢复", "已有禁止盲重发、独立回执、核对/关闭、删除与恢复保护；历史02有限通过，含实际发布对象的备份恢复等完整组合待验。", "REQ-009、034、049、053"),
        ("125-05", "Codex发布工具与Skill", "已写四个发布工具及social-content 1.1.0/controlled-publishing 1.0.0；版本启动校验当前失败，实际Codex调用及本机接入待验。", "REQ-043、044、074、075"),
        ("125-06", "Web、Desktop和Extension发布界面", "三端尚未接入账户、内容编辑、实际媒体预览、客户明确确认及结果核对；Desktop大媒体受保护流式读取也待实现。", "REQ-010、035、039、041"),
        ("125-07", "Admin发布管理", "API与权限目录已有源码，历史02验证部分MFA/范围/正文隔离；管理页面、现有管理员权限升级及完整矩阵待补齐。", "REQ-048、090、092、094"),
        ("125-08", "验证与交付材料", "当前回归需修复；实际页面、四档布局、截图/GIF/录制、双语README及方案说明尚未完成。", "REQ-055、060、081、082"),
        ("125-09", "整合、提交与推送", "发布功能仍仅在未提交工作分支；Web/Desktop工作分支无产品修改，已发布组件维持阶段124。", "REQ-054、060"),
    ]
    notes = {
        "REQ-010": "阶段125发布后端已有源码，最新回归被角色校验阻断；三端客户确认页面未接入。",
        "REQ-034": "发布意图/回执/未知核对已有限定历史证据，当前版本启动回归失败，其他写动作和完整异常组合仍开放。",
        "REQ-048": "发布管理API已有源码和限定历史证据，Admin发布页面尚未接入。",
        "REQ-049": "发布衍生媒体配额已有源码；当前整体验证、全部删除来源及实际包含发布对象的备份恢复仍待完成。",
        "REQ-074": "新增发布角色和Skill尚未通过当前版本校验，四个工具不能据此认定可用。",
        "REQ-075": "新增发布工具尚未取得实际Codex调用证据，当前角色版本校验为阻塞项。",
    }
    for row in rows:
        row["current_review_note"] = notes.get(row["id"], "")
    repositories = {}
    for label, folder in (
        ("backend", "copypaste-platform-publication-125"),
        ("web_worktree", "copypaste-web-publication-125"),
        ("desktop_worktree", "copypaste-desktop-publication-125"),
    ):
        repo = ROOT / "dev" / folder
        repositories[label] = {"path": repo.relative_to(ROOT).as_posix(), "head": git(repo, "rev-parse", "HEAD"), "status": git(repo, "status", "--short", "--branch")}
    assert repositories["web_worktree"]["status"] == "## codex/publications-125"
    assert repositories["desktop_worktree"]["status"] == "## codex/publications-125"
    remote = {}
    for line in git(ROOT, "ls-remote", "origin", *[f"refs/heads/{b}" for b in ("main", "docs", "backend", "web", "admin", "desktop", "extension", "delivery")]).splitlines():
        commit, ref = line.split()
        remote[ref.removeprefix("refs/heads/")] = commit
    assert len(remote) == 8 and remote["main"] == remote["docs"]
    assert repositories["backend"]["head"] == remote["backend"]
    assert repositories["web_worktree"]["head"] == remote["web"]
    assert repositories["desktop_worktree"]["head"] == remote["desktop"]
    review = {
        "schema_version": 2,
        "reviewed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "audit_kind": "terminal_report_and_current_source_review_no_product_mutation",
        "previous_review": {"path": previous_path.relative_to(ROOT).as_posix(), "sha256": sha(previous_path)},
        "summary": copy.deepcopy(previous["summary"]),
        "required_priorities": copy.deepcopy(previous["required_priorities"]),
        "module_groups": copy.deepcopy(previous["module_groups"]),
        "requirements": rows,
        "publication_in_progress": [dict(zip(("id", "module", "remaining", "overlapping_requirements"), item)) for item in progress],
        "historical_test_reports": reports,
        "latest_failure": {"report": reports[2]["path"], "tap_path": tap_path.relative_to(ROOT).as_posix(), "tap_sha256": sha(tap_path), "error_groups": dict(errors), "current_source_files_matching_report": current_matches, "independent_bug_count": "not_derived_from_test_failure_count"},
        "current_repositories": repositories,
        "remote_before_this_documentation_update": remote,
        "user_authorized_synthetic_data": True,
        "new_product_tests_executed_by_review": False,
        "new_full_acceptance_closures": 0,
        "verifier_sha256": sha(pathlib.Path(__file__)),
        "limits": [
            "89 required open acceptance records are not 89 uncoded modules or a code-completion percentage.",
            "Twelve unconfirmed design suggestions and one optional cloud-computer item remain separately identified.",
            "The nine Stage125 subitems overlap original requirements and are not added to the total.",
            "Run02 passing scopes are historical; run03 is terminal failed and cannot qualify the current publishing product.",
            "The 86 failures share one startup hook error and are not counted as 86 independent defects.",
            "Synthetic service development is authorized; actual providers and professional quality have separate acceptance.",
            "This audit edits documents only; it does not publish the uncommitted product source.",
        ],
    }
    outputs[0].write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# 全部未完成项核查 · 阶段125 v2 / All open work review", "",
        "**必需需求仍有89条未完成整体验收：77条部分验证、12条未证完成，其中70条P0、19条P1。** 另列12条未逐项确认的扩展建议及1条可选功能，全台账共102条。", "",
        "数量按完整需求闭环统计，已有实现和限定通过证据继续保留，不能换算为代码完成百分比。部分验证=已有实现/限定检查，仍有缺口；未证完成=整条需求缺少充分完成证据，不表示完全没有代码。", "",
        "| 范围 | 部分验证 | 未证完成 | 未关闭合计 |", "| --- | ---: | ---: | ---: |",
        "| 必需 | 77 | 12 | 89 |", "| 未确认扩展建议 | 9 | 3 | 12 |", "| 可选 | 0 | 1 | 1 |", "| 全台账 | 86 | 16 | 102 |", "",
        "| 模块分组 | 必需未完成 | 扩展建议 | 可选 |", "| --- | ---: | ---: | ---: |",
    ]
    for group in review["module_groups"]:
        lines.append(f"| {group['module_group']} | {group['required_open']} | {group['unconfirmed_suggestions']} | {group['optional_open']} |")
    lines += ["", "最新原生后端回归03已经结束：107项、21通过、86失败；86项均被同一ROLE_RELEASE_INVALID角色/Skill权限版本校验阻断，不能按86个独立缺陷解释。该运行的源码未被中途修改，原生数据库已关闭且端口关闭；当前逐文件核对与报告一致。原始失败、源码快照和执行器均保留。", "", "历史02是22项21通过1失败；历史01是14项全部失败；历史协议04的18项通过仅属于其原版本的规划/HTTP范围。它们不能替代当前版本的集成验收。", "", "以下9项为阶段125具体待办，与原需求重叠，不增加102条总数。", "", "| 编号 | 模块 | 当前待完成 | 对应需求 |", "| --- | --- | --- | --- |"]
    for item in progress:
        lines.append("| " + " | ".join(item) + " |")
    for title, group in (("必需未完成项（89条）", required), ("未确认扩展建议（12条）", suggestions), ("可选项（1条）", optional)):
        lines += ["", f"## {title}", "", "| 编号 | 优先级 | 模块 | 状态 | 尚需完成 |", "| --- | --- | --- | --- | --- |"]
        for row in group:
            remainder = row["current_audit_remaining"] + (" " + row["current_review_note"] if row["current_review_note"] else "")
            lines.append("| " + " | ".join((row["id"], row["priority"], row["module"], row["audit_status"], remainder)) + " |")
    lines += ["", "本次核对GitHub全部八个引用，组件仍保持阶段124；本次文档同步不代表阶段125产品已发布。用户允许假模型/媒体/账号继续开发，真实服务、部署和专业业务质量独立验收。未调用浏览器、Docker、WSL或虚拟机；不新增或删除完整需求，不关闭任何原始需求。", "", "[结构化完整台账](remaining-work-current-review-125-v2.json) · [原核查保留](remaining-work-current-review-125.md) · [本次更新说明](../changes/remaining-work-review-stage125-v2.md)", "", "89 required full acceptance records remain open: 77 partial, 12 completion-not-proven, with 70 P0 and 19 P1. Twelve unconfirmed suggestions and one optional item bring the complete ledger to 102. The nine Stage125 subitems overlap these requirements. Terminal run03 reports 21 passes and 86 failures out of 107; all 86 failures share one role-release startup hook error. Current captured source matches that run. Earlier passing scopes remain historical. This documentation-only audit changes no product source, runs no new product tests and closes no full requirement. Synthetic development remains authorized; production providers and professional quality have separate acceptance.", ""]
    outputs[1].write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"summary": review["summary"], "latest_test_counts": latest["counts"], "source_files_match": current_matches, "outputs": [p.relative_to(ROOT).as_posix() for p in outputs]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
