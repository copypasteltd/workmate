import assert from 'node:assert/strict';
export async function startMotion(page,name){
 const area=page.getByRole('region',{name:'Video production',exact:true});await area.getByRole('button',{name:'New video project',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'New video project',exact:true});await editor.getByText('Start with a video layout',{exact:true}).click();await editor.getByLabel('Layout format',{exact:true}).selectOption('square');await editor.locator('.motion-starter').filter({hasText:'Campaign launch'}).click();assert.equal(await editor.locator('.motion-starter').count(),6);await editor.getByLabel('Project name',{exact:true}).fill(name);
 await editor.getByLabel('Scene 1 duration (frames)',{exact:true}).fill('90');await editor.getByRole('button',{name:'Add caption',exact:true}).click();await editor.getByLabel('Caption text',{exact:true}).fill('An idea worth making.');
 await editor.getByRole('button',{name:'Undo',exact:true}).click();await editor.getByRole('button',{name:'Redo',exact:true}).click();
 await editor.getByLabel('Exact preview frame',{exact:true}).fill('97');await editor.getByRole('button',{name:'Preview this frame',exact:true}).click();await editor.getByText('Actual frame updated · full video not rendered',{exact:true}).waitFor();return {area,editor};
}
export async function recoverMotion(page,name){
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('region',{name:'Video production',exact:true}).getByRole('button',{name:'New video project',exact:true}).click();const editor=page.getByRole('dialog');await editor.getByRole('button',{name:'Restore draft',exact:true}).click();assert.equal(await editor.getByLabel('Project name',{exact:true}).inputValue(),name);assert.equal(await editor.getByLabel('Scene 1 duration (frames)',{exact:true}).inputValue(),'90');await editor.getByLabel('Exact preview frame',{exact:true}).fill('97');await editor.getByRole('button',{name:'Preview this frame',exact:true}).click();await editor.getByText('Actual frame updated · full video not rendered',{exact:true}).waitFor();return editor;
}
export async function verifyMotionOverflow(page,editor){
 const rows=[];for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:1100});await page.waitForFunction(w=>innerWidth===w,width);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const result=await editor.evaluate(e=>({width:innerWidth,document:document.documentElement.scrollWidth,dialog:e.clientWidth,dialogContent:e.scrollWidth}));assert.ok(result.document<=result.width);assert.ok(result.dialogContent<=result.dialog+1);rows.push({requested_width:width,...result});}return rows;
}
export async function untilMotion(read,predicate,timeout=120000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const v=await read();if(predicate(v))return v;await new Promise(r=>setTimeout(r,300));}throw Error('Motion state did not reach the expected result');}

export async function steadyMotionFrame(editor,frame=220){await editor.getByLabel('Exact preview frame',{exact:true}).fill(String(frame));await editor.getByRole('button',{name:'Preview this frame',exact:true}).click();await editor.getByText('Actual frame updated · full video not rendered',{exact:true}).waitFor();}
