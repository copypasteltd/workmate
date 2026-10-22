"""Refresh unbundled renderer provenance without changing qualified runtime."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DESKTOP = DEV / "copypaste-desktop"
DELIVERY = DEV / "copypaste-delivery"


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


checkpoint = json.loads((ROOT / "docs/quality/desktop-native-input-checkpoint.json").read_text(encoding="utf-8"))
ui_path = DELIVERY / f"evidence/desktop-local-ui-{checkpoint['selected']['ui']}.json"
ui = json.loads(ui_path.read_text(encoding="utf-8"))
assert ui["status"] == "passed" and ui["source_unchanged"]
for name, expected in ui["source_files"].items():
    assert digest(DEV / name) == expected, name
manifest_path = DESKTOP / "renderer-source.json"
before = manifest_path.read_bytes()
prior = json.loads(before)
files = {}
for file in (DESKTOP / "renderer").rglob("*"):
    assert not file.is_symlink()
    if file.is_file():
        files[file.relative_to(DESKTOP / "renderer").as_posix()] = digest(file)
changed = sorted(name for name in set(files) | set(prior["files"]) if files.get(name) != prior["files"].get(name))
assert changed == ["src/local-agent.css", "src/local-agent.tsx"]
asar = (DELIVERY / ui["packaged"]["executable"]).resolve().parent / "resources/app.asar"
assert digest(asar) == ui["packaged"]["app_asar_sha256"]
script = "import {listPackage} from '@electron/asar'; const names=listPackage(process.argv[1]); if(names.some(name=>name.replaceAll('\\\\','/').endsWith('/renderer-source.json'))) throw Error('Manifest must not affect the qualified package'); console.log(JSON.stringify({entries:names.length,renderer_manifest_bundled:false}));"
inspection = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script, str(asar)], cwd=DESKTOP, text=True))
assert inspection["renderer_manifest_bundled"] is False
archive = ROOT / "docs/quality/history/stage74-renderer-manifest-before.json"
output = ROOT / "docs/quality/desktop-native-input-renderer-manifest-01.json"
assert not archive.exists() and not output.exists()
subprocess.run(["node", "scripts/record-renderer.mjs"], cwd=DESKTOP, capture_output=True, check=True)
after = json.loads(manifest_path.read_text(encoding="utf-8"))
assert after["files"] == files
assert {key: value for key, value in after.items() if key != "files"} == {key: value for key, value in prior.items() if key != "files"}
differences = [name for name, expected in ui["source_files"].items() if digest(DEV / name) != expected]
assert differences == ["copypaste-desktop/renderer-source.json"]
assert digest(asar) == ui["packaged"]["app_asar_sha256"]
with archive.open("xb") as stream:
    stream.write(before)
result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed_runtime_unchanged_metadata_refreshed",
    "scope": "Only the unbundled renderer provenance JSON changes after UI qualification. Every runtime/source file in that report and the actual packaged ASAR remains unchanged. This is a metadata check, not another native or UI run.",
    "qualification_report": {"path": ui_path.relative_to(ROOT).as_posix(), "sha256": digest(ui_path)},
    "allowed_difference": {"path": "copypaste-desktop/renderer-source.json", "before_sha256": sha256(before).hexdigest(), "after_sha256": digest(manifest_path)},
    "previous_manifest": {"path": archive.relative_to(ROOT).as_posix(), "sha256": digest(archive)},
    "manifest_entries_verified": len(files), "updated_renderer_entries": changed,
    "other_qualified_sources_unchanged": len(ui["source_files"]) - 1, "qualified_package": ui["packaged"], "asar_inspection": inspection,
    "verifier_sha256": digest(Path(__file__))}
with output.open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": result["status"], "manifest_entries": len(files), "unchanged_other_sources": result["other_qualified_sources_unchanged"]}))
