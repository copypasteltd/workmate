"""Write the current workflow delivery, retaining every original acceptance scope."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,re
ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev';raw=DEV/'copypaste-delivery/evidence/workflow-handoff-145'
read=lambda p:json.loads(p.read_bytes())
dump=lambda v:(json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode()
b,u=read(raw/'backend-04.json'),read(raw/'ui-03.json')
assert b['status']==u['status']=='passed' and b['source_unchanged'] and u['source_unchanged']
j=read(DEV/'copypaste-delivery'/u['journey']['path'])
assert j['status']=='passed' and len(j['checks'])==7 and len(j['screenshots'])==7 and len(j['recordings'])==2
counts=[int(n) for n in re.findall(r'^# tests (\d+)\r?$',(DEV/'copypaste-delivery'/b['raw_report']['path']).read_text(encoding='utf-8'),re.M)]
assert counts==[12,39]
copies=[]
selected=[j['screenshots'][1],*j['recordings'][0]['files']]
for item in selected:
    source=DEV/item['path'];body=source.read_bytes();assert sha256(body).hexdigest()==item['sha256']
    targets=[DEV/f'copypaste-{n}/assets/screenshots'/source.name for n in ['platform','admin','desktop','extension','delivery']]
    targets.append(ROOT/'docs/assets/workflow-handoff-145'/source.name)
    for target in targets:
        target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb') as f:f.write(body)
        copies.append({'source':source.relative_to(ROOT).as_posix(),'path':target.relative_to(ROOT).as_posix(),'sha256':item['sha256'],
          'caption':'Actual Web customer workflow; shared release illustration, not a client-specific screenshot'})
with (ROOT/'docs/quality/workflow-handoff-media-copies-145.json').open('xb') as f:f.write(dump(copies))

guide='''# 阶段145：工作流成果交接与失败确认 / Workflow handoffs and failure review

客户现在可以把上一角色的完整成果交给下一角色：在冻结的流程版本内选择前序步骤，保留完整文本文件及真实交付版本，查看每一步费用并下载原文件。已知且完成费用结算的失败可以按预设等待客户确认，再略过该步继续独立工作。不会自动重试；整条流程仍保留失败结论。

## 客户操作

1. 选择企业流程顾问，说明希望串联的业务、每步成果和预算。顾问保存、发布并发起固定版本；模型不能替客户确认。
2. 在 Web 的工作流程页面核对使用哪些前序成果、每步失败策略及独立子任务总预算。Extension 保持右侧聊天／文件上传，通过既有入口进入此云端确认页面。Desktop 使用可信本机确认卡，所有 Codex 子任务仍在同一获准本机目录执行。
3. 确认后才建立子任务和费用预留。后续角色可分页读取完整保存文本，并取得原文件版本、类型及摘要。页面的6000字符收据摘要不再充当完整交接内容。
4. 完成后在步骤交付中下载原版本文件。普通文本／Markdown／CSV／JSON可由专用只读工具读取；媒体文件使用既有专业读取工具，不能声称未读取的媒体已被理解。
5. 失败默认停止；预设为人工确认时，只对已知、已结算且没有未完成外部操作的失败提供略过确认。需要失败步骤成果的后续步骤会停止。取消、撤权、来源不可用、未知用量／外部结果均不能通过此入口继续。

```mermaid
flowchart LR
  A[顾问准备冻结版本] --> B[客户核对输入及预算]
  B --> C[云端或本机角色执行]
  C --> D[完整文本及原文件版本]
  D --> E[后续角色读取获准成果]
  C --> F[已知失败]
  F --> G[停止或等待客户确认]
  G --> H[仅继续独立步骤]
  H --> I[保留整体失败结论]
```

## 代码与权限

- SQL140 扩展现有来源追踪与发布来源检查，保留 SQL001–139。完整输出保存为私有不可变文件；依赖固定 `asset_version_id`、SHA-256和版本号，不静默替换成最新文件。
- `input_steps` 使用从0开始的唯一前序产出步骤编号；省略表示全部先前产出，空数组表示独立工作。最多8步；不能选择自己、后序步骤或审批步骤。
- `on_failure` 为 `stop` 或 `review`。人工略过仍受版本摘要、revision、cursor、总预算和当前角色／来源约束；重复确认不能产生重复任务或收费。
- 提供 `workflow_inputs` 只读工具，按固定版本验证实际字节并分页返回文本。每页最多16000 UTF-16字符，完整文本读取上限2MB；更大文件和媒体交给相应读取／下载流程。每步最多200个既有文件版本及一个完整结果文件，超出明确停止。
- 失败检查使用仅返回布尔结果的受限数据库函数，不向应用开放音频服务的私有计量表；本机流程接口补齐可信 actor 上下文。
- 本机结果明确标为 `desktop_client_report`。本机文件仍留在客户设备，交接清单仅含已经获准上传的文件及原本已报告的文本；此次控制层检查不构成本机全部OS操作能力的验收。
- 旧运行若只有截短收据、没有完整保存文件，则以 `WORKFLOW_LEGACY_OUTPUT_INCOMPLETE` 停止并要求另行审阅，不伪造历史成果或自动重跑已付费步骤。
- 关闭窄屏导航时立即隐藏并禁止命中，避免动画残留遮挡正文；打开导航需客户主动操作。保留既有品牌色、字体、Desktop无边框及Extension原生Side Panel。

## 验证与范围

后端39项、可信本机流程控制12项均通过；实际Web客户流程7项通过，7张真实截图、2组实际时序GIF／MP4，以及1440／960／390宽度检查。长文本83,299字节的完整客户下载、中文／表情分页、旧版本读取、撤权前阻断模型、私有越权、确认竞争、失败跳过及整体失败保留均有定向检查。

当前选择后端 `backend-04` 与浏览器 `ui-03`。后者仅增加窄屏可见性修复及检查；两者实际后端与Desktop源码逐字一致。保留所有原失败尝试：核查入口旧文件名、本机新增测试参数顺序、成果来源标识、私有音频表读取权限、来源撤回后的隐藏行为，以及最初的浏览器按钮选择。

全部模型响应按已获授权的假数据处理。未接入正式公司AI密钥、真实广告／发布账户或生产付款；新增本机用例验证控制API和可信顺序器，并没有运行实际本机Codex／OS端到端流程。本轮没有关闭任何原始需求的完整验收。原102编号、88项必需完整范围开放、12项待确认建议、1项可选、REQ095既有验收保持原范围。

## English

Frozen private workflows select exact predecessor outputs and retain full private text files alongside original deliverable versions. Cloud and native children read verified saved bytes through a bounded read-only tool. Native Codex execution remains on the customer's device; uploaded files and client-reported text are clearly distinguished from independent OS verification.

Known settled failures can stop or await explicit customer review. Approval skips the failed step without replaying it, permits only independent later work, preserves incurred charges and leaves the overall workflow failed. Unknown usage, unresolved external effects, revoked authority and unavailable sources cannot use this continuation path.

The selected qualifications cover 39 backend cases, 12 trusted native-runner cases and seven actual Web journeys with seven screenshots and two real-time GIF/MP4 pairs. Model responses are explicitly synthetic. Production provider/payment acceptance and complete native Codex/OS qualification remain open. All original requirement identities and full acceptance scopes are retained.
'''
for folder in ['development','technical']:
    with (ROOT/f'docs/{folder}/145-workflow-handoffs-and-failure-review.md').open('x',encoding='utf-8',newline='\n') as f:f.write(guide)
changes='''# 阶段145更新 / Stage145 changes

| 编号 | 本轮实现 | 验证 |
|---|---|---|
| 145-01 | 冻结前序成果选择、完整私有文本、原文件版本交接与下载 | 长文本／Unicode／CSV／分析JSON及原版本读取 |
| 145-02 | 已结算失败等待确认、明确略过、独立步骤继续、整体失败保留 | 云端与本机API、确认竞争、未知用量及撤权阻断 |
| 145-03 | Web费用与失败说明、可信本机确认卡、窄屏导航隐藏 | 51项业务／本机控制检查、7项实际Web流程 |
| 145-04 | 双语README、流程图、7张截图、2组GIF／MP4及完整原始尝试 | 来源与Git字节绑定、增量发布审计 |

Known settled-failure review and complete exact-version handoffs now connect private workflow specialists. Actual customer controls and downloads were exercised with synthetic model responses. Full-product acceptance remains open; use the original numbered ledger below.

[开发说明](../development/145-workflow-handoffs-and-failure-review.md) · [完整编号清单](../quality/remaining-work-stage145.md) · [来源检查点](../quality/workflow-handoff-checkpoint-145.json)
'''
with (ROOT/'docs/changes/145-workflow-handoffs-and-failure-review.md').open('x',encoding='utf-8',newline='\n') as f:f.write(changes)

requirements='''# 工作流交接补充 / Workflow handoff supplement

本补充映射原REQ032，并保持原SRS及全部验收范围。仅描述本轮已实现的私有云端／本机顺序流程，不替代团队图、其他业务路径或正式环境验收。

| 编号 | 约束 |
|---|---|
| WF145-01 | 每次运行冻结输入步骤选择、角色、预算、失败策略及定义摘要。 |
| WF145-02 | 只能选择唯一前序产出步骤；审批、自己和后序引用必须在收费前拒绝。 |
| WF145-03 | 完整文本与原始交付版本单独保存，截短收据不得冒充完整成果。 |
| WF145-04 | 按固定版本和摘要读取；后续修订不静默替换既定输入。 |
| WF145-05 | 来源撤回、删除、过期或权限失效后停止后续读取／执行。 |
| WF145-06 | 私有文件不能因知道ID而被其他用户、项目或租户读取。 |
| WF145-07 | 模型不能确认预算或人工略过；必须由当前客户明确决定。 |
| WF145-08 | 默认失败停止；已知且结算完成的失败可等待确认，绝不自动重试。 |
| WF145-09 | 未解决外部操作、未知用量、撤权及来源错误不得走略过入口。 |
| WF145-10 | 需要失败成果的步骤必须停止；独立步骤才可继续。 |
| WF145-11 | 略过不抹除费用和失败；最终整体状态保留失败。 |
| WF145-12 | 重复确认、并发推进与过期状态不得重复创建任务或费用预留。 |
| WF145-13 | Desktop保持客户本机Codex、原目录及授权；不得云端接管。 |
| WF145-14 | Extension保持原生右侧对话／附件；云端流程确认使用既有Web入口。 |
| WF145-15 | 关闭的窄屏导航必须视觉隐藏且不可命中，正文不能被残留侧栏遮挡。 |
| WF145-16 | 旧截短成果缺少完整保存内容时明确停止，不制造历史或自动重跑付费步骤。 |

These requirements supplement the original SRS. Qualification is bounded to the selected synthetic-model workflows, exact retained file versions and real customer control journeys; complete professional and production acceptance remains unchanged.
'''
with (ROOT/'docs/requirements/10-workflow-handoffs.md').open('x',encoding='utf-8',newline='\n') as f:f.write(requirements)

ledger=read(ROOT/'docs/quality/remaining-work-stage144.json');assert len(ledger['requirements'])==102
ledger['schema_version']=24;ledger['current_stage']=145;ledger['reviewed_at']=datetime.now(timezone.utc).isoformat()
row=next(r for r in ledger['requirements'] if r['id']=='REQ-032')
row['implemented_scope']+='；阶段145补齐私有云端／本机前序成果选择、完整文本及原文件版本交接、失败停止／明确人工略过。'
row['current_audit_remaining']='原范围内其余输入输出契约、跨业务组合及完整验收仍开放；本轮只证明受限私有顺序流程。'
row['current_review_note']='阶段145：39项后端、12项可信本机控制与7项实际Web流程；原remaining与full_acceptance不变。'
ledger['stage145_scope_note']={'new_full_acceptance_closures':0,'backend_cases':39,'trusted_native_runner_cases':12,'actual_web_journeys':7,
 'selected_backend':'backend-04','selected_ui':'ui-03','model_mode':'explicit_synthetic','scope':'Bounded workflow handoffs and known settled-failure review; all original whole acceptance scopes retained'}
with (ROOT/'docs/quality/remaining-work-stage145.json').open('xb') as f:f.write(dump(ledger))
md='# 阶段145完整编号清单 / Stage145 numbered ledger\n\n本轮51项业务／本机控制检查、7项实际Web流程；0项完整需求新增关闭。102个原编号及原始验收范围保留。88项必需完整范围仍开放、12项建议待确认、1项可选、REQ095保持既有验收。\n\n| 编号 | 模块 | 已实现范围 | 当前待完成范围 | 完整验收 |\n|---|---|---|---|---|\n'
for r in ledger['requirements']:
    cell=lambda v:str(v).replace('|','／').replace('\n',' ')
    md+='| '+' | '.join(cell(v) for v in [r['id'],r['module'],r['implemented_scope'],r.get('current_audit_remaining',r['remaining']),r['full_acceptance']])+' |\n'
with (ROOT/'docs/quality/remaining-work-stage145.md').open('x',encoding='utf-8',newline='\n') as f:f.write(md)

specific={
 'platform':('SQL140、完整交接读取、受限失败检查、云端及本机运行控制。','SQL140, exact handoff readers, scoped failure checks and cloud/native workflow controls.'),
 'web':('固定输入与预算审阅、原版本下载、失败略过确认及窄屏导航。','Frozen input/budget review, original-version downloads, failed-step consent and narrow navigation.'),
 'desktop':('可信本机顺序器增加输入／失败确认约束；保持本机Codex和原OS授权。','The trusted local sequencer validates input/failure review while retaining local Codex and the existing OS grant.'),
 'extension':('复用公司云端交接与既有Web流程入口；保留右侧聊天、附件和文件上传。','Uses company cloud handoffs and the existing Web workflow entry; preserves native right-side chat, attachments and uploads.'),
 'admin':('沿用当前用户／内容／费用权限体系读取对应运行记录；本轮未新增管理员界面。','Existing user/content/billing controls retain the workflow records; this release adds no new Admin surface.'),
 'delivery':('来源绑定的原生PostgreSQL核查、真实Web录制与原始失败尝试保留。','Source-bound native PostgreSQL checks, real Web recordings and preserved failed attempts.'),
}
png=Path(selected[0]['path']).name;gif=next(Path(x['path']).name for x in selected if x['path'].endswith('.gif'));video=next(Path(x['path']).name for x in selected if x['path'].endswith('.mp4'))
for component,(zh,en) in specific.items():
    repo=DEV/('copypaste-'+component)
    for language,filename in [('zh','README.md'),('en','README.en.md')]:
        target=repo/filename;original=target.read_text(encoding='utf-8');marker='<!-- workflow-handoff-stage145 -->'
        assert marker not in original
        text=(f'{marker}\n## 阶段145：完整成果交接与失败确认\n\n{zh}\n\n客户由流程顾问准备版本，核对输入、预算和失败策略，明确确认后执行；完成后下载原文件。已结算失败可按预设等待客户确认略过，整体失败与原费用保留，不自动重试。\n\n39项后端＋12项可信本机控制、7项实际Web流程通过。模型响应为明确假数据；生产接入及完整本机Codex／OS验收仍开放。默认Desktop测试保留历史文件并选择当前修订。\n\n' if language=='zh' else f'{marker}\n## Stage145: complete handoffs and failure review\n\n{en}\n\nA consultant prepares a frozen version. The customer reviews its inputs, budget and failure policy before execution, then downloads original files. A known settled failure can await explicit skip approval, preserving charges and the overall failure without an automatic retry.\n\n39 backend cases, 12 trusted native-runner cases and seven actual Web journeys passed with explicitly synthetic model responses. Production integration and complete native Codex/OS acceptance remain open. Default Desktop tests retain historical files and select the current revision.\n\n')
        text+='```mermaid\nflowchart LR\n  A[Prepare frozen version] --> B[Customer review]\n  B --> C[Local or cloud specialist]\n  C --> D[Exact saved outputs]\n  D --> E[Next specialist]\n  C --> F[Known failure review]\n  F --> G[Skip independent work; retain failure]\n```\n\n'
        text+=('[完整方案与使用边界](https://github.com/copypasteltd/workmate/blob/docs/docs/development/145-workflow-handoffs-and-failure-review.md) · [102项原编号清单](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage145.md)\n\n以下为真实Web客户流程的共享发布截图／录制，不冒充本端专有界面。\n\n' if language=='zh' else '[Full design and usage](https://github.com/copypasteltd/workmate/blob/docs/docs/development/145-workflow-handoffs-and-failure-review.md) · [Original 102-item ledger](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage145.md)\n\nThe following is an actual Web customer workflow shared as a release illustration, not a client-specific screen.\n\n')
        text+=f'![Actual Web workflow](assets/screenshots/{png})\n\n![Actual workflow interaction](assets/screenshots/{gif})\n\n[MP4](assets/screenshots/{video})\n\n'
        title,sep,rest=original.partition('\n');target.write_text(title+'\n\n'+text+rest,encoding='utf-8',newline='\n')
for filename in ['README.md','README.en.md']:
    p=ROOT/'docs'/filename;body=p.read_text(encoding='utf-8');title,sep,rest=body.partition('\n')
    note='\n<!-- workflow-handoff-stage145 -->\n[Stage145：完整成果交接／失败确认](development/145-workflow-handoffs-and-failure-review.md) · [完整102编号／Original ledger](quality/remaining-work-stage145.md) · [需求补充／Requirements](requirements/10-workflow-handoffs.md)\n\n51项业务／本机控制检查、7项实际Web流程；假数据模型，完整产品验收保持开放。51 targeted backend/native-control cases and seven actual Web journeys; synthetic models, full acceptance remains open.\n'
    assert '<!-- workflow-handoff-stage145 -->' not in body;p.write_text(title+'\n'+note+rest,encoding='utf-8',newline='\n')
for relative in ['docs/technical/91-private-cloud-workflows.md','docs/technical/76-desktop-native-workflows.md']:
    p=ROOT/relative;body=p.read_text(encoding='utf-8')
    p.write_text(body+'\n\n阶段145新增完整成果交接与已结算失败的人工略过确认，保留此文原始范围。见[当前增量方案](145-workflow-handoffs-and-failure-review.md)。\n',encoding='utf-8',newline='\n')
governance=ROOT/'docs/governance/04-git-branches-and-publication.md'
body=governance.read_text(encoding='utf-8');title,sep,rest=body.partition('\n')
note='\n<!-- workflow-handoff-stage145 -->\n阶段145使用 `record_workflow_handoff_145_v1.py`、`prepare_workflow_handoff_publication_145_v1.py`、`audit_workflow_handoff_publication_145_v1.py` 和 `publish_workflow_handoff_publication_145_v1.py --push`。保留402677条历史证明身份、原始失败尝试和102项完整验收范围；审计增量对象与双语README链接，普通原子更新六组件及docs／main八引用并读取远端SHA。用户原文件与Desktop根属性不改写。\n\nStage145 retains original attempts, all402677 historical proof identities and full acceptance scopes. Its source-bound publication audits the increment and current README destinations, then ordinarily pushes eight refs atomically with remote SHA readback.\n'
governance.write_text(title+'\n'+note+rest,encoding='utf-8',newline='\n')
print(json.dumps({'status':'written','component_readmes':12,'shared_media_copies':len(copies),'numbered_requirements':102,'new_full_acceptance_closures':0}))
