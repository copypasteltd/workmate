"""Complete the collected HTML-download correction before its unified replay."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json
root=Path(__file__).resolve().parents[2];dev=root/'dev';backend=dev/'copypaste-platform';delivery=dev/'copypaste-delivery'
p=backend/'src/server.ts';s=p.read_text('utf8');needle='  app.setErrorHandler(async (error, req, reply) => {'
insert='''  // Downloaded HTML is immutable evidence. Intermediaries must not inject
  // analytics/scripts or rewrite it after its length/hash have been computed.
  // Preserve existing private/no-store policy and every payload byte.
  app.addHook("onSend", async (_req, reply, payload) => {
    const mime = String(reply.getHeader("Content-Type") ?? ""),
      disposition = String(reply.getHeader("Content-Disposition") ?? "");
    if (/^text\\/html(?:;|$)/i.test(mime) &&
        (/^attachment(?:;|$)/i.test(disposition) || reply.hasHeader("X-Content-SHA256"))) {
      const policy = String(reply.getHeader("Cache-Control") ?? "no-store");
      if (!policy.split(",").some(value => value.trim().toLowerCase() === "no-transform"))
        reply.header("Cache-Control", policy + ", no-transform");
    }
    return payload;
  });
'''
assert needle in s and 'Downloaded HTML is immutable evidence' not in s;p.write_text(s.replace(needle,insert+needle),encoding='utf8',newline='\n')
s=(backend/'tests/analysis-review-202-v2.test.ts').read_text('utf8').replace('assert.equal(r.raw.headers["cache-control"], "no-store");','assert.equal(r.raw.headers["cache-control"], format === "html" ? "no-store, no-transform" : "no-store");')
(backend/'tests/analysis-review-202-v3.test.ts').write_text(s,encoding='utf8',newline='\n')
s=(backend/'tests/seo-change-tasks.test.ts').read_text('utf8').replace('assert.equal(downloaded.raw.headers["cache-control"], "private, no-store");','assert.equal(downloaded.raw.headers["cache-control"], format === "html" ? "private, no-store, no-transform" : "private, no-store");')
(backend/'tests/seo-change-tasks-202-v1.test.ts').write_text(s,encoding='utf8',newline='\n')
s=(backend/'scripts/run-current-tests-owned-v14.mjs').read_text('utf8').replace("  'desktop-browser-policy.test.ts',", "  'seo-change-tasks.test.ts', 'desktop-browser-policy.test.ts',")
(backend/'scripts/run-current-tests-owned-v15.mjs').write_text(s,encoding='utf8',newline='\n')
s=(backend/'tests/current-test-discovery-189-v2.test.ts').read_text('utf8').replace('run-current-tests-owned-v14.mjs','run-current-tests-owned-v15.mjs').replace('current-test-discovery-189-v2.test.ts','current-test-discovery-189-v3.test.ts')
(backend/'tests/current-test-discovery-189-v3.test.ts').write_text(s,encoding='utf8',newline='\n')
p=backend/'package.json';data=json.loads(p.read_text('utf8'));assert data['scripts']['test'].endswith('v14.mjs');data['scripts']['test']=data['scripts']['test'].replace('v14.mjs','v15.mjs');p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
rows=[]
for repo in ['copypaste-platform','copypaste-web','copypaste-admin','copypaste-desktop','copypaste-extension','copypaste-delivery']:
 for folder in ['src']+(['renderer/src'] if repo=='copypaste-desktop' else []):
  for p in sorted((dev/repo/folder).rglob('*')):
   if p.is_file() and p.suffix in ['.ts','.tsx','.js','.mjs','.css']:
    b=p.read_bytes();rows.append({'path':p.relative_to(root).as_posix(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
previous=json.loads((root/'docs/quality/integrated-round-202/correction-batch-v2.json').read_text('utf8'));before={r['path']:r['sha256'] for r in previous['production_source_files']};changed=[r['path'] for r in rows if r['sha256']!=before.get(r['path'])];assert changed==['dev/copypaste-platform/src/server.ts']
report={'stage':202,'at':datetime.now(timezone.utc).isoformat(),'status':'collected_correction_batch_complete_before_replay','changed_product_sources':changed,'production_source_files':rows,'cause':'Actual native HTML response had367 additional bytes: Cloudflare Web Analytics beacon inserted before closing body. CSV/JSON response bytes matched their original hashes. Integrity rejection is correct.','fix':'Application onSend adds no-transform only to downloaded/hash-bound HTML, preserving existing private/no-store directives and all bytes. No checksum bypass, network/proxy/Cloudflare configuration change or client package change. Existing SEO HTML download has the same protection; retained legacy assertions updated through separate current attempts.','primary_reference':'https://developers.cloudflare.com/web-analytics/faq/','retained_native_failure':'.data/acceptance-202/live-review-0c5ec5d4-13d8-4f3d-aacf-cc32ce13728c/receipt.json','scope':'All collected autonomous product/test/entrypoint corrections complete before backend build and relevant replay. Unchanged clients remain source-bound to their successful full suites and packages.'}
(root/'docs/quality/integrated-round-202/correction-batch-v3.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
print(json.dumps({'status':report['status'],'changed_product_sources':changed}))
