"""Build a small exact-source patch without rewriting frozen archives."""
from pathlib import Path
from hashlib import sha256
import difflib
import json
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
BASE = DELIVERY / "release/workmate-v0.1.0-rc.3"
SOURCE_ROOT = "workmate-v0.1.0-rc.3-source/"


def digest(b):
    return sha256(b).hexdigest()


def main():
    attempt = sys.argv[1]
    assert attempt.isdigit() and len(attempt) == 2
    directory = DELIVERY / "release" / ("onboarding-162-attempt-" + attempt)
    directory.mkdir(parents=True, exist_ok=False)
    manifest = json.loads((BASE / "release-manifest.json").read_bytes())
    source = BASE / next(a["file"] for a in manifest["artifacts"] if a["file"].endswith("-buildable-sources.zip"))
    names = ["dev/copypaste-delivery/package.json", "dev/copypaste-delivery/scripts/bootstrap-source-demo-158.mjs", "dev/copypaste-delivery/scripts/source-demo-port-preflight-162.mjs", "dev/copypaste-delivery/scripts/source-preflight-162.mjs", "docs/releases/v0.1.0-rc.3-onboarding-162.md"]
    current = {n: (ROOT / n).read_bytes() for n in names}
    current["START-HERE.md"] = ("# Workmate rc.3 · 首次启动 / First start\n\n已应用源码启动补丁。先选择数据库端口，再检查并安装；本地配置与固定运行时保持。\n\nThe source onboarding patch is applied. Select the database port before checking and installing. Local configuration and pinned runtime files stay preserved.\n\n[中英完整步骤 / Complete bilingual steps](docs/releases/v0.1.0-rc.3-onboarding-162.md) · [冻结版说明 / Frozen release](docs/releases/v0.1.0-rc.3.md)\n\n![原始实际首单 / Original actual first task](docs/assets/release-freeze-158/workmate-source-handoff-158-04-first-task-delivered.png)\n\n![原始实际交互 / Original actual interaction](docs/assets/release-freeze-158/workmate-source-handoff-158-04-first-source-task.gif)\n").encode()
    facts, changes = [], []
    with zipfile.ZipFile(source) as z:
        entries = set(z.namelist())
        for name, new in sorted(current.items()):
            old = z.read(SOURCE_ROOT + name) if SOURCE_ROOT + name in entries else None
            assert old != new, name
            facts.append({"path": name, "before_sha256": digest(old) if old is not None else None, "after_sha256": digest(new)})
            changes.append("diff --git a/" + name + " b/" + name + "\n")
            if old is None:
                changes.append("new file mode 100644\n")
            old_lines = old.decode("utf-8").splitlines(keepends=True) if old is not None else []
            new_lines = new.decode("utf-8").splitlines(keepends=True)
            changes.extend(difflib.unified_diff(old_lines, new_lines, fromfile="a/" + name if old is not None else "/dev/null", tofile="b/" + name, n=max(len(old_lines), len(new_lines)) + 1))
    patch = "".join(changes).encode()
    applier = (DELIVERY / "scripts/apply-onboarding-patch-162.mjs").read_bytes()
    record = {"stage": 162, "base_release": "v0.1.0-rc.3", "source_root": SOURCE_ROOT.rstrip("/"), "patch_file": "onboarding-162.patch", "patch_sha256": digest(patch), "applier_sha256": digest(applier), "files": facts, "scope": "Exact-source onboarding overlay; existing environment, data and runtime binaries are excluded"}
    payload = {"onboarding-162.patch": patch, "apply-onboarding-patch-162.mjs": applier, "patch-manifest.json": (json.dumps(record, ensure_ascii=False, indent=2) + "\n").encode()}
    guide = (ROOT / "docs/releases/v0.1.0-rc.3-onboarding-162.md").read_text(encoding="utf-8")
    guide = guide.replace("](../assets/release-freeze-158/", "](assets/").replace("](v0.1.0-rc.3.md)", "](https://github.com/copypasteltd/workmate/blob/v0.1.0-rc.3/docs/releases/v0.1.0-rc.3.md)").replace("](../quality/remaining-work-stage160.md)", "](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage160.md)")
    payload["README.md"] = guide.encode()
    for name in ["workmate-source-handoff-158-04-first-task-delivered.png", "workmate-source-handoff-158-04-first-source-task.gif"]:
        payload["assets/" + name] = (ROOT / "docs/assets/release-freeze-158" / name).read_bytes()
    for name, body in payload.items():
        p = directory / name
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("xb") as f:
            f.write(body)
    complete = directory / "workmate-v0.1.0-rc.3-onboarding-162.zip"
    prefix = "workmate-v0.1.0-rc.3-onboarding-162/"
    with zipfile.ZipFile(complete, "x", zipfile.ZIP_DEFLATED, compresslevel=1) as z:
        for name, body in payload.items():
            z.writestr(prefix + name, body)
    with (directory / (complete.name + ".sha256")).open("x", encoding="utf-8", newline="\n") as f:
        f.write(digest(complete.read_bytes()) + "  " + complete.name + "\n")
    print(json.dumps({"status": "prepared", "attempt": attempt, "directory": str(directory), "archive_bytes": complete.stat().st_size, "archive_sha256": digest(complete.read_bytes()), "files": len(facts)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
