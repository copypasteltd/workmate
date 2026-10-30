"""Document only selected, passed current-source qualifications; retain whole requirements."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,re,sys
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery';RAW=DELIVERY/'evidence/document-preview-146'
read=lambda p:json.loads(p.read_bytes())
encoded=lambda v:(json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode()
backend,ui=sys.argv[1:];b,u=read(RAW/f'backend-{backend}.json'),read(RAW/f'ui-{ui}.json')
assert b['status']==u['status']=='passed' and b['source_unchanged'] and u['source_unchanged']
j=read(DELIVERY/u['journey']['path']);assert j['status']=='passed' and len(j['checks'])==4 and len(j['screenshots'])==9 and len(j['recordings'])==3
counts=[int(x) for x in re.findall(r'^# tests (\d+)\r?$',(DELIVERY/b['raw_report']['path']).read_text(encoding='utf-8'),re.M)];assert len(counts)==1 and counts[0]>=16
cases=sum(counts)
copies=[]
for item in [*j['screenshots'],*[f for r in j['recordings'] for f in r['files']]]:
    source=DEV/item['path'];body=source.read_bytes();assert sha256(body).hexdigest()==item['sha256']
    targets=[ROOT/'docs/assets/document-preview-146'/source.relative_to(DEV).parts[0]/source.name]
    if item in [j['screenshots'][0],*j['recordings'][0]['files']]:
        targets += [DEV/f'copypaste-{name}/assets/screenshots'/source.name for name in ['platform','admin','delivery']]
    for target in targets:
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():assert target.read_bytes()==body, target
        else:
            with target.open('xb')as stream:stream.write(body)
        copies.append({'source':source.relative_to(ROOT).as_posix(),'path':target.relative_to(ROOT).as_posix(),'sha256':item['sha256'],'caption':'Actual three-client document preview; platform/admin/delivery reuse the clearly labelled Web release illustration'})
with (ROOT/'docs/quality/document-preview-media-copies-146.json').open('xb')as stream:stream.write(encoded(copies))
guide=f'''# 阶段146：文件分页预览与完整来源选择 / Document pages and complete source selection

客户可以在 Web 和 Desktop 的云端文件工作区中查看 PDF、DOCX、XLSX、PPTX 的实际分页图像，翻页、跳页、查看本页文字并下载原文件。引用素材使用服务端搜索、连续分页和明确的历史版本选择，不再限于前200项或静默绑定最新版。Extension 在原生右侧栏内预览已获准上传的私人附件，保持聊天和待发送状态。

## 使用流程 / Customer journey

1. 邮箱验证码登录；Desktop 和 Extension 通过现有浏览器授权及 PKCE 进入选定企业、项目。会话附件保持私人范围。
2. 上传或选择来源。在“新增项目 → 引用素材版本”搜索整个获准素材范围，载入更多素材／较早版本，明确选择固定版本后保存。搜索词按字面处理 `%`、`_`、反斜线，不把它们当通配符。
3. “预览及引用”打开实际页面，上一页／下一页／跳页只读取该版本。原始 SHA-256、版本和字节保留；后续新版本不会替换已有引用。
4. 复制工作引用或使用既有附件／角色输入流程交给助手。预览本身不会启动任务、调用 AI 模型或产生 AI 费用；角色执行仍需既有预算／权限确认。
5. Extension 点击上传完成附件的“预览附件”，在真实 Chrome 右侧 Side Panel 内翻页。关闭预览后附件仍处于“已上传，待发送”，不会替用户发送。
6. 每次页面读取前后重查当前会话、企业、项目、私人范围及来源状态。打开的预览每4秒复查；撤权、隔离、删除或来源更改后清除图像、文字和敏感标题。清理存在网络往返与4秒轮询延迟。

```mermaid
flowchart LR
  A[客户选择或上传文件] --> B[不可变版本与摘要]
  B --> C[当前会话及文件权限]
  C --> D[只读文件检查]
  D --> E[原生 Office 转为 PDF]
  D --> F[PDF 页面工作线程]
  E --> F
  F --> G[再次验证权限及版本]
  G --> H[Web / Desktop / 原生 Side Panel]
  H --> I[固定版本引用交给角色]
```

## 原生运行与边界 / Native runtime

- 在 backend 仓库执行 `npm ci`、`npm run setup:document-preview`、`npm run build`。设置脚本从 LibreOffice 官方站下载固定26.8.2 Windows x64 MSI，校验固定 SHA-256及官方元数据，使用 `msiexec /a` 解包到被忽略的 `.data/document-preview/`，编译本仓库的 C# 进程宿主并绑定摘要。无系统 Office 安装，无 Docker／WSL／虚拟化。下载和生成文件不提交 Git。
- PDF 使用固定 `pdfjs-dist@6.4.299`（Apache-2.0）和原生 Canvas；Office 使用 LibreOffice（MPL-2.0，具体发行文件保留官方许可证）。当前 Office 设置和真实转换验收为 Windows x64；其他服务器平台的 Office 转换部署仍待验收。PDF 不依赖 Office。
- 源文件≤25 MiB，≤400页；每页图像≤1200×1600且≤2 MiB，本页文字≤20000字符。全服务最多同时2个预览、每用户1个；繁忙明确返回429。超限或不支持的文件保留原文件下载路径，不伪造预览。
- Office ZIP 预检限制条目数、单文件及累计解压量，禁止宏、VBA、ActiveX、OLE、外部数据／图片、危险字段、路径穿越及嵌套宏；按XML实体解码后的文字复查网络公式和字段，SVG外部资源同样拒绝。当前预览只接受UTF-8／US-ASCII XML部分，其他编码保留原件下载。转换禁宏／外链更新，固定格式导出器，使用独立临时配置目录和 Windows Job，最多8个进程、1 GiB内存、45秒；取消、父进程退出或宿主退出会回收本次子进程。
- 对“转换器退出成功但没有输出PDF”仅允许一次新的独立临时配置重做只读转换，最终失败返回明确422；不重放AI任务、付款或客户外部操作。PDF工作线程≤256 MiB／20秒，禁网络、XFA及脚本求值，关闭时等待工作线程终止。
- 转换PDF缓存≤3项／80 MiB、5分钟；缓存命中仍逐次读取原件并检查当前访问与 SHA。缓存不会作为权限证明。临时输入／输出在本次处理结束后删除；Windows短暂文件占用会按限次退避等待，不再把清理竞争当作预览成功。所有权标记独立于待删除目录，部分删除仍可保留；持续占用明确返回503。所属进程已退出的已标记遗留目录，在下一次 Office 转换前清理。未知目录不触碰。
- Desktop 的此页面属于现有公司云端文件区；本机 Codex 内核与完整本机授权流程保留。此次文件预览验收不冒充本机 Codex／OS操作验收。

## 接口 / API

所有接口要求当前用户会话；原生端使用当前原生令牌。`X-Tenant-ID`适用于工作区短路径。

| 接口 | 参数与行为 |
|---|---|
| `GET /v1/tenants/:tenant/projects/:project/assets` | 可选 `q`≤150字符、`scope=all/shared/private`、`limit=1..200`、UUID `cursor`；稳定 `(created_at,id)` 倒序分页，保留 PostgreSQL 微秒精度。显式查询返回 `next_cursor`；无参数保留原兼容响应。 |
| `GET .../assets/:asset/versions` | 可选 `limit=1..200`、`before_version`；明确载入较早版本，分页不返回已擦除版本；原无参数响应兼容保留。 |
| `GET .../cloud-nodes/:node_id/document-preview` | 必填UUID `asset_version_id`、`page=1..400`，可选 `describe=true`；核对当前目录绑定及原版本。 |
| `GET /v1/workspace-nodes/:node_id/document-preview` | 同上，使用当前租户头。 |
| `GET .../assets/:asset/document-preview` | 受当前项目及私有来源权限约束，用于 Extension 已上传附件；知道UUID不代表有权限。 |

响应包含固定来源、SHA、页数、图像及本页文字；`Cache-Control: private, no-store`。状态涵盖404无权／不可见来源、409引用更改／游标失效、416页码越界、422不安全／不可转换、429繁忙、503转换未设置。未设置 Office 时描述明确 `setup_required` 并保留原件下载，不报告成功页面。

## 验证与交付范围 / Evidence

选择后端 `backend-{backend}`、实际三端 `ui-{ui}`：{cases}项后端定向检查通过，4组实际操作流程通过，9张截图、3组实际时序GIF／MP4，网页1440／960／390、Desktop1360／1000及原生Side Panel布局检查。真实 PDF／中文Word／双工作表Excel／双页PowerPoint、213项素材微秒游标、54版历史、字面搜索、私人越权、读取期间撤销会话／成员资格、隔离缓存来源、嵌套宏／外部图片阻断、取消与关闭，以及真实 Windows 排他文件占用和延后释放均有证据。

保留全部原始失败尝试、原始源码快照、校验器及日志；未将失败记录改成成功。当前模型服务按用户授权继续使用假数据，本轮预览不发送模型请求。此为文件工作区功能增量，非全平台回归、生产AI／广告／付款接入或完整本机操作验收。102项原编号与完整范围保留，本轮没有新增整项关闭。

## English

Web and the frameless Desktop cloud-files workspace now display actual PDF/DOCX/XLSX/PPTX page images, extracted page text and original-version downloads. Search and keyset pagination traverse the complete authorized asset set; users explicitly choose an older or current immutable version. The native Chrome right Side Panel previews customer-selected uploaded private attachments without sending them or starting an AI task.

Every read checks the current session, tenant/project/private scope, source state and exact version before and after rendering; open viewers recheck every four seconds. Revoked or changed sources clear their visible content. Original bytes are unchanged. Office archives undergo bounded structural and external-resource checks, run in a hidden native process Job with private temporary profiles, fixed PDF exporters and bounded cleanup. A successful exit with no PDF allows one repeat of the private read-only conversion, followed by an explicit failure if needed. PDF workers disable networking and script evaluation.

Run `npm run setup:document-preview` in the backend before building on Windows x64. It verifies and administratively extracts the pinned official LibreOffice26.8.2 package and compiles the repository-owned host; it does not install system Office or use virtualization. PDF preview uses pinned PDF.js6.4.299. Office deployment on other server operating systems remains unqualified.

The selected evidence covers {cases} backend cases, four actual client journeys, nine screenshots and three real-time GIF/MP4 pairs. It includes a real unsigned frameless Windows package and the actual Chrome right SIDE_PANEL, not a replacement extension tab. No AI provider request is made. Production services, full native Codex/OS acceptance and the original whole-product acceptance scopes remain open.

Primary references: [LibreOffice](https://www.libreoffice.org/download/), [native command parameters](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html), [PDF.js examples](https://mozilla.github.io/pdf.js/examples/).
'''
for folder in ['development','technical']:
    with (ROOT/f'docs/{folder}/146-document-pages-and-source-selection.md').open('x',encoding='utf-8',newline='\n')as stream:stream.write(guide)
requirements='''# 文件预览与来源选择补充 / Document preview and source selection

本补充细化原REQ063及文件／多端相关范围，不缩小原SRS的完整专业和生产验收。

| 编号 | 约束 |
|---|---|
| DP146-01 | 支持实际PDF、DOCX、XLSX、PPTX页面图像、页码和原始字节下载；不以文本清单冒充分页。 |
| DP146-02 | 新引用必须明确选择来源及固定版本；搜索与连续分页覆盖全部当前获准素材。 |
| DP146-03 | 历史版本按用户主动选择载入，来源更新不能静默替换已选择版本。 |
| DP146-04 | 预览前后均检查当前会话、租户、项目、私有权限、来源状态及摘要；缓存不替代授权。 |
| DP146-05 | 打开的预览定期复核，失权或更改后清除正文、图像及敏感标题，明确实际轮询延迟。 |
| DP146-06 | Office转换必须隔离临时配置、禁宏／外链、限制资源并回收进程；禁止本地虚拟化。 |
| DP146-07 | 不支持、超限、未配置或失败需明确反馈并保留合法原件路径，不创建伪成功。 |
| DP146-08 | Extension预览留在原生右侧栏；上传、预览、发送是客户分别触发的动作。 |
| DP146-09 | Desktop保持无边框、隐藏菜单／滚动轨道，无横向溢出；本机Codex架构不变。 |
| DP146-10 | 预览与翻页不启动AI任务、不调用模型、不产生AI费用。 |

These requirements supplement the original SRS; selected evidence proves the bounded document and source-selection increment, not full product or production acceptance.
'''
with (ROOT/'docs/requirements/11-document-preview-and-source-selection.md').open('x',encoding='utf-8',newline='\n')as stream:stream.write(requirements)
ledger=read(ROOT/'docs/quality/remaining-work-stage145.json');assert len(ledger['requirements'])==102
ledger['schema_version']=25;ledger['current_stage']=146;ledger['reviewed_at']=datetime.now(timezone.utc).isoformat()
row=next(r for r in ledger['requirements']if r['id']=='REQ-063');row['implemented_scope']+='；阶段146增加真实PDF／DOCX／XLSX／PPTX分页、服务端完整素材搜索与历史版本选择、三端预览及当前撤权清屏。'
row['current_audit_remaining']='保留原remaining和完整验收范围；其他文件格式、服务器平台、完整专业工作流及生产验收继续开放。'
row['current_review_note']=f'阶段146：{cases}项后端、4组真实三端流程、9张截图／3组GIF与MP4；不新增整项关闭。'
ledger['stage146_scope_note']={'new_full_acceptance_closures':0,'backend_cases':cases,'actual_client_journeys':4,'selected_backend':'backend-'+backend,'selected_ui':'ui-'+ui,'model_mode':'no_ai_requests','scope':'Bounded document preview and source selection; original whole acceptance scopes retained'}
with (ROOT/'docs/quality/remaining-work-stage146.json').open('xb')as stream:stream.write(encoded(ledger))
md='# 阶段146完整编号清单 / Stage146 numbered ledger\n\n102个原编号与完整验收范围保留。88项必需完整范围仍开放，12项建议待确认、1项可选、REQ095保持既有验收。这不是尚未实现模块的数量。\n\n| 编号 | 模块 | 已实现范围 | 当前待完成范围 | 完整验收 |\n|---|---|---|---|---|\n'
for row in ledger['requirements']:
    cell=lambda value:str(value).replace('|','／').replace('\n',' ')
    md+='| '+' | '.join(cell(x)for x in [row['id'],row['module'],row['implemented_scope'],row.get('current_audit_remaining',row['remaining']),row['full_acceptance']])+' |\n'
with (ROOT/'docs/quality/remaining-work-stage146.md').open('x',encoding='utf-8',newline='\n')as stream:stream.write(md)
specific={
 'platform':('原版本授权、真实文件转换、资源／进程约束、完整素材分页接口；运行前设置原生预览依赖。','Exact-source authorization, actual conversion, native process/resource bounds and complete asset pagination; provision the native preview runtime before use.'),
 'web':('文件分页、跳页、历史版本搜索和原件下载；打开文件失权后清除内容。','Document pages, page jumps, older-version selection and original downloads; open views clear withdrawn content.'),
 'desktop':('无边框Windows客户端增加云端文件分页；本机Codex与完整本机授权保留。','The frameless Windows client gains cloud document pages while retaining customer-local Codex and its explicit OS grant.'),
 'extension':('原生右侧栏上传获选文件，在附件内翻页；保持私有、待发送状态。','Native right Side Panel upload and attachment page turns preserve the private, unsent state.'),
 'admin':('保持现有完整用户／费用／权限管理；用户端文件展示受当前会话和内容状态约束，本轮没有新增Admin页面。','Existing user, billing and permission administration remains in place; preview reads honor current content state. No new Admin page is added by this release.'),
 'delivery':('原生SQL、真实三端页面、Windows包、Side Panel、截图和时序录像均绑定源码。','Source-bound native SQL, actual three-client interactions, Windows package, native Side Panel, screenshots and real-time recordings.'),
}
for component,(zh,en)in specific.items():
    client=component if component in ['web','desktop','extension']else 'web'
    image=next(item for item in j['screenshots']if item['path'].startswith('copypaste-'+client+'/'))
    recording=next(item for item in j['recordings']if item['files'][0]['path'].startswith('copypaste-'+client+'/'))
    png=Path(image['path']).name;gif=next(Path(f['path']).name for f in recording['files']if f['path'].endswith('.gif'));mp4=next(Path(f['path']).name for f in recording['files']if f['path'].endswith('.mp4'))
    repo=DEV/('copypaste-'+component)
    for language,name in [('zh','README.md'),('en','README.en.md')]:
        target=repo/name;original=target.read_text(encoding='utf-8');marker='<!-- document-preview-stage146 -->';assert marker not in original
        intro=(f'## 阶段146：实际文档分页与完整素材选择\n\n{zh}\n\n进入文件工作区，搜索获准素材，明确选择固定版本，再预览／翻页／下载或交给角色。Extension点击已上传附件的预览按钮；预览不会发送附件或产生AI任务。{cases}项后端检查、4组真实三端流程通过，9张截图与3组时序GIF／MP4。当前Office预览设置与真实验收为Windows x64，其他服务器平台待验收；生产AI与完整本机Codex／OS验收继续开放。\n\n' if language=='zh' else f'## Stage146: actual document pages and complete source selection\n\n{en}\n\nOpen Cloud files, search authorized sources and explicitly select a fixed version before previewing, turning pages, downloading or passing a reference to a specialist. In Extension, preview an uploaded attachment inside the right Side Panel. Previewing does not send it or create an AI task. {cases} backend checks and four actual client journeys passed, with nine screenshots and three real-time GIF/MP4 pairs. Office runtime setup and conversion are qualified on Windows x64; other server platforms, production services and complete native Codex/OS acceptance remain open.\n\n')
        if component=='platform':intro+='```powershell\nnpm ci\nnpm run setup:document-preview\nnpm run build\n```\n\n'
        intro+='```mermaid\nflowchart LR\n  A[Select authorized source] --> B[Choose immutable version]\n  B --> C[Check current authority]\n  C --> D[Render actual document page]\n  D --> E[Recheck authority]\n  E --> F[Preview or pass exact reference]\n```\n\n'
        intro+='[Design / 使用方案](https://github.com/copypasteltd/workmate/blob/docs/docs/development/146-document-pages-and-source-selection.md) · [Original numbered ledger / 原编号清单](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage146.md)\n\n'
        if component not in ['web','desktop','extension']:intro+=('以下为共享发布用的真实Web截图和录像，不作为本端专有页面验收。\n\n' if language=='zh' else 'The following actual Web capture is a shared release illustration, not a client-specific page acceptance.\n\n')
        intro+=f'![Actual document preview](assets/screenshots/{png})\n\n![Real-time interaction](assets/screenshots/{gif})\n\n[Actual MP4 recording](assets/screenshots/{mp4})\n\n'
        target.write_text(original+'\n\n'+marker+'\n'+intro,encoding='utf-8',newline='\n')
change=f'''# 阶段146更新 / Stage146 changes

| 编号 | 本轮实现 | 验证 |
|---|---|---|
| 146-01 | 真实PDF／DOCX／XLSX／PPTX页面、原版本下载 | 原件摘要、独立页面、中文、页码越界 |
| 146-02 | 完整素材搜索、微秒游标、明确旧版本选择 | 213项素材、54版历史、私有隔离、字面查询 |
| 146-03 | 三端预览与当前权限撤回 | {cases}项后端、4组真实流程、9张截图、3组GIF／MP4 |
| 146-04 | 原生转换配置、进程回收、双语文档及源码绑定 | 原始失败保留、Windows包和原生Side Panel |

Pending: original professional/production acceptance, other server-platform Office deployment and remaining original requirement scopes. No new whole-requirement closure is claimed.

[完整设计](../development/146-document-pages-and-source-selection.md) · [全部原编号](../quality/remaining-work-stage146.md) · [来源检查点](../quality/document-preview-checkpoint-146.json)
'''
with (ROOT/'docs/changes/146-document-pages-and-source-selection.md').open('x',encoding='utf-8',newline='\n')as stream:stream.write(change)
for name in ['docs/README.md','docs/requirements/01-srs.md']:
    file=ROOT/name;old=file.read_text(encoding='utf-8');old+='\n\n阶段146补充：[文件分页与来源选择](./requirements/11-document-preview-and-source-selection.md) · [当前完整编号](./quality/remaining-work-stage146.md)\n' if name=='docs/README.md' else '\n\n当前文件分页与来源选择细则见 [补充需求](11-document-preview-and-source-selection.md)，保留本文全部原始范围。\n';file.write_text(old,encoding='utf-8',newline='\n')
file=ROOT/'docs/README.en.md';file.write_text(file.read_text(encoding='utf-8')+'\n\nStage146: [actual document pages and source selection](development/146-document-pages-and-source-selection.md) · [all original numbered scopes](quality/remaining-work-stage146.md).\n',encoding='utf-8',newline='\n')
file=ROOT/'docs/governance/04-git-branches-and-publication.md';file.write_text(file.read_text(encoding='utf-8')+'\n\n<!-- document-preview-stage146 -->\n阶段146使用 `record_document_preview_146_v1.py`、`prepare_document_preview_publication_146_v1.py`、`audit_document_preview_publication_146_v1.py` 和 `publish_document_preview_publication_146_v1.py --push`。保留404427条历史证明身份及原始尝试，绑定当前三端文件分页与来源选择、实际媒体和六组件源码；审计增量并普通原子更新八个远端引用，读取SHA核对。所有原始完整验收与用户文件保持。\n\nStage146 retains404427 historical proof identities and original attempts. Its source-bound document previews and actual client media are published through an ordinary atomic eight-ref push with remote SHA readback. Original whole-product acceptance scopes remain open.\n',encoding='utf-8',newline='\n')
print(json.dumps({'status':'written','backend_cases':cases,'client_journeys':len(j['checks']),'media_copies':len(copies),'original_requirement_ids':102,'new_whole_closures':0}))
