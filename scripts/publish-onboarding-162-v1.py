"""Append a source-only addon; never replace an existing frozen release asset."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import importlib.util
import json
import urllib.request
import urllib.error
import urllib.parse
import uuid

DELIVERY = Path(__file__).resolve().parents[1]
ROOT = DELIVERY.parents[1]
API = "https://api.github.com/repos/copypasteltd/workmate"
VERSION = "v0.1.0-rc.3"


def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def main():
    spec = importlib.util.spec_from_file_location("authorized_release_credential", DELIVERY / "scripts/publish-github-release-159-v1.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    token, source = module.credential("gh:github.com:Tonscriptions")
    out = DELIVERY / ".data/onboarding-162" / ("github-" + str(uuid.uuid4()))
    out.mkdir(parents=True)
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "running", "release": VERSION, "credential_source": source, "credential_written_to_disk": False, "assets": [], "error": None}
    opener = urllib.request.build_opener(module.NoRedirect())

    def request(method, url, body=None, extra=None):
        u = urllib.parse.urlparse(url)
        repository_path = "/repos/copypasteltd/workmate"
        assert u.scheme == "https" and u.netloc in ["api.github.com", "uploads.github.com"] and (u.path == repository_path or u.path.startswith(repository_path + "/"))
        headers = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "workmate-onboarding162", **(extra or {})}
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode()
            headers["Content-Type"] = "application/json"
        try:
            with opener.open(urllib.request.Request(url, method=method, data=body, headers=headers), timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as e:
            try:
                message = json.loads(e.read()).get("message", "Request rejected")
            except ValueError:
                message = "Request rejected"
            raise RuntimeError("GitHub HTTP " + str(e.code) + ": " + message) from None

    def assets(release):
        return request("GET", API + "/releases/" + str(release["id"]) + "/assets?per_page=100")

    try:
        checkpoint = json.loads((ROOT / "docs/quality/onboarding-checkpoint-162.json").read_bytes())
        assert checkpoint["status"] == "qualified" and len(checkpoint["qualification"]["checks"]) == 9
        for p, h in checkpoint["qualified_sources"].items():
            assert digest(ROOT / p) == h, p
        package = DELIVERY / "release/onboarding-162-attempt-01"
        paths = [package / "workmate-v0.1.0-rc.3-onboarding-162.zip", package / "workmate-v0.1.0-rc.3-onboarding-162.zip.sha256", package / "patch-manifest.json"]
        for p in paths:
            assert p.stat().st_size < 10 * 1024 * 1024 and digest(p) == checkpoint["artifacts"][p.name]["sha256"]
        frozen = json.loads((DELIVERY / ".data/release-freeze-161/frozen-receipt.json").read_bytes())
        prior = json.loads((ROOT / "docs/quality/release-publication-161.json").read_bytes())["github"]
        repo = request("GET", API)
        assert repo["full_name"].lower() == "copypasteltd/workmate" and repo["permissions"]["push"] and not repo["private"]
        release = request("GET", API + "/releases/tags/" + VERSION)
        assert not release["draft"] and "<!-- workmate-frozen-rc3:" + frozen["complete_archive"]["sha256"] + " -->" in release["body"]
        before = {a["name"]: a for a in assets(release)}
        for old in prior["assets"]:
            assert before[old["name"]]["digest"] == old["digest"] and before[old["name"]]["size"] == old["size"]
        for p in paths:
            expected = digest(p)
            existing = next((a for a in assets(release) if a["name"] == p.name), None)
            if existing:
                assert existing["state"] == "uploaded" and existing["size"] == p.stat().st_size and existing["digest"] == "sha256:" + expected, "Different existing asset preserved"
                answer = existing
            else:
                url = release["upload_url"].split("{")[0] + "?" + urllib.parse.urlencode({"name": p.name})
                try:
                    answer = request("POST", url, p.read_bytes(), {"Content-Type": "application/octet-stream", "Content-Length": str(p.stat().st_size)})
                except Exception:
                    answer = next((a for a in assets(release) if a["name"] == p.name and a["state"] == "uploaded" and a.get("digest") == "sha256:" + expected), None)
                    if answer is None:
                        raise
                assert answer["state"] == "uploaded" and answer["size"] == p.stat().st_size and answer.get("digest") == "sha256:" + expected
            result["assets"].append({k: answer[k] for k in ["id", "name", "size", "state", "digest", "browser_download_url"]})
            print(json.dumps({"phase": "addon_asset_verified", "name": p.name, "bytes": answer["size"]}), flush=True)
        current = request("GET", API + "/releases/" + str(release["id"]))
        marker = "<!-- workmate-onboarding162:" + digest(paths[0]) + " -->"
        if marker not in current["body"]:
            assert "<!-- workmate-onboarding162:" not in current["body"], "Different existing addon announcement preserved"
            addition = "\n\n## Source onboarding addon / 源码首次启动补丁\n\nA small optional source patch fixes the root guide links and rejects occupied startup ports before installing dependencies. It validates the exact rc.3 source files and preserves local configuration/data/runtime binaries. Nine focused patch/CLI checks pass. Previous complete ZIPs, seven runtime/source distributions and tags retain their original bytes.\n\n约719KB的可选源码补丁：修复根目录入门链接，安装依赖前拒绝端口占用，核对原文件后应用。本地配置、数据库和固定Codex不在补丁目标内。9项定向补丁/CLI检查通过；既有冻结包与标签保持。\n\n[中英使用说明 / Bilingual guide](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/v0.1.0-rc.3-onboarding-162.md)\n\n" + marker + "\n"
            request("PATCH", API + "/releases/" + str(release["id"]), {"body": current["body"] + addition})
        observed = {a["name"]: a for a in assets(release)}
        for old in prior["assets"]:
            assert observed[old["name"]]["digest"] == old["digest"] and observed[old["name"]]["size"] == old["size"]
        for asset in result["assets"]:
            assert observed[asset["name"]]["digest"] == asset["digest"]
        result.update(status="published", release_url=release["html_url"], original_six_assets_unchanged=True, addon_asset_digests_match=True, frozen_complete_zip_unchanged=digest(Path(frozen["complete_archive"]["path"])) == frozen["complete_archive"]["sha256"])
        assert result["frozen_complete_zip_unchanged"]
    except Exception as e:
        result.update(status="failed", error=(type(e).__name__ + ": " + str(e)).replace(token, "[redacted]"))
    finally:
        result["finished_at"] = datetime.now(timezone.utc).isoformat()
        result["publisher_sha256"] = digest(Path(__file__))
        with (out / "receipt.json").open("x", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"status": result["status"], "receipt": str(out / "receipt.json"), "error": result["error"]}, ensure_ascii=False), flush=True)
    assert result["status"] == "published"


if __name__ == "__main__":
    main()
