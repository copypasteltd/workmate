"""Preserve a terminated UI qualification without treating it as a passed check."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, subprocess

ROOT=Path(__file__).resolve().parents[2]
L=ROOT/'dev/copypaste-delivery'; prefix=L/'evidence/native-recovery-ui-03'
assert not prefix.with_suffix('.json').exists()
command="@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'postgres.exe' -or ($_.Name -eq 'node.exe' -and ($_.CommandLine -like '*run-native-recovery-ui-v3*' -or $_.CommandLine -like '*qa-native-recovery-ui-v3*' -or $_.CommandLine -like '*native-db-launch*')) } | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress"
raw=subprocess.check_output(['powershell','-NoProfile','-NonInteractive','-Command',command],creationflags=subprocess.CREATE_NO_WINDOW)
processes=json.loads(raw) if raw.strip() else []
assert not processes, 'Revalidate live processes before classifying interruption'
source_dir=Path(str(prefix)+'-sources'); sources={}
for p in sorted(source_dir.rglob('*')):
 if p.is_file():
  relative=p.relative_to(source_dir).as_posix(); expected=sha256(p.read_bytes()).hexdigest()
  assert sha256((ROOT/'dev'/relative).read_bytes()).hexdigest()==expected, relative
  sources[relative]=expected
logs=[]
for p in sorted((L/'evidence').glob('native-recovery-ui-03-*.log')):
 logs.append({'path':p.relative_to(L).as_posix(),'sha256':sha256(p.read_bytes()).hexdigest()})
value={'at':datetime.now(timezone.utc).isoformat(),'status':'interrupted','error':'The execution handle disappeared; current Windows process inspection confirms the verifier, owned database launcher and PostgreSQL are no longer running. No journey result or graceful-shutdown receipt was produced.',
 'source_unchanged':True,'source_files':sources,'checks':[],'retained_partial_logs':logs,'current_matching_processes':processes,
 'owned_database_shutdown':False,'graceful_cleanup_proven':False,'qualification_passed':False,
 'verifier_sha256':sha256(Path(str(prefix)+'-verifier.mjs').read_bytes()).hexdigest(),
 'interruption_recorder_sha256':sha256(Path(__file__).read_bytes()).hexdigest()}
prefix.with_suffix('.json').write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'status':'interrupted','source_files':len(sources),'matching_processes':len(processes)}))
