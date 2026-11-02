#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from urllib.parse import urlsplit
import hashlib,json,re,subprocess
cfg=Path('/root/cfg/workmate');env={}
for line in (cfg/'app.env').read_text().splitlines():
 if not line.strip() or line.lstrip().startswith('#') or '=' not in line:continue
 k,v=line.split('=',1);env[k.strip()]=v.strip().strip('"').strip("'")
safe={k:env.get(k) for k in ['NODE_ENV','DEV_MAILBOX','MAIL_FROM']};safe['smtp_configured']=bool(env.get('SMTP_URL'))
if env.get('SMTP_URL'):
 u=urlsplit(env['SMTP_URL']);safe['smtp_host']=u.hostname;safe['smtp_port']=u.port;safe['smtp_scheme']=u.scheme;safe['smtp_has_credentials']=bool(u.username and u.password)
pid=subprocess.check_output(['systemctl','show','workmate-api.service','--value','-p','MainPID'],text=True).strip()
process={}
for item in Path('/proc/'+pid+'/environ').read_bytes().split(b'\0'):
 k,_,v=item.partition(b'=')
 if k.decode(errors='replace') in ['NODE_ENV','DEV_MAILBOX']:process[k.decode()]=v.decode()
 if k==b'SMTP_URL':process['smtp_configured']=bool(v)
safe['live_process']=process
hints=[]
for p in Path('/root/cfg').rglob('*'):
 if not p.is_file() or p.is_symlink() or p.stat().st_size>1024*1024 or len(p.relative_to('/root/cfg').parts)>5:continue
 try:content=p.read_text(encoding='utf8')
 except (UnicodeError,OSError):continue
 keys=[]
 for line in content.splitlines():
  match=re.match(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]',line)
  if match and re.search(r'SMTP|MAILER|MAIL_FROM|RESEND|SENDGRID|MAILGUN|BREVO|EMAIL.*(?:HOST|SERVER|USER|PASS|KEY|TOKEN)',match.group(1),re.I):keys.append(match.group(1))
 if keys:hints.append({'path':str(p),'keys':sorted(set(keys))})
report={'stage':185,'operation':'read_only_email_configuration_inspection','application':safe,'configuration_hints':hints,'app_env_sha256':hashlib.sha256((cfg/'app.env').read_bytes()).hexdigest()}
with (cfg/'email-delivery-185-inspection.sanitized.json').open('x') as f:json.dump(report,f,indent=2)
print(json.dumps(report))
PY
