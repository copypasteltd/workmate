from pathlib import Path
scripts=Path(__file__).resolve().parent
text=(scripts/'prepare-desktop-qa-plan-189-v2.sh').read_text(encoding='utf8')
assert text.count("assert.equal(preview.approval,false)")==1
text=text.replace("assert.equal(preview.approval,false)","assert.equal(preview.decision,'recent_mfa')")
with (scripts/'prepare-desktop-qa-plan-189-v3.sh').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
