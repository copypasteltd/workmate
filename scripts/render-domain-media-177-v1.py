"""Convert actual post-login browser recordings without including OTP/MFA screens."""
from pathlib import Path
import json,subprocess,hashlib,shutil
ROOT=Path(__file__).resolve().parents[3];base=ROOT/'dev/copypaste-delivery/.data/deployment-177'
run=base/'browser-1d8d400d-1f2c-43e4-818c-753e0ac05622';r=json.loads((run/'receipt.json').read_bytes());assert r['status']=='passed' and r['browser_closed']
ffmpeg=shutil.which('ffmpeg');assert ffmpeg
rows=[]
with (base/'media-render.log').open('xb') as log:
 for client in ['web','admin']:
  source=Path(r[client+'_video']);assert source.is_file()
  folder=ROOT/'dev'/('copypaste-'+client)/'assets/demos';folder.mkdir(parents=True,exist_ok=True)
  mp4=folder/'177-public-domains.mp4';gif=folder/'177-public-domains.gif';assert not mp4.exists() and not gif.exists()
  for output,args in [(mp4,['-c:v','libx264','-preset','fast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart']),
      (gif,['-filter_complex','fps=6,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer','-loop','0'])]:
   subprocess.run([ffmpeg,'-nostdin','-n','-i',str(source),'-an',*args,str(output)],check=True,stdout=log,stderr=log)
   rows.append({'path':output.relative_to(ROOT).as_posix(),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'source_recording_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'post_login_only':True})
with (base/'media.sanitized.json').open('x',encoding='utf-8',newline='\n') as f:json.dump({'stage':177,'status':'rendered_actual_browser_recordings','files':rows},f,indent=2)
print(json.dumps({'phase':'media_rendered','files':len(rows)}))
