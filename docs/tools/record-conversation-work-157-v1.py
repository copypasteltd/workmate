"""Proof-gated post-freeze cloud concurrency increment. Never rewrite executed evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,re,sys
ROOT=Path(r"D:\dev\copypasted\自有agent");DEV=ROOT/"dev";D=DEV/"copypaste-delivery";E=D/"evidence/conversation-work-157"
backend,ui=sys.argv[1:];assert all(re.fullmatch(r"\d{2}",v) for v in [backend,ui])
def digest(p):
 h=sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return h.hexdigest()
def read(p):return json.loads(p.read_bytes())
def put(p,s):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x',encoding='utf-8',newline='\n') as f:f.write(s)
def ref(p):return {'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)}
def copy(a,b):
 b.parent.mkdir(parents=True,exist_ok=True)
 with b.open('xb') as f:f.write(a.read_bytes())
 assert digest(a)==digest(b)
 return ref(b)
baseline=read(D/'.data/conversation-work-157/baseline.json')
for n,h in {**baseline['preserved_user_files'],**baseline['frozen_files']}.items():assert digest(ROOT/n)==h,n
assert digest(DEV/'copypaste-desktop/.gitattributes')==baseline['desktop_attributes_sha256']
release=D/'release/workmate-v0.1.0-rc.1'
for a in read(release/'release-manifest.json')['artifacts']:assert digest(release/a['file'])==a['sha256']
sources={};reports={};verified=set()
for name in ['backend-'+backend,'ui-'+ui]:
 r=read(E/(name+'.json'));assert r['status']=='passed' and r['source_unchanged'] and r['result_exit_code']==0
 assert r['owned_database_shutdown'] and r['owned_database_port_closed'] and r['fixture_cleanup']['status']=='passed'
 assert all(c['exit_code']==0 for c in r['checks'])
 for k in ['source_manifest','raw_report','verifier']:assert digest(D/r[k]['path'])==r[k]['sha256']
 for n,a in read(D/r['source_manifest']['path']).items():
  assert sources.setdefault(n,a['sha256'])==a['sha256'],n
  if n not in verified:assert digest(DEV/n)==a['sha256'] and digest(D/a['path'])==a['sha256'];verified.add(n)
 reports[name]=ref(E/(name+'.json'))
raw=(E/('backend-'+backend+'.tap')).read_text('utf-8')
for label,n in [('tests',7),('pass',7),('fail',0),('skipped',0)]:assert re.search(r'^# '+label+' '+str(n)+r'\s*$',raw,re.M)
j=read(E/('ui-'+ui+'-journey.json'));assert j['status']=='passed' and len(j['checks'])==5 and not j['errors']
assert all(j[k] for k in ['browser_closed','api_closed','fixture_closed'])
assert len(j['screenshots'])==4 and len(j['recordings'])==1
media=list(j['screenshots'])
for recording in j['recordings']:
 assert recording['distinct_frames']>=2 and recording['skipped_capture_errors']==0
 media.extend(recording['files'])
cover=next(m for m in media if m['path'].endswith('-two-independent-tasks.png'));gif=next(m for m in media if m['path'].endswith('.gif'));mp4=next(m for m in media if m['path'].endswith('.mp4'));copies=[]
for m in media:
 a=DEV/m['path'];assert digest(a)==m['sha256'];copies.append(copy(a,ROOT/'docs/assets/conversation-work-157'/a.name))
for repo in ['platform','admin','desktop','extension','delivery']:
 for m in [cover,gif,mp4]:copies.append(copy(DEV/m['path'],DEV/('copypaste-'+repo)/'assets/screenshots'/Path(m['path']).name))
scope='Independent cloud work within one private conversation, explicit progress/input/stop target, original retry payload and short conversation/result commit ordering. Current quota, budget, role, source and file-version checks remain. Native Desktop owns its local single thread; this is cloud Web/Extension behavior, not a native-operation concurrency change.'
cp={'at':datetime.now(timezone.utc).isoformat(),'status':'verified_conversation_work_increment','stage':157,'schema_version':155,'release':'unreleased_after_v0.1.0-rc.1','frozen_release_unchanged':True,'baseline':baseline,'backend_cases':7,'actual_journey_groups':5,'screenshots':4,'recordings':1,'broad_regression':'deliberately_omitted_by_user','model_mode':'synthetic_runtime_no_model_request','new_full_acceptance_closures':0,'source_files':sources,'reports':reports,'media':media,'shared_media_copies':copies,'scope':scope,'recorder_sha256':digest(Path(__file__))}
put(ROOT/'docs/quality/conversation-work-checkpoint-157.json',json.dumps(cp,ensure_ascii=False,indent=2)+'\n')
ledger=read(ROOT/'docs/quality/remaining-work-stage156.json');ledger.update(schema_version=ledger['schema_version']+1,current_stage=157,reviewed_at=cp['at'],checkpoint='docs/quality/conversation-work-checkpoint-157.json',previous_review=ref(ROOT/'docs/quality/remaining-work-stage156.json'),new_full_acceptance_closures=0)
ledger['current_increment']={'stage':157,'scope':scope,'backend_cases':7,'actual_client_journey_groups':5,'broad_regression':'deliberately_omitted_by_user','full_acceptance_closed':False,'release':cp['release']}
for row in ledger['requirements']:
 if row['id']=='REQ-061':
  row['implemented_scope']+='；157补齐云端普通会话独立多工作、逐项选择进度/输入/停止、同标签页刷新后原正文重试、暂停/待输入旁的新委派和短提交锁序。'
  row['current_audit_remaining']='云端同会话独立多任务主流程已实现并做受影响的定向检查；原全部多任务输入种类、删除与长期记忆组合、安装版/浏览器矩阵及生产规模完整验收仍开放。原生Desktop继续单线程单轮所有权，通过独立本机会话/团队并行，不将共享云端renderer当作原生页面。'
 if row['id'] in ['REQ-003','REQ-035','REQ-036','REQ-039','REQ-061']:
  row['current_review_note']=row.get('current_review_note','')+' 157：7项SQL/HTTP/真实Worker配合合成runtime、Extension实际HTTP控制器及5组实际Web旅程，4PNG/1GIF/1MP4；原冻结148二进制和7tag不变。全范围验收不收窄，新增关闭0。'
assert len(ledger['requirements'])==102 and ledger['summary']['required_open']==88
put(ROOT/'docs/quality/remaining-work-stage157.json',json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
lines=['# 当前编号待项 / Remaining acceptance —157','','88项是必需完整验收范围，不等于88个未实现模块。REQ-061属于后续设计扩展建议，未转述为用户逐字原始要求。','','| 编号 | 模块 | 完整验收 | 仍待完成 |','|---|---|---|---|']
for row in ledger['requirements']:lines.append('| '+' | '.join(str(v).replace('|','\\|').replace('\n',' ') for v in [row['id'],row['module'],row['full_acceptance'],row.get('current_audit_remaining',row['remaining'])])+' |')
put(ROOT/'docs/quality/remaining-work-stage157.md','\n'.join(lines)+'\n')
fence=chr(96)*3
diagram=fence+"""mermaid
flowchart TD
 A[Private cloud conversation] --> B[New independent work / separate request key]
 B --> C[Current authority, frozen available history, quota and budget]
 C --> D[Separate task, reservation and output]
 A --> E[Select task explicitly]
 E --> F[Progress / pending input / exact task controls]
 F --> D
 D --> G[Short result commit and independent settlement]
 G --> A
 H[Lost acceptance response] --> I[Same key, original body and original version]
 I --> C
"""+fence
requirements="""# 云端会话独立多工作 / Independent cloud work

本项细化REQ-061以及product/05-web-agent-workbench.md第5节；该产品文档明确约束Web。SRS的REQ-061–072是扩展设计建议，不能说成用户逐字提出的要求。technical/86及93曾明确记录普通会话单活跃限制；本次对云端提交能力取代该实现约束，旧执行证据保留。

- 同一私有、未封存的云端会话可提交独立新工作，仍受当前套餐活跃数与执行容量约束。不同任务独立权限、固定角色/上下文、预算预留、进度、输入请求、结果与费用。团队会话仍从已审阅团队计划发起。
- 交付输入明确表示新工作。笔记不启动AI。资料补充、进度和停止针对用户选定的具体任务；切换任务不把新工作草稿默默改成对旧任务的指令。
- 新任务只绑定当时可用的历史结果，排除仍运行、暂停、待输入或核对中的阶段回复。已冻结引用的撤销校验、文件乐观版本冲突、计划审批的原会话版本校验保留。计划期间会话改变仍须重新审阅。
- Web同一标签页刷新后重填相同内容，可用原请求标识和原expected_version重试；存储仅含摘要键与版本，不存消息正文。关闭标签页后的全部恢复组合未宣称通过。Extension保留原正文与标识的已有回执恢复。
- 真正Desktop本机继续一条Codex线程的单轮所有权；独立本机会话和已审批团队可并行。本次同步的是共享云端renderer，实际本机/app/conversations仍是LocalAgentWorkspace；不可据此宣称修改了本机操作能力。

English: each cloud delegation is independent work within the current plan. Select the exact task for progress, input and cancellation. Nonterminal assistant checkpoints are omitted only when freezing a new task; all frozen-source checks remain. Native Desktop thread ownership and local-session/team concurrency are separate.
"""
put(ROOT/'docs/requirements/23-independent-cloud-work.md',requirements)
development="""# 157 云端会话多工作 / Independent cloud tasks

同会话第二项普通云端工作此前被CONVERSATION_BUSY和唯一索引拒绝。现在可在额度内独立提交；进度、补充资料和停止显式选定任务，费用分别预留与结算。

"""+diagram+"""

实现：新增前向migration155，替换普通单活跃唯一索引为查询索引；requiredSchemaVersion=155。ownConversation锁定修改入口使用短事务try-advisory，竞争返回CONVERSATION_CHANGING并回滚；Worker.finish先取得相同会话gate，再锁任务/钱包，模型执行期间不持有gate，避免新提交会话→钱包与结果结算钱包→会话的反向等待。原角色、项目、套餐、源内容、计划版本、固定费率、独立预算、团队准入和文件版本检查保留。

Web为原业务输入保留请求键及首次会话版本，提交前复查组件、账号、范围和当前客户端会话代次。Extension显式选择任务，切换后清空旧进度和资料表单，迟到响应用选择代次丢弃；停止以当前已加载的任务ID执行。每个新任务以自身首段请求命名。

升级：先停止旧API/worker并备份，按原生PostgreSQL流程应用完整001–155前向迁移，再启动匹配源码的API/worker。不可将冻结stage148/schema145服务用于schema155数据库；本次源码不是旧ZIP的内容。回退须恢复匹配备份和版本，不逆改迁移历史。

验证限定：7项实际SQL/HTTP和Worker（合成runtime、不发真实模型请求）覆盖并行运行、独立取消/预算/一次结算、旧正文重试、待输入/暂停旁的新工作、提交与结算锁序、额度/权限、Extension任务目标与迟到回复。5组实际Web浏览器旅程覆盖OTP、双任务、丢失接收回复后刷新重试、选中项取消、390px繁中。文件版本代码保留，本轮未重跑完整文件写入矩阵。共享Desktop renderer重新构建，未新增安装版Desktop或真实Side Panel验收。依用户快速发版要求，跳过历史全量与跨系统回归。

原始失败01编译（不透明请求键类型）、02升级守卫、03复用检查拒绝失败报告、04不可变授权快照、05工作区owner权限与06项目隐私404测试前提均完整保留；修正使用新fixture/测试/验证器，未编辑已执行绑定文件。UI01是公共Field以可见标签覆盖aria-label而导致测试选择器失配，新旅程使用实际可见标签并等待已显示的任务目标；UI02四组主流程通过，语言切换测试误用了按钮可访问名，后改用实际切换控件title；UI03原四组主流程继续通过，但测试把应用存储语言zh-HK与HTML语言zh-Hant-HK混为一值，UI04分别按实际契约检查。最终以checkpoint引用成功报告为准。

English: the paid admission and result-commit path serializes only short commits, while each task retains its own budget, quota slot, frozen sources and control target. Deploy migration155 together with the matching source release. The stage148 v0.1.0-rc.1 ZIPs and tags remain immutable. Focused browser and SQL/Worker checks use explicit synthetic business/model fixtures; no production-provider or new native installation acceptance is asserted.

参见 [需求](../requirements/23-independent-cloud-work.md)、[检查点](../quality/conversation-work-checkpoint-157.json)、[完整待项](../quality/remaining-work-stage157.md)、[变更](../changes/157-independent-cloud-work.md)。
"""
put(ROOT/'docs/development/157-independent-cloud-work.md',development)
put(ROOT/'docs/changes/157-independent-cloud-work.md',"""# 157 变更 / Change

新增同会话独立云端工作，选定具体任务查看进度、补充资料或停止；原请求正文和版本重试，独立预算、锁序与上下文检查。schema155为前向升级。首次冻结v0.1.0-rc.1仍是stage148，后续源码未混入旧包。

Independent cloud work, exact task controls, retained retry payload and short result commits. Forward schema155 is required. Frozen stage148 packages/tags remain unchanged.

[设计与验证](../development/157-independent-cloud-work.md) · [全部待项](../quality/remaining-work-stage157.md)
""")
put(ROOT/'docs/contracts/independent-cloud-work-157.json',json.dumps({'stage':157,'schema':155,'new_endpoint':False,'paths':['POST /v1/tasks','POST /v1/tenants/:tenant/projects/:project/conversations/:id/messages'],'behavior':'independent cloud delegation within existing quota, authority and task budget','request_replay':'unchanged exact original body and idempotency key; legacy expected_version remains part of the original body','conflicts':['CONVERSATION_CHANGING','VERSION_CONFLICT','PLAN_TASK_LIMIT','CONTEXT_REVOKED','GROUP_CONVERSATION_READ_ONLY'],'native_desktop':'unchanged local thread ownership; this contract concerns cloud work'},ensure_ascii=False,indent=2)+'\n')
review={'stage':157,'requirement':'REQ-061','verdict':'partial','scoped_cloud_subrequirement':'implemented','authority_paths':['docs/product/05-web-agent-workbench.md:66','docs/requirements/01-srs.md:113'],'code_paths':['platform/src/conversation-mutation.ts:8','platform/src/persistent-work.ts:375','platform/src/persistent-work.ts:409','platform/src/persistent-work.ts:1228','platform/src/canonical-tasks.ts:438','platform/src/worker.ts:768','web/src/persistent-work.tsx:897','web/src/conversation-attempt.ts:6','extension/src/conversation.ts:342','extension/src/conversation.ts:370','extension/src/chat-panel.ts:251','desktop/renderer/src/main.tsx:863','desktop/src/local-agent.ts:689'],'document_scope':'product05 Web authority and expanded design scope; technical86/93 single-active implementation superseded for cloud admission, old evidence retained','checker':'existing req032_check single requirement checker','independent_refutation':'archive_149_refutation independently found nonterminal assistant checkpoint blockage; fixed in new-history selection while retaining frozen reference validation; static follow-up found no further proven blocker in scoped changes','limits':['No whole requirement acceptance closure','No new installed Desktop/Side Panel run','No real company model/media/provider call','No comprehensive file-write/cross-OS/history matrix'],'new_full_acceptance_closures':0}
put(ROOT/'docs/quality/conversation-work-review-157.json',json.dumps(review,ensure_ascii=False,indent=2)+'\n')
put(ROOT/'docs/quality/conversation-work-checkpoint-157.md',f"# 157 定向检查 / Focused checkpoint\n\n{cp['scope']}\n\n7项后端检查、5组实际Web旅程、4PNG和1组GIF/MP4。schema155；新增完整验收关闭0。第一版冻结包与7tag不变；报告见同名JSON。\n")
for name in ['README.md','README.en.md']:
 for repo in ['platform','web','admin','desktop','extension','delivery']:
  folder=DEV/('copypaste-'+repo);file=folder/name;coverpath='assets/screenshots/'+Path(cover['path']).name;gifpath='assets/screenshots/'+Path(gif['path']).name;mp4path='assets/screenshots/'+Path(mp4['path']).name
  if repo=='web':coverpath=Path(cover['path']).relative_to('copypaste-web').as_posix();gifpath=Path(gif['path']).relative_to('copypaste-web').as_posix();mp4path=Path(mp4['path']).relative_to('copypaste-web').as_posix()
  cn=name=='README.md';title='157 · 云端会话独立多工作' if cn else '157 · Independent cloud work in one conversation'
  text=("同一私有云端会话可在套餐额度内提交独立新工作。先选择具体任务，再查看进度、补充资料或停止；各项预算和结果独立。Web保留相同输入的原请求键/版本以恢复丢失回复；Extension保留已保存的完整回执并抛弃旧目标的迟到进度。" if cn else "Delegate independent cloud work within the plan quota. Select a task for progress, inputs or Stop; each task owns its budget and output. Web retains the original request key/version for same-input retry after a lost reply; Extension keeps its saved receipt and discards stale target responses.")
  limit=("本轮为stage157/schema155未冻结源码增量。v0.1.0-rc.1仍为stage148/schema145，不包含本轮内容。Desktop实际本机线程仍单轮运行，独立会话/团队可并行；本轮仅同步共享云端renderer。Admin本轮为方案/交付说明更新。截图和GIF均为真实Web界面，不表示安装版Desktop或真实Side Panel。" if cn else "This is an unreleased stage157/schema155 source increment. Frozen v0.1.0-rc.1 remains stage148/schema145. The actual native Desktop thread keeps one turn at a time; independent local sessions/teams can run concurrently. Only the shared cloud renderer is synchronized here. Admin changes are documentation/delivery only. Captures show the actual Web UI, not an installed native Desktop or Side Panel run.")
  verification=("7项实际SQL/HTTP/Worker（合成runtime）与Extension控制器检查、5组实际Web旅程；4PNG、1GIF/MP4。按快速发版约束跳过全量历史及跨系统回归。生产模型、媒体、真实外部平台及完整业务矩阵仍待验收。" if cn else "Validation: seven SQL/HTTP/Worker cases with a synthetic runtime and actual Extension controller, plus five real Web browser journey groups; four PNGs and one GIF/MP4. Historical and cross-OS regression were omitted under the fast-release request. Production model/media/provider acceptance and complete business matrices remain open.")
  upgrade=("使用：从会话交付输入选择“开始独立新工作”；资料需求在所选任务卡中完成；控制链接打开该任务详情。升级先停止旧API/worker、备份并应用完整001–155前向迁移，再启动对应源码服务。旧冻结schema145二进制不兼容schema155。" if cn else "Usage: choose Start independent new work in the conversation composer. Answer inputs on the selected task; its control link opens the exact task. Upgrade by stopping old API/workers, taking a backup, applying the complete001–155 forward history and starting matching source services. Do not run frozen schema145 services on schema155.")
  block='## '+title+'\n\n'+text+'\n\n'+diagram+'\n\n'+upgrade+'\n\n'+verification+'\n\n'+limit+'\n\n![Actual Web independent tasks]('+coverpath+')\n\n![Actual Web interaction]('+gifpath+')\n\n[MP4]('+mp4path+')\n\n---\n\n'
  file.write_text(block+file.read_text(encoding='utf-8'),encoding='utf-8',newline='\n')
for name in ['README.md','README.en.md']:
 p=ROOT/'docs'/name;p.write_text('## 157 · Independent cloud work / 云端会话独立多工作\n\n[需求 / Requirement](requirements/23-independent-cloud-work.md) · [设计 / Design](development/157-independent-cloud-work.md) · [变更 / Change](changes/157-independent-cloud-work.md) · [编号待项 / Remaining](quality/remaining-work-stage157.md)\n\n---\n\n'+p.read_text(encoding='utf-8'),encoding='utf-8',newline='\n')
print(json.dumps({'checkpoint':'docs/quality/conversation-work-checkpoint-157.json','sources':len(sources),'required_open':88,'new_full_acceptance_closures':0,'frozen_unchanged':True}))
