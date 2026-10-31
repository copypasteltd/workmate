"""One fresh-source first-use smoke; no broad regression and no existing services touched."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,os,socket,subprocess,sys,time,uuid,zipfile
ROOT=Path(__file__).resolve().parents[3];DELIVERY=ROOT/'dev/copypaste-delivery'
def digest(p):
 h=sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return h.hexdigest()
def occupied(port):
 with socket.socket() as s:s.settimeout(.5);return s.connect_ex(('127.0.0.1',port))==0
def main():
 attempt=sys.argv[1];assert len(attempt)==2 and attempt.isdigit()
 base=DELIVERY/'evidence/source-handoff-158';base.mkdir(parents=True,exist_ok=True);report=base/('first-use-'+attempt+'.json');assert not report.exists()
 original=DELIVERY/'release'/('workmate-source-158-'+attempt);receipt=json.loads((original/'package-receipt.json').read_bytes())
 owned=DELIVERY/'.data/source-handoff-158'/('rehearsal-'+str(uuid.uuid4()));owned.mkdir(parents=True)
 result={'started_at':datetime.now(timezone.utc).isoformat(),'status':'running','owned_directory':str(owned.relative_to(DELIVERY)),'package_receipt_sha256':digest(original/'package-receipt.json'),'checks':[],'commands':[],'browser':None,'error':None,'owned_services_closed':False,'source_unchanged':False}
 log=(owned/'commands.log').open('xb');controller=None;fresh=None
 env={**os.environ,'NODE_ENV':'development','CODEX_BIN':'intentionally-missing-source-demo-path','CODEX_VERSION':'intentionally-stale-source-demo-version'}
 for key in ['DATABASE_URL','CONTROL_DATABASE_URL','QUEUE_DATABASE_URL','OWNER_DATABASE_URL','COPYPASTE_LOCAL_CODEX_BIN','COPYPASTE_NATIVE_DATABASE_DIR','COPYPASTE_NATIVE_DATABASE_START_ONLY']:env.pop(key,None)
 def run(args,cwd,extra=None,timeout=1200,expected=0):
  r=subprocess.run(args,cwd=cwd,env={**env,**(extra or {})},stdout=log,stderr=log,timeout=timeout)
  result['commands'].append({'argv':args,'cwd':str(cwd.relative_to(owned)) if cwd.is_relative_to(owned) else str(cwd),'exit_code':r.returncode,'expected_exit':expected});log.flush()
  if expected==0:assert r.returncode==0,'Command failed; inspect the owned commands.log'
  else:assert r.returncode!=0,'Invalid source-demo configuration unexpectedly accepted'
  return r.returncode
 try:
  assert all(not occupied(p) for p in [4310,4317,4318,4319,55432]),'Existing services preserved; choose a free run window'
  for name,item in receipt['artifacts'].items():
   archive=original/name;assert digest(archive)==item['sha256']
   with zipfile.ZipFile(archive) as z:
    for n in z.namelist():assert not n.startswith(('/','\\')) and '..' not in Path(n).parts
    z.extractall(owned)
  fresh=owned/('workmate-source-158-'+attempt);manifest=json.loads((fresh/'SOURCE-MANIFEST.json').read_bytes());env['COPYPASTE_DEV_ROOT']=str(fresh/'dev');delivery=fresh/'dev/copypaste-delivery'
  assert all(digest(fresh/f)==v['sha256'] for f,v in manifest['source_files'].items());result['checks'].append('Source and matching four-file runtime companion extracted; every source byte matches its manifest')
  run(['node','scripts/bootstrap-source-demo-158.mjs'],delivery);result['checks'].append('All six locked dependency trees installed from scratch and five product source builds completed')
  run(['node','scripts/start-source-demo-158.mjs','--check'],delivery);result['checks'].append('Pinned runtime version and all four native hashes validated; intentionally stale PATH-style runtime settings are overridden for demo only')
  run(['node','scripts/start-source-demo-158.mjs','--check'],delivery,{'NODE_ENV':'production'},expected=1)
  run(['node','scripts/start-source-demo-158.mjs','--check'],delivery,{'DATABASE_URL':'postgres://cp_app:synthetic@example.invalid:55432/copypaste'},expected=1)
  result['checks'].append('Production mode and remote database overrides fail before any service starts')
  controller=subprocess.Popen(['node','scripts/start-source-demo-158.mjs'],cwd=delivery,env=env,stdout=log,stderr=log)
  deadline=time.monotonic()+600
  while not all(occupied(p) for p in [4310,4317,4318,4319,55432]):
   assert controller.poll() is None,'Fresh source startup exited; inspect owned controller logs';assert time.monotonic()<deadline,'Fresh source startup deadline';time.sleep(.5)
  result['checks'].append('Fresh native database migrates through schema155; generic demo entry starts API, Web and Admin')
  run(['node','--import','tsx','scripts/qa-source-handoff-158-v1.ts',str(fresh),attempt],DELIVERY,timeout=240)
  ui=DELIVERY/'evidence/source-handoff-158'/('ui-'+attempt+'.json');j=json.loads(ui.read_bytes());assert j['status']=='passed' and j['browser_closed'];result['browser']={'path':ui.relative_to(DELIVERY).as_posix(),'sha256':digest(ui),'checks':j['checks']};result['checks'].append('Actual browser OTP → first workspace → delegated real Codex task → private deliverable download')
 except Exception as e:result['error']=type(e).__name__+': '+str(e)
 finally:
  if controller is not None and controller.poll() is None:
   try:run(['node','scripts/stop.mjs'],fresh/'dev/copypaste-delivery',timeout=360);controller.wait(timeout=15)
   except Exception as e:result['error']=(result['error'] or '')+'; owned shutdown: '+str(e)
  result['owned_services_closed']=all(not occupied(p) for p in [4310,4317,4318,4319,55432])
  if fresh and (fresh/'SOURCE-MANIFEST.json').is_file():
   m=json.loads((fresh/'SOURCE-MANIFEST.json').read_bytes());result['source_unchanged']=all(digest(fresh/f)==v['sha256'] for f,v in m['source_files'].items())
  result['finished_at']=datetime.now(timezone.utc).isoformat();result['verifier_sha256']=digest(Path(__file__));result['log_sha256']=digest(owned/'commands.log');result['scope']='One fresh-source Windows first-use loop; native PG and actual pinned Codex, synthetic external dependencies. No VM. No production/live-provider acceptance or newly packaged native-client acceptance. Original frozen148 artifacts remain untouched.'
  result['status']='passed' if not result['error'] and result['browser'] and result['owned_services_closed'] and result['source_unchanged'] else 'failed'
  report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');log.close();print(json.dumps({'status':result['status'],'report':str(report),'checks':len(result['checks']),'error':result['error']},ensure_ascii=False));assert result['status']=='passed'
if __name__=='__main__':main()
