"""Record published rc.3 assets, retain local network failures and finish handoff."""
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

    def git(*args, repo=ROOT):
        argv = ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "gc.auto=0", "-c", "gc.autoPackLimit=0", "-C", str(repo), *args]
        log.write((json.dumps({"args": args}) + "\n").encode())
        log.flush()
        p = subprocess.run(argv, cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
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
        # The API host is independently reachable. Preserve the two native
        # download resets and the closed browser's page timeout, and do not
        # reclassify them as a successful public file download.
        checksum = next(a for a in published_api["assets"] if a["name"].endswith(".zip.sha256"))
        request = urllib.request.Request("https://api.github.com/repos/copypasteltd/workmate/releases/tags/" + VERSION, headers={"User-Agent": "workmate-rc3-handoff", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            assert response.status == 200
            public = json.loads(response.read())
        assert public["tag_name"] == VERSION and not public["draft"]
        observed = {a["name"]: a for a in public["assets"]}
        for asset in published_api["assets"]:
            current = observed[asset["name"]]
            assert current["state"] == "uploaded" and current["size"] == asset["size"] and current["digest"] == asset["digest"]
        browser_paths = list((DELIVERY / ".data/release-freeze-161").glob("browser-*/receipt.json"))
        assert len(browser_paths) == 1
        browser_path = browser_paths[0]
        browser = json.loads(browser_path.read_bytes())
        assert browser["status"] == "failed" and browser["browser_closed"] and "ERR_CONNECTION_TIMED_OUT" in browser["error"]
        prior_attempts = [{"path": p.relative_to(ROOT).as_posix(), "sha256": digest(p), "receipt": json.loads(p.read_bytes())} for p in (DELIVERY / ".data/release-freeze-161").glob("handoff-*/receipt.json") if json.loads(p.read_bytes())["status"] == "failed"]
        assert len(prior_attempts) >= 2
        helper = "scripts/check-public-download-161-v1.mjs"
        assert digest(DELIVERY / helper) == browser["verifier_sha256"]
        assert git("rev-parse", "HEAD", repo=DELIVERY) == published_git["components"]["delivery"]["commit"]
        assert git("diff", "--cached", "--name-only", repo=DELIVERY) == ""
        for name, header in [("README.md", "## rc.3 · 发布回执\n\n完整冻结版已上线；GitHub API公开读取及六附件摘要通过。本机访问GitHub网页/下载发生网络超时，原失败和已关闭浏览器的回执保持；本地完整包可用。[最终交付说明](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/v0.1.0-rc.3-publication.md)。本次只新增发布后下载检查工具，冻结标签及包不变。\n\n---\n\n"), ("README.en.md", "## rc.3 · Publication receipt\n\nThe frozen candidate is published, and public API metadata confirms all six asset digests. This machine's GitHub page/download connection timed out; original failures and the closed browser receipt are retained. The local complete ZIP remains available. [Final handoff](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/v0.1.0-rc.3-publication.md). This adds a post-publication download checker only; frozen tags and packages stay unchanged.\n\n---\n\n")]:
            p = DELIVERY / name
            p.write_text(header + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
        delivery_names = [helper, "README.md", "README.en.md"]
        git("add", "--", *delivery_names, repo=DELIVERY)
        assert set(git("diff", "--cached", "--name-only", "-z", repo=DELIVERY).split("\0")) == set(delivery_names)
        for name in delivery_names:
            raw = (DELIVERY / name).read_bytes()
            expected = sha1(("blob " + str(len(raw)) + "\0").encode() + raw).hexdigest()
            assert git("ls-files", "-s", "--", name, repo=DELIVERY).split()[1] == expected
        git("commit", "-m", "Record post-release public download timeout and preserve frozen rc.3 (stage161)", repo=DELIVERY)
        delivery_head = git("rev-parse", "HEAD", repo=DELIVERY)
        git("fetch", "--no-tags", str(DELIVERY), delivery_head)
        report = {"stage": 161, "at": datetime.now(timezone.utc).isoformat(), "status": "published", "release": VERSION, "release_url": published_api["release_url"], "frozen": frozen, "github": published_api, "git": published_git, "public_api": {"url": request.full_url, "http_status": 200, "credentials_used": False, "six_uploaded_asset_digests_match": True}, "public_file_download": {"status": "not_confirmed_local_network_timeout", "url": checksum["browser_download_url"], "prior_native_attempts": prior_attempts, "browser": browser, "browser_receipt_sha256": digest(browser_path)}, "post_publication_delivery": {"commit": delivery_head, "runtime_changed": False, "scope": "Read-only public download checker and bilingual documentation; frozen runtime archives remain unchanged"}, "source_checks": {"backend_sql_http": 9, "actual_admin_journeys": 3, "current_builds": 2, "identical_reused_client_archives": 3}, "scope": cp["scope"], "mandatory_full_acceptance_open": 88, "owned_browser_closed": True, "finalizer_sha256": digest(Path(__file__)), "receipt_sources": {git_path.relative_to(ROOT).as_posix(): digest(git_path), api_path.relative_to(ROOT).as_posix(): digest(api_path), frozen_path.relative_to(ROOT).as_posix(): digest(frozen_path)}}
        report_name = "docs/quality/release-publication-161.json"
        note_name = "docs/releases/v0.1.0-rc.3-publication.md"
        create(ROOT / report_name, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        complete = next(a for a in published_api["assets"] if a["name"].endswith("-complete.zip"))
        note = f"# {VERSION} · 已发布完整冻结版 / Published frozen handoff\n\n[GitHub Release]({published_api['release_url']}) · [完整ZIP]({complete['browser_download_url']}) · [SHA256校验]({checksum['browser_download_url']})\n\n完整包{frozen['complete_archive']['bytes']}字节，包含七类分发归档、六仓可构建源码、固定Codex四文件及双语说明/真实截图和GIF。全部六个线上资产的GitHub摘要与冻结文件一致；公开API读取HTTP200且六附件状态/摘要吻合。本机直接下载连接重置、浏览器访问超时，公开文件下载尚未在本机确认；原失败保持。\n\nThe complete ZIP contains all seven component/source/runtime distributions. GitHub confirms all six public asset digests, and an unauthenticated public API read confirms every uploaded digest. Direct file download is not confirmed on this machine because the native request reset and the browser page timed out. Original failures are retained and the owned browser is closed.\n\nSHA256: `{frozen['complete_archive']['sha256']}`\n\n|编号|本次交付|状态|\n|---|---|---|\n|1|当前Admin权限/费用修复、9项SQL/HTTP与3组实际页面|已纳入冻结源码和构建|\n|2|后端/Admin新构建，源码相同的三个客户端归档|2项新构建、3项按SHA复用|\n|3|六仓源码、双语README、截图/GIF/MP4、七类包|已封装并上线|\n|4|8分支和7个新标注标签|推送及远端读取一致；旧版保持|\n|5|真实AI/媒体/广告/支付接口|按授权使用假数据；生产接入待办|\n|6|Windows签名安装与更新、跨系统完整验收|待办；当前Windows便携包未签名|\n\n按要求省略全量历史回归。102个原始需求编号仍保留，88项完整验收范围保持开放；这并非88个未开发模块。本轮不新增功能范围。\n\nBroad historical regression is deliberately omitted. The original full-scope acceptance ledger remains intact; open acceptance scopes are not a count of unimplemented modules.\n\n[使用说明](v0.1.0-rc.3.md) · [实际发布回执](../quality/release-publication-161.json) · [原编号待验收](../quality/remaining-work-stage160.md)\n"
        create(ROOT / note_name, note)
        header = f"## {VERSION} · 已发布 / Published\n\n[完整下载 / Complete ZIP]({complete['browser_download_url']}) · [校验 / SHA256]({checksum['browser_download_url']}) · [Release]({published_api['release_url']}) · [交付回执 / Receipt](quality/release-publication-161.json)\n\n七类分发包、当前六仓源码、固定Codex及双语说明/媒体已上线。Includes the seven distributions, current sources and pinned runtime. 获准假数据候选版；Windows未签名。Synthetic candidate; unsigned Windows.\n\n---\n\n"
        for name in ["docs/README.md", "docs/README.en.md"]:
            p = ROOT / name
            p.write_text(header + p.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
        names = ["docs/README.md", "docs/README.en.md", report_name, note_name, "docs/tools/finalize-release-handoff-161-v2.py"]
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
        git("push", "--atomic", "origin", head + ":refs/heads/docs", head + ":refs/heads/main", delivery_head + ":refs/heads/delivery")
        expected = {**published_git["verified_refs"], "refs/heads/docs": head, "refs/heads/main": head, "refs/heads/delivery": delivery_head}
        assert refs() == expected, "Remote readback mismatch"
        result.update(status="published", release_url=published_api["release_url"], complete_download=complete["browser_download_url"], verified_refs=expected, frozen_tags_unchanged=True, public_metadata_verified=True, direct_download_confirmed=False)
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
