from pathlib import Path
import json
delivery=Path(__file__).resolve().parents[1]
setup=json.loads((delivery/'.data/deployment-179/real-mode-prepared-188.sanitized.json').read_text(encoding='utf8'))
text=(delivery/'scripts/prepare-desktop-qa-plan-189-v3.sh').read_text(encoding='utf8')
text=text.replace('real-services-189-v1','real-services-189-v4').replace('live-189-v1','live-189-v4')
text=text.replace('desktop-qa-plan','image-web-qa-plan').replace('f5b06ebd-ec59-414c-ad1a-04224d202fc0',setup['qa_workspace']['id']).replace('d81349e4-77fc-4321-a9ba-24dca9714376',setup['qa_user_id'])
text=text.replace('Owned Desktop 189 real acceptance','Owned Web image 189 real acceptance')
with (delivery/'scripts/prepare-image-qa-capacity-189-v1.sh').open('x',encoding='utf8',newline='\n') as output:output.write(text)
