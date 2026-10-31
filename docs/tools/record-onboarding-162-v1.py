"""Record the real, focused source-onboarding qualification and delivery notes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import copy
import json

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / "dev/copypaste-delivery"


def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4194304), b""):
            h.update(b)
    return h.hexdigest()


def create(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("x", encoding="utf-8", newline="\n") as f:
        f.write(value)


def put(p, value):
    create(p, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    q = json.loads((DELIVERY / "evidence/onboarding-162/qualification-01.json").read_bytes())
    assert q["status"] == "passed" and len(q["checks"]) == 9 and q["error"] is None
    assert digest(DELIVERY / q["private_log"]) == q["private_log_sha256"]
    bound = {"dev/" + p: h for p, h in q["source_files"].items()}
    for p, h in bound.items():
        assert digest(ROOT / p) == h, p
    package = DELIVERY / "release/onboarding-162-attempt-01"
    manifest = json.loads((package / "patch-manifest.json").read_bytes())
    assert digest(package / "patch-manifest.json") == q["patch_manifest_sha256"]
    assert digest(package / manifest["patch_file"]) == manifest["patch_sha256"]
    assert digest(package / "apply-onboarding-patch-162.mjs") == manifest["applier_sha256"]
    for row in manifest["files"]:
        if row["path"] != "START-HERE.md":
            assert digest(ROOT / row["path"]) == row["after_sha256"]
    artifacts = {}
    for name in ["workmate-v0.1.0-rc.3-onboarding-162.zip", "workmate-v0.1.0-rc.3-onboarding-162.zip.sha256", "patch-manifest.json"]:
        p = package / name
        artifacts[name] = {"path": p.relative_to(ROOT).as_posix(), "bytes": p.stat().st_size, "sha256": digest(p)}
    for p in ["docs/releases/v0.1.0-rc.3-onboarding-162.md", "docs/tools/package-onboarding-162-v1.py", "docs/tools/record-onboarding-162-v1.py", "docs/tools/publish-onboarding-162-v1.py", "docs/tools/finalize-onboarding-162-v1.py", "dev/copypaste-delivery/scripts/publish-onboarding-162-v1.py"]:
        bound[p] = digest(ROOT / p)
    baseline = json.loads((DELIVERY / ".data/onboarding-162/baseline.json").read_bytes())
    for p, h in {**baseline["preserved_user_files"], **baseline["frozen_files"]}.items():
        assert digest(ROOT / p) == h, p
    assert digest(ROOT / "dev/copypaste-platform/.env") == baseline["platform_environment_sha256"]
    now = datetime.now(timezone.utc).isoformat()
    report = {"stage": 162, "at": now, "status": "qualified", "baseline": baseline, "qualification": q, "qualified_sources": bound, "artifacts": artifacts, "patch_manifest": manifest, "new_full_acceptance_closures": 0, "mandatory_full_acceptance_open": 88, "scope": "Small source-only onboarding addon after the published rc.3. No new native-client, model/provider or professional full acceptance. Broad repeat tests omitted as requested. Original media reused with attribution."}
    put(ROOT / "docs/quality/onboarding-checkpoint-162.json", report)
    create(ROOT / "docs/quality/onboarding-checkpoint-162.md", "# 162 · 源码启动补丁 / Source onboarding\n\n9项实际补丁与CLI检查通过：精确应用、重复应用、客户修改拒绝、路径边界、补丁摘要、空闲端口释放、占用拒绝与保留原进程、安装前拒绝、相对链接。检查仅使用自有合成文件和本机回环监听；没有数据库、模型、浏览器或广泛回归。\n\nThe six-file source patch is 718857 bytes. Frozen distributions/tags remain intact. All original 102 requirement IDs are retained; 88 mandatory whole acceptance scopes remain open, rather than 88 unimplemented modules.\n\n[机器证据 / Evidence](onboarding-checkpoint-162.json) · [使用 / Guide](../releases/v0.1.0-rc.3-onboarding-162.md)\n")
    prior = ROOT / "docs/quality/remaining-work-stage160.json"
    ledger = copy.deepcopy(json.loads(prior.read_bytes()))
    ledger["schema_version"] += 1
    ledger.update(reviewed_at=now, current_stage=162, previous_review={"path": prior.relative_to(ROOT).as_posix(), "sha256": digest(prior)}, checkpoint="docs/quality/onboarding-checkpoint-162.json", new_full_acceptance_closures=0,
                  current_increment={"stage": 162, "scope": "Published frozen rc.3 plus a qualified source onboarding addon", "broad_regression": "deliberately_omitted_by_user", "full_acceptance_closed": False, "release": "v0.1.0-rc.3 and optional source addon"})
    assert len(ledger["requirements"]) == 102 and ledger["summary"]["required_open"] == 88
    for row in ledger["requirements"]:
        if row["id"] in ["REQ-003", "REQ-042", "REQ-054", "REQ-060"]:
            row["current_review_note"] += " 162：rc.3完整包已发布；新增精确源码补丁、提前端口检查及有效入门链接，9项定向检查通过。原完整范围保留。"
    put(ROOT / "docs/quality/remaining-work-stage162.json", ledger)
    lines = ["# 162 · 原编号完整验收 / Original full acceptance", "", "102个原始编号保持；88项必选完整验收仍开放，不代表88个未实现模块。当前为获准假数据候选版，真实提供方、签名及专业全量验收独立跟踪。", "", "| 编号 | 模块 | 状态 | 完整范围待项 |", "| --- | --- | --- | --- |"]
    for row in ledger["requirements"]:
        values = [row["id"], row["module"], row.get("audit_status", row["full_acceptance"]), row.get("current_audit_remaining", row["remaining"])]
        lines.append("| " + " | ".join(str(v).replace("|", "\\|").replace("\n", " ") for v in values) + " |")
    create(ROOT / "docs/quality/remaining-work-stage162.md", "\n".join(lines) + "\n")
    create(ROOT / "docs/development/162-source-onboarding.md", "# 162 · 提前检查并保留冻结包 / Early checks and frozen delivery\n\n源码启动的布局和配置检查之后、固定运行时准备和依赖安装之前，依次独占探测127.0.0.1的4310/4317/4318/4319及所选数据库端口，每次立即关闭自己的监听。占用时保留其他应用并提前退出；可用性是此刻观察，真正启动仍保留原有检查。\n\nThe built-in Node preflight runs before dependency installation. The exact six-file addon validates original hashes and links, uses owned bare Git metadata with raw LF bytes, refuses customer source conflicts, and is idempotent. Existing configuration, data and runtime binaries are not destinations. Cloud operator Codex settings stay independent; the demo explicitly selects its supplied pinned runtime.\n\n```mermaid\nflowchart LR\n A[Exact source patch] --> B[Choose database port]\n B --> C[Layout and port preflight]\n C --> D[Bootstrap and start]\n D --> E[Email login and workspace]\n E --> F[Role task and delivery]\n F --> G[Stop owned services]\n```\n\n[中英完整步骤 / Bilingual instructions](../releases/v0.1.0-rc.3-onboarding-162.md) · [9项实际检查](../quality/onboarding-checkpoint-162.json) · [原编号待项](../quality/remaining-work-stage162.md)\n")
    create(ROOT / "docs/changes/162-source-onboarding.md", "# 162 · 源码首次启动补丁 / Source onboarding addon\n\n修复冻结源码根目录入门链接；依赖安装前检查应用和数据库端口。提供约719KB的六文件精确补丁，保留配置/数据及原冻结包，9项定向检查通过。六仓同步中英README和原有实际首单媒体链接；跳过无关全量复测。\n\nFixes source-root guide links and detects occupied ports before installation. A six-file exact patch is qualified by nine focused checks; current source branches include the code directly. Frozen distributions and tags remain unchanged.\n")
    link = "https://github.com/copypasteltd/workmate/blob/docs/docs/releases/v0.1.0-rc.3-onboarding-162.md"
    download = "https://github.com/copypasteltd/workmate/releases/download/v0.1.0-rc.3/workmate-v0.1.0-rc.3-onboarding-162.zip"
    image = "workmate-source-handoff-158-04-first-task-delivered.png"
    gif = "workmate-source-handoff-158-04-first-source-task.gif"
    cn = f"## 162 · 冻结版源码启动补丁\n\n完整rc.3已发布。本轮新增安装前端口检查及有效入门链接；当前分支直接使用，已解压rc.3源码可应用约719KB的精确补丁。先选择数据库端口，再依次运行 `npm run demo:preflight`、`npm run bootstrap:demo`、`npm run demo:check`、`npm run demo`；结束执行 `npm run stop`。六文件补丁及CLI的9项检查通过；保留客户配置、数据和冻结包。\n\n[完整中英步骤]({link}) · [源码补丁]({download})\n\n下图及GIF沿用158实际首单流程，非本轮新增各原生端验收。\n\n![原有实际首单](assets/screenshots/{image})\n\n![原有实际交互](assets/screenshots/{gif})\n\n---\n\n"
    en = f"## 162 · Frozen source onboarding addon\n\nThe complete rc.3 is published. Early startup-port checks and corrected guide links are available on the current branches; extracted rc.3 sources can use the approximately719KB exact patch. Choose the database port first, then run `npm run demo:preflight`, `npm run bootstrap:demo`, `npm run demo:check` and `npm run demo`; finish with `npm run stop`. Nine focused patch/CLI checks pass. Local configuration/data and frozen distributions stay intact.\n\n[Bilingual steps]({link}) · [Source addon]({download})\n\nThe following original stage158 first-task media is reused with its original scope; it is not new installed-client acceptance.\n\n![Original real first task](assets/screenshots/{image})\n\n![Original real interaction](assets/screenshots/{gif})\n\n---\n\n"
    for component in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
        repo = ROOT / "dev" / ("copypaste-" + component)
        for name in [image, gif]:
            assert digest(repo / "assets/screenshots" / name) == digest(ROOT / "docs/assets/release-freeze-158" / name)
        for name, prefix in [("README.md", cn), ("README.en.md", en)]:
            p = repo / name
            assert not p.read_text(encoding="utf-8").startswith("## 162")
            p.write_text(prefix + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    header = "## 162 · 源码启动补丁 / Source onboarding addon\n\n[完整发版](releases/v0.1.0-rc.3.md) · [补丁和使用步骤 / Guide](releases/v0.1.0-rc.3-onboarding-162.md) · [实际检查](quality/onboarding-checkpoint-162.json) · [原编号待项](quality/remaining-work-stage162.md)\n\n完整rc.3已发布；小补丁待本轮同步，原冻结包保持。The complete release is published; the source addon is being synchronized.\n\n---\n\n"
    for name in ["README.md", "README.en.md"]:
        p = ROOT / "docs" / name
        p.write_text(header + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    print(json.dumps({"status": "recorded", "checks": 9, "source_patch_bytes": 718857, "original_requirements": 102, "required_full_scopes_open": 88}))


if __name__ == "__main__":
    main()
