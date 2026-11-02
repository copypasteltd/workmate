"""Create documentation media from actual recorded UI; never synthesize interface states."""
from pathlib import Path
from hashlib import sha256
import json,subprocess
from PIL import Image

root=Path(__file__).resolve().parents[2];delivery=root/'dev/copypaste-delivery';private=delivery/'.data/acceptance-192'
cloud=private/'cloud-download-354cfadc-0634-477d-b571-fd04c0647811';record=json.loads((cloud/'receipt.json').read_bytes());assert record['status']=='passed'
video=Path(record['video']);frames=private/'cloud-download-gif-frames';frames.mkdir()
out=root/'docs/assets/native-recheck-192';out.mkdir(parents=True)
subprocess.run([str(delivery/'.data/browsers/ffmpeg-1013/ffmpeg-win64.exe'),'-hide_banner','-loglevel','error','-sseof','-6','-i',str(video),'-vf','crop=1100:900:270:80,scale=880:-1','-r','3','-f','image2',str(frames/'frame-%04d.png')],check=True)
images=[Image.open(p).convert('RGB').quantize(colors=128) for p in sorted(frames.glob('frame-*.png'))];assert 3<=len(images)<=30
gif=out/'192-actual-cloud-download.gif';images[0].save(gif,save_all=True,append_images=images[1:],duration=333,loop=0,optimize=True)
for name,source in [('192-cloud-delivery.png',cloud/'01-verified-cloud-download.png'),('192-web-local-cause.png',private/'direct-error-ui-7147a1f0-63f3-4ce4-8925-f0215cebd50e/web-local-cause.png'),('192-admin-local-cause.png',private/'direct-error-ui-7147a1f0-63f3-4ce4-8925-f0215cebd50e/admin-local-cause.png')]:
 (out/name).write_bytes(source.read_bytes())
report={'stage':192,'scope':'Actual cloud download recording excerpt and direct customer/admin diagnostic UI captures. The GIF crops out the identity sidebar and top bar; no synthetic frames.','frames':len(images),'source_video_sha256':sha256(video.read_bytes()).hexdigest(),'media':[{'path':p.relative_to(root).as_posix(),'sha256':sha256(p.read_bytes()).hexdigest()} for p in sorted(out.iterdir())]}
(private/'media-receipt.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8',newline='\n');print(json.dumps(report))
