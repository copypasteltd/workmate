"""Make a contact sheet from immutable, hash-checked actual UI captures."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("ui")
args = parser.parse_args()
assert len(args.ui) == 2 and args.ui.isdigit()
report = json.loads((ROOT / f"dev/copypaste-delivery/evidence/desktop-local-ui-{args.ui}-journey.json").read_text(encoding="utf-8"))
assert report["status"] == "passed" and len(report["screenshots"]) == 17
sheet = Image.new("RGB", (1600, 5 * 316), "#e7ebf3")
draw = ImageDraw.Draw(sheet)
for n, item in enumerate(report["screenshots"]):
    file = ROOT / "dev" / item["path"]
    assert sha256(file.read_bytes()).hexdigest() == item["sha256"]
    with Image.open(file) as original:
        image = original.convert("RGB")
        image.thumbnail((390, 280))
        x, y = (n % 4) * 400, (n // 4) * 316
        sheet.paste(image, (x + 5, y + 24))
        draw.text((x + 5, y + 5), file.stem.replace("workmate-local-" + args.ui + "-", ""), fill="#17202c")
target = ROOT / f"docs/design/implementation/workmate-local-{args.ui}-review.png"
assert not target.exists()
sheet.save(target)
print(json.dumps({"path": target.relative_to(ROOT).as_posix(), "screenshots": 17, "sha256": sha256(target.read_bytes()).hexdigest()}))
