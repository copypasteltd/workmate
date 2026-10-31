"""Record the bounded current increment without modifying frozen releases or original evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from copy import deepcopy
import json
import shutil

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
def digest(p): return sha256(p.read_bytes()).hexdigest()
def create(p, data):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('x', encoding='utf-8', newline='\n') as f:
        f.write(data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, indent=2) + '\n')

baseline = json.loads((DELIVERY / '.data/admin-directory-filters-168/baseline.json').read_bytes())
qpath = DELIVERY / 'evidence/admin-directory-filters-168/qualification-04.json'
upath = DELIVERY / 'evidence/admin-directory-filters-168/admin-ui-03.json'
q, ui = [json.loads(p.read_bytes()) for p in [qpath, upath]]
assert q['status'] == 'passed' and q['owned_services_closed'] and q['source_unchanged']
assert q['database_tests'] == 8 and ui['status'] == 'passed' and len(ui['checks']) == 6 and ui['browser_closed']
assert q['inherited_checks']['sha256'] == digest(DELIVERY / q['inherited_checks']['path'])
prior = json.loads((DELIVERY / q['inherited_checks']['path']).read_bytes())
assert prior['database_tests'] == 8 and prior['source_unchanged'] and prior['owned_services_closed']
assert all(c['exit_code'] == 0 for c in prior['build_commands'])
for collection in [q['source_after'], prior['source_after']]:
    for name, h in collection.items(): assert digest(DEV / name) == h, name
for n, h in baseline['preserved_user_files'].items(): assert digest(ROOT / n) == h
assert digest(DEV / 'copypaste-desktop/.gitattributes') == baseline['desktop_attributes_sha256']

media = [*ui['screenshots'], *[f for r in ui['recordings'] for f in r['files']]]
assert len(ui['screenshots']) == 5 and len(ui['recordings']) == 1 and len(media) == 7
copies = []
for row in media:
    source = DEV / row['path']; assert digest(source) == row['sha256'] and not row.get('edited', False)
    targets = [ROOT / 'docs/assets/admin-directory-filters-168' / source.name]
    if source.suffix in ['.gif', '.mp4'] or '02-confirmed-result' in source.name:
        targets += [DEV / ('copypaste-' + c) / 'assets/screenshots' / source.name for c in ['platform', 'delivery']]
    for target in targets:
        assert not target.exists(); target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, target)
        assert digest(target) == row['sha256']; copies.append({'path': target.relative_to(ROOT).as_posix(), 'sha256': row['sha256'], 'original': row['path']})
provenance = {'at': datetime.now(timezone.utc).isoformat(), 'scope': ui['scope'], 'receipt': upath.relative_to(ROOT).as_posix(), 'receipt_sha256': digest(upath), 'edited': False, 'copies': copies}
create(ROOT / 'docs/assets/admin-directory-filters-168/provenance.json', provenance)

# Additive machine-readable contract. The existing default strict DTO fixture is immutable.
legacy = json.loads((DEV / 'copypaste-platform/contracts/admin-directory-schemas.json').read_bytes())
schemas = deepcopy(legacy['schemas'])
schemas['AdminUser']['properties'].update(registration_source={'enum': ['email_otp', None]}, last_active_at={'type': ['string', 'null'], 'format': 'date-time'})
schemas['AdminUser']['required'] += ['registration_source', 'last_active_at']
fields = {k: {'type': 'string', 'format': 'date-time'} for k in ['period_from', 'period_to', 'registered_from', 'registered_to', 'active_from', 'active_to', 'vip_expiry_from', 'vip_expiry_to']}
for k in ['charge_min_micros', 'charge_max_micros', 'balance_required_micros']: fields[k] = {'type': 'string', 'pattern': '^(0|[1-9][0-9]{0,29})$'}
for k, values in {'view': ['operations'], 'activity': ['known', 'unknown'], 'registration_source': ['email_otp', 'unknown'], 'vip_status': ['effective', 'scheduled', 'expired', 'suspended', 'revoked'], 'balance_state': ['insufficient', 'sufficient'], 'billing_subject': ['personal', 'tenant'], 'cost_exception': ['pending_reconciliation', 'none'], 'role_usage': ['created', 'started']}.items(): fields[k] = {'type': 'string', 'enum': values}
fields.update(vip_plan={'type': 'string', 'minLength': 1, 'maxLength': 160}, role_key={'type': 'string', 'minLength': 1, 'maxLength': 80})
api = {'openapi': '3.1.0', 'info': {'title': 'Workmate optional Admin directory operations projection', 'version': '168'}, 'description': 'Additive query parameters and operations DTO. Existing q/user_id/tenant_id/project_id/state/vip/cursor/limit remain supported. view=operations is required for the two added response fields. All current identity, MFA and field scopes remain mandatory. Dates are half-open; charge bounds inclusive; balance threshold strictly positive. Unknown activity cannot have a recorded range; role_usage requires role_key; account options require balance_state.', 'components': {'schemas': schemas}, 'paths': {'/v1/admin/users': {'get': {'parameters': [{'name': k, 'in': 'query', 'schema': v} for k, v in fields.items()], 'responses': {'200': {'description': 'When view=operations; default response remains legacy AdminUserList', 'content': {'application/json': {'schema': {'$ref': '#/components/schemas/AdminUserList'}}}}}}}, '/v1/admin/users/{id}': {'get': {'parameters': [{'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'string', 'format': 'uuid'}}, {'name': 'view', 'in': 'query', 'schema': {'enum': ['operations']}}], 'responses': {'200': {'description': 'Optional operational detail', 'content': {'application/json': {'schema': {'$ref': '#/components/schemas/AdminUserDetail'}}}}}}}}}
for p in [ROOT / 'docs/contracts/admin-directory-operations-168.json', DEV / 'copypaste-platform/contracts/admin-directory-operations-168.json']: create(p, api)

image = next(Path(r['path']).name for r in media if '02-confirmed-result' in r['path'])
gif = next(Path(r['path']).name for r in media if r['path'].endswith('.gif'))
mp4 = next(Path(r['path']).name for r in media if r['path'].endswith('.mp4'))
for component in ['platform', 'admin', 'delivery']:
    for language in ['zh', 'en']:
        zh = language == 'zh'; p = DEV / ('copypaste-' + component) / ('README.md' if zh else 'README.en.md')
        text = p.read_text(encoding='utf-8'); marker = '## 本版用户任务与内容' if zh else '## User tasks and content'
        # Insert before the first section, preserving every existing frozen-release guide.
        index = text.index('\n## ')
        if zh:
            block = '''## 当前源码增量 · 阶段168

用户列表可组合注册/最近账户访问、来源、VIP方案/状态/到期、确认扣费、角色建立/开始、待对账和独立账户额度条件。刷新、详情及返回保留URL条件。最近访问包含合法设备后台轮询，不等于真人在线；历史来源和访问保持未知。金额以精确微港币保存，只统计确认扣费；个人/企业资金不合并，未知或不一致账务不当作零。

当前增量需数据库001–156及匹配API/Worker：停止旧服务，备份后迁移，再启动新服务。默认目录DTO兼容；显式view=operations增加来源及访问字段。费用、VIP、账务各需独立当前范围权限及近期MFA，目录读取不写账。

此项是v0.1.0之后的源码更新，**不在原冻结ZIP内**。原发行标签及资产保持不变。当前Backend/Admin构建、8项原生SQL/API和6组实际Admin页面检查通过；保留测试数据与页面定位的原始失败尝试。业务仍使用已授权假数据，完整验收范围继续跟踪。

'''
        else:
            block = '''## Current source increment · stage168

Combine registration/account-access dates and origin, VIP plan/state/expiry, confirmed charges, submitted/started role tasks, reconciliation and individual-account credit conditions. URLs survive reload/detail/return. Authenticated account access includes legitimate device polling; it is not human presence. Historical origin/activity stays unknown. Exact micro-HKD calculations count confirmed charges and never pool personal/workspace funds or classify unavailable/inconsistent accounts as zero.

Deploy complete schema001–156 with matching API/Worker: stop old services, back up, migrate and start the new services. Default directory DTOs remain compatible; view=operations opts into origin/access fields. Current independent usage/VIP/billing scopes and recent MFA are enforced. Directory reads do not mutate billing.

This source update follows v0.1.0 and is **not inside its frozen ZIP**. Frozen tags/assets remain unchanged. Backend/Admin builds, eight native SQL/API cases and six actual Admin browser checks passed; original fixture/locator failures remain preserved. Authorized synthetic dependencies and original whole-acceptance scopes remain explicit.

'''
        block += '```mermaid\nflowchart LR\n A[Admin OTP and TOTP] --> F[URL filters]\n F --> S[Current user and field scopes]\n S --> E[Same grant / exact charges / separate wallet]\n E --> U[Matching users]\n U --> D[User detail]\n D --> F\n```\n\n'
        block += f'![Directory result](assets/screenshots/{image})\n\n![Actual interaction](assets/screenshots/{gif})\n\n[MP4](assets/screenshots/{mp4}) · [Logic / 逻辑](https://github.com/copypasteltd/workmate/blob/docs/docs/development/168-admin-directory-operational-filters.md) · [Evidence / 回执](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/admin-directory-filters-168.json)\n\n'
        assert '## 当前源码增量 · 阶段168' not in text and '## Current source increment · stage168' not in text
        text = text[:index+1] + block + text[index+1:]
        if component == 'platform': text = text.replace('SQL增量历史001–155', '当前SQL增量历史001–156（冻结v0.1.0为155）').replace('SQL history is001–155', 'Current SQL history is001–156 (frozen v0.1.0 uses155)')
        p.write_text(text, encoding='utf-8', newline='\n')

ledger = json.loads((ROOT / 'docs/quality/remaining-work-stage167.json').read_bytes())
original = [(r['id'], r['full_acceptance'], r['optional']) for r in ledger['requirements']]
ledger['reviewed_at'] = datetime.now(timezone.utc).isoformat(); ledger['current_stage'] = 168
ledger['previous_review'] = {'path': 'docs/quality/remaining-work-stage167.json', 'sha256': digest(ROOT / 'docs/quality/remaining-work-stage167.json')}
for r in ledger['requirements']:
    if r['id'] in ['REQ-003', 'REQ-084', 'REQ-085', 'REQ-086']:
        r['current_review_note'] += ' 168：目录时间/来源、同项VIP、精确确认扣费、角色/待对账、独立账户额度与认证访问记录；8项原生SQL/API和6组实际Admin检查。原完整验收范围保留。'
    if r['id'] == 'REQ-084':
        r['implemented_scope'] += '；168扩展运营组合筛选与真实来源/访问字段'
        r['current_audit_remaining'] = '注册/访问、VIP方案/状态/到期、费用/角色/账户组合筛选已实现并定向验证；全部企业关系/字段、完整授权运营矩阵及生产数据规模验收仍开放。'
ledger['current_increment'] = {'stage': 168, 'scope': 'Operational Admin directory filters and authenticated account access metadata', 'broad_regression': 'deliberately_omitted_by_user', 'full_acceptance_closed': False, 'frozen_release_unchanged': 'v0.1.0'}
ledger['stage168_scope_note'] = {'new_full_acceptance_closures': 0, 'native_sql_api_cases': 8, 'actual_admin_ui_checks': 6, 'whole_scope_preserved': True, 'frozen_releases_unchanged': ['v0.1.0-rc.5', 'v0.1.0']}
assert [(r['id'], r['full_acceptance'], r['optional']) for r in ledger['requirements']] == original
create(ROOT / 'docs/quality/remaining-work-stage168.json', ledger)
rows = ['# 阶段168 · 原编号实现与完整验收台账', '', '保留102编号和88项必选完整验收开放范围；不等于88个未实现模块。当前运营筛选已实现；新增整项关闭0。冻结v0.1.0保持原样。', '', '|编号|模块|当前实现|仍待完整处理|完整验收|', '|---|---|---|---|---|']
for r in ledger['requirements']: rows.append('|' + '|'.join(str(r[k]).replace('|', '\\|').replace('\n', ' ') for k in ['id', 'module', 'implemented_scope', 'current_audit_remaining', 'full_acceptance']) + '|')
create(ROOT / 'docs/quality/remaining-work-stage168.md', '\n'.join(rows) + '\n')
attempts = [{'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p), 'status': json.loads(p.read_bytes())['status']} for p in sorted((DELIVERY / 'evidence/admin-directory-filters-168').glob('*.json')) if p not in [qpath, upath]]
report = {'stage': 168, 'at': datetime.now(timezone.utc).isoformat(), 'status': 'qualified', 'native_sql_api_checks': 8, 'actual_admin_ui_checks': 6, 'production_builds': ['backend', 'admin'], 'sources': {**prior['source_after'], **q['source_after']}, 'qualification': {'path': qpath.relative_to(ROOT).as_posix(), 'sha256': digest(qpath)}, 'actual_ui': {'path': upath.relative_to(ROOT).as_posix(), 'sha256': digest(upath)}, 'retained_attempts': attempts, 'media': provenance, 'mandatory_whole_acceptance_open': 88, 'new_full_acceptance_closures': 0, 'owned_browser_and_services_closed': True, 'virtualization_used': False, 'frozen_releases_unchanged': ['v0.1.0-rc.5', 'v0.1.0'], 'prepare_tool_sha256': digest(Path(__file__))}
create(ROOT / 'docs/quality/admin-directory-filters-168.json', report)
for filename in ['README.md', 'README.en.md']:
    p = ROOT / 'docs' / filename; text = p.read_text(encoding='utf-8')
    header = '# 当前源码增量 / Current source increment · 168\n\n用户运营组合筛选与真实账户访问记录已收口；精确费用、独立账户和当前权限约束不变。Scoped operational filters and truthful access metadata are implemented. Backend/Admin builds,8 native SQL/API cases and6 actual Admin UI checks passed.\n\n[本轮更新 / Changes](changes/168-admin-directory-operational-filters.md) · [方案 / Behavior](development/168-admin-directory-operational-filters.md) · [检查与媒体 / Evidence](quality/admin-directory-filters-168.json) · [完整待办 / Ledger](quality/remaining-work-stage168.md)\n\n这是v0.1.0之后的源码增量，不在下方原冻结ZIP内；数据库156需匹配的新服务。This increment is excluded from the frozen v0.1.0 ZIP below; schema156 requires matching services.\n\n---\n\n'
    p.write_text(header + text, encoding='utf-8', newline='\n')
print(json.dumps({'status': 'prepared', 'stage': 168, 'native_checks': 8, 'actual_ui_checks': 6, 'media_copies': len(copies), 'bilingual_pairs': 3, 'full_acceptance_closures': 0}))
