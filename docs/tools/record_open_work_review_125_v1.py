"""Record a read-only review; retain original requirement IDs and test outcomes."""
from __future__ import annotations

import collections
import copy
import datetime as dt
import hashlib
import json
import pathlib
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
    outputs = [QUALITY / f"remaining-work-current-review-125.{suffix}" for suffix in ("json", "md")]
    if any(p.exists() for p in outputs):
        raise SystemExit("Review already exists; use a new version without overwriting it.")
    baseline = QUALITY / "remaining-work-stage124.json"
    old = read(baseline)
    rows = copy.deepcopy(old["requirements"])
    assert [r["id"] for r in rows] == [f"REQ-{n:03}" for n in range(1, 103)]
    required = [r for r in rows if r["requirement_origin"] == "existing_requirement" and not r["optional"]]
    suggestions = [r for r in rows if r["requirement_origin"] == "expanded_design_suggestion"]
    optional = [r for r in rows if r["optional"]]
    assert len(required) == 89 and len(suggestions) == 12 and len(optional) == 1
    statuses = collections.Counter(r["recorded_assessment"] for r in required)
    priorities = collections.Counter(r["priority"] for r in required)
    assert statuses == {"partial_verified": 77, "completion_not_proven": 12}
    assert priorities == {"P0": 70, "P1": 19}
    assert all(r["full_acceptance"] == "open" for r in rows)
    reports = []
    for name in ("backend-01", "protocol-04"):
        path = BACKEND / f".data/publications-125/{name}.json"
        data = read(path)
        reports.append({
            "path": path.relative_to(ROOT).as_posix(), "sha256": sha(path),
            **{k: data[k] for k in ("status", "counts", "scope")},
            "source_scope": "Historical exact source only; current uncommitted changes are not qualified.",
        })
    assert reports[0]["counts"]["pass"] == 0 and reports[0]["counts"]["fail"] == 14
    assert reports[1]["counts"]["pass"] == 18 and reports[1]["counts"]["fail"] == 0
    in_progress = [
        ("125-01", "外部发布后端与数据库", "已有工作分支草稿；首轮集成14项全失败，权限修复尚未复验。", "REQ-010, REQ-034"),
        ("125-02", "发布媒体配额", "衍生JPEG存储计量、并发容量和预览数量约束待补齐并验证。", "REQ-014, REQ-049, REQ-089, REQ-102"),
        ("125-03", "媒体读取与来源权限", "公开媒体读取的任务来源/执行人上下文顺序，以及范围读取、撤权矩阵待核查验证。", "REQ-002, REQ-050, REQ-057"),
        ("125-04", "结果不明、删除及恢复", "核对、关闭、禁止重复发布、迟到回执、删除、保留期和快照恢复已有草稿；集成验收未完成。", "REQ-009, REQ-034, REQ-049, REQ-053"),
        ("125-05", "Codex发布工具", "云端/本机工具注册、角色与Skill版本权限接入尚未完成。", "REQ-043, REQ-044, REQ-074, REQ-075"),
        ("125-06", "三端发布界面", "Web、Desktop及Extension发布预览、客户确认和结果核对页面尚未接入。", "REQ-010, REQ-035, REQ-039, REQ-041"),
        ("125-07", "Admin发布管理", "已有API和权限目录草稿；后台页面及MFA/范围/拒绝/正文独立权限验收未完成。", "REQ-048, REQ-090, REQ-092, REQ-094"),
        ("125-08", "验收和交付材料", "当前源码集成回归、实际页面截图/GIF/录制、双语README及方案说明尚未完成。", "REQ-055, REQ-060, REQ-081, REQ-082"),
        ("125-09", "代码整合与推送", "本轮发布功能源码仍未提交、整合和推送；已发布产品保持阶段124范围。", "REQ-054, REQ-060"),
    ]
    additions = {
        "REQ-010": "阶段125发布后端已有草稿，确认/撤权/恢复尚未通过集成验收，三端页面未接入。",
        "REQ-034": "阶段125意图、回执与人工核对已有草稿；集成首轮失败，修复和其余异常分支未复验。",
        "REQ-048": "阶段125发布管理API草稿尚未通过集成验收，后台页面未接入。",
        "REQ-049": "阶段125发布衍生媒体的配额、删除及备份恢复仍待补齐和验收。",
    }
    for row in rows:
        row["current_review_note"] = additions.get(row["id"], "")
    remote = {}
    for line in git(ROOT, "ls-remote", "origin", *[f"refs/heads/{b}" for b in ("main", "docs", "backend", "web", "admin", "desktop", "extension", "delivery")]).splitlines():
        commit, ref = line.split()
        remote[ref.removeprefix("refs/heads/")] = commit
    assert len(remote) == 8 and remote["main"] == remote["docs"]
    review = {
        "schema_version": 1, "reviewed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "audit_kind": "read_only_current_source_and_open_acceptance_review",
        "baseline": {"path": baseline.relative_to(ROOT).as_posix(), "sha256": sha(baseline)},
        "summary": copy.deepcopy(old["summary"]), "required_priorities": dict(priorities),
        "module_groups": copy.deepcopy(old["module_groups"]), "requirements": rows,
        "publication_in_progress": [dict(zip(("id", "module", "remaining", "overlapping_requirements"), item)) for item in in_progress],
        "historical_test_reports": reports,
        "current_backend": {"head": git(BACKEND, "rev-parse", "HEAD"), "status": git(BACKEND, "status", "--short", "--branch")},
        "current_web_worktree": {"head": git(ROOT / "dev/copypaste-web-publication-125", "rev-parse", "HEAD"), "status": git(ROOT / "dev/copypaste-web-publication-125", "status", "--short", "--branch")},
        "remote_before_this_documentation_update": remote,
        "user_authorized_synthetic_data": True, "new_product_tests_executed_by_review": False,
        "new_full_acceptance_closures": 0, "verifier_sha256": sha(pathlib.Path(__file__)),
        "limits": ["Counts are whole acceptance records, not uncoded modules or a code completion percentage.", "Expanded suggestions and the optional computer are not added to required work.", "Stage125 subitems overlap existing requirements and do not increase the total of 102.", "Synthetic development remains authorized; actual provider and customer quality qualification is separate.", "The review does not publish or qualify uncommitted product source."],
    }
    outputs[0].write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# 当前全部未完成项核查 · 阶段125 / All open work review", "",
        "当前必需需求 **89条** 尚未完成整体验收：**77条部分验证，12条未证完成；70条P0、19条P1**。另有12条未逐项确认的扩展建议和1条可选功能，台账合计102条未关闭。", "",
        "这是需求级待办数量，不能换算成未写模块数或代码完成百分比。本次只读核查不新增产品验收结论。用户允许假模型、假媒体和假账号继续开发，真实服务与专业业务质量分别验收。", "",
        "部分验证＝已有实现与限定检查；未证完成＝整条需求仍缺少充分完成证据。", "",
        "| 范围 | 部分验证 | 未证完成 | 未关闭合计 |", "| --- | ---: | ---: | ---: |",
        "| 必需 | 77 | 12 | 89 |", "| 未确认扩展建议 | 9 | 3 | 12 |", "| 可选 | 0 | 1 | 1 |", "| 全台账 | 86 | 16 | 102 |", "",
        "阶段125发布功能已有后端工作分支草稿，但首轮原生集成测试0/14通过，同一权限错误阻断了全部14项；权限修复尚未复验。较早18/18通过的记录仅覆盖当时版本的纯状态规划和HTTP传输，不能替代当前集成验收。前端工作分支尚无产品修改；本轮源码尚未提交或发布。", "",
        "以下本轮子项与原需求重叠，不额外增加待办总数。", "",
        "| 编号 | 本轮模块 | 待完成 | 对应需求 |", "| --- | --- | --- | --- |",
    ]
    for item in in_progress:
        lines.append("| " + " | ".join(item) + " |")
    for title, group in (("全部必需待完成项（89条）", required), ("未确认的扩展建议（12条）", suggestions), ("可选功能（1条）", optional)):
        lines += ["", f"## {title}", "", "| 编号 | 优先级 | 模块 | 当前状态 | 尚需完成 |", "| --- | --- | --- | --- | --- |"]
        for row in group:
            remainder = row["current_audit_remaining"]
            if row["current_review_note"]:
                remainder += " " + row["current_review_note"]
            lines.append("| " + " | ".join((row["id"], row["priority"], row["module"], row["audit_status"], remainder)) + " |")
    lines += ["", "本次只读核对GitHub全部八个分支，产品仍为阶段124已发布提交。此文档同步不代表阶段125产品已发布。原始失败和源码快照保持原样。未调用浏览器、Docker、WSL或虚拟机。", "", "[结构化清单](remaining-work-current-review-125.json) · [上一已发布台账](remaining-work-stage124.md) · [更新说明](../changes/remaining-work-review-stage125.md)", "", "89 required acceptance records remain open: 77 partial and 12 completion-not-proven (70 P0 and 19 P1). Twelve unconfirmed expanded suggestions and one optional item are separate, for 102 open records. Stage125 publication source is uncommitted and unqualified: its first native integration run failed all 14 checks; an earlier 18-check protocol run has narrower historical scope. This read-only review runs no product tests and closes no full acceptance records. Synthetic development remains authorized. Existing failures and source snapshots are preserved.", ""]
    outputs[1].write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"summary": review["summary"], "required_priorities": dict(priorities), "outputs": [p.relative_to(ROOT).as_posix() for p in outputs]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
