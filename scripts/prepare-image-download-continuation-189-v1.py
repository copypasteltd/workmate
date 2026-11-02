"""Continue the completed paid image task read-only on its actual Assets route."""
from pathlib import Path
scripts=Path(__file__).resolve().parent
text=(scripts/'qualify-real-image-web-189-v3.mjs').read_text(encoding='utf8')
text=text.replace("const setup=JSON.parse", "const previous=JSON.parse(await readFile('.data/acceptance-189/real-image-web-6dabc1cb-df87-4c86-ae0e-e10d9403fdd4/receipt.json','utf8'));\nconst setup=JSON.parse")
start=text.index(" const filename='image-acceptance-189-'")
end=text.index(' const assets=await ok',start)
replacement=''' const filename=previous.filename;report.filename=filename;report.task_id=previous.task_id;
 report.scope='Read-only continuation of the exact completed public Web Designer task. No new task or model request; actual asset downloads and original-byte verification.';
 report.original_generation_receipt='.data/acceptance-189/real-image-web-6dabc1cb-df87-4c86-ae0e-e10d9403fdd4/receipt.json';
 const task=await ok(page,base+'/tasks/'+report.task_id);assert.equal(task.status,'succeeded');assert.equal(task.charged_micros,previous.task.charged_micros);
 report.task=previous.task;report.new_paid_tasks=0;
 pass('the original completed designer task and exact measured charge are reused without another model call');
'''
text=text[:start]+replacement+text[end:]
text=text.replace("WEB+'/app/files'","WEB+'/app/assets'")
with (scripts/'qualify-real-image-download-189-v1.mjs').open('x',encoding='utf8',newline='\n') as f:f.write(text)
