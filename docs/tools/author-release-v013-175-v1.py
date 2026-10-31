"""Author this release's immutable helpers and bilingual handoff before tagging."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / 'dev/copypaste-delivery'


def create(p, text):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('x', encoding='utf-8', newline='\n') as f:
        f.write(text)


def derive(source, target):
    text = (ROOT / source).read_text(encoding='utf-8')
    return text.replace('v0.1.2', 'v0.1.3').replace('v012', 'v013').replace('173', '175')


packager = derive('dev/copypaste-delivery/scripts/package-frozen-release-173-v1.py', '')
packager = packager.replace('unchanged v0.1.1', 'unchanged v0.1.2').replace('release/workmate-v0.1.1', 'release/workmate-v0.1.2').replace('"workmate-v0.1.1-"', '"workmate-v0.1.2-"')
packager = packager.replace('"docs/assets/admin-posting-period-172"]', '"docs/assets/admin-posting-period-172", "docs/assets/admin-team-usage-174"]')
packager = packager.replace('"evidence/admin-posting-period-172").split', '"evidence/admin-posting-period-172", "evidence/admin-team-usage-174").split')
packager = packager.replace('"admin-posting-period-172"]:', '"admin-posting-period-172", "admin-team-usage-174"]:')
packager = packager.replace("['quality', 'assets', 'development']", "['quality', 'assets', 'development', 'releases']")
packager = packager.replace('["quality", "development"]', '["quality", "development", "releases"]')
assert 'evidence/admin-team-usage-174' in packager and 'docs/assets/admin-team-usage-174' in packager
create(D / 'scripts/package-frozen-release-175-v1.py', packager)

publisher = derive('docs/tools/publish-release-v012-173-v1.py', '')
start = publisher.index("assert cp['focused_qualification']['fresh_native_sql_api_at172']")
end = publisher.index('\n', start)
publisher = publisher[:start] + "assert cp['focused_qualification']['native_sql_api_at174']==21 and cp['focused_qualification']['actual_ui_checks_at174']==7" + publisher[end:]
publisher = publisher.replace("['source_and_outputs_identical_to170']", "['source_and_outputs_identical_to173']")
publisher = publisher.replace('len(before)==106', 'len(before)==120').replace('len(expected)==120', 'len(expected)==134')
start = publisher.index(" names['delivery']+=")
end = publisher.index('\n for b,repo in repos.items():', start)
publisher = publisher[:start] + '''
 names['backend']+=['src/admin-usage-report-model.ts','src/admin-usage-report-query.ts','src/admin-usage-reports.ts','contracts/admin-team-usage-174.json','tests/admin-team-usage-fixture-174-v1.ts','tests/admin-team-usage-174-v1.test.ts','scripts/serve-admin-team-usage-174-v1.ts']
 names['admin']+=['src/usage-reports.tsx','src/usage-reports.css']
 names['delivery']+=['scripts/package-frozen-release-175-v1.py','scripts/publish-github-release-175-v1.py','scripts/audit-release-scope-175-v1.mjs','evidence/release-freeze-175/source-scope-01.json']
 for v in [1,2,3]:
  names['delivery'] += [f'scripts/qa-admin-team-usage-174-v{v}.ts', f'scripts/qualify-admin-team-usage-174-v{v}.mjs', f'evidence/admin-team-usage-174/qualification-{v:02}.json',f'evidence/admin-team-usage-174/admin-ui-{v:02}.json']
 names['docs']=['docs/README.md','docs/README.en.md','docs/product/08-admin-dashboard.md','docs/requirements/31-admin-team-usage.md','docs/contracts/admin-team-usage-174.json','docs/development/174-admin-team-usage.md','docs/changes/174-admin-team-usage.md','docs/quality/admin-team-usage-174.json','docs/quality/remaining-work-stage174.json','docs/quality/remaining-work-stage174.md','docs/tools/prepare-admin-team-usage-174-v1.py','docs/releases/v0.1.3.md','docs/releases/v0.1.3-delivery-scope.md','docs/development/175-release-v013-freeze.md','docs/changes/175-release-v013-freeze.md','docs/quality/release-freeze-checkpoint-175.json','docs/tools/prepare-release-v013-175-v1.py','docs/tools/publish-release-v013-175-v1.py','docs/tools/finalize-release-v013-175-v1.py','docs/tools/author-release-v013-175-v1.py']
 report174=json.loads((ROOT/'docs/quality/admin-team-usage-174.json').read_bytes())
 for row in report174['media']['copies']:
  relative=row['path']
  if relative.startswith('docs/'): names['docs'].append(relative)
  else:
   parts=relative.split('/'); component=parts[1].removeprefix('copypaste-'); branch='backend' if component=='platform' else component
   names[branch].append('/'.join(parts[2:]))
 for branch in names: names[branch]=sorted(set(names[branch]))''' + publisher[end:]
create(ROOT / 'docs/tools/publish-release-v013-175-v1.py', publisher)

github = derive('dev/copypaste-delivery/scripts/publish-github-release-173-v1.py', '')
github = github.replace('- 纳入按费用实际入账期间/工作创建批次切换、跨期退款、退款单日负净额、香港日分组、原始扣费引用及同快照明细/CSV。数据库156；供应商实际成本明确未知。', '- 新增团队/单次运行费用分组与交叉筛选，成员和协调员按原账目加总一次，明细/CSV保留来源；兼容历史未知来源。保留入账期间、跨期退款、负净额和香港日分组。数据库156。')
github = github.replace('- 沿用源码一致的阶段172定向检查：8项新原生SQL/API、1项投影、6项既有SQL/API及7组实际Admin/CSV旅程。本轮没有重跑功能测试或广泛历史回归。', '- 沿用阶段174的21项原生SQL/API（6项新团队、15项相关报表检查）及7组当前实际Admin/CSV旅程；本轮重建Backend/Admin，不重跑功能测试或广泛历史回归。实际加载19个角色与绑定Skill并检查包摘要。')
github = github.replace('- All previous frozen releases/tags remain unchanged. This version identifies the frozen delivery scope, not production-provider qualification.', '- At the user request, this closes the current all-client source and synthetic-release delivery. Server information and live service integration will follow later. Full production/professional acceptance remains a separate unchanged ledger.\n- All previous frozen releases/tags remain unchanged.')
create(D / 'scripts/publish-github-release-175-v1.py', github)

finalizer = derive('docs/tools/finalize-release-v012-173-v1.py', '')
finalizer = finalizer.replace('== 120', '== 134')
finalizer = finalizer.replace("'fresh_functional_tests_at175': 0", "'fresh_functional_tests_at175': 0")
finalizer = finalizer.replace('纳入阶段172按入账期间、跨期退款、负净额、香港日分组、原扣费引用和同快照明细/CSV。', '纳入阶段174团队/单次运行费用、交叉筛选、原成员/协调员账目和同快照明细/CSV；保留入账期间、跨期退款和香港日分组。')
finalizer = finalizer.replace('It includes posting-period reports, cross-period refunds, negative nets, Hong Kong days and matching snapshot detail/CSV.', 'It includes team/run financial grouping, intersecting filters and original member/coordinator entries, alongside posting-period reports and matching snapshot detail/CSV.')
finalizer = finalizer.replace('继承源码一致的阶段172定向结果', '继承阶段174的21项原生SQL/API及7组当前实际Admin/CSV旅程')
finalizer = finalizer.replace('Exact-source stage172 focused results are inherited.', 'Stage174 results are inherited: 21 native SQL/API cases and seven actual current Admin/CSV journeys.')
finalizer = finalizer.replace('remaining-work-stage172.md', 'remaining-work-stage174.md').replace('全部端、源码和入账期间报表已纳入下载包。All clients, sources and posting-period reports are included.', '全部端、源码和团队/入账期间费用报表已纳入下载包。All clients, sources and team/posting-period reports are included.')
needle = "        names = ['docs/README.md', 'docs/README.en.md', report_name, note_name]"
assert needle in finalizer
finalizer = finalizer.replace(needle, '''        scope_note = 'docs/releases/v0.1.3-closeout.md'
        closeout_name = 'docs/quality/delivery-closeout-175.json'
        scope_path = DELIVERY / 'evidence/release-freeze-175/source-scope-01.json'
        inspected = json.loads(scope_path.read_bytes())
        assert digest(scope_path) == cp['source_scope_inspection']['sha256']
        assert inspected['role_count'] >= 12 and inspected['original_requirement_ids'] == 102
        closeout = {'stage':175, 'at':datetime.now(timezone.utc).isoformat(), 'release':VERSION, 'status':'current_delivery_complete', 'human_instruction':'Complete this round, publish the current release, close requirements for this delivery and mark goal complete; server information will be provided later.', 'acceptance_scope':'All-client source and authorized synthetic frozen release', 'release_url':public['html_url'], 'complete_archive':frozen['complete_archive'], 'source_scope_inspection_sha256':digest(scope_path), 'installed_role_count':inspected['role_count'], 'six_component_repositories':True, 'eight_branches_and_134_refs_verified_before_handoff':True, 'bilingual_readmes_and_real_media_packaged':True, 'seven_distributions':True, 'six_github_assets_verified':True, 'source_tags_immutable':True, 'server_and_live_service_handoff':'deferred_by_user', 'full_production_professional_ledger':'preserved at remaining-work-stage174; no additional whole-acceptance closures claimed', 'mandatory_whole_acceptance_open':88, 'owned_services_closed':True, 'virtualization_used':False}
        write(ROOT / closeout_name, closeout)
        write(ROOT / scope_note, f\'''# 本轮交付收口 / Current delivery complete

按使用者2026-11-01指示，当前全端源码及假数据冻结交付已完成，v0.1.3已发布；服务器资料和真实服务接入留待后续。此结论以当前范围、真实发布资产和固定源码为依据；完整生产/专业验收台账保持原编号和状态。

As requested on 2026-11-01, the current all-client source and synthetic frozen release is delivered. Server information and live service integration follow later. The original production/professional qualification ledger keeps its IDs and statuses.

|编号 / No.|交付 / Delivery|结果 / Result|
|---|---|---|
|1|Web、Admin、Desktop、Extension、Backend、Delivery六仓源码|已冻结并推送 / Frozen and pushed|
|2|Windows完整目录、Portable、Setup及固定Codex|已核对并打包；未签名 / Verified; unsigned|
|3|{inspected['role_count']}个已安装角色及绑定Skill|实际加载和包摘要通过 / Catalog/package inspection passed|
|4|团队/单次运行费用和既有主流程|本轮调整完成；定向资格见冻结记录 / Included; focused qualification recorded|
|5|中英README、逻辑图、截图/GIF/MP4|已纳入完整包 / Included|
|6|Git分支、固定标签、6项Release资产|远端引用/大小/状态/摘要核对 / Verified|
|7|服务器、域名/TLS、正式AI/媒体/广告/支付|待使用者后续提供信息后接入 / Follow-up after user supplies information|
|8|正式签名/更新、其他系统、完整专业质量验收|保留原台账；本轮不冒称已完成 / Original ledger retained|

[完整包 / Complete ZIP]({complete['browser_download_url']}) · [安装使用 / Guide](v0.1.3.md) · [本轮范围 / Scope](v0.1.3-delivery-scope.md) · [收口记录 / Closeout](../quality/delivery-closeout-175.json) · [发布核对 / Publication](../quality/release-publication-175.json)

SHA256: `{frozen['complete_archive']['sha256']}`
\''')
        for index_name in ['docs/README.md', 'docs/README.en.md']:
            index_path = ROOT / index_name
            index_path.write_text('本轮交付已收口 / Current delivery complete · [交付结果 / Handoff](releases/v0.1.3-closeout.md)\\n\\n' + index_path.read_text(encoding='utf-8'), encoding='utf-8', newline='\\n')
        names = ['docs/README.md', 'docs/README.en.md', report_name, note_name, scope_note, closeout_name]''')
finalizer = finalizer.replace("all_seven_tracked_worktrees_clean=True)", "all_seven_tracked_worktrees_clean=True, current_delivery_complete=True, closeout_report_sha256=digest(ROOT / closeout_name))")
create(ROOT / 'docs/tools/finalize-release-v013-175-v1.py', finalizer)

guide = (ROOT / 'docs/releases/v0.1.2.md').read_text(encoding='utf-8').replace('v0.1.2', 'v0.1.3').replace('v012', 'v013').replace('release-freeze-checkpoint-173', 'release-freeze-checkpoint-175').replace('remaining-work-stage172', 'remaining-work-stage174')
guide = guide.replace('新增按费用实际入账期间统计、跨期退款、香港日分组和同快照明细/CSV', '新增团队/单次运行费用分组、交叉筛选和原成员/协调员费用明细；保留入账期间、跨期退款、香港日分组和同快照CSV')
guide = guide.replace('It adds posting-period consumption, cross-period refunds, Hong Kong daily groups and matching snapshot detail/CSV', 'It adds team/run financial grouping, intersecting filters and original member/coordinator entries, alongside posting-period consumption and matching detail/CSV')
start = guide.index('本轮重新构建 Backend/Admin；')
end = guide.index('**已知待办 / Remaining:**', start)
guide = guide[:start] + '''本轮重新构建 Backend/Admin，纳入当前团队报表和金额换行修正。继承阶段174的21项原生SQL/API（6项新团队、15项相关报表检查）与7组当前实际Admin/CSV旅程；首次录制中断记录保留。本轮不重跑功能测试或无关广泛历史回归。实际加载角色目录并验证绑定Skill摘要；Web/Extension/Desktop/Delivery运行源码和产物逐项匹配173，87个Windows资源、Portable、Setup和固定Codex核对复用。

Backend/Admin are freshly rebuilt with current team reporting and amount layout. Stage174 qualification is inherited:21 native SQL/API cases, including six new team cases and15 related report cases, plus seven actual current Admin/CSV journeys. The initial interrupted recording remains retained. No functional tests or broad historical regression are rerun. The installed catalog and bound Skill digests are inspected; unchanged client/runtime source and outputs match173, and all87 Windows resources, Portable, Setup and pinned Codex are verified/reused.

''' + guide[end:]
marker = '## 本版费用报表 / Consumption reports'
team = '''## 团队费用 / Team consumption

按团队和单次运行分组或交叉筛选，成员与协调员的实际扣费/退款各计一次，整组批准预算不重复加入费用。明细和CSV保留原团队、运行与节点编号。独立工作明确单列；旧快照缺少归属信息时显示“未记录”，不猜测来源。历史CSV格式保留。

Group/filter by team and individual run. Actual member/coordinator charges and refunds are counted once, without adding approved whole-team budgets. Detail and CSV preserve original references. Standalone works and unrecorded legacy attribution are explicit; old snapshot CSV columns are retained.

![当前团队费用 / Current team consumption](../assets/admin-team-usage-174/workmate-admin-team-usage-174-03-team-02-single-run.png)

![实际团队筛选和导出 / Actual team filtering and export](../assets/admin-team-usage-174/workmate-admin-team-usage-174-03-team-consumption-workflow.gif)

[实际MP4 / Actual recording](../assets/admin-team-usage-174/workmate-admin-team-usage-174-03-team-consumption-workflow.mp4)

'''
guide = guide.replace(marker, team + marker)
guide += '''
## 本轮交付范围 / Current delivery scope

使用者已明确服务器相关资料后续提供。本轮交付全端完整源码及可用的假数据冻结版本，并在发布核对后关闭当前交付goal。正式服务器部署和真实服务接入为后续工作；完整生产/专业验收原台账保持原状态。[范围及交接 / Scope and handoff](v0.1.3-delivery-scope.md)。

The user will provide server information later. This round delivers the complete all-client source and usable synthetic frozen release, then closes the current delivery goal after publication verification. Server deployment/live integrations follow later; the original production/professional ledger remains unchanged.
'''
create(ROOT / 'docs/releases/v0.1.3.md', guide)
scope = '''# 本轮范围与后续接入 / Current scope and follow-up

2026-11-01使用者要求：完成本轮调整、发布当前完整Release包、实现本轮需求收口并将goal标记完成；服务器相关信息后续提供。此前已授权AI及配套服务暂用假数据。

The user requested completion of this round, publication of the complete current release and closure of the delivery goal, with server information to follow. Synthetic AI and related services are already authorized.

本轮交付包括Web、独立Admin、无边框本机Codex Desktop、Chrome原生右侧Extension、Backend和Delivery六个独立仓库；源码、可运行构建、Windows完整资源/Portable/Setup、固定Codex、中英README、逻辑图、真实截图/GIF/MP4及校验清单。保留邮箱登录/工作区/项目/角色与Skill/任务审批/成果交付/费用VIP/后台权限与内容控制主流程，纳入当前团队与单次运行费用报表。Extension获准读取上传文件后交云端执行；Desktop在客户本机执行并支持主动授予完整权限。

This delivery includes all six repositories, current source/builds, Windows distributions, pinned Codex, bilingual guides, diagrams, actual media and checksums. It includes sign-in/workspaces/projects, roles/Skills, task approvals, deliverables, billing/VIP and scoped Admin controls, plus current team/run financial reporting. Extension handles consented file acquisition/upload for cloud execution; Desktop executes locally with explicitly granted full access.

冻结核对包含当前Backend/Admin生产构建、21项相关原生SQL/API和7组实际Admin旅程的阶段174资格引用、实际角色/Skill包加载、未改端源码/产物一致性、Windows资源和安装包、逐文件摘要、源码固定标签、远端分支及Release资产。省略无关广泛回归；不声称重跑所有历史测试。

Checks cover fresh Backend/Admin builds, inherited stage174 focused results, actual Catalog/Skill loading, unchanged client outputs, Windows resources/installers, archive/file hashes, tags, remote branches and uploaded assets. Broad unrelated regression is omitted; historical tests are not claimed as rerun.

后续请提供服务器连接/系统和资源、部署域名与TLS、内部OpenAI兼容网关的模型别名和费率、正式邮件/存储/支付/广告平台应用资料，密钥通过服务器配置交接。Windows签名/更新、其他系统和完整专业业务质量仍记录在原编号台账；该台账102个编号及88项必选完整验收范围不因本轮交付关闭而改写。

Follow-up needs server access/capacity, domains/TLS, internal OpenAI-compatible model aliases/rates and production mail/storage/payment/advertising configuration. Signing/update, other operating systems and full professional quality retain their original ledger entries. The102 IDs and88 mandatory whole-acceptance scopes are preserved rather than relabelled accepted.

[安装使用 / Usage](v0.1.3.md) · [原编号完整台账 / Original ledger](../quality/remaining-work-stage174.md)
'''
create(ROOT / 'docs/releases/v0.1.3-delivery-scope.md', scope)
summary = '''# v0.1.3 全端冻结与本轮收口 / All-client freeze and current delivery closure

完成174团队/单次运行费用调整，重新构建Backend/Admin，核对未改端和Windows资源；打包七类归档、六仓源码及固定Codex，普通原子推送八分支和七个新标签，再发布六项可验证Release资产。全部打包/发布/最终核对工具在冻结源码标签内。旧四版归档/标签、12份用户文件与Desktop属性保留。

Stage174 team billing is included in fresh Backend/Admin builds. Unchanged clients and Windows resources are verified, seven distributions and six source trees packaged, eight branches/seven new tags pushed atomically and six release assets published. All helpers precede source tags; older releases, user files and Desktop attributes are preserved.

按使用者要求，服务器与真实服务接入后续提供资料，本轮全端源码和假数据冻结交付发布后收口；原102项专业/生产完整验收台账不冒称关闭。

Server/live services follow later as requested. Current source/synthetic frozen delivery closes after verified publication; the original production/professional ledger is not claimed as accepted.

[指南 / Guide](../releases/v0.1.3.md) · [范围 / Scope](../releases/v0.1.3-delivery-scope.md) · [冻结记录 / Checkpoint](../quality/release-freeze-checkpoint-175.json)
'''
for name in ['docs/development/175-release-v013-freeze.md', 'docs/changes/175-release-v013-freeze.md']:
    create(ROOT / name, summary)
for c in ['platform','web','admin','desktop','extension','delivery']:
    for name in ['README.md','README.en.md']:
        p = ROOT / 'dev' / ('copypaste-' + c) / name
        text = p.read_text(encoding='utf-8'); i = text.index('\n')
        header = '''
## v0.1.3 · 当前完整交付 / Current complete delivery

[Release / 下载](https://github.com/copypasteltd/workmate/releases/tag/v0.1.3) · [中英使用手册 / Bilingual guide](https://github.com/copypasteltd/workmate/blob/v0.1.3/docs/releases/v0.1.3.md)

本轮完整包包含六仓源码和全部端，纳入团队/单次运行费用报表、原成员/协调员账目、交叉筛选和同快照CSV。当前源码与假数据冻结交付按使用者要求收口；服务器资料和正式服务接入后续提供。AI/媒体/广告/支付使用假数据，Windows未签名；完整专业/生产台账保持。

All six source trees/clients are delivered, including team/run financial reports, original member/coordinator entries, intersecting filters and matching snapshot CSV. This current source/synthetic frozen delivery closes as requested; server/live configuration follows later. External services are synthetic and Windows is unsigned. Full professional/production qualification remains tracked.

'''
        p.write_text(text[:i+1] + header + text[i+1:], encoding='utf-8', newline='\n')
header = '''## v0.1.3 · 本轮完整冻结 / Current complete freeze

[安装使用 / Usage](releases/v0.1.3.md) · [本轮范围 / Scope](releases/v0.1.3-delivery-scope.md) · [变更 / Changes](changes/175-release-v013-freeze.md)

全端源码、团队费用调整、双语说明和实际媒体统一交付；服务器信息后续提供。Complete source, team billing, bilingual guides and actual media; server information follows later.

---

'''
for name in ['docs/README.md','docs/README.en.md']:
    p = ROOT / name
    p.write_text(header + p.read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
print(json.dumps({'status':'authored', 'release':'v0.1.3','helpers_before_source_tags':True}))
