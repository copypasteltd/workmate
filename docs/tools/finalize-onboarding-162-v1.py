"""Record actual publication and push the final documentation receipt only."""
from pathlib import Path
from hashlib import sha256, sha1
from datetime import datetime, timezone
import json
import os
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / "dev/copypaste-delivery"


def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4194304), b""):
            h.update(b)
    return h.hexdigest()


def main():
    assert len(sys.argv) == 3, "Supply the actual Git-sync and addon-publication receipts"
    receipt_paths = [Path(p).resolve(strict=True) for p in sys.argv[1:]]
    assert all(p.is_relative_to(DELIVERY / ".data/onboarding-162") for p in receipt_paths)
    sync, github = [json.loads(p.read_bytes()) for p in receipt_paths]
    assert sync["status"] == github["status"] == "published"
    assert len(sync["verified_refs"]) == 50 and len(github["assets"]) == 3
    assert sync["all_frozen_tags_unchanged"] and github["original_six_assets_unchanged"] and github["addon_asset_digests_match"] and github["frozen_complete_zip_unchanged"]
    checkpoint_path = ROOT / "docs/quality/onboarding-checkpoint-162.json"
    checkpoint = json.loads(checkpoint_path.read_bytes())
    for p, h in checkpoint["qualified_sources"].items():
        assert digest(ROOT / p) == h, p
    out = DELIVERY / ".data/onboarding-162" / ("handoff-" + str(uuid.uuid4()))
    out.mkdir(parents=True)
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "running", "error": None}
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}
    with (out / "commands.log").open("xb") as log:
        def git(*args):
            argv = ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "gc.auto=0", "-c", "gc.autoPackLimit=0", "-C", str(ROOT), *args]
            log.write((json.dumps(args) + "\n").encode())
            log.flush()
            p = subprocess.run(argv, cwd=ROOT, env=env, capture_output=True)
            log.write(p.stdout + p.stderr + b"\n")
            log.flush()
            assert p.returncode == 0, "Git failed; original log preserved"
            return p.stdout

        def refs():
            return {s.split()[1]: s.split()[0] for s in git("ls-remote", "origin", *["refs/heads/" + b for b in ["backend", "web", "admin", "desktop", "extension", "delivery", "docs", "main"]], "refs/tags/v0.1.0-rc.1*", "refs/tags/v0.1.0-rc.2*", "refs/tags/v0.1.0-rc.3*").decode().splitlines()}

        try:
            assert refs() == sync["verified_refs"], "Remote advanced; preserve it"
            assert git("diff", "--cached", "--name-only").strip() == b""
            baseline = checkpoint["baseline"]
            for p, h in baseline["preserved_user_files"].items():
                assert digest(ROOT / p) == h
            report = {"stage": 162, "at": result["at"], "status": "published", "release": "v0.1.0-rc.3", "release_url": github["release_url"], "git": sync, "github": github, "qualification": checkpoint["qualification"], "artifacts": checkpoint["artifacts"], "source_checkpoint_sha256": digest(checkpoint_path), "receipt_sources": [{"path": p.relative_to(ROOT).as_posix(), "sha256": digest(p)} for p in receipt_paths], "new_full_acceptance_closures": 0, "mandatory_full_acceptance_open": 88, "scope": "The complete frozen release remains unchanged. This publishes only a small exact-source onboarding addon. API asset SHA256 verified; no new browser download, provider/model or installed-client qualification. Original network failures and full acceptance scopes remain recorded."}
            files = ["docs/quality/onboarding-publication-162.json", "docs/releases/v0.1.0-rc.3-onboarding-162-publication.md", "docs/README.md", "docs/README.en.md"]
            with (ROOT / files[0]).open("x", encoding="utf-8", newline="\n") as f:
                f.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            download = github["assets"][0]["browser_download_url"]
            text = f"# rc.3 源码启动补丁已发布 / Source addon published\n\n[完整冻结版](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0-rc.3) · [718857字节补丁 / Addon]({download}) · [中英使用步骤](v0.1.0-rc.3-onboarding-162.md) · [发布回执](../quality/onboarding-publication-162.json)\n\n9项实际补丁/CLI检查通过，八个分支与42条标签引用核对；三个新增附件的线上摘要匹配，原六附件保持。原始冻结包未替换；本轮没有重新执行浏览器下载，先前网络失败仍记录。\n\nNine actual focused checks pass. Eight branches and42 tag references were read back; all three addon asset digests match. The original six assets remain intact. This is an authorized synthetic-data release candidate; Windows distributions remain unsigned. Real providers and original whole acceptance remain tracked.\n\n| 编号 | 本轮结果 / Result |\n| --- | --- |\n| 1 | 安装前检查端口 / Early port preflight |\n| 2 | 有效根目录文档与六文件精确补丁 / Correct guide and exact source patch |\n| 3 | 9项定向检查、六仓双语README与发布 / Nine checks, bilingual six-repository docs and publication |\n| 4 | 待项：真实提供方、Windows签名及原编号完整验收 / Open: real providers, signing and original full acceptance |\n\n[完整原编号待项](../quality/remaining-work-stage162.md)\n"
            with (ROOT / files[1]).open("x", encoding="utf-8", newline="\n") as f:
                f.write(text)
            header = f"## rc.3 · 源码补丁已发布 / Source addon published\n\n[完整冻结版](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0-rc.3) · [约719KB补丁]({download}) · [中英使用 / Instructions](releases/v0.1.0-rc.3-onboarding-162.md) · [实际发布回执](quality/onboarding-publication-162.json)\n\n9项检查与三个新增附件摘要匹配；原完整包及标签保持。Nine focused checks and three addon digests verified.\n\n---\n\n"
            for name in files[2:]:
                p = ROOT / name
                old = p.read_text(encoding="utf-8")
                assert old.startswith("## 162")
                old = old.split("---\n\n", 1)[1]
                p.write_text(header + old, encoding="utf-8", newline="\n")
            changed = set(git("diff", "--name-only", "-z", "HEAD").decode().split("\0")) - {""}
            untracked = set(git("ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")) - {""}
            protected = {p.replace("\\", "/") for p in baseline["preserved_user_files"]}
            assert changed | (untracked - protected) == set(files)
            git("add", "--", *files)
            assert set(git("diff", "--cached", "--name-only", "-z").decode().split("\0")) - {""} == set(files)
            for name in files:
                raw = (ROOT / name).read_bytes()
                blob = sha1(("blob " + str(len(raw)) + "\0").encode() + raw).hexdigest()
                assert git("ls-files", "-s", "--", name).decode().split()[1] == blob
            git("commit", "-m", "Record published rc3 source addon and verified asset digests (stage162)")
            head = git("rev-parse", "HEAD").decode().strip()
            assert refs() == sync["verified_refs"]
            git("push", "--atomic", "origin", head + ":refs/heads/docs", head + ":refs/heads/main")
            expected = {**sync["verified_refs"], "refs/heads/docs": head, "refs/heads/main": head}
            assert refs() == expected
            result.update(status="published", verified_refs=expected, documentation_commit=head, addon_assets=3, original_assets=6, checks=9)
        except Exception as e:
            result.update(status="failed", error=type(e).__name__ + ": " + str(e))
        finally:
            result["finished_at"] = datetime.now(timezone.utc).isoformat()
            result["finalizer_sha256"] = digest(Path(__file__))
            with (out / "receipt.json").open("x", encoding="utf-8", newline="\n") as f:
                f.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
            print(json.dumps({"status": result["status"], "receipt": str(out / "receipt.json"), "error": result["error"]}, ensure_ascii=False))
    assert result["status"] == "published"


if __name__ == "__main__":
    main()
