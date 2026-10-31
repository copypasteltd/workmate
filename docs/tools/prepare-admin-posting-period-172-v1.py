"""Prepare the posting-period handoff from immutable native and actual UI evidence."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def create(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + "\n")


qpath = DELIVERY / sys.argv[1]
upath = DELIVERY / sys.argv[2]
qualification, ui = [json.loads(path.read_bytes()) for path in [qpath, upath]]
assert qualification["status"] == "passed" and qualification["source_unchanged"] and qualification["owned_services_closed"]
assert qualification["database_tests"] == 15 and qualification["fresh_database_tests"] == 9 and qualification["inherited_legacy_tests"] == 6
assert ui["status"] == "passed" and len(ui["checks"]) == 7 and ui["browser_closed"]
assert qualification["ui"]["sha256"] == digest(upath)
for name, expected in qualification["source_after"].items():
    assert digest(DEV / name) == expected, name
assert (ROOT / "docs/contracts/admin-posting-period-172.json").read_bytes() == (DEV / "copypaste-platform/contracts/admin-posting-period-172.json").read_bytes()

copies = []
for entry in [*ui["screenshots"], *[file for recording in ui["recordings"] for file in recording["files"]]]:
    source = DEV / entry["path"]
    assert digest(source) == entry["sha256"]
    targets = [ROOT / "docs/assets/admin-posting-period-172" / source.name]
    targets += [DEV / ("copypaste-" + component) / "assets/screenshots" / source.name for component in ["platform", "admin", "delivery"]]
    for target in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            assert digest(target) == entry["sha256"]
        else:
            with target.open("xb") as stream:
                stream.write(source.read_bytes())
        copies.append({"path": target.relative_to(ROOT).as_posix(), "sha256": digest(target)})

image = next(Path(entry["path"]).name for entry in ui["screenshots"] if "01-period-summary" in entry["path"])
gif = next(Path(file["path"]).name for recording in ui["recordings"] for file in recording["files"] if file["path"].endswith(".gif"))
mp4 = next(Path(file["path"]).name for recording in ui["recordings"] for file in recording["files"] if file["path"].endswith(".mp4"))
for component, label in [("platform", "backend"), ("admin", "admin"), ("delivery", "delivery")]:
    for name in ["README.md", "README.en.md"]:
        path = DEV / ("copypaste-" + component) / name
        original = path.read_text(encoding="utf-8")
        assert "stage172" not in original and "阶段172" not in original
        _, tail = original.split("\n", 1)
        if name == "README.md":
            intro = "## 当前源码增量 · 阶段172\n\nAdmin新增工作建立／费用入账两种期间。旧任务本期扣费、跨期香港日期、区间外原扣费的退款及负净消耗可查询；分组、明细和CSV共用一份固定快照。预留额度与累积操作用量另行说明。当前源码需配套Backend/Admin，数据库仍为156。此增量不在已冻结v0.1.1 ZIP内；原包与标签保持。\n\n"
            checks = "本轮新增8项原生SQL/API＋1项精确投影检查；6项原报表检查在源码一致时继承其实际通过结果；7组实际Admin操作通过。首次历史测试资料缺少资金来源而被约束拒绝，已以新版本补齐来源与资金变动；失败原记录保留，未关闭保护。全部原完整验收范围继续跟踪。\n\n"
        else:
            intro = "## Current source increment · stage172\n\nAdmin supports creation and posting periods. Reports include old-work charges, Hong Kong posting days, refunds with an out-of-period original charge and negative net. Summary, projected detail and CSV share one immutable snapshot. Holds and lifetime operation units stay separate. Use matching backend/Admin sources with schema156. This increment is outside the frozen v0.1.1 ZIP; archives/tags remain unchanged.\n\n"
            checks = "Eight fresh native SQL/API cases and one exact projection case passed; six actual successful legacy cases are inherited only from identical sources. Seven actual Admin journeys passed. The first historical fixture was rejected for missing funding-source entries; a new version records balanced sources and funding movements without disabling guards. Original failures and all whole-acceptance scopes remain.\n\n"
        diagram = "```mermaid\nflowchart LR\n A[Admin MFA] --> B[Creation or posting period]\n B --> C[Scoped fixed snapshot]\n C --> D[Hong Kong day entries]\n D --> E[Same summary and detail]\n D --> F[Authorized CSV]\n```\n\n"
        media = f"![Posting-period report](assets/screenshots/{image})\n\n![Actual interaction](assets/screenshots/{gif})\n\n[MP4](assets/screenshots/{mp4}) · [方案 / Behavior](https://github.com/copypasteltd/workmate/blob/docs/docs/development/172-admin-posting-period.md)\n\n"
        path.write_text(f"# Workmate · {label}\n\n" + intro + checks + diagram + media + tail, encoding="utf-8", newline="\n")

prior_path = ROOT / "docs/quality/remaining-work-stage169.json"
ledger = json.loads(prior_path.read_bytes())
identities = [(row["id"], row["priority"], row["full_acceptance"], row["optional"], row.get("requirement_origin")) for row in ledger["requirements"]]
assert len(identities) == 102
ledger.update(current_stage=172, reviewed_at=datetime.now(timezone.utc).isoformat(), previous_review={"path": prior_path.relative_to(ROOT).as_posix(), "sha256": digest(prior_path)})
for row in ledger["requirements"]:
    if row["id"] == "REQ-086":
        row["implemented_scope"] += "；172补齐可选实际入账期间、旧工作本期扣费、来源跨区间退款／负净额、香港日账目投影及同选择明细／CSV"
        row["current_audit_remaining"] = "供应商实际账单接入与真实成本对照，全媒体／团队／角色／来源／大规模及完整授权运营矩阵继续开放。入账期间功能已有定向原生SQL/API及实际Admin证据；能力分组仍不重复摊工作费用，操作用量明确为所选工作累积背景。"
        row["current_review_note"] += " 172：新增入账期间功能、日期账目投影和负净额，保留原建立期间与重放识别；8项新原生SQL/API、1项精确投影、6项本轮源码一致的旧报表通过结果及7组实际页面操作；首次资料失败保留。完整原验收不缩减。"
ledger["current_increment"] = {"stage": 172, "scope": "Actual posting-period consumption with daily entry projection and original-charge refund provenance", "new_full_acceptance_closures": 0, "broad_regression": "omitted_by_user_for_initial_freeze", "full_acceptance_closed": False, "frozen_releases_unchanged": ["v0.1.0-rc.5", "v0.1.0", "v0.1.1"]}
ledger["source_increment_qualification"] = "docs/quality/admin-posting-period-172.json"
assert identities == [(row["id"], row["priority"], row["full_acceptance"], row["optional"], row.get("requirement_origin")) for row in ledger["requirements"]]
create(ROOT / "docs/quality/remaining-work-stage172.json", ledger)
lines = ["# 阶段172 · 原编号实现与完整验收台账", "", "保留102个原编号和88项必选完整验收范围；88不是未实现模块数。本轮补齐入账期间报表，未改变任何完整验收状态。源代码增量不改v0.1.1冻结包。", "", "|编号|模块|当前实现|仍待完整处理|完整验收|", "|---|---|---|---|---|"]
for row in ledger["requirements"]:
    lines.append("|" + "|".join(str(row[key]).replace("|", "\\|").replace("\n", " ") for key in ["id", "module", "implemented_scope", "current_audit_remaining", "full_acceptance"]) + "|")
create(ROOT / "docs/quality/remaining-work-stage172.md", "\n".join(lines) + "\n")

attempts = [{"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path), "status": json.loads(path.read_bytes())["status"]} for path in sorted((DELIVERY / "evidence/admin-posting-period-172").glob("*.json")) if path not in [qpath, upath]]
report = {"stage": 172, "status": "qualified", "at": datetime.now(timezone.utc).isoformat(), "sources": qualification["source_after"], "qualification": {"path": qpath.relative_to(ROOT).as_posix(), "sha256": digest(qpath)}, "actual_ui": {"path": upath.relative_to(ROOT).as_posix(), "sha256": digest(upath)}, "retained_attempts": attempts,
    "media": {"copies": copies, "screenshots": ui["screenshots"], "recordings": ui["recordings"]}, "fresh_native_sql_api_checks": 8, "fresh_exact_projection_checks": 1, "inherited_identical_source_legacy_checks": 6, "actual_admin_ui_checks": 7, "production_builds": {"components": ["backend", "admin"], "evidence": "Source-identical successful current builds in qualification-01; reused and verified by qualification-02."},
    "first_attempt": "Nine cases blocked by historical fixture missing settlement-source entries; corrected in version2 with matching funding-source entries and funding movements. Original product guards were never disabled.", "mandatory_whole_acceptance_open": 88, "new_full_acceptance_closures": 0, "owned_browser_and_services_closed": True, "virtualization_used": False, "frozen_v011_unchanged": True, "prepare_tool_sha256": digest(Path(__file__))}
create(ROOT / "docs/quality/admin-posting-period-172.json", report)

change = f"""# 172 · 按实际入账期间查询消耗 / Posting-period consumption

旧报表按工作建立时间筛选，无法直接查询旧工作本期扣费或退回。现在Admin可选费用入账期间；香港每日汇总、明细、原扣费追溯和CSV使用同一快照及相同账目投影。旧期间、严格权限与重放行为保留。

Admin can now report this period's charges/refunds on older works. Hong Kong day summaries, original-charge detail and CSV share the same projected snapshot. Legacy cohorts, authorization and replay behavior remain.

|编号|本轮实现／待办|状态|
|---|---|---|
|1|实际入账期间与旧工作本期账目|已实现|
|2|退款来源跨区间、负净消耗与精确微额|已实现|
|3|每日账目投影、同选择明细／CSV及刷新|已实现|
|4|预留与累积操作用量说明，旧请求兼容|已实现|
|5|8项新原生SQL/API、1项精确投影、6项源码一致的原报表通过结果及7组实际Admin操作|通过；首次资料失败保留|
|6|中英README、逻辑图、5PNG／1GIF／1MP4、机器契约及原编号台账|已更新|
|7|真实内部成本、正式服务、签名／其他OS与全部专业验收|原范围继续待办|

The first fixture omitted settlement funding sources and was rejected by existing guards. A new version supplies balanced sources and funding movements; the failed attempt remains immutable. No broad historical rerun or whole-acceptance closure is claimed.

![Actual posting-period report](../assets/admin-posting-period-172/{image})

![Actual interaction](../assets/admin-posting-period-172/{gif})

[MP4](../assets/admin-posting-period-172/{mp4}) · [Evidence](../quality/admin-posting-period-172.json) · [Original ledger](../quality/remaining-work-stage172.md) · [Implementation](../development/172-admin-posting-period.md)

此源码增量不在既有v0.1.1冻结ZIP内。原冻结包及标签保留；Backend/Admin需使用本次配套源码构建，数据库仍为156。This source increment is outside the frozen v0.1.1 ZIP; use matching backend/Admin builds with schema156.
"""
create(ROOT / "docs/changes/172-admin-posting-period.md", change)
for name in ["README.md", "README.en.md"]:
    path = ROOT / "docs" / name
    original = path.read_text(encoding="utf-8")
    intro = "# 当前源码增量 / Current source increment · 172\n\n已补齐按费用实际入账期间报表、香港日期投影及同选择明细／CSV。Posting-period reports, daily entry projection and same-selection detail/CSV are implemented.\n\n[更新 / Changes](changes/172-admin-posting-period.md) · [方案 / Behavior](development/172-admin-posting-period.md) · [证据 / Evidence](quality/admin-posting-period-172.json) · [原编号台账 / Original ledger](quality/remaining-work-stage172.md)\n\n此为v0.1.1之后的源码增量，不在下方冻结ZIP中；原包与标签保持不变。This increment is outside the frozen v0.1.1 bundle below; published archives and tags remain unchanged.\n\n---\n\n"
    assert "Current source increment · 172" not in original
    path.write_text(intro + original, encoding="utf-8", newline="\n")

path = ROOT / "docs/requirements/29-admin-usage-reports.md"
original = path.read_text(encoding="utf-8")
path.write_text("阶段169原范围记录；当前可选入账期间见 [阶段172补充](30-admin-posting-period.md)。Historical stage169 scope; see the additive posting-period requirement.\n\n" + original, encoding="utf-8", newline="\n")
path = ROOT / "docs/product/08-admin-dashboard.md"
original = path.read_text(encoding="utf-8")
original = original.replace("全部 TC-083–102 当前为 not_run，后台开发未实现。", "TC-083–102是原始完整验收编号；后台已有独立登录、用户／内容、费用／VIP、权限及报表实现，当前完整验收状态以最新原编号台账为准。")
original += "\n\n## 2026-11-01 · 入账期间补充 / Posting-period increment\n\nAdmin可选工作建立或实际费用入账期间；旧任务当期扣费和退款、香港日账目投影、同选择明细及CSV见 [需求30](../requirements/30-admin-posting-period.md)。预留和累积操作用量分开，退款原扣费只作来源追溯。原完整专业／成本／规模验收保留；增量在v0.1.1冻结包之外。\n\nAdmin now offers posting-period accounting alongside creation cohorts, with projected day detail/CSV and original-charge provenance. Holds and lifetime units remain separate. Original full acceptance remains; this increment is outside frozen v0.1.1.\n"
path.write_text(original, encoding="utf-8", newline="\n")
print(json.dumps({"status": "prepared", "stage": 172, "fresh_checks": 9, "inherited_legacy_checks": 6, "actual_ui_checks": 7, "media_copies": len(copies)}))
