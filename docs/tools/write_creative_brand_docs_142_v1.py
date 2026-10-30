"""Write bilingual current guides from the actual source-bound Stage142 evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import sys
import re

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
def load(p): return json.loads(p.read_bytes())
def write(p,text):
    with p.open('x',encoding='utf-8',newline='\n') as f: f.write(text)
ui=sys.argv[1]
assert re.fullmatch(r'ui-\d{2}',ui)
ui_report=load(DEV/f'copypaste-delivery/evidence/creative-brand-142/{ui}.json')
assert ui_report['status']=='passed' and ui_report['sources_unchanged'] and ui_report['package_unchanged']
journey=load(DEV/f'copypaste-delivery/evidence/creative-brand-142/{ui}-journey.json')
assert journey['status']=='passed'
assert len(journey['screenshots'])==5 and len(journey['recordings'])==3
at=datetime.now(timezone.utc).isoformat()
scope='阶段142新增品牌画布的目的品牌固定版本、字体／同类型事实／Logo逐项映射、可选配色、替换差异核对、明确品牌确认及新副本恢复。品牌、矢量稿和演示稿的文字矢量化改为保留原图片、形状及层叠顺序，并以实际图像像素验证。62项相关检查与真实三端操作不代替完整专业角色、全部格式恢复、真实模型／平台账户、跨机器及签名安装验收。'
old_file=ROOT/'docs/quality/remaining-work-stage140.json'
ledger=load(old_file)
ledger['schema_version']+=1; ledger['reviewed_at']=at
ledger['previous_review']={'path':old_file.relative_to(ROOT).as_posix(),'sha256':sha256(old_file.read_bytes()).hexdigest()}
ledger['checkpoint']='docs/quality/creative-brand-checkpoint-142.json'
ledger['new_full_acceptance_closures']=0
ledger['current_increment']={'stage':142,'scope':scope,'actual_client_checks':journey['checks'],'full_acceptance_scope_changed':False}
affected={'REQ-012','REQ-013','REQ-016','REQ-022','REQ-068','REQ-070','REQ-077','REQ-078'}
for r in ledger['requirements']:
    if r['id'] in affected:
        r['current_review_note']='阶段142补齐品牌画布明确重绑／差异核对及图像保留的已验证子流程；原始整项验收范围与开放状态保持。'
        r['current_audit_remaining']='品牌画布跨项目重绑、真实PNG/PDF/SVG输出、继续修改与再次导出已有当前证据；矢量／演示稿的源图片和层叠顺序有像素检查。全部专业输入、所有格式的应用内恢复、所有字体依赖、跨机器一致性及完整原验收仍待完成。'
assert len(ledger['requirements'])==102
write(ROOT/'docs/quality/remaining-work-stage142.json',json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
table=['# 当前未完成项 · 阶段142','',scope,'','保留102个原始编号与完整验收条件。88个必要项尚未完全验收；另有12个未确认扩展建议和1个可选项。REQ-095继续保持已接受。以下为整项验收缺口，不等于模块均未实现。','','| 编号 | 模块 | 状态 | 当前完整验收待项 |','|---|---|---|---|']
for r in ledger['requirements']:
    remaining=r.get('current_audit_remaining') or r['remaining']
    table.append(f"| {r['id']} | {r['module']} | {r['full_acceptance']} | {remaining.replace('|','／')} |")
write(ROOT/'docs/quality/remaining-work-stage142.md','\n'.join(table)+'\n')

guide='''# 品牌工程复用 / Reuse a campaign with another brand

客户可把品牌画布连同固定来源打包，在另一个有权限的项目中选择明确的目的品牌版本，逐项核对字体、同类型事实、Logo和可选配色，确认后建立新工程。来源工程保持原版本。恢复不发起AI调用或AI费用；以后启动Agent修改仍执行原权限和费用确认。

Export a brand canvas with its fixed media, then choose an authorized destination brand revision in another project. Map fonts, facts of the same type and Logos, optionally replace colors, review changes and explicitly approve a new shared copy. Source content stays intact. Restore makes no AI request or AI charge; later Agent work follows existing permission and cost confirmations.

## 用户操作 / Customer flow

1. 在Web/Desktop「设计画布 → 工程打包与恢复」选择工程当前版本，下载ZIP。扩展在工具栏开启的原生右侧栏提供相同工程入口。
2. 先确认上传包及恢复素材可供目的项目成员使用，再选择文件并上传。继续沿用固定版本、SHA-256、100MiB总包上限与分片上传。
3. 选择目的项目的固定品牌版本、使用渠道和地区语言。品牌列表支持分页；不自动升级到更新版本。
4. 将来源字体、事实和Logo逐项映射到目的品牌。价格只映射到价格、促销只映射到促销；系统检查生效时间、字体使用范围、实际字形与Logo尺寸／留白。
5. 可将原设计颜色替换为目的品牌中已声明的颜色。不指定替换的颜色和未绑定事实的文案会保留，需要客户明确确认仍适用。
6. 点击「核对品牌替换内容」，查看实际新价格／文案、字体与Logo的逐项变化；任何选择变化都会使之前确认失效。
7. 明确确认品牌变化及素材权利，再恢复为新共用工程。目标Logo复用当前项目已授权的固定文件；一般源图片重新分配ID。源品牌ID、权限和旧字体文件不作为目的授权导入。
8. Web/Desktop继续修改图层并输出PNG、PDF或SVG，之后可重新整理版本并打包。扩展负责上传、核对与恢复，继续编辑在同项目的Web/Desktop完成。
9. 连接中断时保留原请求并核对回执。成功结果不重复创建；已移除结果不复活。扩展可先核对原结果，再明确重新选择来源。

On all three clients, explicitly approve project sharing before upload. Select an exact destination brand revision, channel and locale; map each required source font/fact/Logo. Optional colors must belong to the destination palette. Review actual resolved changes and approve both brand suitability and media rights. Changing a choice invalidates approval. Restore creates new content and media IDs, reuses authorized destination Logos, and never imports old brand authority. Continue editing in Web/Desktop. Unknown outcomes keep the original request; receipts prevent duplicate or removed-content recreation.

## 实现与控制 / Implementation and control

- 工程清单新增可选品牌依赖描述，逐层记录来源字体、事实类型、已解析文字与Logo用途键。包内声明只是客户上传内容，不能授予项目权限或证明来源可信。
- 服务器在恢复事务中重新检查当前身份、目的项目写权限、固定品牌版本、素材状态、字体权利、事实期限、字形、Logo文件完整性及版面限制。替换确认摘要绑定包、版本、目的品牌与实际差异。
- 每个必要来源键必须且只能映射一次，目标字段必须存在；拒绝漏项、重复项、未知字段、不同事实类型及未声明的目标颜色。
- 先验证品牌约束，再保存导入内容。恢复、资源分配和审计在同一事务中完成；沿用原请求幂等、移除结果拒绝、存储配额与生命周期控制。
- 字体矢量化逐个文字层转换，保留原图片、形状及层叠顺序。共享修复同时用于品牌画布、矢量稿及演示稿的PNG/PDF预览；原生PPTX继续保留可编辑文字、形状与实际图片。
- 原接口清单漏记的54个实际操作补入可变的客户端操作增量声明；历史基线散列保持。既有完整实际路由集合相等检查继续执行。
- Desktop继续在本机运行Codex，窗口无边框、无Electron菜单；扩展继续使用原生右Side Panel和云端Agent。

Archive declarations carry no authority. Server-side restoration rechecks live identity, project write access, exact brand revision, media lifecycle, font rights/glyphs, fact validity and Logo bytes/layout. Exact maps and a package/brand/change-bound digest gate the atomic restore. Font outlining preserves source images and shape order in brand/vector/presentation output. Original route inventory equality remains strict; the immutable baseline is unchanged. Desktop remains local Codex; Extension remains the native right Side Panel with cloud execution.

## API

前缀 / Prefix: `/v1/tenants/:tenant/projects/:project/creative-project-packages`

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/brand-options?cursor=...` | 项目写权限范围内分页列出固定品牌、渠道、字型、事实状态及Logo字段 |
| POST | `/preview` | 固定上传版本校验，品牌包另返回完整依赖与设计原色 |
| POST | `/brand-preview` | 接收固定上传选择及brand_target，重新校验并返回差异和review_hash |
| POST | `/restore` | 品牌包强制brand_target、brand_review_hash与confirm_brand_review=true；原有共用／权利／预览确认仍必需 |
| GET | `/requests/:key` | 当前发起人在当前项目核对原结果，不重新创建已移除内容 |

`brand_target`包含固定`binding`，以及完整的`fonts/facts/logos`映射和明确的`colors`替换列表。普通画布与影片包不能附带品牌重绑字段。旧普通工程包继续可读；旧客户端不支持新的品牌依赖，需要升级后使用。

`brand_target` contains a fixed binding, exact font/fact/Logo maps and explicit optional palette replacements. Non-brand canvases and video packages reject these fields. Existing ordinary packages remain readable; older clients must upgrade to consume brand dependency descriptions.

## 当前证据与边界 / Evidence and limits

62项相关检查覆盖8项品牌恢复集成、6项既有普通工程恢复、13项品牌生产、7项可编辑设计、2项新增矢量／演示图像像素、23项视频和3项扩展下载边界。实际三端使用邮箱OTP／PKCE、原生PostgreSQL、上传与ZIP校验；Web与未签名无边框Windows包均完成品牌替换、图层续改、真实PNG输出和v2再次打包；Chrome通过工具栏打开原生右侧栏并在侧栏中上传、确认和恢复。5张截图、3组真实GIF／MP4和3份实际工程包绑定确切源码。所有自建浏览器、页面、Windows程序及服务在结束后关闭。

Synthetic campaign data exercises real native storage, rendering and client controls. These 62 checks and actual client journeys have source-bound evidence; they do not constitute the whole platform regression, a professional creative-quality review or a signed installer test.

仍待完成：全部SVG／PPTX／专业工程的应用内恢复、所有字体与复杂依赖、跨机器与渲染环境的一致性、真实Image2／视频／广告服务与客户质量验收、正式签名安装及其余原始验收范围。品牌权利为客户声明，不能将字段有效视为已完成法律授权核验。完整102项范围不缩减，整项验收不新增关闭。

```mermaid
flowchart LR
 A[固定品牌画布与来源] --> B[ZIP校验及明确项目共用]
 B --> C[选择目的品牌固定版本]
 C --> D[字体/事实/Logo/配色映射]
 D --> E[实时检查并显示实际差异]
 E --> F[明确品牌与素材权利确认]
 F --> G[新工程及新素材/目的Logo]
 G --> H[继续编辑/PNG PDF SVG/再打包]
 F --> I[断线保留原请求]
 I --> J[核对原结果/移除结果不复活]
```
'''
write(ROOT/'docs/development/142-brand-project-reuse.md',guide)
write(ROOT/'docs/changes/142-brand-project-reuse.md','''# 阶段142更新 / Stage142 changes

品牌画布可以跨项目显式重绑：固定目的品牌、字体／事实／Logo逐项映射、可选配色、实际差异核对及独立确认，再建立新工程并继续修改和导出。共享文字矢量化修复图片丢失，同时保留品牌／矢量／演示稿的图像、形状与层叠顺序。补齐54个真实接口操作的清单声明，既有严格集合核查保持。

Brand canvases support reviewed destination-brand reuse across projects. Exact font/fact/Logo maps, optional colors and explicit suitability approval gate new-copy restore. Shared font outlining now retains image bytes and shape order in brand/vector/presentation delivery. The current inventory declares54 previously omitted actual operations while retaining strict equality and the immutable baseline.

62项相关检查和4项实际三端旅程通过，5张截图、3组实际GIF／MP4及3个工程包绑定当前源码。原失败脚本／用例／记录保留。假数据；真实OTP／PKCE、原生数据库、上传、PNG/PDF/SVG/PPTX处理；本轮不发起模型请求。Windows包未签名，全部自建页面／浏览器及进程已回收。

62 related checks and4 actual client journey checks passed, with5 screenshots,3 actual recording pairs and3 packages. Original failing attempts remain immutable. Synthetic campaign data uses real authentication, native storage, client controls and rendering; no model request was made. The Windows package remains unsigned.

原102项完整验收保留，88项必要范围仍未全部收口。详见[设计与使用](../development/142-brand-project-reuse.md)、[当前证据](../quality/creative-brand-checkpoint-142.json)、[完整待项](../quality/remaining-work-stage142.md)。
''')

url='https://github.com/copypasteltd/workmate/blob/docs/docs/development/142-brand-project-reuse.md'
for name in ['platform','web','admin','desktop','extension','delivery']:
    repo=DEV/('copypaste-'+name)
    own=[s for s in journey['screenshots'] if s['path'].startswith(repo.name+'/')]
    recordings=[r for r in journey['recordings'] if r['component']==name]
    for language,file in [('zh','README.md'),('en','README.en.md')]:
        p=repo/file; body=p.read_text(encoding='utf-8')
        assert '<!-- brand-reuse-stage142 -->' not in body
        note=('品牌工程可在新项目选择目的品牌固定版本，逐项映射字体、价格／促销事实、Logo和可选配色，核对实际差异并确认后恢复新副本。Web/Desktop继续编辑、输出PNG/PDF/SVG并再次打包；扩展在原生右侧栏完成上传、核对与恢复。修复文字矢量化导致品牌／矢量／演示稿源图片丢失的问题，保留图像和形状层叠顺序。' if language=='zh' else
              'Reuse a brand canvas in another project by selecting a fixed destination brand, mapping fonts, price/promotion facts, Logos and optional colors, reviewing actual changes and explicitly approving a new copy. Web/Desktop continue editing, render PNG/PDF/SVG and export again; Extension uploads, reviews and restores inside its native right Side Panel. Font outlining now preserves source images and shape order in brand/vector/presentation output.')
        evidence=('62项相关检查、真实三端旅程、5张截图和3组GIF／MP4已通过并绑定源码。假数据，无模型调用；Windows包未签名。全部格式恢复、跨机器和正式服务验收仍开放。' if language=='zh' else
                  '62 related checks and actual three-client journeys passed with5 screenshots and3 recording pairs bound to the sources. Synthetic data; no model requests; unsigned Windows package. All-format restoration, cross-machine and configured-provider acceptance remain open.')
        block=f'<!-- brand-reuse-stage142 -->\n\n{note}\n\n{evidence} [方案 / Guide]({url}).\n\n```mermaid\nflowchart LR\n A[Fixed source ZIP] --> B[Destination brand maps]\n B --> C[Review and approve]\n C --> D[New shared copy]\n D --> E[Edit / render / export again]\n```\n\n'
        for item in own:
            relative=item['path'].removeprefix(repo.name+'/')
            block+=f'![Actual brand workflow]({relative})\n\n'
        for r in recordings:
            for item in r['files']:
                relative=item['path'].removeprefix(repo.name+'/')
                block+=(f'![Actual interaction GIF]({relative})' if relative.endswith('.gif') else f'[Actual interaction MP4]({relative})')+'\n\n'
        p.write_text(block+body,encoding='utf-8',newline='\n')
for filename in ['README.md','README.en.md']:
    p=ROOT/'docs'/filename; body=p.read_text(encoding='utf-8'); assert '<!-- brand-reuse-stage142 -->' not in body
    p.write_text('<!-- brand-reuse-stage142 -->\n\n[品牌工程跨项目复用 / Reviewed destination-brand reuse](development/142-brand-project-reuse.md) · [更新 / Changes](changes/142-brand-project-reuse.md) · [当前完整待项 / Remaining scope](quality/remaining-work-stage142.md)\n\n'+body,encoding='utf-8',newline='\n')
p=ROOT/'docs/governance/04-git-branches-and-publication.md'
body=p.read_text(encoding='utf-8')
note='''<!-- creative-brand-stage142 -->
阶段142使用`prepare_creative_brand_publication_142_v1.py`和`publish_creative_brand_publication_142_v1.py --push`，以实际阶段141为基线。保留397403条历史证明身份与所有原失败；62项相关检查、真实Web／未签名无边框Desktop／Chrome原生右侧栏旅程、截图及实际录制绑定当前源码。核对增量对象及README链接后普通原子更新八引用并读取远端SHA。用户12份未跟踪文件及Desktop根属性保持原字节；完整验收不扩大结论。

Stage142 preserves397403 historical proof identities and the actual Stage141 receipt. Source-bound brand restore and image-preserving rendering checks plus actual client captures retain original failures. Its ordinary atomic eight-ref publisher audits new objects/current paths/README links, verifies remote SHAs, preserves user files/Desktop attributes and leaves full-product acceptance open.

'''
assert '<!-- creative-brand-stage142 -->' not in body
lines=body.splitlines(True); p.write_text(lines[0]+'\n'+note+''.join(lines[1:]),encoding='utf-8',newline='\n')
print(json.dumps({'status':'written','requirement_ids':102,'required_open':88,'bilingual_guide_pairs':7,'screenshots':5,'recording_pairs':3}))
