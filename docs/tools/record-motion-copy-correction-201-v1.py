from pathlib import Path
from datetime import datetime,timezone
import hashlib,json
root=Path(__file__).resolve().parents[2];out=root/'docs/quality/integrated-round-201';base=json.loads((out/'post-build-code-batch.json').read_text('utf8'));changed=[]
for row in base['production_source_files']:
 p=root/row['path'];digest=hashlib.sha256(p.read_bytes()).hexdigest()
 if digest!=row['sha256']:
  assert row['path']=='dev/copypaste-platform/src/video-templates.ts';changed.append({'path':row['path'],'before_sha256':row['sha256'],'sha256':digest});row.update(sha256=digest,bytes=p.stat().st_size)
assert len(changed)==1;base.update(at=datetime.now(timezone.utc).isoformat(),reason='Actual visual review found long English starter headlines breaking within a word. Shorten all affected starter copy; keep legacy rendering and stored definitions byte-compatible. No renderer/native/client code change.',changes=changed)
(out/'post-visual-code-batch.json').write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
scripts=root/'dev/copypaste-delivery/scripts';p=scripts/'qualify-motion-production-201-v5.mjs';assert not p.exists();s=(scripts/'qualify-motion-production-201-v4.mjs').read_text('utf8').replace("'201-v4'","'201-v5'").replace('201-v4-motion-production.png','201-v5-motion-production.png').replace('await steadyMotionFrame(editor);','await steadyMotionFrame(editor);await editor.evaluate(e=>{e.scrollTop=0;});').replace("mask:[page.locator('.user-chip strong')]", "mask:[page.locator('.user-chip strong')],maskColor:'#d7d8df'");p.write_text(s,encoding='utf8',newline='\n')
print(json.dumps({'complete_visual_copy_correction':changed}))
