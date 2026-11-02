from pathlib import Path
delivery=Path(__file__).resolve().parents[1]
state=delivery/'.data/acceptance-189/image-web-isolated-setup-189-v1.private.json'
with (state.parent/'image-web-isolated-setup.cancel-failure-189-v2.private.json').open('xb') as output:output.write(state.read_bytes())
text=(delivery/'scripts/prepare-isolated-image-qa-189-v2.mjs').read_text(encoding='utf8')
needle="'/v1/tasks/'+id+'/controls',{action:'cancel',expected_version:queued.version}"
assert text.count(needle)==1
text=text.replace(needle,"base+'/tasks/'+id+'/cancel',{}")
with (delivery/'scripts/prepare-isolated-image-qa-189-v3.mjs').open('x',encoding='utf8',newline='\n') as output:output.write(text)
