"""Record bounded publishing acceptance without closing the full requirement ledger."""
from __future__ import annotations

import argparse
import contextlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path

import archive_controlled_publications_evidence_v1 as evidence
from record_audio_accounting_v2 import git

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
CHECKPOINT = QUALITY / "publications-checkpoint-125.json"
PREVIOUS_REVIEW = QUALITY / "remaining-work-current-review-125-v7.json"
REPOS = {"backend": "platform", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}


def write_new(file: Path, value: dict) -> None:
    with file.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--git-bytes", required=True)
    args = parser.parse_args()
    report_path = QUALITY / args.git_bytes
    assert report_path.parent == QUALITY and report_path.name.startswith("publication-qualified-git-bytes-125-")
    byte_report = evidence.read(report_path)
    assert byte_report["status"] == "passed" and not byte_report["different_files"]
    byte_tool = ROOT / "docs/tools/verify_qualified_publication_git_blobs_v1.py"
    assert byte_report["verifier_sha256"] == evidence.digest(byte_tool.read_bytes())
    portability_path = QUALITY / "controlled-publications-portability-125-01.json"
    portability = evidence.read(portability_path)
    assert portability["status"] == "passed" and portability["candidate_file_access_refused"]
    assert portability["archive_reader"] == evidence.reference(ROOT / "docs/tools/verify_controlled_publications_archive_v1.py")
    assert portability["verifier"] == evidence.reference(ROOT / "docs/tools/qualify_controlled_publications_portability_v1.py")
    assert not CHECKPOINT.exists()
    print(json.dumps({"phase": "verifying_preserved_archive_and_current_bounded_sources"}), flush=True)
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        evidence.verify()
    archive_verification = json.loads(buffer.getvalue())
    assert archive_verification["status"] == "passed"
    index = evidence.read(evidence.INDEX)
    # Every alias must declare the same digest/size for its content-addressed blob.
    aliases = {}
    for entry in index["entries"]:
        blob = ROOT / entry["blob"]
        assert blob.resolve().is_relative_to(evidence.OUT.resolve())
        assert blob.stem == entry["sha256"]
        value = (entry["sha256"], entry["bytes"])
        assert aliases.get(entry["blob"], value) == value
        aliases[entry["blob"]] = value
    assert len(aliases) == index["unique_blobs"]

    sources = dict(index["current_source_files"])
    commits = {}
    for branch, component in REPOS.items():
        candidate_name = "copypaste-" + component + ("-publication-125" if component != "delivery" else "")
        candidate = ROOT / "dev" / candidate_name
        commits[branch] = git(candidate, "rev-parse", "HEAD").decode().strip()
        assert byte_report["repository_commits"][candidate_name] == commits[branch]
        for name in ["README.md", "README.en.md"]:
            file = candidate / name
            sources[file.relative_to(ROOT).as_posix()] = evidence.digest(file.read_bytes())
    publisher = ROOT / "dev/copypaste-delivery/scripts/publish-workmate-v8.mjs"
    assert publisher.is_file()
    sources[publisher.relative_to(ROOT).as_posix()] = evidence.digest(publisher.read_bytes())
    canonical = {}
    for name, expected in sources.items():
        parts = Path(name).parts
        directory = parts[1].removesuffix("-publication-125")
        canonical_name = Path(parts[0], directory, *parts[2:]).as_posix()
        assert canonical.get(canonical_name, expected) == expected
        canonical[canonical_name] = expected
        assert evidence.base.digest(ROOT / canonical_name) == expected, canonical_name
    assert byte_report["qualified_sources_checked"] == len(index["current_source_files"])

    counts = {"related_backend": 117, "admin_upgrade_cli": 5, "native_analysis_diagnostic": 12,
              "desktop_media_and_session": 21, "extension_unit": 70, "actual_web_admin": 14,
              "actual_packaged_desktop_and_side_panel": 10, "browser_consent": 3,
              "current_passing_media_files": len(index["actual_media_files"])}
    previous = evidence.read(PREVIOUS_REVIEW)
    rows = previous["requirements"]
    changes = {
        "REQ-010": "本轮实际Web/Admin 14/14及打包Desktop/原生右侧栏10/10通过，含明确确认、未知结果和撤权；其余外部写动作及全部格式/跨端组合仍待完整验收。",
        "REQ-034": "当前发布相关后端117/117及实际确认/未知结果通过；其余外部动作的防重复、人工处置与恢复矩阵仍待补齐。",
        "REQ-039": "新增发布的实际Electron图片、确认、三档窗口、无边框/菜单/可见滚动条已通过；签名安装、更新卸载、约定OS/DPI及完整本机工具仍待验收。",
        "REQ-048": "新增发布Admin实际页面及授权CLI已通过；其余资源正文治理、客服协助及整个后台权限/运营矩阵仍待完成。",
        "REQ-060": "六组件源码、本轮双语说明、实际截图和GIF已形成；本轮远端发布以最终SHA回执为准，独立检出复现与全部需求源码交付仍待完成。",
        "REQ-075": "四个新增发布工具仍缺实际Codex调用，全部角色/团队/计划/恢复组合及此前偶发超时根因仍开放；本轮两个原生分析角色及相关回归通过。",
        "REQ-082": "新增Web/Admin四档真实宽度及Desktop三档窗口已通过；全部组件状态、缩放、键盘、读屏、对比和动画设置仍需完整验收。",
    }
    for row in rows:
        if row["id"] in changes:
            row["current_audit_remaining"] = changes[row["id"]]
        row["full_acceptance"] = "open"
    checkpoint = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_bounded_controlled_publications_delivery",
                  "scope": index["scope"], "counts": counts, "source_files": canonical,
                  "qualified_workspace_sources": sources, "component_commits": commits,
                  "actual_media_files": {name.replace("-publication-125/", "/", 1): expected for name, expected in index["actual_media_files"].items()},
                  "verifier_sha256": evidence.digest(Path(__file__).read_bytes()),
                  "evidence_index": evidence.reference(evidence.INDEX), "archive_verifier": evidence.reference(Path(evidence.__file__)),
                  "archive_verification": archive_verification, "qualified_git_blobs": evidence.reference(report_path),
                  "canonical_archive_portability": evidence.reference(portability_path),
                  "previous_publication": index["previous_publication"], "previous_review": evidence.reference(PREVIOUS_REVIEW),
                  "current_full_platform_regression_rerun": False, "original_full_acceptance_open": 102,
                  "required_open": 89, "unconfirmed_suggestions": 12, "optional_open": 1, "fully_accepted": 0,
                  "professional_roles_fully_qualified": 0,
                  "limits": ["Only the complete listed related backend files and actual publishing journeys are current passing scopes.",
                             "Native media acceptance here covers an actual protected image; video playback/seek and native video range behavior remain separately unaccepted.",
                             "The four new publication tools have no new actual Codex invocation qualification.",
                             "No signed installer, live provider, full professional quality, twelve-role qualification or complete product acceptance.",
                             "Subsequent passing native analysis runs do not establish a permanent fix for the earlier intermittent timeout.",
                             "Historical failures, invalid claims and exact source snapshots remain preserved."]}
    write_new(CHECKPOINT, checkpoint)
    ledger = {"schema_version": 8, "reviewed_at": checkpoint["at"], "requirements": rows,
              "summary": previous["summary"], "required_priorities": previous["required_priorities"],
              "module_groups": previous["module_groups"], "previous_review": evidence.reference(PREVIOUS_REVIEW),
              "checkpoint": evidence.reference(CHECKPOINT), "new_full_acceptance_closures": 0}
    write_new(QUALITY / "remaining-work-stage125.json", ledger)
    lines = ["# 当前未完成项 · 阶段125 / Current open work", "",
             "必需需求89条仍开放（77条部分验证、12条未证完成），另有12条未确认扩展建议和1条可选项，共102条。此为整体验收口径，不是89个未编码模块。", "",
             "本轮新增受控发布的相关后端117/117、Web/Admin实际14/14及打包Desktop/原生侧栏10/10通过；没有关闭原始完整需求。", ""]
    for title, collection in [("必需交付（89条）", [row for row in rows if not row["optional"] and row["requirement_origin"] == "existing_requirement"]),
                              ("未确认扩展建议（12条）", [row for row in rows if row["requirement_origin"] == "expanded_design_suggestion"]),
                              ("可选项（1条）", [row for row in rows if row["optional"]])]:
        lines += ["## " + title, "", "| 编号 | 优先级 | 模块 | 状态 | 尚需完成 |", "| --- | --- | --- | --- | --- |"]
        lines += [f"| {row['id']} | {row['priority']} | {row['module']} | {row['audit_status']} | {row['current_audit_remaining']} |" for row in collection]
        lines.append("")
    lines += ["[本轮证据](publications-checkpoint-125.json) · [结构化清单](remaining-work-stage125.json) · [原始v7复核](remaining-work-current-review-125-v7.md)", ""]
    with (QUALITY / "remaining-work-stage125.md").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write("\n".join(lines))
    print(json.dumps({"status": checkpoint["status"], "counts": counts, "sources": len(canonical),
                      "required_open": 89, "all_open": 102, "checkpoint": evidence.reference(CHECKPOINT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
