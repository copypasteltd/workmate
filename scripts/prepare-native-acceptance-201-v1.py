"""Wait for the real renderer before reloading; preserve failed original evidence."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=(root/'scripts/qualify-live-motion-201-v2.mjs').read_text('utf8').replace('201-v2-motion-production-live.png','201-v3-motion-production-live.png').replace("'motion-production-live','201-v2'","'motion-production-live','201-v3'")
old="await page.waitForLoadState('domcontentloaded');await page.addInitScript"
new="await page.waitForURL(u=>u.protocol==='file:'&&u.pathname.endsWith('/renderer-dist/index.html'),{timeout:45000});await page.waitForFunction(()=>typeof window.copyPasteBridge?.request==='function'&&document.querySelector('#root')?.childElementCount>0);await untilMotion(()=>app.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows()[0].webContents.isLoadingMainFrame()),Boolean,45000);await page.addInitScript"
assert source.count(old)==1
source=source.replace(old,new)
p=root/'scripts/qualify-live-motion-201-v3.mjs';assert not p.exists();p.write_text(source,encoding='utf8',newline='\n')
print('Renderer-startup race correction ready; no product or immutable media changed.')
