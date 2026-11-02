"""Prepare a separately versioned code-only overlay after the actual Web counterexample."""
from pathlib import Path
root=Path(__file__).resolve().parents[3]
scripts=Path(__file__).resolve().parent
for source,target in [('package-real-services-189-v4.py','package-real-services-189-v5.py'),('install-real-services-189-v4.sh','install-real-services-189-v5.sh'),('upload-real-services-189-v4.py','upload-real-services-189-v5.py')]:
 text=(scripts/source).read_text(encoding='utf8').replace('real-services-189-v4','real-services-189-v5')
 if source.startswith('install'):
  text=text.replace("previous=Path('/opt/workmate/overlays/real-services-189-v3/backend')","previous=Path('/opt/workmate/overlays/real-services-189-v4/backend')")
  text=text.replace('live-189-v4','live-189-v5').replace('candidate-189-v4','candidate-189-v5')
  text=text.replace('zzzzzzzzzzzzzzzzzz-real-services-189-v5.conf','zzzzzzzzzzzzzzzzzzz-real-services-189-v5.conf')
 with (scripts/target).open('x',encoding='utf8',newline='\n') as f:f.write(text)
text=(scripts/'qualify-real-image-web-189-v2.mjs').read_text(encoding='utf8')
with (scripts/'qualify-real-image-web-189-v3.mjs').open('x',encoding='utf8',newline='\n') as f:f.write(text)
tests=root/'dev/copypaste-platform/tests'
text=(tests/'current-test-discovery-189-v1.test.ts').read_text(encoding='utf8').replace('run-current-tests-owned-v13.mjs','run-current-tests-owned-v14.mjs').replace('current-test-discovery-189-v1.test.ts','current-test-discovery-189-v2.test.ts')
text=text.replace('"current-test-discovery-189-v2.test.ts"]','"current-test-discovery-189-v2.test.ts", "capability-bindings-189-v1.test.ts", "runtime-image-failure-189-v1.test.ts"]')
with (tests/'current-test-discovery-189-v2.test.ts').open('x',encoding='utf8',newline='\n') as f:f.write(text)
