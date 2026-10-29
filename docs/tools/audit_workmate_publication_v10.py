"""Keep historical evidence and verify committed customer-local startup Git and media proofs."""
from pathlib import Path
from hashlib import sha256
import argparse
import contextlib
import io
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', required=True)
    parser.add_argument('--media', required=True)
    parser.add_argument('--verify-only', action='store_true', required=True)
    args = parser.parse_args()
    legacy = subprocess.run([sys.executable, str(ROOT / 'docs/tools/audit_workmate_publication.py'),
                             '--report', args.report, '--media', args.media, '--verify-only'],
                            cwd=ROOT, capture_output=True, check=True)
    history = json.loads(legacy.stdout)
    assert history['status'] == 'passed'
    from finalize_local_startup_manifest_v1 import verify
    with contextlib.redirect_stdout(io.StringIO()):
        proof = verify()
    assert proof['status'] == 'passed' and proof['proofs_checked_from_actual_committed_git_blobs'] > 0
    print(json.dumps({'status': 'passed', 'historical_blobs': history['historical_blobs'],
                      'links': history['links'], 'problems': 0,
                      'committed_proofs': proof['proofs_checked_from_actual_committed_git_blobs'],
                      'proof_shards': proof['proof_shards_checked'],
                      'proof_verifier_sha256': proof['verifier_sha256'],
                      'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
