"""Prepare the bounded consumption-report handoff from immutable native/UI receipts."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import shutil

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
def digest(p): return sha256(p.read_bytes()).hexdigest()
def create(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('x', encoding='utf-8', newline='\n') as f: f.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)+'\n')
qpath = DELIVERY / 'evidence/admin-usage-report-169/qualification-03.json'
upath = DELIVERY / 'evidence/admin-usage-report-169/admin-ui-02.json'
q, ui = [json.loads(p.read_bytes()) for p in [qpath, upath]]
assert q['status']=='passed' and q['owned_services_closed'] and q['source_unchanged'] and q['database_tests']==6
assert ui['status']=='passed' and len(ui['checks'])==6 and ui['browser_closed']
for n,h in q['source_after'].items(): assert digest(DEV/n)==h,n
copies=[]
for row in [*ui['screenshots'], *[f for r in ui['recordings'] for f in r['files']]]:
    source=DEV/row['path']; assert digest(source)==row['sha256']
    targets=[ROOT/'docs/assets/admin-usage-report-169'/source.name]
    if source.suffix in ['.gif','.mp4'] or '01-snapshot-summary' in source.name:
        targets += [DEV/('copypaste-'+c)/'assets/screenshots'/source.name for c in ['platform','delivery']]
    for target in targets:
        target.parent.mkdir(parents=True,exist_ok=True); assert not target.exists(); shutil.copyfile(source,target)
        copies.append({'path':target.relative_to(ROOT).as_posix(),'sha256':row['sha256'],'original':row['path']})
media={'receipt':upath.relative_to(ROOT).as_posix(),'receipt_sha256':digest(upath),'scope':ui['scope'],'edited':False,'copies':copies}
create(ROOT/'docs/assets/admin-usage-report-169/provenance.json',media)
contract={'version':169,'routes':{'POST /v1/admin/usage-reports':'Strict filters; current MFA; idempotent snapshot creation. Returns id/expires_at only.','GET /v1/admin/usage-reports/:id':'Same-session snapshot summary, eight groupings and stable 1–100 row pages.','GET /v1/admin/usage-reports/:id/works/:kind/:work':'Snapshot-bound safe operation/ledger/refund/pinned-runtime detail.','GET /v1/admin/usage-reports/:id/export':'Whole selected CSV; both scoped export permissions must cover every row.'},'filters':{'required':['period_from','period_to'],'optional':['user_id','tenant_id','project_id','billing_account_id','task_id','capability_version_id','payer_kind','source','role_key','model_alias'],'period':'UTC half-open work-creation cohort; UI defaults Hong Kong last seven days. Financial facts cumulative as of snapshot, not posting-period accounting.'},'groups':['user','payer','tenant','project','role','source','day','capability'],'financial_fields':{'confirmed_micros':'Exact negative charge-ledger sum inverted; work counted once, attributed to initiator and original wallet.','refunded_micros':'Only credit compensation from billing.refund operations linked to the original consume journal/raw charge.','reserved_micros':'Active task/resource holds.','reconciliation_hold_micros':'Unsettled uncertain holds; separate from actual charges.','internal_cost':'Only scoped internal_cost.read; null/not_recorded because supplier bills are not connected; selling rates never stand in for internal costs.'},'constraints':{'snapshot_ttl_seconds':300,'maximum_works':5000,'maximum_operations':20000,'maximum_payload_bytes':16777216,'oversize':'413, never truncated totals','capability_group':'Counts only; whole-work charges never reallocated per capability. Capability filter selects works having a matching operation.','units':'Independent exact decimal-string totals per unit; unknown observations counted separately.','identity':'Current Admin session/auth version/access hash/recent MFA and environment mode on every access; binding change invalidates report.','export':'Same stored financial snapshot, CSV formula protection, exact money strings and watermark/as_of on each row. No prompt/output/email/provider payload.'},'schema_version':156,'schema_change_in_this_increment':False,'legacy_usage_route_unchanged':True}
for p in [ROOT/'docs/contracts/admin-usage-reports-169.json', DEV/'copypaste-platform/contracts/admin-usage-reports-169.json']:create(p,contract)
body='''# 用戶消耗報表 / User consumption report

管理員從「用戶消耗」建立固定快照，也可從用戶詳情進入。香港今日／近七日／本月預設可調整；按發起人、付款帳戶、企業、項目、任務、角色、執行來源、能力版本及模型篩選。頁面分列確認扣費、退回消耗、淨消耗、預留及待對賬。個人和企業帳戶不合併，團隊子任務只歸實際發起人一次。

Admins create a fixed report in User consumption or enter from a user profile. Hong Kong day/week/month presets and exact filters lead to eight groupings, work details and CSV. Personal and enterprise payers stay separate. Charges are attributed once to the work initiator; every team member does not receive the same charge.

**時間口徑**：篩選工作建立時間的左閉右開期間，顯示這批工作截至快照的累計帳務；不是入帳日期區間報表。能力篩選選取有匹配操作的工作；能力分組只列工作／操作次數，不把整筆費用重複歸屬。工作明細顯示安全操作／模型／能力版本／已記錄嘗試、固定模板及 runtime ID、原扣費及退款來源；歷史未記錄欄位保持空缺。

**Time basis**: this is a half-open work-creation cohort with cumulative accounting as of the snapshot, not a posting-period report. Capability filters select matching works; capability groups count works/operations without allocating whole-work charges again. Missing historical attempt/configuration facts remain unrecorded.

摘要、分組、分頁、詳情、匯出讀取同一加密五分鐘快照。金額以十進位字串與 BigInt 計算；未知用量與未連接內部實際供應商成本不當作零。內部成本欄位需獨立範圍權限，客戶售價不能代替公司成本。最多5000工作／20000操作／16MiB，超出要求縮小篩選，禁止靜默截斷總數。

Summary, grouping, paging, detail and export read one encrypted five-minute snapshot. Monetary values remain exact decimal strings/BigInt. Unknown usage/cost stays unknown. Internal supplier cost requires its own scope and remains null/not_recorded until actual bills are connected. Bounded size rejects excess instead of silently truncating totals.

每次讀取需當前獨立Admin身份、近期MFA、原會話、授權版本及相同環境；範圍或拒絕規則改變立即使快照失效。按用戶鑽取還需目錄權限。匯出必須同時具有 create/download 且覆蓋全部所選工作，否則拒絕整次匯出。CSV保留每列快照時間／水印並防試算表公式注入，不含工作正文／電子郵件／網關憑證或提供方回應。

Every access rechecks current Admin identity, recent MFA, original session/auth version, binding hash and mode. User drilldown also requires directory access. Both export permissions must cover every selected work; partial authorization rejects the export. CSV retains the same watermark/as_of per row and protects formula cells without exposing prompts, email, secrets or provider bodies.

```mermaid
flowchart LR
 A[Admin OTP / TOTP] --> F[Creation-period and payer filters]
 F --> S[Current scopes and denies]
 S --> Q[One SQL statement / encrypted snapshot]
 Q --> G[Summary and eight groups]
 G --> W[Work / operation / ledger detail]
 Q --> E[Same-snapshot authorized CSV]
```

本輪 Backend/Admin 構建、6項原生SQL/API與6組實際瀏覽器檢查；原查詢失敗留存。這是有限功能驗證，不代表全部原始驗收通過。供應商帳單、入帳期間報表、真實提供方／完整角色與OS／生產規模仍按原台賬保留；不阻塞已授權假數據首版。舊 v0.1.0 原包保持不變，本增量會納入下一完整凍結包。

Backend/Admin builds, six native SQL/API tests and six actual browser checks cover this bounded increment; original query failures remain. Actual supplier bills, posting-period reporting and all original full-acceptance scopes remain tracked. Existing v0.1.0 assets are preserved; this increment is intended for the next complete frozen bundle.
'''
for path in ['docs/requirements/29-admin-usage-reports.md','docs/development/169-admin-usage-reports.md','docs/changes/169-admin-usage-reports.md']:create(ROOT/path,body)
image=next(Path(r['path']).name for r in ui['screenshots'] if '01-snapshot-summary' in r['path'])
gif=next(Path(f['path']).name for r in ui['recordings'] for f in r['files'] if f['path'].endswith('.gif'))
mp4=next(Path(f['path']).name for r in ui['recordings'] for f in r['files'] if f['path'].endswith('.mp4'))
for c in ['platform','admin','delivery']:
    for name in ['README.md','README.en.md']:
        p=DEV/('copypaste-'+c)/name; s=p.read_text(encoding='utf-8'); i=s.find('\n')
        block=('## 当前源码增量 · 阶段169\n\n用户消耗报表支持付款方／项目／时间等筛选、八类分组、任务账务明细和同快照CSV。金额、预留、退款、待对账和未知内部成本分开；当前范围、MFA、导出权限逐次复查。当前库版本156。旧v0.1.0包未改；本增量纳入下一完整冻结包。\n\n' if name=='README.md' else '## Current source increment · stage169\n\nConsumption reports add payer/project/creation-period filters, eight groupings, work accounting detail and same-snapshot CSV. Exact charges, refunds, holds, reconciliation and unknown supplier costs remain distinct. Current scopes, MFA and both export permissions are enforced. Schema156; existing v0.1.0 assets are unchanged. This increment is included in the next complete freeze.\n\n')
        block+='```mermaid\nflowchart LR\n A[Admin MFA] --> S[Scoped filters]\n S --> R[Encrypted fixed snapshot]\n R --> D[Groups / work / ledger]\n R --> E[Authorized CSV]\n```\n\n'+f'![Consumption report](assets/screenshots/{image})\n\n![Actual interaction](assets/screenshots/{gif})\n\n[MP4](assets/screenshots/{mp4}) · [方案 / Behavior](https://github.com/copypasteltd/workmate/blob/docs/docs/development/169-admin-usage-reports.md)\n\n'
        assert '## Current source increment · stage169' not in s and '## 当前源码增量 · 阶段169' not in s
        p.write_text(s[:i+1]+block+s[i+1:],encoding='utf-8',newline='\n')
ledger=json.loads((ROOT/'docs/quality/remaining-work-stage168.json').read_bytes()); original=[(r['id'],r['full_acceptance'],r['optional']) for r in ledger['requirements']]
ledger.update(current_stage=169,reviewed_at=datetime.now(timezone.utc).isoformat(),previous_review={'path':'docs/quality/remaining-work-stage168.json','sha256':digest(ROOT/'docs/quality/remaining-work-stage168.json')})
for r in ledger['requirements']:
    if r['id']=='REQ-086':
        r['implemented_scope']+='；169增加多维固定快照报表、账本扣费／原消耗退款、预留／待对账、操作明细及同选择CSV'
        r['current_audit_remaining']='供应商实际账单接入、按入账期间会计口径、全媒体／团队／角色／来源／大规模与完整授权运营矩阵继续开放。当前内部实际成本明确未知，能力分组不重复摊费用。'
ledger['current_increment']={'stage':169,'scope':'Scoped immutable consumption reports and work accounting drilldown','new_full_acceptance_closures':0,'broad_regression':'omitted_by_user_for_initial_freeze','full_acceptance_closed':False,'frozen_release_unchanged':'v0.1.0'}
assert [(r['id'],r['full_acceptance'],r['optional']) for r in ledger['requirements']]==original
create(ROOT/'docs/quality/remaining-work-stage169.json',ledger)
lines=['# 阶段169 · 原编号实现与完整验收台账','','102项原编号及88项必选完整验收范围保持；不等于88项未实现功能。当前功能收口后转入完整冻结打包。','','|编号|模块|当前实现|仍待完整处理|完整验收|','|---|---|---|---|---|']
for r in ledger['requirements']: lines.append('|'+'|'.join(str(r[k]).replace('|','\\|').replace('\n',' ') for k in ['id','module','implemented_scope','current_audit_remaining','full_acceptance'])+'|')
create(ROOT/'docs/quality/remaining-work-stage169.md','\n'.join(lines)+'\n')
attempts=[{'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p),'status':json.loads(p.read_bytes())['status']} for p in sorted((DELIVERY/'evidence/admin-usage-report-169').glob('*.json')) if p not in [qpath,upath]]
create(ROOT/'docs/quality/admin-usage-report-169.json',{'stage':169,'status':'qualified','at':datetime.now(timezone.utc).isoformat(),'sources':q['source_after'],'qualification':{'path':qpath.relative_to(ROOT).as_posix(),'sha256':digest(qpath)},'actual_ui':{'path':upath.relative_to(ROOT).as_posix(),'sha256':digest(upath)},'retained_attempts':attempts,'media':media,'native_sql_api_checks':6,'actual_admin_ui_checks':6,'production_builds':['backend','admin'],'mandatory_whole_acceptance_open':88,'new_full_acceptance_closures':0,'owned_browser_and_services_closed':True,'virtualization_used':False,'prepare_tool_sha256':digest(Path(__file__))})
for name in ['README.md','README.en.md']:
    p=ROOT/'docs'/name; s=p.read_text(encoding='utf-8'); p.write_text('# 当前源码增量 / Current source increment · 169\n\n用戶消耗固定報表已完成；Scoped consumption reports implemented.\n\n[本轮更新 / Changes](changes/169-admin-usage-reports.md) · [方案 / Behavior](development/169-admin-usage-reports.md) · [证据 / Evidence](quality/admin-usage-report-169.json) · [完整台账 / Ledger](quality/remaining-work-stage169.md)\n\n当前转入下一完整冻结包；旧v0.1.0包保持不变。Preparing the next complete freeze; existing v0.1.0 is preserved.\n\n---\n\n'+s,encoding='utf-8',newline='\n')
print(json.dumps({'status':'prepared','stage':169,'native_checks':6,'ui_checks':6,'media_copies':len(copies)}))
