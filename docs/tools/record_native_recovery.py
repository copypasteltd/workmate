"""Record native recovery evidence and update the seven bilingual delivery guides."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT/'dev'
L = DEV/'copypaste-delivery'
Q = ROOT/'docs/quality'
CP = Q/'native-recovery-checkpoint.json'
COMPONENTS = ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']


def read(p): return json.loads(p.read_text('utf-8-sig'))
def digest(p): return sha256(p.read_bytes()).hexdigest()
def ref(p): return {'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p)}


def write(p, value):
    assert not p.exists(), p
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('x', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(value, ensure_ascii=False, indent=2)+'\n')


def checked(p):
    v = read(p)
    assert v['source_unchanged'], p
    for c in v.get('checks', []):
        if not isinstance(c, dict) or 'raw_report' not in c:
            continue
        raw = L/c['raw_report']['path']
        assert digest(raw) == c['raw_report']['sha256'], raw
        if 'counts' in c:
            counts = {k: int(re.findall(r'^# '+k+r' (\d+)\r?$', raw.read_text('utf-8'), re.M)[0])
                      for k in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']}
            assert counts == c['counts'], raw
    return v


def record(core, ui, clients):
    paths = [L/f'evidence/native-recovery-core-{core}.json',
             L/f'evidence/native-recovery-ui-{ui}.json', L/f'evidence/native-recovery-clients-{clients}.json']
    backend, browser, builds = [checked(p) for p in paths]
    for v in [backend, builds]:
        assert v['verifier_sha256'] == digest(L/'scripts/run-native-recovery-v2.mjs')
    assert browser['verifier_sha256'] == digest(L/'scripts/run-native-recovery-ui-v5.mjs')
    assert browser['journey_verifier_sha256'] == digest(L/'scripts/qa-native-recovery-ui-v5.ts')
    for v in [backend, browser, builds]:
        assert v['status'] == 'passed' and v['owned_database_shutdown']
        assert all(c['exit_code'] == 0 for c in v['checks'])
    counts = {c['name']: c['counts'] for c in backend['checks'] if 'counts' in c}
    assert set(counts) == {'backend'} and counts['backend']['tests'] == counts['backend']['pass'] == 64
    assert all(counts['backend'][k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
    assert len(builds['checks']) == 13 and browser['owned_preview_closed']
    jp = L/browser['journey']['path']
    assert digest(jp) == browser['journey']['sha256']
    j = read(jp)
    assert j['status'] == 'passed' and len(j['checks']) == 6 and len(j['layouts']) == len(j['screenshots']) == 3
    assert len(j['recordings']) == 1 and not j['production_recovery_qualified']
    assert all(j[k] for k in ['browser_closed', 'api_closed', 'fixture_closed'])
    for layout in j['layouts']:
        assert not layout['overflow'] and not layout['clipped']
        assert not layout['navigation_obscures_content']
        assert layout['viewport_bounds'] and all(b['left'] >= -2 and b['right'] <= layout['width']+2 for b in layout['viewport_bounds'])
    for movie in j['recordings']:
        assert movie['distinct_frames'] > 1 and movie['skipped_capture_errors'] == 0
    sources = {}
    for v in [backend, browser, builds]:
        for name, expected in v['source_files'].items():
            assert digest(DEV/name) == expected, name
            assert sources.get('dev/'+name, expected) == expected, name
            sources['dev/'+name] = expected
    contract = ROOT/'docs/contracts/native-recovery.openapi.json'
    mirror = DEV/'copypaste-platform/contracts/native-recovery-schemas.json'
    assert read(contract)['x-runtime-schema-sha256'] == digest(mirror)
    assert read(contract)['components']['schemas'] == read(mirror)['schemas']
    sources[contract.relative_to(ROOT).as_posix()] = digest(contract)
    previous = read(Q/'external-budget-checkpoint.json')
    for n, h in previous['source_files'].items():
        if n.startswith('dev/copypaste-platform/migrations/'):
            assert sources[n] == h, n
    for row in j['screenshots']+[f for m in j['recordings'] for f in m['files']]:
        assert digest(DEV/row['path']) == row['sha256'], row['path']
    original = read(Q/'history/stage96-before-solution-packages/receipt.json')
    progress = read(Q/'requirements-alignment-progress.json')
    assert progress['requirements'] == original['requirements'] and progress['gates'] == original['gates']
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    attempts = []
    for pattern in ['native-recovery-core-??.json', 'native-recovery-focused-??.json',
                    'native-recovery-ui-??.json', 'native-recovery-clients-??.json']:
        for p in sorted((L/'evidence').glob(pattern)):
            v = checked(p)
            row = {**ref(p), 'status': v['status'], 'error': v.get('error')}
            if p.name in ['native-recovery-ui-04.json', 'native-recovery-ui-05.json']:
                row['visual_review'] = 'Superseded: internal overflow checks passed but capture preceded responsive reflow or navigation animation completion; not selected for delivery.'
            attempts.append(row)
    prior = Q/'history/stage114-previous-publication.json'
    assert not prior.exists()
    shutil.copyfile(Q/'workmate-publication.json', prior)
    write(CP, dict(at=datetime.now(timezone.utc).isoformat(), stage=114,
          status='verified_native_isolated_recovery',
          scope='Native PostgreSQL consistent snapshot and authenticated encrypted files, separately encrypted deletion journal, lost-source restore into a new quarantined database and data directory, deletion replay, API/worker execution fences, verified retention, singleton watch loops and global recent-MFA read-only Admin readiness. Real native tools and database; synthetic customer/model data. Affected functionality only; production cutover, offsite durability, PITR and production RPO/RTO remain unqualified.',
          source_files=dict(sorted(sources.items())), selected_core=ref(paths[0]), selected_ui=ref(paths[1]),
          client_builds=ref(paths[2]), counts=counts, build_checks=13, journey=ref(jp), actual_ui_checks=6,
          screenshots=j['screenshots'], recordings=j['recordings'], layouts=j['layouts'], attempts=attempts,
          new_migrations=['125-native-recovery.sql'], new_routes=['GET /v1/admin/recovery'],
          retained_stage113=ref(Q/'external-budget-checkpoint.json'), previous_publication=ref(prior),
          original_requirements_modified=False, fully_accepted_requirements=0, qualified_live_roles=0,
          production_recovery_qualified=False, verifier_sha256=digest(Path(__file__))))
    print(json.dumps({'status': 'verified_native_isolated_recovery', 'sources': len(sources), 'tests': 64, 'ui': 6}))


def sync():
    cp = read(CP)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    changes, copies = [], []
    for row in cp['screenshots']+[f for m in cp['recordings'] for f in m['files']]:
        src = DEV/row['path']
        dst = ROOT/'docs/design/implementation'/('copypaste-admin__'+src.name)
        assert not dst.exists()
        shutil.copyfile(src, dst)
        assert digest(dst) == row['sha256']
        copies.append({'source': src.relative_to(ROOT).as_posix(), 'target': dst.relative_to(ROOT).as_posix(), 'sha256': digest(dst)})
    diagram = '```mermaid\nflowchart LR\n  Live[Native database and immutable objects] --> Snapshot[One exported snapshot]\n  Snapshot --> Archive[Authenticated encrypted archive]\n  Live --> Journal[Independent deletion journal]\n  Archive --> Verify[Verify every file and key]\n  Journal --> Verify\n  Verify --> Restore[New quarantined database and directory]\n  Restore --> Erase[Replay newer deletion records]\n  Erase --> Receipt[Immutable isolated recovery receipt]\n  Receipt --> Admin[Global permission and current MFA]\n  Restore --> Fence[API and workers remain fenced]\n```\n'
    details = {
      'platform': ('Run forward-only migration 125 and `npm run setup:recovery-tools`. Configure an independent `RECOVERY_BACKUP_KEY`, the original `MASTER_KEY`, an owner DSN and an archive directory outside `DATA_DIR`. `npm run recovery -- backup`, `ledger`, `verify`, `prune`, `watch` and `restore` are native owner operations; complete arguments are in the runbook. The watch command needs an independently provisioned service/scheduler and offsite copy. Restore requires explicit isolation, a new `workmate_recovery_<32hex>` database and `restore-<32hex>` directory; it never activates production.', '执行向前迁移 125 和 `npm run setup:recovery-tools`，独立设置 `RECOVERY_BACKUP_KEY`、原 `MASTER_KEY`、owner DSN 以及 `DATA_DIR` 外的归档目录。`npm run recovery -- backup`、`ledger`、`verify`、`prune`、`watch`、`restore` 为原生运维命令，完整参数见运行手册。watch 的服务／调度与异地副本需由部署环境配置。恢复要求明确隔离、新 `workmate_recovery_<32hex>` 数据库及 `restore-<32hex>` 目录，不会自动转为生产。'),
      'admin': ('Open Backup & recovery with global `admin.recovery.read` and MFA refreshed within ten minutes. Review backup freshness, deletion-journal coverage and the last isolated restore; filter receipt types, page stable cursors and open exact persisted details. An overlapping explicit deny blocks the global view. Expired MFA withdraws previous results. The browser has no restore or release operation.', '使用全局 `admin.recovery.read` 及十分钟内 MFA 打开「备份与恢复」，查看备份时效、删除日志覆盖和最近隔离恢复，按类型筛选、稳定游标翻页并查看实际凭证。重叠显式拒绝会阻止全局视图，MFA 过期撤回旧数据。浏览器不提供恢复执行或生产放行操作。'),
      'web': ('Customer login, tenant/project access and cloud Codex remain the normal entry. A restored isolated environment refuses API startup, so historical tasks and financial facts cannot silently resume. Recovery readiness is an administrator operation; this delivery does not claim an additional customer recovery screen.', '客户继续经登录、企业／项目授权使用云端 Codex；隔离恢复环境拒绝 API 启动，历史任务及金融事实不会静默重跑。恢复就绪度由管理员查看，本轮不新增客户恢复页面。'),
      'desktop': ('The agent continues to run locally through Codex with revocable full permissions, frameless windows and no Electron menus. These backups cover committed server data and files, not customer-local files or a local process checkpoint. A quarantined server cannot restart local execution from restored task history.', 'Agent 继续在客户本机使用 Codex，保留可撤回完整权限、无边框和无 Electron 菜单。备份覆盖已提交的服务器数据及文件，不包含客户本机文件或本地进程检查点。隔离服务器不能凭恢复后的任务历史重新发起本机执行。'),
      'extension': ('The native Chrome right Side Panel keeps cloud Codex chat and explicitly authorized file uploads. Server backups include eligible committed uploads; uncommitted uploads and browser-local files are excluded. The extension never receives archive keys or a restore capability.', 'Chrome 原生右侧栏保留云端 Codex 对话及明确授权的文件上传。服务器备份包含符合条件的已提交上传，不包含未提交上传及浏览器本地文件；插件不接收归档密钥或恢复执行权限。'),
      'delivery': ('Immutable qualification scripts use dedicated native PostgreSQL clusters, official hash-pinned PostgreSQL tools and actual Admin browser interaction. All owned processes and pages are closed after passing attempts. Failed and interrupted attempts remain intact. The selected narrow layout is checked against viewport bounds as well as internal overflow.', '固定验证脚本使用独占原生 PostgreSQL 集群、官方哈希固定工具及真实后台浏览器交互。通过轮次完成后关闭全部自建进程及页面，保留失败与中断尝试；窄屏同时核对元素相对窗口边界和内部溢出。')}
    image_row = cp['screenshots'][0]
    gif_row = next(f for f in cp['recordings'][0]['files'] if f['path'].endswith('.gif'))
    for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
        component = folder.name.removeprefix('copypaste-')
        for name in ['README.md', 'README.en.md']:
            p = folder/name
            old = p.read_bytes()
            assert b'<!-- native-recovery-stage114 -->' not in old
            title, body = old.split(b'\n', 1)
            en = name.endswith('.en.md')
            text = '<!-- native-recovery-stage114 -->\n'
            text += ('Native encrypted backups and isolated recovery are implemented. A consistent database snapshot and immutable files are authenticated together; a newer independent deletion journal suppresses deleted content before a restored environment can be reviewed.\n\n' if en else '已实现原生加密备份与隔离恢复：同一快照的数据库及不可变文件经完整认证，恢复后先应用较新的独立删除日志，再提供核验凭证。\n\n')
            if component in details:
                text += details[component][0 if en else 1]+'\n\n'
            text += ('Validation: 64 affected backend tests (including 10 native recovery tests), 13 build/type checks and 6 actual Admin flows across 3 measured layouts. Real native backup/restore; synthetic customer/model data. Production cutover, offsite durability, PITR and full production RPO/RTO remain unqualified.\n\n' if en else '验证：64 项相关后端测试（含 10 项原生恢复测试）、13 项构建／类型检查、6 条真实后台流程及 3 种布局。备份及恢复使用真实原生工具；客户与模型数据为假数据。生产切换、异地耐久性、PITR 与完整生产 RPO／RTO 仍未通过验收。\n\n')
            if component in ['platform', 'admin']:
                text += ('Existing deployments must explicitly grant the new observer authority to an enrolled permanent global super: `npm run admin:enable-recovery -- operator@example.com --acknowledge-global-recovery-visibility`. Existing roles never auto-expand.\n\n' if en else '已有部署须对已登记的永久全局 super 明确运行 `npm run admin:enable-recovery -- operator@example.com --acknowledge-global-recovery-visibility` 后再委派观察权限；旧角色不会自动扩权。\n\n')
            if folder == ROOT/'docs':
                text += '[Runbook / 方案](technical/114-native-backup-recovery.md) · [Evidence / 证据](quality/native-recovery-checkpoint.json)\n\n'
                media = lambda row: 'design/implementation/copypaste-admin__'+Path(row['path']).name
            else:
                text += '[Runbook / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/114-native-backup-recovery.md) · [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/native-recovery-checkpoint.json)\n\n'
                media = lambda row: (Path(row['path']).relative_to('copypaste-admin').as_posix() if component == 'admin' else 'https://raw.githubusercontent.com/copypasteltd/workmate/admin/'+Path(row['path']).relative_to('copypaste-admin').as_posix())
            text += diagram+f'\n![Actual Admin recovery readiness / 实际后台恢复面板]({media(image_row)})\n\n![Actual Admin recovery interaction / 实际后台恢复交互]({media(gif_row)})\n\n'
            p.write_bytes(title+b'\n\n'+text.encode()+body)
            changes.append({'path': p.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(p)})
    progress_path = Q/'requirements-alignment-progress.json'
    old = progress_path.read_bytes()
    progress = read(progress_path)
    progress['native_backup_recovery'] = {'checkpoint': ref(CP), 'counts': cp['counts'], 'actual_admin_flows': 6, 'original_requirements_modified': False, 'production_recovery_qualified': False, 'full_acceptance': 'not_proven'}
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    changes.append({'path': progress_path.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(progress_path)})
    for en in [False, True]:
        p = ROOT/('docs/changes/2026-10-27-native-backup-recovery'+('.en' if en else '')+'.md')
        assert not p.exists()
        p.write_text(('# Native backup and isolated recovery\n\n' if en else '# 原生备份与隔离恢复\n\n')+('Implemented consistent native snapshots, independent authenticated encryption, deletion-journal export/replay, lost-source recovery, dual execution quarantine, authenticated 35-day pruning, singleton watch loops and global MFA-bound Admin receipts.\n\n' if en else '实现原生一致快照、独立认证加密、删除日志导出与重放、源库丢失恢复、双重执行隔离、认证后 35 天清理、单例巡检及全局 MFA 后台凭证。\n\n')+'64 affected backend tests; 13 build/type checks; 6 actual Admin flows; 3 layouts.\n\n'+('Production cutover, offsite durability, PITR and production RPO/RTO are not qualified. Original full acceptance gates, failed/interrupted attempts and prior migrations remain unchanged.\n\n' if en else '生产切换、异地耐久性、PITR 及生产 RPO／RTO 未获验收；原完整验收门槛、失败／中断证据和历史迁移保持原样。\n\n')+'[Runbook / 方案](../technical/114-native-backup-recovery.md) · [Evidence / 证据](../quality/native-recovery-checkpoint.json)\n', encoding='utf-8', newline='\n')
    write(Q/'native-recovery-documentation-refresh.json', {'checkpoint': ref(CP), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})


def audit():
    from markdown_it import MarkdownIt
    from urllib.parse import urlsplit, unquote
    cp, refresh = read(CP), read(Q/'native-recovery-documentation-refresh.json')
    assert cp['verifier_sha256'] == refresh['verifier_sha256'] == digest(Path(__file__))
    for n, h in cp['source_files'].items(): assert digest(ROOT/n) == h, n
    for r in refresh['changes']: assert digest(ROOT/r['path']) == r['after_sha256']
    for r in refresh['media_copies']: assert digest(ROOT/r['source']) == digest(ROOT/r['target']) == r['sha256']
    links, parser = 0, MarkdownIt()
    for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
        for name in ['README.md', 'README.en.md']:
            p = folder/name
            body = p.read_text('utf-8')
            assert '<!-- native-recovery-stage114 -->' in body
            for token in parser.parse(body):
                for child in token.children or []:
                    v = child.attrGet('src') if child.type == 'image' else child.attrGet('href') if child.type == 'link_open' else None
                    if v and not urlsplit(v).scheme and not v.startswith('#'):
                        assert (p.parent/unquote(urlsplit(v).path)).exists(), (p, v)
                        links += 1
    decoded = []
    for movie in cp['recordings']:
        for row in movie['files']:
            p = DEV/row['path']
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames:format=duration', '-of', 'json', str(p)]))
            assert int(probe['streams'][0]['nb_read_frames']) > 1 and abs(float(probe['format']['duration'])-movie['seconds']) <= .25
            result = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(p), '-map', '0:v:0', '-f', 'null', '-'], capture_output=True, check=True)
            assert not result.stderr.strip()
            decoded.append(row)
    original = read(Q/'history/stage96-before-solution-packages/receipt.json')
    now = read(Q/'requirements-alignment-progress.json')
    assert now['requirements'] == original['requirements'] and now['gates'] == original['gates']
    write(Q/'native-recovery-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP), 'bilingual_readmes': 14, 'local_readme_links': links, 'decoded_recordings': decoded, 'original_matrix_unchanged': True, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'decoded': len(decoded)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['record', 'sync', 'audit'])
    parser.add_argument('--core', default='02')
    parser.add_argument('--ui', default='06')
    parser.add_argument('--clients', default='02')
    args = parser.parse_args()
    if args.action == 'record': record(args.core, args.ui, args.clients)
    elif args.action == 'sync': sync()
    else: audit()
