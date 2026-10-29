"""Read-only status audit; preserve the previous ledger and actual failed runs."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs" / "quality"
STEM = "remaining-work-audit-2026-10-29-v3"
OUT = QUALITY / (STEM + ".json")
MARKDOWN = QUALITY / (STEM + ".md")
CAPTURE = QUALITY / "status-review-evidence-2026-10-29-v3"
PREFIX = ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"]
REPOS = {
    "backend": "copypaste-platform", "web": "copypaste-web",
    "admin": "copypaste-admin", "desktop": "copypaste-desktop",
    "extension": "copypaste-extension", "delivery": "copypaste-delivery",
}
SOURCE_ROOTS = {
    "copypaste-platform": ROOT / "dev/copypaste-platform-admin-content-123",
    "copypaste-admin": ROOT / "dev/copypaste-admin-content-123",
    "copypaste-delivery": ROOT / "dev/copypaste-delivery",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(PREFIX + list(args), cwd=cwd, check=True,
                          capture_output=True, text=True, encoding="utf-8").stdout.strip()


def source_check(receipt: dict) -> int:
    assert receipt["source_unchanged"] is True
    for rel, expected in receipt["source_files"].items():
        parts = Path(rel).parts
        assert ".." not in parts and parts[0] in SOURCE_ROOTS, rel
        actual = SOURCE_ROOTS[parts[0]].joinpath(*parts[1:])
        assert sha(actual) == expected, f"Current source changed: {rel}"
    return len(receipt["source_files"])


def main() -> None:
    assert ROOT == Path(r"D:\dev\copypasted\自有agent"), ROOT
    assert not OUT.exists() and not MARKDOWN.exists() and not CAPTURE.exists()
    previous_path = QUALITY / "remaining-work-audit-2026-10-29-v2.json"
    previous = load(previous_path)
    ledger_path = QUALITY / "remaining-work-stage122.json"
    assert sha(ledger_path) == previous["source_ledger"]["sha256"]
    requirements = previous["requirements"]
    assert [r["id"] for r in requirements] == [f"REQ-{n:03d}" for n in range(1, 103)]
    assert all(r["full_acceptance"] == "open" for r in requirements)
    counts = Counter(r["recorded_assessment"] for r in requirements)
    assert counts == {"partial_verified": 86, "completion_not_proven": 16}, counts

    delivery = ROOT / "dev/copypaste-delivery"
    backend_path = delivery / ".data/admin-content-123/backend-05.json"
    ui_path = delivery / "evidence/admin-content-ui-01.json"
    backend, ui = load(backend_path), load(ui_path)
    assert backend["status"] == "passed"
    assert backend["counts"] == {"tests": 75, "pass": 75, "fail": 0,
                                  "cancelled": 0, "skipped": 0, "todo": 0}
    assert len(backend["test_files"]) == 5
    assert ui["status"] == "failed" and ui["journey_exit_code"] == 1
    assert ui["counts"] == {"journey_checks": 4, "errors": 1}
    for receipt in (backend, ui):
        assert receipt["owned_database_shutdown"] is True
        assert receipt["owned_database_port_closed"] is True
        raw = delivery / receipt["raw_report"]["path"]
        assert sha(raw) == receipt["raw_report"]["sha256"]
        cleanup = delivery / receipt["fixture_cleanup"]["path"]
        assert sha(cleanup) == receipt["fixture_cleanup"]["sha256"]
        cleanup_data = load(cleanup)
        assert cleanup_data["status"] == "passed"
        assert cleanup_data["workers_exited"] and cleanup_data["actual_filesystem_checked"]
        assert all(r["reclaimed"] for r in cleanup_data["results"])
    assert ui["owned_preview_closed"] is True
    journey_path = delivery / ui["journey"]["path"]
    assert sha(journey_path) == ui["journey"]["sha256"]
    journey = load(journey_path)
    assert journey["browser_closed"] and journey["api_closed"] and journey["fixture_closed"]
    assert len(journey["checks"]) == 4 and len(journey["errors"]) == 1
    assert journey["stage"] == "lost response and metadata-only recovery after reload"
    assert journey["model_calls"] == 0
    checked_sources = {"backend": source_check(backend), "admin_ui": source_check(ui)}

    local = {k: {"commit": git(ROOT / "dev" / v, "rev-parse", "HEAD"),
                 "branch": git(ROOT / "dev" / v, "branch", "--show-current")}
             for k, v in REPOS.items()}
    remote_names = ["main", "docs", *REPOS]
    refs = git(ROOT, "ls-remote", "origin", *["refs/heads/" + n for n in remote_names])
    remote = {line.split()[1].removeprefix("refs/heads/"): line.split()[0]
              for line in refs.splitlines()}
    assert set(remote) == set(remote_names), remote
    assert all(local[k]["commit"] == remote[k] for k in REPOS)
    root_head = git(ROOT, "rev-parse", "HEAD")
    assert remote["docs"] == root_head and remote["main"] == root_head

    updates = {
        "REQ-048": "后台相关 75/75 测试已通过；实际 Admin 流程通过前 4 项，在断线后恢复提交回执处失败。需修复并重验；全部资源管理和受控客服协助仍待完整覆盖。",
        "REQ-090": "三类正文修订接口及前四项真实页面流程已有验证；断线恢复回执失败，后续撤权与无费用副作用页面断言未执行，其余资源修订和治理覆盖待补齐。",
        "REQ-094": "新增修订的后台权限、MFA、显式拒绝等相关专项已通过；真实页面撤权流程尚未运行，全部动作、对象状态、额度、导出和异步矩阵待完整验收。",
        "REQ-096": "新增管理员独立来源、原子审计、不可变性和回滚专项已通过；页面整体验收未通过，其他敏感路径和生产留存仍待验收。",
    }
    for r in requirements:
        if r["id"] in updates:
            r["current_audit_remaining"] = updates[r["id"]]
        r["requirement_origin"] = ("expanded_design_suggestion" if 61 <= int(r["id"][-3:]) <= 72
                                    else "existing_requirement")

    wip_status = [
        "迁移 130、独立来源、版本约束及不可变性已有通过证据；仍随未合并增量保留。",
        "六类路由及三种对象接口已有相关通过证据；尚未合并发布，不能据此关闭全部内容管理需求。",
        "真实登录、团队、项目配置、业务方法四项通过；断线恢复成功回执未显示，修复及剩余两项页面检查未完成。",
        "五个后端文件共 75 项全部通过，其中新增专项 16 项；完整产品与实际页面撤权矩阵尚未验收。",
        "已录得 5 张页面截图、2 组 GIF/MP4；双语 README 已有未提交草稿，成功恢复及撤权材料、最终文档仍待补全。",
        "后台与 Admin 增量未提交、未合并、未发布；六个远端组件分支仍为阶段 122。",
    ]
    wip = previous["overlapping_current_work"]
    for row, status in zip(wip, wip_status, strict=True):
        row["status"] = status

    now = datetime.now(timezone.utc)
    result = {
        "schema_version": 3,
        "reviewed_at": now.isoformat(),
        "reviewed_at_taipei": now.astimezone(timezone(timedelta(hours=8))).isoformat(),
        "audit_kind": "current_status_review_no_new_product_acceptance",
        "source_ledger": {"path": str(ledger_path.relative_to(ROOT)).replace("\\", "/"), "sha256": sha(ledger_path)},
        "previous_audit": {"path": str(previous_path.relative_to(ROOT)).replace("\\", "/"), "sha256": sha(previous_path)},
        "summary": previous["summary"], "module_groups": previous["module_groups"],
        "requirements": requirements, "overlapping_current_work": wip,
        "latest_backend": {"status": "passed", "counts": backend["counts"], "test_files": backend["test_files"]},
        "latest_admin_ui": {"status": "failed", "planned_checks": 7, "passed": 4,
                            "failed": 1, "not_reached": 2, "stage": journey["stage"],
                            "errors": journey["errors"], "screenshots": len(journey["screenshots"]),
                            "recordings": len(journey["recordings"]), "owned_resources_closed": True},
        "current_source_files_hash_verified": checked_sources,
        "local_component_heads": local, "root_head_before_report_publication": root_head,
        "remote_refs_before_report_publication": remote,
        "operational_followups_excluded_from_requirement_total": [{
            "id": "OPS-01", "work": "未完成的临时交付工作树清理",
            "path": "dev/copypaste-delivery-admin-content-123",
            "directory_exists": (ROOT / "dev/copypaste-delivery-admin-content-123").exists(),
            "gitfile_exists": (ROOT / "dev/copypaste-delivery-admin-content-123/.git").exists(),
            "note": "先前快速清理命令被自动安全策略拒绝，返回 blocked by policy；本次只检查状态，未重试删除。",
        }],
        "user_authorized_synthetic_data": True,
        "scope_notes": [
            "102 是既有未关闭验收记录，不能解释为 102 个完全未编写模块或代码完成百分比。",
            "其中 101 必需、1 可选沿用原台账；REQ-061–072 另标为文档展开设计建议，未经用户逐项确认。",
            "六项 WIP 重叠于原需求，不再累加；工作区清理也不计入产品需求总数。",
            "本轮仅核对已结束的测试、当前源码哈希、仓库与远端状态；未新开浏览器、未新运行产品测试、未修改产品源码。",
            "真实模型、正式平台账号、专业质量与生产环境验收独立列明；假数据授权继续有效。",
            "失败的 UI 运行和旧失败批次保留，不能用后台测试通过代替页面或完整产品验收。",
        ],
        "captured_evidence": [], "verifier_sha256": sha(Path(__file__)),
    }
    paths = [backend_path, delivery / backend["raw_report"]["path"],
             delivery / backend["fixture_cleanup"]["path"],
             ui_path, delivery / ui["raw_report"]["path"], journey_path,
             delivery / ui["fixture_cleanup"]["path"]]
    CAPTURE.mkdir()
    for original in paths:
        target = CAPTURE / original.name
        with target.open("xb") as stream:
            stream.write(original.read_bytes())
        assert sha(target) == sha(original)
        result["captured_evidence"].append({
            "original": original.relative_to(ROOT).as_posix(),
            "path": target.relative_to(ROOT).as_posix(), "sha256": sha(target),
        })
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = ["# 当前全部未完成项核查 / Current outstanding-work audit", "",
             f"核查时间：{result['reviewed_at_taipei']}。本报告更新当前状态，历史报告和失败记录保留。", "",
             "**既有 102 条验收记录仍未关闭：86 条部分实现已验证，16 条整体完成尚无充分证据，完整关闭 0 条。** 这不等于 102 个模块没有代码，也不能换算为开发完成百分比。", "",
             "原台账计为 101 必需、1 可选（REQ-059）。REQ-061–072 是文档展开的设计建议，未经用户逐项确认；保留原编号但不扩大原始需求。", "",
             "| 范围 | 原编号 | 未关闭 | 部分验证 | 未证完成 |",
             "| --- | --- | ---: | ---: | ---: |"]
    for g in result["module_groups"]:
        lines.append(f"| {g['module_group']} | {g['range']} | {g['open']} | {g['partial_verified']} | {g['completion_not_proven']} |")
    lines += ["", "最新后台相关五个文件 **75/75 通过**（新增专项 16 项）。实际 Admin 页面计划 7 项：**4 通过、1 失败、2 尚未执行**；失败发生在断线后查询原提交结果时，成功回执未显示。所属浏览器、API、预览和测试数据库已关闭，测试数据回收记录通过。代码尚未合并发布。", "",
              "“部分验证”表示已有实现和限定证据；“未证完成”表示整体完成尚无充分证据。以下逐条列出实际剩余范围。", "",
              "| 编号 | 优先级 | 模块 | 当前状态 | 尚需完成 |", "| --- | --- | --- | --- | --- |"]
    for r in requirements:
        name = r["module"] + ("（设计建议）" if r["requirement_origin"] == "expanded_design_suggestion" else "")
        lines.append(f"| {r['id']} | {r['priority']} | {name} | {r['audit_status']} | {r['current_audit_remaining']} |")
    lines += ["", "下面六项是当前 Admin 增量的细分工作，已包含在 102 条内，不重复累加。", "",
              "| 子任务 | 对应需求 | 工作 | 最新状态 |", "| --- | --- | --- | --- |"]
    for r in wip:
        lines.append(f"| {r['id']} | {' / '.join(r['requirements'])} | {r['work']} | {r['status']} |")
    lines += ["", "另有工作区整理项 OPS-01：临时 `dev/copypaste-delivery-admin-content-123` 仍有残留，未计入产品需求。此前快速清理命令被自动安全策略拒绝（`blocked by policy`）；本轮未重试删除。", "",
              f"本次核对当前后台 {checked_sources['backend']} 个、页面运行涉及 {checked_sources['admin_ui']} 个文件的哈希，以及六个主仓库与 GitHub 八个分支。新增阶段 123 源码尚未发布；本轮不新运行产品测试或浏览器。", "",
              "假模型与假媒体数据授权继续有效。真实服务、正式广告账户、客户专业质量及生产验收分别保留，不作为可用假数据开发工作的前置阻塞。", "",
              "依据：[完整核查数据](" + OUT.name + ")、[原始台账](remaining-work-stage122.json)、[需求规格](../requirements/01-srs.md)。本次采集的原始后台和页面报告位于 [证据目录](status-review-evidence-2026-10-29-v3/backend-05.json)，具体文件和 SHA 见完整核查数据。", "",
              "The 102 existing acceptance records remain open: 86 have bounded implementation evidence and 16 lack proof of overall completion. None is fully accepted. The latest five related backend files passed all 75 checks. Actual Admin UI qualification passed four of seven planned checks, failed the lost-response recovery receipt, and did not reach the final two checks. Owned browser, API, preview and database resources were closed and fixture cleanup verified. New product code remains unpublished. Synthetic data is authorized; live providers, professional quality and full product acceptance retain their separate scope. The optional cloud computer and expanded design suggestions are identified, and overlapping work is not counted twice.", ""]
    MARKDOWN.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"status": "recorded", "open": 102, "partial_verified": 86,
                      "completion_not_proven": 16, "backend": backend["counts"],
                      "ui": result["latest_admin_ui"], "captured_files": len(paths),
                      "source_files_checked": checked_sources}, ensure_ascii=False))


if __name__ == "__main__":
    main()
