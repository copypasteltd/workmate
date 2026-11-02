"""Keep the frozen bootstrap gateway fingerprint; remove only its duplicate key."""
from pathlib import Path
root=Path(__file__).resolve().parents[3]/'dev/copypaste-platform'
text=(root/'tests/capability-bindings-189-v1.test.ts').read_text(encoding='utf8')
text=text.replace('without duplicate global credentials','without a duplicate global API key')
text=text.replace('s.db.config.AI_BASE_URL=undefined;s.db.config.AI_API_KEY=undefined;','s.db.config.AI_API_KEY=undefined;')
text=text.replace('assert.equal((await task(queued.id)).status,"succeeded");','assert.equal((await task(queued.id)).status,"succeeded",JSON.stringify(await task(queued.id)));')
with (root/'tests/capability-bindings-189-v2.test.ts').open('x',encoding='utf8',newline='\n') as f:f.write(text)
