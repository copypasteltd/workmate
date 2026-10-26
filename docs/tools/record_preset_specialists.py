"""Bind native-method evidence, bilingual delivery and actual media without changing product sources."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse
import json
import re
import shutil
import subprocess

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
QUALITY = ROOT / 'docs/quality'
COMPONENTS = ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']


def digest(p):
    return sha256(p.read_bytes()).hexdigest()


def read(p):
    return json.loads(p.read_text(encoding='utf-8'))


def ref(p):
    return {'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p)}


def write_new(p, value):
    with p.open('x', encoding='utf-8', newline='\n') as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write('\n')


def record(args):
    chosen = {k: 'evidence/preset-specialists-' + k + '-' + getattr(args, k) + '.json' for k in ['core', 'native', 'ui']}
    reports = {k: read(DELIVERY / v) for k, v in chosen.items()}
    sources, scopes = {}, []
    for k, r in reports.items():
        assert r['status'] == 'passed' and r['source_unchanged'], k
        for name, expected in r['source_files'].items():
            path = DEV / ('copypaste-desktop' if k == 'native' else '') / name
            assert digest(path) == expected, path
            relative = path.relative_to(ROOT).as_posix()
            assert relative not in sources or sources[relative] == expected
            sources[relative] = expected
        scopes.append({'kind': k, **ref(DELIVERY / chosen[k]), 'source_files': len(r['source_files'])})
    core, native, ui = (reports[k] for k in ['core', 'native', 'ui'])
    assert core['counts']['tests'] == core['counts']['pass'] and core['counts']['fail'] == 0
    assert core['owned_database_shutdown'] and len(core['test_files']) == 15
    assert native['counts']['pass'] == native['counts']['tests'] == 2
    assert native['unit_counts']['pass'] == native['unit_counts']['tests'] == 51
    assert ui['packaged_unchanged'] and ui['owned_database_shutdown'] and ui['owned_preview_closed']
    assert ui['fixture_cleanup']['status'] == 'passed' and all(v['reclaimed'] for v in ui['fixture_cleanup']['results'])
    journey_path = DELIVERY / ui['journey']['path']
    assert digest(journey_path) == ui['journey']['sha256']
    journey = read(journey_path)
    assert journey['status'] == 'passed' and not journey['errors'] and len(journey['checks']) == 7
    assert all(journey[k] for k in ['electron_closed', 'browser_closed', 'api_closed', 'fixture_closed'])
    assert journey['provider_calls'] == 2 and len(journey['native_tasks']) == 1
    assert all(t['execution_location'] == 'desktop' and t['status'] == 'succeeded' and int(t['charged_micros']) > 0 for t in journey['native_tasks'])
    assert len(journey['screenshots']) == 4 and journey['media']['distinct_frames'] > 1 and journey['media']['skipped_capture_errors'] == 0
    for row in journey['screenshots'] + journey['media']['files']:
        assert digest(DEV / row['path']) == row['sha256']
    for row in journey['screenshots']:
        assert row['edited'] is False
    prior = read(QUALITY / 'native-methods-checkpoint.json')
    baseline = read(ROOT / prior['preservation']['receipt']['path'])
    for name, expected in baseline['published_files'].items():
        assert digest(ROOT / name) == expected, name
    assert len(baseline['published_files']) == 646
    for row in prior['new_migrations']:
        assert digest(ROOT / row['path']) == row['sha256']
    contract = 'dev/copypaste-platform/contracts/solution-packages-v1.schema.json'
    assert digest(ROOT / contract) == prior['source_files'][contract]
    progress = read(QUALITY / 'requirements-alignment-progress.json')
    assert progress['requirements'] == baseline['requirements'] and progress['gates'] == baseline['gates']
    assert dict(Counter(v['assessment'] for v in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    attempts, raw, archived = [], [], 0
    for p in sorted((DELIVERY / 'evidence').glob('preset-specialists-*')):
        if p.is_file():
            raw.append(ref(p))
            if re.fullmatch(r'preset-specialists-(core|native|ui)-\d{2}\.json', p.name):
                r = read(p)
                attempts.append({**ref(p), 'status': r['status'], 'selected': p in [DELIVERY / v for v in chosen.values()]})
                if '-native-' in p.name:
                    for name, expected in r['source_files'].items():
                        archive = p.with_suffix('') / name
                        archive = Path(str(p.with_suffix('')) + '-sources') / name
                        assert digest(archive) == expected, archive
                        archived += 1
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 98, 'status': 'verified_scoped_preset_specialists',
        'scope': 'Saved preset specialists, immutable project brand revisions, native context and scoped tools; authenticated Web creation and actual packaged local Codex execution with observed usage. Fifteen related integration suites; synthetic model and credit. Original full acceptance remains unproven.',
        'selected': chosen, 'source_files': sources, 'qualification_scopes': scopes,
        'core_tests': core['counts'], 'test_files': core['test_files'], 'native_tests': native['counts'], 'desktop_unit_tests': native['unit_counts'],
        'ui_checks': 7, 'executions': journey['native_tasks'], 'screenshots': journey['screenshots'], 'recordings': [journey['media']],
        'packaged': ui['packaged'], 'all_attempts': attempts, 'raw_evidence': raw, 'exact_archived_source_files': archived,
        'new_migrations': [ref(DEV / 'copypaste-platform/migrations/114-preset-specialist-brand-bindings.sql')],
        'preservation': {'receipt': prior['preservation']['receipt'], 'published_files': 646, 'published_migrations': 113, 'prior_checkpoint': ref(QUALITY / 'native-methods-checkpoint.json'), 'original_requirements': 102, 'original_gates_unchanged': True},
        'not_validated': journey['not_validated'], 'verifier_sha256': digest(Path(__file__))}
    write_new(QUALITY / 'preset-specialists-checkpoint.json', result)
    print(json.dumps({'status':result['status'],'sources':len(sources),'attempts':len(attempts)}))


def sync():
    cpfile = QUALITY / 'preset-specialists-checkpoint.json'
    cp = read(cpfile)
    assert cp['status'] == 'verified_scoped_preset_specialists'
    changes, copies = [], []
    archive = QUALITY / 'history/stage98-documents'
    assert not archive.exists()
    archive.mkdir()

    def change(p, content):
        component = next((v for v in COMPONENTS if p.is_relative_to(DEV / ('copypaste-' + v))), None)
        repo = DEV / ('copypaste-' + component) if component else ROOT
        name = p.relative_to(repo).as_posix()
        before = subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','show','HEAD:' + name], cwd=repo)
        backup = archive / (component or 'docs') / name
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_bytes(before)
        p.write_bytes(content)
        changes.append({'path':p.relative_to(ROOT).as_posix(),'archive':backup.relative_to(ROOT).as_posix(),'before_sha256':sha256(before).hexdigest(),'before_source':'published_git_blob','after_sha256':digest(p)})

    folders = [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]
    for folder in [ROOT / 'docs', DEV / 'copypaste-delivery']:
        for item in cp['screenshots'] + [v for row in cp['recordings'] for v in row['files']]:
            source, target = DEV / item['path'], folder / 'assets/screenshots' / Path(item['path']).name
            target.parent.mkdir(parents=True, exist_ok=True)
            assert not target.exists()
            shutil.copyfile(source,target)
            copies.append({'source':source.relative_to(ROOT).as_posix(),'target':target.relative_to(ROOT).as_posix(),'sha256':digest(target)})
    for folder in folders:
        for filename in ['README.md','README.en.md']:
            p = folder / filename
            raw = p.read_bytes()
            assert b'<!-- native-methods-stage97 -->' in raw
            english = filename.endswith('.en.md')
            cpurl = 'quality/preset-specialists-checkpoint.json' if folder == ROOT / 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/preset-specialists-checkpoint.json'
            core_count = cp['core_tests']['pass']
            text = '<!-- preset-specialists-stage98 -->\n\n'
            text += ('Saved specialists now start local Codex from Desktop. Select a preset, lasting instructions and an exact project brand revision, save it after a free check, then choose a local folder, grant permissions and approve each turn budget. Web and Extension keep cloud execution. Later brand publications and specialist edits do not silently replace an existing native session’s saved version.\n\n' if english else 'Desktop 的「我的专家」现已直接启动本机 Codex。选择角色、长期工作要求和项目内固定品牌版本，免费预检保存后，选择本机目录、主动授权并确认每次预算。Web 与 Extension 保持云端执行。后续品牌发布或专家编辑不会悄悄替换既有本机会话的版本。\n\n')
            text += ((f'Verified: {core_count} related integration checks, 51 Desktop unit checks, two actual local Codex protocol probes and seven packaged Desktop / authenticated Web journey checks. ' if english else f'验证：{core_count} 项相关集成检查、51 项 Desktop 单元检查、2 项真实本机 Codex 协议检查及 7 项打包 Desktop / 登录 Web 流程检查通过。') + '[Current evidence / 当前证据](' + cpurl + ').\n\n')
            if folder == DEV/'copypaste-web':
                text += '![Actual Web fixed brand / 实际 Web 固定品牌](assets/screenshots/' + Path(cp['screenshots'][0]['path']).name + ')\n\n'
            if folder in [ROOT/'docs', DEV/'copypaste-desktop', DEV/'copypaste-delivery']:
                for row in [cp['screenshots'][2],cp['screenshots'][3]]:
                    text += '![Actual local saved specialist / 实际本机专家](assets/screenshots/' + Path(row['path']).name + ')\n\n'
                gif = next(v for v in cp['recordings'][0]['files'] if v['path'].endswith('.gif'))
                mp4 = next(v for v in cp['recordings'][0]['files'] if v['path'].endswith('.mp4'))
                text += '![Actual saved specialist execution / 实际专家执行](assets/screenshots/' + Path(gif['path']).name + ')\n\n[MP4](assets/screenshots/' + Path(mp4['path']).name + ')\n\n'
            marker = b'<!-- native-methods-stage97 -->'
            assert marker in raw
            change(p,raw.replace(marker,text.encode('utf-8') + marker,1))
    p = QUALITY / 'requirements-alignment-progress.json'
    progress = read(p)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['saved_preset_specialists'] = {'checkpoint':ref(cpfile),'current_sources':True,'core_tests':cp['core_tests']['pass'],'desktop_unit_tests':51,'native_tests':2,'ui_checks':7,'synthetic_model':True,'full_acceptance':'not_proven'}
    change(p,(json.dumps(progress,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    note = '\n\n## 阶段 98 固定专家与品牌 / Stage 98 saved specialists and brands\n\n预设角色可绑定当前项目的确切品牌版本；分页只选择元数据。Desktop 的「我的专家」直接创建固定专家版本的本机会话，客户独立选择目录和权限，再按次批准预算。保存的工作要求、品牌资料与获准记忆进入真实本机 Codex；公司工具限于专家配置范围。数据库保护同会话的专家引用和任务上下文，断线恢复沿用原正文与幂等键。Web/Extension 保留云端执行。\n\nPresets can pin an exact project brand revision. Desktop saved specialists create local sessions with a fixed specialist version; customers separately choose a folder, grant local permission and approve each turn budget. Saved instructions, brand guidance and authorized memories reach actual local Codex, and company tools respect the saved subset. Database guards preserve session references and task contexts; reconciliation reuses the original request and key. Web and Extension remain cloud agents.\n\n[Implementation / 设计](../technical/98-preset-specialists-and-brand-versions.md) · [Current evidence / 当前证据](../quality/preset-specialists-checkpoint.json)\n\n原始 102 项完整验收和 G01–G10 判定保留；测试使用授权的假模型与额度。Original full acceptance remains unchanged; synthetic models and credit support this scoped development verification.\n\n'
    for name in ['docs/requirements/01-srs.md','docs/modules/02-agents-tasks-memory.md','docs/quality/01-test-and-acceptance-plan.md','docs/governance/04-git-branches-and-publication.md']:
        p = ROOT / name
        title, body = p.read_bytes().split(b'\n',1)
        change(p,title+b'\n'+note.encode('utf-8')+body)
    for english in [False,True]:
        p = ROOT / ('docs/changes/2026-10-26-preset-specialists'+('.en' if english else '')+'.md')
        title = '# Saved specialists and pinned brand revisions' if english else '# 固定专家、品牌版本与本机执行'
        p.write_text(title+'\n'+note,encoding='utf-8',newline='\n')
    write_new(archive / 'receipt.json',{'files':changes})
    write_new(QUALITY / 'preset-specialists-documentation-refresh.json',{'at':datetime.now(timezone.utc).isoformat(),'status':'passed','checkpoint':ref(cpfile),'changes':changes,'media_copies':copies,'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'passed','documents':len(changes),'media_copies':len(copies)}))


def audit():
    cpfile = QUALITY / 'preset-specialists-checkpoint.json'
    cp = read(cpfile)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected, name
    refresh = read(QUALITY / 'preset-specialists-documentation-refresh.json')
    assert refresh['checkpoint']['sha256'] == digest(cpfile) and len(refresh['changes']) == 19
    for row in refresh['changes']:
        assert digest(ROOT/row['path']) == row['after_sha256']
        assert digest(ROOT/row['archive']) == row['before_sha256']
    for row in refresh['media_copies']:
        assert digest(ROOT/row['source']) == digest(ROOT/row['target']) == row['sha256']
    decoded=[]
    for row in cp['recordings'][0]['files']:
        p = DEV / row['path']
        info = subprocess.run(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames:format=duration','-of','json',str(p)],capture_output=True,check=True)
        value = json.loads(info.stdout)
        frames = int(value['streams'][0]['nb_read_frames'])
        assert frames > 1 and float(value['format']['duration']) > 1
        result = subprocess.run(['ffmpeg','-v','error','-i',str(p),'-map','0:v:0','-f','null','-'],capture_output=True,check=True)
        assert not result.stderr.strip(), result.stderr
        decoded.append({**row,'fully_decoded':True,'decoded_frames':frames,'probe':value})
    md = MarkdownIt()
    links=0
    readmes=[ROOT/'docs'/n for n in ['README.md','README.en.md']]+[DEV/('copypaste-'+c)/n for c in COMPONENTS for n in ['README.md','README.en.md']]
    for p in readmes:
        body = p.read_text(encoding='utf-8')
        assert '<!-- preset-specialists-stage98 -->' in body and '```mermaid' in body
        for token in md.parse(body):
            for child in token.children or []:
                value = child.attrGet('href') if child.type=='link_open' else child.attrGet('src') if child.type=='image' else None
                if value and not urlsplit(value).scheme and not value.startswith('#'):
                    target=(p.parent/unquote(urlsplit(value).path)).resolve()
                    assert target.exists(), (p,value)
                    links+=1
    progress = read(QUALITY/'requirements-alignment-progress.json')
    baseline = read(ROOT/cp['preservation']['receipt']['path'])
    assert progress['requirements']==baseline['requirements'] and progress['gates']==baseline['gates']
    assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
    write_new(QUALITY/'preset-specialists-docs-audit-01.json',{'at':datetime.now(timezone.utc).isoformat(),'status':'passed','checkpoint':ref(cpfile),'bilingual_readmes':len(readmes),'source_files':len(cp['source_files']),'local_links':links,'recordings':decoded,'original_requirements_unchanged':True,'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'passed','readmes':len(readmes),'links':links,'fully_decoded_media':len(decoded)}))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['record','sync','audit'])
    for k,default in [('core','04'),('native','02'),('ui','01')]:
        parser.add_argument('--'+k,default=default)
    args=parser.parse_args()
    if args.action=='record': record(args)
    elif args.action=='sync': sync()
    else: audit()
