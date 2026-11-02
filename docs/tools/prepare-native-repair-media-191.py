"""Redact identity labels in actual recorded frames; preserve the original interaction."""
from pathlib import Path
import hashlib,json,subprocess
from PIL import Image,ImageDraw

root=Path(__file__).resolve().parents[2]
delivery=root/'dev/copypaste-delivery'
source=delivery/'.data/acceptance-191/cloud-download-d3ade13f-e4bb-4425-9368-839bda9f4e20'
video=source/'page@955c222d9da44e970134558d5b0a7e32.webm'
frames=delivery/'.data/acceptance-191/cloud-download-gif-frames';frames.mkdir(exist_ok=True)
out=root/'docs/assets/native-repair-191';out.mkdir(parents=True,exist_ok=True)
subprocess.run([str(delivery/'.data/browsers/ffmpeg-1013/ffmpeg-win64.exe'),'-hide_banner','-loglevel','error','-i',str(video),'-vf','scale=1008:-1','-r','3','-f','image2',str(frames/'frame-%04d.png')],check=True)
images=[]
for p in sorted(frames.glob('frame-*.png')):
 im=Image.open(p).convert('RGB');draw=ImageDraw.Draw(im)
 # Coordinates belong to this fixed 1440x1000 recording, resized to 70%.
 for box in [(65,99,186,137),(468,22,637,54),(52,946,190,972)]:
  draw.rectangle(tuple(round(v*.7) for v in box),fill='#d7d8df')
 images.append(im.quantize(colors=128))
assert 20<=len(images)<=50
gif=out/'191-actual-cloud-download.gif'
assert not gif.exists()
images[0].save(gif,save_all=True,append_images=images[1:],duration=333,loop=0,optimize=True)
png=out/'191-real-cloud-delivery.png';png.write_bytes((source/'01-verified-cloud-download.png').read_bytes())
receipt={'stage':191,'scope':'Actual Web interaction recording excerpt, fixed identity-label redaction, resized; no simulated UI frames','source_video_sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'frames':len(images),'gif_sha256':hashlib.sha256(gif.read_bytes()).hexdigest(),'screenshot_sha256':hashlib.sha256(png.read_bytes()).hexdigest()}
(delivery/'.data/acceptance-191/media-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
