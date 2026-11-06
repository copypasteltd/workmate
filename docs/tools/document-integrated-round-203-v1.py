"""Document exact final evidence and every retained failure without closing scope."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';Q=R/'docs/quality/integrated-round-203'
def load(p):return json.loads(p.read_text('utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(n,v):
 p=Q/n;assert not p.exists(),n;p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n','utf-8')
base=load(Q/'implementation-batch.json');assert len(base['production_source_files'])==829
for row in base['production_source_files']:assert sha(R/row['path'])==row['sha256'],row['path']
put('final-source-manifest.json',{'stage':203,'production_source_files':base['production_source_files'],'source_files':829,'prebuild_snapshot_sha256':sha(Q/'implementation-batch.json'),'extensions':['.ts','.tsx','.cts','.mts','.js','.mjs','.cjs','.css'],'scope':'The 829 listed production-source files in these selected extensions equal their pre-build snapshot, including native .cts. This is not a claim to cover every filesystem source extension (.py/.cs are not in this manifest). Later test-driver/operational corrections are retained separately.'})
previous=load(R/'docs/quality/integrated-round-202/final-source-manifest.json');unchanged=[]
for row in previous['production_source_files']:
 if any(row['path'].startswith('dev/copypaste-'+n+'/') for n in ['platform','admin','extension']):assert sha(R/row['path'])==row['sha256'];unchanged.append(row)
verification=load(L/'.data/integrated-203-v2/verification.json');assert verification['status']=='passed'
for c in verification['retained_checks']+verification['checks']:assert c['exit_code']==0 and sha(L/c['log'])==c['sha256']
counts={'copypaste-platform':171,'copypaste-admin':22,'copypaste-extension':93}
for c in verification['retained_checks']+verification['checks']:
 if c['phase']=='test':
  text=(L/c['log']).read_text('utf-8');assert re.findall(r'^# fail (\d+)',text,re.M)[-1]=='0';counts['copypaste-'+c['component']]=int(re.findall(r'^# tests (\d+)',text,re.M)[-1])
assert counts=={'copypaste-platform':171,'copypaste-admin':22,'copypaste-extension':93,'copypaste-web':68,'copypaste-delivery':16,'copypaste-desktop':318}
put('verification.json',verification);put('verification-retained-v1.json',load(L/'.data/integrated-203-v1/verification.json'))
put('test-summary.json',{'stage':203,'total':sum(counts.values()),'counts':counts,'current':verification,'retained_202_summary_sha256':sha(R/'docs/quality/integrated-round-202/test-summary.json'),'retained_unchanged_sources':unchanged,'scope':'688 distinct related cases with passing evidence. Web68, Desktop318 and Delivery16 are current203 executions; Backend171/Admin22/Extension93 retain exact202 source-qualified results. Desktop original parallel317/318 timeout remains failed; serial318 rerun preserves every case. Original work-draft test is retained but superseded by the complete current durable-submission suite. This is not the complete historical, professional, machine or production acceptance matrix.'})
isolated=load(L/'.data/acceptance-203/marketing-review-6a14c07b-9e2a-4ea0-8a49-371d56649ad4/receipt.json');assert isolated['status']=='passed';put('isolated-production-journey.json',isolated)
live=load(L/'.data/acceptance-203/live-review-519c0eb0-6d98-43b1-86ce-135b65067b1f/receipt.json');assert live['status']=='passed' and live['native_diagnostics']['errors']==[] and len(live['downloads'])==6
put('live-production-journey.json',live)
for fmt in ['html','csv','json']:
 rows=[x for x in live['downloads'] if x['format']==fmt];assert len(rows)==2 and len({(x['bytes'],x['sha256']) for x in rows})==1
deployment=load(L/'.data/deployment-203-v1/deployment-collected-v1.sanitized.json');assert deployment['static']['api_restarted'] is False and deployment['static']['network_configuration_unchanged'];put('deployment.json',deployment)
network=load(L/'.data/deployment-203-v1/network-preserved-v1.sanitized.json');assert network['status']=='passed' and network['network_configuration_unchanged'];put('network-preserved.json',network)
final_services=load(L/'.data/deployment-203-v1/final-service-state-v1.sanitized.json');assert final_services['status']=='passed' and final_services['network_configuration_files_equal']==9 and final_services['same_api_database_proxy_pids'];put('final-service-state.json',final_services)
inner=load(L/'.data/deployment-203-v1/inner-downloads-v2.sanitized.json');public=load(L/'.data/deployment-203-v1/public-stream-v2.sanitized.json');assert inner['status']==public['status']=='passed';put('inner-downloads.json',inner)
put('public-downloads.json',{'stage':203,'status':'passed','catalog':load(D/'copypaste-web/contracts/product-downloads.json'),'public':public,'inner':inner,'scope':'All four full inner HTTP200 files and all original-TLS public206 bytes reassembled to exact whole-file hashes/lengths. Public browser/native verification uses QA HTTP/1.1 after retained default HTTP/2 requests stalled; no server protocol, TLS validation or network change. This does not certify HTTP/2, direct developer egress, OS installation, auto-update or store publication.'})
put('packaging.json',load(D/'copypaste-desktop/.data/deployment-203-v1/packaging-receipt.json'));put('release-metadata-validation.json',load(L/'.data/deployment-203-v1/release-metadata-validation.json'))
cleanup=load(L/'.data/acceptance-203/runtime-cleanup-v2.json');assert cleanup['status']=='passed';put('runtime-cleanup.json',cleanup)
transports=[]
for version in [1,2]:
 folder=L/f'.data/acceptance-203/transport-v{version}';opened=load(folder/'receipt.private.json');closed=load(folder/'closed.json');assert closed['listeners_closed'] and opened['owner_pid']==closed['owner_pid'];transports.append({'hosts':opened['hosts'],'owner_pid':opened['owner_pid'],'listeners_closed':True})
put('qa-transport.json',{'stage':203,'transports':transports,'tls_termination':False,'response_replacement':False,'server_network_changes':False,'protocol_scope':'Original company TLS over owned pinned SSH transport; HTTP/1.1 is explicitly selected only in the QA browser/native processes. Default HTTP/2 timeout evidence remains separate.'})
role_attempts=[];selected={};latest={}
for folder in sorted((L/'.data/acceptance-203').glob('real-specialists-v*'),key=lambda p:int(p.name.rsplit('v',1)[1])):
 report=load(folder/'receipt.json');items=[]
 for row in report['items']:
  safe={k:row[k] for k in ['role','status','error','task_id','task','files','native_execution_receipts','known_terminal_correction_of','definite_not_admitted_retry','known_task_continuation','continuation','definite_not_admitted_replacement_brief'] if k in row};safe['receipt']=str((folder/row['role']/'receipt.json').relative_to(R)).replace('\\','/');items.append(safe);latest[row['role']]=safe
  if row['status']=='passed_controlled_functional_sample':selected[row['role']]=safe
 role_attempts.append({'version':folder.name,'status':report['status'],'actual_charge_micros':report['actual_charge_micros'],'items':items,'receipt_sha256':sha(folder/'receipt.json')})
proof=load(L/'.data/acceptance-203/real-specialists-v3/server-proof.private.json');assert {r['id'] for r in proof['tasks']}=={r['task_id'] for r in selected.values()}
settlement=load(L/'.data/acceptance-203/owned-settlement-v2/receipt.json');assert settlement['status']=='settled_actual_receipts' and settlement['actual_micros']=='250508'
role_report={'stage':203,'status':'all_12_controlled_functional_samples_passed' if len(selected)==12 else 'partial_controlled_samples_not_professionally_accepted','planned_roles':12,'passed_roles':len(selected),'selected':list(selected.values()),'latest':list(latest.values()),'attempts':role_attempts,'server_proof':proof,'owned_settlement':settlement,'professional_customer_acceptance':False,'scope':'Actual company Codex/runtime/immutable Skill bindings, committed business tool receipts, pinned source reads and exact file bytes. Read-only discovery tool availability is not asserted from model prose. Native check receipts cover their stated source/action/assertion only. Failed/unknown/technical-success-but-undelivered cases remain failures. Input-counting company costs are not added to customer generation charges. One collected v4 brief correction follows the retained observations; no unknown paid task replay or successful case repetition.'}
role_report['recorded_customer_charge_total_micros']=str(sum(int(r['actual_charge_micros']) for r in role_attempts)+int(settlement['actual_micros']))
put('specialist-functional-samples.json',role_report)
marketing=load(L/'.data/acceptance-203/marketing-render-diagnosis-v2.private.json');assert marketing['task']['id']=='7a213b4b-acaa-4501-84f8-ea53dcd908a9' and not marketing['receipts'] and marketing['exact_render_error_unavailable']
put('marketing-analysis-open.json',{'stage':203,'status':'functional_delivery_failed','role':'marketing-analyst','task_id':marketing['task']['id'],'technical_status':marketing['task']['status'],'charged_micros':marketing['task']['charged_micros'],'downloadable_files':0,'committed_chart_receipts':0,'exact_failure_cause_verified':False,'model_reported_error':'chart_render: Tool execution failed or permission denied','observed_runtime':marketing['runtime_read'],'read_only_diagnostic_sha256':sha(L/'.data/acceptance-203/marketing-render-diagnosis-v2.private.json'),'retained_original_diagnostic_error':'v1 ENOENT while reading the already cleaned runtime directory; its original stderr remains local. V2 records missing evidence explicitly.','scope':'The model reported completed calculation and a chart failure; those statements alone are not immutable tool-execution proof. No output/chart transaction exists and the generic runtime error does not prove permission denial or a specific validator cause. Keep this sample failed; do not submit more paid tasks to chase a pass. Safe structured tool diagnostics, professional workflow and a whole correction batch remain open.'})
media=[]
for component in ['web','desktop']:
 for p in sorted((D/('copypaste-'+component)/'assets/screenshots').glob('*203-v4-*')):
  if p.suffix in ['.png','.gif','.mp4'] and p.stem.endswith('-live'):media.append({'path':p.relative_to(D).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
assert len(media)==9;put('actual-media.json',{'stage':203,'files':media,'scope':'Final actual deployed Web/final packaged native Desktop, current explicit controlled test sources and unchanged original paid199 task. Header/budget intake and wide native views captured at explicit larger viewport. No synthetic screenshots. Intermediate isolated PNG filename reuse is a known evidence limitation; only distinct final203-v4 live media are published.'})
attempts={'stage':203,'live_ui':[{'path':p.relative_to(R).as_posix(),'sha256':sha(p),'receipt':load(p)} for p in (L/'.data/acceptance-203').glob('live-review-*/receipt.json')],'isolated_ui':[{'path':p.relative_to(R).as_posix(),'sha256':sha(p),'receipt':load(p)} for p in (L/'.data/acceptance-203').glob('marketing-review-*/receipt.json')],'public_diagnosis':[load(L/f'.data/acceptance-203/public-diagnosis-v{v}/receipt.json') for v in [1,2]],'role_attempts':[{'version':r['version'],'status':r['status'],'receipt_sha256':r['receipt_sha256']} for r in role_attempts],'limitations':['Initial native runtime symlinks were rejected correctly; application-only exact materialization fixes that deployment shape without relaxing guards.','One live ui-ux task lost its45s worker lease; original turn interruption and all known provider receipts were retained and audited Admin settlement charged HK$0.250508. Exact root-cause reproduction and long-running lease reliability remain open; a later sample does not prove that issue eliminated.','The first owned-settlement preview assertion wrongly included company-side counting fees in customer generation cost. No settlement operation was sent. V2 uses actual provider-budget generation receipt; both attempts retained.','Isolated v3/v4/v5 driver versions reused203-v3 screenshot literals, overwriting those intermediate PNGs. Their JSON/logs and separately named recordings remain, but not all intermediate image hashes can be revalidated. Final published live203-v4 media are distinct.','Default HTTP/2 original-TLS requests stalled after a successful TLS handshake. HTTP/1.1 QA succeeds; server networking and protocol policy were never changed. Full public H2/direct-egress qualification remains open.'],'scope':'Failures stay failed; test-driver/prompt/transport corrections are not product fixes or customer acceptance.'};put('retained-attempts.json',attempts)
overlay=load(R/'docs/quality/integrated-round-202/requirements-overlay.json');overlay.update(stage=203,scope='All102 original requirements and32 groups remain. Pinned specialist intake, durable request safety, current wide views and controlled role samples do not close external/professional/production gates.')
notes={'08':f"12类代表性云端角色已执行受控样例，{len(selected)}类有实际文件与功能通过证据；逐项失败及真实费用保留。不是19角色／50Skills完整专业签收。",'09':'新工作明确选择设计角色、固定共享原文件及预算；真实样例结果单列，完整客户设计简报、修改、专业签收和全部生产格式继续开放。','14':'最终0.7.16实际新S256授权、无边框／无菜单、双语主题／宽复核和同字节原生导出通过；本机固定Codex摘要核对，本轮不代替完整本机操作／机器矩阵。','15':'Setup／Portable0.7.16完整内网200与公网HTTP/1.1原TLS全部206内容的SHA／字节验证；安装升级矩阵仍开放。','17':'新工作草稿及请求按使用者／企业／项目隔离；上传和异步后重验范围，最终原生新S256登录通过；企业IdP完整接入仍开放。','18':'提交前精确持久化／读回原请求和幂等键；未知响应锁定，刷新明确同键继续，受控故障确认只一项任务／预留。一次租约超时已审计核账，根因复现和长稳仍开放。','19':'明确预算后创建；存储失败零付费POST；模型失败不伪称免费。原任务按全部已知真实调用核账，客户生成费和公司计数费分开，财务并发／外部账单验收保持开放。','20':'来源版本与角色输入不授予权限；当前共享范围及服务端权限保持，真实跨范围输入重挂载验证通过；完整安全／多企业矩阵仍开放。','23':'明确文件获取、实际上传、固定版本、上传中阻止发送已实测；四份发布文件完整验证，1GiB／全部断点及撤权矩阵保持开放。','24':'修正应用自身两个原生运行时目录为精确真实副本，保留原沙箱／完整性要求；Web静态及下载只用既有入口，9份网络文件／实时规则、凭证及DB／代理进程保持。','27':'829份含.cts的原构建前源码清单；688项相关用例有明确当前或原样源码沿用证据；本轮真实Web／最终Desktop、角色样例、文件下载和失败边界各自记录，不是全历史／生产验收。','29':'实际代码／测试／样例／费用／下载／网络保持记录同步12份README与全部102条；失败图像文件名复用限制及H2超时明确列出，不缩小目标。','30':'Web默认助手／专业角色新工作接入明确附件、拖放、图片粘贴与当前共享版本；草稿范围隔离、未知付费恢复及专业交付说明接入，全部成果工作区矩阵仍开放。','31':'品牌色、宽弹窗、容器重排与Comparison标签完整显示；实际双语／双主题／多宽度及无水平溢出通过；完整操作系统缩放／键盘／专业体验仍开放。'}
for g in overlay['groups']:g['round203_update']=notes.get(g['id'],'保留上轮完整范围及已记录增量；本轮没有此组的新增完整验收。');g['round203_full_acceptance_closed']=False
for req in overlay['requirements']:req['round203_overlay']=[{'group':g['id'],'update':g['round203_update'],'full_acceptance_closed':False} for g in overlay['groups'] if req['id'] in g['requirements']]
assert len(overlay['groups'])==32 and len(overlay['requirements'])==102;put('requirements-overlay.json',overlay)
text='# 203 · 全部原始需求追溯\n\n全部102条和32组保留。历史current字段按原记录保存，本轮进展以round203覆盖项为准；没有自动完整关闭。\n\n| 编号 | 范围 | 本轮进展和边界 |\n| --- | --- | --- |\n'+''.join(f"| {g['id']} | {g['area']} | {g['round203_update']} |\n" for g in overlay['groups'])+'\n以下原102条及完整来源不删改，202轮覆盖项作为历史记录保留；203覆盖见上表及JSON。\n\n'+(R/'docs/quality/integrated-round-202/requirements-102.md').read_text('utf-8')
(Q/'requirements-102.md').write_text(text,'utf-8')
report=f'''# 203 · 专业输入与可靠交付

Web默认助手／专业角色的新工作接入明确文件附件、实际上传和当前版本固定；草稿按使用者／企业／项目隔离。付费提交前精确保存并读回原请求及幂等键，存储失败即阻止发送，未知响应保持锁定并允许刷新后明确同键继续。Web和Desktop营销证据复核改用宽弹窗、容器重排及完整比较期标签。

Web0.5.12／Desktop0.7.16／Delivery0.5.10；Backend0.5.10／Admin0.5.2／Extension0.5.7保持。Desktop仍在客户本机运行Codex、明确可撤销完整权限且无边框／无Electron菜单；Extension仍为Chrome原生右SidePanel、明确读取上传和公司云端Codex。全部AI经公司内部API。

| 范围 | 实测与边界 |
| --- | --- |
| 代码与相关回归 | [原829份构建前清单](implementation-batch.json)、[最终同字节清单](final-source-manifest.json)；[688项相关用例](test-summary.json)，含当前Web68／Desktop318／Delivery16和原样源码沿用Backend171／Admin22／Extension93；不是完整历史、机器或专业矩阵 |
| 上传及付费恢复 | [实际隔离构建Web／原生PostgreSQL](isolated-production-journey.json)：实际上传、可选版本字段不阻止表单、范围隔离、存储失败零POST、已提交响应丢失后刷新仍只一任务／一预留／零模型调用。业务输入与故障注入为明确受控样例 |
| 正式客户端 | [实际Web／最终0.7.16原生](live-production-journey.json)：新S256授权、固定Codex字节、无框／无菜单、附件选择和预算、13口径复核、六次HTML／CSV／JSON同字节下载、双语／双主题／多宽度布局。OS物理缩放和本机完整操作矩阵不在此范围 |
| 专业角色样例 | [12类计划、{len(selected)}类功能样例通过](specialist-functional-samples.json)：真实公司Codex、Skill摘要、来源、事务工具／原生回执、实际文件与费用；失败保留，技术状态succeeded不当作交付通过。全部19角色／50Skills专业简报、修改、边界与客户签收继续开放 |
| 原生运行时 | 历史部署把两份安全检查要求的真实目录留成符号链接；[仅精确物化自身目录](deployment.json)后真实浏览器和程序执行通过，保持沙箱及完整性校验，无API重启 |
| 服务器网络 | [9份原网络文件与实时规则指纹保持](network-preserved.json)，[角色测试后的配置／凭证及原进程再核对](final-service-state.json)通过；不写或重载Nginx，不改DNS／hosts／路由／网卡／防火墙／系统代理／内网穿透 |
| 下载 | [既有入口下20301不可变发布](public-downloads.json)：Setup209808040字节、Portable209584805字节、原Extension346969字节与SHA256SUMS293字节，完整内网200及公网全部206内容重组验证。旧版本保留，不是安装升级／商店验收 |
| 公网协议 | 原TLS HTTP/2请求超时证据保留；本机QA进程选择HTTP/1.1后正式站点、下载及原生导出通过，未改服务器协议或网络。HTTP/2／开发机直接出口的完整新验收仍开放 |
| 本轮未闭合 | 一次云任务租约超时按真实费用HK$0.250508审计结清；根因复现／长稳尚未关闭。[营销分析未交付文件及诊断边界](marketing-analysis-open.json)保持失败；原始角色失败见逐项回执。真实视频／语音、Google／Meta授权、企业IdP、全部机器／大文件／容量／灾备、专业签收和WorkBuddy同题盲测仍按[102条／32组](requirements-102.md)保持 |

[实际PNG／GIF／MP4](actual-media.json)、[失败与证据限制](retained-attempts.json)、[资源清理](runtime-cleanup.json)、[实现和使用逻辑](../../development/203-specialist-intake-and-runtime.md)、[更新说明](../../changes/203-specialist-intake.md)。中间隔离PNG存在文件名复用覆盖，未将这些图片当作不可变证据；只发布独立的最终203-v4线上媒体。上述增量不表示完整goal完成。

English: Pinned specialist intake, scope-bound drafts and exact durable body/key readback protect paid submission and explicit recovery. Actual deployed Web/final frameless Desktop verify original native authority, evidence and byte-identical exports.688 related cases have source-qualified passing evidence, with original failures retained.12 representative role trials have {len(selected)} currently qualified functional samples; professional customer acceptance remains open. Release files are fully verified. All server networking, credentials and original database/proxy processes remain unchanged. Default H2 stalls, one task lease investigation, role-attempt outcomes and the complete original102 requirements remain explicit.
'''
(Q/'README.md').write_text(report,'utf-8')
print(json.dumps({'status':'documented','related_cases':sum(counts.values()),'source_files':829,'passed_role_samples':len(selected),'media':len(media),'requirements':102,'groups':32}))
