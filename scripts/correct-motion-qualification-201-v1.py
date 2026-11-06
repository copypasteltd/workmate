from pathlib import Path
delivery=Path(__file__).resolve().parents[1]
source=delivery/'scripts/qualify-motion-production-201-v1.mjs';target=delivery/'scripts/qualify-motion-production-201-v2.mjs';assert not target.exists()
s=source.read_text('utf8').replace("selectOption(w.project.id);", "selectOption(w.project.id);await page.getByRole('link',{name:'Design canvas',exact:true}).click();")
s=s.replace("'201-v1'","'201-v2'").replace('201-v1-motion-production.png','201-v2-motion-production.png')
s=s.replace("if(page)await page.screenshot", "if(page)await writeFile(path.join(out,'failure-page.private.txt'),await page.locator('body').innerText()).catch(()=>{});if(page)await page.screenshot")
target.write_text(s,encoding='utf8',newline='\n')
print('Corrected QA navigation after workspace selection; no product source changed.')
