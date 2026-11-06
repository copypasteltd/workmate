from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';REPORT='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-198/README.md'
entries={
'platform':('0.5.6','完整任务目录与当前授权','Full task directory and current authority',[
'Web／Extension在公司云端运行Codex，Desktop在客户电脑本机运行Codex；所有AI请求经公司服务器。模型仍在后台按每个模型分别配置上游API地址、key、别名与费率。',
'新增GET /v1/tenants/:tenant/projects/:project/task-directory，只返回有权读取的任务元数据。支持标题字面搜索、九种状态、cloud／desktop、ask／plan／execute和1–100条页大小，不再受最近100项界面限制。',
'分页游标使用独立域HMAC，绑定用户、会话授权版本、企业、项目、筛选、页大小及30分钟期限，保留微秒顺序。每次重新核对当前项目权限、私有任务及来源撤销；过期页409、无效游标400，调用方明确刷新。',
'目录不创建任务、不执行模型、不产生费用；schema163不变。相关回归覆盖237条实际数据库夹具、跨页顺序、组合筛选、游标篡改／换会话、只读项目和来源隔离。夹具遵守原生所有者约束；原生任务另由真实Desktop旅程验证。'],[
'Web/Extension run company-hosted Codex; Desktop Codex executes on the customer computer. Every AI call uses company servers. Admin continues to configure the upstream API URL, key, alias and rates separately on each model.',
'Adds GET /v1/tenants/:tenant/projects/:project/task-directory, returning authorized task metadata only. Literal title search, nine statuses, cloud/desktop, ask/plan/execute and1–100 rows per page remove the recent100-only UI limit.',
'Domain-separated HMAC cursors bind user, session/auth version, tenant, project, filters, page size and a30-minute lifetime with microsecond ordering. Every read rechecks current project authority, private tasks and revoked sources. Expired pages return409; malformed cursors400.',
'Directory reads never dispatch work, invoke models or create charges. Schema163 is unchanged. Regressions cover237 database fixture rows, ordering, combined filters, tampering/session changes, read-only access and source isolation. Fixtures retain native-owner invariants; real Desktop work provides native coverage.']),
'web':('0.5.6','查找工作与准确返回','Find work and return precisely',[
'登录后选择企业、项目、专业角色及材料，提交云端Codex工作。从侧栏「全部任务」进入完整任务目录，按标题／状态／执行位置／工作模式查找；下一页通过当前权限签名游标读取。',
'点击任务查看成果、文件、变更、执行、网页、活动和费用；返回保留本账户原筛选和页码。所选标签及仍可用的文件版本按任务恢复，查询文字不会写入浏览器地址栏，凭证及任务正文不放入导航状态。',
'原会话明确定位指定任务，完整审阅后返回仍是同一任务和标签。通知、成果和会话链接先确认目标企业及项目，权限未确认前不加载目标业务页；手动切换工作区离开旧链接，旧账户迟到请求不能改变新工作。',
'实际线上验证375／768／1024／1440宽度、浅深色、键盘操作、浏览器前进后退和无效项目提示。下载页已更新到Desktop0.7.10及Extension0.5.7，三个包均完成公开完整下载和SHA-256核对。'],[
'Sign in, select an organization/project, specialist and materials, then submit cloud Codex work. Open All tasks to find work by title/status/execution location/mode; subsequent pages use a cursor bound to current authority.',
'Review Results, Files, Changes, Execution, Browser, Activity and Usage. Returning retains the original account-scoped filters/page. Task tabs and still-available file versions restore without putting query text in the browser address bar or credentials/task bodies in navigation state.',
'An original conversation selects the exact requested task and preserves that task/tab through full review. Work links verify organization/project before mounting target pages. Manual scope changes leave old links; late requests from an old account cannot navigate current work.',
'Live checks explicitly assert375/768/1024/1440 widths, light/dark themes, keyboard access, browser history and unavailable-project feedback. Downloads now provide Desktop0.7.10 and Extension0.5.7; all three packages pass complete public download and SHA-256 checks.']),
'admin':('0.5.2','就绪与配置复核','Readiness and configuration review',[
'管理员通过邮箱验证码和TOTP登录，管理企业、用户、额度、VIP、权限、模型、内容、审批和审计。最高管理员按既有策略直接执行并保留审计，其他角色按策略审批。',
'每个模型分别编辑API地址、API key、上游别名及费率，支持原有编辑、验证、删除和有权限的列表批量操作；本轮不改写这些业务。',
'服务就绪页如实区分真实接通、测试邮箱和待配置服务。本轮新登录检查Office就绪、保留的角色验收记录及当前部署兼容；版本保持0.5.2，没有把未变更的后台称为新增功能版本。',
'测试收件箱按要求保留；真实SMTP、视频／语音及Google／Meta等未配置项仍开放。当前截图和GIF直接来自上线后的真实后台，不把4／13服务就绪写成全体系已验收。'],[
'Admins sign in with email verification and TOTP to manage organizations, users, funds, VIP, permissions, models, content, approvals and audit. Highest admins execute under policy with audit; other roles retain their approval policies.',
'Each model independently edits its API URL, API key, upstream alias and rates, with existing edit/validate/delete and authorized list batch actions. This round preserves these businesses.',
'Readiness distinguishes live services, the test mailbox and setup requirements. Fresh sign-in verifies Office readiness, retained role acceptance evidence and deployment compatibility. Version remains0.5.2; no new Admin feature version is claimed.',
'The requested protected test mailbox remains. Real SMTP, video/speech and Google/Meta setup stays open. Current screenshots/GIFs come from the deployed dashboard;4/13 ready services does not mean full-product acceptance.']),
'desktop':('0.7.10','本机工作与成果接续','Resume local work and results',[
'从下载页安装Setup或运行Portable，在系统浏览器授权。无边框且无Electron菜单；选择本机目录和角色，完整本机权限必须客户原生确认，可主动撤销。Codex在客户电脑读取文件、执行命令和写出成果，AI及计费经公司服务器。',
'全部任务目录可查找云端和本机工作；「在本机打开」准确回到当前电脑原有本机会话。原会话、成果面板、所选标签与范围内返回状态保留，当前文件预览仍重新核对授权和真实路径，撤权后不能继续读取。',
'从桌面打开云端工作只接受资源ID，由主进程构建固定公司域名及企业／项目链接，不接受任意网址。浏览器公司请求继续使用独立内存会话，不带Cookie且禁止跳转；本机Codex推理仍走公司网关。',
'本轮0.7.9实际包完成PKCE、私人文件往返、完整权限、本机PowerShell读写result.json、真实HK$0.032730结算、撤权和目录返回。指令及输出折叠且退出码可见，没有根滚动条或横向溢出。最终0.7.10修正目录金额为「已记录用量」，完成真实PKCE、原任务目录与返回复验；全部主进程和原生运行时与0.7.9逐字节相同，没有重复付费任务。当前GIF来自最终目录审阅；0.7.9完成执行截图及回执保留。完整任意应用／离线／休眠兼容仍需验收。'],[
'Install Setup or run Portable and authorize in the system browser. The app is frameless without Electron menus. Choose a local folder/specialist; full local access requires explicit native consent and can be revoked. Codex reads, executes and writes on the customer computer; AI/billing uses company servers.',
'All tasks finds cloud/local work. Open locally returns to the original session on this computer. Session, results panel, selected tab and scoped return state restore. Current-file preview still rechecks permission/canonical paths; withdrawal prevents further reads.',
'Cloud-work opening accepts resource IDs only; the main process builds company-origin organization/project URLs. Arbitrary URLs are rejected. Company browser requests retain a separate memory-only session without cookies or redirects; local Codex inference continues through its company gateway.',
'The actual0.7.9 package completes PKCE, private file transfer, full access, real PowerShell result.json work, HK$0.032730 settlement, revocation and directory return. Commands/output stay collapsed with exit status; root/horizontal overflow checks pass. Final0.7.10 corrects directory amounts to Recorded usage and passes actual PKCE/directory/return checks. Every main-process/runtime byte matches0.7.9; no repeated paid task is claimed. Current GIF records the final directory; the0.7.9 execution PNG/receipt remain. Arbitrary-app/offline/sleep compatibility remains open.']),
'extension':('0.5.7','右侧会话与历史恢复','Side Panel and restored history',[
'下载ZIP并解压，在Chrome开发者模式加载目录；点击工具栏图标打开真正的浏览器右侧Side Panel。保留ChatGPT式会话、输入和附件布局，Agent运行在公司云端。',
'通过公司Web完成PKCE，选择企业及项目，再明确选择／拖入文件或粘贴图片。只上传获准材料，不给予插件任意读取本机文件的能力。',
'历史搜索、归档筛选和页码按账户／范围在原有串行存储队列内保存；重新打开时向服务端读取当前数据。游标过期回到第一页，不丢弃当前消息接续回执、当前会话和已选任务。历史读取失败单独提示，不阻断当前对话。',
'本轮真实工具栏／右侧栏、PKCE、CSV拖入／图片粘贴、两份私人附件上传、原生页面重载后的筛选恢复和360px宽度均通过。当前为解压加载包，未声称已在Chrome商店上架。'],[
'Download/unzip the ZIP and load its directory in Chrome developer mode. The toolbar action opens the actual right browser Side Panel with ChatGPT-style conversation/input/attachments. The agent executes in the company cloud.',
'Complete company Web PKCE, select an organization/project and explicitly choose/drop files or paste images. Only authorized materials upload; the extension receives no arbitrary local-filesystem access.',
'History search/archive/page state uses the existing serialized storage queue with account/scope isolation. Reopening reads fresh server data. Expired cursors return to page one without losing pending receipts, current conversation or selected task. History failures have a separate nonblocking notice.',
'Actual toolbar/Side Panel, PKCE, CSV drop/image paste, two private uploads, filter recovery after native document reload and360px width all pass. This is an unpacked ZIP release; Chrome Web Store publication is not claimed.']),
'delivery':('0.5.5','整批交付与可追溯验证','Integrated delivery and traceable validation',[
'先完成本轮全部可自主实现代码，再统一构建、测试和联调。六端构建、Desktop主进程／渲染类型检查及555项相关测试通过；金额措辞修正后Web／Desktop343项再次通过；后端69项为选定风险回归，不等于重跑全部历史矩阵。',
'真实Web／Admin、发布包本机Codex和原生Extension右侧栏提供当前截图、GIF与MP4；保留失败脚本、超时和弱证据。修正后的安全页面GET有限恢复，不替换响应、不自动重放业务写入。',
'三个不可变客户端包和校验文本在/releases/19802/实际完整下载核对；候选就绪及活动任务检查后部署integrated-198-v2，schema163和原凭证保持，数据库／代理主进程未改动，保留198-v1回退路径。',
'七仓库按既有授权普通原子推送八引用并回读，保护用户原文件及无关分支。32组／102条原始要求保留，外部、专业和完整生产验收继续开放。'],[
'Complete all independently implementable round code before integrated builds/tests/journeys. Six builds, Desktop main/renderer types and555 relevant tests pass, followed by343 Web/Desktop checks after the wording correction. The69 backend cases are selected risk regressions, not the complete historical matrix.',
'Live Web/Admin, actual packaged native Codex and the real extension Side Panel provide current PNG/GIF/MP4 evidence. Failed drivers, timeouts and weak evidence remain. Bounded safe-page GET recovery neither replaces responses nor replays business writes.',
'Three immutable client packages and the checksum text pass full public downloads under/releases/19802/. Candidate readiness/active-work checks precede integrated-198-v2 deployment. Schema163/credentials and database/proxy processes stay unchanged;198-v1 remains a rollback path.',
'Seven repositories publish eight ordinary atomic refs with remote readback under existing authorization, preserving user files/unrelated branches. All32 groups/102 original requirements remain, with external/professional/full production acceptance open.'])}
media={'web':('198-v6-task-directory-light.png','workmate-198-v6-work-directory'),'desktop':('198-v3-desktop-directory.png','workmate-198-v3-desktop-directory'),'admin':('198-v4-service-readiness.png','workmate-198-v4-service-review'),'extension':('198-v1-side-panel.png','workmate-198-v1-side-panel')}
flow='''```mermaid
flowchart LR
  A[Sign in / 登入] --> B[Organization and project / 企業與項目]
  B --> C[All tasks / 查找工作]
  C --> D[Verify current authority / 當前授權]
  D --> E[Original session and results / 原會話與成果]
  E --> F[Return with context / 保留上下文返回]
```
'''
for name,(version,zh_title,en_title,zh,en) in entries.items():
    folder=DEV/('copypaste-'+name)
    for english in [False,True]:
        p=folder/('README.en.md' if english else 'README.md');old=p.read_text(encoding='utf8');assert '<!-- integrated-round-198 -->' not in old
        text=f'<!-- integrated-round-198 -->\n\n## 198 · {version} · '+(en_title if english else zh_title)+f'\n\n[Delivery and limits / 交付與範圍]({REPORT}) · [Downloads / 下載](https://agent.copypaste.hk/downloads)\n\n'
        paragraphs=[re.sub(r'(?<=[A-Za-z])(?=\d)',' ',line) for line in en] if english else zh
        text+='\n'.join(f'{i}. {line}' for i,line in enumerate(paragraphs,1))+'\n\n'+flow+'\n'
        if name in media:
            png,stem=media[name]
            for file in [png,stem+'.gif',stem+'.mp4']:assert (folder/'assets/screenshots'/file).is_file(),file
            text+=f'![Actual interface / 實際頁面](assets/screenshots/{png})\n\n![Actual interaction / 實際交互](assets/screenshots/{stem}.gif)\n\n[Actual recording / 實際錄影](assets/screenshots/{stem}.mp4)\n\n'
            if name=='web':text+='![Dark theme / 深色頁面](assets/screenshots/198-v6-task-directory-dark.png)\n\n'
        text+=('Earlier sections retain previous release/setup history. Current delivery does not close full original acceptance.\n\n' if english else '下方保留早期版本與完整安裝說明。本輪交付不代表全部原始需求已驗收。\n\n')
        p.write_text(text+old,encoding='utf8')
for english in [False,True]:
    p=ROOT/'docs'/('README.en.md' if english else 'README.md');old=p.read_text(encoding='utf8');assert '<!-- integrated-round-198 -->' not in old
    text='<!-- integrated-round-198 -->\n\n'+('Round198 ships a full task directory and scoped return/navigation context, with555 selected regressions, native0.7.10/Side Panel0.5.7 and complete public downloads. Full original acceptance remains open.' if english else '198輪交付完整任務目錄、範圍與返回上下文；555項相關測試、真實Desktop0.7.10／Side Panel0.5.7及公開完整下載通過。全部原始驗收仍保留。')+'\n\n[交付 / Delivery](quality/integrated-round-198/README.md) · [完整追溯 / Scope](quality/integrated-round-198/requirements-102.md) · [更新 / Changes](changes/198-task-directory-and-context.md)\n\n'
    p.write_text(text+old,encoding='utf8')
(ROOT/'docs/changes/198-task-directory-and-context.md').write_text('''# 198 · 完整任务目录与工作上下文

Web0.5.6及Desktop0.7.10提供完整任务目录、标题／状态／位置／模式筛选、当前授权签名分页和准确原会话返回；企业／项目确认之前不挂载目标工作，旧账户或迟到通知不能改变当前范围。Desktop保留本机Codex及原会话／成果面板。Extension0.5.7恢复历史搜索／归档／页码，失效历史页不阻断当前回执。Backend0.5.6新增只读目录，schema163不变；Admin0.5.2做当前部署兼容复核，Delivery0.5.5配套交付。

先完成整批代码再统一构建／测试／联调，555项相关测试通过。实际发布包本机Codex费用HK$0.032730已结算；真实右侧栏、Web／Admin、公开三包完整下载及校验通过，原失败保留。没有将选定回归和单轮旅程称为全部历史／专业／生产验收。

[交付及证据](../quality/integrated-round-198/README.md) · [需求](../requirements/198-task-directory-and-context-round.md) · [开发](../development/198-task-directory-and-context.md)

English: Adds a full authorized task directory, signed pagination, scoped work links and exact session/result return state. Native0.7.9 Codex remains local;0.5.7 retains the actual browser Side Panel and restores history without blocking pending work. Six builds and555 relevant tests pass, with real clients and complete public package checks. Original failures and full external/professional/production acceptance remain visible.
''',encoding='utf8')
print(json.dumps({'status':'updated','bilingual_repository_readmes':12,'actual_media_repositories':4}))
