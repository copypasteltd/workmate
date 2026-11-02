"""Preserve the native protocol fixture and add image failure/recovery scenarios."""
from pathlib import Path
root=Path(__file__).resolve().parents[3]/'dev/copypaste-platform'
text=(root/'tests/runtime-pre-turn-fixture.ts').read_text(encoding='utf8')
text=text.replace('fixture_lookup','image2_generate')
text=text.replace('tool?: boolean; hold?: boolean','tool?: boolean; hold?: boolean; toolCount?: number')
text=text.replace('options.tool && calls.length === 1','options.tool && calls.length <= (options.toolCount ?? 1)')
text=text.replace('call_id: "call_startup_real"','call_id: "call_startup_real_" + calls.length')
with (root/'tests/runtime-image-fixture-189-v1.ts').open('x',encoding='utf8',newline='\n') as f:f.write(text)
runner=(root/'scripts/run-current-tests-owned-v13.mjs').read_text(encoding='utf8')
runner=runner.replace("'brand-production.test.ts', 'dedicated-cloud.test.ts',","'brand-production.test.ts', 'dedicated-cloud.test.ts', 'capability-bindings.test.ts',")
with (root/'scripts/run-current-tests-owned-v14.mjs').open('x',encoding='utf8',newline='\n') as f:f.write(runner)
package=root/'package.json'
raw=package.read_bytes();assert raw.count(b'run-current-tests-owned-v13.mjs')==1
package.write_bytes(raw.replace(b'run-current-tests-owned-v13.mjs',b'run-current-tests-owned-v14.mjs'))
