"""Bind recoverable native-pairing code, actual clients and immutable evidence."""
from pathlib import Path
from datetime import datetime,timezone
from hashlib import sha256
import argparse,json,re,shutil,subprocess
from record_cloud_events import ROOT,DEV,L,Q,COMPONENTS,read,digest,ref,write,checked
CP=Q/'native-pairing-checkpoint.json'
RUNBOOK='technical/118-recoverable-native-pairings.md'
MARKER='<!-- native-pairing-stage118 -->'

def record(core,native,ui,clients,package,ui_version):
    selected=[L/f'evidence/native-pairing-{scope}-{attempt}.json' for scope,attempt in [('core',core),('native',native),('ui',ui),('clients',clients)]]
    backend,local,browser,builds=[checked(p) for p in selected]
    for v in [backend,local,browser,builds]:
        assert v['status']=='passed' and v['owned_database_shutdown'] and all(c['exit_code']==0 for c in v['checks'])
    for v in [backend,local,builds]:assert v['verifier_sha256']==digest(L/'scripts/run-native-pairing-v1.mjs')
    assert browser['verifier_sha256']==digest(L/f'scripts/run-native-pairing-ui-v{ui_version}.mjs')
    assert browser['journey_verifier_sha256']==digest(L/f'scripts/qa-native-pairing-ui-v{ui_version}.ts')
    counts={'backend':next(c['counts'] for c in backend['checks'] if c['name']=='backend'),**{c['name']:c['counts'] for c in local['checks'] if 'counts' in c}}
    for k,n in [('backend',42),('desktop-unit',141),('native-codex',22)]:
        c=counts[k];assert c['tests']==c['pass']==n and all(c[x]==0 for x in ['fail','cancelled','skipped','todo'])
    args=next(c['args'] for c in backend['checks'] if c['name']=='backend')
    assert {a for a in args if a.startswith('tests/')}=={'tests/'+n+'.test.ts' for n in ['desktop-pairing','desktop-disconnect','auth-sessions','auth-contract','migrations']}
    assert 'tests/desktop-pairing.test.ts' in next(c['args'] for c in local['checks'] if c['name']=='desktop-unit')
    jp=L/browser['journey']['path'];assert digest(jp)==browser['journey']['sha256'];j=read(jp)
    assert j['status']=='passed' and not j['errors']
    assert len(j['checks'])==7 and len(j['screenshots'])==6 and len(j['recordings'])==2 and len(j['layouts'])==5
    assert all(j[k] for k in ['electron_closed','browser_closed','api_closed','fixture_closed','native_host_closed'])
    assert browser['owned_preview_closed'] and len(builds['checks'])==13
    for b in j['layouts']:
        assert not b['document_horizontal'] and not b['root_horizontal']
        if not b['label'].startswith('Web'):assert b['visible_vertical_rails']==0 and b['root_top']==40
    for movie in j['recordings']:assert movie['distinct_frames']>1 and movie['skipped_capture_errors']==0
    sources={'dev/'+n:h for n,h in builds['source_files'].items()};deltas=[]
    for p,v in zip(selected,[backend,local,browser,builds]):
        archive=p.with_suffix('').with_name(p.stem+'-sources')
        assert set(v['source_files']).issubset(builds['source_files'])
        for n,h in v['source_files'].items():
            assert digest(archive/n)==h and builds['source_files'][n]==h,(p,n)
        for n in sorted(set(builds['source_files'])-set(v['source_files'])):
            assert re.fullmatch(r'copypaste-delivery/scripts/(?:qa-native-pairing-ui-v[2-9]\.ts|run-native-pairing-ui-v[2-9]\.mjs)',n),n
            deltas.append({'qualification':ref(p),'path':'dev/'+n,'exact_change':'Additive immutable UI verifier, typechecked/executed by selected UI run','covered_by':ref(selected[2])})
    for n,h in sources.items():assert digest(ROOT/n)==h,n
    previous=Q/'desktop-removal-checkpoint.json'
    for n,h in read(previous)['source_files'].items():
        if n.startswith('dev/copypaste-platform/migrations/'):assert sources[n]==h,n
    contract=ROOT/'docs/contracts/native-pairings.openapi.json';mirror=DEV/'copypaste-platform/contracts/desktop-pairing-schemas.json'
    assert read(contract)['components']['schemas']==read(mirror)['schemas'] and read(contract)['x-runtime-schema-sha256']==digest(mirror)
    assert len(read(contract)['paths'])==2;sources[contract.relative_to(ROOT).as_posix()]=digest(contract)
    assert (DEV/'copypaste-platform/src/desktop-pairing-contract.ts').read_bytes()==(DEV/'copypaste-desktop/src/desktop-pairing-contract.ts').read_bytes()
    for row in j['screenshots']+[f for m in j['recordings'] for f in m['files']]:assert digest(DEV/row['path'])==row['sha256']
    package_path=L/f'evidence/native-pairing-package-{package}.json';bundle=read(package_path)
    assert bundle['status']=='passed' and bundle['source_unchanged'] and bundle['source_files']==builds['source_files']
    assert bundle['verifier_sha256']==digest(ROOT/'docs/tools/record_native_pairing_package.py')
    assert digest(L/bundle['raw_report']['path'])==bundle['raw_report']['sha256'] and bundle['verification_log']==ref(ROOT/bundle['verification_log']['path'])
    assert bundle['packaged']['version']=='0.7.1' and not bundle['installer_executed'] and not bundle['company_signed']
    nsis=read(DEV/'copypaste-delivery/evidence/desktop-removal-nsis-01.json')
    assert bundle['nsis_lifecycle']==nsis['nsis_lifecycle']==ref(DEV/'copypaste-desktop/scripts/desktop-lifecycle.nsh')
    for row in bundle['packaged']['artifacts']:assert row=={**ref(ROOT/row['path']),'bytes':(ROOT/row['path']).stat().st_size}
    original=read(Q/'history/stage96-before-solution-packages/receipt.json');progress=read(Q/'requirements-alignment-progress.json')
    assert progress['requirements']==original['requirements'] and progress['gates']==original['gates']
    assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
    prior=Q/'history/stage118-previous-publication.json';assert not prior.exists();shutil.copyfile(Q/'workmate-publication.json',prior)
    baseline=Q/'history/stage118-before-native-pairings/receipt.json';baseline.parent.mkdir(parents=True,exist_ok=True);assert not baseline.exists();shutil.copyfile(L/'.data/preparation/native-pairings-118/receipt.json',baseline)
    attempts=[]
    for p in sorted((L/'evidence').glob('native-pairing-*-??.json')):
        v=read(p)
        if 'source_files' in v:checked(p)
        attempts.append({**ref(p),'status':v['status'],'error':v.get('error')})
    write(CP,dict(at=datetime.now(timezone.utc).isoformat(),stage=118,status='verified_recoverable_native_pairings',
      scope='Desktop 0.7.1 durable device pairing, fixed signed creates and one-way retirement. Real native PostgreSQL transactions/128 migration, own-user intent namespaces, credential-family/session/member checks under the owner lock, permanent pre-create retirement, exact create replay without device reactivation, encrypted native outbox, legacy failure stop, account-epoch late response fence, controlled actual Electron folder pairing and uninstall retirement of a device ID never mapped locally. Real Windows encryption/Host/PKCE; synthetic accounts/models and explicit post-commit HTTP503/native-dialog answers. Unsigned development packages. Original complete-product, company-signed installed-product upgrade/removal, macOS and live-model acceptance remain unqualified.',
      source_files=dict(sorted(sources.items())),selected_core=ref(selected[0]),selected_native=ref(selected[1]),selected_ui=ref(selected[2]),client_builds=ref(selected[3]),counts=counts,build_checks=13,journey=ref(jp),actual_ui_checks=7,screenshots=j['screenshots'],recordings=j['recordings'],layouts=j['layouts'],qualification_source_deltas=deltas,attempts=attempts,
      retained_stage117=ref(previous),retained_nsis_hook_checks=ref(DEV/'copypaste-delivery/evidence/desktop-removal-nsis-01.json'),new_migrations=['128-desktop-pairings.sql'],api_contract=ref(contract),previous_publication=ref(prior),baseline=ref(baseline),native_codex=local['native_codex'],product_version='0.7.1',development_package=ref(package_path),
      retained_failure_notes={
        'ui_01':'Original cloud-retry timeout retained exactly; selected later complete journey supplies current passing evidence, not a rewrite of the failed attempt.',
        'ui_02':'Verifier read the pairing journal before creation. V3 adds bounded ENOENT polling and waits for the actual committed response. Native Host had not yet been launched at this early failure.',
        'ui_03':'All seven actual flows completed; final verifier still expected only two removal dialogs and omitted the added folder-permission dialog. V4 checks the separate native consent boundaries.'},
      company_signed_uninstall_qualified=False,installer_executed=False,original_requirements_modified=False,fully_accepted_requirements=0,qualified_live_roles=0,live_provider_qualified=False,verifier_sha256=digest(Path(__file__))))
    print(json.dumps({'status':'verified_recoverable_native_pairings','counts':counts,'sources':len(sources),'ui':7}))

DETAILS={
 'platform':('Migration 128 adds private native pairing facts and irreversible retirement. POST /v1/auth/native/device-pair requires the current Desktop session, original credential family, workspace permission and exact Ed25519 proof under one owner lock. Exact retries return the same active device. POST /retire accepts the original expired/revoked credential and a distinct retirement signature, fences even a create not yet received, cancels uncompleted commands and preserves completed results. SQL001–127 remain unchanged.','SQL128 新增私有配对事实与不可逆退休。创建在所有者锁内核对当前 Desktop 会话、原凭据 family、企业权限及精确 Ed25519 证明；相同请求恢复同一有效设备。退休使用原过期／撤销凭据及独立签名，阻断尚未到达的创建、取消未完成命令并保留完成结果。SQL001–127 保留。'),
 'desktop':('Desktop 0.7.1: choose a local folder, then Pair cloud scheduling. Failed old-device retirement stops replacement. A committed create with a lost reply keeps its encrypted exact intent; retry recovers the same device. Changed grants retire the old intent first. Sign-out, account change and uninstall include unknown device IDs through their signed intent receipts. Local connection writes and cleanup serialize; late old-account replies cannot reconnect. The actual UI below includes controlled post-commit HTTP503 and real company API recovery.','Desktop 0.7.1：明确选择资料夹后配对云端排程。旧设备撤销失败即停止替换；已提交创建的回应丢失时保留加密原请求，重试恢复同一设备。授权变化先退休旧意图。退出、换账户及卸载均通过签名意图覆盖未知设备 ID；本机连接写入与清理串行，旧账户迟到响应不重新接入。下方实际界面包含明确的提交后 HTTP503 注入与公司 API 恢复。'),
 'web':('Web Devices reflects retirement of the original, recovered and unacknowledged Desktop pairings while retaining the other computer. New Desktop login still uses actual Web authorization/PKCE and does not restore prior local grants. No new Web screen is claimed.','Web 设备页展示原设备、已恢复配对及未确认配对的退休状态，保留另一台电脑。Desktop 新登录继续使用真实 Web 授权／PKCE，不恢复旧本机权限；本轮不宣称新增 Web 页面。'),
 'admin':('Successful pairing and one-time retirement append owner/device/intent audit metadata. Existing scoped user, usage, billing/VIP and audit permissions apply. This increment changes the native lifecycle and server checks; its screenshots show actual Desktop/Web, not a new Admin screen.','创建及首次退休追加用户／设备／意图审计元资料，沿用既有范围化用户、消耗、费用／VIP 与审计权限。本轮实现本机生命周期和服务端守卫，截图展示真实 Desktop／Web 流程。'),
 'extension':('The genuine Chrome right Side Panel retains cloud Codex and customer-selected uploads. Its optional Desktop folder bridge stops after Desktop withdrawal. Reconnect through a new Desktop login and explicit local folder permission; ordinary chosen-file upload keeps its independent flow.','Chrome 原生右侧 Side Panel 保留云端 Codex 与客户选择附件上传。可选 Desktop 目录桥接在本机撤权后停止；重新登录 Desktop 并明确授权目录后再连接，直接选档上传维持自身流程。'),
 'delivery':('Run node scripts/run-native-pairing-v1.mjs NN core|native|clients and the selected run-native-pairing-ui-vN.mjs NN with fresh attempt numbers. Native PostgreSQL, Windows encryption, Electron IPC and Host cleanup are real; post-commit 503, model/accounts and native-dialog answers are explicit fixtures. Preserve failures, raw TAP, exact archives and owned resource closure.','使用全新编号运行 run-native-pairing-v1.mjs NN core|native|clients 及选定 run-native-pairing-ui-vN.mjs NN。原生 PostgreSQL、Windows 加密、Electron IPC 和 Host 清理为真实运行；提交后503、模型／账户及原生确认答案为明确夹具。保留失败、TAP、精确快照与自建资源关闭证据。')}

def sync_primary(changes):
    archive=Q/'history/stage118-previous-documents';rows=[]
    for name in ['docs/technical/01-architecture-and-stack.md','docs/technical/12-implementation-and-repositories.md','docs/modules/07-web-extension-desktop.md','docs/quality/04-implementation-acceptance.md','docs/quality/01-test-and-acceptance-plan.md']:
        p=ROOT/name;old=p.read_bytes();assert MARKER.encode() not in old
        dest=archive/name;dest.parent.mkdir(parents=True,exist_ok=True);assert not dest.exists();dest.write_bytes(old);rows.append(ref(dest))
        title,body=old.split(b'\n',1)
        prefix=MARKER+'\nDesktop 0.7.1 已加入持久配对、精确创建重试、先于创建的退休、旧设备失败停止、账户迟到响应隔离及未知设备的卸载清理。SQL128 为向前迁移；完整产品、公司签名安装版本及真实模型验收继续保留。详见 [实现方案](../technical/118-recoverable-native-pairings.md) 与 [准确证据](../quality/native-pairing-checkpoint.json)。\n\n'
        p.write_bytes(title+b'\n\n'+prefix.encode()+body)
        changes.append({'path':name,'before_sha256':sha256(old).hexdigest(),'after_sha256':digest(p)})
    write(archive/'receipt.json',{'retained_files':rows,'scope':'Exact primary documents before Stage118 synchronization'})

def sync():
    cp = read(CP)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    changes, copies = [], []
    media = cp['screenshots'] + [f for m in cp['recordings'] for f in m['files']]
    diagram = '```mermaid\nflowchart LR\n  Customer[Explicit folder pairing] --> Intent[Durable signed intent]\n  Intent --> Pair[Current session and atomic create]\n  Pair --> Retry[Same device on retry]\n  Intent --> Retire[Sign-out or uninstall]\n  Retire --> Fence[Permanent private retirement]\n  Fence --> Receipt[Confirmed or durable pending receipt]\n```\n'
    counts = cp['counts']
    numbers = f"{counts['backend']['tests']} backend + {counts['desktop-unit']['tests']} Desktop + {counts['native-codex']['tests']} native Codex checks; 13 builds; 7 real UI flows; 5 layouts; 2 GIF/MP4 pairs"
    for component in ['docs'] + COMPONENTS:
        folder = ROOT / 'docs' if component == 'docs' else DEV / ('copypaste-' + component)
        chosen = media if component in ['docs', 'delivery'] else [r for r in media if r['path'].startswith('copypaste-' + component + '/')]
        if not chosen: chosen = [cp['screenshots'][0], *cp['recordings'][0]['files']]
        for row in chosen:
            src = DEV / row['path']
            relative = ('design/implementation/' if component == 'docs' else 'media/') + 'native-pairing-' + Path(row['path']).parts[0] + '__' + src.name
            dst = folder / relative
            dst.parent.mkdir(parents=True, exist_ok=True)
            assert not dst.exists()
            shutil.copyfile(src, dst)
            assert digest(dst) == row['sha256']
            copies.append({'source': src.relative_to(ROOT).as_posix(), 'target': dst.relative_to(ROOT).as_posix(), 'sha256': digest(dst)})
        for name in ['README.md', 'README.en.md']:
            p = folder / name
            old = p.read_bytes()
            assert MARKER.encode() not in old
            title, body = old.split(b'\n', 1)
            en = name.endswith('.en.md')
            text = MARKER + '\n' + ('Desktop 0.7.1 adds durable native device pairing, exact retry and permanent intent retirement.\n\n' if en else 'Desktop 0.7.1 已加入持久本机配对、精确重试及不可逆意图退休。\n\n')
            if component in DETAILS: text += DETAILS[component][0 if en else 1] + '\n\n'
            text += ('Validation: ' if en else '验证：') + numbers + '.\n\n'
            text += ('Real Windows DPAPI, owned Native Host, Electron IPC, Web PKCE and native PostgreSQL; synthetic customer/model data. Native consent answers and shell launch interception belong to the isolated automation. Company-signed installed-product uninstall/upgrade, macOS and complete product/live-model acceptance remain unqualified.\n\n' if en else 'Windows DPAPI、自建 Native Host、Electron IPC、Web PKCE 和原生 PostgreSQL 为实际运行；客户／模型为假数据。原生确认答案和 shell 调度在隔离核查进程内控制。公司签名安装版本的卸载／升级、macOS、完整产品与真实模型验收仍未证明。\n\n')
            prefix = '' if component == 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
            text += '[Runbook / 方案](' + prefix + RUNBOOK + ') · [Evidence / 证据](' + prefix + 'quality/native-pairing-checkpoint.json)\n\n' + diagram + '\n'
            for row in chosen:
                target = ('design/implementation/' if component == 'docs' else 'media/') + 'native-pairing-' + Path(row['path']).parts[0] + '__' + Path(row['path']).name
                text += ('![Actual Desktop/Web pairing and retirement / 实际配对与撤权界面](' + target + ')' if Path(row['path']).suffix in ['.png', '.gif'] else '[Actual interaction video / 实际交互视频](' + target + ')') + '\n\n'
            p.write_bytes(title + b'\n\n' + text.encode() + body)
            changes.append({'path': p.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(p)})
    progress_path = Q / 'requirements-alignment-progress.json'
    old = progress_path.read_bytes()
    progress = read(progress_path)
    progress['native_pairing'] = {'checkpoint': ref(CP), 'counts': counts, 'actual_ui_flows': 7, 'company_signed_uninstall_qualified': False, 'original_requirements_modified': False, 'full_acceptance': 'not_proven'}
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    changes.append({'path': progress_path.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(progress_path)})
    for en in [False, True]:
        p = ROOT / ('docs/changes/2026-10-28-controlled-native-pairing' + ('.en' if en else '') + '.md')
        assert not p.exists()
        p.write_text(('# Recoverable Desktop device pairing\n\n' if en else '# Desktop 可恢复设备配对\n\n') +
            (DETAILS['desktop'][0 if en else 1]) + '\n\n' + numbers + '.\n\n' +
            ('Native Windows encryption, Host and application flows are real. Company-signed installed-app uninstall/upgrade and full-product/live-model acceptance remain unqualified. Original failed attempts are retained.\n\n' if en else '原生 Windows 加密、Host 及应用流程为实际运行。公司签名安装版本的卸载／升级、完整产品和真实模型验收仍未证明；原始失败尝试完整保留。\n\n') +
            '[Runbook / 方案](../' + RUNBOOK + ') · [Evidence / 证据](../quality/native-pairing-checkpoint.json)\n', encoding='utf-8', newline='\n')
    sync_primary(changes)
    write(Q / 'native-pairing-documentation-refresh.json', {'checkpoint': ref(CP), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})


def audit():
    from markdown_it import MarkdownIt
    from urllib.parse import urlsplit, unquote
    cp, refresh = read(CP), read(Q / 'native-pairing-documentation-refresh.json')
    assert cp['verifier_sha256'] == refresh['verifier_sha256'] == digest(Path(__file__))
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    for row in refresh['changes']: assert digest(ROOT / row['path']) == row['after_sha256']
    for row in refresh['media_copies']: assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    links, decoded, parser = 0, [], MarkdownIt()
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        for name in ['README.md', 'README.en.md']:
            p = folder / name
            body = p.read_text('utf-8')
            assert MARKER in body
            for token in parser.parse(body):
                for child in token.children or []:
                    target = child.attrGet('src') if child.type == 'image' else child.attrGet('href') if child.type == 'link_open' else None
                    if target and not urlsplit(target).scheme and not target.startswith('#'):
                        assert (p.parent / unquote(urlsplit(target).path)).exists(), (p, target)
                        links += 1
    for movie in cp['recordings']:
        for row in movie['files']:
            p = DEV / row['path']
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames:format=duration', '-of', 'json', str(p)]))
            assert int(probe['streams'][0]['nb_read_frames']) > 1 and abs(float(probe['format']['duration']) - movie['seconds']) <= .25
            result = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(p), '-map', '0:v:0', '-f', 'null', '-'], capture_output=True, check=True)
            assert not result.stderr.strip()
            decoded.append(row)
    original = read(Q / 'history/stage96-before-solution-packages/receipt.json')
    progress = read(Q / 'requirements-alignment-progress.json')
    assert progress['requirements'] == original['requirements'] and progress['gates'] == original['gates']
    write(Q / 'native-pairing-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP), 'bilingual_readmes': 14, 'local_readme_links': links, 'decoded_recordings': decoded, 'original_matrix_unchanged': True, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'decoded': len(decoded)}))



if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['record','sync','audit'])
    for name,default in [('core','01'),('native','01'),('ui','01'),('clients','01'),('package','01'),('ui-version','1')]:p.add_argument('--'+name,default=default)
    a=p.parse_args()
    if a.action=='record':record(a.core,a.native,a.ui,a.clients,a.package,a.ui_version)
    elif a.action=='sync':sync()
    else:audit()
