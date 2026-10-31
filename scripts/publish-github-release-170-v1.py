"""Publish unchanged frozen files with an explicitly configured GitHub credential."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import ctypes
import ctypes.wintypes as w
import json
import os
import re
import time
import urllib.request
import urllib.error
import urllib.parse
import uuid

ROOT = Path(__file__).resolve().parents[3]
DELIVERY = ROOT / "dev/copypaste-delivery"
VERSION = "v0.1.1"
REPOSITORY = "copypasteltd/workmate"
API = "https://api.github.com/repos/" + REPOSITORY
FROZEN = DELIVERY / "release" / ("workmate-" + VERSION)

def now():
    return datetime.now(timezone.utc).isoformat()

def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()

def credential(target):
    for key in ["GH_TOKEN", "GITHUB_TOKEN"]:
        if os.environ.get(key):
            return os.environ[key], "environment"
    assert os.name == "nt", "Use GH_TOKEN/GITHUB_TOKEN on non-Windows systems"
    if not target:
        text = (Path(os.environ["APPDATA"]) / "GitHub CLI/hosts.yml").read_text(encoding="utf-8")
        host = re.search(r"^github\.com:\s*\n((?:(?:[ \t].*)?\n)*)", text, re.M)
        assert host, "Configure the github.com CLI login or pass --credential-target"
        users = re.findall(r"^    user: ([A-Za-z0-9-]+)\s*$", host.group(1), re.M)
        assert len(users) == 1, "Pass the configured GitHub CLI secure-store target"
        target = "gh:github.com:" + users[0]
    assert re.fullmatch(r"gh:github\.com:[A-Za-z0-9-]+", target)
    class Credential(ctypes.Structure):
        _fields_ = [
            ("Flags", w.DWORD), ("Type", w.DWORD), ("TargetName", w.LPWSTR),
            ("Comment", w.LPWSTR), ("LastWritten", w.FILETIME),
            ("CredentialBlobSize", w.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", w.DWORD), ("AttributeCount", w.DWORD),
            ("Attributes", ctypes.c_void_p), ("TargetAlias", w.LPWSTR),
            ("UserName", w.LPWSTR),
        ]
    lib = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    lib.CredReadW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.POINTER(Credential))]
    lib.CredReadW.restype = w.BOOL
    lib.CredFree.argtypes = [ctypes.c_void_p]
    ptr = ctypes.POINTER(Credential)()
    assert lib.CredReadW(target, 1, 0, ctypes.byref(ptr)), "Configured credential unavailable"
    try:
        b = ctypes.string_at(ptr.contents.CredentialBlob, ptr.contents.CredentialBlobSize)
        token = b.decode("utf-16-le" if len(b) > 2 and b[1] == 0 else "utf-8").rstrip("\0")
    finally:
        lib.CredFree(ptr)
    assert token and token.isascii() and not any(c.isspace() for c in token)
    return token, "configured_github_cli_windows_secure_store"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class ApiError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__("GitHub HTTP " + str(status) + ": " + str(message))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--credential-target")
    args = parser.parse_args()
    token, source = credential(args.credential_target)
    out = DELIVERY / ".data/release-freeze-170" / ("github-" + str(uuid.uuid4()))
    out.mkdir(parents=True)
    result = {
        "started_at": now(), "status": "running", "release": VERSION,
        "repository": REPOSITORY, "credential_source": source,
        "credential_written_to_disk": False, "assets": [], "error": None,
    }
    opener = urllib.request.build_opener(NoRedirect())
    headers = {
        "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "workmate-release170",
    }

    def request(method, url, body=None, extra=None):
        parsed = urllib.parse.urlparse(url)
        prefix = "/repos/" + REPOSITORY
        assert parsed.scheme == "https" and parsed.netloc in ["api.github.com", "uploads.github.com"]
        assert parsed.path == prefix or parsed.path.startswith(prefix + "/")
        data = json.dumps(body, ensure_ascii=False).encode() if isinstance(body, dict) else body
        h = {**headers, **(extra or {})}
        if isinstance(body, dict):
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(url, method=method, data=data, headers=h)
        try:
            with opener.open(req, timeout=180) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as e:
            raw, message = e.read(), "Request rejected"
            try:
                message = json.loads(raw).get("message", message)
            except (ValueError, AttributeError):
                pass
            raise ApiError(e.code, message) from None

    def assetrow(asset):
        return {k: asset.get(k) for k in ["id", "name", "size", "state", "digest", "browser_download_url"]}

    def assets(release):
        rows, page = [], 1
        while True:
            batch = request("GET", API + "/releases/" + str(release["id"]) + "/assets?per_page=100&page=" + str(page))
            rows += batch
            if len(batch) < 100:
                return rows
            page += 1

    def upload(release, p, expected):
        existing = next((a for a in assets(release) if a["name"] == p.name), None)
        if existing:
            assert existing["state"] == "uploaded" and existing["size"] == p.stat().st_size
            assert existing.get("digest") == "sha256:" + expected, "Different existing asset preserved"
            return existing
        assert release["draft"], "Only this draft may receive missing assets"
        url = release["upload_url"].split("{")[0] + "?" + urllib.parse.urlencode({"name": p.name})
        size, started, last, sent, streamhash = p.stat().st_size, time.monotonic(), [time.monotonic()], [0], sha256()
        class Body:
            def __init__(self, f):
                self.f = f
            def read(self, n=-1):
                b = self.f.read(n if n > 0 else 1024 * 1024)
                if b:
                    streamhash.update(b)
                    sent[0] += len(b)
                    t = time.monotonic()
                    if t - last[0] >= 10 or sent[0] == size:
                        progress = {
                            "at": now(), "phase": "uploading", "asset": p.name,
                            "sent_bytes": sent[0], "total_bytes": size,
                            "elapsed_seconds": round(t - started, 1),
                        }
                        (out / "progress.json").write_text(json.dumps(progress) + "\n", encoding="utf-8", newline="\n")
                        print(json.dumps(progress), flush=True)
                        last[0] = t
                return b
        reconciled = False
        try:
            with p.open("rb") as f:
                answer = request("POST", url, Body(f), {
                    "Content-Type": "application/zip" if p.suffix == ".zip" else "application/octet-stream",
                    "Content-Length": str(size),
                })
        except Exception:
            # Reconcile a lost response against durable state. Never overwrite,
            # delete or repeat an upload just because observation timed out.
            answer = next((a for a in assets(release) if a["name"] == p.name
                           and a["state"] == "uploaded" and a.get("digest") == "sha256:" + expected), None)
            if answer is None:
                raise
            reconciled = True
        if not reconciled:
            assert sent[0] == size and streamhash.hexdigest() == expected, "Frozen file changed while streaming"
        assert answer["state"] == "uploaded" and answer["size"] == size
        assert answer.get("digest") == "sha256:" + expected, "GitHub did not confirm the frozen bytes"
        return answer

    try:
        receipt = json.loads((DELIVERY / ".data/release-freeze-170/frozen-receipt.json").read_bytes())
        assert receipt["status"] == "frozen" and receipt["release"] == VERSION
        complete = Path(receipt["complete_archive"]["path"])
        assert complete.parent == DELIVERY / "release"
        assert digest(complete) == receipt["complete_archive"]["sha256"]
        assert digest(FROZEN / "release-manifest.json") == receipt["manifest_sha256"]
        assert digest(FROZEN / "SHA256SUMS") == receipt["sums_sha256"]
        manifest = json.loads((FROZEN / "release-manifest.json").read_bytes())
        assert manifest["release"] == VERSION and manifest["schema_version"] == 155
        for artifact in manifest["artifacts"]:
            assert digest(FROZEN / artifact["file"]) == artifact["sha256"]
        repo = request("GET", API)
        assert repo["full_name"].lower() == REPOSITORY and repo["permissions"]["push"]
        result["repository_private"] = repo["private"]
        obj = request("GET", API + "/git/ref/tags/" + VERSION)["object"]
        while obj["type"] == "tag":
            obj = request("GET", API + "/git/tags/" + obj["sha"])["object"]
        assert obj["type"] == "commit" and obj["sha"] == manifest["docs_commit"]
        result["frozen_tag_commit"] = obj["sha"]
        body = """# Workmate v0.1.1 · 完整冻结更新 / Complete frozen update

完整包包括无边框本机 Codex Desktop（完整目录、Portable、Setup）、Web、独立 Admin、Chrome 原生右侧栏、后端、六仓可构建源码、固定 Codex、双语手册、实际截图/GIF/MP4，以及逐文件校验清单。

The complete bundle contains every client/backend, unsigned Windows distributions, six buildable source trees, pinned Codex, bilingual guides, actual screenshots/recordings and checksum manifests.

- 纳入用户运营组合筛选、多维消耗报表、原始账务明细和同快照CSV；按实际发起人与独立付款账户计费。数据库156；内部供应商实际成本明确未知。
- 保留完整登录、首次工作区恢复、角色/Skill、任务/审批/成果、预算费用和后台 VIP 主流程。
- Backend/Admin使用当前已通过的构建；未改客户端源码和运行构建对照阶段167一致，复用逐文件核对的Windows完整目录、Portable及Setup。
- 沿用源码一致的阶段169六项SQL/API和六组实际Admin/CSV旅程；按用户要求省略无关历史广泛回归。
- Desktop 在客户本机运行 Codex，客户可主动授予完整本机权限；Extension 仅经同意读取/上传文件，由云端 Codex 执行。
- AI/media/ads/payments use the authorized synthetic mode. Windows is unsigned. Production providers, signing/update, other OSes and full professional acceptance remain tracked.
- All previous frozen releases/tags remain unchanged. This version identifies the frozen delivery scope, not production-provider qualification.

Complete ZIP SHA-256: """ + receipt['complete_archive']['sha256'] + """

[中英安装使用说明 / Bilingual installation and usage](https://github.com/copypasteltd/workmate/blob/v0.1.1/docs/releases/v0.1.1.md)

Download the complete ZIP and adjacent .sha256 file. Merge source and runtime ZIPs before initialization. Select an unused native database port. No Docker/WSL is used.
"""
        marker = "<!-- workmate-frozen-v011:" + receipt["complete_archive"]["sha256"] + " -->"
        body += "\n" + marker + "\n"
        existing = [r for r in request("GET", API + "/releases?per_page=100") if r["tag_name"] == VERSION]
        assert len(existing) <= 1
        if existing:
            release = existing[0]
            assert marker in (release.get("body") or ""), "Different existing release preserved"
        else:
            release = request("POST", API + "/releases", {
                "tag_name": VERSION, "target_commitish": manifest["docs_commit"],
                "name": "Workmate " + VERSION + " · Complete frozen update (synthetic services)",
                "body": body, "draft": True, "prerelease": False, "make_latest": "true",
            })
        result.update(release_id=release["id"], release_url=release["html_url"])
        print(json.dumps({"phase": "draft_ready", "url": release["html_url"], "id": release["id"]}), flush=True)
        # One complete bundle avoids re-uploading its seven component ZIPs.
        paths = [
            complete, complete.parent / (complete.name + ".sha256"),
            FROZEN / "release-manifest.json", FROZEN / "SHA256SUMS",
            FROZEN / "source-files.json", FROZEN / "artifact-contents.json",
        ]
        expected = {p.name: digest(p) for p in paths}
        for p in paths:
            answer = upload(release, p, expected[p.name])
            row = assetrow(answer)
            result["assets"].append(row)
            (out / "upload-receipt.json").write_text(json.dumps({**result, "status": "draft_uploading"},
                ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
            print(json.dumps({"phase": "asset_verified", **row}), flush=True)
        observed = {a["name"]: a for a in assets(release)}
        for p in paths:
            assert observed[p.name]["digest"] == "sha256:" + expected[p.name]
            assert observed[p.name]["state"] == "uploaded" and observed[p.name]["size"] == p.stat().st_size
        if release["draft"]:
            release = request("PATCH", API + "/releases/" + str(release["id"]), {
                "draft": False, "prerelease": False, "make_latest": "true",
            })
        current = request("GET", API + "/releases/tags/" + VERSION)
        assert not current["draft"] and current["tag_name"] == VERSION and current["id"] == release["id"]
        result.update(
            status="published", release_url=current["html_url"], published_at=current["published_at"],
            assets=[assetrow(a) for a in current["assets"] if a["name"] in expected],
            all_asset_digests_match=True,
        )
        assert len(result["assets"]) == len(paths)
        assert digest(complete) == receipt["complete_archive"]["sha256"]
        assert digest(FROZEN / "release-manifest.json") == receipt["manifest_sha256"]
        result["frozen_bytes_unchanged"] = True
    except Exception as e:
        result["status"] = "failed"
        result["error"] = (type(e).__name__ + ": " + str(e)).replace(token, "[redacted]")
    finally:
        result["finished_at"] = now()
        result["publisher_sha256"] = digest(Path(__file__))
        (out / "receipt.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                                        encoding="utf-8", newline="\n")
        print(json.dumps({"status": result["status"], "url": result.get("release_url"),
                         "receipt": str(out / "receipt.json"), "error": result["error"]},
                         ensure_ascii=False), flush=True)
    assert result["status"] == "published", "Original draft/state retained for reconciliation"

if __name__ == "__main__":
    main()
