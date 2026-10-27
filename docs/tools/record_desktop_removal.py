"""Bind actual Desktop withdrawal, native guards, source deltas and delivery guides."""
from datetime import datetime,timezone
from pathlib import Path
from hashlib import sha256
import argparse
import difflib
import json
import re
import shutil
import subprocess
from record_cloud_events import ROOT,DEV,L,Q,COMPONENTS,read,digest,ref,write,checked

CP=Q/'desktop-removal-checkpoint.json'
RUNBOOK='technical/117-desktop-removal.md'
MARKER='<!-- desktop-removal-stage117 -->'

def record(core,native,ui,clients,package,ui_version):
    selected=[L/f'evidence/desktop-removal-{scope}-{attempt}.json' for scope,attempt in [('core',core),('native',native),('ui',ui),('clients',clients)]]
    backend,local,browser,builds=[checked(p) for p in selected]
    for value in [backend,local,browser,builds]:
        assert value['status']=='passed' and value['owned_database_shutdown']
        assert all(c['exit_code']==0 for c in value['checks'])
    for value in [backend,local,builds]:assert value['verifier_sha256']==digest(L/'scripts/run-desktop-removal-v1.mjs')
    assert browser['verifier_sha256']==digest(L/f'scripts/run-desktop-removal-ui-v{ui_version}.mjs')
    assert browser['journey_verifier_sha256']==digest(L/f'scripts/qa-desktop-removal-ui-v{ui_version}.ts')
    counts={'backend':next(c['counts'] for c in backend['checks'] if c['name']=='backend'),**{c['name']:c['counts'] for c in local['checks'] if 'counts' in c}}
    for count in counts.values():
        assert count['tests']==count['pass']>0
        assert all(count[k]==0 for k in ['fail','cancelled','skipped','todo'])
    assert counts['backend']['tests']==79 and counts['desktop-unit']['tests']==127 and counts['native-codex']['tests']==22
    command=next(c['args'] for c in backend['checks'] if c['name']=='backend')
    assert {a for a in command if a.startswith('tests/')}=={'tests/'+n+'.test.ts' for n in ['desktop-disconnect','desktop-updates','auth-sessions','client-content','admin-identities','migrations','auth-contract','native-recovery']}
    command=next(c['args'] for c in local['checks'] if c['name']=='desktop-unit')
    assert {'tests/desktop-removal.test.ts','tests/desktop-removal.native.test.ts','tests/native-session.test.ts'}.issubset(command)
    jp=L/browser['journey']['path'];assert digest(jp)==browser['journey']['sha256']
    journey=read(jp)
    assert journey['status']=='passed' and not journey['errors']
    assert len(journey['checks'])==5 and len(journey['screenshots'])==4 and len(journey['recordings'])==1 and len(journey['layouts'])==4
    assert all(journey[k] for k in ['electron_closed','browser_closed','api_closed','fixture_closed','native_host_closed'])
    assert browser['owned_preview_closed'] and len(builds['checks'])==13
    for layout in journey['layouts']:
        assert not layout['document_horizontal'] and not layout['root_horizontal']
        if 'Desktop' in layout['label'] or 'withdrawal' in layout['label'] and not layout['label'].startswith('Web'):
            assert layout['visible_vertical_rails']==0 and layout['root_top']==40
    for movie in journey['recordings']:assert movie['distinct_frames']>1 and movie['skipped_capture_errors']==0
    nsis_path=L/'evidence/desktop-removal-nsis-01.json';nsis=read(nsis_path)
    assert nsis['status']=='passed' and nsis['source_unchanged'] and len(nsis['checks'])==8
    assert nsis['verifier_sha256']==digest(ROOT/'docs/tools/check_desktop_removal_nsis.py')
    assert nsis['nsis_lifecycle']==ref(DEV/'copypaste-desktop/scripts/desktop-lifecycle.nsh')
    for row in nsis['evidence_files']:assert row==ref(ROOT/row['path'])
    # Runtime/test sources never change between the passing unit suites and UI.
    # The only edited product file is the NSIS initializer's added ClearErrors,
    # covered by the actual eight-case NSIS harness and final real NSIS build.
    # Added UI verifier versions are themselves compiled/executed and archived.
    sources={'dev/'+name:expected for name,expected in builds['source_files'].items()}
    deltas=[]
    for p,value in zip(selected,[backend,local,browser,builds]):
        archive=p.with_suffix('').with_name(p.stem+'-sources')
        assert set(value['source_files']).issubset(builds['source_files']),p
        for name,expected in value['source_files'].items():
            assert digest(archive/name)==expected,(p,name)
            current=builds['source_files'][name]
            if current!=expected:
                assert p in selected[:2] and name=='copypaste-desktop/scripts/desktop-lifecycle.nsh',(p,name)
                changes=[line.rstrip('\r\n') for line in difflib.unified_diff((archive/name).read_text('utf-8').splitlines(keepends=True),(DEV/name).read_text('utf-8').splitlines(keepends=True)) if line[:1] in ['+','-'] and not line.startswith(('+++','---'))]
                assert changes==['+  ClearErrors'],changes
                deltas.append({'qualification':ref(p),'path':'dev/'+name,'qualified_sha256':expected,'current_sha256':current,'exact_change':'Add ClearErrors after optional --delete-app-data lookup; no runtime or test change','covered_by':ref(nsis_path)})
        for name in sorted(set(builds['source_files'])-set(value['source_files'])):
            assert re.fullmatch(r'copypaste-delivery/scripts/(?:qa-desktop-removal-ui-v[2-9]\.ts|run-desktop-removal-ui-v[2-9]\.mjs)',name),name
            deltas.append({'qualification':ref(p),'path':'dev/'+name,'current_sha256':builds['source_files'][name],'exact_change':'Additive immutable UI verifier version, typechecked and executed by selected UI qualification','covered_by':ref(selected[2])})
    for name,expected in sources.items():assert digest(ROOT/name)==expected,name
    contract=ROOT/'docs/contracts/desktop-removal.openapi.json';mirror=DEV/'copypaste-platform/contracts/desktop-removal-schemas.json'
    assert read(contract)['x-runtime-schema-sha256']==digest(mirror) and read(contract)['components']['schemas']==read(mirror)['schemas']
    assert len(read(contract)['paths'])==1
    sources[contract.relative_to(ROOT).as_posix()]=digest(contract)
    assert (DEV/'copypaste-platform/src/desktop-disconnect-contract.ts').read_bytes()==(DEV/'copypaste-desktop/src/desktop-disconnect-contract.ts').read_bytes()
    previous_cp=Q/'desktop-updates-final-checkpoint.json'
    for name,expected in read(previous_cp)['source_files'].items():
        if name.startswith('dev/copypaste-platform/migrations/'):assert sources[name]==expected,name
    for row in journey['screenshots']+[f for movie in journey['recordings'] for f in movie['files']]:assert digest(DEV/row['path'])==row['sha256']
    package_path=L/f'evidence/desktop-removal-package-{package}.json';bundle=read(package_path)
    assert bundle['status']=='passed' and bundle['source_unchanged'] and bundle['source_files']==builds['source_files']
    assert bundle['verifier_sha256']==digest(ROOT/'docs/tools/record_desktop_removal_package.py')
    assert digest(L/bundle['raw_report']['path'])==bundle['raw_report']['sha256']
    assert bundle['packaged']['version']=='0.7.0' and not bundle['installer_executed'] and not bundle['company_signed']
    assert bundle['nsis_lifecycle']==nsis['nsis_lifecycle']
    assert bundle['verification_log']==ref(ROOT/bundle['verification_log']['path'])
    for row in bundle['packaged']['artifacts']:assert row=={**ref(ROOT/row['path']),'bytes':(ROOT/row['path']).stat().st_size}
    original=read(Q/'history/stage96-before-solution-packages/receipt.json');progress=read(Q/'requirements-alignment-progress.json')
    assert progress['requirements']==original['requirements'] and progress['gates']==original['gates']
    assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
    prior=Q/'history/stage117-previous-publication.json';prior.parent.mkdir(parents=True,exist_ok=True)
    if not prior.exists():shutil.copyfile(Q/'workmate-publication.json',prior)
    assert digest(prior)==digest(Q/'workmate-publication.json')
    prep=L/'.data/preparation/desktop-removal-117/receipt.json';baseline=Q/'history/stage117-before-desktop-removal/receipt.json'
    baseline.parent.mkdir(parents=True,exist_ok=True);assert not baseline.exists();shutil.copyfile(prep,baseline)
    attempts=[]
    for p in sorted((L/'evidence').glob('desktop-removal-*-??.json')):
        value=read(p)
        if 'source_files' in value:checked(p)
        attempts.append({**ref(p),'status':value['status'],'error':value.get('error')})
    write(CP,dict(at=datetime.now(timezone.utc).isoformat(),stage=117,status='verified_desktop_withdrawal',
        scope='Windows x64 Desktop 0.7.0 customer-confirmed local withdrawal and uninstall preparation: local Codex/program/schedule/browser shutdown, durable encrypted device-signed outbox, own refresh-family and proven-device revocation, shared Host fences/leases, per-user manifest/launcher registry ownership, bounded cache removal, native Windows uninstall hooks, fresh Web PKCE reconnection without restoring old grants. Real native PostgreSQL, Windows DPAPI, bundled Node Host, Electron and NSIS macro execution. Synthetic accounts/models; automated native-consent/shell answers; no company-signed installed-product uninstall/upgrade, macOS or full-product/live acceptance.',
        source_files=dict(sorted(sources.items())),selected_core=ref(selected[0]),selected_native=ref(selected[1]),selected_ui=ref(selected[2]),client_builds=ref(selected[3]),
        counts=counts,build_checks=13,journey=ref(jp),actual_ui_checks=5,screenshots=journey['screenshots'],recordings=journey['recordings'],layouts=journey['layouts'],
        nsis_hook_checks=ref(nsis_path),native_nsis_cases=8,qualification_source_deltas=deltas,attempts=attempts,new_migrations=[],retained_stage116=ref(previous_cp),
        previous_publication=ref(prior),baseline=ref(baseline),api_contract=ref(contract),native_codex=local['native_codex'],product_version='0.7.0',development_package=ref(package_path),
        company_signed_uninstall_qualified=False,installer_executed=False,original_requirements_modified=False,fully_accepted_requirements=0,qualified_live_roles=0,live_provider_qualified=False,
        verifier_sha256=digest(Path(__file__))))
    print(json.dumps({'status':'verified_desktop_withdrawal','counts':counts,'sources':len(sources),'ui':5,'nsis':8,'documented_source_deltas':len(deltas)}))

DETAILS={
 'platform':('POST /v1/auth/native/disconnect accepts a bounded, strict Desktop withdrawal body. The original refresh credential revokes its own family; each device also needs its Ed25519 proof, exact tenant/device and matching credential owner. Expired/used/revoked credentials can retire access; foreign/Extension/invalid proofs remain unverified. Cancel pending/claimed commands, preserve completed results and audit one-way retirement. SQL001–127 remain unchanged. Runtime schemas and the OpenAPI supplement are bound to the actual route.',
 'POST /v1/auth/native/disconnect 使用严格、有界的 Desktop 撤权请求。原 refresh 只撤销其原 family；每台设备还必须通过自身 Ed25519 签名、准确 tenant/device 及凭据所有者验证。已过期／使用／撤销的凭据仍可撤权；异主、Extension 或错误证明统一未验证。取消待处理／已认领文件命令，保留完成结果并记录单向撤权审计。SQL001–127 不变，运行时 schema 与 OpenAPI 绑定实际路由。'),
 'desktop':('Desktop 0.7.0: open This computer and uninstall from the frameless title bar or account settings. Disconnect → native confirmation with optional cache cleanup → durable encrypted proofs → local Codex/folder/program/browser shutdown → Host exit and owned Chrome registration removal → confirmed cloud device withdrawal or an explicit retry receipt. Open Windows uninstall only after local preparation; the NSIS removal hook confirms again before deleting installation files and rejects --delete-app-data. Reopen/reinstall to retry offline withdrawal. Fresh Web authorization and PKCE login never restore old grants. Customer originals, workspaces and uncertain settlement receipts remain. Production release packaging requires company signing credentials.',
 'Desktop 0.7.0：从无边框标题栏或账户设置进入“此电脑与卸载”。断开→原生确认及可选缓存清理→持久加密签名请求→停止本机 Codex／目录任务／程序／浏览器→Host 退出并移除本安装 Chrome 注册→云端确认或明确待重试回执。本机准备完成后可打开 Windows 卸载；NSIS 在删除安装文件前再次确认，并拒绝 --delete-app-data。重新打开或重装后可重试离线撤权；新的 Web 授权和 PKCE 登录不会恢复旧授权。保留客户原檔、工作目录及不确定结算记录。正式发布打包仍需要公司签名凭据。'),
 'web':('Web Devices reflects a signed Desktop withdrawal while retaining other computers. The same browser session can grant a fresh Desktop PKCE login after withdrawal; it does not restore previous local folder or Chrome permissions. The screenshots below include the actual Web device state after the real company API processes the withdrawal.',
 'Web 设备页同步展示签名 Desktop 撤权结果，保留其他电脑。客户可在原浏览器账户中重新授权 Desktop 的 PKCE 登录，旧的本机目录和 Chrome 权限不会恢复。下方包含实际公司 API 处理撤权后，Web 设备列表的真实截图。'),
 'admin':('Desktop device/family withdrawals enter the existing management audit with user, device and request references. Existing user, usage, billing/VIP and audit permission controls continue to apply. This increment documents the native lifecycle and its Desktop/Web evidence; it does not claim a new Admin screen or a company-signed uninstall recording.',
 'Desktop 设备／会话撤权进入现有管理审计，保留用户、设备和请求关联；既有用户、消耗、费用／VIP 和审计权限控制继续适用。本增量的截图展示实际 Desktop／Web 撤权流程，方案明确区分已有后台管理能力与本次本机生命周期实现。'),
 'extension':('The right native Chrome Side Panel continues to chat and upload selected files to cloud Codex. A disconnected Desktop stops its running file Host and withdraws folder grants/origin registration. To use that optional local folder bridge again, complete a new Desktop login and explicitly reconnect Chrome and grant folders. Ordinary customer-selected file upload remains available through its own permission flow.',
 '原生 Chrome 右侧 Side Panel 继续对话并把客户选取文件上传给云端 Codex。断开 Desktop 会停止其运行中的文件 Host，并撤销目录、来源和本安装注册。再次使用该本机目录桥接须重新登入 Desktop、明确连接 Chrome 并再次授权目录；客户直接选择附件上传仍走自身的授权流程。'),
 'delivery':('Reproduce with node scripts/run-desktop-removal-v1.mjs NN core|native|clients and the selected run-desktop-removal-ui-vN.mjs NN; use a fresh two-digit attempt. Root documentation tools qualify the actual NSIS hooks and development installers. Preserve original failures, raw TAP, source archives and executed verifier versions. Suites close owned PostgreSQL, browser, Electron and Native Host resources. Docker, WSL and other virtualization are prohibited.',
 '使用 node scripts/run-desktop-removal-v1.mjs NN core|native|clients，以及选定版本 run-desktop-removal-ui-vN.mjs NN 复现；每次使用新的两位编号。项目文档工具验证实际 NSIS 钩子与开发安装包，保留原始失败、TAP、源码快照及已执行核查版本。套件结束关闭自建 PostgreSQL、浏览器、Electron 和 Native Host；禁止 Docker、WSL 及其他虚拟化。')}

def sync_primary(changes):
    archive=Q/'history/stage117-previous-documents';rows=[]
    for name in ['docs/technical/01-architecture-and-stack.md','docs/technical/12-implementation-and-repositories.md','docs/modules/07-web-extension-desktop.md','docs/quality/04-implementation-acceptance.md','docs/quality/01-test-and-acceptance-plan.md']:
        p=ROOT/name;old=p.read_bytes();assert MARKER.encode() not in old
        dest=archive/name;dest.parent.mkdir(parents=True,exist_ok=True);assert not dest.exists();dest.write_bytes(old);rows.append(ref(dest))
        title,body=old.split(b'\n',1)
        prefix=MARKER+'\nDesktop 0.7.0 已接通原生确认、本机 Codex／文件／程序／浏览器撤权、设备签名云端断开、Host 退出与注册归属检查、可选安全缓存清理、Windows 卸载钩子及重新 PKCE 登录。离线与未验证结果保留加密待发回执。公司签名已安装产品卸载／升级和原始完整产品验收仍未证明。详见 [实现方案](../technical/117-desktop-removal.md) 与 [准确证据](../quality/desktop-removal-checkpoint.json)。\n\n'
        p.write_bytes(title+b'\n\n'+prefix.encode()+body)
        changes.append({'path':name,'before_sha256':sha256(old).hexdigest(),'after_sha256':digest(p)})
    write(archive/'receipt.json',{'retained_files':rows,'scope':'Exact primary documents before Stage117 synchronization'})

def sync():
    cp = read(CP)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    changes, copies = [], []
    media = cp['screenshots'] + [f for m in cp['recordings'] for f in m['files']]
    diagram = '```mermaid\nflowchart LR\n  Customer[Native customer confirmation] --> Outbox[Encrypted signed withdrawal]\n  Outbox --> Stop[Stop local Codex and revoke grants]\n  Stop --> Host[Owned Host exit and registry check]\n  Host --> Company[Company device retirement]\n  Company --> Receipt[Confirmed or durable retry receipt]\n  Receipt --> Windows[Windows uninstall with preparation hook]\n```\n'
    counts = cp['counts']
    numbers = f"{counts['backend']['tests']} backend + {counts['desktop-unit']['tests']} Desktop + {counts['native-codex']['tests']} native Codex checks; 13 builds; 5 real UI flows; 4 layouts; 1 GIF/MP4 pair"
    for component in ['docs'] + COMPONENTS:
        folder = ROOT / 'docs' if component == 'docs' else DEV / ('copypaste-' + component)
        chosen = media if component in ['docs', 'delivery'] else [r for r in media if r['path'].startswith('copypaste-' + component + '/')]
        if not chosen: chosen = [cp['screenshots'][0], *cp['recordings'][0]['files']]
        for row in chosen:
            src = DEV / row['path']
            relative = ('design/implementation/' if component == 'docs' else 'media/') + 'desktop-removal-' + Path(row['path']).parts[0] + '__' + src.name
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
            text = MARKER + '\n' + ('Desktop 0.7.0 adds confirmed local withdrawal, signed device retirement, Chrome Host cleanup and optional safe cache removal.\n\n' if en else 'Desktop 0.7.0 已加入本机确认撤权、设备签名断开、Chrome Host 清理及可选缓存清理。\n\n')
            if component in DETAILS: text += DETAILS[component][0 if en else 1] + '\n\n'
            text += ('Validation: ' if en else '验证：') + numbers + '.\n\n'
            text += ('Real Windows DPAPI, owned Native Host, Electron IPC, Web PKCE and native PostgreSQL; synthetic customer/model data. Native consent answers and shell launch interception belong to the isolated automation. Company-signed installed-product uninstall/upgrade, macOS and complete product/live-model acceptance remain unqualified.\n\n' if en else 'Windows DPAPI、自建 Native Host、Electron IPC、Web PKCE 和原生 PostgreSQL 为实际运行；客户／模型为假数据。原生确认答案和 shell 调度在隔离核查进程内控制。公司签名安装版本的卸载／升级、macOS、完整产品与真实模型验收仍未证明。\n\n')
            prefix = '' if component == 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
            text += '[Runbook / 方案](' + prefix + RUNBOOK + ') · [Evidence / 证据](' + prefix + 'quality/desktop-removal-checkpoint.json)\n\n' + diagram + '\n'
            for row in chosen:
                target = ('design/implementation/' if component == 'docs' else 'media/') + 'desktop-removal-' + Path(row['path']).parts[0] + '__' + Path(row['path']).name
                text += ('![Actual Desktop/Web withdrawal UI / 实际撤权界面](' + target + ')' if Path(row['path']).suffix in ['.png', '.gif'] else '[Actual interaction video / 实际交互视频](' + target + ')') + '\n\n'
            p.write_bytes(title + b'\n\n' + text.encode() + body)
            changes.append({'path': p.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(p)})
    progress_path = Q / 'requirements-alignment-progress.json'
    old = progress_path.read_bytes()
    progress = read(progress_path)
    progress['desktop_withdrawal'] = {'checkpoint': ref(CP), 'counts': counts, 'actual_ui_flows': 5, 'company_signed_uninstall_qualified': False, 'original_requirements_modified': False, 'full_acceptance': 'not_proven'}
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    changes.append({'path': progress_path.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(progress_path)})
    for en in [False, True]:
        p = ROOT / ('docs/changes/2026-10-28-controlled-desktop-removal' + ('.en' if en else '') + '.md')
        assert not p.exists()
        p.write_text(('# Desktop withdrawal and removal\n\n' if en else '# Desktop 断开与卸载\n\n') +
            (DETAILS['desktop'][0 if en else 1]) + '\n\n' + numbers + '.\n\n' +
            ('Native Windows encryption, Host and application flows are real. Company-signed installed-app uninstall/upgrade and full-product/live-model acceptance remain unqualified. Original failed attempts are retained.\n\n' if en else '原生 Windows 加密、Host 及应用流程为实际运行。公司签名安装版本的卸载／升级、完整产品和真实模型验收仍未证明；原始失败尝试完整保留。\n\n') +
            '[Runbook / 方案](../' + RUNBOOK + ') · [Evidence / 证据](../quality/desktop-removal-checkpoint.json)\n', encoding='utf-8', newline='\n')
    sync_primary(changes)
    write(Q / 'desktop-removal-documentation-refresh.json', {'checkpoint': ref(CP), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})


def audit():
    from markdown_it import MarkdownIt
    from urllib.parse import urlsplit, unquote
    cp, refresh = read(CP), read(Q / 'desktop-removal-documentation-refresh.json')
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
    write(Q / 'desktop-removal-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP), 'bilingual_readmes': 14, 'local_readme_links': links, 'decoded_recordings': decoded, 'original_matrix_unchanged': True, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'decoded': len(decoded)}))



if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['record','sync','audit'])
    for name,default in [('core','01'),('native','01'),('ui','02'),('clients','01'),('package','01'),('ui-version','2')]:parser.add_argument('--'+name,default=default)
    args=parser.parse_args()
    if args.action=='record':record(args.core,args.native,args.ui,args.clients,args.package,args.ui_version)
    elif args.action=='sync':sync()
    else:audit()
