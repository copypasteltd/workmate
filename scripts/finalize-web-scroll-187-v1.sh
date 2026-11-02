#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime, timezone
import json, os
cfg = Path('/root/cfg/workmate')
receipt = json.loads((cfg / 'web-scroll-187-deployment.sanitized.json').read_bytes())
assert receipt['status'] == 'web_ui_deployed'
assert receipt['served_index_and_styles_match']
target = cfg / 'DEPLOYMENT-README.md'
assert target.is_file() and not target.is_symlink()
old = target.read_bytes()
marker = b'<!-- web-scroll-187 -->'
assert marker not in old
backup = cfg / 'web-scroll-187-v1/DEPLOYMENT-README.before.md'
with backup.open('xb') as f:
    f.write(old)
os.chmod(backup, 0o600)
note = '''\n\n<!-- web-scroll-187 -->
## Web scroll surfaces / 网页滚动区域 · 187

Web static root: /opt/workmate/overlays/web-scroll-187-v1/web/dist
Public URL: https://agent.copypaste.hk ; LAN: http://192.168.31.20:63070
Page, sidebar, conversation and modal outer rails are hidden; wheel/touch/key scrolling remains native. Necessary inner tables/panels use theme-derived thin rails. Narrow layouts wrap rather than overflow the page.
页面、侧栏、对话及弹窗外层隐藏滚动条；保留原生滚动。必要的内部表格和面板统一细款浅深色样式；窄屏换行，宽表格在自身范围滚动。
Build: TypeScript + Vite passed. Actual owned-LAN browser qualification: 10 related checks passed, including desktop/mobile, wheel scrolling, long modal and contained wide table. This is not complete product or public HTTPS journey acceptance.
Rollback: restore /root/cfg/workmate/web-scroll-187-v1/nginx.before.conf to /opt/workmate/nginx/nginx.conf, validate the owned Nginx configuration, then reload workmate-lan-proxy.service. This restores the prior stage184 Web root. No API/database restart or schema migration is needed.
回滚：恢复上述 Nginx 备份至原配置，先校验，再只重载 workmate-lan-proxy.service。API、数据库、后台及收件箱配置保持原样。
Archive SHA256: 3b7abb0139e980e7abec401c47dbf7222a40b215ece0f4f5407146e1f93ab5ff
'''.encode()
with target.open('wb') as f:
    f.write(old + note)
os.chmod(target, 0o600)
assert target.read_bytes().startswith(old)
out = {'stage': 187, 'status': 'deployment_note_appended',
       'at': datetime.now(timezone.utc).isoformat(),
       'prior_document_bytes_preserved': True, 'document_mode': '0600'}
with (cfg / 'web-scroll-187-note.sanitized.json').open('x') as f:
    json.dump(out, f, indent=2)
    f.write('\n')
print(json.dumps(out))
PY
