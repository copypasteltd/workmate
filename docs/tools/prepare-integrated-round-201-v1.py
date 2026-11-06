from pathlib import Path
import hashlib,json,subprocess
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]
repos={k:ROOT/'dev'/('copypaste-'+v) for k,v in [('backend','platform'),('web','web'),('admin','admin'),('desktop','desktop'),('extension','extension'),('delivery','delivery')]};repos['docs']=ROOT
out=repos['delivery']/'.data/acceptance-201/baseline';out.mkdir(parents=True,exist_ok=False)
def git(p,*args):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*args],cwd=p,text=True,encoding='utf-8',timeout=120).strip()
protected=json.loads((repos['delivery']/'.data/acceptance-193/baseline/receipt.json').read_text('utf-8'))['preserved_untracked']
for p,d in protected.items():assert hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==d,p
report={'stage':201,'previous_turn':'progress: round200 code, deployed clients, actual acceptance and eight remote refs were updated','at':datetime.now(timezone.utc).isoformat(),'heads':{k:git(p,'rev-parse','HEAD') for k,p in repos.items()},'branches':{k:git(p,'branch','--show-current') for k,p in repos.items()},'preserved_untracked':protected}
for k,p in repos.items():assert not git(p,'diff','--cached','--name-only'),k
(out/'receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps({'status':'baseline_recorded','heads':report['heads'],'protected_files':len(protected)}))
