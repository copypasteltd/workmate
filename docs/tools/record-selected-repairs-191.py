"""Record source-bound selected repairs, actual receipts and bilingual handoff notes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,re,shutil,subprocess

ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/acceptance-191'
Q=ROOT/'docs/quality/native-repair-191';A=ROOT/'docs/assets/native-repair-191'
Q.mkdir(parents=True,exist_ok=True)
def load(p):return json.loads(p.read_bytes())
def digest(p):return sha256(p.read_bytes()).hexdigest()
def write(p,s):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s,encoding='utf8',newline='\n')
def save(p,d):write(p,json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def rel(p):return p.relative_to(ROOT).as_posix()
def prepend(p,text):
 old=p.read_text(encoding='utf8');marker='<!-- selected-repairs-191 -->'
 assert marker not in old,'Already recorded: '+str(p)
 write(p,marker+'\n\n'+text.strip()+'\n\n'+old)

packed=DEV/'copypaste-desktop/.data/deployment-191-v5/release'
asar=digest(packed/'win-unpacked/resources/app.asar')
desktop_runs=[(p,load(p)) for p in sorted(P.glob('real-desktop-*/receipt.json'))]
matches=[(p,d) for p,d in desktop_runs if d['status']=='passed' and d.get('app_asar_sha256')==asar]
assert matches,'No actual final-build Desktop acceptance; do not publish a false completion'
desktop_path,desktop=matches[-1];assert desktop['task']['status']=='succeeded'
public_https=desktop.get('public_https_qualified') is True
route_zh=('最终Desktop使用安装包默认公司HTTPS地址，经原始CONNECT通道访问真实域名，TLS证书、请求、模型结果及账务未替换；浏览器PKCE同样使用正式HTTPS域名。本次真实闭环通过，但单次验收不等于长期公网稳定性保证，190的01继续保留。' if public_https else '最终Desktop使用现成localhost源站覆盖，通过固定主机SSH的原始TCP通道访问实际公司API63072；浏览器PKCE使用正式HTTPS域名。没有模拟响应或账务。默认安装地址仍为ai-api.copypaste.hk，本次仅证明受保护源站闭环，默认公网HTTPS稳定性仍属190的01。')
route_en=('The final Desktop uses the installer default company HTTPS origin through raw CONNECT forwarding, preserving end-to-end TLS verification, requests, model output and accounting. Browser PKCE uses the canonical HTTPS domain. This real workflow passed; a single acceptance does not establish long-term public-route reliability, so issue01 remains open.' if public_https else 'The final Desktop uses the documented localhost-origin override and a raw pinned-SSH forward to actual company API63072. Real browser PKCE uses canonical HTTPS. No response or accounting result is mocked. The installer default remains ai-api.copypaste.hk; this verifies direct-origin execution, not default public HTTPS reliability.')
cloud_path=P/'real-cloud-cf4c0ab2-af56-406a-855e-cfe2ddc8b3bf/receipt.json';cloud=load(cloud_path)
download_path=P/'cloud-download-d3ade13f-e4bb-4425-9368-839bda9f4e20/receipt.json';download=load(download_path)
assert cloud['status']==download['status']=='passed'
native_path=P/'server-evidence/linux-native-v8.json';native=load(native_path)
assert native['status']=='passed' and len(native['checks'])==8
assert all(c['status']=='passed' for c in native['checks'])
deployment=load(P/'server-evidence/code-only-v4.json');state=load(P/'server-evidence/final-state.json')
assert deployment['schema_version']==162 and deployment['credentials_unchanged'] and deployment['database_and_proxy_processes_unchanged']
assert state['obsolete_owned_global_cgroup_removed'] and state['owned_native_jobs_remaining']==[]
evidence=[]
def record(name,source,value=None):
 target=Q/name
 if value is None:target.write_bytes(source.read_bytes())
 else:save(target,value)
 evidence.append({'path':rel(target),'sha256':digest(target),'original_receipt_sha256':digest(source)})
for name,source in [
 ('backend-40.json',P/'regression-45923bd9-8751-40f4-b361-ab0876892e03/receipt.json'),
 ('windows-cloud-38.json',P/'regression-f3b21e64-fda6-4918-afe5-cf4f7f09cf05/receipt.json'),
 ('linux-native-8.json',native_path),('deployment.json',P/'server-evidence/code-only-v4.json'),
 ('capacity-final-state.json',P/'server-evidence/final-state.json'),('real-cloud.json',cloud_path),
 ('cloud-download.json',download_path),('actual-media.json',P/'media-receipt.json'),('readiness-observations.json',P/'server-evidence/health-final-v4.json'),('diagnostic-incident.json',P/'diagnostic-incident.json')]:record(name,source)
public_desktop={k:v for k,v in desktop.items() if k!='api_transport'}
public_desktop['task']={k:v for k,v in desktop['task'].items() if k not in ['startup']}
if desktop['task'].get('startup'):
 public_desktop['task']['startup']={k:v for k,v in desktop['task']['startup'].items() if k in ['protocol','attempt','max_attempts','state','contract_sha256']}
public_desktop['transport_observation']={'scope':route_en,'request_count':len(desktop.get('api_transport',{}).get('requests',[]))}
record('real-desktop.json',desktop_path,public_desktop)
termination_path=P/'owned-termination-c741b1b4-16c5-47d5-bd44-fd6ada7e5b23/receipt.json'
termination=load(termination_path)
record('audited-capacity-release.json',termination_path,{k:termination[k] for k in ['stage','status','scope','proof_sha256','checks','owned_browser_closed','finished_at']} | {'operations':[{'request_id':r['request_id'],'evidence_id':r['evidence_id'],'release_operation':r['release_operation'],'state':r['after']['state'],'capacity_held':r['after']['capacity_held'],'cost':r['after']['cost']} for r in termination['operations']]})
for name,source,total in [('desktop-controller-74.log',DEV/'copypaste-desktop/.data/native-repair-191-controller-tests-v5.log',74),('native-disconnect-1.log',DEV/'copypaste-desktop/.data/native-repair-191-disconnect-test.log',1),('gateway-streaming-24.log',DEV/'copypaste-platform/.data/native-repair-191-gateway-v4-tests.log',24)]:
 raw=source.read_text(encoding='utf8');assert re.search(r'^# pass '+str(total)+r'$',raw,re.M) and re.search(r'^# fail 0$',raw,re.M)
 record(name,source)
history=[{'run':p.parent.name,'status':d['status'],'at':d.get('at'),'error':d.get('error','')[:220],'app_asar_sha256':d.get('app_asar_sha256'),'task':{k:d.get('task',{}).get(k) for k in ['task_id','status','charged_micros']} } for p,d in desktop_runs]
save(Q/'desktop-attempt-history.json',{'stage':191,'scope':'Original failed runs stay failed; successful local output alone is not whole-workflow acceptance','runs':history})
evidence.append({'path':rel(Q/'desktop-attempt-history.json'),'sha256':digest(Q/'desktop-attempt-history.json')})
artifacts={'stage':191,'version':'0.7.4','windows_trusted_signature':False,'automatic_update_qualified':False,'excluded_item':12,'app_asar_sha256':asar,'runtime':'0.163.0-alpha.11','artifacts':[]}
for name in ['CopyPaste-0.7.4-x64-Portable.exe','CopyPaste-0.7.4-x64-Setup.exe']:
 p=packed/name;assert p.stat().st_size>180000000
 artifacts['artifacts'].append({'name':name,'bytes':p.stat().st_size,'sha256':digest(p),'download_url':'https://github.com/copypasteltd/workmate/releases/download/desktop-v0.7.4/'+name})
save(ROOT/'docs/quality/191-desktop-artifacts.json',artifacts)
for name,source in [('191-real-desktop-result.png',desktop_path.parent/'02-real-local-result.png'),('191-desktop-permission-revoked.png',desktop_path.parent/'03-permission-revoked.png')]:
 (A/name).write_bytes(source.read_bytes())
media=[{'path':rel(p),'sha256':digest(p)} for p in sorted(A.iterdir()) if p.is_file()]
dcost=f"{int(desktop['task']['charged_micros'])/1000000:.6f}"
ccost=f"{int(cloud['task']['charged_micros'])/1000000:.6f}"

requirements=f'''# 191 · 指定修复范围 / Selected repair requirements

用户指定修复190清单的02、03、04、05、07。随后明确“那么去掉12”；因此12（Windows受信代码签名、正式分发/自动更新验收）从本轮范围移除，不要求证书或以证书阻止交付。仍交付新的未签名手动安装包，旧冻结发布不覆盖。

|编号|完成条件|本轮证据|
|---|---|---|
|02|客户本机固定Codex、真实公司模型、主动本机权限、真实文件/命令与实际结算|最终0.7.4实际任务完成，HK${dcost}，并验证撤销权限|
|03|原始本机错误在本地/重启后保留，并原样分类回传服务端|断流分类、本地日志重载、服务端finish持久化和幂等验证|
|04|Linux服务器实际运行批准程序并交付结果|原生隔离Node/API/SQLite、超时/拒绝验证及真实用户任务|
|05|Linux服务器实际运行浏览器、交互、断言、截图与清理|原生Chromium表单填写/点击/截图，下载散列验证|
|07|有结束证据的本机任务不再占执行容量；未知费用仍保留|三条自有QA请求经后台审计释放容量；旧任务/预留原样，原企业新任务成功|
|12|移出本轮|不要求受信代码签名或自动更新验收|

内核唯一Codex；AI经公司逐模型上游配置。Web/Extension在云端执行，Desktop在客户本机执行并可由客户授予完整本机权限。原有无边框、无Electron菜单、Chrome原生右侧栏及品牌风格约束继续生效。

本轮不把190的01、06、08—11、13—14改成完成，也不把未知供应商账目判成零。旧错误码缺失无法追溯补造。测试收件箱继续保留。最终没有重跑全产品所有历史测试。

English: the owner selected02/03/04/05/07 and explicitly removed12. Acceptance requires actual supplier-backed local execution, durable original errors, native Linux program/browser operations and evidence-based capacity release without financial fabrication. Signing and automatic update qualification are excluded. Other numbered gaps retain their original scope. See the [implementation and evidence](../development/191-native-execution-and-capacity.md).
'''
write(ROOT/'docs/requirements/191-selected-repairs.md',requirements)
development=f'''# 191 · 本机与云端执行、错误及容量修复 / Native execution and capacity repair

2026-11-03（Asia/Taipei）。02、03、04、05、07取得本轮修复及限定范围证据；12按用户指示移出。{route_zh} 后端native-repair-191-v4、schema162已上线。Desktop0.7.4为新的未签名手动安装构建，实际测试使用其同一ASAR与固定原生运行时。此记录取代190中对应五项的旧状态，旧报告和失败回执原样保留。

|编号|修复和最终结果|验证范围|
|---|---|---|
|02|真实本机Codex完成读取、PowerShell计算、写文件、回读验证及公司结算HK${dcost}|任务`{desktop['task']['task_id']}`；总spend=100、conversions=40，随机marker保持一致；随后撤销权限|
|03|finish接受有界错误码；本地保存/重启恢复原始原因，UI优先显示本机原因|真实固定Codex断流1/1；控制器74/74；服务端错误/幂等/权限检查40/40|
|04|Linux原生Node24/API/SQLite执行可用，具备隔离和输出清单|Linux实际8/8中的相关项；真实用户任务还运行Node并生成结果|
|05|Linux原生Chromium预览/填写/点击/断言/截图及资源清理|真实云任务`{cloud['task_id']}`及实际下载；云任务费用HK${ccost}|
|07|结束状态与财务待对账分开；有终止证据才释放容量|原两条任务不再占名额，三条旧QA请求capacity_held=false，费用仍unknown；同一原受阻企业成功运行新任务|
|12|用户明确移出本轮|新的安装包仍为未签名手动安装；不声称完成受信签名或自动更新|

## 使用逻辑与操作边界

Desktop：登录按钮打开浏览器，邮箱登录后完成S256 PKCE；本机保存独立原生会话。选企业/项目/角色和本机文件夹，主动确认完整本机权限；本机固定Codex使用本机命令和文件，公司API承担模型接入与账务。完整权限不是云端文件桥接。撤销、停止、退出或账户变化即时切断本机权限；新的任务不自动获得授权。

```mermaid
flowchart LR
 A[Browser sign-in and PKCE] --> B[Native token and local folder]
 B --> C[Explicit local permission]
 C --> D[Customer-local pinned Codex]
 D --> E[Company API and per-model routing]
 D --> F[Actual local files and commands]
 E --> G[Measured usage and settlement]
 F --> G
 C --> H[Revoke or stop]
 H --> I[Stop local execution]
```

长模型流曾因未锚定正则在不完整SSE长行上反复扫描而阻塞Node事件循环，使API和续租同时超时。现改为跨数据块保存游标的逐字节扫描，保留UTF-8原始字节、CR/LF边界、工具校验、事件大小限制及终态前用量持久化。实际256KiB碎片长行的完整转发和耗时上限加入回归，网关24/24通过。

周期心跳每10秒续租；它使用本地账户epoch和服务端完整鉴权，避免非必要的远程身份读取阻塞续租。单次周期请求最多8秒，连接丢失只允许在上次服务端确认的有效租期内再试一次。服务器拒绝、撤销和过期不能重试或复活任务。本机工具每次仍执行原有在线授权，付费推理、命令和任务写入不自动重放。合法且仍有效的推理请求也续租，不能续回已过期、取消或结束的执行。

错误码`LOCAL_CODEX_STREAM_DISCONNECTED`、`LOCAL_CODEX_TURN_FAILED`及`LOCAL_COMPANY_API_UNAVAILABLE`保留具体本机原因。finish严格验证错误格式，成功结果不能附错误；原始报告和散列用于幂等比较。未知用量继续显示财务待对账，本机原始原因独立保存；旧未上报的错误不补造。

Web/Extension：授权上传的文件进入云端工作区；云端Codex写源码、调用程序/浏览器工具、依据实际回执打包，用户下载交付文件。实际云任务包含同一源码散列的Node执行和Chromium交互；独立下载核对执行JSON、浏览器JSON、PNG及ZIP散列，并实际点击“Download delivery package”。Extension仍为原生右侧Side Panel，本轮未重新运行其全套测试。

![实际本机结果](../assets/native-repair-191/191-real-desktop-result.png)

![实际Web交付](../assets/native-repair-191/191-real-cloud-delivery.png)

下图来自实际Web下载交互录像，缩放并固定遮蔽身份标签；不是Desktop或Extension交互录像。

![实际下载交互录像节选](../assets/native-repair-191/191-actual-cloud-download.gif)

## Linux原生执行与部署

批准环境：Linux x64、Node24.22.2、Playwright1.64.1/Chromium1248、bubblewrap0.6.1。运行器及301份浏览器文件固定散列；安装命令为后端`npm run setup:cloud-native-linux`。它验证合同所指定的二进制并生成本地运行器清单，不能只安装浏览器而跳过服务边界。

使用独立systemd服务的Delegate=yes委派自身cgroup；Python启动器把控制进程与每项任务的执行子组分开。每项任务独立user/mount/pid/ipc/uts/network命名空间，清空环境、无capabilities、只开放自己的工作目录；程序采用Node权限及seccomp。禁止访问宿主网络/公司密钥/其他工作区和启动未批准子进程。程序内存512MB/pids32，浏览器1GB/pids128，均受CPU限制；Chromium保留原生renderer沙箱，不使用no-sandbox。

timeout、取消、父进程消失均只终止所属任务组。清理必须取得匹配的执行ID/边界、宿主停止且job_empty=true；Windows沿用已核对Job名称的回执契约。无法证明清理安全时保留受控诊断，不删除未知活跃目录。已移除早期试验创建的全局cgroup单元，最终使用服务自身委派。

当前应用路径`/opt/workmate/overlays/native-repair-191-v4/backend`；候选端口63079验证后，仅在无正在运行客户任务时切换API63073。原63070/63071/63072入口和三个正式域名不变，app.env/migration.env逐字节不变，数据库及代理进程未重启。服务仍为非root、NoNewPrivileges、ProtectSystem=strict、PrivateTmp；仅放行自己的数据/日志和自身cgroup。

schema162为新增容量判定函数，不删任务、不改余额/费率、不抹财务预留。迁移前已备份实际数据库至服务器`/root/cfg/workmate/native-191/activation-v1/`。代码回退可切回schema162兼容的native-repair-191-v3（保留旧SSE性能问题，仅应急回退）或先前v2；更早189回退须使用已准备的rollback-schema162兼容副本，不能直接使用要求schema161的旧程序，也不能覆盖运行中新数据恢复旧库。

## 待对账与容量

`task_occupies_execution_slot`以真实已存储任务验证完整行身份，普通角色不能伪造行查询其他企业。只有本机终止报告已有finished_at、无有效租期且没有仍持有容量的供应商/视频/语音/工具/设备操作，待对账任务才能退出执行占用。父团队、GEO、业务方案和计划额度统一使用此规则。

三条旧QA请求通过实际后台OTP+TOTP、终止证据注册、预览和最高管理员直接执行`ai.capacity.release`，保留不可变审计。证据仅证明公司传输及本机执行已终止，操作者为自动化维护方；没有冒充独立供应商回调/账单，也没有断言供应商计算已停止或费用为零。未知用量、金额和原财务预留继续待真实账单核对。

## 验证与已知范围

|本轮检查|结果|说明|
|---|---|---|
|后端错误/容量/续租/权限/终止策略|40/40|最终相关构建通过|
|Windows云程序/浏览器兼容及清理|38/38|最初33/38的清理失败已修复，初始记录保留|
|模型网关与碎片长流|24/24|256KiB长行逐字节一致、性能上限、既有工具和计费规则|
|Desktop控制器|74/74|含撤销/停止/退出、无响应心跳、一次有界续期与拒绝/过期不重试|
|实际固定Codex断流|1/1|真实二进制配合自有断流端点，恰好一次推理请求，无付费重放|
|Linux原生环境|8/8|真实程序、测试失败、无限循环超时、Chromium交互、API、SQLite、宿主访问拒绝与无限页面停止|
|公司真实云任务与下载|通过|HK${ccost}；ZIP、原生JSON回执、PNG及同源散列独立核对|
|公司真实Desktop任务|通过|最终ASAR `{asar}`；HK${dcost}，本机随机输入、输出和服务端账目交叉核对|

最初真实本机任务有一次已完成业务和扣费，但验收脚本在回调页使用错误来源读取任务而失败；之后的网络、续租、Windows清理、本机输入结构误解和验收脚本撤权后过早读取界面状态等失败均保留为失败。最终测试明确输入结构并核对随机marker及独立预期值，不能用模型自报“断言通过”替代结果核查。schema迁移初次诊断曾错误使用受RLS影响的OWNER视角；最终使用CONTROL视角验证实际三条请求。

云端真实用户任务在191-v2运行；最终191-v4保留同一Linux运行器散列，并在v4已部署源码重跑8项原生验证。v3追加本机推理续租和Windows回执清理，v4修复长模型流导致的事件循环阻塞。没有把定向结果当作全产品1950项新全量通过。公网仍有间歇超时；Web真实端测经自有SSH CONNECT访问真实域名，TLS、证书、来源和响应保持原样。{route_zh}Office/Linux限制、视频/语音、Google/Meta、全专业交付矩阵与正式运行配置仍按190原项记录。

诊断过程记录：关闭一次CPU采样时，调试表达式的动态导入触发未处理异常，导致API自动重启一次，当时自有测试任务已终止；数据库和代理未重启。该诊断路径已停用、危险历史脚本不发布。随后v4经候选实例验证再上线，调试端口关闭；最终只用只读就绪探测和实际任务复核。原始事件单独保留，未把该中断归因于用户配置。

无本地Docker、WSL或VM；本轮自建浏览器、Electron、CONNECT和源站转发结束后关闭。公司上游Key/用户密码/OTP/TOTP不进入公开报告。

[机器证据](../quality/191-selected-repairs.json) · [安装包SHA256](../quality/191-desktop-artifacts.json) · [Desktop手动下载](https://github.com/copypasteltd/workmate/releases/tag/desktop-v0.7.4) · [需求范围](../requirements/191-selected-repairs.md)

## English

Selected issues02/03/04/05/07 are repaired and verified within the stated scope. Item12 was explicitly removed. Desktop0.7.4 runs pinned Codex on the customer's computer, with browser PKCE, explicit/revocable local access, actual file/PowerShell work and measured settlement. Original native failures survive settlement and journal reload. Only periodic, non-billable renewal may retry once inside the last confirmed lease; denials, revocation and expiration stop execution. Paid inference and native commands are never replayed.

Linux cloud execution uses native Node and Chromium behind per-task namespaces, seccomp, native renderer sandbox and delegated cgroup limits. Actual Web execution produced checked sources, receipts, a screenshot and downloaded packages. Schema162 separates ended native execution occupancy from unresolved finances. Three named old QA requests had capacity released through the authenticated audited admin workflow; their cost and financial reservations remain unknown. Credentials, database/proxy processes and historical releases were preserved.

{route_en} Fresh suites are40/40 backend,24/24 streaming gateway,38/38 Windows cloud compatibility,74/74 Desktop controller,1/1 actual native disconnect and8/8 actual Linux checks on deployedv4, plus real cloud/download and final-build Desktop business workflows. These are separate scopes, not a new whole-product regression. Original failures remain recorded. Ordinary public reliability and other190 items are not declared complete. The installer is unsigned and manual; trusted signing and automatic update qualification are excluded.
'''
write(ROOT/'docs/development/191-native-execution-and-capacity.md',development)
changes='''# 191 · 指定问题修复 / Selected fixes

- 02：修复长SSE行正则阻塞事件循环、活跃推理续租、周期心跳被无关身份读取阻塞、单次网络抖动直接取消；实际最终Desktop完成本机命令/文件及结算。
- 03：有界原始错误码上报、服务端持久化、完成幂等校验、重启保留与界面显示；网络中断原因与财务待对账独立保留。
- 04/05：增加Linux原生Node/API/SQLite与Chromium隔离执行、二进制批准清单、systemd自身委派、回执及清理；实际Web下载交付通过。
- 07：schema162统一待对账执行容量判定；三条旧QA请求经实际后台有审计释放容量，未知金额与预留不变。
- 12：按用户明确指示移出范围。交付0.7.4未签名手动安装器，保留旧发布和标签。
- 补充六仓双语README、真实截图/Web下载交互GIF、逐文件散列、部署及失败记录；本轮只声明相关定向与实际业务验证。

English: repair local execution/error durability and live renewal; enable native Linux program/browser work; release ended execution capacity through evidence-based admin operations without inventing fees. Item12 is excluded. Add an unsigned manual Desktop build and source-bound bilingual evidence; preserve old releases and unrelated gaps.

[方案与验证](../development/191-native-execution-and-capacity.md) · [机器证据](../quality/191-selected-repairs.json)
'''
write(ROOT/'docs/changes/191-selected-repairs.md',changes)
write(ROOT/'docs/quality/191-selected-repairs.md',development.split('## 使用逻辑与操作边界')[0]+'\n[完整实现、验证及限制](../development/191-native-execution-and-capacity.md) · [机器证据](191-selected-repairs.json)\n')
notes={
 'platform':('Linux原生程序/浏览器执行器、schema162容量判定、原始本机错误回传、活跃推理续租和长SSE流性能修复已上线。','Native Linux execution, schema162 capacity accounting, original Desktop errors, active inference renewal and linear fragmented-SSE parsing are deployed.'),
 'desktop':('0.7.4在客户本机运行固定Codex；已验证真实文件/PowerShell/结算和撤销权限。新增有界心跳续期与原始错误保留。','0.7.4 runs pinned Codex locally; actual files/PowerShell, measured settlement and permission revocation passed. Add bounded periodic renewal and durable original errors.'),
 'web':('真实用户已在当前云端环境运行程序、Chromium交互并下载核对交付文件。本轮Web产品源码未修改，未重跑其全部历史套件。','An actual Web user ran native cloud programs/Chromium and downloaded verified deliverables. Web product sources are unchanged; its complete historical suite was not rerun.'),
 'admin':('已有后台终止证据/预览/最高管理员直接执行策略用于审计释放旧QA容量；未知费用保留。本轮后台产品源码未修改。','The existing evidence/preview/super-admin workflow performed audited QA capacity release while preserving unknown fees. Admin product sources are unchanged.'),
 'extension':('继续使用Chrome原生右侧Side Panel；获准文件上传后由云端Codex执行。共享后端现支持Linux原生程序/浏览器，本轮未重新验收Extension完整流程。','Retain the Chrome native right Side Panel and approved uploads to cloud Codex. Its shared backend now supports native Linux execution; no fresh complete Extension workflow is claimed.'),
 'delivery':('新增最终原生环境/真实Desktop/Web验证、候选部署、审计容量修复和手动Desktop发布工具。运行脚本依赖本地受控配置，仅用于指定维护环境；历史失败不作为重放步骤。','Add native/runtime and real Desktop/Web checks, candidate deployment, audited capacity repair and manual Desktop publication. Scripts require protected local configuration and target the documented maintenance environment; failed historical operations are not replay instructions.')}
for component,(zh,en) in notes.items():
 repo=DEV/('copypaste-'+component)
 for kind,name in [('screenshots','191-real-cloud-delivery.png'),('screenshots','191-real-desktop-result.png'),('demos','191-actual-cloud-download.gif')]:
  dest=repo/'assets'/kind/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(A/name,dest)
 flow='''```mermaid
flowchart LR
 A[Sign in and select workspace] --> B[Cloud Codex: Web and Extension]
 A --> C[Desktop: explicit local permission]
 C --> D[Customer-local Codex]
 B --> E[Company model API and usage]
 D --> E
 B --> F[Native Linux program and browser receipts]
 E --> G[Measured billing and delivery]
 F --> G
```'''
 common='''[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/191-native-execution-and-capacity.md) · [证据 / Evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/191-selected-repairs.json) · [Desktop0.7.4手动下载 / Manual download](https://github.com/copypasteltd/workmate/releases/tag/desktop-v0.7.4)

![Actual Desktop result / 实际本机结果](assets/screenshots/191-real-desktop-result.png)

![Actual Web delivery / 实际Web交付](assets/screenshots/191-real-cloud-delivery.png)

Actual Web download recording excerpt; identity labels redacted. 这是Web实际录像节选，不代表其他端的新交互录像。

![Actual Web download](assets/demos/191-actual-cloud-download.gif)'''
 prepend(repo/'README.md',f'''## 指定问题修复与本机交付 · 191

{zh} 02/03/04/05/07取得本轮证据；12按用户要求移出，新的Windows包为未签名手动安装版本。原未知供应商费用和财务预留保留，不把执行容量释放等同结算。

{route_zh} 本轮检查：后端40/40、模型网关24/24、Windows云端兼容38/38、Desktop控制器74/74、实际固定Codex断流1/1、Linux原生8/8；真实云任务HK${ccost}、最终Desktop任务HK${dcost}。上述范围独立记录，不称为全产品重新验收；公网及190的其他未选项目继续保留。以下为当前说明，旧版本记录保留作历史。

{flow}

{common}''')
 prepend(repo/'README.en.md',f'''## Selected execution repairs and Desktop handoff · 191

{en} Selected issues02/03/04/05/07 have current evidence. The owner removed12; the new Windows build is unsigned and installed manually. Unknown supplier fees/reservations remain unresolved; execution-capacity release does not settle a bill.

{route_en} Fresh scopes: backend40/40, streaming gateway24/24, Windows cloud compatibility38/38, Desktop controller74/74, actual pinned-Codex disconnect1/1 and native Linux8/8; actual cloud task HK${ccost} and final-build Desktop task HK${dcost}. These are separate checks, not a fresh whole-product acceptance. Public reliability and other unselected190 items retain their gaps. Older entries below are historical.

{flow}

{common}''')
prepend(ROOT/'docs/README.md','''指定02/03/04/05/07已修复上线并取得本轮原生/真实任务证据；12按用户要求移出。Desktop0.7.4为新的未签名手动安装版本；Desktop实际任务按记录通道通过；默认公网长期稳定性及未知财务等其他范围继续保留。下方旧版本状态为历史。

[需求](requirements/191-selected-repairs.md) · [方案、实测和回滚](development/191-native-execution-and-capacity.md) · [更新](changes/191-selected-repairs.md) · [机器证据](quality/191-selected-repairs.json)''')
prepend(ROOT/'docs/README.en.md','''Selected02/03/04/05/07 are repaired and verified with native and real supplier-backed workflows. Desktop passed the actual workflow using the route recorded in the evidence; long-term public reliability remains open. The owner excluded12. Desktop0.7.4 is a new unsigned manual build; unknown finances, public reliability and other gaps are retained. Older status entries below are historical.

[Scope](requirements/191-selected-repairs.md) · [Implementation, checks and rollback](development/191-native-execution-and-capacity.md) · [Changes](changes/191-selected-repairs.md) · [Machine evidence](quality/191-selected-repairs.json)''')
sources={}
for component in ['platform','web','admin','desktop','extension','delivery']:
 repo=DEV/('copypaste-'+component)
 changed=subprocess.check_output(['git','-C',str(repo),'diff','--name-only','-z']).decode().split('\0')
 candidates=[repo/n for n in changed if n]
 if component=='platform':
  candidates += [repo/n for n in ['contracts/cloud-browser-runtime.linux.json','contracts/cloud-program-runtime.linux.json','migrations/162-terminated-desktop-execution-capacity.sql','scripts/launch-linux-native-service.py','scripts/setup-cloud-linux.mjs','src/cloud-linux-boundary.ts','src/cloud-linux-host.py','tests/desktop-executions-139-v3.test.ts']]
 if component=='delivery':candidates += [p for p in (repo/'scripts').glob('*191*') if not p.name.startswith('profile-owned-api-191-')]
 for p in candidates:
  if p.is_file():sources[rel(p)]=digest(p)
report={'stage':191,'at':datetime.now(timezone.utc).isoformat(),'status':'selected_targets_verified','selected_items':[2,3,4,5,7],'excluded_items':[12],'full_product_accepted':False,'schema_version':162,'backend_overlay':deployment['overlay'],'desktop_version':'0.7.4','app_asar_sha256':asar,'sources':sources,'evidence':evidence,'media':media,'counts':{'backend_targeted':{'pass':40,'fail':0},'windows_cloud_targeted':{'pass':38,'fail':0},'desktop_controller':{'pass':74,'fail':0},'gateway_streaming':{'pass':24,'fail':0},'actual_native_disconnect':{'pass':1,'fail':0},'native_linux':{'pass':8,'fail':0}},'real_desktop':{'task_id':desktop['task']['task_id'],'charged_micros':desktop['task']['charged_micros'],'result_sha256':desktop['result_sha256']},'real_cloud':{'task_id':cloud['task_id'],'charged_micros':cloud['task']['charged_micros'],'final_v4_native_source_verified_separately':True},'financial_unknowns_preserved':True,'old_request_capacity_release_count':3,'unselected_open_items':[1,6,8,9,10,11,13,14],'local_virtualization_used':False,'desktop_artifacts_manifest_sha256':digest(ROOT/'docs/quality/191-desktop-artifacts.json'),'desktop_public_https_qualified':public_https,'desktop_qualification_route':route_en,'manual_desktop_publication':'prepared_for_new_release; see subsequent publication receipt'}
save(ROOT/'docs/quality/191-selected-repairs.json',report)
print(json.dumps({'status':report['status'],'source_count':len(sources),'evidence_count':len(evidence),'desktop_cost_hkd':dcost,'desktop_task':desktop['task']['task_id']},ensure_ascii=False))
