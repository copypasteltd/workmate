"""Bind current focused results to bilingual handbooks and unedited actual media."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import shutil

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
def digest(p): return sha256(p.read_bytes()).hexdigest()
def write(p, text):
    with p.open('x', encoding='utf-8', newline='\n') as f: f.write(text)

baseline = json.loads((DELIVERY / '.data/admin-user-resources-166/baseline.json').read_bytes())
qpath = DELIVERY / 'evidence/admin-user-resources-166/qualification-02.json'
upath = DELIVERY / 'evidence/admin-user-resources-166/admin-ui-02.json'
oldpath = DELIVERY / 'evidence/admin-user-resources-166/qualification-01.json'
q, ui, old = [json.loads(p.read_bytes()) for p in [qpath, upath, oldpath]]
assert q['status'] == 'passed' and q['owned_services_closed'] and q['source_unchanged']
assert ui['status'] == 'passed' and ui['browser_closed'] and len(ui['checks']) == 8
assert old['database_tests'] == 8 and all(c['exit_code'] == 0 for c in old['build_commands'])
assert old['status'] == 'failed' and old['owned_services_closed'] and old['source_unchanged']
assert q['inherited_checks']['sha256'] == digest(oldpath)
for collection in [q['source_before'], q['source_after'], old['source_before']]:
    for name, h in collection.items(): assert digest(DEV / name) == h, name
for name, h in baseline['preserved_user_files'].items(): assert digest(ROOT / name) == h
assert digest(DEV / 'copypaste-desktop/.gitattributes') == baseline['desktop_attributes_sha256']
media = [*ui['screenshots'], *[f for r in ui['recordings'] for f in r['files']]]
assert len(ui['screenshots']) == 7 and len(ui['recordings']) == 1 and len(media) == 9
for row in media:
    assert digest(DEV / row['path']) == row['sha256'] and not row.get('edited', False)
for component in ['platform', 'admin', 'delivery']:
    for language in ['zh', 'en']:
        p = DEV / ('copypaste-' + component) / ('README.md' if language == 'zh' else 'README.en.md')
        text = p.read_text(encoding='utf-8')
        assert '## 当前分支增量 · 阶段166' not in text and '## Current branch increment · stage166' not in text
        assert ('## 方案与结构' if language == 'zh' else '## Architecture and responsibilities') in text
        assert ('用户专属任务/内容的统一筛选入口仍待补齐。' if language == 'zh' else 'A unified user-filtered task/content entry remains pending.') in text

assets = ROOT / 'docs/assets/admin-user-resources-166'
assets.mkdir()
copies = []
for row in media:
    source = DEV / row['path']
    targets = [assets / source.name]
    if source.suffix in ['.gif', '.mp4'] or any(s in source.name for s in ['02-selected-user-tasks', '04-original-user-content']):
        targets += [DEV / ('copypaste-' + c) / 'assets/screenshots' / source.name for c in ['platform', 'delivery']]
    for target in targets:
        assert not target.exists()
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        assert digest(target) == row['sha256']
        copies.append({'path': target.relative_to(ROOT).as_posix(), 'sha256': row['sha256'], 'original': row['path']})
provenance = {'at': datetime.now(timezone.utc).isoformat(), 'scope': ui['scope'], 'receipt': upath.relative_to(ROOT).as_posix(), 'receipt_sha256': digest(upath), 'edited': False, 'copies': copies}
write(assets / 'provenance.json', json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
task_image = next(Path(r['path']).name for r in ui['screenshots'] if '02-selected-user-tasks' in r['path'])
content_image = next(Path(r['path']).name for r in ui['screenshots'] if '04-original-user-content' in r['path'])
gif = next(Path(r['path']).name for r in media if r['path'].endswith('.gif'))
mp4 = next(Path(r['path']).name for r in media if r['path'].endswith('.mp4'))
for component in ['platform', 'admin', 'delivery']:
    for language in ['zh', 'en']:
        zh = language == 'zh'
        p = DEV / ('copypaste-' + component) / ('README.md' if zh else 'README.en.md')
        text = p.read_text(encoding='utf-8')
        old_text = '用户专属任务/内容的统一筛选入口仍待补齐。' if zh else 'A unified user-filtered task/content entry remains pending.'
        new_text = '当前分支已接通按实际创建者筛选的任务和内容入口，返回保留原目录条件。' if zh else 'The current branch connects creator-filtered task/content pages and preserves the original directory conditions on return.'
        text = text.replace(old_text, new_text)
        if zh:
            block = '''## 当前分支增量 · 阶段166

用户详情直接进入该用户的任务与内容。搜索、分页和刷新保留目标，返回恢复原目录条件；换用户清空旧正文和操作。当前用户范围与资源范围同时鉴权，正文/下载保持独立权限与近期MFA。二十类内容按实际创建者归属，品牌保留首版作者；未知作者旧资料在全站目录查看。记录按资源类型计算，同名文件资产及目录项具有独立身份。

这是 rc.5 发布后的源码增量，不在已冻结的 rc.5 ZIP 内。冻结标签与下载保持原样。本轮后端/Admin构建、八项原生SQL/API及八组实际页面检查通过，原始定位失败和录制均保留。外部服务仍用已授权假数据，原完整验收范围继续跟踪。

```mermaid
flowchart LR
 U[用户详情] --> T[该用户任务]
 U --> C[该用户内容]
 T --> P[当前用户与资源权限交集]
 C --> P
 P --> S[搜索/分页/刷新保留目标]
 S --> U
 C --> B[独立正文与管理权限]
```

'''
        else:
            block = '''## Current branch increment · stage166

User detail opens creator-filtered tasks and content. Search, pagination and reload retain the user; return navigation restores directory conditions. Changing users discards previous bodies/operations. Current user scope intersects resource scope; body/download authority and recent MFA remain separate. Twenty content kinds use their actual creator; brands retain the original version-1 author. Unknown legacy authors remain unattributed in the full directory. Counts represent resource records; an asset and its cloud node have independent identities.

This source increment follows rc.5 and is not inside its frozen ZIP. Frozen tags/downloads stay unchanged. Current backend/Admin builds, eight native SQL/API cases and eight actual browser checks passed. The original locator failure and its media remain preserved. Authorized synthetic dependencies and all whole-acceptance scopes remain.

```mermaid
flowchart LR
 U[User detail] --> T[User tasks]
 U --> C[User content]
 T --> P[Current user and resource scope intersection]
 C --> P
 P --> S[Search, pagination and reload retain target]
 S --> U
 C --> B[Separate body and management authority]
```

'''
        block += f'![{"用户任务" if zh else "User tasks"}](assets/screenshots/{task_image})\n\n![{"用户内容" if zh else "User content"}](assets/screenshots/{content_image})\n\n![{"真实交互" if zh else "Actual interaction"}](assets/screenshots/{gif})\n\n[MP4](assets/screenshots/{mp4}) · [Logic / 逻辑](https://github.com/copypasteltd/workmate/blob/docs/docs/development/166-admin-user-resource-context.md) · [Evidence / 回执](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/admin-user-resources-166.json)\n\n'
        marker = '## 方案与结构' if zh else '## Architecture and responsibilities'
        text = text.replace(marker, block + marker, 1)
        text = text.replace('## 验证与发布', '## rc.5 冻结基线的验证与发布').replace('## Qualification and publication', '## rc.5 frozen baseline qualification and publication')
        p.write_text(text, encoding='utf-8', newline='\n')

ledger = json.loads((ROOT / 'docs/quality/remaining-work-stage165.json').read_bytes())
original = [(r['id'], r['full_acceptance'], r['optional']) for r in ledger['requirements']]
ledger['reviewed_at'] = datetime.now(timezone.utc).isoformat()
for r in ledger['requirements']:
    if r['id'] in ['REQ-084', 'REQ-090', 'REQ-094', 'REQ-098']:
        r['current_review_note'] += ' 阶段166：用户详情接通按真实创建者的任务及二十类内容，原品牌作者、当前权限交集、MFA、搜索/返回及换目标清屏；八项SQL/API和八组实际Admin页面通过。全范围验收不缩减。'
    if r['id'] == 'REQ-084':
        r['implemented_scope'] += '；166补齐用户任务/内容入口与创建者归属'
        r['current_audit_remaining'] = '用户任务/内容入口已接通并做当前定向检查；注册/活跃区间、VIP类型/到期、消费范围等扩展组合筛选、全部企业关系/字段及授权与运营矩阵的完整验收仍开放。'
ledger['stage166_scope_note'] = {'new_full_acceptance_closures': 0, 'native_sql_api_cases': 8, 'actual_admin_ui_checks': 8, 'whole_scope_preserved': True, 'frozen_rc5_unchanged': True, 'scope': 'Creator-filtered Admin user task/content navigation and original brand attribution; full original acceptance remains open.'}
assert [(r['id'], r['full_acceptance'], r['optional']) for r in ledger['requirements']] == original
write(ROOT / 'docs/quality/remaining-work-stage166.json', json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')
rows = ['# 阶段166 · 原编号验收与用户管理闭环', '', '保留全部102编号及原完整验收范围，88项必选完整验收开放不等于88个未实现模块。本轮整项完整验收关闭0；已补齐用户任务/内容入口。', '', '|编号|业务模块|当前实现|仍待完整处理|完整验收|', '|---|---|---|---|---|']
for r in ledger['requirements']:
    rows.append('|' + '|'.join(str(r[k]).replace('|', '\\|').replace('\n', ' ') for k in ['id', 'module', 'implemented_scope', 'current_audit_remaining', 'full_acceptance']) + '|')
rows += ['', '本轮：按用户创建者的任务/二十类内容入口、品牌作者、权限交集和导航恢复已实现。扩展筛选、真实服务、签名更新、多平台及完整专业验收继续保留。', '']
write(ROOT / 'docs/quality/remaining-work-stage166.md', '\n'.join(rows))
report = {'stage': 166, 'at': datetime.now(timezone.utc).isoformat(), 'status': 'qualified', 'native_sql_api_checks': 8, 'actual_admin_ui_checks': 8, 'production_builds': ['backend', 'admin'], 'sources': q['source_after'], 'qualification': {'path': qpath.relative_to(ROOT).as_posix(), 'sha256': digest(qpath)}, 'actual_ui': {'path': upath.relative_to(ROOT).as_posix(), 'sha256': digest(upath)}, 'retained_first_attempt': {'path': oldpath.relative_to(ROOT).as_posix(), 'sha256': digest(oldpath), 'status': 'failed', 'reason': 'Browser locator matched the asset and its separate cloud node with the same name. Eight backend cases and both builds passed; V2 only scopes that locator.'}, 'media': provenance, 'mandatory_whole_acceptance_open': 88, 'new_full_acceptance_closures': 0, 'owned_browser_and_services_closed': True, 'virtualization_used': False, 'frozen_release': 'v0.1.0-rc.5 unchanged; this increment updates source branches', 'prepare_tool_sha256': digest(Path(__file__))}
write(ROOT / 'docs/quality/admin-user-resources-166.json', json.dumps(report, ensure_ascii=False, indent=2) + '\n')
for filename in ['README.md', 'README.en.md']:
    p = ROOT / 'docs' / filename
    text = p.read_text(encoding='utf-8')
    text = text.replace('requirements/26-workspace-recovery-and-admin-target.md', 'requirements/27-admin-user-resource-context.md').replace('development/165-functional-closure-and-freeze.md', 'development/166-admin-user-resource-context.md').replace('changes/165-rc5-freeze.md', 'changes/166-admin-user-resources.md').replace('quality/functional-closure-165.json', 'quality/admin-user-resources-166.json').replace('quality/remaining-work-stage165.md', 'quality/remaining-work-stage166.md')
    header = '# 当前源码增量 / Current source increment · 166\n\n用户任务与内容入口、真实作者归属、权限交集和导航恢复已完成。Creator-filtered user tasks/content and scoped navigation are implemented. 八项原生SQL/API和八组实际Admin页面检查通过；不变的其他端沿用冻结基线。\n\n[本轮更新 / Changes](changes/166-admin-user-resources.md) · [当前源码逻辑 / Behavior](development/166-admin-user-resource-context.md) · [检查及媒体 / Evidence](quality/admin-user-resources-166.json) · [完整待办 / Ledger](quality/remaining-work-stage166.md)\n\n下方 rc.5 下载为保留的冻结基线，不包含本次源码增量。The frozen rc.5 download below remains unchanged and excludes this source increment.\n\n---\n\n'
    p.write_text(header + text, encoding='utf-8', newline='\n')
print(json.dumps({'status': 'prepared', 'media_copies': len(copies), 'bilingual_pairs': 3, 'native_checks': 8, 'actual_ui_checks': 8, 'whole_requirement_closures': 0}))
