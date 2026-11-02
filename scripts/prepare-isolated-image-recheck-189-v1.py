from pathlib import Path
scripts=Path(__file__).resolve().parent
text=(scripts/'qualify-real-image-web-189-v1.mjs').read_text(encoding='utf8')
text=text.replace(".data/deployment-179/real-mode-prepared-188.sanitized.json", ".data/acceptance-189/image-web-isolated-setup-189-v1.private.json")
text=text.replace("authenticate(browser,'realqa','qa-live-188@workmate.local')", "authenticate(browser,'imageqa',setup.email)")
with (scripts/'qualify-real-image-web-189-v2.mjs').open('x',encoding='utf8',newline='\n') as output:output.write(text)
