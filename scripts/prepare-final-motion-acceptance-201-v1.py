"""Collect runtime-acceptance corrections; keep every previously executed driver."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=(root/'scripts/qualify-live-motion-201-v1.mjs').read_text('utf8')
source=source.replace("201-v1-motion-production-live.png","201-v2-motion-production-live.png").replace("'motion-production-live','201-v1'","'motion-production-live','201-v2'")
source=source.replace("await editor.waitFor({state:'hidden'});", "await page.waitForFunction(()=>!document.querySelector('[role=dialog]')||!!document.querySelector('[role=dialog] .error-banner'),{},{timeout:30000});if(await editor.isVisible())throw Error('Save did not complete: '+await editor.innerText());")
source=source.replace("await startMotion(page,name);", "await startMotion(page,name);console.log(JSON.stringify({phase:'live actual template and preview ready'}));")
source=source.replace("report.video_id=created[0].id;", "report.video_id=created[0].id;console.log(JSON.stringify({phase:'immutable video saved',video_id:report.video_id}));")
source=source.replace("await steadyMotionFrame(editor);await capture", "await steadyMotionFrame(editor);await editor.evaluate(e=>e.scrollTop=0);await capture")
source=source.replace("await steadyMotionFrame(nativeEditor);await capture", "await steadyMotionFrame(nativeEditor);await nativeEditor.evaluate(e=>e.scrollTop=0);await capture")
p=root/'scripts/qualify-live-motion-201-v2.mjs';assert not p.exists();p.write_text(source,encoding='utf8',newline='\n')
print('Created immutable v2 live acceptance driver; product source unchanged.')
