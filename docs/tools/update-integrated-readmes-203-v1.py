"""Prepend current bilingual usage/architecture and distinct actual media."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];D=R/'dev';Q=R/'docs/quality/integrated-round-203'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
samples=load(Q/'specialist-functional-samples.json');passed=samples['passed_roles'];live=load(Q/'live-production-journey.json');assert live['status']=='passed'
evidence='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-203/README.md'
items={
'platform':([
'Backend产品版本0.5.10／schema163保持，171项相关回归按202轮完全未变源码保留。Web新工作用原公司云端Codex任务／附件接口；固定来源版本在受理、执行及下载时核查权限，不因选择ID而授予权利。',
'修正云端两份原生浏览器／程序运行时目录的部署形态：精确复制既有清单字节为真实目录，保留原符号链接作回退。保持原沙箱、来源摘要和程序限制；没有API重启，也没有改网络、安全策略或Nginx。',
f'12类受控真实角色样例中{passed}类有功能交付证据；实际Codex线程、Skill／运行时／能力绑定、事务工具／原生回执和文件SHA单列。技术状态succeeded不表示客户交付通过；专业角色签收、外部服务、一次租约超时根因及长稳仍开放。',
'一次已知费用的QA超时任务通过最高管理员预览／审计核账结清HK$0.250508；不重放模型，不修改套餐并发限制，不把公司计数费用加到客户生成费。全部原始失败保留。'],[
'Backend0.5.10/schema163 stay;171 related202 cases retain identical production-source qualification. New Web intake uses existing company cloud Codex/task/attachment APIs. Pinned source versions still require current admission, execution and download authority; IDs never grant permission.',
'Materialize the two owned native browser/program runtime directories from exact existing manifest bytes, preserving old symlinks for rollback. Retain native sandbox, digest and program restrictions, without API restart, network/security-policy or Nginx changes.',
f'Of12 controlled real role samples,{passed} currently have qualified functional delivery. Actual Codex threads, immutable Skill/runtime/capability bindings, transactional/native receipts and file hashes are separate evidence. Technical succeeded is not customer acceptance; professional sign-off, external services, one lease-expiry investigation and long-running reliability remain open.',
'An owned known-cost timed-out QA task is settled through the actual highest-admin preview/audit flow for HK$0.250508, without model replay, plan-limit changes or adding company-side counting fees to customer generation charges. Retain all failed evidence.']),
'web':([
'登录→选择企业／项目→新工作→选择默认助手或专业角色→填写实际目标→明确选择文件、拖放／粘贴图片，或从素材库固定共享文件的当前版本→查看交付范围与最高预算→明确开始。上传中禁止提交，未点开始不创建模型任务。',
'草稿按使用者／企业／项目隔离；切换范围卸载旧输入。付费发送前精确保存并读回原请求与幂等键，存储失败即阻止；结果未知时锁定正文、附件和预算，刷新后明确继续原请求，避免换键重复收费。退出清理本标签页草稿。普通私人会话保持原私人附件范围。',
'Marketing insights的完整证据复核使用宽版弹窗、容器重排和完整Comparison标签；按期间及口径核对精确数据，免费导出HTML／CSV／JSON。两主题、两语种与多宽度实际页面及同字节原生导出通过；物理OS缩放和全部键盘矩阵仍开放。',
'下面203-v4页面／交互来自实际部署Web，附件和CSV明确为受控验收材料。688项相关用例中当前Web68通过；HTTP/1.1原域名TLS为本次QA连接范围，默认HTTP/2超时单独保留。'],[
'Sign in→choose workspace/project→New work→default assistant or specialist→state the actual goal→explicitly attach/drop/paste files/images or pin a current shared library version→review deliverables/maximum budget→Start. Pending upload blocks dispatch; no model task starts before confirmation.',
'Drafts belong to actor/tenant/project and remount on scope change. Persist and read back the exact body/idempotency key before paid dispatch; storage failure blocks it. Unknown outcomes lock prompt, attachments and budget; reload allows explicit continuation of the same original request, preventing a new key/charge. Sign-out clears this tab. Ordinary private conversations retain private attachment scope.',
'Marketing insights uses a wide responsive evidence dialog with complete Comparison labels. Review exact periods/scopes and export free HTML/CSV/JSON. Actual two-theme/two-language/multi-width views and identical native exports pass. Physical OS zoom and complete keyboard matrices stay open.',
'203-v4 screenshots/interaction below use actual deployed Web with explicitly controlled QA attachments/CSV. Current Web68 pass among688 related qualified cases. QA uses original-domain TLS over HTTP/1.1; default HTTP/2 timeout evidence remains separate.']),
'desktop':([
'从下载页安装Setup或启动Portable0.7.16，在浏览器完成新S256授权。Codex0.163.0-alpha.11固定在客户本机运行，完整本机权限须明确授予且可撤销；全部AI仍经公司服务。应用保持无边框、无Electron原生菜单。',
'进入当前项目的Marketing insights，宽版复核区按自身宽度重排筛选器／证据，Comparison完整显示。使用原生保存对话框下载HTML／CSV／JSON，保留当前会话与大小／SHA核查和原子写入；线上与Web六次导出同字节通过。',
'本轮只选择性同步复核组件和可选素材校验，没有覆盖原生登录、鉴权、API、加密或本机Agent实现。当前318项用例全部串行通过，原并行超时记录保留；不是新的完整本机操作、OS安装升级或机器矩阵验收。',
'下方203-v4是真实最终包／正式服务的较宽窗口及交互。原TLS HTTP/1.1只用于本次QA进程，不改服务器协议。Windows受信签名按用户要求排除；下载保持独立不可变20301路径。'],[
'Install Setup or run Portable0.7.16 from Downloads and complete fresh browser S256 authorization. Pinned Codex0.163.0-alpha.11 runs on the customer computer, with explicitly granted/revocable full local permission; all AI uses company services. Keep the frameless window and no native Electron menu.',
'Open Marketing insights in the current project. The wide review rearranges controls/evidence by container width and preserves Comparison labels. Original native save dialogs export HTML/CSV/JSON with current-session, size/SHA checks and atomic writes; all six Web/native exports are byte-identical.',
'Selectively update review components and optional source validation only. Preserve native login/auth/API/crypto/local-Agent implementation. All current318 cases pass serially; the original parallel timeout remains failed. This is not a full new local-operation, OS installation/upgrade or machine matrix.',
'203-v4 below records the actual final package/deployed service at a wider window. Original TLS HTTP/1.1 is selected only in QA processes, without server protocol changes. Trusted Windows signing is excluded by user instruction. Downloads use immutable20301 paths.']),
'admin':([
'Admin产品版本0.5.2和22项原样源码相关回归保持；下方198截图／录影是历史真实页面，不是本轮重新全后台验收。',
'模型逐项维护OpenAI兼容接口地址、API key、上游别名和费率；企业／用户新建、删除、批量、额度／VIP和内容权限保持。最高管理员可按现行策略直接执行，其他角色按策略审批，保留完整审计。',
'本轮真实使用既有费用核账预览／执行接口，按原始已知调用结清受控超时任务HK$0.250508，释放其余预留；未修改套餐并发、网络或未知用量。原操作和失败证据均保留。'],[
'Admin stays0.5.2 with22 identical-source related cases retained. The198 actual screenshots/recordings below are historical, not a fresh full-dashboard acceptance.',
'Maintain each model’s OpenAI-compatible upstream URL, API key, upstream alias and rates. Organization/user create/delete/bulk, credit/VIP and content authority remain. Highest admin follows current direct-execution policy; other roles follow approval policy with complete audit.',
'Actually use the existing settlement preview/operation APIs to settle the owned known-cost timed-out sample for HK$0.250508 and release the remaining hold. Do not alter plan concurrency, networking or unknown usage. Preserve original operation and failed evidence.']),
'extension':([
'Extension保持0.5.7及原发布ZIP全部字节；93项相关回归按原样源码保留。下载页可获取解压载入包，未声称Chrome商店发布。',
'点击工具栏按钮打开Chrome原生右侧SidePanel，采用ChatGPT式对话／附件结构；只读取并上传客户明确选择的文件，Codex在公司云端运行，全部AI经内部API。',
'下方198原生SidePanel／授权／附件媒体为历史真实证据。本轮Web专业新工作和Web／Desktop复核改进不替代全部Chrome、目录撤权、Native Host、大文件和浏览器版本矩阵。'],[
'Extension remains0.5.7 with exact original released ZIP bytes;93 related cases retain identical-source qualification. Downloads provide unpacked installation, without a Chrome Web Store claim.',
'The toolbar opens Chrome’s native right SidePanel with ChatGPT-style chat/attachments. Read/upload only explicitly chosen customer files. Codex runs in the company cloud and all AI uses internal APIs.',
'198 native SidePanel/auth/attachment media below remain historical actual evidence. New Web specialist intake and Web/Desktop review do not replace full Chrome, directory revocation, Native Host, large-file or browser-version qualification.']),
'delivery':([
'清单中的829份产品源码（含.cts，按列明扩展名取样）及计划用例／交付脚本先完成，再统一构建／测试；不把清单解释为所有文件扩展名均已覆盖。688项相关通过证据按当前运行与原样源码沿用区分，原始失败和整批修正单独保留。',
'实际隔离上传／草稿范围／存储失败／响应丢失恢复，与实际正式Web／最终Desktop新S256授权、宽复核及同字节原生导出分开。真实角色功能样例／费用／不通过项均列在本轮回执，不能冒充专业客户签收。',
'只物化自身两个原生运行时目录、切换自身Web静态入口及发布20301下载；无API重启，无Nginx改写／重载。全部9份网络文件与实时规则、原凭证及DB／代理进程保持。',
'四份发布文件完整内网200和公网原TLS HTTP/1.1全部206字节重组核对SHA。保留H2超时、一次任务租约根因和全部102条／32组开放范围。12份双语README、实际PNG／GIF／MP4、更新说明和普通8引用发布同步。'],[
'Complete the829 listed production-source files, including .cts within the stated selected extensions, and planned cases/operations before unified builds/tests. The manifest does not cover every filesystem extension.688 related passing cases distinguish current runs from identical-source retention; original failures and collected corrections stay separate.',
'Separate isolated real upload/scope/storage/lost-response injection from deployed Web/final Desktop fresh S256 authorization, wide review and identical native exports. Actual role samples, fees and failed outcomes are explicit, not professional customer acceptance.',
'Materialize only two owned native runtime directories, switch the owned Web static entry and publish20301 downloads. No API restart or Nginx write/reload. Preserve all nine network files/live rules, credentials and DB/proxy processes.',
'Verify all four complete inner200 files and every original-TLS HTTP/1.1 public206 byte against whole-file SHA. Retain H2 stalls, one lease investigation and all original102 requirements/32 groups. Synchronize12 bilingual READMEs, actual PNG/GIF/MP4, changes and ordinary eight-ref publication.'])}
flows={
'platform':'A[Explicit pinned sources and budget] --> B[Current server authority]\n B --> C[Frozen Codex Skills and capabilities]\n C --> D[Actual native business tools]\n D --> E[Immutable files and actual fees]\n E --> F[Customer review]',
'web':'A[Sign in and project] --> B[Default assistant or specialist]\n B --> C[Explicit upload and pinned version]\n C --> D[Scope-bound draft and budget]\n D --> E[Persist exact body and key]\n E --> F[Create once or explicitly resume original]\n F --> G[Actual delivery and customer review]',
'desktop':'A[Download and browser S256] --> B[Frameless local Codex]\n B --> C[Explicit revocable local permission]\n B --> D[Current project evidence]\n D --> E[Wide responsive review]\n E --> F[Original native save and exact hash]',
'admin':'A[Admin identity and role] --> B[Per-model upstream and key]\n A --> C[Users organizations credit VIP content bulk]\n C --> D[Direct or policy approval]\n D --> E[Exact original receipts and audit]',
'extension':'A[Toolbar] --> B[Native right SidePanel]\n B --> C[Explicit file choice]\n C --> D[Authorized read and upload]\n D --> E[Company cloud Codex]',
'delivery':'A[Complete whole code batch] --> B[Unified build and tests]\n B --> C[Retain failures and collected correction]\n C --> B\n B --> D[Actual clients and exact packages]\n D --> E[Application-only deployment]\n E --> F[Unchanged server network and full bytes]\n F --> G[Bilingual guides and ordinary eight-ref push]'}
media={'web':['203-v4-specialist-intake-live.png','workmate-203-v4-specialist-intake-live.gif','workmate-203-v4-specialist-intake-live.mp4','203-v4-marketing-review-live.png','workmate-203-v4-marketing-review-live.gif','workmate-203-v4-marketing-review-live.mp4'],'desktop':['203-v4-marketing-review-live.png','workmate-203-v4-marketing-review-live.gif','workmate-203-v4-marketing-review-live.mp4'],'admin':['198-v4-service-readiness.png','workmate-198-v4-service-review.gif','workmate-198-v4-service-review.mp4'],'extension':['198-v1-side-panel.png','workmate-198-v1-side-panel.gif','workmate-198-v1-side-panel.mp4']}
for component,(zh,en) in items.items():
 folder=D/('copypaste-'+component);version=load(folder/'package.json')['version']
 for english in [False,True]:
  p=folder/('README.en.md' if english else 'README.md');old=p.read_text('utf-8');assert not old.startswith('<!-- integrated-round-203 -->')
  text='<!-- integrated-round-203 -->\n\n## 203 · '+version+' · '+('Pinned specialist intake and reliable delivery' if english else '专业输入与可靠交付')+'\n\n[Evidence and limits / 证据与边界]('+evidence+') · [Downloads / 下载](https://agent.copypaste.hk/downloads)\n\n'
  text+='\n\n'.join(str(i+1)+'. '+v for i,v in enumerate(en if english else zh))+'\n\n```mermaid\nflowchart LR\n '+flows[component]+'\n```\n\n'
  text+=('Open delivery: marketing-analyst returned no chart files; technical succeeded does not qualify it. The exact generic tool failure remains unverified. Default public HTTP/2 stalls and one worker-lease investigation also stay open. See the evidence report; no full-product acceptance is claimed.\n\n' if english else '当前开放项：marketing-analyst未交付图表文件，技术状态succeeded不计为通过；通用工具错误的准确原因尚未验证。公网默认HTTP/2停滞及一次任务租约根因也保持开放。详细见证据报告，不声称完整产品验收通过。\n\n')
  for file in media.get(component,[]):
   assert (folder/'assets/screenshots'/file).is_file();rel='assets/screenshots/'+file
   text+=('[Actual recording / 实际录影]('+rel+')' if file.endswith('.mp4') else '![Actual interface or interaction / 实际页面或交互]('+rel+')')+'\n\n'
  text+=('The complete architecture, setup and usage guide follows.\n\n' if english else '以下保留完整架构、安装与使用细则。\n\n')+old;p.write_text(text,'utf-8')
for english in [False,True]:
 p=R/'docs'/('README.en.md' if english else 'README.md');old=p.read_text('utf-8');assert not old.startswith('<!-- integrated-round-203 -->');text='<!-- integrated-round-203 -->\n\n'+('203: Pinned specialist attachments, scope-bound drafts and durable paid-request recovery, wide actual native review, source-qualified688 related cases and preserved server networking. All original acceptance and failed outcomes remain explicit.' if english else '203轮：专业附件与范围草稿、持久化付费请求恢复、宽版实际原生复核、688项相关用例及服务器网络保持；全部原始验收和失败边界继续保留。')+'\n\n[交付 / Delivery](quality/integrated-round-203/README.md) · [102条 / Scope](quality/integrated-round-203/requirements-102.md) · [实现 / Implementation](development/203-specialist-intake-and-runtime.md)\n\n'+old;p.write_text(text,'utf-8')
print(json.dumps({'status':'updated','component_readmes':12,'docs_indexes':2,'passed_controlled_roles':passed}))
