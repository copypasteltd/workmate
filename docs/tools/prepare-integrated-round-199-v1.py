from pathlib import Path
import hashlib,json,subprocess
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]
repos={'backend':ROOT/'dev/copypaste-platform','web':ROOT/'dev/copypaste-web','admin':ROOT/'dev/copypaste-admin','desktop':ROOT/'dev/copypaste-desktop','extension':ROOT/'dev/copypaste-extension','delivery':ROOT/'dev/copypaste-delivery','docs':ROOT}
out=repos['delivery']/'.data/acceptance-199/baseline'
out.mkdir(parents=True,exist_ok=False)
def git(cwd,*args):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*args],cwd=cwd,text=True,encoding='utf8',timeout=120).strip()
protected=json.loads((repos['delivery']/'.data/acceptance-193/baseline/receipt.json').read_text('utf-8'))['preserved_untracked']
for p,d in protected.items():assert hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==d,p
receipt={'stage':199,'at':datetime.now(timezone.utc).isoformat(),'heads':{k:git(v,'rev-parse','HEAD') for k,v in repos.items()},'preserved_untracked':protected,'branches':{k:git(v,'branch','--show-current') for k,v in repos.items()}}
for k,v in repos.items():assert not git(v,'diff','--cached','--name-only'),k
(out/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps({'baseline':str(out/'receipt.json'),'protected_files':len(protected),'heads':receipt['heads']},ensure_ascii=False))
