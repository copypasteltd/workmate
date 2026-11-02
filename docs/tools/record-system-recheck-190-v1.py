"""Bind fresh observations to unchanged source-bound prior checks without rerunning them."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, subprocess

root=Path(__file__).resolve().parents[2]
delivery=root/'dev/copypaste-delivery'
prior=json.loads((root/'docs/quality/live-acceptance-189.json').read_text(encoding='utf8'))
assert all(sha256((root/p).read_bytes()).hexdigest()==h for p,h in prior['sources'].items())
target=root/'docs/quality/system-recheck-190'
target.mkdir(exist_ok=False)
files={
 'network-system.json':delivery/'.data/recheck-190/14e7033c-0dee-4d4e-83c6-7f195dad1993/receipt.json',
 'public-browser.json':delivery/'.data/recheck-190/browser-ed4a95eb-a3b8-48fd-89c9-e95a93215562/receipt.json',
}
evidence=[]
for name,p in files.items():
 raw=p.read_bytes();obj=json.loads(raw)
 assert obj['stage']==190
 with (target/name).open('xb') as f:f.write(raw)
 evidence.append({'path':(target/name).relative_to(root).as_posix(),'sha256':sha256(raw).hexdigest(),'original':p.relative_to(root).as_posix()})
network=json.loads(files['network-system.json'].read_bytes());browser=json.loads(files['public-browser.json'].read_bytes())
assert browser['owned_browsers_closed'] and not browser['javascript_errors']
scripts=['inspect-system-190-v1.sh','recheck-network-system-190-v1.py','recheck-public-ui-190-v1.mjs','remote-command-189-v1.py','check-public-edge-189-v1.sh','public-qa-transport-189-v1.py','live-client-189-v2.mjs']
heads={}
for name in ['platform','web','admin','desktop','extension','delivery']:
 heads[name]=subprocess.check_output(['git','-C',str(root/'dev'/('copypaste-'+name)),'rev-parse','HEAD'],cwd=root,text=True).strip()
report={
 'stage':190,'at':datetime.now(timezone.utc).isoformat(),'status':'rechecked_with_open_issues','full_product_accepted':False,
 'numbered_groups':14,'public_browser':{'total':len(browser['checks']),'passed':sum(c['status']=='passed' for c in browser['checks']),'failed':sum(c['status']=='failed' for c in browser['checks']),'javascript_errors':0},
 'server_public_checks':{'total':len(network['server_public_edge']['result']['public']),'timeouts':sum(c.get('error_class')=='TimeoutError' for c in network['server_public_edge']['result']['public'])},
 'prior_scope_reused':{'checkpoint':'189','source_count':len(prior['sources']),'source_hashes_unchanged':True,'suites_rerun_this_turn':False,'backend_full':prior['backend_full_regression'],'targeted_browser_followup_passed':True,'desktop_supplier_work_rerun':False},
 'product_heads_observed':heads,'new_paid_tasks':0,'production_changes':False,
 'owned_browsers_closed':True,'owned_connect_closed':True,'local_virtualization_used':False,
 'evidence':evidence,
 'probe_sources':{('dev/copypaste-delivery/scripts/'+p):sha256((delivery/'scripts'/p).read_bytes()).hexdigest() for p in scripts},
 'limits':'Read-only current checks plus explicitly reused recent source-bound regressions and real workflows. No claim that all potential faults have been found. Protected test mailbox is intentionally retained.'
}
with (root/'docs/quality/190-system-recheck.json').open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':report['status'],'browser':report['public_browser'],'evidence':len(evidence),'prior_sources_unchanged':len(prior['sources'])}))
