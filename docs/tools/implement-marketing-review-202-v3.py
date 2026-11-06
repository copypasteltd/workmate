from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];D=R/'dev';web=D/'copypaste-web/src';native=D/'copypaste-desktop/renderer/src';p=web/'marketing-reports.tsx'
def replace(p,old,new):
 s=p.read_text('utf8');assert old in s,(str(p),old[:120]);p.write_text(s.replace(old,new,1),encoding='utf8',newline='\n')
source=(R/'docs/tools/implement-marketing-review-202-v1.py').read_text('utf8')
remainder=source[source.index("replace(p,'  const { t } = useI18n();"):]
remainder=remainder.replace('  const { t } = useI18n();\\n  const available = datasets.filter((d) => d.spec_hash);', '  const { t } = useI18n(),\\n    available = datasets.filter((d) => d.spec_hash),\\n    initial = dates(available.slice(0, 1));',1)
remainder=remainder.replace('includes(d.id)));\'\'\')','includes(d.id)));\n  const initial = dates(available.slice(0, 1));\'\'\')',1)
exec(remainder)
