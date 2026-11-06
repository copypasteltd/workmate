from pathlib import Path
root=Path(__file__).resolve().parents[2];p=root/'dev/copypaste-delivery/scripts/qualify-desktop-delta-197-v2.mjs'
text=p.read_text(encoding='utf8')
text=text.replace("await page.getByRole('tab',{name:'Execution',exact:true}).waitFor();", "await page.locator('.software-checks .software-check').first().waitFor();")
text=text.replace("await page.getByRole('tab',{name:'Execution',exact:true}).click();", "")
text=text.replace("page.locator('.task-workbench').evaluate", "page.locator('.software-checks').evaluate")
text=text.replace("await page.getByRole('tab',{name:'Usage',exact:true}).click();await page.locator('.workbench-usage').waitFor();", "await page.locator('.software-checks details').first().locator('summary').click();await page.locator('.software-checks details').first().locator('summary').click();")
p.write_text(text,encoding='utf8',newline='\n')
print('Final Desktop driver uses its actual legacy cloud-task software-check entry, preserving the failed Web-tab assumption in v1.')
