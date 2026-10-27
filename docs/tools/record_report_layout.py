"""Record and document the measured responsive website-report repair."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV, QUALITY = ROOT / 'dev', ROOT / 'docs/quality'
DELIVERY = DEV / 'copypaste-delivery'
BASE = QUALITY / 'web-analytics-checkpoint.json'
CP = QUALITY / 'report-layout-checkpoint.json'
COMPONENTS = ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text('utf-8'))

def ref(path):
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path)}

def write(path, data):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')

def matrix():
    current = read(QUALITY / 'requirements-alignment-progress.json')
    original = read(QUALITY / 'history/stage96-before-solution-packages/receipt.json')
    assert current['requirements'] == original['requirements'] and current['gates'] == original['gates']
    assert current['fully_accepted_requirements'] == current['qualified_live_roles'] == 0

def record(attempt):
    baseline = read(BASE)
    prep = read(DELIVERY / '.data/preparation/report-layout-112/receipt.json')
    assert prep['baseline_checkpoint_sha256'] == digest(BASE)
    ui_path = DELIVERY / ('evidence/web-analytics-ui-' + attempt + '.json')
    ui = read(ui_path)
    assert ui['status'] == 'passed' and ui['source_unchanged'] and ui['packaged_unchanged']
    assert ui['counts'] == {'journey_checks': 16, 'errors': 0}
    assert len(ui['checks']) == 11 and all(c['exit_code'] == 0 for c in ui['checks'])
    assert ui['owned_database_shutdown'] and ui['owned_preview_closed']
    for key in ['raw_report', 'verifier', 'journey_verifier', 'journey']:
        assert digest(DELIVERY / ui[key]['path']) == ui[key]['sha256']
    journey = read(DELIVERY / ui['journey']['path'])
    assert journey['status'] == 'passed' and len(journey['checks']) == 16
    assert len(journey['layouts']) == 5 and len(journey['screenshots']) == 9
    assert len(journey['exports']) == 7 and len(journey['recordings']) == 2
    assert journey['model_calls'] == 0
    assert all(journey[k] for k in ['electron_closed', 'browser_closed', 'api_closed', 'fixture_closed'])
    for layout in journey['layouts']:
        assert not layout['horizontal_overflow'] and len(layout['values']) >= 4
        assert all(v['lines'] == 1 and v['text_width'] <= v['available'] + 1 for v in layout['values'])
    assert {v['width'] for v in journey['layouts']} == {375, 800, 1440}
    for movie in journey['recordings']:
        assert movie['distinct_frames'] > 1 and movie['skipped_capture_errors'] == 0
    sources = dict(baseline['source_files'])
    changed = []
    for name, expected in baseline['source_files'].items():
        actual = digest(ROOT / name)
        if actual != expected:
            assert name in prep['source_files'] and prep['source_files'][name] == expected, name
            assert digest(DELIVERY / '.data/preparation/report-layout-112' / name) == expected
            changed.append({'path': name, 'before_sha256': expected, 'after_sha256': actual})
            sources[name] = actual
    assert {v['path'] for v in changed} == set(prep['source_files'])
    for name, expected in ui['source_files'].items():
        qualified = 'dev/' + name
        assert digest(DEV / name) == expected, name
        assert digest(DELIVERY / ('evidence/web-analytics-ui-' + attempt + '-sources') / name) == expected, name
        if qualified in sources:
            assert sources[qualified] == expected, name
        sources[qualified] = expected
    for row in journey['screenshots'] + [f for m in journey['recordings'] for f in m['files']]:
        assert digest(DEV / row['path']) == row['sha256']
    build_path = QUALITY / 'web-analytics-backend-build-01.json'
    for name, expected in read(build_path)['compiled_files'].items():
        assert digest(DEV / 'copypaste-platform' / name) == expected
    matrix()
    write(CP, {'at': datetime.now(timezone.utc).isoformat(), 'stage': 112, 'status': 'verified_report_layout',
        'scope': 'Only responsive website-report CSS and renderer digests changed. Actual Web and unsigned packaged Desktop; synthetic accounts. Five measured layout states and eleven retained functional journeys in one current run.',
        'source_files': dict(sorted(sources.items())), 'changed_product_files': changed,
        'selected_ui': ref(ui_path), 'journey': ref(DELIVERY / ui['journey']['path']),
        'build_checks': len(ui['checks']), 'actual_ui_checks': 16, 'layouts': journey['layouts'],
        'screenshots': journey['screenshots'], 'recordings': journey['recordings'], 'exports': journey['exports'],
        'retained_backend_and_native_tests': baseline['counts'], 'retained_stage111': ref(BASE),
        'retained_compiled_backend': ref(build_path), 'new_migrations': [], 'new_routes': [],
        'original_requirements_modified': False, 'fully_accepted_requirements': 0, 'qualified_live_roles': 0,
        'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'verified_report_layout', 'actual_flows': 16, 'layout_states': 5, 'sources': len(sources)}))

def sync():
    cp = read(CP)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    copies, changes = [], []
    for row in cp['screenshots'] + [f for m in cp['recordings'] for f in m['files']]:
        src = DEV / row['path']
        dst = ROOT / 'docs/design/implementation' / (Path(row['path']).parts[0] + '__' + src.name)
        assert not dst.exists()
        shutil.copyfile(src, dst)
        assert digest(dst) == row['sha256']
        copies.append({'source': src.relative_to(ROOT).as_posix(), 'target': dst.relative_to(ROOT).as_posix(), 'sha256': digest(dst)})
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        component = folder.name.removeprefix('copypaste-')
        client = 'desktop' if component == 'desktop' else 'web'
        shot = next(r for r in cp['screenshots'] if r['path'].startswith('copypaste-' + client + '/') and r['path'].endswith('search-en.png'))
        movie = next(f for m in cp['recordings'] if m['component'] == client for f in m['files'] if f['path'].endswith('.gif'))
        if folder == ROOT / 'docs':
            image = 'design/implementation/copypaste-' + client + '__' + Path(shot['path']).name
            gif = 'design/implementation/copypaste-' + client + '__' + Path(movie['path']).name
            evidence = 'quality/report-layout-checkpoint.json'
        else:
            def media(row):
                local = Path(row['path']).relative_to('copypaste-' + client).as_posix()
                return local if component == client else 'https://raw.githubusercontent.com/copypasteltd/workmate/' + client + '/' + local
            image, gif = media(shot), media(movie)
            evidence = 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/report-layout-checkpoint.json'
        for name in ['README.md', 'README.en.md']:
            path = folder / name
            old = path.read_bytes()
            title, body = old.split(b'\n', 1)
            en = name.endswith('.en.md')
            text = '<!-- responsive-report-stage112 -->\n'
            text += ('Website reports now use a dedicated wider dialog and intrinsic metric columns. Complete CTR, ranking and refund values remain readable on one line at the measured 375px Web and 800px Desktop sizes; scrolling remains available without Desktop rails.\n\n' if en else '網站報告採用專用寬版對話框及隨容器排版的指標卡片。實測 375px Web 與 800px Desktop 的 CTR、排名及退款數值完整單行顯示；Desktop 可捲動並維持隱藏滾動條。\n\n')
            text += ('16 actual client flows, five measured layout states and 11 build/package checks passed. The previous 195 backend/native checks are retained; this CSS increment does not claim they were rerun. Synthetic accounts/models and unsigned packaging.\n\n' if en else '16 條實際界面流程、5 個量測排版狀態及 11 項構建／打包通過。保留上一輪 195 項後端／本機檢查，本次 CSS 修復不宣稱重跑；使用假帳戶／模型與未簽名打包版。\n\n')
            text += f'[Evidence / 證據]({evidence})\n\n![Actual readable search report / 實際搜尋報告]({image})\n\n![Actual interaction / 實際交互]({gif})\n\n'
            path.write_bytes(title + b'\n\n' + text.encode() + body)
            changes.append({'path': path.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(path)})
    path = QUALITY / 'requirements-alignment-progress.json'
    progress = read(path)
    progress['website_report_layout'] = {'checkpoint': ref(CP), 'actual_ui_checks': 16, 'measured_layout_states': 5, 'original_requirements_modified': False, 'full_acceptance': 'not_proven'}
    path.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    for en in [False, True]:
        path = ROOT / ('docs/changes/2026-10-27-report-layout' + ('.en' if en else '') + '.md')
        title = '# Responsive website reports\n\n' if en else '# 網站報告自適應排版\n\n'
        body = ('Replaced the narrow generic dialog and viewport-based column count with a report dialog up to 1000px wide and intrinsic columns with a 240px preferred minimum. Smaller containers use the available width. All captured values retain their full precision.\n\n' if en else '報告對話框最寬 1000px，指標列按容器可用寬度及 240px 理想最小寬度排列，小容器使用可用寬度。保留完整數值精度，沒有隱藏內容或阻止捲動。\n\n')
        with path.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write(title + body + '16 actual client flows / 實際界面流程；5 measured layouts / 量測排版；11 build/package checks / 構建打包。\n\n[Evidence / 證據](../quality/report-layout-checkpoint.json) · [Design / 方案](../technical/112-responsive-website-reports.md)\n\nSynthetic data, unsigned Desktop; original full acceptance gates remain open. / 假資料、未簽名桌面版；原始完整驗收門檻保留。\n')
    write(QUALITY / 'report-layout-documentation-refresh.json', {'checkpoint': ref(CP), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})

def audit():
    from markdown_it import MarkdownIt
    from urllib.parse import urlsplit, unquote
    cp = read(CP)
    refresh = read(QUALITY / 'report-layout-documentation-refresh.json')
    assert cp['verifier_sha256'] == refresh['verifier_sha256'] == digest(Path(__file__))
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected, name
    for row in refresh['changes']:
        assert digest(ROOT / row['path']) == row['after_sha256']
    for row in refresh['media_copies']:
        assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    links = 0
    paths = [ROOT / row['path'] for row in refresh['changes']]
    paths += [ROOT / 'docs/technical/112-responsive-website-reports.md', ROOT / 'docs/changes/2026-10-27-report-layout.md', ROOT / 'docs/changes/2026-10-27-report-layout.en.md']
    for path in paths:
        for token in MarkdownIt().parse(path.read_text('utf-8')):
            for child in token.children or []:
                url = child.attrGet('src') if child.type == 'image' else child.attrGet('href') if child.type == 'link_open' else None
                if url and not urlsplit(url).scheme and not url.startswith('#'):
                    assert (path.parent / unquote(urlsplit(url).path)).exists(), (path, url)
                    links += 1
    decoded = []
    for movie in cp['recordings']:
        for row in movie['files']:
            path = DEV / row['path']
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames:format=duration', '-of', 'json', str(path)]))
            assert int(probe['streams'][0]['nb_read_frames']) > 1 and abs(float(probe['format']['duration']) - movie['seconds']) <= .25
            run = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(path), '-map', '0:v:0', '-f', 'null', '-'], capture_output=True, check=True)
            assert not run.stderr.strip()
            decoded.append(row)
    matrix()
    write(QUALITY / 'report-layout-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP), 'bilingual_readmes': 14, 'local_links': links, 'decoded_recordings': decoded, 'original_matrix_unchanged': True, 'retained_archive_audit': ref(QUALITY / 'archive-link-audit-38.json'), 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'decoded': len(decoded)}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['record', 'sync', 'audit'])
    parser.add_argument('--attempt', default='08')
    args = parser.parse_args()
    record(args.attempt) if args.action == 'record' else sync() if args.action == 'sync' else audit()
