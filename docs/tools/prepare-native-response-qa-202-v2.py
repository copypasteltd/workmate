"""Keep VM diagnostics free of unsupported dynamic imports; hash outside it."""
from pathlib import Path
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts';s=(scripts/'qualify-live-marketing-review-202-v5.mjs').read_text('utf8')
s=s.replace('202-v5-marketing-review-live.png','202-v6-marketing-review-live.png').replace("'marketing-review-live','202-v5'","'marketing-review-live','202-v6'")
s=s.replace("const crypto=await import('node:crypto');",'').replace("actual_sha256:crypto.createHash('sha256').update(body).digest('hex'),",'')
s=s.replace("const bytes=Buffer.from(base64,'base64');await writeFile", "const bytes=Buffer.from(base64,'base64');row.actual_sha256=hash(bytes);await writeFile")
s=s.replace("await pass('Final native app preserves", "if(!(report.native_export_failures?.length))await pass('Final native app preserves")
(scripts/'qualify-live-marketing-review-202-v6.mjs').write_text(s,encoding='utf8',newline='\n')
print('Native response diagnostics corrected; no product source or response bytes changed.')
