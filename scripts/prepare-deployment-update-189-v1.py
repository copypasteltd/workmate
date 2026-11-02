from pathlib import Path
scripts=Path(__file__).resolve().parent

for source,target in [('package-real-services-189-v1.py','package-real-services-189-v2.py'),('install-real-services-189-v1.sh','install-real-services-189-v2.sh')]:
 text=(scripts/source).read_text(encoding='utf8')
 text=text.replace('real-services-189-v1','real-services-189-v2')
 if source.startswith('install'):
  text=text.replace("previous=Path('/opt/workmate/overlays/real-services-188-v8/backend')","previous=Path('/opt/workmate/overlays/real-services-189-v1/backend')")
  text=text.replace("live-189-v1","live-189-v2").replace('candidate-189-v1','candidate-189-v2')
  text=text.replace('zzzzzzzzzzzzzzz-real-services-189-v2.conf','zzzzzzzzzzzzzzzz-real-services-189-v2.conf')
 with (scripts/target).open('x',encoding='utf8',newline='\n') as stream:stream.write(text)

text=(scripts/'upload-real-services-189-v1.py').read_text(encoding='utf8')
text=text.replace("['workmate-real-services-189-v1.zip','workmate-real-services-189-v1.zip.sha256']", "['workmate-real-services-189-v2.zip','workmate-real-services-189-v2.zip.sha256','workmate-admin-termination-189-v1.zip','workmate-admin-termination-189-v1.zip.sha256']")
with (scripts/'upload-real-services-189-v2.py').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
