"""Qualify the bounded rc.3 patch and prepare its bilingual handoff."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import os
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
VERSION = "v0.1.0-rc.3"
COMPONENTS = {"backend": "platform", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}


def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def create(p, text):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("x", encoding="utf-8", newline="\n") as f:
        f.write(text)


def git(repo, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args], cwd=repo).decode().strip()


def main():
    prior = json.loads((ROOT / "docs/quality/admin-overview-checkpoint-160.json").read_bytes())
    receipts = []
    for p in (DELIVERY / ".data/admin-overview-160").glob("git-sync-*/receipt.json"):
        r = json.loads(p.read_bytes())
        if r["status"] == "published":
            receipts.append((p, r))
    assert len(receipts) == 1
    receipt_path, published = receipts[0]
    baseline = {**prior["baseline"], "heads": {("platform" if b == "backend" else b): r["commit"] for b, r in published["components"].items()}, "remote_refs": published["verified_refs"]}
    for b, c in COMPONENTS.items():
        assert git(DEV / ("copypaste-" + c), "rev-parse", "HEAD") == baseline["heads"][c]
    assert git(ROOT, "rev-parse", "HEAD") == baseline["heads"]["docs"]
    for p, h in prior["qualified_sources"].items():
        assert digest(DEV / p) == h, p
    assert prior["backend_cases"] == 9 and prior["actual_admin_journeys"] == 3
    frozen = DELIVERY / "release/workmate-v0.1.0-rc.2"
    manifest = json.loads((frozen / "release-manifest.json").read_bytes())
    reuse = {}
    for component, suffix in [("desktop", "windows-x64-unsigned"), ("web", "web"), ("extension", "extension")]:
        old = next(c for c in manifest["components"] if c["branch"] == component)
        changed = git(DEV / ("copypaste-" + component), "diff", "--name-only", old["commit"], "HEAD").splitlines()
        assert all(p in ["README.md", "README.en.md"] or p.startswith("assets/screenshots/") for p in changed), component + " runtime changed"
        artifact = next(a for a in manifest["artifacts"] if a["file"].endswith("-" + suffix + ".zip"))
        assert digest(frozen / artifact["file"]) == artifact["sha256"]
        reuse[component] = {"artifact": artifact, "prior_component_commit": old["commit"], "current_component_commit": baseline["heads"][component], "changes_since_prior_build": changed, "basis": "Only bilingual README and screenshot files changed; production source and build inputs are identical."}
    sources = {}
    paths = ["src", "scripts", "catalog", "skills", "contracts", "migrations", "public", "renderer/src", "renderer/tsconfig.json", "assets/fonts", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html"]
    for c in COMPONENTS.values():
        repo = DEV / ("copypaste-" + c)
        for p in git(repo, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", *paths).split("\0"):
            if p:
                sources["copypaste-" + c + "/" + p] = digest(repo / p)
    node = shutil.which("node")
    assert node
    npm = Path(node).parent / "node_modules/npm/bin/npm-cli.js"
    assert npm.is_file()
    evidence = DELIVERY / "evidence/release-freeze-161"
    evidence.mkdir(parents=True, exist_ok=True)
    commands = []
    log_path = evidence / "build-01.log"
    with log_path.open("xb") as log:
        for c in ["platform", "admin"]:
            argv = [node, str(npm), "run", "build"]
            proc = subprocess.run(argv, cwd=DEV / ("copypaste-" + c), env=os.environ.copy(), stdout=log, stderr=subprocess.STDOUT)
            commands.append({"component": c, "command": "npm run build", "exit_code": proc.returncode})
            print(json.dumps(commands[-1]), flush=True)
            assert proc.returncode == 0, c + " build failed; original log retained"
    for p, h in sources.items():
        assert digest(DEV / p) == h, p
    assert (DEV / "copypaste-platform/dist/src/admin-overview.js").is_file()
    builds = {}
    for c in ["platform", "admin"]:
        directory = DEV / ("copypaste-" + c) / "dist"
        builds[c] = {p.relative_to(directory).as_posix(): digest(p) for p in sorted(directory.rglob("*")) if p.is_file()}
        assert builds[c]
    report = {"stage": 161, "at": datetime.now(timezone.utc).isoformat(), "status": "qualified", "release": VERSION, "schema_version": 155, "ai_mode": "authorized_synthetic", "baseline": baseline, "baseline_publication": {"path": receipt_path.relative_to(ROOT).as_posix(), "sha256": digest(receipt_path)}, "qualified_sources": sources, "builds": builds, "build_commands": commands, "build_log": {"path": log_path.relative_to(ROOT).as_posix(), "sha256": digest(log_path)}, "reused_artifacts": reuse, "focused_admin_qualification": {"path": "docs/quality/admin-overview-checkpoint-160.json", "sha256": digest(ROOT / "docs/quality/admin-overview-checkpoint-160.json"), "sql_http_cases": 9, "browser_journeys": 3}, "inherited_first_run_qualification": {"path": "docs/quality/release-freeze-checkpoint-158.json", "sha256": digest(ROOT / "docs/quality/release-freeze-checkpoint-158.json"), "scope": "Prior six builds, source OTP-to-Codex-task/private-download journey and packaged Windows menu/overflow smoke; retained under their original scope, not rerun."}, "mandatory_full_acceptance_open": 88, "scope": "Frozen synthetic candidate with the current Admin correction. Backend and Admin rebuilt; identical Desktop/Web/Extension runtime artifacts reused after source-diff and digest checks. Nine focused SQL/HTTP cases and three actual Admin journeys retained. No broad historical, live-provider, signing or cross-OS acceptance claim.", "preparer_sha256": digest(Path(__file__))}
    create(ROOT / "docs/quality/release-freeze-checkpoint-161.json", json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    create(ROOT / "docs/quality/release-freeze-checkpoint-161.md", "# rc.3 定向冻结核对 / Focused freeze qualification\n\n后端和Admin重新构建通过；9项实际SQL/HTTP、3组Admin操作来自阶段160的精确源码核对。Desktop/Web/Extension从rc.2到当前仅README/媒体变更，沿用相同原始构建包。所有来源、构建输出和归档摘要绑定JSON清单。\n\nBackend/Admin rebuilds pass. Unchanged clients reuse the original qualified bytes after a complete Git diff of their source trees. Broad historical regression is deliberately omitted. External providers remain synthetic; Windows signing and cross-platform production acceptance remain open.\n")
    guide = (ROOT / "docs/releases/v0.1.0-rc.2.md").read_text(encoding="utf-8")
    guide = guide.replace("v0.1.0-rc.2", VERSION).replace("workmate-source-158-04", "workmate-" + VERSION + "-source").replace("dev/rc2/", "dev/rc3/")
    guide = guide[:guide.index("GitHub网页及附件发布渠道当前返回403")]
    intro = "本补丁版纳入管理总览的权限、个人预留及云端资源扣费修复；后端/Admin重新构建，未变的Desktop/Web/Extension复用已核对的rc.2构建字节。两版既有冻结包和标签保持。\n\nThis patch includes the Admin permission/counting correction, personal reservations and cloud-resource charges. Backend/Admin are rebuilt. Unchanged client binaries retain their qualified rc.2 bytes. Previous frozen tags and packages are preserved.\n\n"
    guide = guide.replace("本次将当前六个独立仓库与数据库155版统一冻结。", intro + "本次将当前六个独立仓库与数据库155版统一冻结。", 1)
    guide = guide.replace("[原编号范围](../quality/remaining-work-stage158.md)", "[原编号范围](../quality/remaining-work-stage160.md)")
    guide += "GitHub发布入口：[Workmate " + VERSION + "](https://github.com/copypasteltd/workmate/releases/tag/" + VERSION + ")。完整ZIP、校验文件和索引在资产上传、摘要核对成功后对外交付；以实际发布回执为准。\n\nThe GitHub release assets are delivered only after successful uploads and digest verification. See the final publication receipt for actual status.\n\n## 本次补丁 / This patch\n\n9项费用/权限SQL和HTTP检查、3组实际Admin操作通过；额外完成本次后端/Admin构建。此前完整首用和Windows启动结果保持原范围，不重复计作本次新验收。\n\nNine focused accounting/authority cases and three actual Admin journeys pass. This freeze rebuilds Backend/Admin; earlier first-run and native-client checks retain their original scope.\n\n![当前Admin / Current Admin](../assets/admin-overview-160/workmate-admin-overview-160-01-confirmed-charges-personal-hold.png)\n\n![实际权限变更 / Actual permission change](../assets/admin-overview-160/workmate-admin-overview-160-01-current-permission-overview.gif)\n\n[当前冻结依据 / Current freeze evidence](../quality/release-freeze-checkpoint-161.json) · [权限和费用修复 / Admin correction](../development/160-admin-overview-accuracy.md)\n"
    create(ROOT / "docs/releases" / (VERSION + ".md"), guide)
    create(ROOT / "docs/development/161-frozen-patch-release.md", "# rc.3 冻结方案 / Frozen patch release\n\n本次收口到授权假数据候选版。仅后端/Admin有运行代码变化，因此重建两者；用完整Git差异约束其余三客户端只能有README/媒体变化，再核对rc.2包SHA并复用。六仓源码采用新冻结提交，ZIP排除Git元数据、本机密钥、数据库和依赖，保留运行源码、锁文件、双语说明和引用媒体。主文档只选择Git已跟踪的允许路径，保护用户未提交文件。固定Codex四个文件重新按新源码根目录封装。\n\nAtomic publication creates seven new annotated tags and updates eight branches without force. The complete distribution contains seven archives, current source/content indexes and SHA256SUMS. The GitHub uploader streams exact bytes, reconciles a lost response using durable asset digests, then publishes the draft only after all six public assets match. Previous releases are preserved.\n\n[使用 / Usage](../releases/v0.1.0-rc.3.md) · [构建与复用依据 / Build and reuse](../quality/release-freeze-checkpoint-161.json) · [剩余原编号 / Original remaining scopes](../quality/remaining-work-stage160.md)\n")
    create(ROOT / "docs/changes/161-frozen-patch-release.md", "# rc.3 完整冻结补丁 / Complete frozen patch\n\n纳入Admin现行权限、人数、个人预留和云端资源确认扣费修复，连同全部客户端、六仓源码和固定Codex统一发版。按加速要求只重新构建改动的后端/Admin；复用完整源码差异和SHA核对一致的客户端构建。\n\nShips the current Admin correction with all clients, six buildable source trees and the pinned Codex companion. Only changed Backend/Admin are rebuilt. Existing client binaries are reused after source-diff and digest checks. External dependencies remain synthetic; unsigned Windows and full production acceptance remain tracked.\n")
    url = "https://github.com/copypasteltd/workmate/blob/" + VERSION + "/docs/releases/" + VERSION + ".md"
    image = "assets/screenshots/workmate-admin-overview-160-01-confirmed-charges-personal-hold.png"
    gif = "assets/screenshots/workmate-admin-overview-160-01-current-permission-overview.gif"
    cn = f"## {VERSION} · 完整冻结交付\n\n本版纳入下方160修复。Desktop、Web、Admin、原生Chrome右侧栏、后端、六仓可构建源码及固定Codex配套文件统一封装；[完整使用说明]({url})。[下载入口](https://github.com/copypasteltd/workmate/releases/tag/{VERSION})的资产以发布回执为准。外部接口使用获准假数据，Windows包未签名；完整生产验收继续独立跟踪。\n\n![实际Admin费用与权限]({image})\n\n![实际交互，沿用160原始录制]({gif})\n\n---\n\n"
    en = f"## {VERSION} · Complete frozen handoff\n\nIncludes the stage160 correction below. Desktop, Web, Admin, native Chrome Side Panel, Backend, six buildable source trees and the pinned Codex companion ship together. [Full usage guide]({url}) · [Release assets](https://github.com/copypasteltd/workmate/releases/tag/{VERSION}); actual publication is recorded in its receipt. External providers use authorized synthetic data and Windows remains unsigned. Whole production acceptance is separately tracked.\n\n![Actual Admin overview]({image})\n\n![Actual stage160 interaction, original recording]({gif})\n\n---\n\n"
    for c in COMPONENTS.values():
        for name, header in [("README.md", cn), ("README.en.md", en)]:
            p = DEV / ("copypaste-" + c) / name
            p.write_text(header + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    header = f"## {VERSION} · 完整冻结交付 / Frozen handoff\n\n[使用与七类分发包 / Usage](releases/{VERSION}.md) · [构建/复用核对 / Qualification](quality/release-freeze-checkpoint-161.json) · [方案 / Design](development/161-frozen-patch-release.md) · [完整原编号待验收](quality/remaining-work-stage160.md)\n\n包含160后台修复；外部依赖为获准假数据、Windows未签名，生产验收范围继续跟踪。Includes the Admin patch; synthetic candidate, unsigned Windows, separately tracked production acceptance.\n\n---\n\n"
    for name in ["README.md", "README.en.md"]:
        p = ROOT / "docs" / name
        p.write_text(header + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    print(json.dumps({"status": "qualified", "release": VERSION, "builds": len(commands), "reused_clients": len(reuse), "qualified_sources": len(sources)}), flush=True)


if __name__ == "__main__":
    main()
