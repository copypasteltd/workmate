"""Exercise the real source patch and fail-fast bootstrap without installers/AI."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
from datetime import datetime, timezone
import json
import os
import posixpath
import re
import shutil
import socket
import subprocess
import sys
import uuid
import zipfile

DELIVERY = Path(__file__).resolve().parents[1]
ROOT = DELIVERY.parents[1]
DEV = ROOT / "dev"


def digest(p):
    return sha256(p.read_bytes()).hexdigest()


def main():
    attempt = sys.argv[1]
    assert re.fullmatch(r"\d{2}", attempt)
    package = DELIVERY / "release" / ("onboarding-162-attempt-" + attempt)
    manifest = json.loads((package / "patch-manifest.json").read_bytes())
    base = DELIVERY / "release/workmate-v0.1.0-rc.3"
    frozen = json.loads((base / "release-manifest.json").read_bytes())
    source = base / next(a["file"] for a in frozen["artifacts"] if a["file"].endswith("-buildable-sources.zip"))
    run = DELIVERY / ".data/onboarding-162" / ("qualification-" + str(uuid.uuid4()))
    run.mkdir(parents=True)
    log_path = run / "commands.log"
    log = log_path.open("xb")
    node = shutil.which("node")
    assert node
    checks, error = [], None
    env = {k: v for k, v in os.environ.items() if k not in ["NODE_OPTIONS", "COPYPASTE_DEV_ROOT", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL", "OWNER_DATABASE_URL"]}
    env["NODE_ENV"] = "development"
    prefix = "workmate-v0.1.0-rc.3-source/"
    archive = zipfile.ZipFile(source)
    original_entries = set(archive.namelist())
    parent_index = ROOT / ".git/index"
    index_before = digest(parent_index)
    sources = ["package.json", "scripts/bootstrap-source-demo-158.mjs", "scripts/source-demo-port-preflight-162.mjs", "scripts/source-preflight-162.mjs", "scripts/apply-onboarding-patch-162.mjs", "scripts/qualify-onboarding-162-v1.py"]
    source_hashes = {"copypaste-delivery/" + p: digest(DELIVERY / p) for p in sources}

    def execute(args, cwd, child_env=None, success=True):
        p = subprocess.run(args, cwd=cwd, env=child_env or env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        log.write((json.dumps({"cwd": str(cwd), "args": args, "exit_code": p.returncode}) + "\n").encode())
        log.write(p.stdout + p.stderr + b"\n")
        log.flush()
        assert (p.returncode == 0) == success, p.stderr.decode(errors="replace")[-2000:]
        return p

    def fixture(name):
        target = run / name
        target.mkdir()
        names = {f["path"] for f in manifest["files"] if f["before_sha256"] is not None}
        names.update("dev/copypaste-" + c + "/package.json" for c in ["platform", "web", "admin", "desktop", "extension", "delivery"])
        names.add("dev/copypaste-delivery/scripts/source-demo-runtime-158.mjs")
        for name in names:
            file = target / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(archive.read(prefix + name))
        private = target / "dev/copypaste-platform/.env"
        private.write_bytes(b"USER_CONFIGURATION=synthetic-preservation-sentinel\n")
        return target

    def facts(target):
        names = [f["path"] for f in manifest["files"]] + ["dev/copypaste-platform/.env"]
        return {p: digest(target / p) if (target / p).exists() else None for p in names}

    def apply(target, prepared=package, success=True):
        return execute([node, str(prepared / "apply-onboarding-patch-162.mjs"), str(target)], target, success=success)

    def listener(port=0):
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            s.bind(("127.0.0.1", port))
            s.listen()
            return s
        except BaseException:
            s.close()
            raise

    try:
        target = fixture("clean-source")
        secret_before = (target / "dev/copypaste-platform/.env").read_bytes()
        p = apply(target)
        assert json.loads(p.stdout)["status"] == "applied"
        for f in manifest["files"]:
            assert digest(target / f["path"]) == f["after_sha256"], f["path"]
        assert (target / "dev/copypaste-platform/.env").read_bytes() == secret_before
        assert digest(parent_index) == index_before
        checks.append("Real Git applies all six exact files with raw bytes; local configuration and the real parent repository index remain unchanged")
        before = facts(target)
        assert json.loads(apply(target).stdout)["status"] == "already_applied"
        assert facts(target) == before
        checks.append("Applying the same patch again is idempotent and leaves files unchanged")

        modified = fixture("locally-modified")
        with (modified / "START-HERE.md").open("ab") as f:
            f.write(b"\nCustomer local edit\n")
        before = facts(modified)
        apply(modified, success=False)
        assert facts(modified) == before and not (modified / "dev/copypaste-delivery/.data").exists()
        checks.append("A customer source edit refuses the whole patch before private metadata or destinations are written")

        def tamper(name):
            out = run / name
            out.mkdir()
            for file in ["patch-manifest.json", "onboarding-162.patch", "apply-onboarding-patch-162.mjs"]:
                shutil.copyfile(package / file, out / file)
            return out

        unsafe = fixture("unsafe-target")
        changed = tamper("unsafe-patch")
        bad = json.loads((changed / "patch-manifest.json").read_bytes())
        bad["files"][0]["path"] = "../outside.txt"
        (changed / "patch-manifest.json").write_text(json.dumps(bad), encoding="utf-8", newline="\n")
        outside = unsafe.parent / "outside.txt"
        outside.write_bytes(b"Outside target sentinel")
        before = facts(unsafe)
        apply(unsafe, changed, success=False)
        assert facts(unsafe) == before and outside.read_bytes() == b"Outside target sentinel"
        checks.append("A traversal destination is rejected and the outside sentinel is preserved")

        corrupt = fixture("corrupt-target")
        changed = tamper("corrupt-patch")
        with (changed / "onboarding-162.patch").open("ab") as f:
            f.write(b"Corruption")
        before = facts(corrupt)
        apply(corrupt, changed, success=False)
        assert facts(corrupt) == before
        checks.append("A changed patch checksum refuses all destination writes")

        for port in [4310, 4317, 4318, 4319]:
            s = listener(port)
            s.close()
        selected = listener()
        port = selected.getsockname()[1]
        selected.close()
        local_env = target / "dev/copypaste-platform/.env"
        local_env.write_text("NODE_ENV=development\n" + "\n".join(k + "=postgresql://test:synthetic@127.0.0.1:" + str(port) + "/unused" for k in ["DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL", "OWNER_DATABASE_URL"]) + "\n", encoding="utf-8", newline="\n")
        child_env = {**env, "COPYPASTE_DEV_ROOT": str(target / "dev"), "COPYPASTE_SOURCE_DATABASE_PORT": str(port)}
        cli = target / "dev/copypaste-delivery/scripts/source-preflight-162.mjs"
        before = facts(target)
        p = execute([node, str(cli)], target, child_env)
        assert json.loads(p.stdout.splitlines()[0])["status"] == "source_layout_and_ports_ready"
        assert facts(target) == before
        for candidate in [4310, 4317, 4318, 4319, port]:
            s = listener(candidate)
            s.close()
        checks.append("The real preflight accepts available ports, releases every probe and preserves the existing configuration")
        owner = listener(port)
        try:
            p = execute([node, str(cli)], target, child_env, success=False)
            assert ("Local startup port " + str(port) + " is unavailable").encode() in p.stderr
            assert owner.getsockname()[1] == port and facts(target) == before
            checks.append("The real preflight refuses an occupied database port while preserving its listening owner")
            bootstrap = target / "dev/copypaste-delivery/scripts/bootstrap-source-demo-158.mjs"
            p = execute([node, str(bootstrap)], target, child_env, success=False)
            assert ("Local startup port " + str(port) + " is unavailable").encode() in p.stderr
            assert owner.getsockname()[1] == port and facts(target) == before
            assert all(not (target / ("dev/copypaste-" + c + "/node_modules")).exists() for c in ["platform", "web", "admin", "desktop", "extension", "delivery"])
            checks.append("The patched bootstrap refuses the conflict before runtime preparation, dependency installation or configuration writes")
        finally:
            owner.close()
        available = {n.removeprefix(prefix) for n in original_entries}
        available.update(f["path"] for f in manifest["files"])
        links = 0
        for name in ["START-HERE.md", "docs/releases/v0.1.0-rc.3-onboarding-162.md"]:
            for link in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", (target / name).read_text(encoding="utf-8")):
                link = link.split("#")[0]
                if not link or "://" in link:
                    continue
                dest = posixpath.normpath(str(PurePosixPath(name).parent / link))
                assert not dest.startswith("../") and dest in available, (name, link)
                links += 1
        assert links >= 6
        checks.append("Every new root and bilingual-guide local link resolves to a real frozen or patched archive entry")
        assert digest(parent_index) == index_before
        for p, h in source_hashes.items():
            assert digest(DEV / p) == h, p
    except Exception as e:
        error = type(e).__name__ + ": " + str(e)
    finally:
        archive.close()
        log.close()
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed" if error is None and len(checks) == 9 else "failed", "checks": checks, "error": error, "source_files": source_hashes, "patch_manifest_sha256": digest(package / "patch-manifest.json"), "private_log": log_path.relative_to(DELIVERY).as_posix(), "private_log_sha256": digest(log_path), "verifier_sha256": digest(Path(__file__)), "scope": "Nine real patch/CLI checks; owned synthetic file fixtures and loopback probes only. No dependency install, database, browser, model or broad regression."}
    evidence = DELIVERY / "evidence/onboarding-162" / ("qualification-" + attempt + ".json")
    evidence.parent.mkdir(parents=True, exist_ok=True)
    with evidence.open("x", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": result["status"], "checks": len(checks), "error": error, "evidence": str(evidence)}, ensure_ascii=False))
    assert result["status"] == "passed"


if __name__ == "__main__":
    main()
