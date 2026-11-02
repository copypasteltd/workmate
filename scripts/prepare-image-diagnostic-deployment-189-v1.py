from pathlib import Path

scripts=Path(__file__).resolve().parent
for source,target in [('package-real-services-189-v2.py','package-real-services-189-v3.py'),('install-real-services-189-v2.sh','install-real-services-189-v3.sh')]:
    text=(scripts/source).read_text(encoding='utf8')
    text=text.replace('real-services-189-v2','real-services-189-v3')
    if source.startswith('install'):
        text=text.replace("previous=Path('/opt/workmate/overlays/real-services-189-v1/backend')", "previous=Path('/opt/workmate/overlays/real-services-189-v2/backend')")
        text=text.replace('live-189-v2','live-189-v3').replace('candidate-189-v2','candidate-189-v3')
        text=text.replace('zzzzzzzzzzzzzzzz-real-services-189-v3.conf','zzzzzzzzzzzzzzzzz-real-services-189-v3.conf')
    with (scripts/target).open('x',encoding='utf8',newline='\n') as output:output.write(text)
text=(scripts/'upload-real-services-189-v2.py').read_text(encoding='utf8')
text=text.replace("['workmate-real-services-189-v2.zip','workmate-real-services-189-v2.zip.sha256','workmate-admin-termination-189-v1.zip','workmate-admin-termination-189-v1.zip.sha256']", "['workmate-real-services-189-v3.zip','workmate-real-services-189-v3.zip.sha256']")
with (scripts/'upload-real-services-189-v3.py').open('x',encoding='utf8',newline='\n') as output:output.write(text)
text=(scripts/'retest-image-model-189-v1.sh').read_text(encoding='utf8')
text=text.replace('real-services-189-v2','real-services-189-v3').replace('live-189-v2','live-189-v3').replace('image-retest-189-v1.private.json','image-retest-189-v2.private.json')
with (scripts/'retest-image-model-189-v2.sh').open('x',encoding='utf8',newline='\n') as output:output.write(text)
