"""Reuse the verified fresh source preparation; correct only the role in browser smoke."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,os,socket,subprocess,time,uuid
ROOT=Path(__file__).resolve().parents[3];DELIVERY=ROOT/'dev/copypaste-delivery'
def digest(p):return sha256(p.read_bytes()).hexdigest()
def occupied(p):
 with socket.socket() as s:s.settimeout(.5);return s.connect_ex(('127.0.0.1',p))==0
def main():
 priorpath=DELIVERY/'evidence/source-handoff-158/first-use-03.json';prior=json.loads(priorpath.read_bytes());assert prior['source_unchanged'] and prior['owned_services_closed'] and len(prior['checks'])==6
 owned=ROOT/prior['owned_directory'];assert owned.resolve().is_relative_to((ROOT/'dev').resolve());fresh=owned/'workmate-source-158-03';delivery=fresh/'dev/copypaste-delivery';source=json.loads((fresh/'SOURCE-MANIFEST.json').read_bytes())['source_files']
 assert all(digest(fresh/f)==v['sha256'] for f,v in source.items());assert not (fresh/'dev/copypaste-platform/.data/postgres/postmaster.pid').exists()
 report=DELIVERY/'evidence/source-handoff-158/first-use-04.json';assert not report.exists();logs=DELIVERY/'.data/source-handoff-158'/('resume-'+str(uuid.uuid4()));logs.mkdir(parents=True);log=(logs/'commands.log').open('xb')
 env={**os.environ,'NODE_ENV':'development','COPYPASTE_SOURCE_DATABASE_PORT':'55439','COPYPASTE_DEV_ROOT':str(fresh/'dev'),'CODEX_BIN':'intentionally-stale-path','CODEX_VERSION':'intentionally-stale-version'}
 for k in ['DATABASE_URL','CONTROL_DATABASE_URL','QUEUE_DATABASE_URL','OWNER_DATABASE_URL','COPYPASTE_LOCAL_CODEX_BIN','COPYPASTE_NATIVE_DATABASE_DIR','COPYPASTE_NATIVE_DATABASE_START_ONLY']:env.pop(k,None)
 result={'at':datetime.now(timezone.utc).isoformat(),'status':'running','owned_directory':str(owned.relative_to(ROOT)),'preparation':{'path':priorpath.relative_to(DELIVERY).as_posix(),'sha256':digest(priorpath),'checks':prior['checks'],'note':'All six lockfile installs, source builds, runtime/configuration checks and duplicate database preservation completed in03. Only its browser role selection failed; current browser explicitly chooses the default assistant. No product source was changed.'},'checks':[],'browser':None,'error':None};controller=None
 def run(args,cwd,timeout=240):
  r=subprocess.run(args,cwd=cwd,env=env,stdout=log,stderr=log,timeout=timeout);log.flush();assert r.returncode==0,'Command failed; original owned log retained'
 try:
  assert all(not occupied(p) for p in [4310,4317,4318,4319,55439]);run(['node','scripts/start-source-demo-158.mjs','--check'],delivery);result['checks'].append('Previously installed source remains byte-identical and its pinned runtime validates')
  controller=subprocess.Popen(['node','scripts/start-source-demo-158.mjs'],cwd=delivery,env=env,stdout=log,stderr=log);deadline=time.monotonic()+180
  while not all(occupied(p) for p in [4310,4317,4318,4319,55439]):
   assert controller.poll() is None;assert time.monotonic()<deadline;time.sleep(.5)
  result['checks'].append('Owned native database, API, Web and Admin start on the explicitly chosen free ports')
  run(['node','--import','tsx','scripts/qa-source-handoff-158-v2.ts',str(fresh),'04'],DELIVERY)
  ui=DELIVERY/'evidence/source-handoff-158/ui-04.json';j=json.loads(ui.read_bytes());assert j['status']=='passed' and j['browser_closed'];result['browser']={'path':ui.relative_to(DELIVERY).as_posix(),'sha256':digest(ui),'checks':j['checks']};result['checks'].append('New customer completes actual OTP/workspace/credit, default assistant real Codex execution and private file download')
 except Exception as e:result['error']=type(e).__name__+': '+str(e)
 finally:
  if controller is not None and controller.poll() is None:
   try:run(['node','scripts/stop.mjs'],delivery,360);controller.wait(timeout=15)
   except Exception as e:result['error']=(result['error'] or '')+'; owned shutdown: '+str(e)
  result['owned_services_closed']=all(not occupied(p) for p in [4310,4317,4318,4319,55439]);result['source_unchanged']=all(digest(fresh/f)==v['sha256'] for f,v in source.items());result['verifier_sha256']=digest(Path(__file__));result['log_sha256']=digest(logs/'commands.log');result['finished_at']=datetime.now(timezone.utc).isoformat();result['status']='passed' if result['browser'] and result['owned_services_closed'] and result['source_unchanged'] and not result['error'] else 'failed';log.close();report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps({'status':result['status'],'report':str(report),'error':result['error']},ensure_ascii=False));assert result['status']=='passed'
if __name__=='__main__':main()
