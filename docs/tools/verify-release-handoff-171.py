"""Read-only release verification; writes one immutable, credential-free receipt."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "docs/quality/release-handoff-171.json"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def git(path, *args):
    return subprocess.check_output(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args],
        cwd=path, text=True, encoding="utf-8",
    ).strip()


def main():
    assert not OUTPUT.exists(), "Receipt already exists; use a new verifier version."
    baseline = read_json(ROOT / "dev/copypaste-delivery/.data/release-freeze-170/baseline.json")
    publication = read_json(ROOT / "docs/quality/release-publication-170.json")
    previous = read_json(ROOT / "dev/copypaste-delivery/.data/release-freeze-170/handoff-ada7e3e7-6f64-482f-8c0f-31f2dcb1475b/receipt.json")
    remote = {
        line.split("\t")[1]: line.split("\t")[0]
        for line in git(ROOT, "ls-remote", "origin", "refs/heads/*", "refs/tags/v0.1.*").splitlines()
    }
    assert remote == previous["verified_refs"], "Remote changed since the frozen handoff."
    sources = {}
    for name, directory in {
        "backend": "dev/copypaste-platform", "web": "dev/copypaste-web",
        "admin": "dev/copypaste-admin", "desktop": "dev/copypaste-desktop",
        "extension": "dev/copypaste-extension", "delivery": "dev/copypaste-delivery",
        "docs": ".",
    }.items():
        path = ROOT / directory
        assert not git(path, "status", "--porcelain", "--untracked-files=no"), name
        head = git(path, "rev-parse", "HEAD")
        assert head == remote[f"refs/heads/{name}"], name
        sources[name] = {"commit": head, "tracked_changes": 0}
    for relative, expected in baseline["preserved_user_files"].items():
        assert digest(ROOT / relative) == expected, relative
    assert digest(ROOT / "dev/copypaste-desktop/.gitattributes") == baseline["desktop_attributes_sha256"]
    frozen = dict(baseline["frozen_releases"])
    frozen["v0.1.1"] = publication["frozen"]
    frozen_checks = {}
    for version, item in frozen.items():
        archive = Path(item["complete_archive"]["path"])
        assert archive.stat().st_size == item["complete_archive"]["bytes"], version
        assert digest(archive) == item["complete_archive"]["sha256"], version
        directory = Path(item["directory"])
        assert digest(directory / "release-manifest.json") == item["manifest_sha256"], version
        assert digest(directory / "SHA256SUMS") == item["sums_sha256"], version
        frozen_checks[version] = {"bytes": archive.stat().st_size, "sha256": digest(archive), "manifest_and_sums_match": True}
    api_url = "https://api.github.com/repos/copypasteltd/workmate/releases/tags/v0.1.1"
    request = urllib.request.Request(api_url, headers={"User-Agent": "Workmate-release-handoff", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        status = response.status
        release = json.load(response)
    assert status == 200 and not release["draft"] and not release["prerelease"]
    assert release["tag_name"] == "v0.1.1"
    assets = {item["name"]: item for item in release["assets"]}
    expected = {item["name"]: item for item in publication["github"]["assets"]}
    assert set(assets) == set(expected)
    checked_assets = []
    directory = Path(publication["frozen"]["directory"])
    for name, expected_asset in expected.items():
        asset = assets[name]
        assert asset["size"] == expected_asset["size"] and asset["state"] == "uploaded"
        assert asset["digest"] == expected_asset["digest"]
        local = directory.parent / name if name.startswith("workmate-v0.1.1-complete.zip") else directory / name
        assert local.stat().st_size == asset["size"]
        assert "sha256:" + digest(local) == asset["digest"]
        checked_assets.append({key: asset[key] for key in ("name", "size", "state", "digest", "browser_download_url")})
    receipt = {
        "stage": 171, "at": datetime.now(timezone.utc).isoformat(),
        "status": "verified", "release": "v0.1.1", "release_url": release["html_url"],
        "scope": "Read-only release verification before documentation-only handoff commit; no product changes, new builds, broad regressions or new acceptance closures.",
        "public_api": {"url": api_url, "http_status": status, "credentials_used": False, "draft": False, "prerelease": False},
        "uploaded_assets": checked_assets, "all_local_and_remote_asset_digests_match": True,
        "sources_before_documentation_commit": sources,
        "remote_refs_before_documentation_commit": remote,
        "remote_ref_count": len(remote), "frozen_releases_unchanged": frozen_checks,
        "preserved_user_files": len(baseline["preserved_user_files"]), "desktop_attributes_unchanged": True,
        "inherited_qualification": publication["qualification"],
        "direct_binary_download_retested": False,
        "external_dependencies": "authorized_synthetic_data", "windows_signed": False,
        "original_acceptance_ledger": "docs/quality/remaining-work-stage169.json",
        "new_full_acceptance_closures": 0, "owned_browser_created": False,
        "owned_services_started": False, "virtualization_used": False,
        "verifier_sha256": digest(Path(__file__)),
    }
    with OUTPUT.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "verified", "release": "v0.1.1", "assets": len(checked_assets), "refs": len(remote), "preserved_releases": len(frozen_checks), "receipt": str(OUTPUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
