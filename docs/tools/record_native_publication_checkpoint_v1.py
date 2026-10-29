"""Bind native publishing fixes to current primary sources without closing full acceptance."""
from pathlib import Path
from datetime import datetime, timezone
from hashlib import sha256
import json

import archive_native_publication_evidence_v1 as evidence
from record_audio_accounting_v2 import git

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
OUTPUT = QUALITY / "native-publication-checkpoint-126.json"
REPOS = {"backend": "platform", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}


def write_new(file, value):
    with file.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def main():
    assert not OUTPUT.exists(), "Never replace a recorded checkpoint"
    verification = evidence.verify()
    index = evidence.read(evidence.INDEX)
    old_file = QUALITY / "publications-checkpoint-125.json"
    old = evidence.read(old_file)
    sources = {**old["source_files"], **index["current_sources"]}
    commits = {}
    for branch, component in REPOS.items():
        repo = ROOT / "dev" / ("copypaste-" + component)
        assert not git(repo, "status", "--porcelain"), branch
        local = git(repo, "branch", "--show-current").decode().strip()
        assert local == "codex/" + branch, (branch, local)
        commits[branch] = git(repo, "rev-parse", "HEAD").decode().strip()
        for name in ["README.md", "README.en.md", ".gitattributes"]:
            file = repo / name
            sources[file.relative_to(ROOT).as_posix()] = sha256(file.read_bytes()).hexdigest()
    publisher = ROOT / "dev/copypaste-delivery/scripts/publish-workmate-v9.mjs"
    sources[publisher.relative_to(ROOT).as_posix()] = sha256(publisher.read_bytes()).hexdigest()
    assert sha256((ROOT / "dev/copypaste-desktop/.gitattributes").read_bytes()).hexdigest() == "82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e"
    for name, expected in sources.items():
        assert sha256((ROOT / name).read_bytes()).hexdigest() == expected, name
    counts = {"native_publication": 5, "analysis_role_checks": 12,
              "pre_turn_faults": verification["pre_turn_counts"],
              "related_backend": verification["full_related_counts"]}
    analysis = next(row for row in index["attempts"] if row["number"] == "07")
    assert analysis["status"] == "passed" and analysis["counts"]["tests"] == analysis["counts"]["pass"] == 12
    assert all(analysis["counts"][key] == 0 for key in ["fail", "cancelled", "skipped", "todo"])
    value = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_bounded_native_publication_tools",
             "scope": index["scope"], "counts": counts, "source_files": sources,
             "component_commits": commits, "evidence_index": evidence.ref(evidence.INDEX),
             "archive_verifier": evidence.ref(Path(evidence.__file__)), "archive_verification": verification,
             "previous_publication": index["previous_publication"], "previous_checkpoint": evidence.ref(old_file),
             "current_full_platform_regression_rerun": False, "new_actual_ui_qualified": False,
             "new_native_video_playback_qualified": False, "original_full_acceptance_open": 102,
             "required_open": 89, "unconfirmed_suggestions": 12, "optional_open": 1,
             "fully_accepted": 0, "professional_roles_fully_qualified": 0,
             "bounded_startup_recovery_qualified": True,
             "desktop_pre_turn_recovery_qualified": False,
             "native_timeout_cause": "Missing pre-turn recovery corrected and fault-qualified; underlying intermittent native/Windows latency cause remains unproven. Failed08, interrupted06 and both failed probes remain unchanged.",
             "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest(),
             "limits": ["Actual pinned native Codex; synthetic model decisions and provider accounts.",
                        "Full selected related files are current; no new whole-platform regression.",
                        "Earlier UI/media retain their original source and acceptance scope.",
                        "No live provider, signed installer, twelve complete professional roles or full product acceptance.",
                        "Interrupted06 has no terminal verifier or fixture-cleanup receipt; neither is reconstructed."]}
    write_new(OUTPUT, value)
    previous_file = QUALITY / "remaining-work-stage125.json"
    previous = evidence.read(previous_file)
    rows = previous["requirements"]
    updates = {
        "REQ-010": "阶段125的实际Web/Admin 14/14及打包Desktop/原生右侧栏10/10按原源码保留，含明确确认、未知结果和撤权；本轮没有新增UI资格。其余外部写动作及全部格式/跨端组合仍待完整验收。",
        "REQ-060": "本轮修复已绑定确切源码、双语说明、四工具原生专项和相关回归；远端发布以本轮最终SHA回执为准。独立检出复现、各端完整源码及原始整体验收仍待完成。",
        "REQ-075": "云端四个发布工具已由固定真实Codex执行，含原素材版本、一次账务和明确确认边界；补齐无轮次提交且零模型请求时的两次以内启动恢复，并验证原任务一次计费。Desktop本机的同类启动恢复及四工具组合、偶发底层延迟根因、全部角色/团队/计划/恢复及跨端组合仍待完成。",
    }
    for row in rows:
        if row["id"] in updates:
            row["current_audit_remaining"] = updates[row["id"]]
        row["full_acceptance"] = "open"
    ledger = {**previous, "schema_version": 9, "reviewed_at": value["at"], "requirements": rows,
              "previous_review": evidence.ref(previous_file), "checkpoint": evidence.ref(OUTPUT), "new_full_acceptance_closures": 0}
    write_new(QUALITY / "remaining-work-stage126.json", ledger)
    lines = ["# 当前未完成项 · 阶段126 / Current open work", "",
             "89条必需整体验收、12条未确认扩展建议和1条可选项仍开放，共102条。它们不是102个完全未编码模块。", "",
             "本轮补齐四个发布工具的实际云端Codex执行、版本来源及受限启动恢复；Desktop本机组合、完整专业角色、底层偶发延迟根因及原始整体验收继续开放。", ""]
    for title, collection in [("必需交付（89条）", [r for r in rows if not r["optional"] and r["requirement_origin"] == "existing_requirement"]),
                              ("未确认扩展建议（12条）", [r for r in rows if r["requirement_origin"] == "expanded_design_suggestion"]),
                              ("可选项（1条）", [r for r in rows if r["optional"]])]:
        lines += ["## " + title, "", "| 编号 | 优先级 | 模块 | 当前状态 | 尚需完成 |", "| --- | --- | --- | --- | --- |"]
        lines += [f"| {r['id']} | {r['priority']} | {r['module']} | {r['audit_status']} | {r['current_audit_remaining']} |" for r in collection]
        lines.append("")
    lines += ["[本轮证据](native-publication-checkpoint-126.json) · [结构化清单](remaining-work-stage126.json) · [上一轮原表](remaining-work-stage125.md)", ""]
    with (QUALITY / "remaining-work-stage126.md").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write("\n".join(lines))
    print(json.dumps({"status": value["status"], "counts": counts, "sources": len(sources), "required_open": 89, "all_open": 102}))


if __name__ == "__main__":
    main()
