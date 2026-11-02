"""Observe current public/origin paths; retain independent observations verbatim."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json, subprocess, sys, time, uuid

delivery = Path(__file__).resolve().parents[1]
run = delivery / '.data' / 'recheck-190' / str(uuid.uuid4())
run.mkdir(parents=True)

def direct(host):
    started = time.monotonic()
    p = subprocess.run(['curl.exe', '--noproxy', '*', '--silent', '--show-error', '--max-time', '18', '--output', 'NUL', '--write-out', '%{http_code}', 'https://' + host + '/health/ready'], capture_output=True, timeout=22)
    return {'host':host, 'status':p.stdout.decode().strip(), 'exit_code':p.returncode, 'elapsed_seconds':round(time.monotonic()-started,2), 'error':p.stderr.decode(errors='replace').strip()}

def remote(name):
    p = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(delivery/'scripts/remote-command-189-v1.py'), str(delivery/'scripts'/name)], cwd=delivery, capture_output=True, timeout=100)
    (run/(name+'.stdout')).write_bytes(p.stdout)
    (run/(name+'.stderr')).write_bytes(p.stderr)
    return {'script':name, 'exit_code':p.returncode, 'result':json.loads(p.stdout) if p.returncode == 0 else None, 'error_class':None if p.returncode == 0 else 'RemoteObservationFailed'}

report={'stage':190,'at':datetime.now(timezone.utc).isoformat(),'scope':'Fresh public connectivity, original server paths and read-only operational inspection. No paid model request or changes to data/configuration.'}
with ThreadPoolExecutor(max_workers=5) as pool:
    network=[pool.submit(direct,h) for h in ['agent.copypaste.hk','agent-dashboard.copypaste.hk','ai-api.copypaste.hk']]
    system=pool.submit(remote,'inspect-system-190-v1.sh')
    edge=pool.submit(remote,'check-public-edge-189-v1.sh')
    report['direct_public']=[v.result() for v in network]
    report['system']=system.result()
    report['server_public_edge']=edge.result()
report['finished_at']=datetime.now(timezone.utc).isoformat()
receipt=run/'receipt.json'
receipt.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'receipt':str(receipt),**report},ensure_ascii=False))
