"""Review the six independent source trees without printing secret contents."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse
import hashlib
import json
import os
import re
import subprocess

DELIVERY = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get('COPYPASTE_DEV_ROOT', DELIVERY.parent)).resolve()
NAMES = ['copypaste-platform', 'copypaste-web', 'copypaste-admin',
         'copypaste-extension', 'copypaste-desktop', 'copypaste-delivery']
issues, reviewed = [], []
secrets = set()
env_file = ROOT / 'copypaste-platform/.env'
if env_file.is_file():
    for line in env_file.read_text(encoding='utf-8-sig').splitlines():
        if not line or line.startswith('#') or '=' not in line:
            continue
        name, value = line.split('=', 1)
        value = value.strip().strip('"\'')
        if name in ['MASTER_KEY', 'AI_API_KEY', 'S3_SECRET_KEY'] and len(value) >= 16:
            secrets.add(value)
        if name.endswith('DATABASE_URL') or name == 'SMTP_URL':
            password = urlparse(value).password
            if password and len(password) >= 16:
                secrets.add(password)

for name in NAMES:
    repo = ROOT / name
    top = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=repo).decode().strip()
    if Path(top).resolve() != repo:
        issues.append(f'{name}: not an independent Git repository')
    files = sorted(set(subprocess.check_output(
        ['git', 'ls-files', '-c', '-o', '--exclude-standard', '-z'], cwd=repo
    ).decode('utf-8').split('\0')) - {''})
    for filename in files:
        p = repo / filename
        if not p.is_file():
            issues.append(f'{name}/{filename}: tracked file missing')
            continue
        parts = p.relative_to(repo).parts
        if any(x in parts for x in ['node_modules', '.data', 'dist', 'renderer-dist', 'release']) or p.name == '.env':
            issues.append(f'{name}/{filename}: private or generated path would be committed')
        if p.suffix.lower() in ['.png', '.ico', '.jpg', '.woff2', '.ttf', '.pdf']:
            continue
        try:
            text = p.read_text(encoding='utf-8')
        except UnicodeError:
            continue
        if any(secret in text for secret in secrets):
            issues.append(f'{name}/{filename}: matches an actual local secret (suppressed)')
        if re.search(r'(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', text):
            issues.append(f'{name}/{filename}: credential pattern (suppressed)')
        for match in re.findall(r'(?:postgres|postgresql)://[^\s"\']+:[^\s"\']+@', text):
            if not any(placeholder in match for placeholder in ['local-only', '<', '${']):
                issues.append(f'{name}/{filename}: unexpected database credential literal (suppressed)')
                break
    for filename in ['README.md', 'README.en.md']:
        p = repo / filename
        text = p.read_text(encoding='utf-8')
        if '```mermaid' not in text:
            issues.append(f'{name}/{filename}: missing logic diagram')
        screenshots = 0
        for link in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)', text):
            if link.startswith(('https:', 'http:', 'mailto:', '#')):
                continue
            target = (p.parent / link.split('#')[0]).resolve()
            if not target.is_relative_to(repo) or not target.is_file():
                issues.append(f'{name}/{filename}: invalid local link {link}')
            elif target.suffix == '.png':
                screenshots += 1
        if not screenshots:
            issues.append(f'{name}/{filename}: missing real screenshot')
    reviewed.append({'repository': name, 'candidate_files': len(files), 'bilingual_readmes': True})

for name, manifest, prefix in [('copypaste-desktop', 'renderer-source.json', 'renderer'),
                               ('copypaste-admin', 'shared-source.json', '')]:
    repo = ROOT / name
    data = json.loads((repo / manifest).read_text(encoding='utf-8'))
    for filename, expected in data['files'].items():
        p = repo / prefix / filename
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != expected:
            issues.append(f'{name}/{filename}: provenance hash mismatch')

report = {'at': datetime.now(timezone.utc).isoformat(),
          'status': 'failed' if issues else 'passed',
          'scope': 'source paths, independent repositories, README links/diagrams/screenshots, local-secret exclusion and source provenance',
          'repositories': reviewed, 'issues': issues,
          'limits': ['Not a complete dependency vulnerability audit or proof of absence of all possible secrets']}
(DELIVERY / 'evidence').mkdir(exist_ok=True)
(DELIVERY / 'evidence/repository-review.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
raise SystemExit(bool(issues))
