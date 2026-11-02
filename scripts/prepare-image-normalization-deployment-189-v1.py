from pathlib import Path
scripts=Path(__file__).resolve().parent
for source,target in [('package-real-services-189-v3.py','package-real-services-189-v4.py'),('install-real-services-189-v3.sh','install-real-services-189-v4.sh')]:
    text=(scripts/source).read_text(encoding='utf8').replace('real-services-189-v3','real-services-189-v4')
    if source.startswith('install'):
        text=text.replace("previous=Path('/opt/workmate/overlays/real-services-189-v2/backend')", "previous=Path('/opt/workmate/overlays/real-services-189-v3/backend')")
        text=text.replace('live-189-v3','live-189-v4').replace('candidate-189-v3','candidate-189-v4')
        text=text.replace('zzzzzzzzzzzzzzzzz-real-services-189-v4.conf','zzzzzzzzzzzzzzzzzz-real-services-189-v4.conf')
    with (scripts/target).open('x',encoding='utf8',newline='\n') as output:output.write(text)
text=(scripts/'upload-real-services-189-v3.py').read_text(encoding='utf8').replace('real-services-189-v3','real-services-189-v4')
with (scripts/'upload-real-services-189-v4.py').open('x',encoding='utf8',newline='\n') as output:output.write(text)
text=(scripts/'retest-image-model-189-v2.sh').read_text(encoding='utf8').replace('real-services-189-v3','real-services-189-v4').replace('live-189-v3','live-189-v4').replace('image-retest-189-v2.private.json','image-retest-189-v3.private.json')
needle="for(const id of ['b29c076a-1fdd-497a-a5c3-71090cdcb56c','54d8c94a-b193-4102-84fb-048be7a8a304']){"
assert text.count(needle)==1
text=text.replace(needle,"for(const [id,expectedHttp] of [['b29c076a-1fdd-497a-a5c3-71090cdcb56c',403],['54d8c94a-b193-4102-84fb-048be7a8a304',403],['03f7f43a-feee-4290-b64a-4452e02a643a',200],['5cbc9945-9af1-45f7-bf83-57019c13a103',200]]){")
text=text.replace("assert.equal(row.http_status,403)","assert.equal(row.http_status,expectedHttp)")
text=text.replace("provider_reference:'Recorded terminal upstream HTTP 403 response'", "provider_reference:'Recorded terminal upstream HTTP '+expectedHttp+' response'")
text=text.replace("source_reference:'Original gateway request '+id+' and image-permission-f5ecc698-357e-4b71-9be6-b8dbe9c7d479.sanitized.json'", "source_reference:'Original gateway request '+id+' and its recorded validation receipt; HTTP 200 observations include validations eab47ede-ffe5-424a-93f1-35ea72cc2b90 and 568ed719-1472-4528-abb6-ae71beedb33c'")
old="source_note:'The original gateway operation received HTTP 403 and has a recorded finish time. An independent model-specific permission probe confirmed Image generation is not enabled for this group. This statement confirms only request termination and does not assert any usage quantity, invoice amount, no-charge status or successful generation.'"
new="source_note:expectedHttp===403?'The original gateway operation received a terminal HTTP 403 response and has a recorded finish time. This statement confirms only termination and does not assert any usage quantity, invoice amount or no-charge status.':'The synchronous image response was fully consumed as HTTP 200 before image verification failed. The model-specific diagnostic validation recorded a complete inline PNG with a 1254-square IHDR, contrary to the requested 1024 square. The request has ended; this statement does not assert any confirmed usage quantity, invoice, zero charge or successful validation.'"
assert text.count(old)==1
text=text.replace(old,new).replace('terminal HTTP refusal','terminal synchronous HTTP response')
with (scripts/'retest-image-model-189-v3.sh').open('x',encoding='utf8',newline='\n') as output:output.write(text)
