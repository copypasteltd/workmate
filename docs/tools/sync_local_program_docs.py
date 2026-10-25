"""Update bounded native-program delivery documents, keeping exact preimages."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

from record_folder_work import ROOT, DEV, DELIVERY, read, digest, ref

BASE = "https://github.com/copypasteltd/workmate/blob/"
ARCHIVE = ROOT / "docs/quality/history/stage88-current-documents"
COMPONENTS = ("platform", "web", "admin", "desktop", "extension", "delivery")


def main():
    output = ROOT / "docs/quality/local-programs-documentation-refresh.json"
    assert not output.exists() and not ARCHIVE.exists()
    checkpoint_file = ROOT / "docs/quality/local-programs-checkpoint.json"
    proof = read(checkpoint_file)
    assert proof["status"] == "verified_native_programs_and_browser_resources"
    records, copies = [], []

    def save(file, text):
        before = file.read_bytes() if file.exists() else None
        archive = None
        if before is not None:
            archive = ARCHIVE / "files" / (file.relative_to(ROOT).as_posix().replace("/", "__") + ".snapshot")
            archive.parent.mkdir(parents=True, exist_ok=True)
            with archive.open("xb") as stream: stream.write(before)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding="utf-8", newline="\n")
        records.append({"path": file.relative_to(ROOT).as_posix(), "archive": archive.relative_to(ROOT).as_posix() if archive else None,
                        "before_sha256": sha256(before).hexdigest() if before is not None else None, "after_sha256": digest(file)})

    checks, clients, server = proof["desktop_ui_checks"], proof["client_unit_tests"], proof["server_checks"]["tests"]
    unit, native = proof["desktop_unit_tests"]["tests"], proof["native_codex_tests"]["tests"]
    summary_zh = (f"阶段 88 当前增量：客户本机批准的固定程序、结构化参数、原生进程树及停止/撤销、父进程退出清理、原费用回执；"
                  f"浏览器普通打开与弹窗统一每任务三页/每执行器两个活动上下文，实际销毁后释放、复用前清除存储；会话等待不锁住其他会话的新建和操作。"
                  f"{checks} 项打包 Desktop、{unit} 项 Desktop 单元、{native} 项原生 Codex、{clients} 项客户端、{server} 项相关后端及 6 项严格声明检查通过。"
                  "模型和部分原生对话框决定为明确假数据；完整产品、至少十二个合格角色及 G01–G10 仍未验收。")
    summary_en = (f"Stage 88 verifies approved pinned customer-local programs, structured argv, owned native process lifecycle/parent loss and original billing; "
                  f"one browser ledger enforces three pages per task/two active contexts with actual destruction and cleared storage on reuse. "
                  f"Fresh scopes: {checks} packaged Desktop checks, {unit} Desktop unit cases, {native} native Codex cases, {clients} client cases, "
                  f"{server} related backend cases and six strict-declaration cases. Synthetic providers/dialog decisions remain explicit. "
                  "Full product acceptance, twelve qualified professional roles and G01–G10 remain open.")
    zh_programs = """## Desktop 本机程序与浏览器

登录并选择企业/项目→建立本机会话→主动授予完整本机权限→打开「本机程式」→选择实际程序并在默认取消的原生窗口确认→返回对话提出工作→查看参数、真实输出、PID/退出码和原任务费用。取消选择或拒绝确认不会批准程序。程序清单固定文件身份和 SHA-256；Agent 只传程序 ID 与参数数组，不临时指定 shell 或环境变量。

停止原任务或撤销程序会结束该任务拥有的原生进程树；撤销某个程序不撤销客户另行授予的完整本机权限。成功、失败、停止及未知结果分别保留，原调用 ID 不重跑。重启后未确认结果保持未知，客户核对后只能允许后续新调用，不能把旧记录改为成功。完整 OS 权限允许客户程序以本机用户权限操作，不宣称额外受目录 OS 沙箱保护；Admin/云端不能代客户批准。

当前 Windows x64 原生 Job Object 监督程序不继承公司推理凭据。每执行器最多两个活动程序，保留最多 100 个批准记录/200 个运行记录，每次至多 64 个参数、120 秒，stdout/stderr 各保留最多 32 KiB 并标记截断。新会话固定程序工具版本，旧会话工具集合保持原样。浏览器普通页面与弹窗共同计入每任务三页、每执行器两个活动上下文；第三个上下文拒绝，不挤掉他人任务，复用前清除 cookie/localStorage。

"""
    en_programs = """## Customer-local programs and browser resources

Sign in and select company/project → create a local session → explicitly grant full local permission → open **Local programs** → choose an actual executable and confirm the native dialog, which defaults to Cancel → request work in Conversation → inspect exact arguments, actual output, PID/exit code and the original task bill. Cancelling or declining grants nothing. Approvals pin file identity and SHA-256; the Agent supplies a program ID and argument array, not a replacement shell/environment.

Stopping the original task or revoking the program ends its owned native process tree. Program revocation leaves the separate customer full-access grant intact. Success, failure, cancellation and unknown outcomes remain distinct; an original call ID never replays. After restart, uncertain records remain unknown. Customer review only permits future calls, never rewrites the old record as success. Approved programs run with the customer's OS-user rights, not an additional workspace OS sandbox; Admin/cloud cannot approve on their behalf.

The Windows x64 native Job Object guardian does not pass company inference credentials to programs. Limits are two active programs per executor, 100 approval/200 run records, at most 64 arguments and 120 seconds per invocation, and 32 KiB retained per stdout/stderr with explicit truncation. New sessions pin the program tool version; legacy tool sets remain unchanged. Normal browser opens and popups share three pages per task/two active contexts per executor. A third context is denied without evicting another task; reuse clears cookies/localStorage.

"""
    program_media = next(row for row in proof["recordings"] if row["name"] == "local-programs")
    chosen = [row for row in proof["screenshots"] if any(name in row["path"] for name in ("programs-1440x980-en", "programs-800x600-en", "programs-800x600-zh", "programs-output-en"))]
    assert len(chosen) == 4
    media = chosen + program_media["files"]
    for row in media:
        source = DEV / row["path"]
        assert digest(source) == row["sha256"]
        target = ROOT / "docs/design/implementation" / ("copypaste-desktop__" + source.name)
        assert not target.exists()
        target.write_bytes(source.read_bytes())
        copies.append({"source": row["path"], "target": target.relative_to(ROOT).as_posix(), "sha256": row["sha256"]})

    for component in ("root",) + COMPONENTS:
        folder = ROOT / "docs" if component == "root" else DEV / ("copypaste-" + component)
        for language in ("zh", "en"):
            file = folder / ("README.md" if language == "zh" else "README.en.md")
            text = file.read_text(encoding="utf-8-sig").replace("<!-- folder-work-stage87 -->", "<!-- local-programs-stage88 -->")
            text = text.replace("批准程序/结构化 argv 和完整崩溃/休眠/离线矩阵仍待补齐。", "本机程序见上节；完整应用操作及崩溃/休眠/离线矩阵仍待补齐。")
            text = text.replace("Complete approved-program/structured-argv and crash/sleep/offline matrices remain open.", "See approved programs above; complete application-operation and crash/sleep/offline matrices remain open.")
            text = text.replace("本阶段实际本机目录截图", "保留阶段 87 实际本机目录截图").replace("Current stage-87 native folder media", "Retained stage-87 native folder media")
            marker = "## Desktop 本机目录工作" if language == "zh" else "## Customer-local folder work"
            assert text.count(marker) == 1
            text = text.replace(marker, (zh_programs if language == "zh" else en_programs) + marker)
            if language == "zh":
                text = re.sub(r"^本阶段新验证：.*$", summary_zh + " 原 57 项实际 Desktop、91 项单元及 17 项原生用例均保留。目录工作仍核对真实新 PID 重启、原线程/固定版本及 90/60 港币微额结算。全部 14 个运行素材/许可证原字节保留，仓库截图/录屏不进入运行 ASAR。", text, flags=re.M)
                text = re.sub(r"^保留阶段 86 的.*$", "保留阶段 86 的平台 1023、核心 25、兼容 36、实际 Web/Admin/原生侧栏 14 项历史结果；本阶段没有重跑完整平台/跨端套件。Web/Admin/Extension 产品源未变化，后端工具声明改动另有当前相关检查。本机进程、文件、账本与数据库实际运行；假模型和对话框决定不证明真实专业质量。自建浏览器、API、预览及测试数据库均关闭，无 Docker/WSL/虚拟化。", text, flags=re.M)
            else:
                text = re.sub(r"^Fresh stage-87 scopes:.*$", summary_en + " All prior 57 Desktop checks, 91 unit and 17 native cases remain. Folder work still checks a real new-PID restart, pinned original thread/versions and separately settled 90/60-micro-HKD tasks. All 14 runtime assets/licenses remain exact and repository recordings stay outside ASAR.", text, flags=re.M)
                text = re.sub(r"^Retained stage-86 scopes:.*$", "Retained historical stage-86 scopes: 1023 platform, 25 focused, 36 compatibility and 14 actual Web/Admin/native Side Panel checks. Complete platform/cross-client suites were not rerun. Web/Admin/Extension product sources are unchanged; changed backend tool declarations have fresh related checks. Native processes/files/ledgers/database are real; synthetic providers/dialog choices do not qualify live professional quality. Owned browsers/API/previews/test DB close; no Docker/WSL/virtualization.", text, flags=re.M)
            text = text.replace("  Local --> Rules[", "  Local --> Programs[Customer-pinned program and structured argv]\n  Programs --> Process[Owned native Job Object and exact receipt]\n  Local --> Rules[")
            plan = "[本机程序方案](" if language == "zh" else "[Local program plan]("
            text += "\n" + plan + BASE + "docs/docs/technical/88-approved-local-programs.md) · [Stage 88 checkpoint](" + BASE + "docs/docs/quality/local-programs-checkpoint.json)\n"
            if component in ("root", "desktop", "delivery"):
                text += "\n" + ("本阶段实际打包程序操作；模型与原生选择/确认决定为明确夹具。" if language == "zh" else "Actual packaged program interaction; model and native chooser/confirmation decisions are explicit fixtures.") + "\n\n"
                for row in media:
                    path = Path(row["path"])
                    if component == "desktop": target = path.as_posix().split("/", 1)[1]
                    elif component == "root": target = "design/implementation/copypaste-desktop__" + path.name
                    else: target = BASE + "desktop/" + path.as_posix().split("/", 1)[1]
                    text += (f"[Original MP4]({target})" if path.suffix == ".mp4" else f"![Actual native program interaction]({target})") + "\n\n"
            save(file, text)

    progress_file = ROOT / "docs/quality/requirements-alignment-progress.json"
    progress = read(progress_file)
    findings = {
        "REQ-040": ("客户本机固定程序批准、精确参数、真实执行/输出/退出码、停止/撤销进程树、父进程退出及未知记录不重放已有本阶段限定证据。", "完整 TC-040 仍开放：全部应用操作、冲突/休眠/离线及 DESK-L01–L08 全矩阵尚未完成。"),
        "REQ-042": ("普通打开与弹窗统一每任务三页/执行器两上下文；实际原生打开、拒绝、拥有者隔离、页面销毁、清除存储后复用已有当前证据。", "完整 TC-042 仍开放：全部进程崩溃、系统休眠及用户既有页面/跨端资源矩阵尚未完成。"),
    }
    for row in progress["requirements"]:
        if row["requirement_id"] in findings:
            finding, remaining = findings[row["requirement_id"]]
            row["finding"], row["remaining_complete_acceptance_conditions"] = finding + remaining, remaining
            row["verified_repairs"].append({"stage": 88, "finding": finding, "checkpoint": "docs/quality/local-programs-checkpoint.json"})
            row["acceptance_evidence"].append({**ref(checkpoint_file), "scope": "bounded native programs/resources; complete case remains open"})
    assert dict(Counter(row["assessment"] for row in progress["requirements"])) == {"partial_verified": 86, "completion_not_proven": 16}
    progress["at"] = datetime.now(timezone.utc).isoformat()
    progress["local_programs_verification"] = {"checkpoint": ref(checkpoint_file), "desktop_checks": checks, "desktop_unit_tests": unit,
        "native_codex_tests": native, "client_unit_tests": clients, "related_backend_tests": server, "entire_product_acceptance": "not_proven"}
    save(progress_file, json.dumps(progress, ensure_ascii=False, indent=2) + "\n")

    for relative in ["docs/00-document-map.md", "docs/DELIVERY.md", "docs/requirements/03-client-execution-amendment.md", "docs/product/01-prd.md",
                     "docs/product/02-user-journeys.md", "docs/product/03-information-architecture-and-interactions.md", "docs/product/06-role-templates-and-skill-presets.md",
                     "docs/product/08-admin-dashboard.md", "docs/modules/00-catalog.md", "docs/technical/01-architecture-and-stack.md",
                     "docs/quality/01-test-and-acceptance-plan.md", "docs/quality/02-requirements-traceability.md", "docs/quality/04-implementation-acceptance.md",
                     "docs/governance/04-git-branches-and-publication.md"]:
        file = ROOT / relative
        assert file.is_file(), relative
        text = file.read_text(encoding="utf-8-sig")
        text = text.replace("**阶段 87 当前增量：**", "**阶段 87 历史范围：**", 1)
        title, separator, body = text.partition("\n")
        prefix = "\n\n" + summary_zh + " 见[方案及边界](" + ("technical/" if file.parent == ROOT / "docs" else "../technical/") + "88-approved-local-programs.md)。当前源码和已发布版本分别以本阶段检查点、最终提交及远程回执为准；下文保留历史阶段原范围。\n"
        save(file, title + prefix + separator + body)

    for relative in ("docs/quality/2026-10-25-goal-gap-summary.md", "docs/quality/2026-10-25-goal-gap-assessment.md"):
        file = ROOT / relative
        text = file.read_text(encoding="utf-8-sig")
        replacements = {
            "批准程序与结构化参数、完整应用操作、离线及异常恢复仍待补齐": "固定批准程序与结构化参数已有本阶段限定验证；完整应用操作、离线及全部异常恢复仍待补齐",
            "浏览器页数口径需对齐；设计负载压测、媒体隔离和实际备份恢复未完成": "本机三页/两上下文及弹窗统一限制已有实际验证；完整负载、媒体隔离和实际备份恢复未完成",
            "本阶段当前源码通过 57 项实际打包 Desktop 检查、91 项 Desktop 单元、161 项客户端单元，绑定 1,530 个源码文件。": "阶段 87 历史范围通过 57 项实际打包 Desktop 检查、91 项 Desktop 单元、161 项客户端单元，绑定当时 1,530 个源码文件。",
            "| 当前 Desktop 增量 / 实际打包流程 |": "| 阶段 87 历史 Desktop 增量 / 实际打包流程 |",
            "评估更新：阶段 87，": "阶段 87 历史评估更新：",
            "当前以本节阶段 87 为准": "该历史时间以阶段 87 为准，最新判断见顶部阶段 88",
            "完整检查点、离线续做、结构化 argv 允许程序、全角色工具和应用操作仍不齐": "结构化 argv 的固定批准程序已取得阶段 88 限定证据；完整检查点、离线续做、全角色工具和应用操作仍不齐",
            "本机浏览器每驱动 4 页的硬上限与文档每任务默认 3 页未对齐，池内 8 页也不等于上下文配额": "阶段 88 已实测统一每任务三页/执行器两个上下文、弹窗共享配额及清除存储后复用；完整异常资源矩阵继续开放",
        }
        for old, new in replacements.items(): text = text.replace(old, new)
        title, separator, body = text.partition("\n")
        extra = ("\n\n评估更新：阶段 88。" + summary_zh + " 当前源码绑定 " + str(len(proof["source_files"])) + " 项。"
                 "批准程序/结构化 argv 与本机浏览器配额已从待实现更新为限定范围实测；完整应用矩阵、专业角色及其余业务不因此关闭。"
                 "失败打包尝试 70/71 保持 failed，分别暴露紧凑提问区和全局等待锁定；修复后重新验证，不用单元通过覆盖失败。当前通过证据见[本阶段检查点](local-programs-checkpoint.json)。"
                 "原 102 项条件、26 组差异、86 部分/16 未证明完整/0 完整验收均保留。\n")
        save(file, title + extra + separator + body)

    technical = ROOT / "docs/technical/88-approved-local-programs.md"
    text = technical.read_text(encoding="utf-8-sig").replace("状态：开发中，尚无本阶段通过或发布结论。", "状态：本阶段原生程序与浏览器资源取得限定通过证据；发布状态以最终提交及远程回执为准。")
    text += "\n" + summary_zh + "\n\n" + summary_en + "\n\n[当前精确源码与原始回执](../quality/local-programs-checkpoint.json)\n"
    save(technical, text)
    change = ROOT / "docs/changes/2026-10-25-local-programs.md"
    save(change, "# 本机程序与浏览器资源更新 / Local programs and browser resources\n\n" + summary_zh + "\n\n" + summary_en
         + "\n\n客户完整本机权限不缩减为文件桥或逐命令重新审批。程序批准由本机客户作出，未知记录不重放。旧线程工具集合、103 个历史 SQL、532 个历史契约和 102 项完整验收条件保留。\n\n"
         + "失败 70/71 保留 failed，分别修复紧凑提问布局和会话操作的全局等待锁定。任务等待现在只限制所属会话，并绑定各自错误及新建回复的企业/项目范围。后端 41 的 91 项测试通过，但旧汇总要求过时的 17 角色名称，故原报告仍保留 failed；新验证器保留所有场景并按完整 18 角色重新验证。本阶段通过报告与未变化产品的历史范围明确分开。当前代码、双语 README、实际截图/GIF/MP4 和更新说明在各独立分支同步。\n\n"
         + "[方案](../technical/88-approved-local-programs.md) · [检查点](../quality/local-programs-checkpoint.json) · [完整差异](../quality/2026-10-25-goal-gap-summary.md)\n")
    result = {"at": datetime.now(timezone.utc).isoformat(), "checkpoint": ref(checkpoint_file), "readmes": 14,
              "files": records, "media_copies": copies, "original_complete_acceptance": "not_proven", "verifier_sha256": digest(Path(__file__))}
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    (ARCHIVE / "receipt.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": "updated", "readmes": 14, "documents": len(records), "media_copies": len(copies)}))


if __name__ == "__main__": main()
