"""Prepare a strict ordinary publication script; this step performs no Git mutation."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[2];p=root/'docs/tools/publish-integrated-round-201-v1.py';s=p.read_text('utf8').replace('201','202')
a=s.index('EXPECTED=');b=s.index('\n\n',a)
expected={'backend':'b52d1031a30600379c588e707d669e1be5854f5e','web':'b10da8864e302f383d4fad855238b4ac84a94b45','admin':'565f031c28eda69dd269af7ad1a1bdd769ed5348','desktop':'17a75452376b4f4e05c620e306f668fbab7d1982','extension':'abdcf89a1ff11a8bf1df27bc3a05510fa149798a','delivery':'b1c4539ee58a39a8cb796eb49ed986afaea6b1b3','docs':'3eb577b144aede02e08c85b87e430e8e93db29a3'}
s=s[:a]+'EXPECTED='+repr(expected)+s[b:]
s=s.replace("endswith('integrated-202-v1/backend')","endswith('integrated-202-v2/backend')")
s=s.replace("assert load(ROOT/'docs/quality/integrated-round-202/documentation-check.json')", "assert load(ROOT/'docs/quality/integrated-round-202/network-preserved.json')['network_configuration_unchanged']\nassert load(ROOT/'docs/quality/integrated-round-202/documentation-check.json')",1)
a=s.index('tracked={');b=s.index('\n\ndef allowed_new',a)
s=s[:a]+'''tracked={
 'backend':{'src/analysis-reports.ts','src/analytics.ts','src/server.ts'},
 'web':{'contracts/product-downloads.json','src/api.ts','src/main.tsx','src/marketing-reports.tsx'},
 'admin':set(),'desktop':{'renderer/src/api.ts','renderer/src/main.tsx','renderer/src/marketing-reports.tsx','src/main.ts','src/download.ts','src/native-session.ts','src/preload.cts'},
 'extension':set(),'delivery':set(),'docs':{'docs/README.md','docs/README.en.md'},
}
shared={'analysis-history.tsx','analysis-request-state.ts','analysis-review-model.ts','analysis-review.css','analysis-review.tsx','review-download.ts'}
new={
 'backend':{'contracts/analysis-review-route-additions-202.json','src/analysis-review.ts','tests/analysis-review-202-v1.test.ts','tests/analysis-review-202-v2.test.ts','tests/analysis-review-202-v3.test.ts','tests/brand-production-189-v5.test.ts','tests/dedicated-cloud-189-v5.test.ts','tests/route-inventory-202-v1.ts','tests/workspace-completion-196-v5.test.ts','tests/seo-change-tasks-202-v1.test.ts','tests/current-test-discovery-189-v3.test.ts','scripts/run-current-tests-owned-v15.mjs'},
 'web':{'src/'+p for p in shared}|{'tests/analysis-review-202.test.ts'},
 'desktop':{'renderer/src/'+p for p in shared}|{'src/analysis-download.ts','tests/analysis-review-202.test.ts','tests/analysis-download-202.test.ts'},
 'admin':set(),'extension':set(),'delivery':set(),'docs':set(),
}
'''+s[b:]
s=s.replace('202-motion-production','202-marketing-review')
s=s.replace('feat: deliver motion production, source-bound recovery and real MP4 (202)','feat: deliver marketing evidence review and verified native exports (202)')
compile(s,str(p),'exec');target=root/'docs/tools/publish-integrated-round-202-v1.py';target.write_text(s,encoding='utf8',newline='\n')
print('Strict eight-ref publication prepared; no staging, commit or push performed.')
