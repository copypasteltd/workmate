from pathlib import Path
scripts=Path(__file__).resolve().parent
text=(scripts/'qualify-provider-termination-ui-189-v1.mjs').read_text(encoding='utf8')
needle="page.locator('tr').filter({hasText:'gpt-image-2'}).first()"
assert text.count(needle)==1
text=text.replace(needle,"page.locator('tr').filter({hasText:'03f7f43a-feee-4290-b64a-4452e02a643a'})")
with (scripts/'qualify-provider-termination-ui-189-v2.mjs').open('x',encoding='utf8',newline='\n') as output:output.write(text)
