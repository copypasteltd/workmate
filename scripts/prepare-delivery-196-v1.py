from pathlib import Path
import json
delivery=Path(__file__).resolve().parents[1]
scripts=delivery/'scripts'
def put(name,text):(scripts/name).write_text(text,encoding='utf-8',newline='\n')

package=(scripts/'package-integrated-195-v10.py').read_text(encoding='utf-8').replace('deployment-195','deployment-196').replace('integrated-195-v10','integrated-196-v1').replace('stage=195','stage=196')
put('package-integrated-196-v1.py',package)
upload=(scripts/'upload-integrated-195-v10.py').read_text(encoding='utf-8').replace('deployment-195','deployment-196').replace('integrated-195-v10','integrated-196-v1').replace('workmate-upload-195-v10','workmate-upload-196-v1')
put('upload-integrated-196-v1.py',upload)
stage=(scripts/'stage-integrated-195-v10.sh').read_text(encoding='utf-8').replace('integrated-195-v10','integrated-196-v1').replace('integrated-195-v9','integrated-195-v10').replace('workmate-upload-195-v10','workmate-upload-196-v1').replace("m['stage']==195","m['stage']==196").replace('WM_STAGE_195','WM_STAGE_196')
put('stage-integrated-196-v1.sh',stage)
activation=(scripts/'activate-integrated-195-v5.sh').read_text(encoding='utf-8')
old="expected_proxy=(cfg/'integrated-195/activation-v2/nginx.conf.before').read_text().replace('product-downloads-193-v3/web/dist','integrated-195-v9/web/dist').replace('native-recheck-192-v1/admin/dist','integrated-195-v9/admin/dist').encode()\nassert proxy_before==expected_proxy"
proxy=json.loads((delivery/'.data/deployment-195/host-final-v3.sanitized.json').read_text())['proxy_sha256']
assert old in activation
activation=activation.replace(old,"assert hashlib.sha256(proxy_before).hexdigest()=='"+proxy+"'")
activation=activation.replace('integrated-195-v10','integrated-196-v1').replace('integrated-195-v9','integrated-195-v10').replace('integrated-195-v5','integrated-196-v1').replace('integrated-195/activation-v5','integrated-196/activation-v1').replace("state.mkdir(mode=0o700)","state.parent.mkdir(mode=0o700,exist_ok=True);state.mkdir(mode=0o700)").replace("'stage':195","'stage':196").replace('WM_ACTIVATE_195_V5','WM_ACTIVATE_196_V1')
put('activate-integrated-196-v1.sh',activation)

# Real packaged local Codex journey, retaining original transport and billing.
desktop=(scripts/'qualify-real-desktop-195-v1.mjs').read_text(encoding='utf-8')
desktop=desktop.replace('195','196').replace('deployment-196-v2/release','deployment-196-v1/release').replace("integrated-196-v7 schema163","integrated-196-v1 schema163").replace('0.7.5','0.7.6')
anchor=" await page.screenshot({path:path.join(run,'02-real-local-result.png')"
assert anchor in desktop
extra=r'''
 const bound=latest.events.filter(e=>e.value?.workmate_task_id===latest.task.task_id);
 assert.ok(bound.some(e=>e.kind==='item/completed'&&e.value?.item?.type==='commandExecution'),'A real native command must bind to the exact company task');
 await page.getByRole('button',{name:'Results and files',exact:true}).click();await page.getByRole('tab',{name:'Execution',exact:true}).click();await page.locator('.native-execution-record').first().waitFor();
 const preview=await page.evaluate(id=>window.copyPasteBridge.localAgent('result.preview',{id,path:'result.json'}),sessionId);assert.equal(preview.ok,true);assert.equal(JSON.parse(preview.value.text.replace(/^\uFEFF/,'')).marker,marker);
 const terminalShot=path.resolve('../copypaste-desktop/assets/screenshots/196-native-execution.png');await mkdir(path.dirname(terminalShot),{recursive:true});await page.screenshot({path:terminalShot,animations:'disabled',mask:[page.locator('.user-chip strong')]});
 pass('same Desktop task workspace shows its actual bound command output and reads current local result under the active grant');
'''
desktop=desktop.replace(anchor,extra+anchor)
anchor="pass('revoking local permission disables further work and preserves the original completed task');"
assert anchor in desktop
desktop=desktop.replace(anchor,anchor+"const deniedPreview=await page.evaluate(id=>window.copyPasteBridge.localAgent('result.preview',{id,path:'result.json'}),sessionId);assert.equal(deniedPreview.ok,false);assert.ok(deniedPreview.code);pass('revoked native grant also blocks current-file preview');")
put('qualify-real-desktop-196-v1.mjs',desktop)

# Reuse the unchanged Extension package bytes; publish a complete checksum set.
downloads=(scripts/'prepare-public-downloads-195-v1.py').read_text(encoding='utf-8')
downloads=downloads.replace('deployment-195-v2/release','deployment-196-v1/release').replace('deployment-195','deployment-196').replace('0.7.5','0.7.6').replace('/releases/195/','/releases/196/').replace("'stage':195","'stage':196")
start=downloads.index("archive=public/f'CopyPaste-Extension-")
end=downloads.index('catalog=',start)
downloads=downloads[:start]+"archive=public/f'CopyPaste-Extension-{version}.zip';archive.write_bytes((delivery/'.data/deployment-195/downloads'/archive.name).read_bytes());entries=json.loads((delivery/'.data/deployment-195/package-receipt.private.json').read_text())['extension_entries']\n"+downloads[end:]
put('prepare-public-downloads-196-v1.py',downloads)
put('upload-downloads-196-v1.py',(scripts/'upload-downloads-195-v1.py').read_text(encoding='utf-8').replace('deployment-195','deployment-196').replace('downloads-195-v1','downloads-196-v1').replace("'stage':195","'stage':196"))
print('Versioned release, rollback and actual native-journey scripts prepared. No deployment or packaging executed.')
