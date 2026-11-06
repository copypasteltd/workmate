from pathlib import Path
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery';p=L/'scripts/qualify-live-marketing-review-203-v1.mjs';s=p.read_text('utf-8')
needle=" const previous=await ok(page,base+'/tasks/'+original.task_id);"
assert needle in s
insert=''' const input=JSON.parse(await readFile('.data/acceptance-203/real-specialists-v1/203-controlled-design-brief.txt.source.json','utf8'));
 const intakePosts=[];const observe=r=>{if(r.method()==='POST'&&new URL(r.url()).pathname===base+'/tasks')intakePosts.push(r.url());};page.on('request',observe);
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('cp:new-task',{detail:{role:'frontend'}})));const intake=page.getByRole('dialog',{name:'Start something new',exact:true});await intake.waitFor();
 await intake.getByLabel('What would you like to make?',{exact:true}).fill('Prepare an offline enquiry prototype from this controlled test brief. Do not run until I confirm Start.');
 await intake.getByRole('button',{name:'Reference materials',exact:true}).click();await intake.getByLabel('Search source assets',{exact:true}).fill('203-controlled-design-brief.txt');await intake.locator('.composer-library').getByRole('button').filter({hasText:'203-controlled-design-brief.txt'}).click();await intake.getByLabel('Choose a pinned version',{exact:true}).selectOption(input.version.id);
 await intake.getByRole('list',{name:'Pinned attachments for this message',exact:true}).getByText('203-controlled-design-brief.txt',{exact:true}).waitFor();
 recording=new WorkmateRecording('web','specialist-intake-live','203-v1',()=>page.screenshot({type:'jpeg',quality:74,mask:[page.locator('.user-chip strong')],maskColor:'#d7d8df'}),'Actual deployed Web specialist intake with an explicitly selected controlled QA source. No task submitted or model charge.',delivery);await recording.start();
 await intake.locator('summary').click();await intake.getByLabel('Task budget limit (HKD)',{exact:true}).fill('5');await intake.locator('summary').click();
 const screenshotPath=path.join(web,'assets/screenshots/203-v1-specialist-intake-live.png');await page.screenshot({path:screenshotPath,animations:'disabled',mask:[page.locator('.user-chip strong')],maskColor:'#d7d8df'});report.screenshots.push({path:'copypaste-web/assets/screenshots/'+path.basename(screenshotPath),sha256:hash(await readFile(screenshotPath))});report.recordings.push(await recording.stop());recording=null;
 await intake.getByRole('button',{name:'Close',exact:true}).click();assert.equal(intakePosts.length,0);page.off('request',observe);report.intake={source_version:input.version.id,submit_count:0,model_calls:0,controlled_source:true};await pass('Deployed specialist intake pins the actual selected source, exposes budget and creates no task before explicit confirmation');
'''
s=s.replace(needle,insert+needle);p.write_text(s,encoding='utf-8',newline='\n');print('Prepared the actual deployed intake journey before final Web/native verification.')
