"""Finish the shared-client code batch before running any build or test."""
from pathlib import Path
import json

root = Path('D:/dev/copypasted/自有agent')
desktop = root / 'dev/copypaste-desktop'
source = (desktop / 'src/client-failure.ts').read_bytes()
for file in ['copypaste-web/src/client-failure.ts', 'copypaste-admin/src/client-failure.ts',
             'copypaste-extension/src/client-failure.ts', 'copypaste-desktop/renderer/src/client-failure.ts']:
    (root / 'dev' / file).write_bytes(source)

css = desktop / 'renderer/src/task-workbench.css'
style = '''
.native-command summary{display:flex;align-items:baseline;gap:12px;justify-content:space-between;list-style-position:inside}
.native-command summary>span{font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow-wrap:anywhere;min-width:0}
.native-execution-record summary small{font-size:11px;color:var(--muted);flex-shrink:0;margin-left:10px}
.native-command-output summary{font-size:12px;color:var(--muted)}
.native-execution-record[data-failed] header>span{color:var(--danger,#bd4141)}
.native-execution-record details:focus-within{outline-offset:3px}
'''
current = css.read_text(encoding='utf8')
if '.native-command summary{' not in current:
    css.write_text(current + style, encoding='utf8')

versions = {'platform':'0.5.4','web':'0.5.3','admin':'0.5.2','desktop':'0.7.7','extension':'0.5.6','delivery':'0.5.3'}
for component, version in versions.items():
    repo = root / 'dev' / ('copypaste-' + component)
    for name in ['package.json', 'package-lock.json']:
        p = repo / name
        value = json.loads(p.read_text(encoding='utf8'))
        value['version'] = version
        if name == 'package-lock.json': value['packages']['']['version'] = version
        p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    if component == 'extension':
        manifest = repo / 'public/manifest.json'
        if manifest.exists():
            value = json.loads(manifest.read_text(encoding='utf8')); value['version'] = version
            manifest.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')

print(json.dumps({'shared_transport_copies': 5, 'versions': versions, 'tests_run': False}))
