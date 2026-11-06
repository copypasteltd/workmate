from pathlib import Path
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts'
web=(scripts/'qualify-web-review-197-v1.mjs').read_text(encoding='utf8').replace("{authenticateOwner196} from './live-owner-196-v1.mjs'", "{authenticateOwner197} from './live-owner-197-v1.mjs'").replace('authenticateOwner196(browser)','authenticateOwner197(browser)').replace("'197-v1'","'197-v2'").replace('197-task-review.png','197-v2-task-review.png')
old=" await p.evaluate(()=>{localStorage.setItem('cp_theme','dark');});await p.reload({waitUntil:'domcontentloaded'});await p.getByRole('tab',{name:'Execution',exact:true}).click();await p.locator('.software-checks').waitFor();"
new=" for(let n=0;n<3&&await p.evaluate(()=>document.documentElement.dataset.theme)!=='dark';n++)await p.getByTitle('Theme: light / dark / system',{exact:true}).click();assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'dark');await p.getByRole('tab',{name:'Execution',exact:true}).click();await p.locator('.software-checks').waitFor();await p.locator('.task-workbench').evaluate(el=>el.scrollIntoView({block:'start'}));assert.ok(await p.getByRole('tab',{name:'Execution',exact:true}).isVisible());"
assert old in web;web=web.replace(old,new);(scripts/'qualify-web-review-197-v2.mjs').write_text(web,encoding='utf8')
p=root/'docs/tools/update-integrated-readmes-197-v1.py';text=p.read_text(encoding='utf8').replace("('197-task-review.png','workmate-197-v1-task-review')","('197-v2-task-review.png','workmate-197-v2-task-review')");p.write_text(text,encoding='utf8')

probe=(scripts/'probe-release-integrated-197-v1.mjs').read_text(encoding='utf8').replace('public-release-v1.sanitized.json','public-release-v2.sanitized.json').replace('browser-downloads-v1','browser-downloads-v2')
probe=probe.replace("let browser,context;", "let browser,context,active;\nconst digests=new Map();")
anchor=" context=await browser.newContext({acceptDownloads:true});"
assert anchor in probe
probe=probe.replace(anchor,anchor+"await context.exposeBinding('__qaReleaseChunk',async(_source,id,base64)=>{assert.equal(id,active);const state=digests.get(id),part=Buffer.from(base64,'base64');state.bytes+=part.length;assert.ok(state.bytes<=state.limit);state.hash.update(part);});")
start=probe.index('  let bytes=');end=probe.index('  assert.equal(bytes,spec.bytes)',start)
probe=probe[:start]+'''  active=spec.name;const state={bytes:0,limit:spec.bytes,hash:createHash('sha256')};digests.set(active,state);
  const full=await page.evaluate(async({url,id})=>{const r=await fetch(url,{signal:AbortSignal.timeout(300000)});if(r.status!==200)throw Error('Public full-body status '+r.status);const reader=r.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;for(let i=0;i<value.length;i+=32768){const part=value.subarray(i,i+32768);await window.__qaReleaseChunk(id,btoa(String.fromCharCode(...part)));}}}finally{reader.releaseLock();}return r.status;},{url,id:active});
  assert.equal(full,200);const bytes=state.bytes,sha256=state.hash.digest('hex');digests.delete(active);active=null;
'''+probe[end:]
probe=probe.replace('Actual browser transport; current public HEAD/range and complete package SHA-256.', 'Actual browser fetch transport; public HEAD/range and complete streamed response-body SHA-256. Download events are not used as a substitute for verifying bytes.')
(scripts/'probe-release-integrated-197-v2.mjs').write_text(probe,encoding='utf8')
p=root/'docs/tools/build-integrated-round-197-v1.py';text=p.read_text(encoding='utf8').replace('public-release-v1.sanitized.json','public-release-v2.sanitized.json');p.write_text(text,encoding='utf8')
print('Prepared actual dark-theme assertion and bounded complete browser-stream checksum verification. No product code changes.')
