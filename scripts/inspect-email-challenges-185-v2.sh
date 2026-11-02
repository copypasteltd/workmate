#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,subprocess
script='import pg from \'pg\';import {readFile} from \'node:fs/promises\';import path from \'node:path\';\nconst c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();\ntry{const rows=(await c.query("SELECT id,email,audience,created_at,consumed_at,expires_at FROM auth_challenges WHERE purpose=\'login\' ORDER BY created_at DESC LIMIT 12")).rows;const facts=[];\nfor(const row of rows){let local=false;try{const mail=JSON.parse(await readFile(path.join(process.env.DATA_DIR,\'mailbox\',row.id+\'.json\'),\'utf8\'));local=mail.to===row.email&&typeof mail.text===\'string\'&&/code is \\d{6}/.test(mail.text);}catch{}\nconst parts=row.email.split(\'@\');facts.push({id:row.id,email_masked:parts[0].slice(0,1)+\'***@\'+parts[1],audience:row.audience,created_at:row.created_at,expires_at:row.expires_at,consumed:!!row.consumed_at,local_mail_file_matches:local});}\nconsole.log(JSON.stringify({stage:185,status:\'read_only_challenge_check\',challenge_count:facts.length,local_mail_matches:facts.filter(x=>x.local_mail_file_matches).length,items:facts}));\n}finally{await c.end();}'
p=subprocess.run(['/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node','--env-file=/root/cfg/workmate/app.env','--input-type=module','-e',script],cwd='/opt/workmate/overlays/admin-directory-lifecycle-184-v1/backend',stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
assert p.returncode==0,'Read-only challenge inspection failed; diagnostic detail withheld'
report=json.loads(p.stdout)
with Path('/root/cfg/workmate/email-delivery-185-challenges-v2.sanitized.json').open('x') as f:json.dump(report,f,indent=2)
print(p.stdout)
PY
