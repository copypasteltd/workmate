"""Update bilingual delivery notes using successful, byte-bound stage 56 receipts."""
from pathlib import Path
from refresh_stage52_capabilities import ROOT, PLATFORM, DELIVERY, git, read


def update(repo, name, commit, section):
    path = repo / name
    base = git(repo, 'show', commit + ':' + name).decode().replace('\r\n', '\n')
    title, body = base.split('\n\n', 1)
    content = title + '\n\n' + section.strip() + '\n\n' + body
    assert path.read_text(encoding='utf-8') in (base, content), 'Unexpected Markdown edits: ' + str(path)
    path.write_text(content, encoding='utf-8', newline='\n')


def main():
    focused = read(DELIVERY / 'evidence/provider-control-candidate-03.json')
    full = read(DELIVERY / 'evidence/provider-control-regression-01.json')
    upgrade = read(DELIVERY / 'evidence/provider-control-migrations.json')
    static = read(DELIVERY / 'evidence/provider-control-static-01.json')
    assert all(item['status'] == 'passed' for item in (focused, full, upgrade, static))
    assert focused['source_files'] == full['source_files'] == static['source_files']
    assert focused['counts']['fail'] == full['counts']['fail'] == 0
    focused_count, full_count = focused['counts']['pass'], full['counts']['pass']
    sources = len(full['source_files'])
    preserved = {len(item['original']) for item in upgrade['databases']}
    assert len(preserved) == 1
    tables = next(iter(preserved))
    diagram = '''```mermaid
flowchart LR
  Codex[Codex scoped credential] --> Current[Current user / capability / lease]
  Media[Image tools] --> Current
  Admin[Admin verification / MFA] --> Current
  Current --> Admit[PostgreSQL shared admission / policy]
  Admit --> Dispatch[Reauthorize / dispatch intent]
  Dispatch --> Internal[Company internal API]
  Internal --> Facts[Validate termination / exact usage]
  Internal --> Unknown[Unknown / retain capacity]
  Facts --> Handoff[Persist before next Codex response]
```'''
    update(PLATFORM, 'README.md', 'c5b3f75', f'''## 持久供应商请求（阶段 56）

真实 Worker 的文本、图片及后台验证共用 PostgreSQL 准入、跨进程并发/速率限额和发出前重新鉴权。不可变请求归属、策略与事件固定原任务、能力及费率；未知结果和进程丢失继续占容量，不自动重放。合法终止的用量事务完成后才把有界终止帧交给 Codex，避免下一轮在落盘期间误撞“忙碌”限制。精确费用分子供聚合后统一取整，逐请求事实不会再次扣账。

专项 **{focused_count}/{focused_count}** 包含于全量 **{full_count}/{full_count}**，{sources} 份来源前后一致，保留阶段 55 全部 531 项命名测试；类型检查及实际构建通过。两套现有原生数据库完成 065→066，各保留 {tables} 张原公共表全部行摘要与 SQL001–065 字节和历史校验值，未补造历史请求。SQL066 已进入不可改写的迁移历史。

Codex 与原生 PostgreSQL 实际执行，模型及媒体使用获准假数据。本轮没有打开浏览器或客户端；以前截图和原生包保留其原来源范围。逐调用预算、后台完整策略发布/核对和原始综合验收继续跟踪；以下旧章节仅适用于其时源码。

{diagram}''')
    update(PLATFORM, 'README.en.md', 'c5b3f75', f'''## Durable provider requests (stage 56)

Worker text, image tools and Admin verification share PostgreSQL admission, concurrency and rolling-minute limits. Immutable request identity, policy versions and events preserve the original task, capability and rates. Current authority is checked again before dispatch. Unknown outcomes and lost originators retain capacity and are never automatically replayed. Bounded terminal frames reach Codex only after validated usage commits, so its next response cannot race the preceding persistence step. Exact cost numerators support aggregate rounding; request facts do not charge the ledger again.

Validation passed **{focused_count}/{focused_count} focused checks within {full_count}/{full_count} full tests**, with {sources} unchanged source files and all 531 stage 55 named tests retained. Type checking and the actual build passed. Both existing native databases upgraded from 065 to 066, preserving all rows of {tables} original public tables, SQL001–065 bytes and historical checksums. No historical provider requests were fabricated. Migration 066 is now immutable.

Codex and PostgreSQL are real; model/media responses are authorized simulations. No browser or native client was opened in this stage. Earlier screenshots and packages retain their original source scope. Per-call budget allocation, complete Admin policy/reconciliation controls and original whole-product acceptance remain open.

{diagram}''')
    evidence = '''[Focused run](evidence/provider-control-candidate-03.json) · [Full regression](evidence/provider-control-regression-01.json) · [Build and types](evidence/provider-control-static-01.json) · [Local upgrade](evidence/provider-control-upgrade.json) · [Original-row preservation](evidence/provider-control-migrations.json)'''
    commands = '''```powershell
node scripts/run-provider-control-checks.mjs NEXT_ID --core
node scripts/run-provider-control-checks.mjs NEXT_ID
node scripts/run-provider-control-checks.mjs NEXT_ID --full
```'''
    update(DELIVERY, 'README.md', '9c507a1', f'''## 持久供应商请求（阶段 56）

专项 03 通过 **{focused_count}/{focused_count}**，完整回归 01 通过 **{full_count}/{full_count}**；专项包含于全量，{sources} 份来源前后一致，保留全部原 531 项命名测试。类型检查与实际构建通过。原生 065→066 升级在两库各保留 {tables} 张原公共表的全部行摘要、SQL001–065 和旧校验值；新增四表强制 RLS，未补造历史请求或用量。

{evidence}

真实多 Node 进程、Worker、后台验证和 Codex 路径覆盖共享限额、撤权零请求、未知占槽、孤立执行恢复、精确费用及终止帧落盘交接。模型和媒体使用假数据。首次 SQL 语法错误、首次交接回归失败、编译辅助写法失败及各次源码前像均保留，较早通过报告不代表当前源码。实际夹具回收和自建数据库关闭均通过，本轮没有打开浏览器或客户端。

{commands}

编号须为未使用的两位数字，不能覆盖报告。本机升级已有一次性前态守卫，升级后不再执行；SQL066 不再编辑。原始 TAP 和数据库日志保留工具输出的空白，其他源码/文档/脚本仍执行空白检查。逐调用预算、完整后台策略控制及原始综合验收继续跟踪。''')
    update(DELIVERY, 'README.en.md', '9c507a1', f'''## Durable provider requests (stage 56)

Focused run 03 passed **{focused_count}/{focused_count}**, included in **{full_count}/{full_count} full tests**. All {sources} source files remained unchanged, and all 531 earlier named tests remain present. Type checking and the actual build passed. Both native databases upgraded from 065 to 066, preserving every row of {tables} original public tables, SQL001–065 bytes and historical checksums. Four new tables force RLS; no historical request or usage facts were fabricated.

{evidence}

Real Node workers, Codex and PostgreSQL exercise shared limits, revoked authority, unknown capacity, orphan recovery, exact cost facts and durable terminal-frame handoff. Model/media responses are simulated. Initial SQL, handoff and compilation failures retain their raw diagnostics and exact source preimages. Actual fixture reclamation and owned database shutdown passed. No browser or native client was opened; earlier UI evidence retains its original scope.

{commands}

Use a fresh two-digit ID and never overwrite evidence. The one-time local upgrade guard now refuses another pre-upgrade capture; migration 066 is immutable. Raw TAP/database logs retain tool-emitted whitespace, while code, documentation and scripts still pass whitespace checks. Per-call budget allocation, complete Admin policy controls and original product acceptance remain open.''')
    base = git(ROOT, 'show', '0389895:docs/README.md').decode().replace('\r\n', '\n')
    title, body = base.split('\n\n', 1)
    top = f'''阶段 56 的 [持久请求与共享限额](technical/56-durable-provider-request-control.md) 通过专项 **{focused_count}/{focused_count}** 和全量 **{full_count}/{full_count}**（专项包含于全量），{sources} 份来源前后一致，保留原 531 项命名测试；类型检查和构建通过。跨进程准入、逐次用量、未知容量、孤立执行恢复及终止帧落盘交接已覆盖。两库增量升级各保留 {tables} 张原公共表完整行摘要及 SQL001–065，未补造历史请求；066 自此不可改写。[核查回执](quality/provider-control-checkpoint.json)保留全部失败和源码前像。本轮没有打开浏览器或客户端；逐调用预算、完整后台策略控制及原始 102 项综合验收继续跟踪。'''
    lines = body.splitlines()
    insertion = next(index for index, line in enumerate(lines) if line.startswith('| 技术 |') and '55-scoped' in line)
    lines.insert(insertion + 1, '| 技术 | [持久请求与共享限额](technical/56-durable-provider-request-control.md) | 跨进程准入、速率、用量事实、未知容量与逐次预算后续要求 |')
    content = title + '\n\n' + top + '\n\n' + '\n'.join(lines) + '\n'
    path = ROOT / 'docs/README.md'
    assert path.read_text(encoding='utf-8') in (base, content)
    path.write_text(content, encoding='utf-8', newline='\n')
    detail = ROOT / 'docs/technical/56-durable-provider-request-control.md'
    text = detail.read_text(encoding='utf-8')
    text = text.replace('状态：实现中。', '状态：持久请求基础修复已验证；逐调用预算与完整后台策略管理继续实施。', 1)
    marker = '\n## 本阶段执行回执\n'
    if marker in text:
        text = text.split(marker, 1)[0]
    text += marker + f'''\n专项 03 **{focused_count}/{focused_count}**，完整回归 01 **{full_count}/{full_count}**；{sources} 份平台来源在运行前后保持相同，保留阶段 55 全部 531 项命名测试。类型检查、实际构建及夹具实际回收通过。两套现有原生数据库 065→066 升级，各保留 {tables} 张原公共表完整行摘要、SQL001–065 和历史校验值；四张新表强制 RLS，未补造历史调用，SQL066 自此不可改写。自建数据库正常关闭，本轮未打开浏览器或客户端。\n\n详见[来源与范围回执](../quality/provider-control-checkpoint.json)。13/13 和扩展 02 的运行通过是历史源码结果；扩展 02 尚有 ES2022 编译不兼容，已保留原始编译错误，不能作为当前构建证明。当前验证继续使用获准假数据，不关闭逐调用预算、完整后台控制和原始 102 项综合验收。\n'''
    detail.write_text(text, encoding='utf-8', newline='\n')
    print(f'Updated six Markdown files from {focused_count}/{full_count} executed tests and {sources} sources')


if __name__ == '__main__':
    main()
