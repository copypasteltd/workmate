"""Drive the existing fixed-inventory verifier; never hide or retry a failure."""
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / "dev/copypaste-delivery"

parser = argparse.ArgumentParser()
parser.add_argument("attempt")
args = parser.parse_args()
assert len(args.attempt) == 2 and args.attempt.isdigit()
prefix = DELIVERY / ("evidence/desktop-execution-control-" + args.attempt)
assert not prefix.with_suffix(".json").exists()
assert not Path(str(prefix) + "-plan.json").exists(), "Resume an existing plan explicitly through its recorded verifier"
env = os.environ.copy()
env["COPYPASTE_LOCAL_CODEX_TEST_BIN"] = r"C:\Users\carzy\AppData\Local\OpenAI\Codex\bin\6257d9e8f63c0f2b\codex.exe"
node = "node"
command = [node, "scripts/run-desktop-platform-resumable.mjs", args.attempt]
subprocess.run(command + ["--init"], cwd=DELIVERY, env=env, check=True)
plan = json.loads(Path(str(prefix) + "-plan.json").read_text(encoding="utf-8"))
assert len(plan["files"]) == 64 and len(plan["batches"]) == 16
for batch in plan["batches"]:
    print("VERIFY BATCH " + batch["id"] + ": " + ", ".join(batch["files"]), flush=True)
    subprocess.run(command + ["--next"], cwd=DELIVERY, env=env, check=True)
subprocess.run(command + ["--finish"], cwd=DELIVERY, env=env, check=True)
report = json.loads(prefix.with_suffix(".json").read_text(encoding="utf-8"))
assert report["status"] == "passed" and report["counts"]["tests"] == 830
print(json.dumps({"status": report["status"], "counts": report["counts"], "inventory": 64, "batches": 16}), flush=True)
