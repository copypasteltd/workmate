from pathlib import Path
import re
root=Path(__file__).resolve().parents[2]
text=(root/'docs/tools/publish-integrated-round-196-v1.py').read_text(encoding='utf8')
text=text.replace('196','197').replace('integrated-197-v4','integrated-197-v1')
expected={'backend':'ca80567780f0be761b44b89895100ea741391705','web':'b5575d4ddf3e81fedf76e59e2067b4d695284792','admin':'0a81f8b1920a42d2f7ad60bb3b71928cd0087575','desktop':'7b067a69361340bbed02df5dc2f7b4757ca5e872','extension':'f9e7d8af0a90abbc2ce66203e24b8cee95de432c','delivery':'caa0866add80a9150778296a959357b8034cbb54','docs':'d1947a2feb51c48a2fb3bf77da53e3361547183f'}
text=re.sub(r'EXPECTED=\{[^\n]+\}',lambda _: 'EXPECTED='+repr(expected),text)
text=text.replace("assert load(ROOT/'docs/quality/integrated-round-197/workspace-journey.json')['status']=='passed_scoped_steps'", "assert load(ROOT/'docs/quality/integrated-round-197/web-review-journey.json')['status']=='passed'")
text=text.replace("assert load(ROOT/'docs/quality/integrated-round-197/owned-native-accounting.json')['status']=='read_back'\n",'')
start=text.index('tracked={');end=text.index('\ndef changed(',start)
review='''tracked={
 'backend':{'src/desktop-executions.ts'},
 'web':{'contracts/product-downloads.json','src/main.tsx','src/client-failure.ts'},
 'admin':{'src/client-failure.ts'},
 'desktop':{'src/client-failure.ts','src/local-agent.ts','src/main.ts','renderer/src/client-failure.ts','renderer/src/native-execution-state.ts','renderer/src/native-execution.tsx','renderer/src/task-workbench.css','tests/local-agent.test.ts'},
 'extension':{'src/client-failure.ts'},'delivery':set(),'docs':{'docs/README.md','docs/README.en.md'},
}
new={'backend':{'src/desktop-unstarted-settlement.ts','tests/desktop-unstarted-settlement-197-v1.test.ts'},'desktop':{'src/company-transport.ts','tests/company-network-197-v1.test.ts'},'web':set(),'admin':set(),'extension':set(),'delivery':set(),'docs':set()}
def allowed_new(name,p):
 if p in new[name]:return True
 if name=='docs':return p in ['docs/requirements/197-connection-and-native-review-round.md','docs/development/197-connection-and-native-review.md','docs/changes/197-connection-and-native-review.md'] or p.startswith('docs/quality/integrated-round-197/') or bool(re.fullmatch(r'docs/tools/[a-z0-9-]+197(?:-v\\d+)?\\.py',p))
 if name in ['delivery','desktop'] and re.fullmatch(r'scripts/[a-z0-9-]+197(?:-v\\d+)?\\.(?:mjs|py|sh|ps1)',p):return True
 return bool(re.fullmatch(r'assets/screenshots/(?:197-[a-z0-9-]+\\.png|workmate-197-v\\d+-[a-z-]+\\.(?:gif|mp4))',p))
'''
text=text[:start]+review+text[end:]
text=text.replace('feat: deliver task review, immutable text revisions and native context (197)','feat: stabilize company connections and native result review (197)')
(root/'docs/tools/publish-integrated-round-197-v1.py').write_text(text,encoding='utf8')
print('Prepared bounded publication allowlist; no commit or push performed.')
