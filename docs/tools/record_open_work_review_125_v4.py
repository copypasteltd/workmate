"""Record a new, immutable checkpoint; preserve earlier reviews and executions."""

import collections
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "docs/quality"
BACKEND = ROOT / "dev/copypaste-platform-publication-125"
ADMIN = ROOT / "dev/copypaste-admin-publication-125"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def relative(path):
    return path.relative_to(ROOT).as_posix()


def git(repo, *args):
    return subprocess.check_output(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args],
        cwd=repo, text=True, encoding="utf-8", errors="strict",
    ).strip()


def report_at(path, repo, prefix=""):
    data = read(path)
    raw = repo / data["raw_report"]["path"] if "raw_report" in data else path.with_suffix(".tap")
    raw_sha = data["raw_report"]["sha256"] if "raw_report" in data else data["tap_sha256"]
    assert sha(raw) == raw_sha
    same, different = 0, []
    for name, expected in data.get("source_files", data.get("source_sha256", {})).items():
        if prefix and "source_files" in data:
            assert name.startswith(prefix)
            name = name[len(prefix):]
        assert ".." not in Path(name).parts
        current = repo / name
        if current.is_file() and sha(current) == expected:
            same += 1
        else:
            different.append(name)
    result = {
        "path": relative(path), "sha256": sha(path),
        **{key: data.get(key) for key in (
            "at", "status", "scope", "counts", "source_unchanged",
            "owned_database_shutdown", "owned_database_port_closed",
        )},
        "raw_report": {"path": relative(raw), "sha256": sha(raw)},
        "currently_matching_source_files": same,
        "currently_different_source_files": different,
        "covers_current_captured_source": not different and same > 0,
        "acceptance_scope": "Only the named tests and exact captured source; not full-product or live-provider acceptance.",
    }
    if data.get("fixture_cleanup"):
        cleanup = repo / data["fixture_cleanup"]["path"]
        assert sha(cleanup) == data["fixture_cleanup"]["sha256"]
        result["fixture_cleanup"] = {**data["fixture_cleanup"], "path": relative(cleanup)}
    return result


def admin_sources():
    files = []
    for folder in ("src", "tests"):
        files.extend(p for p in (ADMIN / folder).rglob("*") if p.is_file())
    for name in ("package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"):
        path = ADMIN / name
        if path.is_file():
            files.append(path)
    return {p.relative_to(ADMIN).as_posix(): sha(p) for p in sorted(set(files))}


def main():
    outputs = [QUALITY / f"remaining-work-current-review-125-v4.{kind}" for kind in ("json", "md")]
    typecheck_log = QUALITY / "remaining-work-review-125-v4-admin-typecheck.log"
    assert not any(p.exists() for p in (*outputs, typecheck_log)), "Preserve executed reviews; choose a new version."
    previous_path = QUALITY / "remaining-work-current-review-125-v3.json"
    previous = read(previous_path)
    rows = copy.deepcopy(previous["requirements"])
    assert [r["id"] for r in rows] == [f"REQ-{n:03}" for n in range(1, 103)]
    required = [r for r in rows if r["requirement_origin"] == "existing_requirement" and not r["optional"]]
    suggestions = [r for r in rows if r["requirement_origin"] == "expanded_design_suggestion"]
    optional = [r for r in rows if r["optional"]]
    assert (len(required), len(suggestions), len(optional)) == (89, 12, 1)
    assert collections.Counter(r["recorded_assessment"] for r in required) == {
        "partial_verified": 77, "completion_not_proven": 12,
    }
    assert all(r["full_acceptance"] == "open" for r in rows)

    backend_runs = [report_at(BACKEND / f".data/publications-125/backend-{n:02}.json", BACKEND,
                              "copypaste-platform/") for n in range(1, 7)]
    full, focused = backend_runs[-2:]
    assert full["counts"] == dict(tests=110, **{"pass": 107}, fail=2, cancelled=1, skipped=0, todo=0)
    assert focused["counts"] == dict(tests=29, **{"pass": 29}, fail=0, cancelled=0, skipped=0, todo=0)
    assert focused["status"] == "passed" and focused["covers_current_captured_source"]
    for item in (full, focused):
        assert all(item[k] for k in ("source_unchanged", "owned_database_shutdown", "owned_database_port_closed"))
        assert item["fixture_cleanup"]["exit_code"] == 0

    clients = {}
    for name, folder, filename, count in (
        ("web", "copypaste-web-publication-125", "web-01", 20),
        ("desktop", "copypaste-desktop-publication-125", "media-01", 21),
    ):
        repo = ROOT / "dev" / folder
        item = report_at(repo / f".data/publications-125/{filename}.json", repo)
        assert item["status"] == "passed" and item["source_unchanged"]
        assert item["counts"]["pass"] == count and item["counts"]["fail"] == 0
        assert item["currently_different_source_files"] == [
            "src/publication-panels.tsx" if name == "web" else "renderer/src/publication-panels.tsx"
        ], "Unexpected source change needs a fresh review of the evidence scope."
        clients[name] = item

    before = admin_sources()
    executed = subprocess.run(
        ["node", str(ADMIN / "node_modules/typescript/bin/tsc"), "--noEmit"],
        cwd=ADMIN, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=300,
    )
    typecheck_log.write_bytes(executed.stdout)
    after = admin_sources()
    admin_check = {
        "command": ["node", "node_modules/typescript/bin/tsc", "--noEmit"],
        "exit_code": executed.returncode, "status": "passed" if executed.returncode == 0 else "failed",
        "source_unchanged": before == after, "source_sha256": before,
        "raw_report": {"path": relative(typecheck_log), "sha256": sha(typecheck_log)},
        "limits": "Type checking only; no new Admin browser, professional workflow or accessibility acceptance.",
    }
    assert before == after, "Source changed during Admin type checking."
    clients["admin"] = admin_check

    notes = {
        "REQ-010": "发布后端06专项29/29通过；Web、Desktop及Admin已有页面代码。各端实际页面、Extension接续、原生Electron及全外部写动作整体验收仍未完成。",
        "REQ-034": "发布意图、未知核对和独立回执在06专项通过；05完整相关回归107通过、2失败、1取消，尚未在修正后重新完成完整相关回归。",
        "REQ-048": "Admin发布管理页面、独立正文/媒体读取和原请求恢复已有代码；06验证相关API的MFA、项目范围、独立正文权限与撤权。页面仅类型检查，不代表实际页面验收；授权CLI和后台完整覆盖仍开放。",
        "REQ-049": "06专项已通过实际JPEG及加密发布回执的原生备份恢复；全生命周期、全部衍生数据及生产恢复验收仍开放。",
        "REQ-074": "发布角色与Skill摘要已修正，06启动及29项专项通过；所有角色组合整体验收未关闭。",
        "REQ-075": "新增四个发布工具仍缺实际Codex调用闭环。05有一项原生分析角色RPC超时失败、一项角色用例超时取消，根因与完整执行资格仍开放。",
    }
    for row in rows:
        row["current_review_note"] = notes.get(row["id"], "")

    progress = [
        ("125-01", "发布后端", "06专项29/29通过；05完整相关回归110项中107通过、2失败、1取消。原生Codex超时根因与修正后完整相关回归仍待处理。", "REQ-010、034、044、074、075"),
        ("125-02", "媒体配额与读取", "06验证衍生JPEG计量、范围读取及Admin独立正文/MFA/撤权；实际跨端媒体、所有存储与权限组合仍待验。", "REQ-002、014、049、050、057、089、102"),
        ("125-03", "未知结果与备份恢复", "06实际JPEG和密封发布回执恢复通过，05夹具目录错误已修正；全部外部写动作、灾难恢复和生产RPO/RTO仍待验。", "REQ-009、034、049、053"),
        ("125-04", "Codex工具和角色", "四个发布工具及版本化Skill已有代码；实际Codex调用、本机接入、角色专业任务与超时处理待完成。", "REQ-043、044、074、075"),
        ("125-05", "Web发布页面", "页面已有代码；旧检查20/20对应旧源码。未知结果关闭表单条件新增修正尚未重新验收；实际页面、响应式、键盘、截图及录制待完成。", "REQ-010、035、055、081、082"),
        ("125-06", "Desktop发布页面", "页面和主进程媒体流已有代码；旧21/21对应旧源码。共享表单修正、实际Electron协议、原生流程及无滚动条视觉验收待完成。", "REQ-010、039、040、041、055、082"),
        ("125-07", "Extension发布流程", "工作分支已建立，但尚未接入本轮发布流程；右侧Side Panel查看/跳转确认、文件到云端及原生浏览器验收待完成。", "REQ-010、036、037、038、041"),
        ("125-08", "Admin发布管理", "管理页面、筛选、策略、正文/媒体分权、未知核对及请求恢复已有代码；本次类型检查按实际退出码记录。实际页面、授权CLI和完整权限矩阵待完成。", "REQ-048、090、092、094"),
        ("125-09", "验证、文档与推送", "新增实际截图/GIF/录制、独立检出、双语组件README、本轮整合及产品源码提交推送待完成；远端组件保持阶段124。", "REQ-054、055、060、081、082"),
    ]
    repos = {}
    for label, folder in (
        ("backend", "copypaste-platform-publication-125"),
        ("web", "copypaste-web-publication-125"),
        ("admin", "copypaste-admin-publication-125"),
        ("desktop", "copypaste-desktop-publication-125"),
        ("extension", "copypaste-extension-publication-125"),
        ("delivery", "copypaste-delivery"),
    ):
        repo = ROOT / "dev" / folder
        repos[label] = {"path": relative(repo), "head": git(repo, "rev-parse", "HEAD"),
                        "status": git(repo, "status", "--short", "--branch")}
    remote = {}
    for line in git(ROOT, "ls-remote", "origin", *[
        f"refs/heads/{name}" for name in ("main", "docs", "backend", "web", "admin", "desktop", "extension", "delivery")
    ]).splitlines():
        commit, ref = line.split()
        remote[ref.removeprefix("refs/heads/")] = commit
    assert len(remote) == 8 and remote["main"] == remote["docs"]
    assert all(repos[name]["head"] == remote[name] for name in repos)
    result = {
        "schema_version": 4, "reviewed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "audit_kind": "existing_acceptance_ledger_reconciled_with_current_source_and_terminal_execution_evidence",
        "previous_review": {"path": relative(previous_path), "sha256": sha(previous_path)},
        "summary": copy.deepcopy(previous["summary"]),
        "required_priorities": copy.deepcopy(previous["required_priorities"]),
        "module_groups": copy.deepcopy(previous["module_groups"]), "requirements": rows,
        "publication_in_progress": [dict(zip(("id", "module", "remaining", "overlapping_requirements"), p)) for p in progress],
        "backend_executions": backend_runs, "latest_full_related_backend_execution": full,
        "latest_focused_backend_execution": focused, "client_checks": clients,
        "current_repositories": repos, "remote_before_this_documentation_update": remote,
        "user_authorized_synthetic_data": True, "new_full_acceptance_closures": 0,
        "verifier_sha256": sha(Path(__file__)),
        "limits": [
            "89 required open acceptance records are not 89 uncoded modules or a code completion percentage.",
            "12 unconfirmed expanded suggestions and one optional item are separate from required scope.",
            "The nine Stage125 work packages overlap original records; do not add them to 102.",
            "Run06 is 29 focused tests, not a replacement for the failed 110-test related full run05.",
            "Earlier Web/Desktop checks retain their exact historical source; changed panels need fresh qualification.",
            "Admin source/type checking does not qualify actual browser workflows or full Admin coverage.",
            "Synthetic provider checks do not establish live supplier or professional customer quality.",
            "Product increment remains uncommitted; documentation publication does not publish product source.",
        ],
    }
    lines = [
        "# 全部未完成项核查 · 阶段125 v4 / All open work review", "",
        "**必需需求89条未完成整体验收：77条部分验证、12条未证完成。另有12条未确认扩展建议和1条可选项；合计102条开放记录。**", "",
        "依据现有需求台账、本次源码状态和执行证据核对。此数字不等于89个模块尚未编码，也不能换算为代码完成百分比；本次没有关闭任何原始整体验收项。", "",
        "| 范围 | 部分验证 | 未证完成 | 未关闭合计 |", "| --- | ---: | ---: | ---: |",
        "| 必需 | 77 | 12 | 89 |", "| 未确认扩展建议 | 9 | 3 | 12 |", "| 可选 | 0 | 1 | 1 |", "| 总计 | 86 | 16 | 102 |", "",
        "| 模块 | 必需未完成 | 扩展建议 | 可选 |", "| --- | ---: | ---: | ---: |",
    ]
    for group in result["module_groups"]:
        lines.append(f"| {group['module_group']} | {group['required_open']} | {group['unconfirmed_suggestions']} | {group['optional_open']} |")
    lines += ["", "后端05已结束：110项中107通过、2失败、1取消。恢复夹具路径已修正；06为新的29项发布专项，全部通过，包含Admin实际字节范围、独立正文/MFA/撤权、原请求查询，以及实际JPEG与密封回执备份恢复。两次执行均确认自建原生数据库停机、端口关闭和夹具回收；06不替代05完整相关回归。", "",
              f"Admin发布页面已有代码，本次类型检查{('通过' if executed.returncode == 0 else '失败')}（退出码{executed.returncode}、源码未变化）。实际页面尚未验收。Web原20项及Desktop原21项通过保留为对应旧源码的历史证据；共享关闭表单已修改，不能标为当前整页通过。", "",
              "以下9个工作包与原需求重叠，不增加102条总数。", "",
              "| 编号 | 模块 | 当前尚需完成 | 对应需求 |", "| --- | --- | --- | --- |"]
    for item in progress:
        lines.append("| " + " | ".join(item) + " |")
    for title, group in (("必需未完成项（89条）", required), ("未确认扩展建议（12条）", suggestions), ("可选项（1条）", optional)):
        lines += ["", f"## {title}", "", "| 编号 | 优先级 | 模块 | 状态 | 尚需完成 |", "| --- | --- | --- | --- | --- |"]
        for row in group:
            detail = row["current_audit_remaining"] + (" " + row["current_review_note"] if row["current_review_note"] else "")
            values = (row["id"], row["priority"], row["module"], row["audit_status"], detail)
            lines.append("| " + " | ".join(str(v).replace("|", "\\|").replace("\n", " ") for v in values) + " |")
    lines += ["", "## 证据与发布范围", "",
              "- v1/v2/v3、已执行检查器、原始报告和失败记录原样保留。", 
              "- 客户允许假数据；开发及演示可继续，真实供应商和专业质量仍单独待验。",
              "- 未调度Docker、WSL或虚拟机。本次未打开浏览器，无新增页面需要关闭。",
              "- 本轮产品源码尚未提交推送，组件分支仍为阶段124；本文档发布不等于产品增量发布。", "",
              "[结构化台账](remaining-work-current-review-125-v4.json) · [上一版v3](remaining-work-current-review-125-v3.md)", ""]
    outputs[0].write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    outputs[1].write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"summary": result["summary"], "focused_backend": focused["counts"],
                      "admin_typecheck": admin_check["status"], "outputs": [relative(p) for p in outputs]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
