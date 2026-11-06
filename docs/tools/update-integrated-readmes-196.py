"""Add detailed bilingual usage, logic and actual round196 media to each repo."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2]; DEV=ROOT/'dev'
REPORT='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-196/README.md'
entries={
 'platform':('0.5.3','Codex服务与审阅接口','Codex services and review APIs',[
 '管理员为每个模型设置其API地址、密钥、上游别名和费率；客户选择企业与项目后提交任务，云端由公司服务器运行Codex，Desktop仍在客户本机执行。',
 '任务工作区新增版本、比较、编辑读取及保存接口。仅成功云端执行任务的受权项目写入者可修改当前UTF-8文字；上限256KiB，二进制、混合换行及大文件保持只读/下载。',
 '保存同时验证任务版本、交付散列、资产版本和原文件散列；事务锁定任务与资产头，新建不可变版本并使旧审阅失效，原字节保留。人工编辑不运行模型或增加模型费用。',
 '未确定保存只能明确复用原请求键和正文；服务端先重新授权再返回原结果。比较候选限定同一资产早期版本及获准原交付，读取后复核来源权限，响应private/no-store。',
 '程序记录的view=all/terminal/browser在SQL分页前过滤。新增路由契约记录11个195/196工作区接口，最终751个常规路由另含1个条件路由；没有静默重写旧契约。'],[
 'Configure each model with its own API URL, key, upstream name and rates. Customers choose an organization/project. Company servers run cloud Codex; Desktop Codex runs on the customer computer.',
 'Workspace APIs expose eligible versions, comparison, editor reads and saving. Only authorized project writers can revise the current UTF-8 file of a successful cloud execution; the limit is256KiB. Binary, mixed-newline and larger files retain read/download behavior.',
 'Saving verifies task version, delivery digest, asset version and source digest under task/head locks. It creates an immutable version and invalidates the old review while retaining original bytes. Manual editing starts no model work or model fee.',
 'An uncertain save requires an explicit retry of the original key/body. Authorization precedes replay. Comparisons include eligible older versions and authorized originals only, rechecking source access after reads and returning private/no-store.',
 'view=all/terminal/browser filters program records before SQL pagination. An additive contract declares11 workspace routes from195/196; the inventory contains751 regular routes and1 conditional route without rewriting the historical baseline.']),
 'web':('0.5.2','云端成果与编辑','Cloud deliverables and editing',[
 '使用邮箱验证码登录并选择企业/项目。开始新工作时选择专业角色，可查看当前模板交付格式和依赖状态；“使用示例”只填简报，确认预算并提交后才启动工作。',
 '在成功任务中使用成果、文件、变更、执行、网页、活动、费用七个标签，左右键或Home/End可导航。文件标签提供受权预览/下载及符合条件的文字编辑。',
 '打开“查看及编辑文字”，保存会创建新版本并保留原文件，需重新认可新交付；人工编辑不会新建AI任务或模型费用。当前文字限256KiBUTF-8。',
 '若保存响应丢失，内容冻结并显示核对原保存的入口；明确核对会发送同一请求键和正文。不要另开重复保存；退出会清除本分页暂存文字。版本冲突时先核对最新文件。',
 '变更标签选择当前交付和有权限的早期版本，显示文字/格式差异及SHA；执行、网页标签读取真实服务器记录。超限比较提供摘要/下载；全部业务仍受租户、项目和原始来源权限控制。'],[
 'Sign in with an email code and choose an organization/project. A new task can show the selected specialist template, deliverable formats and dependency state. Use example only fills the brief; confirm the budget and submit to start work.',
 'A successful task has Results, Files, Changes, Execution, Browser, Activity and Usage tabs, with arrow/Home/End navigation. Files provide authorized previews/downloads and eligible text editing.',
 'Open View and edit text. Saving creates a new immutable version and preserves the original. Review the new delivery again. Manual editing creates no AI task or model charge; supported text is bounded256KiBUTF-8.',
 'If the save response is lost, the editor freezes that content and offers Check original save. This explicitly retries the same key/body. Signing out clears tab-local pending text; a version conflict requires reviewing the current file.',
 'Changes compares the current deliverable with eligible authorized history, including text/format differences and SHA. Execution and Browser read real server records. Oversized comparisons return a summary/download; tenant, project and source permissions still apply.']),
 'admin':('0.5.1','后台兼容与运行就绪','Admin compatibility and readiness',[
 '本轮后台业务源码和版本保持0.5.1，已对当前Backend0.5.3实际复验；使用新邮箱验证码及TOTP登录后台。',
 '在模型能力中逐个新增/编辑/删除模型，其API地址、密钥、上游别名和费率随该模型配置。运行就绪页只展示状态，不显示密钥值。',
 '企业和用户目录保留新增、删除及批量操作。最高管理员按现行策略直接执行，其他角色按策略审批；服务器仍检查权限、当前版本与审计。',
 '运行就绪可检查当前模型、Office和测试邮箱等依赖；角色验收记录真实任务/模板/交付快照，可筛选、分页及批量撤回，不能将受控QA当作客户专业合格。',
 '本轮首次本机QA启动中断于模型调用前，经服务器零请求证据及现有最高管理员预览/提交对账释放HK$2预留；失败任务、审计和成功第二次任务的真实费用均保留。'],[
 'Admin business source and version remain0.5.1, requalified against Backend0.5.3. Sign in using a fresh administrator email code and TOTP.',
 'Create/edit/delete model capabilities individually. Each model owns its API URL, key, upstream name and rates. Readiness exposes state without displaying secret values.',
 'Organization/user directories retain creation, deletion and batch actions. Highest administrators execute according to current policy; other roles follow configured approval. Server permissions, current versions and audit remain mandatory.',
 'Readiness checks models, Office, the requested test mailbox and other dependencies. Role acceptance records real task/template/delivery snapshots with filtering, pagination and batch withdrawal. Controlled QA is not professional customer acceptance.',
 'The first native QA startup stopped before model admission. Server zero-request evidence and the existing audited highest-admin preview/commit released itsHK$2 reservation. The failed task and the successful second task charge both remain recorded.']),
 'desktop':('0.7.6','本机Codex与执行成果','Local Codex and execution results',[
 '从产品下载页安装0.7.6或运行便携版，在系统浏览器完成账户授权；窗口无边框且无Electron菜单。',
 '选择本机目录和专业角色，原生确认后授予所需权限。完整本机权限由客户明确确认，可读取工作区范围之外文件，也可随时撤销。',
 '选择/拖入本机引用并提交任务，本机Codex读取、运行命令和写出结果；所有模型调用与费用走公司服务器。本轮实际发布包完成真实本机命令、结果和HK$0.057310结算。',
 '在当前任务的成果工作区查看执行记录和当前文件。记录只接受明确公司任务ID绑定；命令输出、退出码、文件/工具事件分别保留，旧无绑定记录不猜测任务归属。',
 '当前本机预览通过主进程重新校验授权、规范路径、边界、读取前后变化；最多4MiB支持图片或256KiBUTF-8文字。它是当前内容，可能不同于历史修改；预览本身不上传或执行文件。撤权后拒绝预览。'],[
 'Install0.7.6 or run its Portable build from the product download page. Authorize in the system browser. The application is frameless with no Electron menu.',
 'Choose a local folder and specialist, then grant permission in the native confirmation. Explicit customer full access can read beyond the working folder and can be revoked.',
 'Choose/drop local references and submit work. Local Codex reads files, executes commands and writes results; company servers handle all model calls and billing. The actual release build completed native commands/results andHK$0.057310 settlement.',
 'Open the current task result workspace for execution records and current files. Records require an explicit company taskID; outputs, exit codes and file/tool events are retained. Older unbound events are never assigned by guess.',
 'Main-process preview rechecks the grant, canonical path, boundary and read consistency. It supports selected images up to4MiB or UTF-8text up to256KiB. This is current local content, possibly different from historical edits. Preview does not upload/execute a file and is rejected after revocation.']),
 'extension':('0.5.5','Chrome原生右侧栏','Chrome native right Side Panel',[
 '本轮扩展源码和0.5.5ZIP字节保持不变，已对当前服务器重新完成真实侧栏和附件上传兼容验收。',
 '下载ZIP并解压，在Chrome扩展管理页启用开发者模式并加载已解压目录；当前为手动安装，未宣称已上架商店。',
 '点击工具栏图标，在浏览器原生右SidePanel中使用对话和附件；通过真实浏览器授权登录，选择企业/项目。',
 '获准文件/目录、拖入附件或粘贴图片后检查上传状态。附件实际上传到公司云端；Codex任务在云端执行，需要本机Agent执行时使用Desktop。',
 '本轮实测实际右侧停靠、PKCE及CSV/图片两份私人附件上传，并关闭自建侧栏/浏览器；受控粘贴/拖入携带真实字节，不替代全部操作系统/浏览器矩阵。'],[
 'Extension source and the0.5.5ZIP bytes are unchanged. The native Side Panel and attachment flow were requalified against the current deployed server.',
 'Download/unzip the package, enable developer mode in Chrome extension management and load the unpacked folder. Installation is manual; Chrome Store publication is not claimed.',
 'Click the toolbar action for conversation/attachments in the actual right-docked Side Panel. Complete real browser account authorization and choose an organization/project.',
 'Check upload state after choosing approved files/folders, dropping files or pasting images. Attachments upload to company cloud services, where Codex executes. Use Desktop for local agent execution.',
 'This round verifies actual right docking, PKCE and two private CSV/image uploads, then closes owned windows. Controlled paste/drop carries real bytes but does not certify the whole OS/browser matrix.']),
 'delivery':('0.5.2','整轮开发验证与发布','Integrated implementation and release',[
 '按完整轮次先盘点需求与全部代码待办，完成整批代码后再统一六仓构建、类型检查和相关测试。发现问题汇总修复后复验，原失败文件保留。',
 '本轮最终476相关测试通过，另保留63项未变更后端较早成功证据；没有把它描述为所有历史后端测试全部重跑。',
 '独立记录真实Web保存与恢复、发布包本机Codex和费用、原生SidePanel、后台兼容及公开完整下载SHA，录像使用实际响应时间。测试会话或密钥不进入公开证据。',
 '打包完成且散列/元数据校验通过后才上传；服务器先检查非root候选和活动任务，再切换并核对。保留195兼容回滚、旧下载及/root/cfg/workmate/私有配置。',
 '交付Desktop0.7.6安装/便携版与同字节Extension0.5.5ZIP，更新六端双语README、实际截图/GIF/MP4、32组及102条需求覆盖层，再普通推送对应分支。'],[
 'Inventory requirements and all code work before a complete implementation batch. Only then build six repositories, type-check and run selected tests. Aggregate repairs before revalidation and preserve failed attempts.',
 'All476 final relevant tests pass;63 unchanged earlier backend successes remain separately recorded. This does not claim rerunning every historical backend suite.',
 'Record real Web save/recovery, packaged local Codex/billing, native Side Panel, Admin compatibility and complete public download digests independently. Preserve actual response timing and exclude sessions/keys from public evidence.',
 'Finish and hash packages/metadata before upload. Validate a non-root candidate and active-task preconditions before switching. Retain compatible195 rollback, prior downloads and private/root/cfg/workmate/configuration.',
 'Deliver Desktop0.7.6Setup/Portable and byte-identical Extension0.5.5ZIP. Update bilingual READMEs, actual screenshots/GIF/MP4 and all32 groups/102 requirements before ordinary branch publication.'])
}
media={
 'web':('196-pinned-differences.png','workmate-196-v3-workspace-review.gif','workmate-196-v3-workspace-review.mp4',['196-pending-save.png','196-role-guidance.png','196-dark-workspace.png']),
 'admin':('196-service-readiness.png','workmate-196-v1-service-review.gif','workmate-196-v1-service-review.mp4',[]),
 'desktop':('196-native-execution.png','workmate-196-v2-local-workspace.gif','workmate-196-v2-local-workspace.mp4',['196-local-workspace.png']),
 'extension':('196-v1-side-panel.png','workmate-196-v1-side-panel.gif','workmate-196-v1-side-panel.mp4',[])
}
flow='''```mermaid
flowchart LR
 A[Sign in / 登入] --> B[Project, role and budget / 專案角色預算]
 B --> C{Execution / 執行}
 C -->|Web or Extension| D[Company cloud Codex / 公司雲端]
 C -->|Desktop native permission| E[Local Codex / 本機]
 D --> F[Results, files and actual usage / 成果檔案實際費用]
 E --> F
 F --> G[Review and compare / 審閱比較]
 G --> H[Explicit revision / 明確修改]
```
'''
for name,(version,zh_title,en_title,zh,en) in entries.items():
 folder=DEV/('copypaste-'+name)
 for english in [False,True]:
  p=folder/('README.en.md' if english else 'README.md');old=p.read_text(encoding='utf8');assert '<!-- integrated-round-196 -->' not in old
  header=f'<!-- integrated-round-196 -->\n\n## 196 · {version} · '+(en_title if english else zh_title)+'\n\n'
  header+=f'[完整交付與限制 / Delivery and limits]({REPORT}) · [下載 / Downloads](https://agent.copypaste.hk/downloads)\n\n'
  header+='\n'.join(str(i)+'. '+v for i,v in enumerate(en if english else zh,1))+'\n\n'+flow+'\n'
  if name=='platform':header+='`GET .../workspace/versions` · `GET .../workspace/compare` · `GET .../workspace/editor` · `POST .../workspace/edit`\n\n'
  if name=='admin':header+='`/readiness` · `/role-acceptance` · model capabilities / 模型能力 · organization and user management / 企業與用戶管理\n\n'
  if name in media:
   png,gif,mp4,extras=media[name]
   for f in [png,gif,mp4,*extras]:assert (folder/'assets/screenshots'/f).is_file(),f
   header+=f'![Actual interface / 實際頁面](assets/screenshots/{png})\n\n![Actual interaction / 實際交互](assets/screenshots/{gif})\n\n[Actual MP4 / 實際錄影](assets/screenshots/{mp4})'
   for f in extras:header+=f' · [Additional view / 其他頁面](assets/screenshots/{f})'
   header+='\n\n'
  header+=('Scope: selected current journeys pass; original failures remain. Intermittent public HTTPS timeouts, professional outcomes, external integrations and full production/compatibility acceptance remain open. Earlier sections below describe historical releases.\n\n' if english else '範圍：本輪相關旅程通過，原失敗保留。間歇公網連線超時、專業產出、外部接入及完整生產/兼容驗收仍開放。下方較早章節為歷史版本。\n\n')
  p.write_text(header+old,encoding='utf8')
for english in [False,True]:
 p=ROOT/'docs'/('README.en.md' if english else 'README.md');old=p.read_text(encoding='utf8');assert '<!-- integrated-round-196 -->' not in old
 note=('Round196 ships immutable manual text revisions, pinned comparisons, task-bound native/cloud execution and specialist guidance after a full implementation batch and integrated validation. Professional/external/production acceptance remains open.' if english else '196輪已整批完成文字新版本、固定版本比較、雲端/本機任務綁定執行視圖及角色交付指引，統一驗證後上線；完整專業、外部與生產驗收繼續保留。')
 p.write_text('<!-- integrated-round-196 -->\n\n'+note+'\n\n[交付 / Delivery](quality/integrated-round-196/README.md) · [102條追溯 / Requirements](quality/integrated-round-196/requirements-102.md) · [更新 / Changes](changes/196-task-review-and-native-context.md)\n\n'+old,encoding='utf8')
(ROOT/'docs/changes/196-task-review-and-native-context.md').write_text('''# 196 · 文字版本、审阅及本机执行上下文

先完成整批代码再统一构建、测试、汇总修复及实机联调。新增受权UTF-8文字编辑和不可变版本、固定历史比较、原请求核对，人工编辑不运行模型或增加模型费用；任务/交付/来源/文件头和权限共同校验。

任务内提供七标签，云端执行/网页在SQL分页前过滤，Desktop按公司任务ID绑定真实本机事件并独立核验当前本机文件预览。新工作显示实际角色交付、依赖和可明确选用示例，目录数量动态读取。

Backend0.5.3、Web/Delivery0.5.2、Desktop0.7.6已发布；Admin0.5.1与Extension0.5.5同源码完成当前兼容实测。Desktop安装/便携和当前扩展ZIP已挂下载页，实际完整下载SHA通过。六仓构建及最终476相关测试通过；另保留63项较早未变更后端成功用例，不重复计入最终批次。

本轮首次本机启动中断于模型调用前，现有审计对账已释放零请求测试预留；成功第二次任务真实结算HK$0.057310，失败仍保留。间歇公网连接超时和旧Web重复执行区块继续列入统一待办；不声明全部原始需求或WorkBuddy完整对标已经验收。

[实际证据与限制](../quality/integrated-round-196/README.md) · [需求](../requirements/196-workspace-completion-round.md) · [开发](../development/196-task-review-and-native-context.md)

English: Ships immutable manual text versions, authorized comparisons, exact-request save recovery, task-bound cloud/native execution views and contextual role guidance after implementation-first integrated validation. Preserve original failures and scoped professional/production acceptance. Desktop0.7.6 packages are publicly downloadable and verified; company transport reliability remains open.
''',encoding='utf8')
print(json.dumps({'status':'updated','bilingual_readmes':12,'media_repositories':4}))
