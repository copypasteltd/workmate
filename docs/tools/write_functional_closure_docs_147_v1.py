"""Document only selected, passing source-bound functional delivery evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, re, sys
from functional_closure_147_binding_v1 import qualify_backend

ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery';RAW=DELIVERY/'evidence/functional-closure-147'
read=lambda p:json.loads(p.read_bytes())
encoded=lambda v:(json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode()
backend,ui=sys.argv[1:];b,u=read(RAW/f'backend-{backend}.json'),read(RAW/f'ui-{ui}.json')
assert b['status']==u['status']=='passed' and b['source_unchanged'] and u['source_unchanged']
j=read(DELIVERY/u['journey']['path']);assert j['status']=='passed' and len(j['checks'])==5 and len(j['screenshots'])>=11 and len(j['recordings'])==5
binding=qualify_backend('backend-'+backend)
cases=binding['verified_case_coverage'];shots=len(j['screenshots']);copies=[]
for item in [*j['screenshots'],*[f for r in j['recordings']for f in r['files']]]:
    source=DEV/item['path'];body=source.read_bytes();assert sha256(body).hexdigest()==item['sha256']
    targets=[ROOT/'docs/assets/functional-closure-147'/source.relative_to(DEV).parts[0]/source.name]
    if item in [j['screenshots'][0],*j['recordings'][0]['files']]:
        targets.extend(DEV/f'copypaste-{name}/assets/screenshots'/source.name for name in ['platform','admin','delivery'])
    for target in targets:
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():assert target.read_bytes()==body
        else:
            with target.open('xb')as stream:stream.write(body)
        copies.append({'source':source.relative_to(ROOT).as_posix(),'path':target.relative_to(ROOT).as_posix(),'sha256':item['sha256'],'caption':'Actual customer interaction. Platform/admin/delivery reuse the clearly labelled Web release illustration.'})
with (ROOT/'docs/quality/functional-closure-media-copies-147.json').open('xb')as stream:stream.write(encoded(copies))

guide=f'''# 147：主链功能收口与使用流程 / Functional completion and customer journey

本轮交付两项可实际使用的业务能力：有命名输入／交付的可复用工作流，以及云端原任务请求本机文件、Desktop 实际执行、客户主动上传后回到原线程继续。技术契约和接口见 [详细方案](../technical/147-workflow-contract-and-local-handoff.md)，需求见 [补充需求](../requirements/12-workflow-contract-and-local-handoff.md)。

## 客户操作 / Customer actions

1. 现有邮箱验证码进入 Web；Desktop 和 Extension 使用浏览器授权及 PKCE，选择同一企业、项目。Extension 由工具栏打开真实 Chrome 原生右侧栏。
2. 云端 Codex 在原任务请求文件时，点击“交给 Desktop 准备文件”，核对具体要求、角色与本机独立预算。此时持久保存请求，不预先授予 OS 权限，也不自动开始执行。
3. Desktop 的本机工作区显示待处理请求。客户选择真实本机目录、受限或完整 OS 权限，再明确确认费用。受信任主进程运行客户本机 Codex；云端队列不执行这个本机步骤。
4. 本机完成后，客户逐个选择要上传的文件。上传固定绑定原任务及私有范围，私人无会话任务也不降为共享。续传、确认及完成均复核原任务／依赖。勾选确切文件版本后确认交回；不会自动上传整个目录。
5. 服务端原子补齐文件检查点，沿用原任务、会话、预算和真实 Codex 线程继续；其余必需输入未齐时继续等待。费用分原云端工作与本机工作各自结算，响应丢失不新建另一份执行。
6. 与此同时，流程顾问可用 `workflow_save` 定义 `input_schema` 与 `output_schema`，发布不可变版本，并用 `workflow_run.inputs` 提供文本、数字、布尔和精确文件版本。页面显示小数、0、false、文件名及版本。客户核对本次值和子步骤费用后才启动。
7. 专业步骤可以读取已获准的具名文件，包括本人其他会话的私人文件；只授予该运行批准的精确版本。设计编辑沿用被选图片版本，其他新版本不会静默取代它。完整文本交付来自核对字节／摘要的保存文件，避免把截短预览当成全部内容。
8. 定时和事件提案继承同一组不可变输入。Web／Desktop／Extension 在确认前显示实际值及精确文件版本，再分别授权每次／每日预算。输入不完整或来源撤回时不能启用／继续。
9. 客户正式删除原任务或单独删除上传文件时，对应上传回执清名并退役；私人文件内容和派生访问同步撤回，已产生的费用与不可变执行身份保留。只有真实对应的任务／固定上传版本和删除日志能够授权终态清理。
10. 心跳、工具授权和推理只共享读取原任务与本机请求，按固定顺序锁定本机执行，避免有效任务被后台心跳误中断；真实接单、交回、取消、删除及撤权继续按写入和当前来源检查处理。

```mermaid
sequenceDiagram
  participant C as Customer
  participant W as Original cloud Codex
  participant D as Local Desktop Codex
  participant F as Fixed private files
  W->>C: Request missing local material
  C->>D: Review role and budget, choose folder and OS permission
  D->>D: Execute locally with a durable task identity
  D->>C: Present actual local result
  C->>F: Explicitly select and upload files for the original task
  C->>W: Confirm exact returned versions
  W->>F: Read currently authorized original bytes
  W->>C: Continue the same task and thread, deliver and settle
```

## 验证 / Validation

最终选择 `backend-{backend}`、`ui-{ui}`：{cases}项后端覆盖（同一产品源码的92项既有功能检查及3项并发复测）、83项Desktop受信任进程检查、12项Extension上传检查、5组实际客户流程、{shots}张实际截图和5组时序GIF／MP4。还核对了6种窗口／面板宽度、无横向溢出、Desktop 隐藏菜单及滚动轨道。完整运行依据见 [来源检查点](../quality/functional-closure-checkpoint-147.json)。

backend10保留95次运行、93通过／2失败的原始记录。两处新增并发测试的持锁连接遗漏租户／用户上下文，v2仅补齐与实际事务一致的上下文，全部原断言保留。backend11单独复测这3项；产品代码、原测试及fixture字节均未更改，不重复运行已通过的92项或UI08。95表示组合覆盖，不宣称在新一次运行中全部95项通过。

实际使用原生 PostgreSQL、验证码／PKCE、打包 Windows Desktop、客户本机 Codex 写出 CSV、显式分块上传、原云端付费线程暂停／继续和真实 Side Panel。内部 Responses 服务按用户授权返回明确的假数据；实际 Codex 往返使用明确配置的固定 QA 二进制0.163.0-alpha.11。命名工作流界面另用有标识的脚本模型，不能冒充独立真实模型专业质量证明。既有生产锁定值不因这次 QA 自动升级。

Desktop 包尚未签名；此轮不代表全平台所有专业输出、所有 OS、生产广告／付款／真实AI服务均已验收。102项原编号和全部原始范围继续保留，未将功能定向核查等同于完整产品验收。全部失败、原始校验器、日志和源快照保留。所有本次自建浏览器／客户端／服务和数据库进程已按报告关闭；没有调用本地虚拟化。

## English

The original cloud task can now request local material, persist an owner-scoped Desktop handoff, wait for explicit folder/OS and fee approval, and resume the same paid Codex thread after the customer uploads and confirms exact file versions. Desktop executes the actual local Codex. Selected uploads remain bound to the original private task even without a chat; no whole-folder automatic upload occurs. Durable identities and admission/finish journals prevent repeated work after uncertain responses. Starter concurrency allows only the strictly verified waiting parent and its local preparation step to share a slot; every actual task retains its own fees and budget checks.

Reusable workflows declare bounded named text, number, boolean and file inputs plus named text/file outputs. Each run freezes actual values and original file versions, requires review of the input digest and step fees, and returns complete saved text. Specialist tools use the selected version and current authority, including explicitly chosen private files from the same owner's other conversation. Scheduled/event executions preserve the same values; the actual native Side Panel displays decimal, zero, false and file version before recurring authorization. Withdrawn input and output sources stop reads and execution.

Formal deletion of the original task or an individual uploaded asset retires its exact task-bound upload receipts and private content while preserving incurred fees and immutable execution identities. Only the authoritative source-task journal or actual fixed upload version and deleted-asset journal permits the completed upload to retire.

Selected evidence covers {cases} backend cases across separate executions: 92 existing checks on identical product bytes and three targeted concurrency checks after correcting missing transaction caller context. Backend10's original 93-pass/two-failure report is retained; v2 preserves every assertion and only supplies the missing context. This is not a new full 95-case rerun. Product, original test and fixture bytes are unchanged, so the successful UI08/package qualification remains applicable. Evidence also covers 83 trusted Desktop process cases, 12 Extension upload cases, five actual client journeys, {shots} screenshots, five real-time GIF/MP4 pairs and six layout checks. Real cloud/local Codex processes, native SQL, the unsigned Windows package, OTP/PKCE, file bytes and the native right SIDE_PANEL are exercised against an explicitly synthetic internal Responses service. The real roundtrip explicitly configures pinned QA Codex0.163.0-alpha.11; it does not silently update production locks. Named workflow interface evidence uses a separately labelled scripted model. Production services, signed releases and all original complete professional/OS acceptance scopes remain separately open.
'''
with (ROOT/'docs/development/147-functional-closure.md').open('x',encoding='utf-8',newline='\n')as stream:stream.write(guide)

ledger=read(ROOT/'docs/quality/remaining-work-stage146.json');assert len(ledger['requirements'])==102
ledger.update(schema_version=26,current_stage=147,reviewed_at=datetime.now(timezone.utc).isoformat())
updates={'REQ-032':'阶段147增加不可变具名输入／输出契约、完整文本、明确旧版文件、专业工具范围、原生费用前输入核对及重复运行继承。',
         'REQ-041':'阶段147增加云端原付费Codex等待文件、本机Desktop实际Codex准备、客户显式私有上传和原线程继续；独立预算、唯一接单、恢复和撤权约束。'}
for item in ledger['requirements']:
    if item['id']in updates:
        item['implemented_scope']+='；'+updates[item['id']]
        item['current_audit_remaining']='保留原remaining及完整验收范围；当前定向功能已落地，完整专业／生产／OS及跨端验收继续以原范围核对。'
        item['current_review_note']=f'阶段147：{cases}项后端、5组实际三端流程、{shots}张截图及5组GIF／MP4；本轮不新增整项关闭。'
ledger['stage147_scope_note']={'new_full_acceptance_closures':0,'backend_cases':cases,'actual_client_journeys':5,'selected_backend':'backend-'+backend,'selected_ui':'ui-'+ui,'model_mode':'explicit_synthetic_internal_responses_and_separately_scripted_workflow_ui','scope':'Named workflow contracts and actual paid cloud/local/original-thread continuation; original scopes retained'}
with (ROOT/'docs/quality/remaining-work-stage147.json').open('xb')as stream:stream.write(encoded(ledger))
md='# 阶段147完整编号清单 / Stage147 numbered ledger\n\n102个原编号和完整验收范围保留：88项必需完整范围开放，12项建议待确认、1项可选，REQ095保留既有验收。这是完整验收范围数量，不能当成尚未实现模块数量。\n\n| 编号 | 模块 | 已实现 | 当前待完成范围 | 完整验收 |\n|---|---|---|---|---|\n'
for item in ledger['requirements']:
    cell=lambda v:str(v).replace('|','／').replace('\n',' ')
    md+='| '+' | '.join(cell(x)for x in [item['id'],item['module'],item['implemented_scope'],item.get('current_audit_remaining',item['remaining']),item['full_acceptance']])+' |\n'
with (ROOT/'docs/quality/remaining-work-stage147.md').open('x',encoding='utf-8',newline='\n')as stream:stream.write(md)

specific={
 'platform':('持久本机请求、任务范围私有续传、精确版本读取、运行输入摘要、定时／事件继承和独立费用结算。','Durable local requests, task-scoped private resumable uploads, exact-version readers, run input digests, recurring preservation and separate task settlement.'),
 'web':('在原任务请求本机准备、选择与交回固定私人文件；在流程页面核对实际输入并查看完整命名交付。','Request local preparation from the original task, explicitly upload/return private versions, review actual workflow inputs and read complete named deliverables.'),
 'desktop':('无边框本机工作区选择真实目录、授予完整本机权限并运行实际Codex；明确确认独立费用，完成后等待客户交回。','The frameless local workspace selects a real folder, obtains explicit full OS permission and executes actual local Codex after fee confirmation, then waits for the customer to return files.'),
 'extension':('保持ChatGPT式对话及真实右侧栏；显式上传与原任务交回，并在定时／事件启用前核对具名值及固定版本。','Keep chat/attachment structure in the actual native right Side Panel, explicitly upload/return files, and review named values and versions before scheduled/event authorization.'),
 'admin':('本轮复用既有用户、用量、费用、VIP、权限与内容管理。新的本机工作与原云任务分别产生真实受管费用；本轮无新增Admin页面。','Existing user, usage, billing, VIP, permission and content administration governs each actual cloud/local task separately. No new Admin page is added by this release.'),
 'delivery':('提供原生SQL、真实云端及本机Codex、实际打包客户端和原生右侧栏的源码绑定交付证据。','Source-bound native SQL, real cloud/local Codex, actual packaged clients and the genuine Chrome Side Panel qualification.'),
}
for component,(zh,en)in specific.items():
    client=component if component in ['web','desktop','extension']else'web';repo=DEV/('copypaste-'+component)
    image=next(i for i in j['screenshots']if i['path'].startswith('copypaste-'+client+'/'))
    video=next(i for i in j['recordings']if i['files'][0]['path'].startswith('copypaste-'+client+'/'))
    png=Path(image['path']).name;gif=next(Path(f['path']).name for f in video['files']if f['path'].endswith('.gif'));mp4=next(Path(f['path']).name for f in video['files']if f['path'].endswith('.mp4'))
    for language,name in [('zh','README.md'),('en','README.en.md')]:
        target=repo/name;old=target.read_text(encoding='utf-8');marker='<!-- functional-closure-stage147 -->';assert marker not in old
        intro=(f'## 阶段147：具名流程与原任务本机准备闭环\n\n{zh}\n\n使用顺序：登录并选择项目 → 原云任务请求本机文件 → Desktop选择目录／OS权限 → 核对本机独立费用 → 实际本机Codex执行 → 客户逐个上传并确认固定版本 → 原云任务沿原线程继续。工作流按不可变输入运行，查看完整命名交付；重复运行需分别确认规则及预算。\n\n{cases}项后端、5组实际三端流程、{shots}张截图、5组GIF／MP4通过。内部模型继续使用获准假数据，Windows包未签名；完整专业／生产／OS验收保留。\n\n'if language=='zh'else f'## Stage147: named workflows and local preparation for the original task\n\n{en}\n\nSign in and select the project → original cloud task requests local files → Desktop folder/OS grant → separate local fee review → actual local Codex → explicit upload and confirmation of exact versions → the original cloud task resumes its same thread. Workflow execution freezes actual inputs and exposes complete named deliverables; recurring rules and budgets require separate review.\n\n{cases} backend cases, five actual client journeys, {shots} screenshots and five real-time GIF/MP4 pairs passed. Internal model replies remain explicitly synthetic and the Windows package is unsigned. Complete professional, production and OS acceptance remains open.\n\n')
        intro+=('后端覆盖由相同产品源码的92项既有检查与3项并发复测组成；原测试上下文错误及失败记录保留，不宣称新一次95项完整重跑。\n\n'if language=='zh'else'Backend coverage combines 92 existing checks on identical product bytes with three targeted concurrency reruns. Original test-context failures remain retained; this is not a new full 95-case rerun.\n\n')
        intro+='```mermaid\nflowchart LR\n  A[Original cloud task] --> B[Request local material]\n  B --> C[Folder and OS grant]\n  C --> D[Review separate fees]\n  D --> E[Actual local Codex]\n  E --> F[Customer uploads exact files]\n  F --> G[Same original cloud thread]\n  G --> H[Complete delivery and settlement]\n```\n\n'
        intro+='[Usage / 使用流程](https://github.com/copypasteltd/workmate/blob/docs/docs/development/147-functional-closure.md) · [Detailed contracts / 详细契约](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/147-workflow-contract-and-local-handoff.md) · [Numbered ledger / 全部编号](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage147.md)\n\n'
        if component not in ['web','desktop','extension']:intro+=('以下为真实Web发布配图与录像，不作为Admin或其他端独立页面验收。\n\n'if language=='zh'else'The following actual Web release illustration/recording does not claim an Admin or other client-specific page acceptance.\n\n')
        intro+=f'![Actual customer flow](assets/screenshots/{png})\n\n![Recorded interaction](assets/screenshots/{gif})\n\n[Actual MP4](assets/screenshots/{mp4})\n'
        target.write_text(old+'\n\n'+marker+'\n'+intro,encoding='utf-8',newline='\n')

change=f'''# 147 更新 / Changes

| 编号 | 本轮功能 | 核查 |
|---|---|---|
| 147-01 | 命名输入／输出、固定文件版本、完整文本交付 | 必填／类型／false／0／小数／旧版／摘要 |
| 147-02 | 云任务→本机实际Codex→原付费线程继续 | 独立预算、唯一任务、实际CSV及显式交回 |
| 147-03 | 私人任务范围续传及有效请求收件箱 | 无会话私人源、失效条目隔离及Starter并行槽 |
| 147-04 | 专业文件工具与Image2遵守批准版本 | 其他会话私人文件、精确旧版及撤回 |
| 147-05 | 三端确认与重复运行继承 | {cases}项后端、5组实际流程、{shots}张截图、5组GIF／MP4 |
| 147-06 | 双语文档、独立仓库及普通同步发布 | 原始失败／源快照保留，无强推 |
| 147-07 | 原任务及固定上传文件的正式删除 | 精确删除日志、多版本／临时文件清理、共享边界及账务保留 |
| 147-08 | 本机心跳、来源检查与连续推理并发 | 共享授权读锁、固定锁顺序、真实撤回仍拒绝 |

Pending: original complete professional, production and OS acceptance scopes, signed releases and real external services. No whole-requirement acceptance is inferred from this increment.

[使用与证据](../development/147-functional-closure.md) · [完整编号](../quality/remaining-work-stage147.md) · [当前来源检查点](../quality/functional-closure-checkpoint-147.json)
'''
with (ROOT/'docs/changes/147-functional-closure.md').open('x',encoding='utf-8',newline='\n')as stream:stream.write(change)
for filename,text in [
 ('docs/README.md','\n\n阶段147：[主链功能与使用](development/147-functional-closure.md) · [完整编号](quality/remaining-work-stage147.md) · [详细契约](technical/147-workflow-contract-and-local-handoff.md)。\n'),
 ('docs/README.en.md','\n\nStage147: [functional customer journeys](development/147-functional-closure.md) · [all numbered scopes](quality/remaining-work-stage147.md) · [detailed contracts](technical/147-workflow-contract-and-local-handoff.md).\n'),
 ('docs/requirements/01-srs.md','\n\n具名流程与原任务本机准备补充见 [FC147需求](12-workflow-contract-and-local-handoff.md)，保留全部原始范围。\n'),
 ('docs/governance/04-git-branches-and-publication.md','\n\n<!-- functional-closure-stage147 -->\n阶段147保留406365条历史证明身份和全部原始失败；当前功能使用独立来源检查点与增量发布核查，普通原子更新八个远端引用并读取SHA确认。没有重放旧运行或声称全平台回归。\nStage147 retains406365 historical proof identities and all original failures, binds the current functional increment, then ordinarily updates eight remote refs atomically with SHA readback.\n')]:
    file=ROOT/filename;file.write_text(file.read_text(encoding='utf-8')+text,encoding='utf-8',newline='\n')
print(json.dumps({'status':'written','backend_cases':cases,'client_journeys':len(j['checks']),'screenshots':shots,'media_copies':len(copies),'original_requirement_ids':102,'new_whole_closures':0}))
