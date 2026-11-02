from pathlib import Path
import json

root = Path(__file__).resolve().parent
text = (root / 'live-client-188-v6.mjs').read_text(encoding='utf8')
assert text.count(".data/acceptance-188") == 1 and text.count('127.0.0.1:5355') == 1
text = text.replace('.data/acceptance-188', '.data/acceptance-189').replace('127.0.0.1:5355', '127.0.0.1:11236')
with (root / 'live-client-189-v1.mjs').open('x', encoding='utf8', newline='\n') as stream:
    stream.write(text)
text = (root / 'qualify-real-desktop-188-v19.mjs').read_text(encoding='utf8')
text = text.replace('./live-client-188-v5.mjs', './live-client-189-v1.mjs').replace('WM188-DESKTOP-', 'WM189-DESKTOP-').replace('stage:188', 'stage:189')
text = text.replace("backend_checkpoint:'real-services-188-v7 + proxy-temporary-188-v1'", "backend_checkpoint:'real-services-189-v1; original per-model text credentials and tariff retained'")
with (root / 'qualify-real-desktop-189-v1.mjs').open('x', encoding='utf8', newline='\n') as stream:
    stream.write(text)
print(json.dumps({'created':['live-client-189-v1.mjs','qualify-real-desktop-189-v1.mjs']}))
