"""Archive original attempts and assess the original TC-095 against bound evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re
import subprocess
from record_source_build_reproduction_v1 import credentials, scan

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
RAW = DELIVERY / "evidence/support-recovery-134"
OUT = ROOT / "docs/quality/support-recovery-evidence-134"
CP = ROOT / "docs/quality/support-recovery-checkpoint-134.json"
ACCEPTANCE = ROOT / "docs/quality/tc095-acceptance-134.json"
PREVIOUS = DELIVERY / ".data/support-access-133/publication-e5fd3449-bd25-430f-8cce-e2464a3bfce4/receipt.json"
COUNTS = {"related_backend_tests": 65, "new_support_recovery_tests": 6,
          "actual_admin_web_native_journey_checks": 18, "current_build_commands": 10,
          "native_bridge_boundary_tests": 1, "screenshots": 9, "recording_pairs": 5, "actual_layouts": 10}


def digest(body):
    return sha256(body).hexdigest()


def load(file):
    return json.loads(file.read_bytes())


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def ref(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file.read_bytes())}


def check_attempt(stem):
    row = load(RAW / (stem + ".json"))
    for key in ["source_manifest", "raw_report", "verifier"]:
        item = row[key]
        assert digest((DELIVERY / item["path"]).read_bytes()) == item["sha256"]
    sources = load(DELIVERY / row["source_manifest"]["path"])
    for name, item in sources.items():
        assert digest((DELIVERY / item["path"]).read_bytes()) == item["sha256"], name
    if row.get("journey"):
        item = row["journey"]
        assert digest((DELIVERY / item["path"]).read_bytes()) == item["sha256"]
    assert row["source_unchanged"] and row["owned_database_shutdown"]
    assert row.get("owned_database_port_closed", all(row.get("ports_closed", {}).values()))
    cleanup = load(RAW / (stem + "-fixture-cleanup.json"))
    assert cleanup["status"] == "passed" and all(r["reclaimed"] for r in cleanup["results"])
    assert digest((RAW / (stem + "-fixture-cleanup.json")).read_bytes()) == row["fixture_cleanup"]["sha256"]
    return row, sources


def acceptance(backend, journey):
    tap = (DELIVERY / backend["raw_report"]["path"]).read_text(encoding="utf-8")
    criteria = [
        ("095-01", "客服默认元数据；正文需独立权限及有效客户授权", "body requires both a current explicit grant and independent body permission"),
        ("095-02", "只读明确获准的用户、企业和项目", "scope is explicit: empty selection never includes projects"),
        ("095-03", "实际管理员、客户、范围与只读提示持续显示", "canonical grant/session/list/operation use original strict schemas"),
        ("095-04", "写入拒绝", "customer grant alone never grants body, VIP, billing or impersonation"),
        ("095-05", "付款拒绝", "customer grant alone never grants body, VIP, billing or impersonation"),
        ("095-06", "开通VIP拒绝", "customer grant alone never grants body, VIP, billing or impersonation"),
        ("095-07", "客户登录凭证读取拒绝", "customer grant alone never grants body, VIP, billing or impersonation"),
        ("095-08", "无隐身登录或新增客户凭证", "support diagnostics and body reads create no work, holds, charges, provider requests or customer sessions"),
        ("095-09", "真实时钟到期后立即拒绝，重试不能续期", "actual clock expiry ends a view without a worker"),
        ("095-10", "真实截止、撤销后页面清空", "revocation is immediate, one-way, audited, durable and idempotent"),
        ("095-11", "审计保留真实管理员身份", "support context denials retain the administrator in the audit"),
        ("095-12", "审计失败关闭且命令整体回滚", "a failing audit rolls back the support command"),
    ]
    rows = []
    for identifier, requirement, needle in criteria:
        lines = [(i + 1, line) for i, line in enumerate(tap.splitlines()) if re.match(r"ok \d+ - ", line) and needle in line]
        assert len(lines) == 1, needle
        rows.append({"id": identifier, "condition": requirement, "status": "passed",
                     "backend_tap": {**ref(DELIVERY / backend["raw_report"]["path"]), "line": lines[0][0], "passing_case": lines[0][1]}})
    assert any("permanent identity banner" in item for item in journey["checks"])
    assert any("Actual server-clock expiry" in item for item in journey["checks"])
    assert any("200 percent" in item for item in journey["checks"])
    return {"at": datetime.now(timezone.utc).isoformat(), "requirement": "REQ-095", "test_case": "TC-095",
            "status": "accepted_original_scope", "criteria": rows,
            "basis": [ref(ROOT / "docs/requirements/01-srs.md"), ref(ROOT / "docs/quality/01-test-and-acceptance-plan.md")],
            "backend": ref(RAW / "backend-01.json"), "actual_ui_journey": ref(RAW / (journey["attempt_stem"] + "-journey.json")),
            "ui_observations": journey["checks"], "original_execution_records_unchanged": True,
            "qualification": "Current source-bound native PostgreSQL, HTTP, independent email/TOTP administrator and customer OTP/PKCE, actual Web/Admin and unsigned native Desktop. Synthetic business data and no model calls.",
            "credential_boundary": "The actual journey asserts unchanged user/native sessions, refresh-token rows and native-authorization-code rows before and after support activity; stored bodies/credentials are not used for support impersonation.",
            "separate_open_requirements": {"REQ-055": "Whole-platform accessibility, screen readers, browser zoom and reduced-motion", "REQ-094": "Whole-platform role/action/field/concurrency matrix", "REQ-039": "Signed installation and remaining native platform qualification", "REQ-060": "Complete source delivery and reproduction acceptance"},
            "enlargement_methods": "Web/Admin CSS zoom=2; actual native Desktop webContents zoomFactor=2. These do not close whole-platform accessibility.",
            "policy_clarification": "Explicit revocation, expiry and changed identity/member versions cannot be revived by replay. Temporary project availability may recover for a fresh current-authorized query; cached bodies never reappear automatically."}


def verify():
    cp, index, accepted = load(CP), load(OUT / "index.json"), load(ACCEPTANCE)
    assert cp["status"] == "verified_support_recovery_and_original_tc095" and cp["counts"] == COUNTS
    assert cp["evidence_index"] == ref(OUT / "index.json") and cp["acceptance"] == ref(ACCEPTANCE)
    assert index["recorder_sha256"] == digest(Path(__file__).read_bytes())
    assert accepted["status"] == "accepted_original_scope" and len(accepted["criteria"]) == 12
    assert cp["required_open"] == 88 and cp["fully_accepted"] == 1 and cp["original_full_acceptance_open"] == 101
    needles, seen = credentials(), set()
    for row in index["originals"]:
        body = (OUT / row["archive"]).read_bytes()
        assert len(body) == row["bytes"] and digest(body) == row["sha256"]
        if row["sha256"] not in seen:
            scan(row["source"], body, needles)
            seen.add(row["sha256"])
    for name, identity in cp["source_files"].items():
        assert digest((ROOT / name).read_bytes()) == identity, name
    for item in [*cp["media_files"], *cp["failed_attempt_media"]]:
        assert digest((DEV / item["path"]).read_bytes()) == item["sha256"]
    assert cp["previous_checkpoint"] == ref(ROOT / "docs/quality/support-access-checkpoint-133.json")
    return {"status": "passed", "original_entries": len(index["originals"]), "unique_original_blobs": len(seen),
            "qualified_sources": len(cp["source_files"]), "actual_media_files": len(cp["media_files"]),
            "failed_attempt_media_retained": len(cp["failed_attempt_media"]), "accepted_requirement": "REQ-095"}


def record(ui):
    assert not CP.exists() and not OUT.exists() and not ACCEPTANCE.exists(), "Never rewrite original evidence"
    stems = sorted(p.stem for p in RAW.glob("*.json") if re.fullmatch(r"(?:backend|ui)-\d{2}", p.stem))
    attempts = {name: check_attempt(name) for name in stems}
    backend, sources_before = attempts["backend-01"]
    assert backend["status"] == "passed" and backend["counts"] == {"tests": 65, "pass": 65, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}
    selected = "ui-" + ui
    report, sources_ui = attempts[selected]
    journey = load(RAW / (selected + "-journey.json"))
    assert report["status"] == "passed" and report["source_unchanged"] and report["package_unchanged"]
    assert len(report["commands"]) == 11 and all(r["exit_code"] == 0 for r in report["commands"])
    assert journey["status"] == "passed" and len(journey["checks"]) == 18 and not journey["errors"]
    assert journey["model_calls"] == 0 and all(journey[k] for k in ["browser_closed", "desktop_closed", "api_closed", "fixture_closed"])
    assert len(journey["screenshots"]) == 9 and len(journey["recordings"]) == 5 and len(journey["layouts"]) == 10
    sources = {}
    for manifest in [sources_before, sources_ui]:
        for name, item in manifest.items():
            name = "dev/" + name
            if name in sources:
                assert sources[name] == item["sha256"], name
            sources[name] = item["sha256"]
            assert digest((ROOT / name).read_bytes()) == item["sha256"], name
    journey["attempt_stem"] = selected
    with ACCEPTANCE.open("xb") as stream:
        stream.write(encoded(acceptance(backend, journey)))
    previous = load(PREVIOUS)
    assert previous["status"] == "pushed_and_verified" and previous["raw_log_sha256"] == digest(PREVIOUS.with_name("commands.log").read_bytes())
    audit = ROOT / previous["incremental_history_and_links"]["path"]
    assert digest(audit.read_bytes()) == previous["incremental_history_and_links"]["sha256"]
    paths = sorted(p for p in RAW.rglob("*") if p.is_file()) + [PREVIOUS, PREVIOUS.with_name("commands.log"), audit, ACCEPTANCE]
    media, failed_media, decode = [], [], []
    for stem in stems:
        file = RAW / (stem + "-journey.json")
        if not file.exists():
            continue
        original = load(file)
        destination = media if stem == selected else failed_media
        current = list(original["screenshots"])
        for recording in original["recordings"]:
            assert recording["observed_frames"] >= 5 and recording["distinct_frames"] >= 2 and recording["skipped_capture_errors"] == 0
            folder = DEV / recording["raw_capture_directory"]
            assert folder.resolve().is_relative_to(DELIVERY / ".data/workmate-media")
            paths.extend(p for p in folder.rglob("*") if p.is_file())
            current.extend(recording["files"])
        for item in current:
            actual = DEV / item["path"]
            assert digest(actual.read_bytes()) == item["sha256"]
            paths.append(actual)
            if actual.suffix in [".png", ".gif", ".mp4"]:
                result = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-i", str(actual), "-f", "null", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                assert result.returncode == 0 and not result.stderr, actual.name
                decode.append({"path": item["path"], "sha256": item["sha256"], "exit_code": 0})
        destination.extend(current)
    originals, bodies, needles = [], {}, credentials()
    for file in sorted(set(paths)):
        body, name = file.read_bytes(), file.relative_to(ROOT).as_posix()
        identity = digest(body)
        if identity not in bodies:
            scan(name, body, needles)
            bodies[identity] = body
        originals.append({"source": name, "archive": "blobs/" + identity + ".blob", "sha256": identity, "bytes": len(body)})
    (OUT / "blobs").mkdir(parents=True)
    for identity, body in bodies.items():
        with (OUT / "blobs" / (identity + ".blob")).open("xb") as stream:
            stream.write(body)
    scope = "Actual native SQL, customer grant recovery and current original TC-095 acceptance; unsigned packaged Desktop, Web/Admin. Synthetic business data, no model or whole-platform runtime rerun."
    index = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed_support_recovery_and_original_tc095", "recorder_sha256": digest(Path(__file__).read_bytes()), "originals": originals,
             "failed_attempts": [name for name in stems if attempts[name][0]["status"] == "failed"], "qualified_attempts": ["backend-01", selected], "media_decode": decode, "scope": scope}
    with (OUT / "index.json").open("xb") as stream:
        stream.write(encoded(index))
    cp = {"at": index["at"], "status": "verified_support_recovery_and_original_tc095", "counts": COUNTS, "scope": scope,
          "evidence_index": ref(OUT / "index.json"), "previous_checkpoint": ref(ROOT / "docs/quality/support-access-checkpoint-133.json"), "acceptance": ref(ACCEPTANCE),
          "previous_publication_receipt": {"sha256": digest(PREVIOUS.read_bytes()), "archive": next(r["archive"] for r in originals if r["source"] == PREVIOUS.relative_to(ROOT).as_posix())},
          "source_files": sources, "media_files": media, "failed_attempt_media": failed_media, "qualified_attempts": ["backend-01", selected],
          "required_open": 88, "unconfirmed_suggestions": 12, "optional_open": 1, "fully_accepted": 1, "original_full_acceptance_open": 101,
          "whole_platform_runtime_rerun": False, "original_failure_records_retained": True, "model_calls": 0, "unsigned_native_package": True, "recorder": ref(Path(__file__))}
    with CP.open("xb") as stream:
        stream.write(encoded(cp))
    print(json.dumps(verify()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--record", action="store_true")
    group.add_argument("--verify", action="store_true")
    parser.add_argument("--ui-attempt", choices=[f"{i:02}" for i in range(1, 100)])
    args = parser.parse_args()
    if args.record:
        assert args.ui_attempt
        record(args.ui_attempt)
    else:
        print(json.dumps(verify()))
