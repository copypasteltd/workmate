"""Install only the signed Ubuntu media package; preserve unrelated ZeroTier setup."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=(root/'scripts/complete-motion-runtime-201-v1.sh').read_text('utf8').replace('media-runtime-v1','media-runtime-v2')
source=source.replace("for args in [['apt-get','update'],['apt-get','install','--yes','--no-upgrade','--no-install-recommends','ffmpeg']]:", "candidate=subprocess.check_output(['apt-cache','policy','ffmpeg'],text=True).split('Candidate:',1)[1].splitlines()[0].strip();assert candidate=='7:4.4.2-0ubuntu0.22.04.1'\n for args in [['apt-get','-o','Acquire::ForceIPv4=true','install','--yes','--no-upgrade','--no-install-recommends','ffmpeg='+candidate]]:")
p=root/'scripts/complete-motion-runtime-201-v2.sh';assert not p.exists();p.write_text(source,encoding='utf8',newline='\n')
print('Native dependency correction batch ready; original service/repository configuration preserved.')
