from pathlib import Path
import json

scripts=Path(__file__).resolve().parent
text=(scripts/'qualify-real-desktop-189-v2.mjs').read_text(encoding='utf8')
assert text.count('.data/deployment-177/release/win-unpacked')==1
text=text.replace('.data/deployment-177/release/win-unpacked','.data/deployment-189/release/win-unpacked')
before="assert.equal(identity.status,200);"
after="assert.equal(identity.status,200,JSON.stringify({status:identity.status,code:identity.body?.error?.code}));"
assert text.count(before)==1
text=text.replace(before,after)
before="const manifest=JSON.parse(await readFile(path.join(packed,'resources/local-codex/runtime-manifest.json'),'utf8'));"
after=before+"\n report.desktop_version='0.7.3';report.app_asar_sha256=createHash('sha256').update(await readFile(path.join(packed,'resources/app.asar'))).digest('hex');"
assert text.count(before)==1
text=text.replace(before,after)
with (scripts/'qualify-real-desktop-189-v3.mjs').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
print(json.dumps({'created':'qualify-real-desktop-189-v3.mjs','package':'Desktop0.7.3; native Codex0.163.0-alpha.11; source189 read retry'}))
