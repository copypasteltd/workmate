"""Read current independent heads and preserve exact user-owned files before edits."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery'
out=L/'.data/acceptance-204/baseline/receipt.json';out.parent.mkdir(parents=True,exist_ok=True);assert not out.exists()
old=json.loads((L/'.data/acceptance-203/baseline/receipt.json').read_text('utf-8'))
protected=old['preserved_untracked']
for p,h in protected.items():assert hashlib.sha256((R/p).read_bytes()).hexdigest()==h,p
repos={'backend':D/'copypaste-platform','web':D/'copypaste-web','admin':D/'copypaste-admin','desktop':D/'copypaste-desktop','extension':D/'copypaste-extension','delivery':L,'docs':R}
heads={};todos={}
for name,p in repos.items():
 heads[name]=subprocess.check_output(['git','-c','core.fsmonitor=false','rev-parse','HEAD'],cwd=p,text=True).strip()
 assert not subprocess.check_output(['git','-c','core.fsmonitor=false','diff','--cached','--name-only'],cwd=p,text=True).strip()
 roots=[str(x) for x in [p/'src',p/'renderer/src'] if x.is_dir()]
 if roots:
  result=subprocess.run(['rg','-n','--max-columns','200',r'\b(TODO|FIXME|HACK|XXX)\b',*roots],capture_output=True,text=True,encoding='utf-8');assert result.returncode in [0,1];todos[name]=result.stdout.splitlines()
prior=json.loads((L/'.data/publication-203/0ede20e8-2232-49a7-81f1-ef2580ccae30/receipt.json').read_text('utf-8'))
assert prior['status']=='published_and_read_back' and heads==prior['committed']
report={'stage':204,'at':datetime.now(timezone.utc).isoformat(),'heads':heads,'preserved_untracked':protected,'literal_source_markers':todos,'prior_turn':'progress: source, deployment, actual evidence and ordinary eight-ref publication','scope':'All102 original requirements/32 groups remain. Literal marker absence is not acceptance.'}
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8');print(json.dumps({'status':'baseline_recorded','heads':heads,'protected_files':len(protected),'literal_markers':{k:len(v) for k,v in todos.items()}}))
