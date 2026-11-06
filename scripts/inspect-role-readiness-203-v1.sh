#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import json,subprocess,urllib.request
root=subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()
assert root=='/opt/workmate/overlays/integrated-202-v2/backend'
with urllib.request.urlopen('http://127.0.0.1:63073/v1/catalog/roles',timeout=20) as r:data=json.load(r)
items=[{k:item.get(k) for k in ['role_key','display_name','available','reason','tool_ids','skill_bindings','deliverables']} for item in data['items']]
print(json.dumps({'stage':203,'status':'read_only_inventory','backend':root,'kernel':data.get('kernel'),'roles':items}))
PY
