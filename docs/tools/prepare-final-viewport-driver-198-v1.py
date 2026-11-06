from pathlib import Path
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts'
source=scripts/'qualify-work-directory-198-v3.mjs';target=scripts/'qualify-work-directory-198-v4.mjs';assert not target.exists()
s=source.read_text(encoding='utf8').replace('198-v3','198-v4')
needle=' for(const width of [375,768,1024,1440])'
assert s.count(needle)==1
s=s.replace(needle,' // Finish concurrent screenshots before changing viewport. Playwright restores\n // capture viewport state, which must not race responsive measurements.\n report.recording=await recording.stop();recording=null;\n'+needle)
target.write_text(s,encoding='utf8',newline='\n')
print('prepared v4 viewport driver; v3 timeout remains retained')
