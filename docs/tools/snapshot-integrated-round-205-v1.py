"""Read-only source/requirements inventory before the round's implementation."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, subprocess

R = Path(__file__).resolve().parents[2]
D = R / 'dev'
L = D / 'copypaste-delivery'
Q = R / 'docs/quality/integrated-round-205'
Q.mkdir(parents=True, exist_ok=True)
old = json.loads((L / '.data/acceptance-204/baseline/receipt.json').read_text('utf-8'))
publication = json.loads((L / '.data/publication-204/cf4c6be6-9b02-4ec6-97c3-83413205ac26/receipt.json').read_text('utf-8'))
assert publication['status'] == 'published_and_read_back'
repos = {k: D / ('copypaste-' + v) for k, v in {'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}.items()}
repos['docs'] = R
heads, markers, tracked = {}, {}, {}
for name, repo in repos.items():
    args = ['git', '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false']
    heads[name] = subprocess.check_output(args + ['rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    assert heads[name] == publication['committed'][name], name
    tracked[name] = subprocess.check_output(args + ['status','--porcelain','--untracked-files=no'], cwd=repo, text=True).strip()
    assert not tracked[name], (name, tracked[name])
    roots = [str(p) for p in [repo/'src',repo/'renderer/src'] if p.is_dir()]
    if roots:
        result = subprocess.run(['rg','-n','--max-columns','200',r'\b(TODO|FIXME|HACK|XXX)\b',*roots],capture_output=True,text=True,encoding='utf-8')
        assert result.returncode in (0,1)
        markers[name] = result.stdout.splitlines()
for p, digest in old['preserved_untracked'].items():
    assert hashlib.sha256((R/p).read_bytes()).hexdigest() == digest, p
req = json.loads((R/'docs/quality/integrated-round-204/requirements-overlay.json').read_text('utf-8'))
assert len(req['requirements']) == 102 and len(req['groups']) == 32
report = {'stage':205,'at':datetime.now(timezone.utc).isoformat(),'heads':heads,'preserved_untracked':old['preserved_untracked'],
          'literal_source_markers':markers,'prior_turn':'progress: round204 deployed, published, source-bound evidence retained',
          'requirements':[{'id':r['id'],'module':r['module'],'original_remaining':r['historical_remaining_scope']} for r in req['requirements']],
          'groups':[{'id':g['id'],'area':g['area'],'to_close':g['to_close']} for g in req['groups']],
          'constraints':{'server_network':'read_only','local_virtualization':False,'all_original_acceptance_scopes_retained':True}}
out = L/'.data/acceptance-205/baseline/receipt.json'
out.parent.mkdir(parents=True,exist_ok=True)
assert not out.exists()
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
(Q/'requirements-inventory.json').write_text(json.dumps({k:report[k] for k in ['stage','at','requirements','groups','literal_source_markers','constraints']},ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps({'status':'baseline_recorded','source_heads':heads,'protected_files':len(old['preserved_untracked']),'requirements':102,'groups':32,'literal_markers':{k:len(v) for k,v in markers.items()}}))
