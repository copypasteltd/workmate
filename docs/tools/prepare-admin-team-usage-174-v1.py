"""Record current team-report scope, actual UI media and bilingual source handoff."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import shutil
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery'
def digest(p):return sha256(p.read_bytes()).hexdigest()
def create(p,v):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x',encoding='utf-8',newline='\n') as f:f.write(v if isinstance(v,str) else json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def entry(p):return {'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)}
qp=D/'evidence/admin-team-usage-174/qualification-03.json';up=D/'evidence/admin-team-usage-174/admin-ui-03.json';q=json.loads(qp.read_bytes());u=json.loads(up.read_bytes())
assert q['status']=='passed' and q['source_unchanged'] and q['owned_services_closed'];assert q['database_tests']==21
assert u['status']=='passed' and len(u['checks'])==7 and u['browser_closed'] and len(u['recordings'])==1
for n,h in q['source_after'].items():assert digest(DEV/n)==h,n
copies=[];current=[]
for item in [*u['screenshots'],*u['recordings'][0]['files']]:
 source=DEV/item['path'];h=digest(source);assert h==item['sha256'];current.append(source.name)
 for folder in [DEV/'copypaste-admin/assets/screenshots',DEV/'copypaste-platform/assets/screenshots',D/'assets/screenshots',ROOT/'docs/assets/admin-team-usage-174']:
  target=folder/source.name;folder.mkdir(parents=True,exist_ok=True)
  if target!=source:
   assert not target.exists();shutil.copyfile(source,target)
  assert digest(target)==h;copies.append(entry(target))
retained=[]
for i in [1,2]:
 for name in [f'qualification-{i:02}.json',f'admin-ui-{i:02}.json']:retained.append(entry(D/'evidence/admin-team-usage-174'/name))
 previous=json.loads((D/f'evidence/admin-team-usage-174/admin-ui-{i:02}.json').read_bytes())
 for item in [*previous['screenshots'],*[f for rec in previous['recordings'] for f in rec['files']]]:
  source=DEV/item['path'];assert digest(source)==item['sha256'];copies.append(entry(source))
report={'stage':174,'status':'qualified','at':datetime.now(timezone.utc).isoformat(),'sources':q['source_after'],'qualification':entry(qp),'actual_ui':entry(up),'retained_attempts':retained,'media':{'copies':copies,'current_files':current},'native_team_checks':6,'current_sql_api_cases':21,'actual_admin_ui_checks':7,'qualification_note':'21 SQL/API cases and backend builds passed in first attempt; its UI interruption remains failed. Serialized UI capture passed in attempt2. Current CSS price wrapping is verified by attempt3 with seven actual UI journeys; Admin production build is required at final freeze. No repeated broad regression.','owned_browser_and_services_closed':True,'virtualization_used':False,'frozen_v012_unchanged':True,'new_full_acceptance_closures':0,'mandatory_whole_acceptance_open':88,'prepare_tool_sha256':digest(Path(__file__))}
create(ROOT/'docs/quality/admin-team-usage-174.json',report)
old=ROOT/'docs/quality/remaining-work-stage172.json';ledger=json.loads(old.read_bytes());ledger['previous_review']=entry(old);ledger['reviewed_at']=report['at'];ledger['current_stage']=174;ledger['source_increment_qualification']='docs/quality/admin-team-usage-174.json';ledger['current_increment']={'stage':174,'scope':'Team and individual-run financial attribution with scoped filters, immutable drilldown and CSV','new_full_acceptance_closures':0,'broad_regression':'omitted_by_user_for_frozen_delivery','full_acceptance_closed':False,'frozen_releases_unchanged':['v0.1.0-rc.5','v0.1.0','v0.1.1','v0.1.2']}
for item in ledger['requirements']:
 if item['id']=='REQ-086':
  item['implemented_scope']+='；174補齊團隊／單次執行分組、原成員／協調員帳目、交叉篩選、同快照明細與CSV及舊來源未知標示'
  item['current_audit_remaining']='團隊費用功能已實現；供應商實際帳單、全媒體／本機團隊／角色／來源／生產規模及完整授權運營矩陣維持原完整驗收範圍。新定向原生SQL/API覆蓋雲團隊財務來源，未聲稱新本機團隊執行或專業質量驗收。'
  item['current_review_note']+=' 174：6項新團隊SQL/API及15項相關既有報表檢查通過，當前7組實際Admin旅程；首次錄製中斷保留，串行截圖補查通過。'
create(ROOT/'docs/quality/remaining-work-stage174.json',ledger)
lines=['# 階段174 · 原編號實現與完整驗收台帳','', '保留原102項與完整驗收狀態。本輪團隊費用功能不代表完整生產資格；使用者2026-11-01要求本輪完成後交付凍結版，伺服器接入後續提供。','', '|編號|模組|當前實現|仍待完整處理|完整驗收|','|---|---|---|---|---|']
for x in ledger['requirements']:lines.append('|'+ '|'.join(str(x.get(k,'' )).replace('|','／').replace('\n',' ') for k in ['id','module','implemented_scope','current_audit_remaining','full_acceptance'])+'|')
create(ROOT/'docs/quality/remaining-work-stage174.md','\n'.join(lines)+'\n')
summary='團隊及執行ID交叉篩選，成員與協調員實際帳目只加總一次；固定快照明細／CSV保留原身份，舊來源不推斷。Team/run filters and groups sum original work entries once, with immutable detail/CSV and explicit unknown legacy attribution. 21 native report cases and seven current actual Admin journeys; original failed capture retained. Final freeze rebuilds Admin for current CSS.\n\n'
for name in ['docs/development/174-admin-team-usage.md','docs/changes/174-admin-team-usage.md']:
 create(ROOT/name,'# 團隊費用收口 / Team billing closure\n\n'+summary+'[需求 / Requirement](../requirements/31-admin-team-usage.md) · [驗證 / Evidence](../quality/admin-team-usage-174.json) · [原編號 / Ledger](../quality/remaining-work-stage174.md)\n')
for c in ['platform','admin','delivery']:
 for name in ['README.md','README.en.md']:
  p=DEV/('copypaste-'+c)/name;text=p.read_text(encoding='utf-8');i=text.find('\n');block='\n## 團隊費用 / Team consumption · stage174\n\n'+summary
  block+='```mermaid\nflowchart LR\n T[Team] --> R[Individual run]\n R --> M[Member / coordinator works]\n M --> L[Original charges and refunds]\n L --> S[Scoped financial snapshot]\n S --> C[Detail and matching CSV]\n```\n\n'
  png=next(n for n in current if 'team-02-single-run.png' in n);gif=next(n for n in current if n.endswith('.gif'));mp4=next(n for n in current if n.endswith('.mp4'))
  block+=f'![實際團隊費用 / Actual team consumption](assets/screenshots/{png})\n\n![實際操作 / Actual interaction](assets/screenshots/{gif})\n\n[MP4](assets/screenshots/{mp4})\n\n'
  p.write_text(text[:i+1]+block+text[i+1:],encoding='utf-8',newline='\n')
header='## 團隊費用更新 / Team usage · stage174\n\n'+summary+'[需求 / Requirement](requirements/31-admin-team-usage.md) · [更新 / Changes](changes/174-admin-team-usage.md) · [記錄 / Evidence](quality/admin-team-usage-174.json)\n\n---\n\n'
for name in ['docs/README.md','docs/README.en.md']:
 p=ROOT/name;p.write_text(header+p.read_text(encoding='utf-8'),encoding='utf-8',newline='\n')
p=ROOT/'docs/product/08-admin-dashboard.md';p.write_text(p.read_text(encoding='utf-8')+'\n## 團隊費用 / Team consumption\n\n'+summary+'[詳細 / Details](../requirements/31-admin-team-usage.md)\n',encoding='utf-8',newline='\n')
print(json.dumps({'status':'qualified','stage':174,'sql_api_cases':21,'actual_ui':7,'media_files':len(current),'media_entries':len(copies)}))
