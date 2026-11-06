"""Retain premature dependency failures and create a separate application activation attempt."""
from pathlib import Path
from datetime import datetime,timezone
import ast,json,hashlib
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts'
p=scripts/'activate-integrated-202-v2.sh';s=p.read_text('utf8')
s=s.replace("state=cfg/'integrated-202/activation-v1'","state=cfg/'integrated-202/activation-v2'")
s=s.replace("cfg=Path('/root/cfg/workmate');state=", "cfg=Path('/root/cfg/workmate');assert json.loads((cfg/'integrated-202/downloads-v1/receipt.json').read_text())['status']=='published';state=")
ast.parse(s.split("<<'WM_ACTIVATE_200_V1'",1)[1].split('WM_ACTIVATE_200_V1',1)[0])
target=scripts/'activate-integrated-202-v3.sh';target.write_text(s,encoding='utf8',newline='\n')
s=(scripts/'collect-integrated-202-v1.sh').read_text('utf8').replace("cfg/'activation-v1/deployment.sanitized.json'","cfg/'activation-v2/deployment.sanitized.json'")
(scripts/'collect-integrated-202-v2.sh').write_text(s,encoding='utf8',newline='\n')
report={'stage':202,'at':datetime.now(timezone.utc).isoformat(),'status':'operations_correction_complete_before_activation_replay','product_source_changes':False,'retained_failures':[{'operation':'upload-integrated-202-v1.py initial guard','reason':'Packaging process was still running; archive checksum was not yet created. Guard stopped before connecting to or writing on server. Successful upload occurred only after packaging completion.'},{'operation':'activate-integrated-202-v2.sh','reason':'Download activation had not returned its receipt yet. Missing dependency stopped before candidate start, service changes or static directory swaps. Original activation-v1 credential snapshot directory retained privately; no network configuration changed.'}],'correction':'Wait for successful dependent operations; require published download receipt before creating a fresh activation-v2 state. Preserve executed v2 script and original state; replay separate v3.','activation_script_sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
(root/'docs/quality/integrated-round-202/operations-correction-v1.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
print(json.dumps({'status':report['status']}))
