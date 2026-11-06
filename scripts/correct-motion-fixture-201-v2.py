from pathlib import Path
delivery=Path(__file__).resolve().parents[1];tests=delivery.parent/'copypaste-platform/tests'
source=tests/'motion-production-201-v1.test.ts';target=tests/'motion-production-201-v2.test.ts';assert not target.exists();s=source.read_text('utf8')
a=s.index('  await s.db.control.query("UPDATE asset_versions SET sha256=');b=s.index('  const after = await counts',a)
s=s[:a]+'''  // Keep immutable database permissions. Inject corrupted storage bytes at
  // the existing adapter boundary without changing the authorization path.
  const originalGet=s.storage.get.bind(s.storage);
  s.storage.get=async()=>Buffer.from('Corrupted stored PNG bytes');
  try {
    const invalid=await call(f.user,'POST',f.root+'/draft-preview',{definition:d,frame:153});
    assert.equal(invalid.status,422);assert.equal(invalid.data.error.code,'VIDEO_SOURCE_INTEGRITY');
  } finally {s.storage.get=originalGet;}
'''+s[b:]
target.write_text(s,encoding='utf8',newline='\n');print('Version2 fixture preserves immutable database permissions and checks corrupted storage bytes.')
