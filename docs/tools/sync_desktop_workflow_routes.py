"""Copy the real native workflow probe's captured inventory, never design routes."""
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source = ROOT / "dev/copypaste-delivery/evidence/desktop-workflows-native-03-routes.json"
proof = json.loads(source.with_name("desktop-workflows-native-03.json").read_text(encoding="utf-8"))
assert proof["status"] == "passed" and proof["source_unchanged"]
target = ROOT / "dev/copypaste-platform/contracts/implemented-routes.json"
old = json.loads(target.read_text(encoding="utf-8"))
new = json.loads(source.read_text(encoding="utf-8"))
before = {(r["method"], r["path"]) for r in old["routes"]}
after = {(r["method"], r["path"]) for r in new["routes"]}
assert before <= after and len(after) == len(new["routes"]) == 428
assert len([p for method, p in after if "/desktop-executions/:execution/workflow-runs/:run" in p]) == 3
assert new["not_full_design_openapi"] is True
for file in (target, ROOT / "docs/contracts/implemented-routes.json"):
    file.write_bytes(source.read_bytes())
receipt = ROOT / "docs/quality/desktop-workflow-route-inventory.json"
if not receipt.exists():
    receipt.write_text(json.dumps({"source": source.relative_to(ROOT).as_posix(), "source_sha256": sha256(source.read_bytes()).hexdigest(),
        "previous_route_count": len(before), "current_route_count": len(after), "removed": [], "added": sorted(after - before),
        "scope": "Actual Fastify method/path inventory, including backfilled native execution and media-status routes; not a full design OpenAPI or runtime acceptance claim."}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Actual 428-route inventory synchronized; all 415 previous routes retained.")
