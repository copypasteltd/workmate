"""Prepare versioned immutable deployment/qualification scripts; do not execute them."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]; scripts = root / 'scripts'
def put(name, value): (scripts / name).write_text(value, encoding='utf8', newline='\n')
def previous(value): return value.replace('integrated-195-v10','__PREVIOUS__').replace('196','197').replace('__PREVIOUS__','integrated-196-v1')
for stem in ['package-integrated','activate-integrated','collect-integrated']:
    suffix = '.py' if stem == 'package-integrated' else '.sh'
    value = previous((scripts / (stem+'-196-v1'+suffix)).read_text(encoding='utf8'))
    put(stem+'-197-v1'+suffix, value)
upload = (scripts / 'upload-integrated-196-v2.py').read_text(encoding='utf8').replace('196','197').replace('workmate-upload-197-v2','workmate-upload-197-v1')
put('upload-integrated-197-v1.py', upload)
stage = previous((scripts/'stage-integrated-196-v1.sh').read_text(encoding='utf8')).replace('workmate-upload-197-v2','workmate-upload-197-v1')
# Preserve the native Office runtime only after comparing its actual unchanged sources.
stage = stage.replace("if source.name in ['document-preview'] or source.name.startswith('native-qualification-'):continue", "if source.name.startswith('native-qualification-'):continue")
begin = stage.index('# Office setup and qualification')
stage = stage[:begin] + '''# This batch does not change Office conversion. Preserve its qualified native runtime.
for folder in ['src','dist/src','scripts']:
 for p in (previous/folder).glob('*'):
  if p.is_file() and any(word in p.name for word in ['document-preview','office','document-produce']):
   assert (backend/folder/p.name).is_file() and hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256((backend/folder/p.name).read_bytes()).digest()
assert json.loads((data/'document-preview/qualification-195-v2.json').read_text())['status']=='passed'
print(json.dumps({'status':'staged','overlay':str(dest),'office_runtime':'unchanged, previous qualification retained','current_services_unchanged':True}))
WM_STAGE_197
'''
put('stage-integrated-197-v1.sh', stage)
downloads=(scripts/'prepare-public-downloads-195-v1.py').read_text(encoding='utf8').replace('195','197').replace('deployment-197-v2/release','deployment-197-v1/release').replace('0.7.5','0.7.7').replace('0.5.5','0.5.6')
put('prepare-public-downloads-197-v1.py',downloads)
put('upload-downloads-197-v1.py',(scripts/'upload-downloads-196-v1.py').read_text(encoding='utf8').replace('196','197'))
activation=(scripts/'activate-downloads-196-v1.sh').read_text(encoding='utf8').replace('/downloads/releases/195/','__OLD_DOWNLOADS__').replace('196','197').replace('__OLD_DOWNLOADS__','/downloads/releases/196/').replace('0.7.6','0.7.7').replace('0.5.5','0.5.6').replace('manifest-v2.json','manifest.json')
put('activate-downloads-197-v1.sh',activation)
finalize=(scripts/'finalize-release-metadata-196-v1.mjs').read_text(encoding='utf8').replace('196','197').replace('integrated-197-v4','integrated-197-v1').replace('0.7.6','0.7.7').replace('integrated-v4','integrated-v1')
put('finalize-release-metadata-197-v1.mjs',finalize)

desktop=(scripts/'qualify-real-desktop-196-v2.mjs').read_text(encoding='utf8').replace('196','197').replace('deployment-197-v2/release','deployment-197-v1/release').replace('0.7.6','0.7.7').replace("'197-v2'","'197-v1'")
anchor=' const shell=await app.evaluate'
assert anchor in desktop
observe=''' await app.evaluate(async()=>{const {session}=await import('electron'),network=session.fromPartition('copypaste-company-api-v1',{cache:false});globalThis.__qaCompanyNetwork={persistent:network.isPersistent(),requests:[]};const original=network.fetch.bind(network);network.fetch=async(input,init)=>{const path=new URL(typeof input==='string'?input:input.url).pathname,info={path,method:init?.method??'GET',redirect:init?.redirect,credentials:init?.credentials,bypass:init?.bypassCustomProtocolHandlers===true,cookie:new Headers(init?.headers).has('cookie')};try{const r=await original(input,init);globalThis.__qaCompanyNetwork.requests.push({...info,status:r.status});return r;}catch(e){globalThis.__qaCompanyNetwork.requests.push({...info,error:e.name});throw e;}};});
'''
desktop=desktop.replace(anchor,observe+anchor)
anchor=" const preview=await page.evaluate"
extra=''' const commands=page.locator('.native-command');assert.ok(await commands.count()>0);assert.equal(await commands.first().getAttribute('open'),null);await commands.first().locator('summary').click();assert.ok((await commands.first().locator('pre').innerText()).length>0);await commands.first().locator('summary').click();const output=page.locator('.native-command-output').first();await output.locator('summary').click();assert.ok((await output.locator('pre').innerText()).length>0);await output.locator('summary').click();pass('actual command and output records start collapsed, open on demand and retain visible exit status');
'''
assert anchor in desktop;desktop=desktop.replace(anchor,extra+anchor)
anchor=" assert.deepEqual(report.javascript_errors,[]);report.status='passed';"
extra=" report.company_network=await app.evaluate(()=>globalThis.__qaCompanyNetwork);assert.equal(report.company_network.persistent,false);assert.ok(report.company_network.requests.length>0);assert.ok(report.company_network.requests.every(r=>r.redirect==='error'&&r.credentials==='omit'&&r.bypass&&!r.cookie));pass('actual native API/auth requests use the memory-only Chromium session without browser cookies or redirects');"
assert anchor in desktop;desktop=desktop.replace(anchor,extra+anchor)
put('qualify-real-desktop-197-v1.mjs',desktop)

extension=(scripts/'qualify-native-extension-196-v1.mjs').read_text(encoding='utf8').replace('196','197').replace("'./live-owner-197-v1.mjs'","'./live-owner-196-v1.mjs'").replace('authenticateOwner197','authenticateOwner196').replace('0.5.5','0.5.6')
put('qualify-native-extension-197-v1.mjs',extension)
smoke=(scripts/'smoke-integrated-196-v1.mjs').read_text(encoding='utf8').replace('196','197').replace('0.7.6','0.7.7').replace('0.5.5','0.5.6')
# The smoke reads an existing completed task; no model request is created by it.
put('smoke-integrated-197-v1.mjs',smoke)
probe=(scripts/'probe-release-integrated-196-v2.mjs').read_text(encoding='utf8').replace('196','197').replace('public-release-v2','public-release-v1').replace('browser-downloads-v2','browser-downloads-v1')
probe=probe.replace("const previous=JSON.parse(await readFile('.data/deployment-197/public-release-v1.sanitized.json','utf8'));\n",'')
start=probe.index('  const earlier=');end=probe.index('  let bytes=',start);probe=probe[:start]+probe[end:]
probe=probe.replace(' The Setup full-body digest is reused only from the same immutable URL and exact bytes already received in the retained v1 attempt.',' All current artifacts are downloaded in full in this run.')
put('probe-release-integrated-197-v1.mjs',probe)
print('Prepared round197 deployment, download and real client journeys; nothing deployed or tested by this preparation.')
