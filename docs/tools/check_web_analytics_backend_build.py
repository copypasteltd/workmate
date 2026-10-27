"""Build the qualified backend and import its compiled modules from another cwd."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PLATFORM = ROOT / 'dev/copypaste-platform'
QUALITY = ROOT / 'docs/quality'
CP = QUALITY / 'web-analytics-checkpoint.json'
OUTPUT = QUALITY / 'web-analytics-backend-build-01.json'
LOG = QUALITY / 'web-analytics-backend-build-01.log'
assert not OUTPUT.exists() and not LOG.exists()
checkpoint = json.loads(CP.read_text(encoding='utf-8'))
assert checkpoint['status'] == 'verified_web_analytics'
def digest(path):
    return sha256(path.read_bytes()).hexdigest()
def check_sources():
    for name, expected in checkpoint['source_files'].items():
        assert digest(ROOT / name) == expected, name
check_sources()
checks, raw = [], bytearray()
try:
    steps = [(['node', 'node_modules/typescript/bin/tsc'], PLATFORM),
             (['node', 'scripts/copy-cloud-check-bootstrap.mjs'], PLATFORM),
             (['node', '--input-type=module', '-e',
               'const m=await import(process.argv[1]);if(typeof m.buildApp!=="function")throw new Error("Compiled server export missing");console.log("Compiled backend import passed from an unrelated working directory");',
               (PLATFORM / 'dist/src/server.js').as_uri()], ROOT / 'docs')]
    for args, cwd in steps:
        result = subprocess.run(args, cwd=cwd, capture_output=True, timeout=180)
        raw.extend(result.stdout); raw.extend(result.stderr)
        checks.append({'args': args, 'cwd': str(cwd), 'exit_code': result.returncode})
        assert result.returncode == 0, raw.decode('utf-8', errors='replace')[-3000:]
    check_sources()
    compiled = {p.relative_to(PLATFORM).as_posix(): digest(p) for p in
                [PLATFORM / 'dist/src/server.js', PLATFORM / 'dist/src/web-analytics.js',
                 PLATFORM / 'dist/src/connectors.js', PLATFORM / 'dist/src/connector-provider.js',
                 PLATFORM / 'dist/src/analysis-role-tools.js', PLATFORM / 'dist/src/catalog.js']}
except Exception:
    with LOG.open('xb') as stream:
        stream.write(raw)
    raise
with LOG.open('xb') as stream:
    stream.write(raw)
report = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
          'checkpoint_sha256': digest(CP), 'source_unchanged': True, 'source_files_rehashed': len(checkpoint['source_files']),
          'checks': checks, 'compiled_files': compiled, 'raw_log': {'path': LOG.relative_to(ROOT).as_posix(), 'sha256': digest(LOG)},
          'scope': 'Actual backend TypeScript emit, resource copy and compiled server import from docs cwd. No service/database/browser is started; this supplements the frozen native transaction and actual browser qualification.',
          'verifier_sha256': digest(Path(__file__))}
with OUTPUT.open('x', encoding='utf-8', newline='\n') as stream:
    stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'build_checks': len(checks), 'sources_rehashed': len(checkpoint['source_files'])}))
