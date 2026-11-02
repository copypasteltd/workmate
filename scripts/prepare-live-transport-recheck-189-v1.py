from pathlib import Path
import json

scripts = Path(__file__).resolve().parent
text = (scripts / 'live-client-189-v1.mjs').read_text(encoding='utf8')
before = "if(kind==='admin')saved=null;const c=await context(browser,saved?{storageState:saved}:{}),page=await c.newPage();"
after = "if(kind==='admin')saved=null;const c=await context(browser,saved?{storageState:saved}:{});let page=await c.newPage();"
assert text.count(before) == 1
text = text.replace(before, after)
before = "if(attempt===2)throw e;}}"
after = "if(attempt===2)throw e;await page.close();page=await c.newPage();}}"
assert text.count(before) == 1
text = text.replace(before, after)
with (scripts / 'live-client-189-v2.mjs').open('x', encoding='utf8', newline='\n') as stream:
    stream.write(text)
for base in ['qualify-real-desktop', 'check-public-session']:
    text = (scripts / (base+'-189-v1.mjs')).read_text(encoding='utf8')
    assert text.count('live-client-189-v1.mjs') == 1
    text = text.replace('live-client-189-v1.mjs','live-client-189-v2.mjs')
    with (scripts / (base+'-189-v2.mjs')).open('x', encoding='utf8', newline='\n') as stream:
        stream.write(text)
print(json.dumps({'created':['live-client-189-v2.mjs','qualify-real-desktop-189-v2.mjs','check-public-session-189-v2.mjs'], 'reason':'Close a timed-out navigation page before retrying a safe navigation GET. No customer POST or provider request replay.'}))
