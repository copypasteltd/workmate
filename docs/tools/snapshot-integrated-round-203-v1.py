"""Record exact starting commits and protected user files before the code batch."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess
root=Path(__file__).resolve().parents[2];delivery=root/'dev/copypaste-delivery';out=delivery/'.data/acceptance-203/baseline';out.mkdir(parents=True,exist_ok=False)
repos={k:root/'dev'/('copypaste-'+v) for k,v in [('backend','platform'),('web','web'),('admin','admin'),('desktop','desktop'),('extension','extension'),('delivery','delivery')]};repos['docs']=root
def git(p,*a):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*a],cwd=p,text=True,encoding='utf8',timeout=120).strip()
protected=json.loads((delivery/'.data/acceptance-193/baseline/receipt.json').read_text('utf8'))['preserved_untracked']
for p,d in protected.items():assert hashlib.sha256((root/p).read_bytes()).hexdigest()==d,p
report={'stage':203,'previous_turn':'progress: round202 deployed the complete marketing-review batch, verified actual final native exports and server-network preservation, and published/read back eight refs. All original102 requirements/32 groups remain.','at':datetime.now(timezone.utc).isoformat(),'heads':{k:git(p,'rev-parse','HEAD') for k,p in repos.items()},'branches':{k:git(p,'branch','--show-current') for k,p in repos.items()},'preserved_untracked':protected}
for k,p in repos.items():assert not git(p,'diff','--cached','--name-only'),k
(out/'receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps({'status':'baseline_recorded','heads':report['heads'],'protected_files':len(protected)}))
