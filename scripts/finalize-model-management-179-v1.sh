#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil,urllib.request,subprocess
cfg=Path('/root/cfg/workmate');backup=cfg/'model-management-179-backup'
for n in ['app.env','credentials.txt']:assert (cfg/n).read_bytes()==(backup/n).read_bytes()
with urllib.request.urlopen('http://127.0.0.1:63073/health/ready',timeout=10) as r:
 health=json.load(r);assert r.status==200 and health['model_management']=='editable'
guide=cfg/'DEPLOYMENT-README.md';before=backup/'DEPLOYMENT-README-before-finalize.md'
assert not before.exists();shutil.copy2(guide,before)
text='''# 已有模型的编辑与删除 / Existing model management — stage179

入口 https://agent-dashboard.copypaste.hk/catalog?view=capabilities 。当前列表及详情提供“编辑模型 / Edit model”和“删除模型 / Delete model”。

编辑会预填模型与接口；API Key 可直接输入新 Key，原 Key 不回显。地址和网络范围相同时可保留原 Key，更换范围须填新 Key。点击“保存更改 / Save changes”后当前列表显示更新后的条目；能力验证及原有审批发布后供新工作使用。

Delete model asks for confirmation and removes the model from future selection. Current/history/deleted views preserve clear management scope. Existing task bindings, encrypted connections and billing history remain intact. No bootstrap fallback replaces a deleted default. Edit requires admin.catalog.draft; delete requires admin.catalog.publish.

Overlay /opt/workmate/overlays/model-management-179/; schema158. Keep a schema158-compatible API if rolling frontends back. Existing environment/login credentials remain unchanged.

---

'''
assert 'Existing model management — stage179' not in guide.read_text()
guide.write_text(text+guide.read_text());guide.chmod(0o600)
safe={'stage':179,'status':'finalized','at':datetime.now(timezone.utc).isoformat(),'schema_version':158,'model_management':'editable','credentials_preserved':True,'guide':str(guide),'owned_services':subprocess.check_output(['systemctl','is-active','workmate-api.service','workmate-lan-proxy.service'],text=True).splitlines(),'virtualization_invoked':False}
with (cfg/'model-management-179-final.sanitized.json').open('x') as f:json.dump(safe,f,indent=2)
print(json.dumps(safe))
PY
