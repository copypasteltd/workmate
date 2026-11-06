"""Assemble measured release evidence without changing original acceptance scope."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,re
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';Q=R/'docs/quality/integrated-round-205'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def write(name,v):
 p=Q/(name+'.json')
 if p.exists():
  retained=load(Q/'documentation-initial-attempt.json')['preserved_partial_documents']
  assert p.name in retained and sha(p)==retained[p.name] and load(p)==v,p
  return
 p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n','utf-8')
v=load(L/'.data/integrated-205-v3/verification.json');assert v['status']=='passed'
write('verification',v)
batch=load(Q/'implementation-batch-v2.json')
for row in batch['production_source_files']+batch['migration_files']:assert sha(R/row['path'])==row['sha256'],row['path']
write('final-source-manifest',{**batch,'status':'verified_final_sources','prebuild_snapshot_sha256':sha(Q/'implementation-batch-v2.json'),'release_metadata':{'web_download_catalog_sha256':sha(D/'copypaste-web/contracts/product-downloads.json')}})
checks=v['retained_checks']+v['checks'];counts={};logs=[]
for c in checks:
 assert c['exit_code']==0 and sha(L/c['log'])==c['sha256']
 if 'counts' not in c:continue
 assert c['counts']['pass']==c['counts']['tests'] and not any(c['counts'][k] for k in ['fail','cancelled','skipped','todo'])
 counts['copypaste-'+c['component']]=counts.get('copypaste-'+c['component'],0)+c['counts']['pass']
 names=re.findall(r'^[ \t]*ok \d+ - (.*)$',(L/c['log']).read_text('utf-8',errors='replace'),re.M)
 assert len(names)==len(set(names))==c['counts']['pass'],c['log']
 logs.append({**c,'qualified_tap_case_names':names,'evidence':'Current round205 execution, including exact-source retained whole205-v2 passing groups'})
old=load(R/'docs/quality/integrated-round-204/test-summary.json');oldsrc=load(R/'docs/quality/integrated-round-204/final-source-manifest.json')
for component in ['admin','extension']:
 rows=[r for r in oldsrc['production_source_files'] if r['path'].startswith('dev/copypaste-'+component+'/')]
 assert rows and all(sha(R/r['path'])==r['sha256'] for r in rows)
 counts['copypaste-'+component]=old['counts']['copypaste-'+component]
write('test-summary',{'stage':205,'counts':counts,'total_qualified_cases':sum(counts.values()),'round205_executed_cases':v['passed_cases'],'current_round_test_log_evidence':logs,'retained_components':{'copypaste-admin':{'cases':counts['copypaste-admin'],'source':'../integrated-round-204/test-summary.json','sha256':sha(R/'docs/quality/integrated-round-204/test-summary.json'),'product_source_unchanged':True},'copypaste-extension':{'cases':counts['copypaste-extension'],'source':'../integrated-round-204/test-summary.json','product_source_unchanged':True}},'full_product_acceptance':False,'scope':'Distinct related cases in named files; current selected suites and identical-source admin/extension evidence. Not the full historical, professional, operational, device or production matrix.'})
ui=load(L/'.data/acceptance-205/feedback-ui-v3/receipt.json');assert ui['status']=='passed';write('controlled-tool-feedback-ui',ui)
livepaths=list((L/'.data/acceptance-205').glob('live-review-*/receipt.json'));assert livepaths
livepath=max(livepaths,key=lambda p:p.stat().st_mtime_ns);live=load(livepath);assert live['status']=='passed';write('live-production-journey',live)
deployout=L/'.data/deployment-205-v1/deploy-steps-v2/read-deployment.stdout.log'
deploy=json.loads(deployout.read_text('utf-8').strip().splitlines()[-1])['deployment'];assert deploy['status']=='deployed' and deploy['schema_version']==166
deploy['rollback_tested']=False;write('deployment',deploy)
publication=json.loads((L/'.data/deployment-205-v1/deploy-steps-v2/publish-downloads.stdout.log').read_text('utf-8').strip().splitlines()[-1]);assert publication['status']=='published' and publication['interrupted_original_preserved'] and publication['full_files_and_parent_directories_fsynced'];write('download-publication',publication)
for name,file in [('network-preserved','network-preserved-v2.sanitized.json'),('final-service-state','final-service-state-v2.sanitized.json')]:
 obj=load(L/'.data/deployment-205-v1'/file);assert obj['status']=='passed';write(name,obj)
inner=load(L/'.data/deployment-205-v1/inner-downloads-v2.sanitized.json');assert inner['status']=='passed';write('inner-downloads',inner)
package=load(L/'.data/deployment-205-v1/package-receipt.private.json');public=load(L/'.data/deployment-205-v1/public-download-v2.sanitized.json')
complete=[r for r in public['downloads'] if r['status']=='complete_verified'];missing=[r['name'] for r in package['public_files'] if r['name'] not in {c['name'] for c in complete}];full=not missing and len(complete)==4
write('public-downloads',{'stage':205,'status':'passed' if full else 'partial','full_public_download_gate':full,'catalog':package['catalog'],'public_files':package['public_files'],'inner':inner,'public':public,'qualified_complete_files':len(complete),'missing_complete_files':missing,'full_original_goal_accepted':False})
write('open-public-download-gate',{'stage':205,'status':'passed' if full else 'not_passed','full_public_download_gate':full,'required_complete_files':4,'qualified_complete_files':len(complete),'missing_complete_files':missing,'scope':'Fresh anonymous public links and complete exact-byte browser downloads through original company TLS over explicitly local QA HTTP/1.1/public-DNS ordering. No default direct-egress, normal DNS failover, installation or full product claim.','full_original_goal_accepted':False})
cleanup=load(L/'.data/acceptance-205/runtime-cleanup-v2.json');assert cleanup['status']=='passed';write('runtime-cleanup',cleanup)
write('fixture-reclamation-readback',load(L/'.data/acceptance-205/fixture-reclamation-readback-v1/receipt.json'))
media=[]
def add(p,label,origin):
 assert p.is_file();media.append({'path':p.relative_to(D).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p),'label':label,'origin':origin})
for component in ['web','desktop']:
 for p in sorted((D/('copypaste-'+component)/'assets/screenshots').glob('*205-v1*live*')):add(p,'实际正式站点／最终原生客户端 · Actual deployed Web/final native Desktop','actual_live205')
for p in sorted((D/'copypaste-web/assets/screenshots').glob('*205-v3*controlled*')):add(p,'生产组件的受控错误情境 · Controlled production-component scenario','controlled_ui205')
for row in load(R/'docs/quality/integrated-round-204/actual-media.json')['files']:
 if row['path'].startswith(('copypaste-admin/','copypaste-extension/')):
  p=D/row['path'];assert sha(p)==row['sha256'];add(p,'原样保留198实际操作录影；本轮界面源码未改 · Retained198 actual interaction, unchanged UI','retained198')
assert len({r['path'] for r in media})==len(media);write('actual-media',{'stage':205,'files':media})
attempts=[]
p=L/'.data/deployment-205-v1/public-download-v1.sanitized.json';r=load(p);attempts.append({'kind':'public_download_initial_observer','sha256':sha(p),'status':r['status'],'owned_browser_closed':r['owned_browser_closed'],'qualified_complete_files':len([x for x in r['downloads'] if x['status']=='complete_verified']),'note':'Checksum link lives inside a closed details element. Retain actual complete files and original action failure; new observer expands the real summary before clicking.'})
for version in [1,2]:
 p=L/f'.data/integrated-205-v{version}/verification.json';r=load(p);attempts.append({'kind':'unified_verification','attempt':version,'sha256':sha(p),'status':r['status'],'passed':r['passed_cases'],'failed':r['failed_cases']})
p=L/'.data/acceptance-205/feedback-ui-v2/receipt.json';r=load(p);attempts.append({'kind':'controlled_ui_initial_load','sha256':sha(p),'status':r['status'],'error':r['errors'],'owned_browser_closed':r['owned_browser_closed'],'owned_local_server_closed':r['owned_local_server_closed']})
resume=load(L/'.data/deployment-205-v1/resume-baseline-v1.sanitized.json');write('interrupted-deployment-baseline',resume)
write('retained-attempts',{'interrupted_deployment':{'original_receipt_sha256':sha(L/'.data/deployment-205-v1/deploy-steps-v1/receipt.json'),'server_boot_time':resume['server_boot_time'],'partial_files_preserved':True,'fresh_preservation_baseline':True},'stage':205,'attempts':attempts,'original_failed_receipts_unchanged':True,'first_fixture_reclamation_failed_receipt_preserved':True,'note':'Source/test pin fixes and correction-state hardening completed in one v2 batch. Three v2 pre-provider startup timeouts were rerun as whole files sequentially; current product sources are identical. Controlled v2 load timeout is retained separately from fresh v3 UI success. Neither a later pass nor Git publication rewrites the original failures.'})
prior=load(R/'docs/quality/integrated-round-204/requirements-overlay.json')
overlay={**prior,'stage':205,'scope':'All original102 requirements/32 groups retained without removing historical remaining scope. Round205 is an additive implementation/evidence overlay.'}
for g in overlay['groups']:
 g['round205_update']='逐次工具交付、精确修正关联、独立持久摘要及音视频真实完成判定已更新；完整外部／专业／生产及设备验收边界保留。' if any(x in g['requirements'] for x in ['REQ-008','REQ-009','REQ-011','REQ-019','REQ-021','REQ-035','REQ-039','REQ-043','REQ-046','REQ-058','REQ-068','REQ-078']) else '保留完整原始范围及已记录增量；本轮没有此组的新完整验收。'
 g['round205_full_acceptance_closed']=False
for req in overlay['requirements']:req['round205_overlay']={'full_acceptance_closed':False,'update':'See205 exact-call delivery evidence and retained original professional/external/production scope.'}
assert len(overlay['requirements'])==102 and len(overlay['groups'])==32;write('requirements-overlay',overlay)
reqmd=Q/'requirements-102.md';assert not reqmd.exists();reqmd.write_text('# 205 · 全部原始需求与开放范围 / Complete original scope\n\n[本轮增量与边界](README.md) · [精确原始范围加本轮叠加](requirements-overlay.json)\n\n以下204表格为保留的完整历史基础；本轮未自动关闭任何完整专业／生产验收。\n\n'+(R/'docs/quality/integrated-round-204/requirements-102.md').read_text('utf-8'),'utf-8')
versions={n:load(D/('copypaste-'+n)/'package.json')['version'] for n in ['platform','web','admin','desktop','extension','delivery']}
text=f'''# 205 · 逐项交付、精确修正与持久状态 / Exact call outcomes

Backend{versions['platform']}／Web{versions['web']}／Desktop{versions['desktop']}／Delivery{versions['delivery']}；Admin{versions['admin']}及Extension{versions['extension']}保留原样业务代码。Codex唯一内核，公司API、本机Desktop、无框无菜单及原生右侧SidePanel保持原要求。

同一工具的另一份成功输出，不再清除原失败项。只有带精确原参考号、已确认未执行且可修正的调用，才能解除对应项。参考号填错保留原项并返回有界核对信息；未知操作不因换参数或重复身份变成可重做。音视频须确认真实完成、可用文件和用量。

schema166独立保存受租户／任务RLS控制的安全状态；补充资料、后续回合和活动清理不会抹掉未完成项。Web与Desktop云任务审阅使用一致活动身份和有界摘要。完整原生本机工具的通用逐项恢复协议仍按原验收范围保留。

| 内容 | 实际证据及边界 |
| --- | --- |
| 本轮代码 | [统一冻结的844份源码／166份迁移](final-source-manifest.json)、[完整102条／32组](requirements-102.md)，没有用清除标记代替验收。 |
| 相关验证 | [统一结果](verification.json)、[{sum(counts.values())}项相关证据](test-summary.json)：本轮执行{v['passed_cases']}项，其余为原样Admin／Extension证据；不是全产品矩阵。 |
| 界面与客户端 | [正式Web／最终0.7.18原生Desktop](live-production-journey.json)、[双语双主题受控错误场景](controlled-tool-feedback-ui.json)、[实际PNG／GIF／MP4](actual-media.json)。两类场景分别标注。 |
| 部署 | [应用切换、真实库备份及兼容回退](deployment.json)，未声称完成回退／全量恢复演练；[保留中断文件并完整校验后原子发布](download-publication.json)、[恢复时重新取得的保持基线](interrupted-deployment-baseline.json)。 |
| 下载 | [20501不可变包／目录与实际结果](public-downloads.json)、[四文件完整公网检查](open-public-download-gate.json)当前为{'通过' if full else '未通过'}；内网完整字节与SHA通过。 |
| 网络与服务 | [9份网络文件及实时规则保持](network-preserved.json)、[原凭证／数据库／代理保持](final-service-state.json)。不修改或重载服务器网络配置。 |
| 失败与资源 | [原失败保留](retained-attempts.json)、[目录已退出的只读核对](fixture-reclamation-readback.json)、[所有本轮自建资源已关闭](runtime-cleanup.json)。 |

19角色／50Skills的专业签收、真实视频／语音及Google／Meta／企业IdP接入、设备／并发／长期稳定／完整灾备与WorkBuddy同题盲测继续按原范围保留。默认公网HTTP/2、直接出口和正常DNS地址故障转移未被本机QA路径替代。不声明完整goal完成。

English: Independent outputs never clear another failed call. Exact validated corrections, monotonic unknown outcomes, durable RLS metadata, pruning-safe summaries and actual media completion preserve original authorization and accounting. {v['passed_cases']} current related cases plus unchanged Admin/Extension evidence support this measured release. Actual deployed/native journeys and controlled UI scenarios remain distinct. Server networking is read-only. Full professional, external, operational and device acceptance remains open; public complete-download status is {'passed for the explicit QA path' if full else 'not passed'}. No full-product completion claim.
'''
p=Q/'README.md';assert not p.exists();p.write_text(text,'utf-8')
p=R/'docs/changes/205-call-scoped-delivery.md';assert not p.exists();p.write_text('# 205 · 交付状态更新 / Release changes\n\n同工具的独立成果不再清除其他失败项；明确修正须关联原调用，未知操作不重做，修正参考号错误保留原项。schema166持久状态和一致活动身份覆盖等待、后续回合及日志清理，音视频核对实际交付。\n\nIndependent outputs preserve other failures. Exact validated correction, monotonic unknown outcomes, durable RLS state and actual media completion preserve original authority and accounting.\n\n[实际版本、回归、PNG／GIF／MP4、应用部署和下载边界](../quality/integrated-round-205/README.md) · [全部102条原始需求](../quality/integrated-round-205/requirements-102.md)\n\n服务器网络只读，不声明完整专业／生产或goal验收完成。Server networking remains read-only; complete professional, operational and original-goal acceptance remains open.\n','utf-8')
print(json.dumps({'status':'documented','related_cases':sum(counts.values()),'current_cases':v['passed_cases'],'media_files':len(media),'full_public_download_gate':full,'versions':versions}))
