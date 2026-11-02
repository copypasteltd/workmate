from pathlib import Path
scripts=Path(__file__).resolve().parent
text=(scripts/'prepare-desktop-qa-plan-189-v1.sh').read_text(encoding='utf8')
assert text.count("assert.equal(preview.decision,'super_admin_direct')")==1
text=text.replace("assert.equal(preview.decision,'super_admin_direct')","assert.equal(preview.approval,false)")
with (scripts/'prepare-desktop-qa-plan-189-v2.sh').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
text=(scripts/'qualify-real-desktop-189-v3.mjs').read_text(encoding='utf8')
with (scripts/'qualify-real-desktop-189-v4.mjs').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
