from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];p=root/'docs/tools/publish-integrated-round-198-v1.py';q=root/'docs/tools/publish-integrated-round-198-v2.py';assert not q.exists()
s=p.read_text(encoding='utf8');assert s.count('web-review-journey.json')==1
q.write_text(s.replace('web-review-journey.json','web-directory-journey.json'),encoding='utf8',newline='\n')
p=root/'docs/quality/integrated-round-198/publication-preflight-failure.json';p.write_text(json.dumps({'stage':198,'script':'docs/tools/publish-integrated-round-198-v1.py','state':'stopped_before_staging','cause':'The publisher referenced a prior-round Web report name instead of the current web-directory-journey.json.','resolution':'v2 references the actual passed current receipt. No evidence file was fabricated or aliased, and the original publisher remains.'},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('corrected publisher evidence path; no Git changes performed by this preparer')
