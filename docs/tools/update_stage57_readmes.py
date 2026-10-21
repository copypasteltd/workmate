"""Publish bilingual instructions only after unchanged native runtime evidence passes."""
import argparse
from refresh_stage52_capabilities import ROOT, PLATFORM, DELIVERY, read, git


def update(repo, filename, commit, content):
    path = repo / filename
    base = git(repo, 'show', commit + ':' + filename).decode().replace('\r\n','\n')
    title, body = base.split('\n\n',1)
    result = title + '\n\n' + content.strip() + '\n\n' + body
    assert path.read_text(encoding='utf-8') in (base,result), 'Unexpected documentation edits'
    path.write_text(result,encoding='utf-8',newline='\n')


def main():
    p = argparse.ArgumentParser()
    for name in ('focused','full','static'): p.add_argument('--'+name,required=True)
    a = p.parse_args()
    focused = read(DELIVERY / f'evidence/provider-budget-candidate-{a.focused}.json')
    full = read(DELIVERY / f'evidence/provider-budget-regression-{a.full}.json')
    static = read(DELIVERY / f'evidence/provider-budget-static-{a.static}.json')
    upgrade = read(DELIVERY / 'evidence/provider-budget-migrations.json')
    assert all(x['status']=='passed' for x in (focused,full,static,upgrade))
    assert focused['source_files']==full['source_files']==static['source_files']
    f,n,s = focused['counts']['pass'],full['counts']['pass'],len(full['source_files'])
    tables = {len(x['original']) for x in upgrade['databases']}; assert len(tables)==1
    tables = next(iter(tables))
    diagram = '''```mermaid
flowchart LR
  Context[Actual normalized context] --> Count[Company input count / platform funds]
  Count --> Proof[One generation ID / digest / identity]
  Proof --> Allocate[Original task budget / frozen prices / output bound]
  Image[Image tools] --> Allocate
  Admin[Admin run / daily platform budget] --> Allocate
  Allocate --> Dispatch[Reauthorize / company API]
  Dispatch --> Facts[Persist actual usage / exact numerator]
  Facts --> Settle[One aggregate customer settlement]
  Dispatch --> Unknown[Unknown / retain commitment]
  Facts --> Violation[Overrun / preserve spend / reconcile]
```'''
    zh = f'''## 逐调用预算（阶段 57）

文本生成先通过公司内部 `/v1/responses/input_tokens` 计数完整实际上下文，以冻结费率和明确输出上限原子分配预算；图片与文本共用任务原预留。计数费用须明确验证及定价，由平台承担，缺少计数或价格时禁止猜测后继续生成。每个证明绑定原操作、摘要、主体和能力，只能使用一次。Admin 能力验证具有单次与每日平台预算，不使用客户钱包。

最终结算聚合持久调用的精确费用分子，统一取整并只入账一次。未知结果保留承诺，用量不符或超限先存真实消费再进入核账，不扩大客户预算。仅报告模拟文本计数的注入测试适配器，不能给实际图片调用添加未经供应商记录的文本费用。

专项 **{f}/{f}** 包含于全量 **{n}/{n}**，{s} 份来源前后一致，保留阶段 56 全部 546 项命名测试；类型检查与实际构建通过。两套现有原生数据库完成 066→067，各保留 {tables} 张原公共表全部行摘要、SQL001–066 和历史校验值。新增八表强制 RLS，仅为明确未执行的任务补建原预算边界，未补造历史消费或已验证价格。SQL067 自此不可改写。

Codex、原生 PostgreSQL 和费用事务实际执行，模型/媒体使用获准假数据。本阶段没有打开浏览器或客户端；既有截图和安装包保留其原来源范围。完整 Admin 策略发布、请求目录、按证据核对费用/容量及原始 102 项综合验收继续跟踪。以下旧章节按各自阶段理解。

{diagram}'''
    en = f'''## Per-request budgets (stage 57)

Text generation counts its complete normalized context through the company `/v1/responses/input_tokens` endpoint, then atomically allocates frozen input prices and an explicit output bound against the task's original reservation. Images share that same budget. Counting needs an explicitly verified price and uses platform funds. Missing counts or prices block generation. Each proof is bound to one operation, digest, original identity and capability. Admin verification has independent run and daily platform budgets and never uses customer wallets.

Settlement aggregates durable exact cost numerators and rounds once for one ledger charge. Unknown outcomes retain commitments. Input mismatches and overruns persist actual spend before reconciliation and cannot enlarge the customer budget. Injected adapters reporting synthetic text counters cannot add unobserved text costs to real image operations.

Validation passed **{f}/{f} focused checks within {n}/{n} full tests**, with {s} unchanged source files and all 546 stage 56 named tests retained. Type checking and the actual build passed. Both existing native databases upgraded from 066 to 067, preserving every row of {tables} original public tables, SQL001–066 and their historical checksums. Eight new tables force RLS. Only definitely unexecuted tasks receive original budget bounds; no historical spend or verified prices were fabricated. SQL067 is now immutable.

Codex, PostgreSQL and accounting transactions are real; model/media responses are authorized simulations. No browser or native client was opened. Previous screenshots and packages retain their original source scope. Complete Admin policy publication, request directory, evidence-based cost/capacity reconciliation and all original product acceptance remain open.

{diagram}'''
    update(PLATFORM,'README.md','0ed17e7',zh)
    update(PLATFORM,'README.en.md','0ed17e7',en)
    links = f'''[Focused run](evidence/provider-budget-candidate-{a.focused}.json) · [Full regression](evidence/provider-budget-regression-{a.full}.json) · [Build and types](evidence/provider-budget-static-{a.static}.json) · [Local upgrade](evidence/provider-budget-upgrade.json) · [Original-row preservation](evidence/provider-budget-migrations.json)'''
    update(DELIVERY,'README.md','cffc027',zh+'\n\n'+links+'\n\n每次运行使用未使用的两位编号：`node scripts/run-provider-budget-checks.mjs NEXT_ID`；全量加 `--full`，专项核心加 `--core`。失败、源码前像及旧成功报告均保留。旧成功不代表当前源码；本机升级已有一次性前态守卫，升级后不可再次执行。')
    update(DELIVERY,'README.en.md','cffc027',en+'\n\n'+links+'\n\nUse a fresh two-digit ID with `node scripts/run-provider-budget-checks.mjs NEXT_ID`; add `--full` for all tests or `--core` for core cases. Failures, source preimages and earlier passing reports are retained. Earlier success does not qualify current bytes. The one-time local upgrade guard cannot be rerun after migration.')
    rootfile = ROOT / 'docs/README.md'
    base = git(ROOT,'show','3dc4d4c:docs/README.md').decode().replace('\r\n','\n')
    title,body = base.split('\n\n',1)
    paragraph = f'阶段 57 的[逐调用预算](technical/57-per-request-budget-enforcement.md)通过专项 **{f}/{f}** 和全量 **{n}/{n}**（专项包含于全量），{s} 份平台来源不变，保留原 546 项测试；类型检查与实际构建通过。文本与图片共用原预留，内部实际计数独立由平台付费，Admin 验证具有运行及每日预算；超额与未知保留实际费用和承诺。两库 066→067 各保留 {tables} 张原公共表全部行摘要与 SQL001–066，未补造历史消费。[核查回执](quality/provider-budget-checkpoint.json)保留失败及源码前像。完整后台策略控制与原始 102 项综合验收继续跟踪；之前 UI/原生报告保留原来源范围。'
    lines = body.splitlines()
    index = next(i for i,line in enumerate(lines) if line.startswith('| 技术 |') and '56-durable' in line)
    lines.insert(index,'| 技术 | [57 逐调用预算与平台费用](technical/57-per-request-budget-enforcement.md) | 原预算分配、实际输入计数、平台验证预算及结算事实 |')
    result = title+'\n\n'+paragraph+'\n\n'+'\n'.join(lines)+'\n'
    assert rootfile.read_text(encoding='utf-8') in (base,result)
    rootfile.write_text(result,encoding='utf-8',newline='\n')
    print(f'Updated bilingual Platform/Delivery READMEs and docs index: {f}/{n} tests, {s} sources')


if __name__ == '__main__': main()
