"""Export a safe excerpt of actual scrolling and the masked Web screenshots."""
from pathlib import Path
from hashlib import sha256
import json, shutil, subprocess

ROOT = Path(__file__).resolve().parents[3]
D = ROOT / 'dev/copypaste-delivery'
W = ROOT / 'dev/copypaste-web'
P = D / '.data/deployment-187'
receipt = P / 'browser-8184c9ab-ad76-4fd3-a294-4bffff9406e5/receipt.json'
live = json.loads(receipt.read_bytes())
assert live['status'] == 'passed' and len(live['checks']) == 10
assert live['browser_closed'] and live['qa_session_signed_out']
video = Path(live['video'])
assert video.is_file()
ffmpeg = shutil.which('ffmpeg')
assert ffmpeg
gif = W / 'assets/demos/187-web-scroll.gif'
gif.parent.mkdir(parents=True, exist_ok=True)
assert not gif.exists()
# The contact sheet was inspected: later account/usage pages are excluded.
# Keep only the role catalogue's actual main-page and sidebar wheel interaction.
subprocess.run([
    ffmpeg, '-hide_banner', '-loglevel', 'error', '-n', '-ss', '0.40',
    '-i', str(video), '-t', '1.40', '-filter_complex',
    'fps=10,scale=1008:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', str(gif)
], check=True)
folder = ROOT / 'docs/assets/web-scroll-187'
folder.mkdir(exist_ok=False)
files = []
for source in [*(W / 'assets/screenshots' / ('187-v2-' + name + '.png') for name in [
    'roles-light', 'roles-dark', 'roles-mobile', 'new-work-modal'
]), gif]:
    target = folder / source.name
    shutil.copyfile(source, target)
    for p in [source, target]:
        files.append({'path': p.relative_to(ROOT).as_posix(),
                      'sha256': sha256(p.read_bytes()).hexdigest(),
                      'bytes': p.stat().st_size})
report = {
    'stage': 187, 'status': 'actual_masked_media_exported',
    'input_receipt_sha256': sha256(receipt.read_bytes()).hexdigest(),
    'gif_start_seconds': 0.40, 'gif_duration_seconds': 1.40,
    'scope': 'Actual role-catalogue wheel scrolling; screenshot-only dark theme, mobile and modal. Authenticated owned LAN deployment, not public HTTPS acceptance.',
    'privacy': 'Pre-paint account selectors masked. GIF excludes subsequent account and usage pages. Member-table screenshot and full recording remain private.',
    'files': files,
}
with (P / 'media-v1.sanitized.json').open('x', encoding='utf8', newline='\n') as f:
    f.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'files': len(files), 'gif_bytes': gif.stat().st_size}))
