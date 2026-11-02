"""Export only the successful redacted live capture; keep failed raw captures private."""
from pathlib import Path
from hashlib import sha256
import json,shutil,subprocess

ROOT=Path(__file__).resolve().parents[3]
D=ROOT/'dev/copypaste-delivery';P=D/'.data/deployment-185'
matches=[json.loads(p.read_bytes()) for p in P.glob('live-*/receipt.json')]
live=next(r for r in matches if r['status']=='passed')
assert live['browser_closed'] and len(live['checks'])==6
assert live['media']['redaction'].startswith('Recipient, message body and OTP text masked before first paint')
video=Path(live['video']);assert video.is_file()
ffmpeg=shutil.which('ffmpeg');ffprobe=shutil.which('ffprobe');assert ffmpeg and ffprobe
duration=float(subprocess.check_output([ffprobe,'-v','error','-show_entries','format=duration','-of','json',str(video)],text=True).strip().split('"duration": "')[1].split('"')[0])
gif=D/'assets/demos/185-test-mailbox.gif';gif.parent.mkdir(exist_ok=True,parents=True);assert not gif.exists()
subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-n','-i',str(video),'-t',str(min(duration,20)),'-filter_complex','fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3','-loop','0',str(gif)],check=True)
folder=ROOT/'docs/assets/test-mailbox-185';folder.mkdir(exist_ok=False)
files=[]
for source in [*(D/name for name in live['media']['screenshots']),gif]:
 target=folder/source.name;shutil.copyfile(source,target)
 for p in [source,target]:files.append({'path':p.relative_to(ROOT).as_posix(),'sha256':sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
report={'stage':185,'status':'redacted_live_media_exported','input_duration_seconds':duration,'gif_duration_seconds':min(duration,20),'files':files}
with (P/'media-v1.sanitized.json').open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':report['status'],'files':len(files),'gif_bytes':gif.stat().st_size}))
