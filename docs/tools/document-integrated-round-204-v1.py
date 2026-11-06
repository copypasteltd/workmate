"""Collect measured evidence after deployment, observations and owned cleanup."""
from pathlib import Path
from datetime import datetime,timezone
import copy,hashlib,json,re,shutil,subprocess
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';Q=R/'docs/quality/integrated-round-204';OLD=R/'docs/quality/integrated-round-203'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def public(value):
 if isinstance(value,list):return [public(v) for v in value]
 if isinstance(value,dict):return {k:public(v) for k,v in value.items() if not re.search(r'api_?key|password|secret|cookie|authorization|csrf|access_token|refresh_token|fencing_token|^token$|code_verifier|idempotency_key|credential_(?:cipher|hash)',k,re.I)}
 if isinstance(value,str) and re.match(r'https?://',value):return re.sub(r'([?&](?:ticket|token|code|key|signature)\=)[^&#]*',r'\1REDACTED',value,flags=re.I)
 return value
def put(name,value,sanitize=True):
 with (Q/name).open('x',encoding='utf-8',newline='\n') as f:json.dump(public(value) if sanitize else value,f,ensure_ascii=False,indent=2);f.write('\n')
batch=load(Q/'implementation-batch-v6.json')
for row in batch['production_source_files']+batch['migration_files']:assert sha(R/row['path'])==row['sha256'],row['path']
put('final-source-manifest.json',{'stage':204,'source_files':len(batch['production_source_files']),'production_source_files':batch['production_source_files'],'migration_files':batch['migration_files'],'prebuild_snapshot_sha256':sha(Q/'implementation-batch-v6.json'),'scope':'The entire selected production-source and migration set equals the final complete pre-verification batch. Package/catalog metadata and qualification scripts have separate receipts. Original102/professional/production scope is not closed by a literal marker scan.'})
v=load(L/'.data/integrated-204-v11/verification.json');assert v['status']=='passed';put('verification.json',v)
counts={};current=[]
for c in v['retained_checks']+v['checks']:
 assert c['exit_code']==0 and sha(L/c['log'])==c['sha256']
 if c['phase'].startswith('test'):
  text=(L/c['log']).read_text('utf-8');summary={k:int(re.findall(r'^# '+k+r' (\d+)',text,re.M)[-1]) for k in ['tests','pass','fail','cancelled','skipped','todo']}
  assert summary['tests']==summary['pass'] and all(summary[k]==0 for k in ['fail','cancelled','skipped','todo'])
  counts['copypaste-'+c['component']]=counts.get('copypaste-'+c['component'],0)+summary['tests'];current.append({'component':c['component'],**summary,'log':c['log'],'sha256':c['sha256']})
assert counts['copypaste-platform']==37 and len(v['retained_backend_cases'])==167 and all(c['passed'] for c in v['retained_backend_cases'])
counts['copypaste-platform']+=len(v['retained_backend_cases'])
old=load(OLD/'final-source-manifest.json');now={r['path']:r for r in batch['production_source_files']};retained=[]
for row in old['production_source_files']:
 if any(row['path'].startswith('dev/copypaste-'+name+'/') for name in ['admin','extension']):assert now[row['path']]['sha256']==row['sha256'];retained.append(row)
prior_counts=load(OLD/'test-summary.json')['counts']
for name in ['admin','extension']:counts['copypaste-'+name]=prior_counts['copypaste-'+name]
assert counts=={'copypaste-platform':204,'copypaste-web':70,'copypaste-desktop':320,'copypaste-delivery':16,'copypaste-admin':22,'copypaste-extension':93}
total=sum(counts.values());put('test-summary.json',{'stage':204,'total_qualified_cases':total,'total':total,'counts':counts,'current_round_test_log_evidence':current,'retained_backend_cases':v['retained_backend_cases'],'original_failed_backend_whole':v['original_failed_whole'],'retained_unchanged_admin_extension_sources':retained,'prior_summary_sha256':sha(OLD/'test-summary.json'),'scope':'725 distinct related cases. Backend204 distinct cases cover the final identical product source: all37 cases in the three affected files rerun with absolute executable plus matching version/hash;167 other passed cases retain exact source/test/log SHA and unique TAP evidence from failed whole204-v10. That original whole attempt remains failed with21 failures. Web70/Desktop320 pass on final source; unchanged Delivery16 retains its204-v3 execution. Admin22/Extension93 retain identical-source prior evidence. Every failed whole attempt remains failed. Not all historical, professional, device or production acceptance.'})
live_attempts=sorted((L/'.data/acceptance-204').glob('live-review-*/receipt.json'));live_paths=[p for p in live_attempts if load(p)['status']=='passed'];assert len(live_paths)==1
put('retained-online-path-attempts.json',{'stage':204,'failed_live_journeys':[{'path':p.relative_to(R).as_posix(),'sha256':sha(p),'receipt':load(p)} for p in live_attempts if load(p)['status']!='passed'],'failed_public_download_path':load(L/'.data/deployment-204-v1/public-stream-v2.sanitized.json'),'partial_parallel_public_transfer':load(L/'.data/deployment-204-v1/public-stream-v3.sanitized.json'),'ended_sequential_range_observation':{'receipt':load(L/'.data/deployment-204-v1/public-stream-v4.sanitized.json'),'operator_ended':True,'retained_portable_prefix_bytes':24117248,'reason':'After slow actual sequential progress, only the exact owned range browser was closed to qualify the actual ordinary browser-managed product download flow. Final Target-closed read failures are operator termination, not attributed to the server.'},'scope':'Original failed paths remain failed. Subsequent QA uses only a local current-DNS address order plus bounded read-only session fetch; server networking is unchanged. Parallel public transfer, direct/default public paths and DNS failover remain open. The sequential range run was deliberately ended after24MiB; its original result remains partial. The actual browser-managed full download run is evaluated independently against all complete expected bytes and SHA values.'})
live=load(live_paths[0]);assert live['status']=='passed' and live['packaged_version']=='0.7.17' and live['owned_windows_closed'] and live['native_diagnostics']['errors']==[] and len(live['downloads'])==6
for fmt in ['html','csv','json']:
 rows=[r for r in live['downloads'] if r['format']==fmt];assert len(rows)==2 and len({(r['bytes'],r['sha256']) for r in rows})==1
put('live-production-journey.json',live)
ui=load(L/'.data/acceptance-204/feedback-ui-v3/receipt.json');assert ui['status']=='passed' and ui['owned_browser_closed'] and ui['owned_local_server_closed'] and ui['recordings'][0]['distinct_frames']>=4
put('controlled-tool-feedback-ui.json',ui)
deployment=load(L/'.data/deployment-204-v1/deploy-steps-v3/read-deployment.stdout.log');assert deployment['deployment']['status']=='deployed' and deployment['deployment']['schema_version']==165 and deployment['downloads']['status']=='published'
put('deployment.json',deployment['deployment']);put('downloads-publication.json',deployment['downloads'])
put('backup-client-provenance.json',deployment['backup_client'])
put('retained-observation-preflight-failures.json',load(L/'.data/acceptance-204/observation-preflight-v1.json'))
put('retained-deployment-attempts.json',{'initial':load(L/'.data/deployment-204-v1/deploy-steps/receipt.json'),'backup_continuation':load(L/'.data/deployment-204-v1/deploy-steps-v2/receipt.json'),'corrected_runtime_package':load(L/'.data/deployment-204-v1/deploy-steps-v3/receipt.json'),'runtime_package_failure':'Compiled dist/contracts was omitted in the first archive; complete runtime directories/static import closure and a healthy pre-cutover candidate are required in the corrected package.','initial_failure':'System pg_dump14 did not support the actual embedded PostgreSQL18 server. App returned to prior code; database/proxy preserved. Official signed client18 packages are extracted only in an application-owned toolchain; no apt source, system package, database service or network changes.'})
for name in ['network-preserved','final-service-state']:
 data=load(L/('.data/deployment-204-v1/'+name+'-v1.sanitized.json'));assert data['status']=='passed';put(name+'.json',data)
inner=load(L/'.data/deployment-204-v1/inner-downloads-v2.sanitized.json');pub=load(L/'.data/deployment-204-v1/public-download-v5.sanitized.json');assert inner['status']==pub['status']=='passed'
put('inner-downloads.json',inner);put('public-downloads.json',{'stage':204,'status':'passed','catalog':load(D/'copypaste-web/contracts/product-downloads.json'),'public':pub,'inner':inner,'scope':'All four complete innerHTTP200 and actual original-TLS browser-managed full release files have exact whole-file bytes/SHA. The three actual health responses retain the immutable failed/partial range-run source; that whole attempt remains partial. QA selects HTTP/1.1 and current-DNS IPv4 order only in owned clients; original failed public paths remain failed, and normal DNS failover remains unverified; defaultH2/direct developer egress and OS installation/upgrades are not certified. No server network/protocol change.'})
put('packaging.json',load(D/'copypaste-desktop/.data/deployment-204-v2/packaging-receipt.json'))
put('retained-packaging-v1.json',load(D/'copypaste-desktop/.data/deployment-204-v1/packaging-receipt.json'))
put('release-metadata-validation.json',load(L/'.data/deployment-204-v1/release-metadata-validation.json'))
cleanup=load(L/'.data/acceptance-204/runtime-cleanup-v1.json');assert cleanup['status']=='passed';put('runtime-cleanup.json',cleanup)
transport=load(L/'.data/acceptance-204/transport-v2/receipt.private.json');closed=load(L/'.data/acceptance-204/transport-v2/closed.json');assert closed['listeners_closed'] and load(L/'.data/acceptance-204/transport-v1/closed-observed-v1.json')['listeners_closed']
put('original-qa-transport-close-observation.json',load(L/'.data/acceptance-204/transport-v1/closed-observed-v1.json'))
put('qa-transport.json',{'stage':204,'hosts':transport['hosts'],'tls_termination':False,'response_replacement':False,'owned_listeners_closed':True,'retained_original_transport_closed':True,'request_only_ipv4_order':transport['request_only_ipv4_order'],'server_network_changes':False,'scope':'Pinned authenticated SSH forwards original company TLS; only owned QA processes select HTTP/1.1 and descending current-DNS IPv4 order after the retained first-address stall. Normal public DNS failover is not certified. No TLS validation bypass, response replacement, server route/proxy/DNS/firewall change or direct-egress qualification.'})
new=load(L/'.data/acceptance-204/marketing-correction-v2/receipt.json');assert len(new['items'])==1
sample=new['items'][0];put('marketing-functional-sample.json',{'stage':204,**sample,'professional_customer_acceptance':False,'maximum_original_budget_HKD':5,'sample_receipt_sha256':sha(L/'.data/acceptance-204/marketing-correction-v2/receipt.json'),'scope':'One linked known-terminal marketing correction on pinned synthetic source, real company Codex, actual receipts/files/usage. No successful prior11 trials were rerun; no blind paid replay. Neither a new passing sample nor the new diagnostics proves the original generic failure cause.'})
events_path=L/'.data/acceptance-204/marketing-correction-v2/marketing-analyst/events.private.json'
events=load(events_path)
keys=['tool','call_ref','arguments_sha256','code','category','operation_outcome','can_correct_arguments','fields']
tool_events=[{'id':e['id'],'kind':e['kind'],'body':{k:e['body'][k] for k in keys if k in e['body']}} for e in events if e['kind'] in ['runtime.tool.failed','runtime.tool.completed','runtime.tool.recovered']]
chart=[e for e in tool_events if e['body'].get('tool')=='chart_render']
assert [e['kind'] for e in chart]==['runtime.tool.failed','runtime.tool.completed','runtime.tool.recovered']
assert chart[0]['body']['code']=='TOOL_INPUT_INVALID' and chart[0]['body']['operation_outcome']=='not_performed' and chart[0]['body']['can_correct_arguments']
assert chart[0]['body']['call_ref']!=chart[1]['body']['call_ref'] and chart[1]['body']['call_ref']==chart[2]['body']['call_ref']
assert sample['task']['status']=='succeeded' and len(sample['files'])==9 and sample['task']['charged_micros']=='306432'
put('marketing-tool-recovery.json',{'stage':204,'status':'passed','task_id':sample['task_id'],'parent_task_id':sample['known_terminal_correction_of'],'events_source_sha256':sha(events_path),'events':tool_events,'actual_charge_micros':sample['task']['charged_micros'],'files':sample['files'],'scope':'One actual company Codex task corrected a proven pre-execution input-validation failure within its original HKD5 budget. Durable failed/completed/recovered events, nine downloaded files and actual usage agree. No paid task replay or historical-root-cause inference.'})
prior_roles=load(OLD/'specialist-functional-samples.json');selected=copy.deepcopy(prior_roles['selected']);assert len(selected)==11
if sample['status']=='passed_controlled_functional_sample':selected.append(sample)
put('specialist-functional-samples.json',{'stage':204,'planned_roles':12,'passed_roles':len(selected),'selected':selected,'new_paid_trials':1,'prior_successful_trials_repeated':0,'professional_customer_acceptance':False,'retained203_sha256':sha(OLD/'specialist-functional-samples.json'),'original_failure_remains':load(OLD/'marketing-analysis-open.json'),'scope':'Representative functional samples only. Professional19-role/50-Skill briefs, revisions, production outputs and customer sign-off remain open.'})
media=[]
def add(row,label,origin):
 p=D/row['path'];assert sha(p)==row['sha256'];media.append({'path':row['path'],'bytes':p.stat().st_size,'sha256':row['sha256'],'label':label,'origin':origin})
for report,label,origin in [(live,'实际正式站点／最终原生Desktop · Actual deployed Web/final native Desktop','actual_live204'),(ui,'受控错误场景 · Controlled UI scenario, not a live customer/model task','controlled_ui204')]:
 for row in report['screenshots']:add(row,label,origin)
 for record in report['recordings']:
  for row in record['files']:add(row,label,origin)
old_media=load(R/'docs/quality/integrated-round-198/actual-media.json')['files']
for row in old_media:
 if row['path'].startswith(('copypaste-admin/','copypaste-extension/')):
  repo,rel=row['path'].split('/',1)
  tracked=subprocess.check_output(['git','-c','core.fsmonitor=false','ls-files','--error-unmatch','--',rel],cwd=D/repo,stderr=subprocess.PIPE,text=True).strip();assert tracked==rel
  add(row,'198轮实际录制，本轮源码未变 · Retained198 capture, identical component source','retained198')
put('actual-media.json',{'stage':204,'files':media,'scope':'Distinct final live204 and clearly labeled controlled204 screenshots/GIF/MP4. Admin/Extension198 media is retained on identical component source. Rejected/intermediate layouts and packages are not presented as final evidence.'})
attempts=[]
for p in sorted((L/'.data').glob('integrated-204-v*/verification.json')):attempts.append({'path':p.relative_to(R).as_posix(),'sha256':sha(p),'receipt':load(p)})
rejected=Q/'rejected-controlled-layout-v2.png';assert not rejected.exists();shutil.copyfile(D/'copypaste-web/assets/screenshots/204-v2-tool-feedback-controlled-light-en-390.png',rejected)
put('retained-attempts.json',{'stage':204,'whole_verification_attempts':attempts,'prebuild_verifier_v4_failure':'Missing asynchronous source snapshot prerequisite; no build or test was executed. Exact script and original tool stderr retained.','controlled_ui_v1_failure':'WindowsERR_UNSUPPORTED_ESM_URL_SCHEME before browser creation; exact executed script and original stderr retained.','controlled_ui_v2':load(L/'.data/acceptance-204/feedback-ui-v2/receipt.json'),'controlled_ui_v2_manual_rejection':{'path':rejected.relative_to(R).as_posix(),'sha256':sha(rejected),'reason':'Automated no-overflow check passed but actual narrow screenshot had unreadable multi-column feedback; final204-v3 verifies readable vertical blocks and distinct interaction states.'},'failed_unapplied_sql165_sha256':sha(Q/'failed-sql165-v1.txt'),'limitations':['Original marketing generic-tool failure exact cause remains unproven.','One new linked marketing trial is retained even if failed or waiting; no paid pass chasing.','The203 lease-loss financial reconciliation and historical root-cause limit remain; new real lock/race tests establish their stated current behavior, not long-run production reliability.','Original default publicHTTP2 and first-address stalls remain; local QAHTTP1/current-DNS address selection does not certify normal DNS failover or direct developer egress.','Whole102/32, professional19/50, external media/marketing/IdP, all-device/large-file/load/DR and blindWorkBuddy acceptance remain open.']})
overlay=copy.deepcopy(load(OLD/'requirements-overlay.json'));overlay['stage']=204;overlay['scope']='All original102/32 and historical facts remain; current204 evidence is an additive overlay, never automatic full acceptance.'
notes={'08':f'代表性样例累计{len(selected)}/12类；本轮仅一项关联营销修正，原11类成功不重跑；不是19角色／50Skills专业签收。','14':'最终0.7.17本机固定Codex、新S256授权、无框无菜单、双语主题宽度及真实同字节导出复核；完整本机操作／设备矩阵仍开放。','15':'新Setup／Portable0.7.17及原Extension0.5.7完整内网200／公网原TLS浏览器完整文件哈希验证；不是安装／升级矩阵。','18':'云端独立45秒续租保持原事务权限锁；实际48秒长事务、未提交续租并发及过期回收一次性测试；Desktop认证续租规则保留。历史根因及长稳仍开放。','19':'真实用量不因工具失败归零；未知结果保留预留且不重放。实际营销样例费用和关联父任务单列。财务生产验收不由样例替代。','20':'当前来源／身份／fence／撤权围栏保留，云端与Desktop分开管理存活期限；未增加权限绕过。','24':'应用schema165及既有静态／下载入口更新；两份原生运行时保持真实目录／精确字节，网络文件／实时规则和DB／代理保持。','26':'真实应用库备份及兼容前向schema的代码回退已准备；未冒充完整灾备演练或回退演练。','27':f'{len(batch["production_source_files"])}份最终源码／165迁移及{total}项相关用例有精确当前／沿用证据；完整历史／专业／生产矩阵仍开放。','29':'原失败、修正版、实际文件／费用／截图／下载／网络保持和六端双语指南同步；全部102条与32组原始记录不删改。','30':'任务／成果区保留关键工具结果，长回复不冲掉失败，真实同工具成功才解除提示；当前任务共用活动连接。','31':'明确标注受控与实际线上界面，窄屏提示按可读纵向排列，双语／双主题／多宽度及无横向溢出通过；完整可访问性／体验矩阵仍开放。','32':'安全支持参考号及有界工具诊断已接入；未知结果要求核对原回执，完整支持SLA和生产运营验收保持开放。'}
for group in overlay['groups']:group['round204_update']=notes.get(group['id'],'保留上轮原始范围、现有代码与开放边界；本轮不新增该组完整专业／生产验收结论。');group['round204_full_acceptance_closed']=False
for req in overlay['requirements']:req['round204_overlay']=[{'group':g['id'],'update':g['round204_update'],'full_acceptance_closed':False} for g in overlay['groups'] if req['id'] in g['requirements']]
assert len(overlay['groups'])==32 and len(overlay['requirements'])==102;put('requirements-overlay.json',overlay,sanitize=False)
with (Q/'requirements-102.md').open('x',encoding='utf-8',newline='\n') as f:f.write('# 204 · 原始完整范围与本轮证据\n\n全部102条／32组保留，历史字段不改写。本轮增量不会自动关闭原始验收要求。\n\n| 编号 | 范围 | 本轮证据与边界 |\n| --- | --- | --- |\n'+''.join(f"| {g['id']} | {g['area']} | {g['round204_update']} |\n" for g in overlay['groups'])+'\n以下203及更早记录原样保留，当前进展见上表与JSON。\n\n'+(OLD/'requirements-102.md').read_text('utf-8'))
with (Q/'README.md').open('x',encoding='utf-8',newline='\n') as f:f.write(f'''# 204 · 真实交付、可操作反馈与续租修正

Backend0.5.11／Web0.5.13／Desktop0.7.17／Delivery0.5.11；Admin0.5.2与Extension0.5.7原样保留。Codex是唯一内核，全部AI经公司API，Desktop在客户本机运行且保持完整权限选择和无边框，Extension保持原生右侧SidePanel。

| 内容 | 当前证据与边界 |
| --- | --- |
| 工具交付 | 受信参数校验返回安全字段和支持参考；未知结果不重放。未解决的实际交付工具错误不能被最后一段模型文字覆盖成成功；真实用量保留。 |
| 任务续租 | schema164/165将云端续租与实际工具事务锁解耦，锁定回收避免误读未提交续租；过期不复活，保留身份／来源／fence／预算。Desktop原认证续租及事务语义保留。 |
| 代码与回归 | [完整源码与迁移](final-source-manifest.json)、[{total}项相关证据](test-summary.json)、[统一回归](verification.json)。不是全部历史／专业／生产验收；所有失败轮次保留。 |
| 真实客户端 | [正式Web／最终原生Desktop](live-production-journey.json)：新S256、实际固定Codex、无框／无菜单、13口径、六次同字节导出、双语双主题及宽度。 |
| 错误界面 | [受控场景](controlled-tool-feedback-ui.json)：原生产组件、800条活动后保留失败、终态／支持号／真实成功事件恢复，窄屏可读纵排。明确不是实际模型任务。 |
| 营销样例 | [本轮唯一关联修正](marketing-functional-sample.json)、[实际校验失败与同任务恢复](marketing-tool-recovery.json)，累计{len(selected)}/12类功能样例；不是专业19角色／50Skills签收。原失败的精确原因不由新样例推定。 |
| 发布与下载 | [应用部署与真实库备份](deployment.json)、[不可变20401下载](public-downloads.json)。完整内网200与公网原TLS浏览器完整下载字节／SHA一致；安装升级／灾备演练仍开放。 |
| 服务器 | [网络文件及实时规则保持](network-preserved.json)、[原凭证和DB／代理保持](final-service-state.json)。仅更新Workmate自身，未改写／重载网络配置或其他业务服务。 |
| 资源与失败 | [已关闭本轮自建资源](runtime-cleanup.json)、[失败及证据限制](retained-attempts.json)、[实际与受控PNG／GIF／MP4分别标注](actual-media.json)。 |

[全部102条／32组](requirements-102.md)继续完整保留。真实视频／语音、Google／Meta、企业IdP配置、全设备／大文件／并发／长稳／灾备、专业签收及WorkBuddy同题盲测未被本轮替代；公网默认HTTP/2、正常DNS地址故障转移、开发机直接出口与历史根因仍未证明；本机QA改用另一个当前公网地址不代表修复了公网路径。不声明完整goal完成。

English: Safe tool diagnostics, truthful delivery outcomes and independently fenced cloud leases preserve authorization, budgets and native Desktop behavior. {total} distinct related cases, actual deployed clients and complete download bytes have qualified evidence. Original failures, controlled-versus-live media labels, read-only server networking and the complete102/32 scope remain explicit. No full-product or professional acceptance claim.
''')
print(json.dumps({'status':'documented','related_cases':total,'functional_roles':len(selected),'media':len(media),'original_requirements':102,'server_network_changes':False}))
