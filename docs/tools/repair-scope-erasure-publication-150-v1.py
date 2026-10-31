"""Forward-only publication metadata repair; no product runtime changes or test rerun."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json

ROOT = Path(r"D:\dev\copypasted\自有agent")
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
checkpoint = ROOT / "docs/quality/scope-erasure-checkpoint-150.json"
cp = json.loads(checkpoint.read_bytes())
failure = DELIVERY / ".data/scope-erasure-150/publication-ce261be8-5b78-418d-965d-11b4eb5fc3cf/receipt.json"
receipt = json.loads(failure.read_bytes())
assert receipt["status"] == "failed" and receipt["commands"] == [] and receipt["components"] == []
assert receipt["failure"]["message"] == "copypaste-desktop/renderer/src/.gitattributes"

def digest(p):
    return sha256(p.read_bytes()).hexdigest()

sources = json.loads((DELIVERY / "evidence/scope-erasure-150/ui-04-sources.json").read_bytes())
relative = "copypaste-desktop/renderer/src/.gitattributes"
item = sources[relative]
old = (DELIVERY / item["path"]).read_bytes()
target = DEV / relative
suffix = b"\n# Stage150 exact qualified bytes.\nmain.tsx -text whitespace=cr-at-eol\nproject-management.tsx -text whitespace=cr-at-eol\nscope-*.tsx -text whitespace=cr-at-eol\nscope-erasure.css -text whitespace=cr-at-eol\n"
assert target.read_bytes() == old + suffix
target.write_bytes(old)
parent = DEV / "copypaste-desktop/renderer/.gitattributes"
assert not parent.exists()
parent.write_bytes(b"# Stage150 retains exact qualified renderer source bytes.\nsrc/main.tsx -text whitespace=cr-at-eol\nsrc/project-management.tsx -text whitespace=cr-at-eol\nsrc/scope-*.tsx -text whitespace=cr-at-eol\nsrc/scope-erasure.css -text whitespace=cr-at-eol\n")
for path, expected in cp["source_files"].items():
    assert digest(DEV / path) == expected, path
assert digest(DEV / "copypaste-desktop/.gitattributes") == cp["baseline"]["desktop_attributes_sha256"]

publisher = ROOT / "docs/tools/publish-scope-erasure-150-v2.py"
assert not publisher.exists()
text = (publisher.with_name("publish-scope-erasure-150-v1.py")).read_text(encoding="utf-8")
text = text.replace('"src", "renderer/src", "tests"', '"src", "renderer/src", "renderer/.gitattributes", "tests"')
text = text.replace("'renderer/src/.gitattributes'", "'renderer/.gitattributes'")
publisher.write_bytes(text.encode("utf-8"))
report = ROOT / "docs/quality/scope-erasure-publication-repair-150.json"
with report.open("x", encoding="utf-8", newline="\n") as f:
    json.dump({
        "at": datetime.now(timezone.utc).isoformat(),
        "status": "metadata_repaired_without_runtime_changes",
        "original_failure": {"path": failure.relative_to(ROOT).as_posix(), "sha256": digest(failure)},
        "source_checkpoint_sha256": digest(checkpoint),
        "restored_exact_qualified_attributes": {"path": relative, "sha256": digest(target)},
        "new_parent_attributes": {"path": parent.relative_to(DEV).as_posix(), "sha256": digest(parent)},
        "all_bound_source_bytes_match": True,
        "publisher_sha256": digest(publisher),
        "repairer_sha256": digest(Path(__file__)),
        "scope": "The first preflight stopped before any Git command, staging, commit or remote write. The recorder appended checkout attributes to an existing source-bound file. Restore that file exactly; add equivalent rules in a new parent metadata file. Original report, recorder, failed publisher and receipt remain immutable. Runtime sources and selected qualification stay exact; no regression rerun required."
    }, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(json.dumps({"status": "repaired", "all_bound_source_bytes_match": True, "next_publisher": str(publisher)}, ensure_ascii=False))
