"""Render only the actual, authenticated model-connection browser journey."""
from pathlib import Path
from hashlib import sha256
import json, shutil, subprocess, sys

ROOT=Path(__file__).resolve().parents[3]
P=ROOT/'dev/copypaste-delivery/.data/deployment-179'
run=P/sys.argv[1]
r=json.loads((run/'receipt.json').read_bytes())
assert r['status']=='passed' and r['browser_closed']
assert len(r['media'])==3
source=Path(r['video']);assert source.is_file()
ffmpeg=shutil.which('ffmpeg');assert ffmpeg
folder=ROOT/'dev/copypaste-admin/assets/demos';folder.mkdir(parents=True,exist_ok=True)
docs=ROOT/'docs/assets/model-management-179';docs.mkdir(parents=True,exist_ok=False)
rows=[]
def record(p,**extra):
 rows.append({'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':sha256(p.read_bytes()).hexdigest(),**extra})
with (run/'media-render.log').open('xb') as log:
 for suffix,args in [('mp4',['-c:v','libx264','-preset','fast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart']),
   ('gif',['-filter_complex','fps=6,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer','-loop','0'])]:
  out=folder/('179-model-management.'+suffix)
  subprocess.run([ffmpeg,'-nostdin','-n','-i',str(source),'-an',*args,str(out)],check=True,stdout=log,stderr=log)
  record(out,source_recording_sha256=sha256(source.read_bytes()).hexdigest(),post_login_only=True)
  target=docs/out.name;assert not target.exists();shutil.copyfile(out,target);record(target,copy_of=out.relative_to(ROOT).as_posix())
 for i,row in enumerate(r['media']):
  p=ROOT/'dev/copypaste-admin'/row['path'];record(p,actual_browser_capture=True)
  name=['model-form','saved-edit','deleted-model'][i]+'.png'
  target=docs/name;shutil.copyfile(p,target);record(target,copy_of=p.relative_to(ROOT).as_posix())
with (P/'media.sanitized.json').open('x',encoding='utf-8',newline='\n') as f:
 json.dump({'stage':179,'status':'rendered_actual_browser_recording','browser_receipt':str(run/'receipt.json'),'files':rows},f,indent=2)
print(json.dumps({'status':'rendered','files':len(rows)}))
