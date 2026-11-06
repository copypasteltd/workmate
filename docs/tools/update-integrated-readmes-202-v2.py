"""Update twelve bilingual component guides after actual production acceptance."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];dev=root/'dev';delivery=dev/'copypaste-delivery'
passed=[json.loads(p.read_text('utf8')) for p in (delivery/'.data/acceptance-202').glob('live-review-*/receipt.json') if json.loads(p.read_text('utf8')).get('status')=='passed'];assert len(passed)==1;live=passed[0]
summary=json.loads((root/'docs/quality/integrated-round-202/test-summary.json').read_text('utf8'));total=summary['total'];backend_count=summary['counts']['copypaste-platform']
evidence='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-202/README.md'
items={
'platform':([
'当前项目的数据集／私人报告历史增加搜索和稳定游标分页，保留数据库微秒排序、绑定身份／项目／查询并逐页重核权限；目前760个常规路由及1个条件路由。',
'确定性预览具有稳定计算引用和摘要；精确指标、全部独立口径、对应期间与缺失原因可复核。新增 /analysis/preview/export 导出完整 HTML／CSV／JSON，当前权限及摘要重验，最多8MiB，不产生模型调用／任务／费用。HTML隔离外部网络与脚本，CSV防公式注入。',
'付费创建在原幂等事务中校验 expected_calculation_sha256 后才入队；摘要变化返回409。相同已接受幂等键继续返回原任务；不能因重试创建重复费用。AI仍经公司服务器，模型地址／key／别名／费率在Admin按模型维护；schema163不变。'],[
'Current-project dataset/private-report history adds literal search and stable keyset pagination, retaining database microseconds and binding identity/project/query while rechecking current authority on every page:760 regular routes plus one conditional route.',
'Deterministic previews have stable calculation references/digests. Review exact metrics, every independent scope, periods and missing reasons. New /analysis/preview/export delivers complete HTML/CSV/JSON after current-authority/digest checks, bounded to8MiB with no model/task/charge. HTML isolates scripts/external networking; CSV prevents formula injection.',
'Paid creation checks expected_calculation_sha256 inside the original idempotent transaction before enqueue; stale previews return409. Replaying an accepted key returns the original task. All AI still uses company servers and per-model Admin upstream/key/alias/rates. Schema163 stays.']),
'web':([
'登录→选择企业／项目→Marketing insights→搜索或分页选择历史来源→填写业务问题和期间→Preview report scope。复核区展示本期／比较期、全部独立口径、指标筛选与缺失原因，展开证据可看到原始八位精度及来源。',
'直接下载复核 HTML／CSV／JSON，文件包含全部口径和固定来源，无需调用模型。需要AI分析时再明确确认最高预算，结果为私人报告；付费不是预览操作的隐含后果。报告／来源历史都支持搜索分页。',
'发出付费请求前先持久化原请求和幂等键。结果不明时锁定编辑；刷新重开后明确继续同一请求，不能自动换键重复付费，退出清理。实际隔离环境已注入提交成功但响应丢失，确认仅一个私人任务／预留；该故障注入与线上真实业务分开记录。',
'正式站点实际13口径、精确证据和三种完整下载已核验；隔离页面在375／768／1024／1440宽度及明暗主题检查，无横向溢出。下方PNG／GIF／MP4来自正式服务，导入的数据明确为验收用CSV，并非实际广告账户成绩。'],[
'Sign in→select workspace/project→Marketing insights→search/page history→set the question/periods→Preview report scope. Review current/comparison values, every independent scope, metric filters and missing reasons; expand evidence for original eight-decimal precision and sources.',
'Download complete review HTML/CSV/JSON, including all scopes and fixed sources, without a model call. Explicitly confirm a maximum budget only when requesting a private AI narrative. Source/report histories both support search/pagination.',
'Persist the exact body/key before a paid request. Unknown outcomes lock editing; reload/reopen allows explicit continuation of that original request, without automatically creating another key/charge. Sign-out clears state. Isolated committed-but-lost-response injection proves one private task/reservation and is labelled separately from production.',
'Actual production13-scope review/evidence/three downloads pass. Isolated375/768/1024/1440 layouts and light/dark views have no horizontal overflow. PNG/GIF/MP4 below use real deployed services with explicitly controlled acceptance CSV, not actual ad-account performance.']),
'desktop':([
'下载Setup／Portable并在浏览器完成S256授权。最终0.7.15仍无边框／无Electron菜单；Codex0.163.0-alpha.11在客户本机运行，完整权限须明确授予且可撤销，AI请求仍走公司API。',
'Marketing insights继续同一项目的复核流程，使用原生主进程保存。仅允许明确当前项目的复核POST路由、限定格式／摘要和请求大小；经保存对话框选择目标后，检查8MiB上限、长度、SHA及当前会话代次并原子写入，不开放任意POST或路径。',
'最终实际包已完成新S256授权、无边框／无菜单、13口径和三种原生保存；每个导出字节／SHA与Web一致。验收自动选择专属保存路径，真实主进程／IPC／公司请求未替换；该结果不等于OS安装或任意应用操作矩阵。固定本机Codex二进制摘要亦已核对。',
'本次Setup／Portable0.7.15和校验文件通过站点 /downloads/releases/20201/ 下载。旧版保留。受信签名按用户要求排除；完整机器／安装升级／长稳矩阵仍保留原验收范围。'],[
'Download Setup/Portable and complete S256 browser authorization. Final0.7.15 remains frameless with no Electron menu; pinned Codex0.163.0-alpha.11 runs locally. Full permission is explicit and revocable; AI uses company APIs.',
'Continue the same project review in Marketing insights with native main-process saving. Only the exact authorized project review POST, formats/digest/bounded body are allowed. After the save dialog selects a destination, verify8MiB/length/SHA/current session generation and atomically save; no arbitrary POST/path is exposed.',
'The actual final package completes fresh S256/no-menu/frameless checks,13-scope review and all three native saves matching Web bytes/hashes. QA automates only its owned save-dialog destination; actual main/IPC/company requests are unchanged. This does not qualify OS installation or arbitrary applications. Pinned local Codex binary hashes are verified.',
'Setup/Portable0.7.15 and checksums are available at /downloads/releases/20201/ through the site. Older releases remain. Trusted signing stays excluded by user instruction; full machine/install/update/long-run matrices retain their original scope.']),
'admin':([
'产品版本仍为0.5.2；22项相关回归通过。下方198真实后台截图／录制为历史素材，本轮未将其标成新验收。',
'每个模型可编辑上游OpenAI相容地址、API key、上游模型名和费率；保存与验证分开，密钥不下发用户端。企业／用户新建、删除、批量、额度／VIP／内容控制及最高管理员直接执行、其他角色策略审批与完整审计保持。',
'新复核／导出路由仍受当前企业／项目／私人范围／来源状态限制；不调用模型且无AI费用。导出的完整证据和摘要不授权公开分发。视频／语音、Google／Meta真实服务仍须原配置和实际验收。'],[
'Product version remains0.5.2;22 related regressions pass. The198 actual Admin screenshots/recordings below are historical, not new acceptance.',
'Each model retains editable OpenAI-compatible upstream URL, API key, upstream alias and rates, with separate save/validation and no client credential exposure. Organization/user create/delete/bulk, credit/VIP/content controls, super-admin direct execution, policy approval for other roles and full audit stay.',
'New review/export routes enforce current tenant/project/private/source authority, make no model call/AI charge and do not grant public distribution rights. Real video/voice/Google/Meta still need their original configuration and acceptance.']),
'extension':([
'产品仍为0.5.7，沿用原已发布ZIP的完整字节；93项相关回归通过。下载页提供解压载入，未声称Chrome商店发布。',
'点击工具栏打开浏览器原生右SidePanel，使用ChatGPT式对话／附件结构；用户明确选择文件后才读取上传，Codex在云端运行，全部AI请求经公司服务。',
'下方198原生SidePanel／授权／附件PNG／GIF／MP4保留为历史实际证据。本轮新营销复核只在Web／Desktop交付，未用它替代插件全Chrome／大文件／Native Host矩阵。'],[
'Product stays0.5.7 with the exact original released ZIP;93 related regressions pass. Downloads provide unpacked loading, without a Chrome Web Store publication claim.',
'The toolbar action opens native right SidePanel with ChatGPT-style chat/attachments. Read/upload only explicitly selected files. Codex runs in the cloud and all AI uses company services.',
'The198 native SidePanel/auth/attachment PNG/GIF/MP4 below remain historical actual evidence. New marketing review is delivered on Web/Desktop and does not replace full Chrome/large-file/Native Host qualification.']),
'delivery':([
'完整823份产品源码及计划用例／边界／交付脚本先成批实现，再统一六端构建和测试。653项相关用例有通过来源：Backend147／Web57／Admin22／Extension93／Delivery16／Desktop318；不是全部历史或专业／生产验收。原始失败与整批修正保留。',
'隔离原生PostgreSQL／实际Web验证13口径、精确证据、完整下载和响应丢失后的唯一请求恢复；正式Web／最终0.7.15包验证新授权、真实复核及同字节原生导出，未提交新的付费模型任务。',
'候选就绪、活动任务0后只切换Workmate应用。沿用原端口、下载alias和静态入口，不改写或重载Nginx，不改DNS／路由／防火墙／代理；发布前后文件和实时规则指纹核对，凭证／数据库／代理进程保持。',
'下载页、内网全文件200和公网原TLS完整206内容重组后核对SHA／字节，12份双语README、实际PNG／GIF／MP4与102条／32组范围同步。开发机原HTTPS直连三域名健康另有实测；独立SSH出口证据明确区分。'],[
'Complete823 production-source files and planned cases/boundaries/operations precede unified six-client builds/tests.653 relevant test cases have passing evidence: Backend147/Web57/Admin22/Extension93/Delivery16/Desktop318. This is not all historical/professional/production acceptance. Preserve original failures and collected corrections.',
'Isolated native PostgreSQL/actual Web verifies13 scopes, exact evidence, complete downloads and unique-request recovery after a lost response. Production Web/final0.7.15 verifies fresh authorization, actual review and byte-identical native exports, without submitting a new paid model task.',
'After candidate readiness/zero active tasks, switch only the owned application using existing ports/download alias/static paths. Do not write/reload Nginx or change DNS/routes/firewall/proxy. Compare file/live-rule fingerprints; preserve credentials and DB/proxy processes.',
'Download-page links, inner full200 files and public original-TLS206 content reassembled to whole-file SHA/bytes bind12 bilingual READMEs, actual media and all102 requirements/32 groups. Direct developer HTTPS readiness has separate actual evidence; owned SSH-egress evidence is labelled.'])}
flows={
'platform':'A[Current identity and project] --> B[Search and cursor history]\n B --> C[Stable preview and digest]\n C --> D[Bounded exact evidence export]\n C --> E[Explicit paid request]\n E --> F[Current digest and idempotency]\n F --> G[One private task]',
'web':'A[Sign in and project] --> B[Choose history and periods]\n B --> C[All scopes and exact evidence]\n C --> D[Free review downloads]\n C --> E[Explicit budget]\n E --> F[Persist original body and key]\n F --> G[Create or explicitly resume same request]',
'desktop':'A[Download and S256 sign-in] --> B[Frameless local app]\n B --> C[Local Codex and revocable permission]\n B --> D[Authorized project evidence]\n D --> E[Native save dialog]\n E --> F[Session bounds and hash verified atomic save]',
'admin':'A[Admin identity and role] --> B[Per-model upstream and key]\n A --> C[Organizations users credit VIP content bulk]\n C --> D[Direct or policy approval]\n D --> E[Complete audit]',
'extension':'A[Toolbar action] --> B[Native right SidePanel]\n B --> C[Explicit file choice]\n C --> D[Authorized read and upload]\n D --> E[Company cloud Codex]',
'delivery':'A[Complete whole code batch] --> B[Unified verification]\n B --> C[Retain failures and collected corrections]\n C --> B\n B --> D[Actual clients and immutable packages]\n D --> E[Application-only deployment]\n E --> F[Network preservation and full downloads]\n F --> G[Bilingual docs and ordinary eight-ref push]'}
media={}
for name in ['web','desktop']:
 png=next(r['path'] for r in live['screenshots'] if r['path'].startswith('copypaste-'+name+'/'))
 rec=next(r for r in live['recordings'] if r['component']==name)
 media[name]=[png.split('assets/screenshots/')[1]]+[r['path'].split('assets/screenshots/')[1] for r in rec['files']]
media.update(admin=['198-v4-service-readiness.png','workmate-198-v4-service-review.gif','workmate-198-v4-service-review.mp4'],extension=['198-v1-side-panel.png','workmate-198-v1-side-panel.gif','workmate-198-v1-side-panel.mp4'])
for component,(zh,en) in items.items():
 zh=[v.replace('653',str(total)).replace('Backend147','Backend'+str(backend_count)).replace('完整823份产品源码','823份按扩展名记录的源码及3份原生preload') for v in zh];en=[v.replace('653',str(total)).replace('Backend147','Backend'+str(backend_count)).replace('Complete823 production-source files','823 selected-extension source files and3 native preloads') for v in en]
 folder=dev/('copypaste-'+component);version=json.loads((folder/'package.json').read_text('utf8'))['version']
 for english in [False,True]:
  p=folder/('README.en.md' if english else 'README.md');old=p.read_text('utf8');assert not old.startswith('<!-- integrated-round-202 -->')
  text='<!-- integrated-round-202 -->\n\n## 202 · '+version+' · '+('Evidence review, delivery and safe request recovery' if english else '营销证据复核、交付与请求恢复')+'\n\n[Evidence and limits / 证据与边界]('+evidence+') · [Downloads / 下载](https://agent.copypaste.hk/downloads)\n\n'
  text+='\n\n'.join(str(i)+'. '+v for i,v in enumerate(en if english else zh,1))+'\n\n```mermaid\nflowchart LR\n '+flows[component]+'\n```\n\n'
  if component in media:
   label='Historical198 actual client / 历史198实际客户端' if component in ['admin','extension'] else 'Actual deployed services with controlled acceptance CSV / 正式服务与明确验收CSV'
   text+=label+'\n\n'
   for filename in media[component]:
    assert (folder/'assets/screenshots'/filename).is_file()
    prefix='![Actual interface / 实际页面]' if filename.endswith('.png') else '![Actual interaction / 实际交互]' if filename.endswith('.gif') else '[Actual recording / 实际录影]'
    text+=prefix+'(assets/screenshots/'+filename+')\n\n'
  text+=('Earlier architecture, setup and complete use details remain below.\n\n' if english else '以下保留完整架构、安装与使用细则。\n\n');text=text.replace('653',str(total));p.write_text(text+old,encoding='utf8',newline='\n')
for english in [False,True]:
 p=root/'docs'/('README.en.md' if english else 'README.md');old=p.read_text('utf8');assert not old.startswith('<!-- integrated-round-202 -->')
 text='<!-- integrated-round-202 -->\n\n'+('Round202: searchable source/report history, complete exact evidence review, bounded HTML/CSV/JSON delivery and persisted same-request recovery.653 relevant test cases, actual clients/downloads and unchanged server network fingerprints; all original acceptance remains traceable.' if english else '202轮：来源／报告搜索分页、完整精确证据复核、HTML／CSV／JSON交付及同请求恢复；653项相关用例、实际客户端／下载及服务器网络指纹保持，原始验收持续追溯。')+'\n\n[交付 / Delivery](quality/integrated-round-202/README.md) · [102条 / Scope](quality/integrated-round-202/requirements-102.md) · [实现 / Implementation](development/202-marketing-review.md)\n\n'
 text=text.replace('653',str(total));p.write_text(text+old,encoding='utf8',newline='\n')
print(json.dumps({'status':'updated','bilingual_readmes':12,'actual_current_media':2,'historical_media':2}))
