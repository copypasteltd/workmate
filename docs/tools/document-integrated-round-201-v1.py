"""Publish evidence only after real completion; retain all original requirements and failures."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re
root=Path(__file__).resolve().parents[2];dev=root/'dev';delivery=dev/'copypaste-delivery';out=root/'docs/quality/integrated-round-201';out.mkdir(parents=True,exist_ok=True)
def load(p):return json.loads(p.read_text('utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(name,value):(out/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
v=load(delivery/'.data/integrated-201-v4/verification.json');assert v['state']=='passed';put('verification.json',v);put('backend-test-selection.json',load(delivery/'.data/integrated-201-v4/backend-test-selection.json'))
counts={'copypaste-platform':128};logs=[]
for c in [*v['checks'],v['original_backend'],v['replay']]:
 p=delivery/c['log'];assert sha(p)==c['sha256'];logs.append({'path':p.relative_to(root).as_posix(),'sha256':sha(p),'exit_code':c['exit_code']})
 if c['phase']=='test' and c['component']!='copypaste-platform':
  text=p.read_text('utf8');counts[c['component']]=int(re.findall(r'^# tests (\d+)',text,re.M)[-1]);assert re.findall(r'^# fail (\d+)',text,re.M)[-1]=='0'
assert counts=={'copypaste-platform':128,'copypaste-web':53,'copypaste-admin':22,'copypaste-extension':93,'copypaste-delivery':16,'copypaste-desktop':312}
put('test-summary.json',{'stage':201,'counts':counts,'total':sum(counts.values()),'scope':'624 distinct current related assertions with passing evidence: unchanged backend123 retain the initial run; all five motion cases replay after test-only corruption-fixture correction and English starter copy correction. Five client suites and six builds/types retain exact successful current-round evidence; backend is rebuilt after the sole catalog-copy change. Not the entire historical backend/professional/production acceptance.','logs':logs})
local=[load(p) for p in (delivery/'.data/acceptance-201').glob('motion-production-*/receipt.json') if load(p).get('screenshot',{}).get('path','').endswith('201-v5-motion-production.png')];assert len(local)==1 and local[0]['status']=='passed';local=local[0];assert [r['width'] for r in local['overflow']]==[375,768,1024,1440];put('isolated-production-journey.json',local)
live=[load(p)for p in(delivery/'.data/acceptance-201').glob('live-motion-*/receipt.json')if load(p)['status']=='passed'];assert len(live)==1;put('live-production-journey.json',live[0])
deployment=load(delivery/'.data/deployment-201-v1/deployment-collected-v2.sanitized.json');assert deployment['deployment']['backend_root'].endswith('integrated-201-v1/backend');assert deployment['media_runtime']['status']=='passed';put('deployment.json',deployment);put('native-media-runtime.json',deployment['media_runtime'])
put('packaging.json',load(dev/'copypaste-desktop/.data/deployment-201-v1/packaging-receipt.json'));put('release-metadata-validation.json',load(delivery/'.data/deployment-201-v1/release-metadata-validation.json'))
inner=load(delivery/'.data/deployment-201-v1/inner-downloads-v1.sanitized.json');public=load(delivery/'.data/deployment-201-v1/public-stream-v2.sanitized.json');assert inner['status']==public['status']=='passed';catalog=load(dev/'copypaste-web/contracts/product-downloads.json');put('inner-downloads.json',inner);put('public-downloads.json',{'stage':201,'status':'passed','catalog':catalog,'public':public,'inner':inner,'retained_initial_public_attempt':load(delivery/'.data/deployment-201-v1/public-stream-v1.sanitized.json'),'scope':'All four files have actual inner full HTTP200 bytes/SHA verification and all public content fetched as exact original-TLS206 ranges, reassembled in order and verified against whole-file SHA/bytes. Public page links/HEAD/ranges and all three health URLs pass. Missing optional text HEAD length and two initial bounded transfer timeouts remain recorded. SSH egress does not qualify development-machine direct connectivity or OS installation.'})
transport=load(delivery/'.data/acceptance-201/transport-v1/receipt.private.json');closed=load(delivery/'.data/acceptance-201/transport-v1/closed.json');assert closed['listeners_closed'];put('qa-transport.json',{'stage':201,'hosts':transport['hosts'],'tls_termination':False,'response_replacement':False,'owned_listeners_closed':True})
cleanup=load(delivery/'.data/acceptance-201/runtime-cleanup-v1.json');assert cleanup['status']=='passed';put('runtime-cleanup.json',cleanup)
attempts={'build_test_attempts':[load(delivery/f'.data/integrated-201-v{i}/verification.json')for i in [1,2,3]],'isolated_ui_attempts':[{'receipt':p.relative_to(root).as_posix(),**load(p)}for p in(delivery/'.data/acceptance-201').glob('motion-production-*/receipt.json')],'live_ui_attempts':[{'receipt':p.relative_to(root).as_posix(),**load(p)}for p in(delivery/'.data/acceptance-201').glob('live-motion-*/receipt.json')],'explanation':'First build found two Web-only imports in the native renderer; remove them as one collected correction. Backend first run127/128 with one test-only attempt to mutate a protected asset digest; retain the denial and replay all five motion cases using storage-adapter fault injection without granting database privileges. First UI navigation missed the route after workspace switching. Early viewport observations raced ongoing screenshot capture; preserve those attempts, stop recording before resize and verify every requested width exactly. Visual review then shortened long English starter headlines without changing legacy rendering or stored project definitions. No whole-suite rerun is inferred from unchanged-source evidence.'};put('retained-attempts.json',attempts)
attempts['runtime_correction']='Production save correctly rejected absent FFmpeg/FFprobe. Install signed native Ubuntu media dependencies without changing API/database/proxy processes or credentials. Retain first package-index failure from unrelated existing ZeroTier repository; use the already refreshed signed Ubuntu index without modifying that repository or service. Repeat actual production Web save/render/download and final packaged Desktop continuation.';put('retained-attempts.json',attempts)
attempts['native_driver_correction']='The second live driver reached a real Web save/render/download and native byte comparison, then attempted reload while the new Electron window was still navigating from its initial blank page. Preserve its ERR_ABORTED failure. The third driver waits for the actual file renderer URL, bridge/root initialization and completed main-frame loading before reload. It then passes actual fresh S256 authorization, frameless/no-menu and version2 continuation. Product source and prior media remain unchanged.';put('retained-attempts.json',attempts)
manifest=load(out/'post-visual-code-batch.json');assert len(manifest['production_source_files'])==809
for r in manifest['production_source_files']:assert sha(root/r['path'])==r['sha256']
put('final-source-manifest.json',{'stage':201,'production_source_files':manifest['production_source_files'],'original_prebuild_snapshot_sha256':sha(out/'implementation-batch.json'),'two_collected_product_corrections':['Remove two Web-only crypto adapter imports from secure native renderer','Shorten English starter headings after actual visual review; preserve all legacy rendering and stored definitions'],'source_files_total':809,'unchanged_after_final_catalog_copy_correction':808})
media=[]
for component in ['web','desktop']:
 for p in sorted((dev/('copypaste-'+component)/'assets/screenshots').glob('*201*')):
  if p.suffix in ['.png','.gif','.mp4']:media.append({'path':p.relative_to(dev).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
put('actual-media.json',{'stage':201,'files':media,'scope':'Every capture is from actual executed clients. Local isolated review uses explicitly simulated business fixtures; production captures use actual company services and final packaged Desktop. Failed/intermediate captures retain their original receipts. Admin/Extension198 captures remain historical.'})
overlay=load(root/'docs/quality/integrated-round-200/requirements-overlay.json');overlay.update(stage=201,scope='All102 original requirements and32 groups remain. New motion functions and selected verification do not close external, professional or production acceptance.')
notes={'01':'模板视频已有六款双语版面、真实转场和MP4闭环；生成式视频服务未配置，不能以模板视频替代。','08':'19角色／50Skills原范围保持；六种视频版面不是新增角色，全部专业样本仍待验收。','09':'视频起步版面、镜头／字幕／音轨引用、固定来源、真实预览、不可变工程与成片下载接续；完整专业设计效果仍开放。','10':'本轮完整补齐双语视频版面、三画幅、原子时间线／字幕／帧率、真实转场、只读单帧预览和分区草稿；全字体／特效专业矩阵保持开放。','14':'最终包0.7.14真实新S256授权、无边框／无菜单及跨端工程；本机Codex和主进程字节同此前合格版本，全机器／任意应用矩阵保持。','15':'Setup／Portable0.7.14完整文件实际可下载；本轮未重做OS安装升级矩阵，受信签名按用户要求排除。','16':'Extension0.5.7原ZIP与原生右SidePanel实现保留，93回归通过；商店发布／完整Chrome矩阵不因本轮自动通过。','17':'实际Web会话与Desktop新S256授权接续同一工程；草稿按用户／企业／项目／工程分区。','20':'素材选择与预览重新核对当前项目权限、固定版本、私人范围、环境、来源可用性与SHA；完整渗透矩阵不扩称。','23':'新视频实际播放／下载SHA和全部客户端包内网／公网完整字节通过；不是全部大文件断点矩阵。','24':'schema163、原凭证、数据库／代理进程保持；线上通过原域名TLS检查，普通HTTP客户端403仍不改变防护。','27':'624项相关断言有通过证据，整轮源码先完成后统一验证；原失败和复验来源完整保留，不等于全部历史回归。','29':'本轮源码、原失败、实际媒体、下载及需求追溯绑定；不以TODO0关闭原始要求。','30':'Web／Desktop共享编辑与原工程接续，撤销／恢复／不确定保存复用同键贯通；其他工作区专业交互保持原范围。','31':'CopyPaste蓝／墨／浅底、四宽度无横向溢出，Desktop无根滚动条；全部主题／辅助功能矩阵不冒称完成。'}
for g in overlay['groups']:
 g['round201_update']=notes.get(g['id'],'沿用上一轮完整范围与开放边界，本轮未新增此组验收结论。');g['round201_full_acceptance_closed']=False
byid={g['id']:g for g in overlay['groups']}
for r in overlay['requirements']:
 r['round201_overlay']=[{'group':g,'update':byid[g]['round201_update'],'full_acceptance_closed':False}for g in r.get('current_group_references',[])];r['full_acceptance_reclassified_this_round']=False
assert len(overlay['groups'])==32 and len(overlay['requirements'])==102;put('requirements-overlay.json',overlay)
cell=lambda s:str(s).replace('|','／').replace('\n',' ')
lines=['# 201 · 全部原始需求追溯','','32组、102条原始要求全部保留；本轮增量不替代原始完整验收。','','| 编号 | 范围 | 本轮进展与边界 |','| --- | --- | --- |']+['| '+g['id']+' | '+cell(g['area'])+' | '+cell(g['round201_update'])+' |'for g in overlay['groups']]
lines+=['','| 原始要求 | 模块 | 对应组 | 本轮完整关闭 |','| --- | --- | --- | --- |']+['| '+r['id']+' | '+cell(r['module'])+' | '+','.join(r.get('current_group_references',[]))+' | 否；保留原范围 |'for r in overlay['requirements']]
(out/'requirements-102.md').write_text('\n'.join(lines)+'\n',encoding='utf8',newline='\n')
text='''# 201 · 从视频模板到真实成片

本轮先完成整批代码，再统一六端构建、测试和真实页面联调。六种中英营销视频版面／三画幅，原子镜头编排、字幕映射、帧率与音轨入点转换，实际交叉淡化／向左滑动转场，当前权限核验的单帧PNG预览、素材搜索分页、撤销／重做和明确分区草稿恢复，已贯通不可变版本、工程恢复、成片播放与真实下载。

Backend0.5.9、Web0.5.10、Desktop0.7.14、Delivery0.5.8；Admin0.5.2、Extension0.5.7保留原产品版本。Desktop仍在客户本机运行Codex并保留明确完整权限、无边框／无Electron菜单；Extension仍为原生右SidePanel与明确文件上传。全部AI请求经公司服务器，模板渲染不调用模型。

| 内容 | 实际证据与边界 |
| --- | --- |
| 整轮代码 | [构建前809源码清单](implementation-batch.json)、[最终清单](final-source-manifest.json)；先完成整批，再统一验证；整批修正与失败保留 |
| 构建／回归 | 六端构建、Desktop类型及624项相关断言有通过证据；其他后端123项沿用原通过运行，5项视频在修正故障注入及模板文案后复验，全部客户端原通过运行按源码摘要绑定；[汇总](test-summary.json) |
| 实际隔离页面 | 真实Web、原生PostgreSQL、公司渲染器、390帧MP4及实际下载／播放、原稿恢复，375／768／1024／1440精确宽度无横向溢出；业务数据明确为模拟；[回执](isolated-production-journey.json) |
| 实际线上／Desktop | 公司真实HTTPS、视频预览／成片／下载，最终安装包新S256授权、同一Web工程接续版本2；旧版本1成片保留，原AI任务扣费不变；主进程与本机固定Codex字节未变；[回执](live-production-journey.json) |
| 上线／下载 | schema163、原凭证和数据库／代理进程保持，候选就绪与活动任务0后切换；补齐原生FFmpeg／FFprobe后实际成片通过。四文件内网整文件200及公网全部206分段内容重组后完整SHA／字节核对，下载入口／HEAD／Range及三域名就绪；[部署](deployment.json)、[下载](public-downloads.json) |
| 原始范围 | [32组／102条](requirements-102.md)、[JSON](requirements-overlay.json)；全部19角色／50Skills专业样本、真实生成视频／语音、Google／Meta授权、完整机器／任意应用／长稳／容量／灾备／客户效果与WorkBuddy同题盲测仍开放 |

[产品下载页](https://agent.copypaste.hk/downloads) 使用不可变 `/downloads/releases/20101/`，旧包保留。Windows受信签名按用户要求排除；插件ZIP可加载，不声称Chrome商店发布。本轮原域名TLS经独立、仅允许三公司域名的SSH出口，保持原证书和响应，不证明开发机直连恢复。自建浏览器、Desktop、原生数据库与临时传输均已回收；[清理](runtime-cleanup.json)、[原尝试](retained-attempts.json)、[真实PNG／GIF／MP4](actual-media.json)。

English: Complete the code batch before integrated verification. Six bilingual motion starters connect atomic timing/caption/rate editing, actual transitions, authorized frame previews, fixed resources, undo/recovery, immutable versions and actual playable MP4 delivery. Six builds/types and624 distinct relevant assertions have passing evidence, with unchanged runs and corrected replays identified. Actual isolated fixtures remain distinct from production Web/final packaged Desktop. All original102 requirements remain; external/professional/production acceptance is still open.
'''
(out/'README.md').write_text(text,encoding='utf8',newline='\n')
# The changes page links to the authoritative report, avoiding stale relative report links.
(root/'docs/changes/201-motion-production.md').write_text('''# 201 · 视频制作整轮更新

六种双语视频版面和三画幅、原子镜头／字幕／帧率调整、真实转场、授权PNG预览、共享固定素材搜索分页、撤销／重做与明确分区草稿，接续实际MP4及不可变原工程。

Backend0.5.9／Web0.5.10／Desktop0.7.14／Delivery0.5.8。六端构建与624项相关断言的实际来源、保留失败、真实Web／最终Desktop、下载及完整102条范围见[完整交付回执](../quality/integrated-round-201/README.md)。Admin／Extension产品字节保持，Desktop本机Codex、原生权限、无边框／无菜单保持。生成视频／语音及广告授权、专业及生产验收不自动关闭。

English: Bilingual motion templates and atomic editing connect actual previews, fixed authorized resources, explicit draft recovery and MP4 delivery. See the evidence report for exact builds/replays, retained failures, real clients/downloads and full original acceptance limits.
''',encoding='utf8',newline='\n')
print(json.dumps({'status':'documented','assertions':sum(counts.values()),'requirements':102,'groups':32,'actual_media':len(media)}))
