from pathlib import Path
delivery=Path(__file__).resolve().parents[1];scripts=delivery/'scripts'
p=scripts/'motion-ui-journey-201-v2.mjs';assert not p.exists();s=(scripts/'motion-ui-journey-201-v1.mjs').read_text('utf8')
s=s.replace("await page.setViewportSize({width,height:1100});", "await page.setViewportSize({width,height:1100});await page.waitForFunction(w=>innerWidth===w,width);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));")
s=s.replace("const result=await editor.evaluate", "const result=await editor.evaluate").replace('rows.push(result);','rows.push({requested_width:width,...result});')
s+='''\nexport async function steadyMotionFrame(editor,frame=220){await editor.getByLabel('Exact preview frame',{exact:true}).fill(String(frame));await editor.getByRole('button',{name:'Preview this frame',exact:true}).click();await editor.getByText('Actual frame updated · full video not rendered',{exact:true}).waitFor();}\n'''
p.write_text(s,encoding='utf8',newline='\n')
p=scripts/'qualify-motion-production-201-v3.mjs';assert not p.exists();s=(scripts/'qualify-motion-production-201-v2.mjs').read_text('utf8').replace('motion-ui-journey-201-v1.mjs','motion-ui-journey-201-v2.mjs').replace('verifyMotionOverflow,untilMotion','verifyMotionOverflow,untilMotion,steadyMotionFrame').replace("'201-v2'","'201-v3'").replace('201-v2-motion-production.png','201-v3-motion-production.png').replace('report.overflow=await verifyMotionOverflow(page,editor);','report.overflow=await verifyMotionOverflow(page,editor);await steadyMotionFrame(editor);')
p.write_text(s,encoding='utf8',newline='\n')
p=scripts/'qualify-live-motion-201-v1.mjs';s=p.read_text('utf8').replace('motion-ui-journey-201-v1.mjs','motion-ui-journey-201-v2.mjs').replace('startMotion,recoverMotion,untilMotion','startMotion,recoverMotion,untilMotion,steadyMotionFrame').replace("await capture(page,'web');","await steadyMotionFrame(editor);await capture(page,'web');").replace("await capture(page,'desktop');","await steadyMotionFrame(nativeEditor);await capture(page,'desktop');")
p.write_text(s,encoding='utf8',newline='\n')
print('Versioned QA now waits for each requested viewport and captures a steady actual frame; no product changes.')
