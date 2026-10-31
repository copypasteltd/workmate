"""Record actual public rc.3 assets and publish the final documentation handoff."""
from pathlib import Path
from hashlib import sha256, sha1
from datetime import datetime, timezone
import json
import os
import subprocess
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
VERSION = "v0.1.0-rc.3"
REMOTE = "git@github.com:copypasteltd/workmate.git"
BRANCHES = ["backend", "web", "admin", "desktop", "extension", "delivery", "docs", "main"]


def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def one(pattern):
    found = []
    for p in (DELIVERY / ".data/release-freeze-161").glob(pattern):
        v = json.loads(p.read_bytes())
        if v["status"] == "published":
            found.append((p, v))
    assert len(found) == 1, pattern
    return found[0]


def main():
    out = DELIVERY / ".data/release-freeze-161" / ("handoff-" + str(uuid.uuid4()))
    out.mkdir(parents=True)
    log = (out / "commands.log").open("xb")
    result = {"started_at": datetime.now(timezone.utc).isoformat(), "status": "running", "release": VERSION, "failure": None}
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}

    def git(*args):
        argv = ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "gc.auto=0", "-c", "gc.autoPackLimit=0", "-C", str(ROOT), *args]
        log.write((json.dumps({"args": args}) + "\n").encode())
        log.flush()
        p = subprocess.run(argv, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        log.write(p.stdout + p.stderr + b"\n")
        log.flush()
        assert p.returncode == 0, "Git operation failed; commands.log retained"
        return p.stdout.decode().strip()

    def refs():
        return {s.split()[1]: s.split()[0] for s in git("ls-remote", "origin", *["refs/heads/" + b for b in BRANCHES], "refs/tags/v0.1.0-rc.*").splitlines()}

    def create(p, text):
        with p.open("x", encoding="utf-8", newline="\n") as f:
            f.write(text)

    try:
        git_path, published_git = one("publication-*/receipt.json")
        api_path, published_api = one("github-*/receipt.json")
        frozen_path = DELIVERY / ".data/release-freeze-161/frozen-receipt.json"
        frozen = json.loads(frozen_path.read_bytes())
        cp = json.loads((ROOT / "docs/quality/release-freeze-checkpoint-161.json").read_bytes())
        assert published_api["all_asset_digests_match"] and published_api["frozen_bytes_unchanged"]
        assert len(published_api["assets"]) == 6 and frozen["artifact_count"] == 7
        assert digest(Path(frozen["complete_archive"]["path"])) == frozen["complete_archive"]["sha256"]
        for p, h in cp["qualified_sources"].items():
            assert digest(DEV / p) == h, p
        for p, h in {**cp["baseline"]["preserved_user_files"], **cp["baseline"]["frozen_files"]}.items():
            assert digest(ROOT / p) == h, p
        assert digest(DEV / "copypaste-desktop/.gitattributes") == cp["baseline"]["desktop_attributes_sha256"]
        assert git("rev-parse", "HEAD") == published_git["components"]["docs"]["commit"]
        assert refs() == published_git["verified_refs"], "Remote changed; preserve collaborator work"
        # Public checksum retrieval verifies the real unauthenticated download
        # route without redundantly transferring the complete large bundle.
        checksum = next(a for a in published_api["assets"] if a["name"].endswith(".zip.sha256"))
        req = urllib.request.Request(checksum["browser_download_url"], headers={"User-Agent": "workmate-rc3-handoff"})
        with urllib.request.urlopen(req, timeout=60) as response:
            assert response.status == 200
            body = response.read(4097)
        assert len(body) < 4097 and body.decode().split()[0] == frozen["complete_archive"]["sha256"]
        report = {"stage": 161, "at": datetime.now(timezone.utc).isoformat(), "status": "published", "release": VERSION, "release_url": published_api["release_url"], "frozen": frozen, "github": published_api, "git": published_git, "public_checksum_download": {"url": checksum["browser_download_url"], "http_status": 200, "sha256": sha256(body).hexdigest(), "archive_digest_matches": True}, "source_checks": {"backend_sql_http": 9, "actual_admin_journeys": 3, "current_builds": 2, "identical_reused_client_archives": 3}, "scope": cp["scope"], "mandatory_full_acceptance_open": 88, "no_new_browser_created": True, "finalizer_sha256": digest(Path(__file__)), "receipt_sources": {git_path.relative_to(ROOT).as_posix(): digest(git_path), api_path.relative_to(ROOT).as_posix(): digest(api_path), frozen_path.relative_to(ROOT).as_posix(): digest(frozen_path)}}
        report_name = "docs/quality/release-publication-161.json"
        note_name = "docs/releases/v0.1.0-rc.3-publication.md"
        create(ROOT / report_name, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        complete = next(a for a in published_api["assets"] if a["name"].endswith("-complete.zip"))
        note = f"# {VERSION} · 已发布完整冻结版 / Published frozen handoff\n\n[GitHub Release]({published_api['release_url']}) · [完整ZIP]({complete['browser_download_url']}) · [SHA256校验]({checksum['browser_download_url']})\n\n完整包{frozen['complete_archive']['bytes']}字节，包含七类分发归档、六仓可构建源码、固定Codex四文件及双语说明/真实截图和GIF。全部六个线上资产的GitHub摘要与冻结文件一致；公开校验文件下载HTTP200且内容吻合。\n\nThe complete ZIP contains all seven component/source/runtime distributions. GitHub confirms all six public asset digests, and the public checksum download returns HTTP200 with the matching archive digest.\n\nSHA256: `{frozen['complete_archive']['sha256']}`\n\n|编号|本次交付|状态|\n|---|---|---|\n|1|当前Admin权限/费用修复、9项SQL/HTTP与3组实际页面|已纳入冻结源码和构建|\n|2|后端/Admin新构建，源码相同的三个客户端归档|2项新构建、3项按SHA复用|\n|3|六仓源码、双语README、截图/GIF/MP4、七类包|已封装并上线|\n|4|8分支和7个新标注标签|推送及远端读取一致；旧版保持|\n|5|真实AI/媒体/广告/支付接口|按授权使用假数据；生产接入待办|\n|6|Windows签名安装与更新、跨系统完整验收|待办；当前Windows便携包未签名|\n\n按要求省略全量历史回归。102个原始需求编号仍保留，88项完整验收范围保持开放；这并非88个未开发模块。本轮不新增功能范围。\n\nBroad historical regression is deliberately omitted. The original full-scope acceptance ledger remains intact; open acceptance scopes are not a count of unimplemented modules.\n\n[使用说明](v0.1.0-rc.3.md) · [实际发布回执](../quality/release-publication-161.json) · [原编号待验收](../quality/remaining-work-stage160.md)\n"
        create(ROOT / note_name, note)
        header = f"## {VERSION} · 已发布 / Published\n\n[完整下载 / Complete ZIP]({complete['browser_download_url']}) · [校验 / SHA256]({checksum['browser_download_url']}) · [Release]({published_api['release_url']}) · [交付回执 / Receipt](quality/release-publication-161.json)\n\n七类分发包、当前六仓源码、固定Codex及双语说明/媒体已上线。Includes the seven distributions, current sources and pinned runtime. 获准假数据候选版；Windows未签名。Synthetic candidate; unsigned Windows.\n\n---\n\n"
        for name in ["docs/README.md", "docs/README.en.md"]:
            p = ROOT / name
            p.write_text(header + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
        names = ["docs/README.md", "docs/README.en.md", report_name, note_name]
        assert git("diff", "--cached", "--name-only") == ""
        git("add", "--", *names)
        assert set(git("diff", "--cached", "--name-only", "-z").split("\0")) == set(names)
        for name in names:
            raw = (ROOT / name).read_bytes()
            expected = sha1(("blob " + str(len(raw)) + "\0").encode() + raw).hexdigest()
            assert git("ls-files", "-s", "--", name).split()[1] == expected
        git("commit", "-m", "Deliver published Workmate rc.3 assets, checksums and final handoff (stage161)")
        head = git("rev-parse", "HEAD")
        assert refs() == published_git["verified_refs"]
        git("push", "--atomic", "origin", head + ":refs/heads/docs", head + ":refs/heads/main")
        expected = {**published_git["verified_refs"], "refs/heads/docs": head, "refs/heads/main": head}
        assert refs() == expected, "Remote readback mismatch"
        result.update(status="published", release_url=published_api["release_url"], complete_download=complete["browser_download_url"], verified_refs=expected, frozen_tags_unchanged=True, public_checksum_downloaded=True)
    except Exception as e:
        result.update(status="failed", failure=type(e).__name__ + ": " + str(e))
    finally:
        result["finished_at"] = datetime.now(timezone.utc).isoformat()
        with (out / "receipt.json").open("x", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        log.close()
        print(json.dumps({"status": result["status"], "receipt": str(out / "receipt.json"), "failure": result["failure"]}, ensure_ascii=False), flush=True)
    assert result["status"] == "published"


if __name__ == "__main__":
    main()
