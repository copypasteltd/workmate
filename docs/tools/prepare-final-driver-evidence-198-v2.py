from pathlib import Path
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts'
p=scripts/'qualify-desktop-delta-198-v1.mjs';q=scripts/'qualify-desktop-delta-198-v2.mjs';assert not q.exists();s=p.read_text(encoding='utf8')
s=s.replace('198-v2-desktop-directory','198-v3-desktop-directory').replace("'198-v2',()=>page.screenshot","'198-v3',()=>page.screenshot")
old="await page.getByRole('tab',{name:'Usage',exact:true}).click();await page.locator('.workbench-usage').waitFor();"
assert s.count(old)==1
s=s.replace(old,"await page.getByRole('heading',{name:'Task details',exact:true}).waitFor();await page.getByText('Settled usage',{exact:true}).waitFor();")
s=s.replace('original cloud task, and neutral','original cloud task summary (Desktop cloud details retain their existing summary layout), and neutral')
s=s.replace("report.error=e.name+': '+String(e.message).split('\\n')[0];}","report.error=e.name+': '+String(e.message).split('\\n')[0];report.error_locator=String(e.message).split('\\n').find(s=>s.includes('getByRole')||s.includes('locator('));if(page)await page.screenshot({path:path.join(out,'failure.private.png')}).catch(()=>{});}")
q.write_text(s,encoding='utf8',newline='\n')
p=scripts/'qualify-work-directory-198-v5.mjs';q=scripts/'qualify-work-directory-198-v6.mjs';assert not q.exists();q.write_text(p.read_text(encoding='utf8').replace('198-v5','198-v6'),encoding='utf8',newline='\n')
for file in ['docs/tools/update-integrated-readmes-198-v1.py','docs/tools/finalize-evidence-delta-198-v2.py']:
    p=root/file;s=p.read_text(encoding='utf8').replace('198-v5-task-directory','198-v6-task-directory').replace('workmate-198-v5-work-directory','workmate-198-v6-work-directory').replace('198-v2-desktop-directory','198-v3-desktop-directory');p.write_text(s,encoding='utf8',newline='\n')
print('retained original network and Desktop-layout assumption failures; prepared final actual-layout drivers')
