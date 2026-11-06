from pathlib import Path
root=Path(__file__).resolve().parents[2];dev=root/'dev';scripts=dev/'copypaste-delivery/scripts';desktop=dev/'copypaste-desktop'
def put(p,text):p.write_text(text,encoding='utf8',newline='\n')
package=(desktop/'scripts/package-integrated-197-v2.mjs').read_text(encoding='utf8').replace('deployment-197-v2','deployment-197-v3').replace('integrated-197-v1/verification','integrated-197-v2/verification').replace("CSC_IDENTITY_AUTO_DISCOVERY:'false'", "CSC_IDENTITY_AUTO_DISCOVERY:'false',ELECTRON_BUILDER_COMPRESSION_LEVEL:'5'")
put(desktop/'scripts/package-integrated-197-v3.mjs',package)
for stem,suffix in [('package-integrated','.py'),('upload-integrated','.py')]:
 p=scripts/(stem+'-197-v1'+suffix);text=p.read_text(encoding='utf8').replace('deployment-197','deployment-197-v2').replace('integrated-197-v1','integrated-197-v2').replace('workmate-upload-197-v1','workmate-upload-197-v2');put(scripts/(stem+'-197-v2'+suffix),text)
for stem in ['stage-integrated','activate-integrated']:
 text=(scripts/(stem+'-197-v1.sh')).read_text(encoding='utf8').replace('integrated-196-v1','__PREVIOUS__').replace('integrated-197-v1','integrated-197-v2').replace('__PREVIOUS__','integrated-197-v1').replace('workmate-upload-197-v1','workmate-upload-197-v2').replace('activation-v1','activation-v2').replace('downloads-v1','downloads-v2').replace('WM_ACTIVATE_197_V1','WM_ACTIVATE_197_V2')
 put(scripts/(stem+'-197-v2.sh'),text)
downloads=(scripts/'prepare-public-downloads-197-v1.py').read_text(encoding='utf8').replace("out=delivery/'.data/deployment-197'", "out=delivery/'.data/deployment-197-v2'").replace('deployment-197-v2/release','deployment-197-v3/release').replace('0.7.7','0.7.8').replace('/releases/197/','/releases/197-v2/')
start=downloads.index("archive=public/f'CopyPaste-Extension-");end=downloads.index('catalog=',start)
downloads=downloads[:start]+'''archive=public/f'CopyPaste-Extension-{version}.zip';archive.write_bytes((delivery/'.data/deployment-197/downloads'/archive.name).read_bytes());entries=json.loads((delivery/'.data/deployment-197/package-receipt.private.json').read_text())['extension_entries']
for entry in entries:
 raw=(extension/'dist'/entry['path']).read_bytes();assert len(raw)==entry['bytes'] and sha256(raw).hexdigest()==entry['sha256']
'''+downloads[end:]
put(scripts/'prepare-public-downloads-197-v2.py',downloads)
upload=(scripts/'upload-downloads-197-v1.py').read_text(encoding='utf8').replace("state=root/'.data/deployment-197'", "state=root/'.data/deployment-197-v2'").replace('workmate-downloads-197-v1','workmate-downloads-197-v2');put(scripts/'upload-downloads-197-v2.py',upload)
activation=(scripts/'activate-downloads-197-v1.sh').read_text(encoding='utf8').replace("needle='location ^~ /downloads/releases/196/ {'", "needle='__OLDER_LOCATION__'").replace('/downloads/releases/197','/downloads/releases/197-v2').replace('__OLDER_LOCATION__','location ^~ /downloads/releases/197/ {').replace('workmate-downloads-197-v1','workmate-downloads-197-v2').replace('downloads-v1','downloads-v2').replace('0.7.7','0.7.8')
put(scripts/'activate-downloads-197-v2.sh',activation)
collector=(scripts/'collect-integrated-197-v1.sh').read_text(encoding='utf8').replace('integrated-197-v1','integrated-197-v2').replace('activation-v1','activation-v2').replace('downloads-v1','downloads-v2');put(scripts/'collect-integrated-197-v2.sh',collector)
finalize=(scripts/'finalize-release-metadata-197-v1.mjs').read_text(encoding='utf8').replace(".data/deployment-197'", ".data/deployment-197-v2'").replace('integrated-197-v1','integrated-197-v2').replace('0.7.7','0.7.8');put(scripts/'finalize-release-metadata-197-v2.mjs',finalize)
probe=(scripts/'probe-release-integrated-197-v1.mjs').read_text(encoding='utf8').replace('.data/deployment-197/','.data/deployment-197-v2/').replace('/releases/197/','/releases/197-v2/');put(scripts/'probe-release-integrated-197-v3.mjs',probe)
web=(scripts/'qualify-web-review-197-v2.mjs').read_text(encoding='utf8').replace("'197-v2'","'197-v3'").replace('197-v2-task-review.png','197-v3-task-review.png')
web=web.replace("await p.locator('.software-checks').waitFor();assert.equal", "await p.locator('.software-checks').waitFor();assert.doesNotMatch(await p.locator('.software-checks').innerText(),/NaNs|undefined ms|Infinity/);assert.equal")
put(scripts/'qualify-web-review-197-v3.mjs',web)
smoke=(scripts/'smoke-integrated-197-v2.mjs').read_text(encoding='utf8').replace('.data/deployment-197/host-final-v1','.data/deployment-197-v2/host-final-v2').replace('integrated-197-v1/backend','integrated-197-v2/backend').replace('/releases/197/','/releases/197-v2/').replace("'197-v1'","'197-v2'").replace('197-service-readiness.png','197-v2-service-readiness.png');put(scripts/'smoke-integrated-197-v3.mjs',smoke)
print('Prepared final immutable timing-fix release, packaging compression level5 and read-only delta journeys. No deployment performed.')
