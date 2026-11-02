#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from hashlib import sha256
import json,os
cfg=Path('/root/cfg/workmate')
report=json.loads((cfg/'operator-mailbox-185-deployment.sanitized.json').read_bytes())
assert report['status']=='mailbox_ui_deployed'
for name in ['/opt/workmate/nginx/operator.html','/opt/workmate/nginx/mailbox/index.html']:
 assert sha256(Path(name).read_bytes()).hexdigest()==report['source_sha256']
for name,h in report['protected_configuration_hashes'].items():assert sha256(Path(name).read_bytes()).hexdigest()==h
readme=cfg/'DEPLOYMENT-README.md';old=readme.read_bytes()
backup=cfg/'operator-mailbox-185-v1/DEPLOYMENT-README.before.md'
with backup.open('xb') as f:f.write(old)
backup.chmod(0o600)
note='''

## Test inbox repair / 测试收件箱修复 — stage185

Entry: https://agent-dashboard.copypaste.hk/ops/mailbox/
Use the existing independent operator credentials in this directory; administrator sign-in additionally requires its existing TOTP.
The newest messages now sort by parsed time before the 30-message limit. The page checks every5 seconds after completion and on return to the tab; manual refresh and visible recoverable errors remain available.
Canonical source: delivery branch deploy/operator-mailbox/index.html. Static files: /opt/workmate/nginx/operator.html and /opt/workmate/nginx/mailbox/index.html.
Prior static bytes: /root/cfg/workmate/operator-mailbox-185-v1/. Deployment receipt: operator-mailbox-185-deployment.sanitized.json.
No SMTP switch, credentials change, database migration or service restart was performed. Public OTP delivery and OTP/TOTP administrator sign-in were verified in a real browser; the QA session was signed out.
新邮件置顶、自动检查和手动刷新已修复；继续使用既有测试收件箱凭证，管理员仍须TOTP。后续完整部署应使用仓库中的新版收件箱页面。
'''
assert b'## Test inbox repair /' not in old
temp=readme.with_name('DEPLOYMENT-README.stage185.tmp')
with temp.open('xb') as f:f.write(old+note.encode());f.flush();os.fsync(f.fileno())
temp.chmod(0o600);os.replace(temp,readme)
print(json.dumps({'stage':185,'status':'deployment_notes_updated','credentials_unchanged':True,'static_source_sha256':report['source_sha256']}))
PY
