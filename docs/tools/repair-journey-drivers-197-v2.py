from pathlib import Path
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts'
native=(scripts/'qualify-real-desktop-197-v1.mjs').read_text(encoding='utf8')
native=native.replace("await app.evaluate(async()=>{const {session}=await import('electron'),network=", "await app.evaluate(({session})=>{const network=")
native=native.replace("'197-v1'","'197-v2'").replace('197-local-workspace.png','197-v2-local-workspace.png').replace('197-native-execution.png','197-v2-native-execution.png')
(scripts/'qualify-real-desktop-197-v2.mjs').write_text(native,encoding='utf8')
owner=(scripts/'live-owner-196-v1.mjs').read_text(encoding='utf8').replace('authenticateOwner196','authenticateOwner197')
owner=owner.replace(' const c=await context(browser);let mailbox;', ' const c=await context(browser);c.setDefaultNavigationTimeout(60000);let mailbox;')
owner=owner.replace("await page.goto(WEB+'/login',{waitUntil:'domcontentloaded'})", "await navigate(page,WEB+'/login')").replace("await mailbox.goto(ADMIN+'/',{waitUntil:'domcontentloaded'})", "await navigate(mailbox,ADMIN+'/')")
owner+='''\nexport async function navigate(page,url){for(let attempt=0;;attempt++){try{return await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){if(attempt!==0||e.name!=='TimeoutError')throw Error(e.name+': '+e.message.split('\\n')[0]);}}}\n'''
(scripts/'live-owner-197-v1.mjs').write_text(owner,encoding='utf8')
extension=(scripts/'qualify-native-extension-197-v1.mjs').read_text(encoding='utf8').replace("{authenticateOwner196} from './live-owner-196-v1.mjs'", "{authenticateOwner197,navigate} from './live-owner-197-v1.mjs'").replace('authenticateOwner196(browser)','authenticateOwner197(browser)').replace("await main.goto(WEB+'/downloads',{waitUntil:'domcontentloaded'})", "await navigate(main,WEB+'/downloads')").replace("'197-v1'","'197-v2'").replace('197-v1-side-panel.png','197-v2-side-panel.png')
(scripts/'qualify-native-extension-197-v2.mjs').write_text(extension,encoding='utf8')
smoke=(scripts/'smoke-integrated-197-v1.mjs').read_text(encoding='utf8').replace("import {chromium} from 'playwright';", "import {chromium} from 'playwright';\nimport {authenticateOwner197} from './live-owner-197-v1.mjs';").replace("user=await authenticate(browser,'realowner','agent-test-20261102@workmate.local')", "user=await authenticateOwner197(browser)")
(scripts/'smoke-integrated-197-v2.mjs').write_text(smoke,encoding='utf8')
p=root/'docs/tools/update-integrated-readmes-197-v1.py';text=p.read_text(encoding='utf8').replace("('197-native-execution.png','workmate-197-v1-local-workspace')", "('197-v2-native-execution.png','workmate-197-v2-local-workspace')").replace("('197-v1-side-panel.png','workmate-197-v1-side-panel')", "('197-v2-side-panel.png','workmate-197-v2-side-panel')");p.write_text(text,encoding='utf8')
print('Preserved v1 failures. Prepared v2 native observer and bounded read-only browser navigation. Product artifacts unchanged.')
