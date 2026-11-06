"""Complete the collected compile correction before a fresh whole verification."""
from pathlib import Path
from datetime import datetime, timezone
import json

R=Path(__file__).resolve().parents[2]
L=R/'dev/copypaste-delivery'
Q=R/'docs/quality/integrated-round-204'
def fresh(p,text):
    with p.open('x',encoding='utf-8',newline='\n') as f:f.write(text)
def replace(p,before,after):
    text=p.read_text('utf-8');assert before in text,p
    p.write_text(text.replace(before,after),encoding='utf-8',newline='\n')

source=(R/'docs/tools/record-integrated-code-batch-204-v5.py').read_text('utf-8')
fresh(R/'docs/tools/record-integrated-code-batch-204-v6.py',source.replace('implementation-batch-v5.json','implementation-batch-v6.json'))
verify=(L/'scripts/verify-integrated-round-204-v8.mjs').read_text('utf-8')
fresh(L/'scripts/verify-integrated-round-204-v9.mjs',verify.replace('integrated-204-v8','integrated-204-v9').replace('implementation-batch-v5.json','implementation-batch-v6.json').replace('final204-v5','final204-v6'))
for p in [L/'scripts/deploy-integrated-204-v1.py',L/'scripts/finalize-release-metadata-204-v1.mjs',R/'docs/tools/document-integrated-round-204-v1.py']:
    replace(p,'integrated-204-v8','integrated-204-v9')
for p in [R/'docs/tools/document-integrated-round-204-v1.py',R/'docs/tools/finalize-integrated-round-204-v1.py']:
    replace(p,'implementation-batch-v5.json','implementation-batch-v6.json')
readme=R/'docs/tools/update-integrated-readmes-204-v1.py'
replace(readme,'未恢复的图表、图片、软件包等交付失败不能被模型最终文字覆盖成成功。','未恢复的图表、图片、软件包等交付失败不能被模型最终文字覆盖成成功；补充资料后的新回合继承原失败，最终任务状态再次核对，只有真实同工具完成才清除。')
replace(readme,'Unrecovered chart/image/package delivery failures override final completion prose.','Unrecovered chart/image/package delivery failures override final completion prose. New turns after input waits inherit durable failures and canonical completion checks them again; only actual same-tool completion clears each failure.')
fresh(Q/'collected-compile-correction-v1.json',json.dumps({'stage':204,'at':datetime.now(timezone.utc).isoformat(),'original_verification':'.data/integrated-204-v8/verification.json','failure':'TS2304: new runtime context used a finish-method variable outside its scope. No backend tests or activation ran.','correction':'Use existing tenant/id/owner in the authenticated application database transaction, retaining tenant/actor RLS and prior outcome boundaries.','production_files_changed':['dev/copypaste-platform/src/worker.ts'],'whole_backend_cases':204,'client_artifacts_unchanged':True,'server_network_changes':False},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'collected_correction_prepared','next_verification':'v9','server_network_changes':False}))
