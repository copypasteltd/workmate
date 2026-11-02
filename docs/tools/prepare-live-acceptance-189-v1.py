"""Publish actual image, admin and regression evidence without private sessions."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json,re,shutil,subprocess,sys

ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery'
A=D/'.data/acceptance-189';P=D/'.data/deployment-189'
PROOF=ROOT/'docs/quality/live-acceptance-189';MEDIA=ROOT/'docs/assets/live-acceptance-189'
COMP={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
def digest(p):return sha256(p.read_bytes()).hexdigest()
def save(p,data):
 with p.open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def text(p,value):
 with p.open('x',encoding='utf8',newline='\n') as f:f.write(value)
def git(repo,*args):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',str(repo),*args],cwd=repo).decode()
export=Path(sys.argv[1]).resolve();assert export.parent==P.resolve()
full=json.loads((A/'regression-0d0b00f2-7ddc-4adf-bbbb-127a4854a579/receipt.json').read_bytes())
assert full['native_database_closed']
backend=next(c for c in full['checks'] if c['component']=='platform' and c['label']=='current-tests')
assert backend['counts']=={'tests':1950,'pass':1949,'fail':1,'cancelled':0,'skipped':0,'todo':0}
assert all(c['exit_code']==0 for c in full['checks'] if c is not backend)
images=[]
for f in A.glob('real-image-web-*/receipt.json'):
 r=json.loads(f.read_bytes())
 if r['status']=='passed':images.append((f,r))
assert len(images)==1,'Exactly one successful actual Web generation is expected.'
image_file,image=images[0];assert image['owned_browser_closed'] and image['download']['width']==1024
assert image.get('original_download',{}).get('width')==image['normalization']['source']['width']
production=json.loads((export/'live-189-v5/deployment.sanitized.json').read_bytes())
validation=json.loads((export/'live-189-v4/image-retest-9038f92a-96b8-4d1a-ab5b-7a6c01c0a84e.sanitized.json').read_bytes())
assert validation['status']=='published_and_verified' and validation['validation']['state']=='passed'
final_files=list((export/'live-189-v5').glob('final-status-*.sanitized.json'));assert len(final_files)==1
final=json.loads(final_files[0].read_bytes());assert final['status']=='origin_healthy_with_open_acceptance_gaps'
assert digest(P/'workmate-real-services-189-v5.zip')==production['archive_sha256']
PROOF.mkdir();MEDIA.mkdir()
save(PROOF/'image-generation-and-edit.json',validation)
save(PROOF/'backend-deployment.json',production);save(PROOF/'final-origin-status.json',final)
admin=json.loads((export/'live-189-v2/admin-deployment.sanitized.json').read_bytes());save(PROOF/'admin-deployment.json',admin)
evidence=[]
for f in sorted(A.glob('*/receipt.json')):
 r=json.loads(f.read_bytes())
 safe={k:r[k] for k in ['stage','status','at','finished_at','scope','files','native_database_closed','owned_browser_closed','owned_processes_closed','owned_windows_closed','local_virtualization_used'] if k in r}
 safe['checks']=[{k:c[k] for k in ['name','status','component','label','exit_code','counts','log_sha256'] if k in c} for c in r.get('checks',[])]
 if f==image_file:
  for k in ['task_id','task','normalization','download','original_download','javascript_errors']:safe[k]=r[k]
 safe['original_receipt_sha256']=digest(f);safe['private_original']=f.relative_to(D).as_posix()
 target=PROOF/(f.parent.name+'.json');save(target,safe)
 evidence.append({'label':f.parent.name,'status':r['status'],'receipt':target.relative_to(ROOT).as_posix()})
server_attempts=[]
for f in sorted(export.glob('*/*.sanitized.json')):
 r=json.loads(f.read_bytes())
 safe={k:r[k] for k in ['stage','status','at','scope','model','release_id','publication_id','upstream_status','group_image_permission_denied','original_failures_preserved','old_failed_validation_preserved','capacity_releases'] if k in r}
 if isinstance(r.get('validation'),dict):safe['validation']={k:r['validation'][k] for k in ['id','state','release_id','finished_at'] if k in r['validation']}
 safe['original_receipt_sha256']=digest(f);safe['private_original']=f.relative_to(D).as_posix()
 server_attempts.append(safe)
save(PROOF/'server-attempt-history.json',server_attempts)
log=A/'regression-0d0b00f2-7ddc-4adf-bbbb-127a4854a579/platform-current-tests.log'
tap=log.read_text(encoding='utf8',errors='replace')
current={name:int(number) for number,name in re.findall(r'^ok (\d+) - (.+)$',tap,re.M)}
replaced={25:'canonical measured-boundary pause accepts a running request without a second execution or released budget',84:'a running pause preserves the current measured turn; completed and uncertain tasks never requeue'}
prior=json.loads((ROOT/'docs/quality/live-acceptance-188/original-failures.json').read_bytes())
mapping=[]
for row in prior['failures']:
 name=replaced.get(row['number'],row['name']);assert name in current,name
 mapping.append({**row,'current_name':name,'current_tap':current[name],'current_result':'passed','interpretation':'Current measured-boundary pause contract, not a production policy change.' if row['number'] in replaced else 'Same test title in the current suite; versioned fixtures reflect current policies.'})
save(PROOF/'prior-101-failure-mapping.json',{'stage':189,'original_failures_preserved':True,'same_title_passes':99,'current_pause_contract_replacements':2,'current_log_sha256':digest(log),'items':mapping})
save(PROOF/'full-run-failure.json',{'stage':189,'original_result':'failed','test':613,'name':'invalid selectors and blocked infinite JavaScript cannot become passing checks and owned browser jobs are reclaimed','current_full_counts':backend['counts'],'full_log_sha256':digest(log),'fixed_by':'preview-deadline.ts bounds pending browser protocol calls and reclaims the owned process.','separate_followup':'regression-30541ceb-5331-4398-8c6e-72136e73395a','separate_followup_passes':14,'not_a_rewritten_full_pass':True})
for name in ['provider-termination-189-v1-schemas.json','native-video-tool-wire-0.163.0-alpha.11-189-v1.json']:
 shutil.copyfile(DEV/'copypaste-platform/contracts'/name,ROOT/'docs/contracts'/name)

admin_run=A/'termination-ui-874e074b-f280-4752-8d20-ad56f54e6d6f'
admin_ui=json.loads((admin_run/'receipt.json').read_bytes());assert admin_ui['status']=='passed' and admin_ui['owned_browser_closed']
sources={'189-real-image-delivery.png':image_file.parent/'01-real-image-delivery.png','189-original-download.png':image_file.parent/'02-downloaded-image.png','189-admin-termination.png':admin_run/'01-termination-only.png','189-desktop-local-consent.png':A/'real-desktop-4501f9ba-73a5-4b14-a6c8-bbe2bbc31aa1/01-full-local-access.png'}
for name,source in sources.items():shutil.copyfile(source,MEDIA/name)
recordings=[]
def gif(source,target,start,duration):
 subprocess.run([shutil.which('ffmpeg'),'-hide_banner','-loglevel','error','-n','-ss',str(start),'-i',str(source),'-t',str(duration),'-filter_complex','fps=8,scale=1008:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3','-loop','0',str(target)],check=True)
 recordings.append({'source_video_sha256':digest(source),'start_seconds':start,'duration_seconds':duration,'gif':target.relative_to(ROOT).as_posix()})
video=Path(image['video'])
duration=float(subprocess.check_output([shutil.which('ffprobe'),'-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(video)]))
gif(video,MEDIA/'189-actual-image-download.gif',max(3,duration-7),3.2)
gif(Path(admin_ui['video']),MEDIA/'189-actual-admin-evidence.gif',50,2.2)
component_image={'platform':'189-real-image-delivery.png','web':'189-real-image-delivery.png','admin':'189-admin-termination.png','desktop':'189-desktop-local-consent.png','extension':'189-real-image-delivery.png','delivery':'189-real-image-delivery.png'}
media=[]
for component,name in component_image.items():
 repo=DEV/('copypaste-'+component)
 demo='189-actual-admin-evidence.gif' if component=='admin' else '189-actual-image-download.gif'
 for source,folder in [(MEDIA/name,'screenshots'),(MEDIA/demo,'demos')]:
  target=repo/'assets'/folder/source.name;assert not target.exists();target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
for p in [*MEDIA.iterdir(),*[DEV/('copypaste-'+component)/'assets'/folder/name for component in component_image for folder,name in [('screenshots',component_image[component]),('demos','189-actual-admin-evidence.gif' if component=='admin' else '189-actual-image-download.gif')]]]:
 media.append({'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p)})
save(PROOF/'media.json',{'stage':189,'scope':'Actual public Web image files/downloads, actual public Admin evidence form, and Desktop local consent. Web media reused by other repositories is explicitly labelled as Web evidence.','identity_masked':True,'recordings':recordings,'files':media})

guide='https://github.com/copypasteltd/workmate/blob/docs/docs/development/189-real-image-and-acceptance.md'
marker='<!-- live-acceptance-189 -->'
responsibility={
 'platform':('本仓库实现云端 Codex、逐模型接口解析、权限、文件存储与账务。数据库保持161；生图和编辑共享已发布图片版本。','This repository owns cloud Codex, frozen per-model connection resolution, permissions, files and billing. Schema remains161; generation and editing use the published image version.'),
 'web':('在角色页选择“设计师”，进入执行模式，填写要求及预算；完成后到文件页下载标准图及原图。文件权限、实际用量与任务审计随原任务保存。','Choose Designer, execution mode, a request and budget. Download the verified image and preserved original from Files; access, measured usage and audit remain bound to the task.'),
 'admin':('模型能力中逐模型填写接口、API Key、模型名与费率，再验证和发布。供应商管理的证据表单可选择“仅确认终止”；这只释放已证实停止的并发占用，费用未知时仍保留财务预留。','Configure URL, API key, alias and rates on each model, then qualify and publish. Provider evidence offers termination-only confirmation: release proven stopped capacity while preserving unknown-cost financial holds.'),
 'desktop':('客户端开发版本0.7.3，增加无请求体读取在网络失败时的一次重试；写入和已收到响应不重放。本机 Codex、无边框、无菜单与主动完整权限设计保留。真实供应商本机任务仍未完成验收；本轮没有替换已冻结安装包。','Development version0.7.3 retries one body-free read after a transport failure, never writes or received responses. Local Codex, frameless/menu-free UI and explicit full-access consent remain. Actual supplier-backed local completion is still unqualified; frozen installers were not replaced.'),
 'extension':('扩展保持原生右侧 Side Panel 和获准附件获取／上传，推理在云端。本轮生图闭环截图来自 Web；扩展单元检查89项与构建通过，不能把 Web 截图当作扩展生图实测。','The native right Side Panel collects/uploads authorized attachments and runs inference in the cloud. Image screenshots in this update show Web. Extension89 tests/build passed; Web media is not an Extension image qualification.'),
 'delivery':('部署包189-v5和独立后台更新已上线，保留所有失败回执、旧发布与原始费用。一次性安装器先验证候选端口63079与空闲任务，再切换应用；数据库、密码和其他服务保持原样。','Backend189-v5 and the independent admin update are deployed. Failed receipts, frozen releases and original costs remain. One-shot installation checks candidate63079 and idle tasks before switching; database, credentials and unrelated services are preserved.')}
counts='后端完整运行1950项：1949通过、1失败；该浏览器超时问题随后14/14复验通过。Web28/28、后台20/20、Extension89/89、Desktop269/269及全部构建通过。图片适配48/48、逐模型图片／原图保存与测试发现36/36、真实本机协议下的生图失败／恢复2/2分别通过，不能相加当作新全量结果。'
counts_en='The full backend run recorded1950 tests:1949 passed and one failed; that browser deadline issue subsequently passed14/14 focused checks. Web28/28, Admin20/20, Extension89/89, Desktop269/269 and all builds passed. Separate image normalization48/48, per-model image/original persistence and discovery36/36, and actual native protocol image failure/recovery2/2 passed; overlapping runs are not summed into a new full-pass result.'
diagram='''```mermaid
flowchart LR
 A[Select Designer and budget] --> B[Cloud Codex with design skills]
 B --> C[Company API and frozen model connection]
 C --> D[Decode and verify PNG]
 D --> E[1024 image and exact upstream original]
 E --> F[Authorized download and measured billing]
```
'''
for component,name in component_image.items():
 repo=DEV/('copypaste-'+component);zh_detail,en_detail=responsibility[component]
 caption='实际后台证据表单 / Actual Admin evidence form' if component=='admin' else '实际 Desktop 本机权限确认，非真实模型任务通过证明 / Actual Desktop consent, not supplier acceptance' if component=='desktop' else '实际 Web 图片交付 / Actual Web image delivery'
 demo='189-actual-admin-evidence.gif' if component=='admin' else '189-actual-image-download.gif'
 for filename,language in [('README.md','zh'),('README.en.md','en')]:
  if language=='zh':
   prefix=f'''{marker}

## 真实生图上线与本轮验收 · 189

`gpt-image-2` 已使用与文字模型相同的上游接口和密钥通过真实生成、编辑验证并发布。实际 Web 设计师任务已生成文件、下载核对散列并计入真实用量。修复1254平方PNG与请求1024不一致的适配，保留上游原始字节；同时移除生图工具对重复全局密钥的错误依赖，并阻止未恢复的生图失败被标成成功。

{zh_detail}

{counts}

Desktop真实供应商任务、公网稳定性、视频／语音／Google与Meta授权、SMTP及Linux原生执行器仍有验收缺口。测试收件箱按要求保留；不宣称完整应用全部通过。[完整方案、使用逻辑、原始失败与回滚]({guide})。

{diagram}
![{caption}](assets/screenshots/{name})

{'下方为实际后台表单切换录像节选。' if component=='admin' else '下方为实际 Web 下载流程录像节选；在其他端的README中引用也仅代表Web证据。'}

![实际交互](assets/demos/{demo})

'''
  else:
   prefix=f'''{marker}

## Real image deployment and acceptance · 189

`gpt-image-2` passed actual generation and editing and is published with the same upstream URL/key as text. An actual Web Designer task generated persisted files, downloaded verified hashes and settled measured usage. Larger1254-square PNGs are decoded and normalized to1024 while exact originals remain downloadable. Image tools now resolve their frozen per-model connection without a duplicate global key; unrecovered image-tool failures cannot become successful tasks.

{en_detail}

{counts_en}

Actual supplier-backed Desktop completion, public reliability, video/audio/Google/Meta credentials, SMTP and Linux native executor qualification remain open. The requested protected test mailbox remains. This is not full-product acceptance. See the [design, usage, original failures and rollback guide]({guide}).

{diagram}
![{caption}](assets/screenshots/{name})

{'Actual Admin evidence-form interaction excerpt.' if component=='admin' else 'Actual Web download interaction excerpt. Reuse in other client repositories remains Web evidence.'}

![Actual interaction](assets/demos/{demo})

'''
  p=repo/filename;old=p.read_bytes();assert marker.encode() not in old;p.write_bytes(prefix.encode()+old)

text(ROOT/'docs/requirements/189-real-image-and-acceptance.md','''# 189 · 真实图片服务与验收约束

按用户“重新测试”的要求，使用指定的gpt-image-2及与文字模型相同的上游接口和密钥完成真实生成与编辑。实际图片必须进入客户有权限的项目文件并可下载、核对散列和计量；后台验证成功不能替代用户工作流验收。所有模型请求继续经公司服务，Codex为唯一内核。

尺寸适配只接受完整解码、经CRC／解压／像素验证的1024至2048平方PNG，按请求输出1024平方；已合规格图不改字节。若需要缩小，保留精确上游原图及来源散列，两者绑定同一任务及授权。不能静默丢弃原图、伪造素材或重复计算图片费用。

只有已证实终止的供应商请求可以释放对应并发占用。费用未知时不得虚构用量、零金额或发票；原请求、预算预留、权限与审计保留。最高管理员按现行授权直接执行，其他角色仍遵守审批策略。

保留原始失败与历史冻结发布；不同检查不能相加成一次全量通过。正式SMTP和缺少凭据的外部业务不以测试夹具冒充验收。所有开发与文档使用当前D盘根目录，不使用本地Docker／WSL，关闭自建浏览器与临时原生数据库。

[实现、验收范围和回滚](../development/189-real-image-and-acceptance.md)
''')
cost=image['task']['charged_micros'];charge=f'{int(cost)/1000000:.6f}'
development=f'''# 189 · 真实生图、问题修复与上线验收

当前后端为`real-services-189-v5`，数据库版本161；后台使用`admin-termination-189-v1`。Web为<https://agent.copypaste.hk>，后台为<https://agent-dashboard.copypaste.hk>，API为<https://ai-api.copypaste.hk>。保留历史原始记录，本文覆盖188的当前图片状态，不改写其失败历史。

## 已完成的真实闭环

1. `gpt-image-2`与当前文字模型使用相同上游与密钥，实际生成和编辑均HTTP200且完成解码。验证`a6be2e00-fb44-4915-b5bb-2145454421d4`、发布`0fcb3c37-14e8-4000-a318-d9ab02040453`。公司两次图片计量合计HK$0.02；公司费率不代表已核对供应商发票。
2. 真实Web设计师任务`{image['task_id']}`，邮箱验证→独立企业／项目→执行模式和HK$5预算→云端固定Codex→一次图片生成→项目文件→实际下载和SHA-256检查通过，实际公司扣费HK${charge}。不是后台探测或模拟图片。
3. 上游返回1254×1254，标准图1024×1024；上游原图保存为独立`.original.png`授权项目文件，下载散列和来源完全一致。原图及标准图沿用原任务隐私、保留与权限规则，只计一次生图费用。
4. 后台供应商证据可选择完整用量／发票或“仅确认终止”。实际公共页面4项检查通过。4条历史失败请求只释放有终止证明的并发占用，原状态与费用仍unknown，财务预留未释放。

{diagram}

## 本轮问题与实现

|编号|实际原因|修复与边界|
|---|---|---|
|F01|上游曾以分组未启用图片拒绝；复测现已返回真实图片|保留403及未知费用历史，按用户指示复测后发布gpt-image-2|
|F02|图片返回1254平方，原验证要求精确1024，导致HTTP200仍验证失败|完整有界解码后按比例缩小；拒绝损坏、非平方、低于1024或超过2048的输入，保留精确上游原图|
|F03|后台验证已走逐模型连接，但任务图片工具仍要求旧全局URL／Key|前置条件允许已安装的模型连接解析器，实际网关继续绑定原任务与冻结图片版本，不向客户端暴露Key|
|F04|图片工具失败后原生模型结束文字回复，任务被标为成功|记录固定IMAGE_TOOL_FAILED码；同一轮同一图片工具恢复成功可清除失败，未恢复则返回failed并传递业务错误码；保留已发生文字费用|
|F05|旧测试工作区被两条待核对Desktop任务占满|取消尚未开始且零费用的旧验收任务，新建独立QA工作区、HK$10信用及一天Pro；不改全局并发，不清除旧费用|
|F06|浏览器无限JavaScript阻塞协议等待超时|对协议和预览步骤执行可取消时限，并保留原生进程关闭、所属配置回收检查|
|F07|Windows连接器临时端口、原生Office首次启动、复杂可信工具结构投影导致检查失败|使用可用原生端口、一次有界新配置重试、可信结构投影；仍以业务结构验证最终参数|
|F08|旧夹具仍预期最高管理员必须找他人审批，或沿用旧暂停／版本语义|保留原件，新版本显式使用普通角色验证独立审批，最高管理员直接执行另有检查；暂停按现有已计量边界处理|
|F09|Desktop公网读取出现瞬时断线|0.7.3仅对无请求体的只读请求在网络TypeError后重试一次；写入、已有响应与取消不重放|

原始失败任务`7f7e4447-bae5-4148-a78a-811043c7b67b`当时只发生文字调用HK$0.029082，没有图片文件，仍保留原始succeeded状态作为反例，不能当作生图通过证明。后续修复由新的真实任务验证，不重写已结算历史。

## 检查与证据

{counts}

188原101项失败中，99项同标题在本轮当前套件通过，另2项暂停用例按当前“已计量边界暂停”合同更新并通过，见[逐项映射](../quality/live-acceptance-189/prior-101-failure-mapping.json)。这不代表旧断言在旧实现上通过，也不改写原日志。本轮完整运行仍保留1项失败原结果，源代码变更后采用针对性检查而未再次执行两小时全量。[完整机器记录](../quality/live-acceptance-189.json)含所有本地失败尝试的状态和原回执散列；原始私有异常、会话和录屏保留在受控`.data`。

逐模型图片测试首次错误改变了已冻结的网关URL指纹，产生1项夹具失败；修正版保持原URL，仅移除全局Key以验证独立模型连接，原失败保留。早期终止证据测试的版本／夹具初始化错误、缺少录屏FFmpeg和外网超时也按原样记录。

## 使用与配置

管理员进入模型能力，编辑模型自己的URL、API Key、模型别名和公司费率，执行真实验证后发布。用户验证邮箱并选择企业、项目，在设计师角色执行模式中填写用途、尺寸和预算，完成后从文件页下载主图和原图。图片编辑使用当前有权限的固定版本源图，仍走同一已发布图片模型。主图或原图被撤销时应由实际文件访问规则拒绝，不能绕过文件权限。供应商费用待核对时只提交确知的证据；“仅确认终止”不等于确认零费用。

## 部署与回滚

包`workmate-real-services-189-v5.zip` SHA-256 `{production['archive_sha256']}`，源站`/opt/workmate/overlays/real-services-189-v5/backend`。19个z前缀服务覆盖文件`zzzzzzzzzzzzzzzzzzz-real-services-189-v5.conf`。候选63079已停止，正式高位端口Web63070、后台63071、API入口63072、应用环回63073全部健康。数据库和专用代理进程、既有密码、app.env、模型加密Key及历史费用保留，没有新SQL迁移。

代码回滚使用上一189-v4覆盖，在无运行任务时切换；不删除用户数据、图片发布、未知费用、预算预留或原图。一次性打包／安装脚本不可盲目重放。明文部署说明与私有QA账户记录保存在服务器`/root/cfg/workmate/live-189-v5/deployment-note-*.txt`，权限0600；本轮QA使用OTP，没有创建密码，测试Pro到期不自动续费。已冻结安装包及134条远端基线引用保护仍有效。

## 尚未完成的真实验收

Desktop真实供应商本机任务曾出现供应商连接中断及读取失败，虽然本机权限／原生工具协议和269项检查通过，仍不能宣称本机业务全部闭环。外层公网转发仍间歇超时；源站健康不等于已修复公网链路。视频、语音／转写、Google与Meta授权缺少真实配置，SMTP按要求仍使用受保护测试收件箱；Linux原生云端程序／浏览器／Office执行器尚未取得生产资质。0.7.3只有开发构建与目录包，没有新的已签名安装器和更新渠道发布。上述缺口不被本轮图片通过覆盖。

## 实际画面与录屏

![Web实际生图与文件交付](../assets/live-acceptance-189/189-real-image-delivery.png)

![Web实际下载交互节选](../assets/live-acceptance-189/189-actual-image-download.gif)

![后台终止证据表单](../assets/live-acceptance-189/189-admin-termination.png)

![后台实际表单交互节选](../assets/live-acceptance-189/189-actual-admin-evidence.gif)

所有素材来自实际页面；GIF仅为原录像的短节选。Web素材在其他端README重复引用时仍标为Web证据，不能当作Desktop或Extension生图验收。

## English statement

Real generation, editing and a public Web Designer delivery/download completed withgpt-image-2. Per-model connection admission, strict image decoding/normalization with exact-original preservation, unknown-cost termination evidence and unrecovered image-tool status handling are deployed. The original1950-test run retains1949 passes and one deadline failure, separately repaired and rechecked14/14. Client checks/builds passed; separate runs are not summed. Actual supplier-backed Desktop completion, edge reliability, external integrations, production mail and Linux native execution remain unqualified. This is not full-product acceptance.
'''
text(ROOT/'docs/development/189-real-image-and-acceptance.md',development)
text(ROOT/'docs/changes/189-real-image-and-acceptance.md','''# 189 · 真实生图与验收修复

gpt-image-2真实生成／编辑已验证发布，Web设计师任务已实际交付图片并下载验证。上线严格PNG适配与原图保留、逐模型图片连接前置修复、未恢复生图失败状态、后台仅终止证据、浏览器预览时限及现行夹具更新。Desktop读取重试开发版0.7.3检查通过，未替换冻结安装包。

后台完整运行1950项1949通过，1项浏览器超时另有14/14修复复验；Web28、后台20、Extension89、Desktop269项及构建全部通过。保留原始失败、未知费用、数据库161、原密码和冻结历史。完整应用仍有明确的供应商／基础设施验收缺口。

[需求](../requirements/189-real-image-and-acceptance.md) · [实现、使用、证据与回滚](../development/189-real-image-and-acceptance.md) · [机器记录](../quality/live-acceptance-189.json)
''')
for filename,statement in [('README.md','真实gpt-image-2生成、编辑和Web设计师图片交付已通过并上线；原图保留、逐模型连接和失败状态已修复。完整回归及其单项复验分开记录，Desktop与外部服务仍有明确验收缺口。'),('README.en.md','Actualgpt-image-2 generation/editing and Web Designer downloads passed and are deployed. Exact originals, frozen per-model routing and image failure status are repaired. Full regression and targeted follow-ups remain separate; Desktop and external integrations retain explicit gaps.')]:
 p=ROOT/'docs'/filename;old=p.read_bytes();assert marker.encode() not in old;p.write_bytes((marker+'\n\n'+statement+'\n\n[需求 / Requirements](requirements/189-real-image-and-acceptance.md) · [报告 / Report](development/189-real-image-and-acceptance.md) · [变更 / Changes](changes/189-real-image-and-acceptance.md) · [证据 / Evidence](quality/live-acceptance-189.json)\n\n').encode()+old)
names={}
for branch,short in COMP.items():
 repo=DEV/('copypaste-'+short)
 changed=set(git(repo,'diff','--name-only','-z').split('\0'))-{''}
 for folder in ['src','scripts','tests','contracts']:
  if (repo/folder).exists():changed.update(p.relative_to(repo).as_posix() for p in (repo/folder).glob('*189*') if p.is_file())
 if branch=='backend':changed.update(['src/generated-image-normalization.ts','src/image-verification-observation.ts','src/preview-deadline.ts','scripts/run-current-tests-owned-v13.mjs','scripts/run-current-tests-owned-v14.mjs','tests/scope-erasure-150-v11.test.ts'])
 changed.update(row['path'].removeprefix(repo.relative_to(ROOT).as_posix()+'/') for row in media if row['path'].startswith(repo.relative_to(ROOT).as_posix()+'/'))
 names[branch]=sorted(changed)
names['docs']=sorted(['docs/README.md','docs/README.en.md','docs/requirements/189-real-image-and-acceptance.md','docs/development/189-real-image-and-acceptance.md','docs/changes/189-real-image-and-acceptance.md','docs/quality/live-acceptance-189.json','docs/tools/prepare-live-acceptance-189-v1.py','docs/tools/prepare-publication-189-v1.py','docs/tools/publish-live-acceptance-189-v1.py','docs/tools/review-publication-byte-preservation-189-v1.py',*[p.relative_to(ROOT).as_posix() for p in PROOF.iterdir()],*[p.relative_to(ROOT).as_posix() for p in MEDIA.iterdir()],*[p.relative_to(ROOT).as_posix() for p in (ROOT/'docs/contracts').glob('*189*')]])
sources={}
for branch,files in names.items():
 repo=ROOT if branch=='docs' else DEV/('copypaste-'+COMP[branch])
 for name in files:
  if name!='docs/quality/live-acceptance-189.json':sources[(repo/name).relative_to(ROOT).as_posix()]=digest(repo/name)
report={'stage':189,'status':'deployed_with_open_acceptance_gaps','at':datetime.now(timezone.utc).isoformat(),'full_product_accepted':False,'backend_full_regression':backend['counts'],'original_full_failure_preserved':True,'browser_deadline_followup_passed':True,'all_client_tests_and_builds_passed':True,'real_image_generation_and_edit_passed':True,'real_web_image_download_passed':True,'upstream_original_retained':True,'final_overlay':production['overlay'],'archive_sha256':production['archive_sha256'],'schema_version':161,'desktop_real_supplier_accepted':False,'missing_real_integrations':['video','speech','transcription','Google/Meta OAuth','SMTP'],'linux_native_executor_qualified':False,'public_connectivity_intermittent':True,'test_mailbox_retained':True,'historical_unknown_costs_preserved':True,'native_databases_closed':all(json.loads(f.read_bytes()).get('native_database_closed',True) for f in A.glob('*/receipt.json')),'owned_browsers_closed':all(json.loads(f.read_bytes()).get('owned_browser_closed',True) for f in A.glob('*/receipt.json')),'qa_transport_closed':True,'local_virtualization_used':False,'frozen_releases_preserved':True,'test_count_policy':'Overlapping runs are separate; original failures are never retroactively rewritten.','evidence':evidence,'sources':sources,'media':media}
save(ROOT/'docs/quality/live-acceptance-189.json',report)
with (P/'publication-paths.json').open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps(names,indent=2)+'\n')
print(json.dumps({'status':report['status'],'publication_files':{b:len(v) for b,v in names.items()},'evidence':len(evidence),'media':len(media)}))
