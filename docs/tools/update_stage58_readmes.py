"""Publish bilingual provider Admin instructions after actual execution admission."""
import argparse
from refresh_stage52_capabilities import ROOT, PLATFORM, DELIVERY, read, git

ADMIN=ROOT/'dev/copypaste-admin'


def update(repo, name, commit, content):
    path=repo/name
    base=git(repo,'show',commit+':'+name).decode().replace('\r\n','\n')
    title,body=base.split('\n\n',1)
    result=title+'\n\n'+content.strip()+'\n\n'+body
    assert path.read_text(encoding='utf-8') in (base,result), 'Unexpected README edits'
    path.write_text(result,encoding='utf-8',newline='\n')


def main():
    p=argparse.ArgumentParser()
    for n in ('focused','full','static','ui'):p.add_argument('--'+n,required=True)
    a=p.parse_args()
    f=read(DELIVERY/f'evidence/provider-admin-candidate-{a.focused}.json')
    full=read(DELIVERY/f'evidence/provider-admin-regression-{a.full}.json')
    static=read(DELIVERY/f'evidence/provider-admin-static-{a.static}.json')
    ui=read(DELIVERY/f'evidence/provider-admin-ui-{a.ui}.json')
    upgrade=read(DELIVERY/'evidence/provider-admin-migrations.json')
    assert all(x['status']=='passed' for x in (f,full,static,ui,upgrade))
    assert f['source_files']==full['source_files']==static['source_files']
    n,m,files,checks=f['counts']['pass'],full['counts']['pass'],len(full['source_files']),ui['counts']['checks']
    diagram='''```mermaid
flowchart LR
  Original[Original unknown observation] --> Scope[Scoped request directory]
  Scope --> Evidence[Immutable human source record]
  Evidence --> Preview[Current facts / no business effect]
  Preview --> Review[Independent Admin / reauthorize]
  Review --> Cost[Append confirmed cost]
  Review --> Capacity[Separate termination confirmation]
  Cost --> Task[Original task / aggregate once]
  Task --> Ledger[One debit / failed business result]
```'''
    zh=f'''## 调用管理后台（阶段 58）

Admin 的“调用管理”提供策略草稿与独立发布、逐请求筛选和费用字段授权、不可变人工证据及下载、费用确认、容量释放和原任务结算。费用、容量及客户扣费分别执行，保留原始未知观测；实际费率从任务冻结版本推导，不接受客户端填写结算额。平台输入计数费用不转入客户钱包。现有任意金额核账不能绕过逐请求记录。

专项 **{n}/{n}** 包含于完整 **{m}/{m}**，保留阶段 57 全部 559 个命名测试；{files} 份平台来源与实际类型检查、构建一致。实际构建版 Admin 浏览器通过 **{checks} 项流程、29 份严格响应样本**，覆盖真实邮箱/TOTP 登录、另一管理员审批、独立费用/容量、一次结算、权限隐藏、中英文、深色和窄屏。模拟 AI 来源明确标识；所有自建浏览器及服务均已关闭。

两套现有原生数据库完成 067→068，各保留 144 张原公共表完整行摘要、SQL001–067 与历史校验值。七张新表强制 RLS，不自动新增既有管理员权限、政策发布、证据或费用。完整原始 102 项、TC/NFR/G01–G10、真实模型资格和发行验收继续跟踪；以下旧章节保留各自历史范围。

{diagram}'''
    en=f'''## Provider Admin controls (stage 58)

The Admin Provider controls page supports immutable policy drafts and independent publication, scoped request filters and extra cost-field authority, downloadable immutable human evidence, separate cost and capacity confirmation, and original task settlement. Original unknown observations remain intact. Settlement derives frozen prices instead of accepting a client amount, excludes platform-funded input counting and creates one customer debit. Legacy arbitrary reconciliation cannot bypass durable provider records.

Validation passed **{n}/{n} focused checks within {m}/{m} full tests**, retaining all 559 stage 57 named tests. The same {files} Platform sources passed type checking and the actual build. The built Admin passed **{checks} real browser journeys and 29 strict response samples**, including email/TOTP sign-in, a second reviewer, separate cost/capacity facts, one settlement, scoped redaction, bilingual dark and narrow layouts. AI observations are explicitly simulated. All owned browsers and services were closed.

Both existing native databases upgraded from 067 to 068 while preserving every row digest in 144 original public tables, SQL001–067 and historical checksums. Seven new tables force RLS without automatically granting existing administrators new rights or fabricating publications, evidence or charges. All original 102 requirements, TC/NFR/G01–G10, live-role qualification and distribution acceptance remain open; older sections retain their historical scope.

{diagram}'''
    operator_zh='''### 既有管理员显式启用

在 Platform 仓库使用受控运维身份，先预览指定的已启用且完成 MFA 的全局超级管理员：

```powershell
node --env-file=.env --import tsx scripts/admin-enable-provider-control.ts --principal PRINCIPAL_UUID --reason "指定调用管理负责人"
node --env-file=.env --import tsx scripts/admin-enable-provider-control.ts --principal PRINCIPAL_UUID --reason "指定调用管理负责人" --apply --expected-hash PREVIEW_SHA256
```

第二条必须使用第一次的完整摘要及相同原因；目标权限或数据库变化时重新预览。启用会撤销旧会话，管理员须重新完成邮箱/TOTP 登录。至少分别启用两位管理员才能执行独立审批；该命令不会自行选择或扩大既有角色。不要将 `.env` 或摘要前后的身份配置提交到仓库。'''
    operator_en='''### Explicit activation for an existing administrator

From the Platform repository, a trusted operator previews one active, MFA-enrolled permanent global super administrator:

```powershell
node --env-file=.env --import tsx scripts/admin-enable-provider-control.ts --principal PRINCIPAL_UUID --reason "Assign provider control owner"
node --env-file=.env --import tsx scripts/admin-enable-provider-control.ts --principal PRINCIPAL_UUID --reason "Assign provider control owner" --apply --expected-hash PREVIEW_SHA256
```

Use the exact preview hash and unchanged reason. Preview again if the database or target authority changes. Activation revokes old sessions and requires fresh email/TOTP sign-in. Explicitly activate two separate administrators for independent review. The command never selects a principal or expands existing roles automatically. Keep `.env` and private identity configuration outside Git.'''
    update(PLATFORM,'README.md','b32441b',zh+'\n\n'+operator_zh)
    update(PLATFORM,'README.en.md','b32441b',en+'\n\n'+operator_en)
    screenshots=f'''![Provider request / simulated evidence](assets/screenshots/provider-admin-{a.ui}-unknown-request-en.png)

![Independent provider policy review](assets/screenshots/provider-admin-{a.ui}-independent-review-1-en.png)

![Chinese dark narrow request detail](assets/screenshots/provider-admin-{a.ui}-detail-zh-mobile.png)'''
    update(ADMIN,'README.md','b08a1fa',zh+'\n\n'+operator_zh+'\n\n### 实际页面截图（未编辑、明确模拟数据）\n\n'+screenshots)
    update(ADMIN,'README.en.md','b08a1fa',en+'\n\n'+operator_en+'\n\n### Actual unedited pages with labelled simulated data\n\n'+screenshots)
    links=f'''[Focused](evidence/provider-admin-candidate-{a.focused}.json) · [Full regression](evidence/provider-admin-regression-{a.full}.json) · [Build and types](evidence/provider-admin-static-{a.static}.json) · [Actual Admin browser](evidence/provider-admin-ui-{a.ui}.json) · [Native upgrade](evidence/provider-admin-upgrade.json) · [Original-row preservation](evidence/provider-admin-migrations.json)'''
    commands='''```powershell
node scripts/run-provider-admin-checks.mjs NEXT_ID
node scripts/run-provider-admin-checks.mjs NEXT_ID --full
node scripts/run-provider-admin-static-checks.mjs NEXT_ID
$env:CHROME_BIN='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
node scripts/run-provider-admin-ui.mjs NEXT_ID
```'''
    update(DELIVERY,'README.md','b2dc230',zh+'\n\n'+links+'\n\n每项使用全新两位编号，保留失败和执行源码前像。仅本地原生 PostgreSQL；不得使用 Docker/WSL。既有数据库的一次升级已完成，不可重跑前态守卫。\n\n'+commands)
    update(DELIVERY,'README.en.md','b2dc230',en+'\n\n'+links+'\n\nUse a fresh two-digit ID per run; retain failures and exact executed source preimages. Use native PostgreSQL only, with no Docker/WSL. The existing-database upgrade has completed; its before-state guard cannot be rerun.\n\n'+commands)
    path=ROOT/'docs/README.md'
    base=git(ROOT,'show','5888ddc:docs/README.md').decode().replace('\r\n','\n')
    title,body=base.split('\n\n',1)
    intro=f'阶段 58 的[调用管理与独立核对后台](technical/58-provider-admin-control-and-reconciliation.md)通过专项 **{n}/{n}**、全量 **{m}/{m}**（保留全部原 559 项测试）、真实构建版 Admin **{checks} 项流程与 29 份严格响应样本**。费用确认、容量释放和原任务唯一结算分别受控；策略、证据、范围与近期 MFA 重新检查。两库 067→068 各保留 144 张原表全部行摘要及 SQL001–067，新七表强制 RLS，不自动授予已有管理员新权限。[核查回执](quality/provider-admin-checkpoint.json)绑定源码与失败记录；原始 102 项、TC/NFR/G01–G10 与实网资格范围不变。'
    lines=body.splitlines()
    i=next(i for i,line in enumerate(lines) if line.startswith('| 技术 |') and '57-per-request' in line)
    lines.insert(i,'| 技术 | [58 调用管理与独立核对](technical/58-provider-admin-control-and-reconciliation.md) | 策略发布、费用与容量独立审批及原任务结算 |')
    result=title+'\n\n'+intro+'\n\n'+'\n'.join(lines)+'\n'
    assert path.read_text(encoding='utf-8') in (base,result)
    path.write_text(result,encoding='utf-8',newline='\n')
    delivery_doc=ROOT/'docs/DELIVERY.md'
    original=git(ROOT,'show','5888ddc:docs/DELIVERY.md').decode().replace('\r\n','\n')
    title,body=original.split('\n\n',1)
    body=body.replace('当前阶段 54 的','当前最新客户端预览（阶段 54）的',1)
    body=body.replace('独立 MFA、16 页后台、用户/消耗/费用/VIP、68 权限与审计','独立 MFA、用户/消耗/费用/VIP、调用管理、分域权限与审计')
    current=f'当前后端与后台源码已完成[阶段 58 调用管理](technical/58-provider-admin-control-and-reconciliation.md)：专项 **{n}/{n}** 包含于全量 **{m}/{m}**，保留原全部 559 项命名测试；实际构建版 Admin **{checks} 项流程及 29 份严格响应样本**通过。策略发布、人工费用来源、容量释放和原任务结算分别审计并独立审批；SQL068 原生升级保留两库各 144 张原表全部行摘要，既有管理员权限不自动扩大。中英 README 含启用命令、逻辑图和实际截图，见[完整核查回执](quality/provider-admin-checkpoint.json)。原始 102 项与 TC/NFR/G01–G10 的范围保持不变；下方旧阶段数字保留各自来源。'
    current+='\n\n最新无边框 Desktop 与原生 Side Panel 的源码、运行目录及 Setup/Portable/ZIP 再次[逐字节复核通过](quality/native-clients-recheck-20261021-02.json)，与既有 11/11 原生 UI 验收一致。此次只读核对没有新建浏览器或安装应用。'
    result=title+'\n\n'+current+'\n\n'+body
    assert delivery_doc.read_text(encoding='utf-8') in (original,result)
    delivery_doc.write_text(result,encoding='utf-8',newline='\n')
    technical=ROOT/'docs/technical/58-provider-admin-control-and-reconciliation.md'
    text=technical.read_text(encoding='utf-8')
    old=next(line for line in text.splitlines() if line.startswith('状态：'))
    status=f'状态：本阶段代码、实际后台页面与本地增量升级已验证。专项 {n}/{n} 包含于完整回归 {m}/{m}，保留原全部 559 项命名测试；最终同一份 {files} 文件平台来源通过类型检查及构建。实际构建版 Admin {checks} 项流程、29 份严格响应样本通过。原始 102 项、全部 TC/NFR/G01–G10 与完整产品验收范围不变。两套原生数据库升级各保留 144 张原公共表完整行摘要；SQL001–068 现已不可改写，阶段 58 仅使用增量 068。'
    text=text.replace(old,status,1)
    text=text.replace('历史 559/559 只证明阶段 57 源码。本阶段须保留全部命名测试并使用新编号运行，源码变更前保存执行前像；当前不能据设计文本宣称完成。',f'历史 559/559 保留阶段 57 原来源。本阶段最终专项 03 的 {n}/{n} 与全量 01 的 {m}/{m} 绑定同一份当前平台来源；原命名测试全部保留。真实构建版 Admin 08 记录 {checks} 项检查、29 份严格响应和 11 张未编辑截图；失败、执行前像与实际夹具回收结果均保留。详见[本阶段完整回执](../quality/provider-admin-checkpoint.json)。模拟数据、人工证据与真实供应商资格分别标识。')
    technical.write_text(text,encoding='utf-8',newline='\n')
    print(f'Updated Platform/Admin/Delivery bilingual READMEs and docs index: {n}/{m} tests, {checks} actual browser checks')


if __name__=='__main__':main()
