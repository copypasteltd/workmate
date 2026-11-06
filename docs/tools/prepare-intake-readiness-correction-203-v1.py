from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts';p=S/'qualify-specialist-intake-203-v4.mjs';s=p.read_text('utf-8')
old="const open=async()=>{await page.evaluate(()=>document.dispatchEvent(new CustomEvent('cp:new-task',{detail:{role:'frontend'}})));const d=page.getByRole('dialog',{name:'Start something new',exact:true});await d.waitFor();return d;};"
new="const open=async()=>{const d=page.getByRole('dialog',{name:'Start something new',exact:true});if(!await d.isVisible())await page.locator('.new-task-side').click();await d.waitFor();return d;};"
assert old in s;s=s.replace(old,new)
s=s.replace("let intake=await open();await intake.getByLabel", "let intake=await open();await intake.locator('summary').click();await intake.getByLabel('Specialist',{exact:true}).selectOption('frontend');await intake.locator('summary').click();await intake.getByLabel",1)
s=s.replace("'203-v4'","'203-v5'");out=S/'qualify-specialist-intake-203-v5.mjs';assert not out.exists();out.write_text(s,encoding='utf-8',newline='\n')
p=R/'docs/quality/integrated-round-203/intake-readiness-correction-v1.json';assert not p.exists();p.write_text(json.dumps({'stage':203,'retained_attempt':'qualify-specialist-intake-203-v4.mjs','observation':'The injected new-task document event was emitted immediately after reload before the workspace listener mounted. Real navigation keeps its task button disabled until a project is ready.','correction':'Use the actual enabled New task control, select the specialist through the form, and preserve the pending receipt after reload. The original five completed UI checks remain recorded.','production_source_changed':False},indent=2)+'\n',encoding='utf-8')
