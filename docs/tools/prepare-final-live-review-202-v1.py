"""Separate final acceptance, with original IPC behavior and no response replacement."""
from pathlib import Path
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts';s=(scripts/'qualify-live-marketing-review-202-v4.mjs').read_text('utf8')
s=s.replace('202-v4-marketing-review-live.png','202-v7-marketing-review-live.png').replace("'marketing-review-live','202-v4'","'marketing-review-live','202-v7'")
needle="await pass('Final native app preserves"
s=s.replace(needle,"assert.equal(report.downloads.filter(d=>d.component==='desktop').length,3);assert.deepEqual(await app.evaluate(()=>globalThis.__qaDownloadErrors),[]);await pass('Final native app preserves")
(scripts/'qualify-live-marketing-review-202-v7.mjs').write_text(s,encoding='utf8',newline='\n')
print('Final real Web/native three-format acceptance prepared; original integrity guards remain.')
