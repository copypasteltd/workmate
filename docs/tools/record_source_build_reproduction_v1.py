"""Archive the original clean-build attempts without rewriting their outcomes.

Run once to create the supplementary archive; --verify-only is read-only.
Executed versions and raw inputs are immutable. This is not a runtime test.
"""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "dev/copypaste-delivery/.data/source-repro-129"
OUT = ROOT / "docs/quality/source-build-reproduction-129"
BASE = "744fcb4f990002e5a142d8db71c2ff6d420bb2ce"
COMPONENTS = {"backend": "platform", "web": "web", "admin": "admin",
              "desktop": "desktop", "extension": "extension", "delivery": "delivery"}


def digest(data):
    return sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_bytes())


def git(repo, *args):
    return subprocess.check_output(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
         "-C", str(repo), *args], stderr=subprocess.PIPE).decode("utf-8").strip()


def credentials():
    spec = importlib.util.spec_from_file_location(
        "publication_credential_reader", ROOT / "docs/tools/audit_workmate_publication.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.configured_credentials()


def scan(name, data, needles):
    assert not any(value in data for value in needles), f"Configured credential detected: {name}"
    patterns = {
        "private_key": rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----",
        "github_token": rb"(?:gh[pousr]_[A-Za-z0-9]{32,}|github_pat_[A-Za-z0-9_]{40,})",
        "openai_secret": rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b",
        "aws_access_id": rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    }
    fixture = re.compile(rb"(?:example|fixture|synthetic|dummy|placeholder|fake|test[-_]|not[-_]?real)", re.I)
    for kind, pattern in patterns.items():
        for match in re.finditer(pattern, data):
            assert kind != "private_key" and fixture.search(match.group()), f"Credential signature: {name}, {kind}"


def verify_archive():
    index = load(OUT / "index.json")
    assert index["status"] == "passed_bounded_source_installation_and_build"
    assert index["recorder_sha256"] == digest(Path(__file__).read_bytes())
    needles = credentials()
    for row in index["originals"]:
        body = (OUT / row["archive"]).read_bytes()
        assert len(body) == row["bytes"] and digest(body) == row["sha256"]
        scan(row["source"], body, needles)
    for row in index["bindings"]:
        assert digest((ROOT / row["path"]).read_bytes()) == row["sha256"]
    for name in ["index.json", "README.md", "README.en.md"]:
        scan(name, (OUT / name).read_bytes(), needles)
    print(json.dumps({"status": "verified", "original_records": len(index["originals"]),
                      "repositories": len(index["repositories"]), "runtime_rerun": False}))


def record():
    assert not (OUT / "index.json").exists() and not (OUT / "blobs").exists(), "Never overwrite a retained archive"
    cp_path = ROOT / "docs/quality/startup-recovery-checkpoint-128.json"
    manifest_path = ROOT / "docs/quality/workmate-publication.json"
    cp, manifest = load(cp_path), load(manifest_path)
    attempts = [load(RAW / f"probe-{n:02}.json") for n in [1, 2, 3]]
    one, two, three = attempts
    assert [row["status"] for row in attempts] == ["failed", "failed", "passed"]
    assert two["errors"] == ["web dependency installation failed"] and three["errors"] == []
    assert three["retained_successful_installations"] == three["retained_successful_builds"] == 5
    assert three["previous_failed_report_sha256"] == digest((RAW / "probe-02.json").read_bytes())
    assert two["prior_failed_report_sha256"] == digest((RAW / "probe-01.json").read_bytes())
    assert two["prior_cancellation_request_sha256"] == digest((RAW / "probe-01-cancellation-request.json").read_bytes())
    diagnostic = (RAW / "probe-02-web-npm-debug-original.log").read_bytes()
    assert b"EIDLETIMEOUT" in diagnostic
    assert digest(diagnostic) == three["failed_install_diagnostic_sha256"]
    assert three["qualified_working_files_checked"] == two["qualified_working_files_checked"] == len(cp["source_files"]) == 1841
    for number, attempt in enumerate(attempts, 1):
        prefix = RAW / f"probe-{number:02}"
        assert attempt["checkpoint_sha256"] == digest(cp_path.read_bytes())
        assert attempt["raw_report_sha256"] == digest(prefix.with_suffix(".tap").read_bytes())
        assert attempt["verifier_sha256"] == digest((RAW / f"probe-{number:02}-verifier.mjs").read_bytes())
        assert attempt["verifier_sha256"] == digest((RAW / f"qualify-clean-checkouts-v{number}.mjs").read_bytes())
        assert attempt["node_version"] == three["node_version"]
        assert attempt["npm_cli_sha256"] == three["npm_cli_sha256"]
    for attempt in [two, three]:
        assert attempt["publication_sha256"] == digest(manifest_path.read_bytes())
    assert len(one["repositories"]) == 5 and one["commands"][-1]["exit_code"] == 1
    assert one["commands"][-1]["label"] == "clone delivery"
    assert [(r["label"], r["exit_code"]) for r in three["commands"]] == [
        ("retry install web", 0), ("build web", 0)]
    old_web = next(r for r in two["repositories"] if r["branch"] == "web")
    assert old_web["install_exit_code"] == 1 and "build_exit_code" not in old_web
    assert git(ROOT, "rev-parse", "HEAD") == BASE
    checkout_root = Path(three["checkout_root"]).resolve()
    assert checkout_root.parent == (ROOT / "dev").resolve()
    checked, normalizations = 0, []
    assert len(three["repositories"]) == 6
    for row in three["repositories"]:
        branch = row["branch"]
        primary = ROOT / f"dev/copypaste-{COMPONENTS[branch]}"
        fresh = Path(row["checkout"]).resolve()
        assert fresh.parent == checkout_root and fresh != primary.resolve()
        assert row["install_exit_code"] == row["build_exit_code"] == 0
        assert row["working_changes_after_build"] == ""
        assert row["commit"] == cp["component_commits"][branch]
        assert git(primary, "rev-parse", "HEAD") == row["commit"]
        assert git(fresh, "rev-parse", "HEAD") == row["commit"]
        assert git(fresh, "rev-parse", "HEAD^{tree}") == row["tree"]
        assert git(fresh, "status", "--porcelain") == ""
        assert git(primary, "status", "--porcelain", "--untracked-files=no") == ""
        for name, key in [("package.json", "package_sha256"), ("package-lock.json", "lock_sha256")]:
            assert digest((fresh / name).read_bytes()) == row[key]
        assert row["qualification_origin"] == ("03" if branch == "web" else "02")
        origin = three if branch == "web" else two
        labels = ["retry install web", "build web"] if branch == "web" else [f"install {branch}", f"build {branch}"]
        assert all(next(c for c in origin["commands"] if c["label"] == label)["exit_code"] == 0 for label in labels)
        if branch == "delivery":
            assert git(fresh, "sparse-checkout", "list") == "/*\n!/evidence/"
            assert not (fresh / "evidence").exists()
        prefix = f"dev/copypaste-{COMPONENTS[branch]}/"
        for name, expected in cp["source_files"].items():
            if not name.startswith(prefix):
                continue
            relative = name[len(prefix):]
            actual, qualified = (fresh / relative).read_bytes(), (ROOT / name).read_bytes()
            assert digest(qualified) == expected
            if digest(actual) != expected:
                declared = next(r for r in manifest["declared_git_line_ending_normalizations"]
                                if r["repository"] == branch and r["path"] == relative)
                assert declared["working_sha256"] == expected
                assert declared["committed_sha256"] == digest(actual)
                assert qualified.replace(b"\r\n", b"\n") == actual
                normalizations.append(name)
            checked += 1
    assert checked == 1841 and normalizations == ["dev/copypaste-desktop/.gitattributes"]
    receipt_path = ROOT / "dev/copypaste-delivery/.data/publication/556ea9f8-3b04-419c-85b8-168fdbcf3cc9/receipt.json"
    receipt = load(receipt_path)
    assert receipt["status"] == "pushed_and_verified" and receipt["failure"] is None
    assert receipt["manifest_sha256"] == digest(manifest_path.read_bytes())
    assert receipt["remote_after"] == {**cp["component_commits"], "main": BASE, "docs": BASE}
    original_paths = sorted(RAW.glob("probe-*")) + sorted(RAW.glob("qualify-clean-checkouts-v*.mjs")) + [receipt_path]
    assert len(original_paths) == 15
    needles, originals, bodies = credentials(), [], {}
    for path in original_paths:
        body = path.read_bytes()
        scan(path.name, body, needles)
        identity = digest(body)
        archive = f"blobs/{identity}.blob"
        bodies[archive] = body
        originals.append({"source": path.relative_to(ROOT).as_posix(), "archive": archive,
                          "sha256": identity, "bytes": len(body)})
    bindings = [{"path": p.relative_to(ROOT).as_posix(), "sha256": digest(p.read_bytes())}
                for p in [cp_path, manifest_path, ROOT / "docs/quality/remaining-work-stage128.json"]]
    index = {"at": datetime.now(timezone.utc).isoformat(),
             "status": "passed_bounded_source_installation_and_build",
             "scope": "Six independent same-commit local Git transport clones; fresh locked dependency installations and real builds. Five full source checkouts, one Delivery sparse checkout excluding historical evidence only. No remote-clone/runtime/installer/full-platform qualification.",
             "base_documentation_commit": BASE, "recorder_sha256": digest(Path(__file__).read_bytes()),
             "bindings": bindings, "originals": originals, "repositories": three["repositories"],
             "qualified_working_files_rechecked_after_build": checked,
             "declared_git_crlf_to_lf_only": normalizations,
             "original_outcomes_preserved": {"01": "failed; owned historical-evidence clone cancelled",
                                             "02": "failed; Web npm download EIDLETIMEOUT; five builds passed",
                                             "03": "passed; Web retry/build; five matching-source results retained"},
             "required_open": 89, "unconfirmed_suggestions": 12, "optional_open": 1,
             "full_acceptance_closures": 0, "new_runtime_tests": 0,
             "credential_scan": "Configured literal credentials and recognizable secret signatures checked without disclosing values"}
    bodies["index.json"] = (json.dumps(index, ensure_ascii=False, indent=2) + "\n").encode()
    for name, body in bodies.items():
        scan(name, body, needles)
    scan("recorder", Path(__file__).read_bytes(), needles)
    for name in ["README.md", "README.en.md"]:
        scan(name, (OUT / name).read_bytes(), needles)
    for name, body in bodies.items():
        target = OUT / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as stream:
            stream.write(body)
    print(json.dumps({"status": index["status"], "original_records": len(originals),
                      "unique_original_bodies": len(set(r["sha256"] for r in originals)),
                      "repositories": 6, "post_build_bound_files": checked, "full_acceptance_closures": 0}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    arguments = parser.parse_args()
    verify_archive() if arguments.verify_only else record()
