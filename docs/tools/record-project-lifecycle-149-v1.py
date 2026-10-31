"""Bind the focused post-freeze increment and update bilingual documentation."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import re
import shutil

ROOT = Path(r"D:\dev\copypasted\自有agent")
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
EVIDENCE = DELIVERY / "evidence/project-lifecycle-149"
BASELINE = DELIVERY / ".data/project-lifecycle-149/baseline.json"

def digest(path):
    h = sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()

def read(path):
    return json.loads(path.read_bytes())

def put(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as f:
        f.write(text)

def reference(path):
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path)}

def copy_exact(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as f:
        f.write(source.read_bytes())
    assert digest(source) == digest(target)
    return reference(target)

baseline = read(BASELINE)
for f, expected in {**baseline["frozen_files"], **baseline["preserved_user_files"]}.items():
    assert digest(ROOT / f) == expected, f
assert digest(DEV / "copypaste-desktop/.gitattributes") == baseline["desktop_attributes_sha256"]
release_root = DELIVERY / "release/workmate-v0.1.0-rc.1"
release = read(release_root / "release-manifest.json")
for item in release["artifacts"]:
    assert digest(release_root / item["file"]) == item["sha256"]

sources, reports = {}, {}
for name in ["backend-02", "build-01", "ui-01"]:
    file = EVIDENCE / (name + ".json")
    report = read(file)
    assert report["status"] == "passed" and report["source_unchanged"]
    for field in ["source_manifest", "raw_report", "verifier"]:
        item = report[field]
        assert digest(DELIVERY / item["path"]) == item["sha256"]
    for path, item in read(DELIVERY / report["source_manifest"]["path"]).items():
        assert digest(DEV / path) == item["sha256"], path
        assert digest(DELIVERY / item["path"]) == item["sha256"], item["path"]
        assert sources.setdefault(path, item["sha256"]) == item["sha256"]
    if name != "build-01":
        assert report["owned_database_shutdown"] and report["result_exit_code"] == 0
        assert report["fixture_cleanup"]["status"] == "passed" and report["fixture_cleanup"]["exit_code"] == 0
        assert report.get("owned_database_port_closed", all(report.get("ports_closed", {}).values()))
    reports[name] = reference(file)

raw = (EVIDENCE / "backend-02.tap").read_text(encoding="utf-8")
assert re.search(r"^# tests 10\s*$", raw, re.M)
assert re.search(r"^# pass 10\s*$", raw, re.M)
assert re.search(r"^# fail 0\s*$", raw, re.M)
assert read(EVIDENCE / "backend-01.json")["status"] == "failed"
journey = read(EVIDENCE / "ui-01-journey.json")
assert journey["status"] == "passed" and len(journey["checks"]) == 5 and not journey["errors"]
assert all(journey[k] for k in ["browser_closed", "desktop_closed", "api_closed", "fixture_closed"])
assert len(journey["screenshots"]) == 4 and len(journey["recordings"]) == 2
assert all(v["no_horizontal_overflow"] for v in journey["layouts"])
assert all(v["rails_hidden"] for v in journey["layouts"] if v["client"] == "desktop")
build = read(EVIDENCE / "build-01.json")
assert len(build["commands"]) == 6 and all(v["exit_code"] == 0 for v in build["commands"])
for file, expected in build["package_files"].items():
    assert digest(Path(build["package_root"]) / file) == expected

media = list(journey["screenshots"])
for recording in journey["recordings"]:
    assert recording["observed_frames"] >= 5 and recording["distinct_frames"] >= 2 and recording["skipped_capture_errors"] == 0
    media.extend(recording["files"])
for item in media:
    assert digest(DEV / item["path"]) == item["sha256"]

stem = "workmate-project-lifecycle-149-01-"
copies = []
for repo in ["platform", "admin", "extension", "delivery"]:
    for suffix in ["same-project-restored-en.png", "project-archive-restore.gif", "project-archive-restore.mp4"]:
        copies.append(copy_exact(DEV / "copypaste-web/assets/screenshots" / (stem + suffix), DEV / ("copypaste-" + repo) / "assets/screenshots" / (stem + suffix)))
for item in media:
    source = DEV / item["path"]
    copies.append(copy_exact(source, ROOT / "docs/assets/project-lifecycle-149" / (source.parent.parent.parent.name + "__" + source.name)))
contract = copy_exact(DEV / "copypaste-platform/contracts/project-management-openapi.json", ROOT / "docs/contracts/project-management-openapi.json")

# Only Git interpretation is added; previously executed code/evidence keeps its bytes.
attr = DELIVERY / ".gitattributes"
assert "Stage149" not in attr.read_text(encoding="utf-8")
with attr.open("a", encoding="utf-8", newline="\n") as f:
    f.write("\n# Stage149 original project-management verifiers, raw failures and snapshots.\n"
            "scripts/*149* -text whitespace=cr-at-eol\n"
            "evidence/project-lifecycle-149/objects/** -diff -text -whitespace\n"
            "evidence/project-lifecycle-149/*.tap -text -whitespace\n")

checkpoint = {
    "created_at": datetime.now(timezone.utc).isoformat(), "status": "verified_project_management_increment",
    "stage": 149, "release": "unreleased_after_v0.1.0-rc.1", "frozen_release_unchanged": True,
    "baseline": baseline, "schema_version": 145, "backend_cases": 10, "actual_journey_groups": 5,
    "native_surface_boundary_cases": 12, "broad_regression": "deliberately_omitted_by_user",
    "model_mode": "no_model_requests_in_this_increment", "new_full_acceptance_closures": 0,
    "reports": reports, "source_files": sources, "media": media, "shared_media_copies": copies,
    "api_contract": contract, "package_root": build["package_root"], "package_files": build["package_files"],
    "recorder_sha256": digest(Path(__file__)),
    "original_failed_attempt": {"report": reference(EVIDENCE / "backend-01.json"), "reason": "V1 used a top-level error code instead of the documented error envelope, and inspected restricted pg_stat_activity.query text. V2 retains all status/state/audit assertions and uses actual pg_locks blocking-pid evidence, as existing authority tests do. Product sources unchanged between these backend attempts."},
    "independent_static_review": "Two read-only specialist/refutation agents checked lifecycle coverage and management authorization/races under spec-to-code-compliance. Final review found no remaining blocker in the bounded restoration/pre-send chain; it is not runtime or whole-product acceptance.",
    "scope": "Current owner/admin directory and edit/archive/restore, last-active recovery, exact state expectations, authorization after lock waits, idempotent replay and stale client response fencing. Aggregate erasure/export and full production acceptance remain open. Frozen tags and release ZIPs are not replaced.",
}
put(ROOT / "docs/quality/project-lifecycle-checkpoint-149.json", json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")

ledger_path = ROOT / "docs/quality/remaining-work-stage148.json"
ledger = read(ledger_path)
ledger["schema_version"] += 1
ledger["current_stage"] = 149
ledger["reviewed_at"] = checkpoint["created_at"]
ledger["previous_review"] = reference(ledger_path)
ledger["checkpoint"] = "docs/quality/project-lifecycle-checkpoint-149.json"
ledger["new_full_acceptance_closures"] = 0
ledger["current_increment"] = {"stage": 149, "scope": checkpoint["scope"], "backend_cases": 10, "actual_client_journey_groups": 5,
                               "broad_regression": "deliberately_omitted_by_user", "full_acceptance_closed": False, "release": "unreleased_after_v0.1.0-rc.1"}
for row in ledger["requirements"]:
    if row["id"] == "REQ-002":
        row["current_review_note"] += " 149新增管理专用项目目录与编辑/封存/恢复，锁等待后复核权限，Web/Desktop最后项目恢复、旧列表与提交前会话竞争保护；10项SQL/HTTP和5组实际界面旅程通过，完整权限矩阵仍开放。"
    if row["id"] == "REQ-049":
        row["current_audit_remaining"] = "项目/企业聚合整删尚未实现（当前为21类单资源根清理及企业状态关闭）；35天备份轮换已有实现，仍需全量导出、所有衍生数据、聚合清理与生产备份恢复完整验收。"
        row["current_review_note"] += " 149独立复核确认备份轮换已实现；补齐可逆项目归档恢复，保留原项目身份、资料与现有权限；归档不代表永久删除，也不承诺持久取消在途任务。"
assert len(ledger["requirements"]) == 102 and ledger["summary"]["required_open"] == 88
put(ROOT / "docs/quality/remaining-work-stage149.json", json.dumps(ledger, ensure_ascii=False, indent=2) + "\n")
rows = ["# 当前完整待项 / Remaining full acceptance — Stage149", "", "首个冻结版 `v0.1.0-rc.1` 已完成；本轮为其后的未冻结修复。102项原始记录保留，88项必需完整验收范围仍开放，并非88个缺失模块；本轮新增关闭完整需求0项。", "", "Original requirement identities and whole acceptance scopes are retained. This increment fixes project management after the first frozen release; it does not close aggregate deletion or full product acceptance.", "", "| 编号 | 优先级 | 模块 | 完整验收 | 当前尚待处理范围 |", "|---|---|---|---|---|"]
for row in ledger["requirements"]:
    cells = [row["id"], row["priority"], row["module"], row["full_acceptance"], row.get("current_audit_remaining", row["remaining"])]
    rows.append("| " + " | ".join(str(v).replace("|", "\\|").replace("\n", " ") for v in cells) + " |")
put(ROOT / "docs/quality/remaining-work-stage149.md", "\n".join(rows) + "\n")

diagram = '''```mermaid
flowchart LR
  A[Owner / administrator] --> B[Managed project directory]
  B --> C[Edit / archive / restore]
  C --> D[Current authority and exact-state check]
  D --> E[Existing project identity and materials]
  C --> F[Latest active list]
  F --> G[Web / local Desktop selection]
```
'''
guide = '''# 项目管理与最后项目恢复 / Project management and last-project recovery

本轮属于首个冻结版本 `v0.1.0-rc.1` 之后的开发修复，冻结标签、五个ZIP、清单及校验值保持原样。六个独立仓库的分支会继续同步；此修复没有被倒填到旧发行包。

This is an unreleased increment after the first frozen candidate. Its seven frozen tags and original five archives are retained. Branches advance independently; the old release packages do not silently acquire these fixes.

## 使用流程 / Usage

企业 owner/admin 在 Web 或 Desktop 打开「项目」，按使用中、已封存或全部筛选，使用文字搜索和每页12条分页。新增或编辑名称与简介；归档/恢复必须明确勾选确认。归档最后一个项目后页面仍可访问，切换已封存列表可以恢复原项目，不需要创建替代企业或项目。

Workspace owners/admins open Projects, filter Active/Archived/All, search by literal text and page through twelve cards. Create or edit details; archive/restore requires explicit confirmation. The management page remains reachable with no active project. Restore from Archived to reuse the original project and its existing materials/grants. Removed grants stay removed. Other members only see their authorized active projects.

归档是可逆的可用性状态，在封存期间普通任务、文件和本机执行继续通过 active-only 权限边界拒绝访问。它不等于永久删除或持久取消：云端任务定期及工具调用前复查，短暂归档后立即恢复可能没有触发周期检查。需要结束的任务必须先明确取消；不以归档批量释放费用预留，也不承诺撤回客户已下载的文件。

Archiving is reversible availability control. Normal task/source/native paths still require an active project. It is not permanent erasure or durable cancellation: a rapid archive/restore may occur between worker checks. Cancel work separately when termination is intended. Archiving does not bulk-release financial holds or recall downloaded files.

## 实现约束 / Implementation

`GET /v1/tenants/:tenant/project-directory` 为当前 owner/admin 提供独立管理目录；原活动项目列表保持不变。查询严格限制 state、search≤160、page≤10000、page_size≤100，使用参数化字面子串搜索及企业RLS。响应禁止缓存。项目资料更新保持原 PATCH 路径，并支持 expected_archived/name/description，冲突返回409 PROJECT_CHANGED。

The management directory is separate from active project access. The existing PATCH path accepts optional expected-state fields and rejects stale changes. The request locks user authority, tenant memberships and the project row in the established order, then rechecks current authorization after all waits. A suspended/removed/demoted actor cannot finish using stale authority. Cross-tenant path/header mismatches cannot mutate the target.

更新可使用持久幂等键；所有重放先验证当前权限，只记录最小成功标识，再返回当前项目状态。因此归档成功但回复丢失、用户已恢复后再重试，不会再次归档。审计仅记录变更字段名与状态，避免把客户名称、简介写入审计正文。

Idempotent retries reauthorize and return current state instead of applying a cached mutation again. A lost archive response followed by a restore cannot rearchive on retry. Audit records contain changed field names and state, excluding private project text.

Web/Desktop 的项目目录组件按用户与企业隔离；项目列表请求使用单独递增序号和企业校验，旧结果不能覆盖新状态。新增/恢复后的 preferred project 仅从最新接受的 active list 选择；等待操作摘要后、发送前还验证组件、操作与会话没有切换。共享主布局允许项目/成员/设备/用量/设置在无项目时访问，业务路由仍要求有效项目。Desktop 的本机工作区、会话、权限和固定Codex运行时没有被Web代码覆盖。

The clients fence stale list results by tenant and request generation, validate preferred selections against the latest accepted active list and guard the pre-send digest wait against session/action/unmount changes. Management routes work without a selected project; project business routes still require one. Desktop keeps its native local Codex bridge and execution paths. Extension retains cloud execution and the native right Side Panel.

DIAGRAM

## 聚焦验证 / Focused qualification

10项真实SQL/HTTP检查通过：最后项目恢复保留身份及原指令；owner/admin正向；普通角色拒绝；跨企业与未登录拒绝；竞争更新只成功一次；重复请求返回当前状态；等待真实权限锁时降权/移除/封禁拒绝；撤销的项目绑定不复建；分页、字面搜索、资料冲突及审计最小化。

Ten focused SQL/HTTP cases passed. Six build steps passed, including twelve native-surface boundaries, Web and renderer compilers/builds and a distinct unsigned Windows directory package. Five actual client groups cover Web OTP/new company onboarding, a delayed real pre-archive response, Web archive-last/restore, native Desktop PKCE and Desktop archive-last/restore. Four actual PNGs and two actual GIF/MP4 pairs are retained. All owned browsers, native windows, API, isolated fixtures and native databases closed. No model call was made in this increment.

Web在1440/390宽度无横向溢出；Desktop在1360/1000宽度无横向溢出，侧栏与正文不显示滚动条、无系统菜单。当前证据位于 delivery/evidence/project-lifecycle-149，后端02、构建01、UI01。原后端01失败保留：检查器曾读取错误的错误字段，并依赖无权读取的数据库查询文本；V2保留原业务断言，改用标准错误结构和真实pg_locks阻塞证据。没有修改已执行的测试或覆盖失败。

Broad model, Extension, production and historical regressions were deliberately omitted under the user's fast-release instruction. Historical Stage147/148 results are not relabelled as current acceptance. Schema remains145, with no new migration. The distinct candidate is desktop/release/project-lifecycle-149-01/win-unpacked; it does not replace the frozen release directory.

## 仍待完成 / Remaining

项目/企业聚合整删仍缺少路由、范围服务、队列协调和恢复重放，不能描述为仅剩测试。已有21类资源根清理和35天备份轮换；后续聚合实现需覆盖权限撤回、派生数据、私有连接/回执、外部不确定费用、不可删除的财务审计事实、共享资源边界及备份重放。全量导出与生产恢复完整验收也保持开放。

Aggregate project/tenant erasure remains unimplemented, while single-resource cleanup and 35-day backup rotation already exist. Comprehensive export, derived-data coverage, production recovery, real provider/Google/Meta account integration, signing/install/update and whole-product acceptance remain open. Preserve all102 original requirement records; 88 required whole acceptance scopes remain open, not88 entirely absent modules.

[当前完整编号 / Full ledger](../quality/remaining-work-stage149.md) · [API contract](../contracts/project-management-openapi.json) · [First frozen release](../releases/v0.1.0-rc.1.md)

![Actual restored Web project](../assets/project-lifecycle-149/copypaste-web__workmate-project-lifecycle-149-01-same-project-restored-en.png)

![Actual packaged Desktop archive/restore](../assets/project-lifecycle-149/copypaste-desktop__workmate-project-lifecycle-149-01-project-archive-restore.gif)

[Web MP4](../assets/project-lifecycle-149/copypaste-web__workmate-project-lifecycle-149-01-project-archive-restore.mp4) · [Desktop MP4](../assets/project-lifecycle-149/copypaste-desktop__workmate-project-lifecycle-149-01-project-archive-restore.mp4)
'''.replace("DIAGRAM", diagram)
put(ROOT / "docs/development/149-project-management.md", guide)
put(ROOT / "docs/changes/149-project-management.md", '''# Stage149 更新 / Changes

| 编号 | 事项 | 状态 |
|---|---|---|
| 1 | 管理专用项目目录、状态/搜索/分页、编辑和归档恢复 | 已实现 |
| 2 | 最后项目归档后恢复入口、资料与身份保留 | 已实现并验证 |
| 3 | 锁等待后权限复查、预期状态冲突、幂等重放 | 已实现；10项后端检查通过 |
| 4 | Web/Desktop旧列表、恢复选中及提交前会话竞争 | 已修复；5组实际界面旅程通过 |
| 5 | 双语README、4张PNG、2组GIF/MP4与独立源码分支 | 随本轮同步 |
| 6 | 首个冻结版及五个ZIP | 保持原样；149为未冻结后续修复 |
| 7 | 聚合整删、完整导出、真实服务和签名更新 | 待处理；完整验收保持开放 |

Project management is restored end to end on Web and native Desktop. Ten focused backend cases, five actual client groups and six build steps passed. The original failed backend verifier is retained with its corrected successor. Broad regressions were deliberately omitted. Original frozen tags and archives are not replaced. Aggregate erasure and the remaining full acceptance scopes remain open.

[实现及使用 / Implementation and usage](../development/149-project-management.md) · [完整编号 / Full ledger](../quality/remaining-work-stage149.md)
''')

for repo in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
    folder = DEV / ("copypaste-" + repo)
    actual = repo in ["web", "desktop"]
    for english in [False, True]:
        readme = folder / ("README.en.md" if english else "README.md")
        old = readme.read_text(encoding="utf-8")
        assert "<!-- project-lifecycle-149 -->" not in old
        if english:
            text = """<!-- project-lifecycle-149 -->

**Current development increment149 — project management after frozen `v0.1.0-rc.1`**

Workspace owners/admins open Projects, filter Active/Archived/All, search and page, edit details, or explicitly confirm archive/restore. Archiving the last active project keeps the management page reachable. Restore reuses its identity, materials and existing grants; revoked access remains revoked. Ordinary members see only authorized active projects. Archive controls availability while archived; cancel work separately when termination is intended.

The management API checks current authority after lock waits, rejects stale expected state and makes lost-response retries return current state without reapplying obsolete changes. Web/Desktop reject stale list results and validate restored selections against the latest active list. Desktop continues running Codex locally with customer-controlled full permission; Extension remains a cloud agent client using Chrome's native right Side Panel for consented file upload.

Ten current backend cases, five actual client journey groups and six build steps passed. Four actual screenshots and two wall-clock GIF/MP4 pairs were recorded; owned resources closed. No AI request or broad historical regression was run. The original failed verification attempt is retained. Aggregate erasure, production integrations and full acceptance remain open. The original seven frozen tags and five release archives are unchanged;149 is an unreleased branch increment.

"""
        else:
            text = """<!-- project-lifecycle-149 -->

**当前开发增量149：首个冻结版 `v0.1.0-rc.1` 后的项目管理修复**

企业 owner/admin 从「项目」筛选使用中/已封存/全部、搜索分页、编辑名称简介，并明确确认归档/恢复。归档最后一个项目后管理页仍可访问，可恢复原项目身份、资料与现有成员权限；已撤销授权不复建。普通成员仅见获准的活动项目。归档控制封存期间可用性，需要结束的任务请先明确取消。

后端在权限锁等待后重新鉴权，支持预期状态冲突与幂等重试；重放返回当前状态，避免恢复后再次封存。两端阻止旧列表覆盖新状态，恢复选中仅采用最新活动项目列表。Desktop仍在客户本机运行Codex并支持客户主动授予完整权限；Extension仍采用原生右侧栏及云端Agent，负责获准文件读取上传。

10项当前后端检查、5组真实界面旅程和6步构建通过，保留4张截图、2组真实GIF/MP4，资源均已关闭。未发起模型请求，按快速冻结要求省略广泛历史回归；原始失败验证及后继修正版均保留。聚合整删、生产联调及完整验收继续开放。原7个冻结标签和5个发行ZIP保持原样，149属于未冻结后续代码。

"""
        text += diagram + "\n"
        text += ("Actual current component journey." if english else "本组件当前真实界面旅程。") if actual else ("Actual Web journey shown as a shared illustration; no new UI acceptance is claimed for this component." if english else "下图为真实Web共享流程示意，不代表本组件新增UI验收。")
        text += f"\n\n![Project restored](assets/screenshots/{stem}same-project-restored-en.png)\n\n![Actual archive and restore](assets/screenshots/{stem}project-archive-restore.gif)\n\n[Actual MP4](assets/screenshots/{stem}project-archive-restore.mp4)\n\n"
        if repo == "delivery":
            text += ("Selected evidence: `evidence/project-lifecycle-149/backend-02.json`, `build-01.json`, `ui-01.json`. Use a new two-digit attempt ID when running the149 qualification scripts; executed attempts are immutable.\n\n" if english else "当前证据：`evidence/project-lifecycle-149/backend-02.json`、`build-01.json`、`ui-01.json`；再次执行149脚本应使用新的两位attempt编号，已执行记录不得覆盖。\n\n")
        if repo == "desktop":
            text += ("Current unsigned candidate: `release/project-lifecycle-149-01/win-unpacked/CopyPaste.exe`. The first frozen portable archive remains separate.\n\n" if english else "当前未签名候选程序：`release/project-lifecycle-149-01/win-unpacked/CopyPaste.exe`，与首个冻结便携ZIP分开保留。\n\n")
        text += "---\n\n"
        with readme.open("w", encoding="utf-8", newline="\n") as f:
            f.write(text + old)

for filename in ["README.md", "README.en.md"]:
    index = ROOT / "docs" / filename
    old = index.read_text(encoding="utf-8")
    lead = """<!-- project-lifecycle-149 -->

[项目管理与最后项目恢复 / Project archive and restore](development/149-project-management.md) · [完整编号 / Full ledger](quality/remaining-work-stage149.md) · [更新 / Changes](changes/149-project-management.md)

首个冻结版保留；149为其后的未冻结修复。10项后端检查、5组实际Web/Desktop旅程及6步构建通过；广泛回归按要求省略，102项原需求及88项必需完整验收范围保留。

First frozen release retained;149 is an unreleased follow-up. Ten backend cases, five actual client groups and six build steps passed. Broad regression was deliberately omitted; all102 original records and88 required whole acceptance scopes remain.

---

"""
    with index.open("w", encoding="utf-8", newline="\n") as f:
        f.write(lead + old)
print(json.dumps({"status": "recorded", "backend_cases": 10, "actual_journey_groups": 5, "sources": len(sources), "media": len(media), "frozen_release_unchanged": True}, ensure_ascii=False))
