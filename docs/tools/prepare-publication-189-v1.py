"""Prepare the stage189 publisher from the reviewed atomic ordinary-push workflow."""
from pathlib import Path
tools=Path(__file__).resolve().parent
value=(tools/'publish-live-acceptance-188-v1.py').read_text(encoding='utf8').replace('188','189')
value=value.replace('Qualify real services, repair native Codex contracts and document open gaps (stage189)','Deploy real image delivery, preserve originals and qualify current fixes (stage189)')
needle="reviewed={}"
assert value.count(needle)==1
value=value.replace(needle,"server_private=json.loads((D/'.data/deployment-189/server-access.private.json').read_bytes());sensitive.append(server_private['password'].encode())\n reviewed={}")
with (tools/'publish-live-acceptance-189-v1.py').open('x',encoding='utf8',newline='\n') as f:f.write(value)
