"""Write bilingual usage and retained acceptance scope from the actual passing UI receipt."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json,sys,re
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery'
ui,backend=sys.argv[1:3];assert re.fullmatch(r'\d{2}',ui) and re.fullmatch(r'\d{2}',backend)
def read(p):return json.loads(p.read_bytes())
def write(p,s):
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('x',encoding='utf-8',newline='\n') as f:f.write(s)
def sha(b):return sha256(b).hexdigest()
u=read(DELIVERY/f'evidence/business-history-144/ui-{ui}.json');b=read(DELIVERY/f'evidence/business-history-144/backend-{backend}.json')
assert u['status']==b['status']=='passed' and u['source_unchanged'] and b['source_unchanged']
j=read(DELIVERY/u['journey']['path']);assert j['status']=='passed' and len(j['checks'])==9
counts=[int(x) for x in re.findall(r'^# tests (\d+)\r?$',(DELIVERY/b['raw_report']['path']).read_text(encoding='utf-8'),re.M)];assert sum(counts)==52
chosen=[next(x for x in j['screenshots'] if 'brand-latest' in x['path']),*j['recordings'][0]['files']]
copies=[]
for repository in ['platform','web','desktop','extension','delivery','docs']:
    for item in chosen:
        source=DEV/item['path'];body=source.read_bytes();assert sha(body)==item['sha256']
        target=(ROOT/'docs/assets/business-history-144' if repository=='docs' else DEV/('copypaste-'+repository)/'assets/screenshots')/source.name
        target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb') as f:f.write(body)
        copies.append({'source':'dev/'+item['path'],'path':target.relative_to(ROOT).as_posix(),'sha256':sha(body),'bytes':len(body)})
write(ROOT/'docs/quality/business-history-media-copies-144.json',json.dumps(copies,ensure_ascii=False,indent=2)+'\n')
scope='后台新增品牌、团队、项目简报、自动化计划及全部五类设计工程的已保存历史翻阅；普通画布后续保存产生不可变版本，新品牌版本保留真实客户操作者。支持逐页／首尾导航、精确作品身份、来源撤回隐藏正文、当前权限复查及删除历史清理。'
guide='''# 后台业务内容历史 / Administrator business content history

管理员可从统一「用户端内容」列表进入品牌、团队、项目简报、自动化计划及设计工程，阅读实际保存的完整版本记录。每页最多50条，保留客户／管理员／迁移快照来源，提供首尾及前后翻页。

From Client content, administrators can read retained versions of brands, teams, project briefs, automation schedules and creative projects. Pages contain at most 50 saved records, with original provenance, forward/backward navigation and first/last entry points.

```mermaid
flowchart LR
 A[Admin email OTP + TOTP] --> B[Current session and project permissions]
 B --> C[Client content directory]
 C --> D[Saved business version page]
 D --> E[Next / Previous / Newest / Oldest]
 E --> B
 F[Customer save or moderation change] --> G[Old page rejected: refresh]
 H[Source withdrawal or project denial] --> I[Clear body / redact unavailable version]
 J[Permanent canvas erasure] --> K[Remove saved canvas bodies]
```

## 覆盖范围 / Resource coverage

| 内容 / Content | 实际保存记录 / Retained record |
|---|---|
| 品牌 / Brands | 固定名称、定义、摘要、原操作者类别 / Exact name, definition, digest and original actor category |
| 团队 / Teams | 团队配置与客户／管理员修订来源 / Team definition and customer/administrator provenance |
| 项目简报 / Project briefs | 已发布简报版本；未发布草稿仍由原修订入口管理 / Published brief versions; drafts use the existing revision flow |
| 自动化计划 / Automation schedules | 计划定义修订；执行日志由原计划入口提供 / Schedule definition revisions; execution logs retain their existing entry |
| 普通画布 / Ordinary canvases | 从本次迁移起记录客户保存；已有数据只保留迁移时当前版 / Customer saves from this migration onward; existing canvases retain only their then-current body |
| 模板视频 / Template videos | 固定视频定义、摘要与渲染器参数 / Fixed video definition, digest and renderer profile |
| 矢量及演示稿 / Vectors and presentations | 固定页面、图层、备注和渲染器参数 / Exact pages, layers, notes and renderer profile |
| 批量设计 / Batch designs | 按作品分组，再按版本倒序；相同版号不合并 / Grouped by creative work, newest version first inside each work; equal version numbers remain distinct |

已有会话、专家和记忆完整历史入口继续保留。页面按已保存版本显示，不补造从未保存的内容。旧品牌没有操作者记录时显示「迁移时保留的现有版本」，本次修正后的新客户品牌保存会记录真实操作者。

Existing complete conversation, specialist and memory readers remain available. Unsaved historical content is never reconstructed. Legacy brands without an actor remain explicitly unattributed retained snapshots; new customer brand saves now preserve their actual actor.

## 权限与数据处理 / Authorization and data handling

- 每次翻页均要求有效管理员会话、已完成TOTP、`admin.content.read`和`admin.content.body.read`，并重新检查企业／项目范围及显式拒绝。A current MFA-authenticated session, both content permissions and current tenant/project scope are required on every read.
- 游标绑定管理员、登录会话、对象、类型、历史修订、内容版本和审核版本，30分钟失效；客户保存后旧页不能继续拼接。Cursors bind actor/session/object/kind/history/content/moderation versions and expire after 30 minutes; saves invalidate old pagination.
- 批量设计使用作品UUID与版号的组合游标，避免不同作品的v1、v2被误当成同一项。Batch paging uses work UUID plus version, preserving distinct works with equal version numbers.
- 原始文件或品牌来源不可用时，相关版本仍保留时间／身份，但正文不返回；管理员可按原权限调查被隔离的品牌自身。Withdrawn dependencies redact dependent bodies while retaining their time and identity; authorized moderation can still inspect the quarantined brand itself.
- 页面每15秒、重新聚焦或恢复可见时复查；发现内容／权限变化即清空正文，关闭时取消请求，正文和游标不存浏览器存储。Recheck every 15 seconds and on focus/visibility return; clear changed/unreadable bodies, abort closed requests and persist no private body/cursor in browser storage.
- 普通画布历史由数据库保存并禁止就地重写，永久删除流程清理其历史正文。Canvas snapshots are immutable database records; permanent erasure removes saved canvas bodies.
- 翻页不调用模型、不创建任务、费用预留或账务，只记录最少阅读审计。Reading creates no model calls, work, reservations or charges; audits contain only minimal read metadata.

## 实施与运行 / Implementation and operation

后端新增SQL139，最低数据库版本为139；升级后再启动新版API。沿用原生PostgreSQL启动／迁移流程及已有README安装命令，不依赖Docker或WSL。前端仍使用原CopyPaste品牌样式。

SQL139 adds canvas snapshots and business-history change fences. The release requires schema139 before API startup. Use the existing native PostgreSQL migration/startup instructions; no Docker or WSL is used. The administrator UI retains the CopyPaste design system.

API：`GET /v1/admin/content/:kind/:id/history?edge=first|last`，随后用返回的`next_cursor`或`previous_cursor`发起下一次请求。`kind`为`brand_profiles`、`agent_groups`、`project_configurations`、`workflow_schedules`或`creative_projects`，亦保留原三类。响应包括`content_kind`、`history_scope`、`items`、当前修订与签名游标。普通旧正文入口继续提供原字段，并增加完整历史链接。

API: request the first/last page using the route above, then the returned cursor. The five additional kinds coexist with the original three. Responses retain exact content kind, saved-history scope, items and signed cursors. Compatible body reads retain their existing fields and add the history link.

## 实际验证及边界 / Actual validation and limits

当前相关后端52项通过，实际Admin浏览器9项旅程通过。105次画布与105次品牌保存经真实客户API创建；检查首尾和双向翻页、版本变更、来源隔离、撤权清空、原样文本显示、无付费执行及1440／960／390像素布局。批量设计62个版本身份是明确的SQL夹具，验证阅读协议，不声称为本轮真实客户批量制作旅程。

The current source-bound backend run passes52 cases; the real administrator browser passes9 journeys. Canvas/brand histories use105 actual API saves each. Tests cover navigation, version change, source withdrawal, scope denial, inert text, no paid execution and1440/960/390px layouts. The62 batch version identities are explicit SQL fixtures for reader behavior, not a claimed customer production journey.

首次编译失败和第二次夹具地址失败保留原来源与日志。第二次广泛检查95项通过、10项新用例在共享夹具中失败，该轮整体仍是失败；后续52项通过绑定修正后确切源码。全产品权限矩阵、其他资源完整治理、正式外部服务和签名安装等原完整验收继续开放。

The original compiler and fixture-URL failures remain archived. The second broad attempt passed95 cases and failed10 new cases in their shared fixture; it remains a failed run. The later52-case pass binds the corrected sources. Full product matrices, remaining resource governance, real external services and signed-client installation remain open under their original acceptance scope.
'''
guide=guide.replace('passes52','passes 52').replace('passes9','passes 9').replace('use105','use 105').replace('and1440','and 1440').replace('The62','The 62').replace('passed95','passed 95').replace('failed10','failed 10').replace('later52','later 52')
write(ROOT/'docs/development/144-admin-business-content-history.md',guide)
changes=f'''# 阶段144更新 / Stage144 changes

{scope}

| 编号 | 本轮实现 / Implemented | 验证 / Evidence |
|---|---|---|
| 144-01 | 五类业务资源、五类设计工程的统一已保存历史 / Unified saved history for five business and five creative kinds | 当前52项相关后端 / Current52 related backend checks |
| 144-02 | 普通画布不可变历史、新品牌客户归属、旧快照来源标签 / Immutable canvas history, correct new brand actor and legacy provenance | 实际API保存及数据库约束 / Actual API saves and SQL constraints |
| 144-03 | 复合作品游标、来源撤回、权限复查、永久删除 / Composite work cursors, withdrawal, live authority and erasure | 当前后端及9项实际Admin旅程 / Current backend and9 actual Admin journeys |
| 144-04 | 中英说明、真实截图、两组实时GIF／MP4及独立仓库媒体副本 / Bilingual docs, actual screenshots, two real-time GIF/MP4 pairs and standalone repository media | 来源摘要、原录屏帧及发布核对 / Source digests, original frames and publication checks |
| 待完成 | 102项原始完整验收保留；88项必要整项、12项未确认建议和1可选项未整项关闭 / Original102 acceptance scopes retained;88 required,12 unconfirmed suggestions and1 optional remain open | [编号清单](../quality/remaining-work-stage144.md) |

[方案与使用逻辑](../development/144-admin-business-content-history.md) · [检查点](../quality/business-history-checkpoint-144.json)
'''
changes=changes.replace('Current52','Current 52').replace('and9','and 9').replace('Original102','Original 102').replace(';88','; 88').replace(',12',', 12').replace('and1','and 1')
write(ROOT/'docs/changes/144-admin-business-content-history.md',changes)
old=ROOT/'docs/quality/remaining-work-stage143.json';ledger=read(old);assert len(ledger['requirements'])==102
ledger['reviewed_at']=datetime.now(timezone.utc).isoformat();ledger['previous_review']={'path':old.relative_to(ROOT).as_posix(),'sha256':sha(old.read_bytes())};ledger['checkpoint']='docs/quality/business-history-checkpoint-144.json'
ledger['current_increment']={'stage':144,'scope':scope,'backend_cases':52,'actual_admin_journeys':9,'full_acceptance_closed':False};ledger['new_full_acceptance_closures']=0
for row in ledger['requirements']:
    if row['id'] in ['REQ-048','REQ-090','REQ-091','REQ-094','REQ-098']:
        row['current_review_note']='阶段144补齐五类业务及全部五类设计工程的已保存历史、画布不可变保存、当前权限与来源撤回清空，并有52项相关后端及9项实际Admin旅程。原完整范围和验收条件保持。'
write(ROOT/'docs/quality/remaining-work-stage144.json',json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
md='# 当前待验收项 · 阶段144\n\n'+scope+'\n\n保留全部102个原始编号及验收条件。88个必要项尚未整项验收，另有12个未确认建议及1个可选项；REQ-095已接受。整项状态不代表模块没有实现。\n\n| 编号 | 模块 | 整项状态 | 继续处理的完整验收内容 |\n|---|---|---|---|\n'
for row in ledger['requirements']:md+='| '+ ' | '.join(str(row.get(k,'' )).replace('|','／').replace('\n',' ') for k in ['id','module','full_acceptance','current_audit_remaining'])+' |\n'
write(ROOT/'docs/quality/remaining-work-stage144.md',md)
shot=Path(chosen[0]['path']).name;gif=Path(next(x for x in chosen if x['path'].endswith('.gif'))['path']).name;video=Path(next(x for x in chosen if x['path'].endswith('.mp4'))['path']).name
marker='<!-- business-history-stage144 -->\n'
for repository in ['platform','web','admin','desktop','extension','delivery','docs']:
    root=ROOT if repository=='docs' else DEV/('copypaste-'+repository);media='docs/assets/business-history-144/' if repository=='docs' else 'assets/screenshots/'
    for filename,en in [('README.md',False),('README.en.md',True)]:
        file=root/filename;prior=file.read_text(encoding='utf-8');assert marker not in prior
        lead=('Stage144 adds administrator saved-version reading for brands, teams, briefs, schedules and every creative project kind. Ordinary canvas saves now retain immutable versions; new customer brand saves preserve their actor. Current checks:52 related backend cases and9 real Admin browser journeys. The capture below is the actual administrator interface shared by this release.' if en else '阶段144补齐品牌、团队、简报、计划及全部设计工程的后台已保存历史，普通画布记录不可变版本，新品牌版本记录真实客户操作者。当前52项相关后端及9项实际Admin浏览器旅程通过。下图和录屏为本轮实际后台界面。')
        guide_link='docs/development/144-admin-business-content-history.md' if repository=='docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/development/144-admin-business-content-history.md'
        lead=lead.replace('checks:52','checks: 52').replace('and9','and 9')
        block=marker+('## Administrator business histories\n\n' if en else '## 后台业务版本闭环\n\n')+lead+'\n\n```mermaid\nflowchart LR\n A[Customer saves] --> B[Immutable saved versions]\n B --> C[Scoped administrator reader]\n C --> D[Bounded navigation]\n E[Authority or source withdrawal] --> F[Clear private body]\n```\n\n'
        block+=f'![Actual administrator brand history]({media}{shot})\n\n![Actual version navigation recording]({media}{gif})\n\n[MP4]({media}{video}) · [详细方案 / Usage and implementation]({guide_link})\n\n'
        block+=('Use Client content → Read content → Newest/Oldest/Next/Previous. Expand a saved record for its exact definition. Reads require both content permissions and current project scope; revoked dependencies redact the body. Earlier unsaved versions are not invented. Desktop keeps customer-local Codex execution and Extension keeps its actual browser Side Panel. Original whole-product acceptance remains open.\n\n' if en else '使用「用户端内容 → 阅读内容 → 最新／最早／前后翻页」，展开记录可查看确切定义。阅读要求当前正文权限及项目范围，依赖撤回会隐藏正文；未保存过的旧内容不补造。Desktop继续在客户本机执行Codex，Extension保留原生浏览器右侧栏。原完整产品验收继续开放。\n\n')
        file.write_text(block+prior,encoding='utf-8',newline='\n')
req=ROOT/'docs/requirements/09-admin-content-history.md';prior=req.read_text(encoding='utf-8');assert marker not in prior
req.write_text(prior+'\n'+marker+'''## 业务资源历史补充 / Business history supplement

| 编号 | 要求 / Requirement |
|---|---|
| HIST-R11 | 统一阅读品牌、团队、项目简报、自动化计划，以及普通画布／视频／矢量／演示稿／批量设计的实际已保存历史；保留原三类入口。Read retained business and all five creative histories alongside the original readers. |
| HIST-R12 | 普通画布后续保存形成不可变历史；已有数据只保留迁移时当前版，未知历史与操作者不得编造。Retain future canvas saves; preserve only existing migration snapshots and never invent missing history or actors. |
| HIST-R13 | 批量设计按作品及版号区分；新客户品牌保存记录真实操作者；来源撤回、权限和删除同样约束正文。Keep distinct work/version identities, actual actors for new brand saves and current withdrawal/permission/erasure constraints. |

[实现与验证 / Implementation and validation](../development/144-admin-business-content-history.md)。这是既有完整内容治理要求的补充，原完整验收不缩减。This elaborates existing full content governance without narrowing its acceptance scope.
''',encoding='utf-8',newline='\n')
gov=ROOT/'docs/governance/04-git-branches-and-publication.md';prior=gov.read_text(encoding='utf-8');assert marker not in prior
gov.write_text(marker+'阶段144通过 `prepare_business_history_publication_144_v1.py`、`audit_business_history_publication_144_v1.py` 与 `publish_business_history_publication_144_v1.py --push` 绑定后台业务历史的确切来源、52项相关后端、9项实际页面、原失败及真实媒体，再普通原子更新八引用并读取远端SHA。保留全部401159条历史证明身份；本轮只核查新增历史对象和当前路径／README链接，不改称重跑旧完整历史。用户文件、Desktop根属性与原完整验收保持。\n\nStage144 binds exact business-history sources,52 related backend cases,9 actual Admin journeys and original failures/media before an ordinary atomic eight-ref push and SHA readback. All401159 historical proof identities retain their original scope. User-owned files, Desktop attributes and whole acceptance scopes stay preserved.\n\n'+prior,encoding='utf-8',newline='\n')
print(json.dumps({'status':'written','bilingual_readme_pairs':7,'media_copies':len(copies),'preserved_requirement_identities':102}))
