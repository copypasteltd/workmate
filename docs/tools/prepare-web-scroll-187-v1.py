"""Bind the deployed Web scroll refinement to exact sources and actual media."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, shutil

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
D = DEV / 'copypaste-delivery'
W = DEV / 'copypaste-web'
P = D / '.data/deployment-187'

def digest(p):
    return sha256(p.read_bytes()).hexdigest()

runtime = json.loads((P / 'server-runtime.json').read_bytes())
package = json.loads((P / 'package-v1.json').read_bytes())
assert runtime['status'] == 'web_ui_deployed'
assert runtime['configuration_and_credentials_unchanged']
assert runtime['api_database_proxy_main_pids_unchanged']
assert runtime['served_index_and_styles_match'] and not runtime['api_restarted']
assert runtime['runtime_schema_unchanged'] == 161
assert package['sha256'] == runtime['archive_sha256'] == digest(P / package['archive'])
assert package['sources'] == runtime['source_hashes']
for name, h in package['sources'].items():
    assert digest(W / name) == h
runs = [json.loads(p.read_bytes()) for p in sorted(P.glob('browser-*/receipt.json'))]
assert len(runs) == 2 and all(r['status'] == 'passed' and r['browser_closed'] and r['qa_session_signed_out'] for r in runs)
final = next(r for r in runs if r.get('artifact_version') == 'ui-v2')
assert len(final['checks']) == 10
assert final['desktop']['scrollWidth'] == final['desktop']['viewport'] == 1440
assert final['mobile']['scrollWidth'] == final['mobile']['viewport'] == 390
assert final['table']['bar'] == 'thin' and final['table']['left'] > 0
media_report = json.loads((P / 'media-v1.sanitized.json').read_bytes())
media = media_report['files']
assert len(media) == 10
for row in media:
    assert digest(ROOT / row['path']) == row['sha256']
note = json.loads((D / '.data/deployment-179/web-scroll-187-note.sanitized.json').read_bytes())
assert note['status'] == 'deployment_note_appended' and note['prior_document_bytes_preserved']

proof = ROOT / 'docs/quality/web-scroll-surfaces-187'
proof.mkdir(exist_ok=False)
for name, value in [('deployment.json', runtime), ('package.json', package),
                    ('deployment-note.json', note), ('media.json', media_report)]:
    (proof / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8', newline='\n')
for r in runs:
    name = 'browser-v2.json' if r.get('artifact_version') == 'ui-v2' else 'browser-v1.json'
    safe = {k: v for k, v in r.items() if k not in ['run', 'video']}
    (proof / name).write_text(json.dumps(safe, ensure_ascii=False, indent=2) + '\n', encoding='utf8', newline='\n')
build = {
    'stage': 187, 'status': 'passed', 'command': 'npm run build',
    'components': ['tsc --noEmit', 'vite build'],
    'recording': 'Build completed during this task; this receipt binds the resulting package and sources. Original full terminal output was not exported.',
    'warning': 'Existing large-chunk size warning; build exit code 0.',
    'built_file_count': package['files'], 'archive_sha256': package['sha256'],
    'source_hashes': package['sources'],
}
(proof / 'build.json').write_text(json.dumps(build, indent=2) + '\n', encoding='utf8', newline='\n')

marker = '<!-- web-scroll-187 -->'
guide = 'https://github.com/copypasteltd/workmate/blob/docs/docs/development/187-web-scroll-surfaces.md'
raw = 'https://raw.githubusercontent.com/copypasteltd/workmate/web/'
zh = f'''{marker}

## Web 滚动区域优化 · 187

[用户端](https://agent.copypaste.hk)已隐藏页面、侧栏、消息和弹窗外层的可见滚动条，保留原生滚动。必要的内部表格、面板和输入区统一细款样式，颜色跟随浅深色主题。窄屏标题与筛选允许换行，宽表格仅在自身区域左右滚动。

使用鼠标滚轮、触控板或手机滑动浏览长内容；导航可独立滚动，弹窗底部仍可访问。此更新已通过 TypeScript/Vite 构建和最终10项实际内网页面检查；浏览器与测试会话已关闭。公网 HTTPS 端到端旅程未在本轮完整验证，检查范围见[实现、使用与回滚]({guide})。

```mermaid
flowchart LR
 A[页面与导航] --> B[隐藏滚动条并保留滚动]
 C[窄屏长内容] --> D[换行并限制宽度]
 E[宽表格] --> F[容器内滚动与统一细款样式]
```

![桌面浅色]({raw}assets/screenshots/187-v2-roles-light.png)

![桌面深色]({raw}assets/screenshots/187-v2-roles-dark.png)

![手机布局]({raw}assets/screenshots/187-v2-roles-mobile.png)

![实际主区域与侧栏滚轮交互]({raw}assets/demos/187-web-scroll.gif)

'''
en = f'''{marker}

## Web scroll refinement · 187

The [Web client](https://agent.copypaste.hk) hides visible page, sidebar, conversation and outer-modal rails while retaining native scrolling. Necessary inner tables, panels and inputs use consistent thin scrollbars derived from the existing light/dark theme. Narrow controls wrap; wide tables scroll only inside their own container.

Browse long content with the wheel, trackpad or touch. Navigation scrolls independently and long-dialog controls remain accessible. TypeScript/Vite and ten final actual deployed-LAN browser checks passed; owned browsers and QA sessions were closed. A complete public HTTPS journey was not qualified this round. See [usage, implementation, evidence and rollback]({guide}) for the exact scope.

```mermaid
flowchart LR
 A[Page and navigation] --> B[Hidden rail, native scrolling]
 C[Narrow long content] --> D[Wrap within viewport]
 E[Wide tables] --> F[Contained scroll with shared thin rails]
```

![Desktop light]({raw}assets/screenshots/187-v2-roles-light.png)

![Desktop dark]({raw}assets/screenshots/187-v2-roles-dark.png)

![Mobile layout]({raw}assets/screenshots/187-v2-roles-mobile.png)

![Actual main-page and sidebar wheel interaction]({raw}assets/demos/187-web-scroll.gif)

'''
for component in ['web', 'delivery']:
    for name, prefix in [('README.md', zh), ('README.en.md', en)]:
        if component == 'web':
            prefix = prefix.replace(raw, '')
        p = DEV / ('copypaste-' + component) / name
        old = p.read_bytes()
        assert marker.encode() not in old
        p.write_bytes(prefix.encode() + old)
for name, text in [
    ('README.md', 'Web 已隐藏外层滚动条并统一内部细款样式；窄屏换行、表格在容器内滚动。已部署，最终10项实际内网浏览器检查通过。'),
    ('README.en.md', 'Web now hides outer rails, styles necessary inner rails consistently and contains narrow-layout overflow. Deployed with ten final actual LAN browser checks passed.')
]:
    p = ROOT / 'docs' / name
    old = p.read_bytes()
    assert marker.encode() not in old
    prefix = f'{marker}\n\n{text}\n\n[需求 / Requirements](requirements/187-web-scroll-surfaces.md) · [开发与使用 / Implementation](development/187-web-scroll-surfaces.md) · [变更 / Changes](changes/187-web-scroll-surfaces.md) · [证据 / Evidence](quality/web-scroll-surfaces-187.json)\n\n'
    p.write_bytes(prefix.encode() + old)

names = {b: [] for b in ['backend', 'web', 'admin', 'desktop', 'extension', 'delivery', 'docs']}
names['web'] = sorted(['src/main.tsx', 'src/scroll-surfaces.css', 'README.md', 'README.en.md',
    *(r['path'].removeprefix('dev/copypaste-web/') for r in media if r['path'].startswith('dev/copypaste-web/'))])
names['delivery'] = sorted(['README.md', 'README.en.md', *(p.relative_to(D).as_posix() for p in (D / 'scripts').glob('*187*'))])
names['docs'] = sorted([
    'docs/README.md', 'docs/README.en.md',
    'docs/requirements/187-web-scroll-surfaces.md', 'docs/development/187-web-scroll-surfaces.md',
    'docs/changes/187-web-scroll-surfaces.md', 'docs/tools/prepare-web-scroll-187-v1.py',
    'docs/tools/publish-web-scroll-187-v1.py', 'docs/quality/web-scroll-surfaces-187.json',
    *(p.relative_to(ROOT).as_posix() for p in proof.iterdir()),
    *(r['path'] for r in media if r['path'].startswith('docs/')),
])
sources = {}
for branch, repo in [('web', W), ('delivery', D), ('docs', ROOT)]:
    for name in names[branch]:
        if name == 'docs/quality/web-scroll-surfaces-187.json':
            continue
        p = repo / name
        sources[p.relative_to(ROOT).as_posix()] = digest(p)
report = {
    'stage': 187, 'status': 'deployed_and_qualified', 'at': datetime.now(timezone.utc).isoformat(),
    'scope': 'Web scroll styling and narrow-layout refinement. Actual owned LAN UI; not full product, public HTTPS or cross-browser acceptance.',
    'final_browser_checks': 10, 'initial_browser_checks': 7,
    'build_passed': True, 'server_served_source_match': True,
    'schema_unchanged': 161, 'api_restarted': False,
    'other_service_configuration_and_credentials_unchanged': True,
    'original_attempts_preserved': 'Initial and final receipt scopes are retained separately, not summed. Full video and account-bearing member screenshot are excluded from publication.',
    'transport_limitation': 'Intermittent workstation public Web TLS timeouts. Real canonical OTP and read-only data were checked via owned LAN HTTP using browser-only in-memory cookie adaptation; server settings unchanged.',
    'browser_closed': True, 'qa_sessions_signed_out': True, 'ssh_closed': True,
    'model_calls_made': False, 'local_virtualization_used': False,
    'sources': sources, 'media': media,
}
with (ROOT / 'docs/quality/web-scroll-surfaces-187.json').open('x', encoding='utf8', newline='\n') as f:
    f.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
with (P / 'publication-paths.json').open('x', encoding='utf8', newline='\n') as f:
    f.write(json.dumps(names, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'sources': len(sources),
                  'publication_files': {k: len(v) for k, v in names.items()}}))
