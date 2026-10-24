"""Capture the live owned fixture's Fetch-blocked port before stopping it."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'docs/quality/managed-video-blocked-port-review.json'


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--owner', type=int, required=True)
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    assert args.owner > 0 and args.port == 2049 and not OUTPUT.exists()
    command = f"$owned = Get-CimInstance Win32_Process -Filter 'ProcessId = {args.owner}'; "
    command += "$sockets = @(Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -eq " + str(args.owner) + " }); "
    command += "$ancestors = @(); $cursor = $owned; for ($step = 0; $step -lt 8 -and $cursor; $step++) { $ancestors += $cursor.ProcessId; $cursor = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $cursor.ParentProcessId) }; "
    command += "@{ process_id = $owned.ProcessId; parent_process_id = $owned.ParentProcessId; command_line = $owned.CommandLine; ancestors = $ancestors; sockets = @($sockets | Select-Object LocalAddress,LocalPort,OwningProcess) } | ConvertTo-Json -Depth 4 -Compress"
    raw = subprocess.check_output(['pwsh', '-NoProfile', '-Command', command], cwd=ROOT)
    owner = json.loads(raw.decode('utf-8-sig'))
    assert owner['process_id'] == args.owner
    assert 'capability-video-verification.test.ts' in owner['command_line']
    lock = json.loads((ROOT / 'dev/copypaste-delivery/.data/desktop-platform-29.lock').read_text(encoding='utf-8'))
    assert lock['pid'] in owner['ancestors'] and lock['batch'] == '07'
    sockets = owner['sockets']
    assert any(row['LocalAddress'] == '127.0.0.1' and row['LocalPort'] == args.port and row['OwningProcess'] == args.owner for row in sockets)
    # GET is read-only. Fetch must reject before connecting to this exact
    # owned synthetic provider; the result records the actual runtime cause.
    javascript = "fetch('http://127.0.0.1:2049/v1/videos').then(()=>{process.exitCode=1}).catch(e=>process.stdout.write(JSON.stringify({name:e.name,message:e.message,cause:e.cause?.message})))"
    probe = json.loads(subprocess.check_output(['node', '-e', javascript], cwd=ROOT / 'dev/copypaste-platform'))
    assert probe['cause'] == 'bad port'
    tap = ROOT / 'dev/copypaste-delivery/evidence/desktop-execution-control-29-batch-07-attempt-01.tap'
    observed = tap.read_bytes()
    assert b'not ok 2 - all 15 actual MP4 specifications' in observed and b'AI_UPSTREAM_UNCERTAIN' in observed
    archive = ROOT / 'docs/quality/history/stage81-blocked-port-observed.tap'
    with archive.open('xb') as stream:
        stream.write(observed)
    fixture = ROOT / 'dev/copypaste-platform/tests/capability-video-fixture.ts'
    helper = ROOT / 'dev/copypaste-platform/src/loopback-http.ts'
    assert 'server.listen(0, "127.0.0.1"' in fixture.read_text(encoding='utf-8')
    assert '2049' in helper.read_text(encoding='utf-8')
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'confirmed_test_fixture_failure',
        'process_id': args.owner, 'parent_process_id': owner['parent_process_id'],
        'owned_ancestor_ids': owner['ancestors'], 'batch_owner_pid': lock['pid'],
        'owned_command_sha256': sha256(owner['command_line'].encode()).hexdigest(), 'owned_listening_sockets': sockets,
        'actual_node_fetch_probe': probe,
        'observed_tap_prefix': {'path': archive.relative_to(ROOT).as_posix(), 'sha256': digest(archive), 'bytes': len(observed)},
        'raw_attempt': tap.relative_to(ROOT).as_posix(),
        'fixture_sha256': digest(fixture), 'existing_safe_loopback_helper_sha256': digest(helper),
        'cause': 'The new synthetic provider used direct ephemeral listen and received port 2049. Node Fetch rejects that port before HTTP, leaving truthful unknown results. The existing owned loopback helper already handles blocked ephemeral ports.',
        'required_repair': 'Use the existing loopback helper in the fixture and bound its takeover-test arrival wait. Preserve failed attempt and rerun qualification with changed test bytes. No failed test is relabeled as passed.',
        'verifier_sha256': digest(Path(__file__))}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'owner': args.owner, 'port': args.port, 'actual_fetch_cause': probe['cause']}))


if __name__ == '__main__':
    main()
