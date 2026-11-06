from pathlib import Path
delivery=Path(__file__).resolve().parents[1];scripts=delivery/'scripts'
p=scripts/'qualify-motion-production-201-v4.mjs';assert not p.exists();s=(scripts/'qualify-motion-production-201-v3.mjs').read_text('utf8').replace("'201-v3'","'201-v4'").replace('201-v3-motion-production.png','201-v4-motion-production.png')
# Screenshot capture owns a temporary viewport while recording. Finish capture
# before testing responsive viewports; simultaneous resizing invalidated v2/v3.
s=s.replace('report.overflow=await verifyMotionOverflow(page,editor);await steadyMotionFrame(editor);','report.recording=await recording.stop();recording=null;report.overflow=await verifyMotionOverflow(page,editor);await steadyMotionFrame(editor);')
s=s.replace("report.recording=await recording.stop();recording=null;\n await editor", "\n await editor")
p.write_text(s,encoding='utf8',newline='\n')
for p in [delivery.parent/'copypaste-desktop/scripts/package-integrated-201-v1.mjs',scripts/'finalize-release-metadata-201-v1.mjs']:
 p.write_text(p.read_text('utf8').replace('integrated-201-v2','integrated-201-v3'),encoding='utf8',newline='\n')
print('Versioned viewport checks run only after recording releases its viewport; release gates use the final corrected-fixture qualification.')
