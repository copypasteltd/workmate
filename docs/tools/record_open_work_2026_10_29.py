"""Record a status-only inventory without changing acceptance decisions."""

from __future__ import annotations

import copy
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs" / "quality"
PREVIOUS = QUALITY / "remaining-work-2026-10-28-v2.json"
OUTPUT = QUALITY / "remaining-work-2026-10-29"
CLIENT = ROOT / "dev/copypaste-delivery/.data/dedicated-delivered-121/clients-01.json"
BACKEND = ROOT / "dev/copypaste-delivery-cloud-121/.data/dedicated-cloud-121/full-03-runs/files"
INTEGRATION = ROOT / "dev/copypaste-delivery/.data/dedicated-cloud-integration-121/clients-applied.json"


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def reference(path: Path):
    return {
        "path": path.relative_to(ROOT).as_posix(),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def main():
    if OUTPUT.with_suffix(".json").exists() or OUTPUT.with_suffix(".md").exists():
        raise SystemExit("Preserve existing review; use a fresh review version")
    previous = read(PREVIOUS)
    result = copy.deepcopy(previous)
    client = read(CLIENT)
    integration = read(INTEGRATION)
    receipts = [read(p) for p in BACKEND.glob("*--[0-9][0-9].json")]
    passed = {r["test_file"] for r in receipts if r.get("status") == "passed"}
    failed = [r for r in receipts if r.get("status") == "failed"]
    requirements = result["requirements"]
    assert [r["id"] for r in requirements] == [f"REQ-{i:03}" for i in range(1, 103)]
    assert Counter(r["recorded_assessment"] for r in requirements) == {
        "partial_verified": 86,
        "completion_not_proven": 16,
    }
    counts = [c["counts"] for c in client["checks"] if "counts" in c]
    assert client["status"] == "passed" and client["source_unchanged"] is True
    assert sum(c["pass"] for c in counts) == 338
    assert all(c["fail"] == c["cancelled"] == c["skipped"] == c["todo"] == 0 for c in counts)
    assert len(passed) == 35
    assert len(failed) == 1 and failed[0]["test_file"] == "tests/cloud-browser-preview.test.ts"
    assert integration["copied_files"] == 144 and integration["published"] is False

    result["schema_version"] = 3
    result["reviewed_at"] = datetime.now(timezone.utc).isoformat()
    result["local_review_date"] = "2026-10-29"
    result["audit_kind"] = "status_only_no_tests_or_acceptance_decisions_changed"
    result["basis"] = "Preserved 102 original acceptance decisions; refreshed against integrated-client receipt, terminal backend failure, integration receipt and read-only remote references."
    result["previous_review"] = reference(PREVIOUS)
    result["summary"]["integrated_client_and_delivery_passed_tests"] = 338
    result["summary"]["integrated_components_of_six"] = 5
    result["backend_full_regression"] = {
        "attempt": "full-03",
        "status": "failed",
        "planned_test_files": 112,
        "passed_test_files": 35,
        "failed_test_files": 1,
        "not_completed_test_files": 76,
        "failed_file": failed[0]["test_file"],
        "failed_file_counts": failed[0]["counts"],
        "failed_leaf": "native preview preserves actual failed assertions and script exceptions even when the browser exits zero",
        "failed_assertion": "native exit code 1223 instead of expected 0",
        "cleanup_status": "owned database stopped and native port closed; cleanup receipt is not a regression pass",
        "final_success_report_exists": False,
        "receipt": reference(BACKEND / "cloud-browser-preview--01.json"),
    }
    result["integrated_client_qualification"] = {
        "receipt": reference(CLIENT),
        "status": client["status"],
        "source_unchanged_in_that_run": client["source_unchanged"],
        "passed_tests": 338,
        "checks": [
            {"repository": c["repository"], "kind": c["kind"], "counts": c["counts"]}
            for c in client["checks"] if "counts" in c
        ],
        "limits": client["not_validated"],
        "published": False,
    }
    result["source_integration"] = {
        "receipt": reference(INTEGRATION),
        "components": integration["components"],
        "copied_files": 144,
        "backend_integrated": False,
        "published": False,
    }
    updates = [
        "112 个文件的后端完整回归已失败：35 个文件通过，第 36 个浏览器预览文件 10/11 通过、1 项失败，76 个文件尚未完成；须定位退出码 1223、修复并通过完整回归和接口合同验收。",
        "整合后的 Web/Admin/Extension/Desktop/交付工具共 338 项测试及构建通过，含 22 项实际本机 Codex 测试；完整跨端业务、异常、安装和可访问性矩阵仍待验收，不能用单元通过代替。",
        "五个客户端/交付工作区已复制并核对 144 个文件，保留 63 个原交付文件；后端尚未整合，六组件最终差异、共同版本绑定和统一验收仍待完成。",
        "已有 29 张实际截图与 5 组 GIF/MP4；六仓库新版双语 README、方案逻辑、最新媒体引用、原始证据归档和最终组件清单仍待统一更新。",
        "最新产品代码未提交并推送，六个产品远端分支仍为阶段 120；须提交对应分支、正常推送并核对远端，文档推送不能算作阶段 121 产品发布。",
        "G01—G10 与完整非功能验收尚未关闭：签名安装/更新、声明系统兼容、实际部署压测、生产恢复、真实服务质量及客户业务接受；先用假数据的授权继续有效。",
    ]
    for task, status in zip(result["delivery_tasks"], updates, strict=True):
        task["status"] = status
    result["verified_remote_references_before_this_documentation_commit"] = {
        "main": "5e254802937c42bb75bbfff8af1d2223ca1f9aa6",
        "docs": "5e254802937c42bb75bbfff8af1d2223ca1f9aa6",
        "backend": "ce1f8d1c1a3fab8ddc8f74bd500ca8142c7a7f3a",
        "web": "3950c382f5ae9b4ffe733e6684a579b80b3a359f",
        "admin": "9f4d84b3c7aa520da2572869a63767b673f3fe8c",
        "desktop": "7a1c2caa8e9c6b3a7929a64993020bc7c2dc28f6",
        "extension": "1264ff150c2852b0af23e4a68668fbd940095705",
        "delivery": "3c7e2406c59e30e46f023c712ea95af2e2a3ddbb",
    }
    result["limitations"] = [
        "Status review only; this review does not rerun tests, repair product code or close full acceptance.",
        "102 counts open acceptance records, not wholly unimplemented modules or code-completion percentage.",
        "86 partial and 16 not-proven are preserved formal decisions; later bounded checks do not by themselves close them.",
        "D01-D06 and G01-G10 overlap the 102 requirements and are not added to the feature total.",
        "Synthetic data remains authorized; live provider and customer quality checks are separately pending.",
        "REQ-059 is the one optional P2 requirement; actual Linux operation remains unqualified and does not replace local Desktop Codex.",
        "Automatic payment/subscription integration is a future extension, not a newly counted current manual-billing deliverable.",
    ]
    OUTPUT.with_suffix(".json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# 全部未完成项检查表 / Open-work inventory — 2026-10-29",
        "",
        "当前有 **102 项原始需求尚未完成整体验收：101 项必需、1 项 P2 可选**。其中 86 项有部分通过记录，16 项尚无完整完成证据，整项正式验收关闭数为 0。这不是 102 个空白模块，也不能据此换算代码完成率。",
        "",
        "This status-only review preserves every original requirement and acceptance decision. It distinguishes existing implementation, pending completion, live qualification and final delivery. No product tests or acceptance decisions were changed by this review.",
        "",
        "| 统计 | 数量 |",
        "| --- | ---: |",
        "| 未关闭的需求验收项 | 102（必需 101，可选 1） |",
        "| 已有部分通过记录 | 86 |",
        "| 完成尚未证实 | 16 |",
        "| 整项正式验收已关闭 | 0 |",
        "| 原优先级 P0 / P1 / P2 | 78 / 23 / 1 |",
        "| 整合后的客户端与工具测试通过 | 338 |",
        "| 最新后端完整回归 | 35 文件通过，1 文件失败，76 文件未完成 / 共 112 |",
        "| 最新限定 UI 检查 | 24（Desktop 8、Web/Admin 8、Extension 8） |",
        "| 实际截图 / GIF+MP4 组 | 29 / 5 |",
        "| 交付收尾分类 | 6，与需求重合，不另加总 |",
        "",
        "“部分”表示已有实现和限定通过证据，但本行全部条件尚未关闭；“未证实”表示尚无完整完成证据，也不等于没有代码。真实模型/媒体/广告账户及客户业务验收按正式接入阶段单列，继续遵守“暂时先用假数据”。自动支付订阅为后续扩展，不额外计入当前人工费用/VIP版本。",
        "",
        "| 编号 | 优先级 | 模块 | 登记状态 | 尚未完成或尚未证明完成的内容 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in requirements:
        state = "部分" if row["recorded_assessment"] == "partial_verified" else "未证实"
        lines.append(f"| {row['id']} | {row['priority']} | {row['module']} | {state} | {row['remaining']} |")
    lines += [
        "", "以下六项为交付工作分类，与上述需求重合，不将总数增加到 108：", "",
        "| 编号 | 交付工作 | 当前未完成内容 | 关联需求 |",
        "| --- | --- | --- | --- |",
    ]
    for row in result["delivery_tasks"]:
        lines.append(f"| {row['id']} | {row['task']} | {row['status']} | {row['related_requirement_numbers']} |")
    lines += [
        "", "G01—G10 仍未关闭；性能、恢复、可访问性、系统兼容及后台负载条件分别保留在原需求验收中，不能额外加总为新功能。见[完整非功能基线](../requirements/02-nonfunctional-and-service-levels.md)与[原始验收计划](01-test-and-acceptance-plan.md)。", "",
        "本次实读证据：338 项整合测试的最终回执、后端浏览器预览失败的原始 TAP/文件回执、原生数据库关闭回执、144 文件整合回执及八个 GitHub 分支引用。失败清理成功仅证明资源已回收，不代表失败的回归通过。", "",
        "[结构化清单](remaining-work-2026-10-29.json) · [上一版原始快照](remaining-work-2026-10-28-v2.md) · [更新说明](../changes/remaining-work-review-2026-10-29.md)", "",
    ]
    OUTPUT.with_suffix(".md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"status": "recorded", "requirements": 102, "delivery_categories": 6, "client_tests": 338, "backend_status": "failed"}))


if __name__ == "__main__":
    main()
