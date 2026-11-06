"""Prepare the reviewed ordinary publisher without executing any Git mutation."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'docs/tools/publish-integrated-round-197-v2.py';target=ROOT/'docs/tools/publish-integrated-round-198-v1.py';assert not target.exists()
s=source.read_text(encoding='utf8').replace('publication-197','publication-198').replace('stage\':197','stage\':198').replace('integrated-round-197','integrated-round-198').replace('.data/integrated-197-v2/verification.json','.data/integrated-198-v3/verification.json')
start=s.index('EXPECTED=');end=s.index('\ndef git(',start)
s=s[:start]+"EXPECTED={'backend':'e7a6d5bd93dfe920dd41235e6eec5436dd815195','web':'6fba5929e9ed5d9d4598726b3b37306ca8033e04','admin':'3675c0f5b0ad0b367ad0bf2f4ae8faf2644cef87','desktop':'337d654e496ce60fcbdb286e550aa29e950851ee','extension':'7d4cf657ab3afc78f2fa692bb08edd5e965fab81','delivery':'d85f89c165959df7b8ee8051ad48ac4198849d9a','docs':'d6cd8774b076fa39b0e94c965ffab149cf32670a'}\n"+s[end:]
s=s.replace("'web-review-journey.json'","'web-directory-journey.json'").replace("endswith('integrated-197-v2/backend')","endswith('integrated-198-v2/backend')")
anchor="assert load(ROOT/'docs/quality/integrated-round-198/documentation-check.json')['status']=='passed'"
assert anchor in s;s=s.replace(anchor,anchor+"\nassert load(DELIVERY/'.data/integrated-198-v4/verification.json')['state']=='passed'\nassert load(ROOT/'docs/quality/integrated-round-198/desktop-delta-journey.json')['desktop_version']=='0.7.10'")
start=s.index('tracked={');end=s.index('\ndef allowed_new',start)
s=s[:start]+'''tracked={
 'backend':{'src/server.ts','tests/route-inventory-189-v2.ts'},
 'web':{'contracts/product-downloads.json','src/api.ts','src/context.tsx','src/main.tsx','src/notifications.tsx','src/persistent-work.tsx','src/task-workbench.tsx'},
 'admin':set(),
 'desktop':{'src/main.ts','src/preload.cts','renderer/src/api.ts','renderer/src/context.tsx','renderer/src/local-agent.tsx','renderer/src/main.tsx','renderer/src/notifications.tsx','renderer/src/persistent-work.tsx','renderer/src/task-workbench.tsx'},
 'extension':{'public/sidepanel.html','src/chat-panel.ts','src/conversation.ts'},
 'delivery':set(),'docs':{'docs/README.md','docs/README.en.md','docs/development/198-task-directory-and-context.md'},
}
shared={'work-navigation-state.ts','work-navigation.tsx','task-directory.tsx','task-directory.css'}
new={
 'backend':{'src/task-directory.ts','contracts/task-directory-v1.schema.json','contracts/task-directory-route-additions-198.json','tests/task-directory-198-v1.test.ts','tests/task-directory-198-v2.test.ts','tests/history/route-inventory-189-v2.pre198.ts.snapshot'},
 'web':{'src/'+p for p in shared}|{'tests/work-navigation-198.test.ts'},
 'desktop':{'renderer/src/'+p for p in shared}|{'src/cloud-work-destination.ts','tests/work-navigation-198.test.ts','tests/cloud-work-destination-198.test.ts'},
 'extension':{'src/history-view.ts','tests/history-restore-198.test.ts'},'admin':set(),'delivery':set(),'docs':set(),
}
'''+s[end:]
s=s.replace('197-connection-and-native-review','198-task-directory-and-context').replace('197(?:','198(?:').replace('197-[a-z','198-[a-z').replace('workmate-197-v','workmate-198-v')
s=s.replace('feat: stabilize company connections and native result review (197)','feat: complete task discovery and scoped work continuity (198)')
assert '197' not in s,'Unexpected historical publisher path remains'
target.write_text(s,encoding='utf8',newline='\n')
print('prepared explicit seven-repository/eight-ref ordinary publisher')
