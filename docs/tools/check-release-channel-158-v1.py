"""Read-only current GitHub release-channel availability; never emit credentials."""
from pathlib import Path
from datetime import datetime,timezone
import json,os,subprocess,urllib.request,urllib.error,uuid
ROOT=Path(r'D:\dev\copypasted\自有agent');out=ROOT/'dev/copypaste-delivery/.data/release-freeze-158';out.mkdir(parents=True,exist_ok=True)
r=subprocess.run(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','credential','fill'],cwd=ROOT,input=b'protocol=https\nhost=github.com\n\n',stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GCM_INTERACTIVE':'never','GCM_GUI_PROMPT':'false'},timeout=30)
fields=dict(line.split('=',1) for line in r.stdout.decode().splitlines() if '=' in line)
result={'at':datetime.now(timezone.utc).isoformat(),'method':'GET','repository':'copypasteltd/workmate','status':'unavailable','http_status':None,'message':None}
if r.returncode==0 and fields.get('password'):
 req=urllib.request.Request('https://api.github.com/repos/copypasteltd/workmate',headers={'Authorization':'Bearer '+fields['password'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'workmate-release158'})
 try:
  with urllib.request.urlopen(req,timeout=25) as response:result.update(status='available',http_status=response.status)
 except urllib.error.HTTPError as e:
  body=json.loads(e.read());result.update(status='rejected',http_status=e.code,message=body.get('message','GitHub request rejected'))
else:result['message']='No usable noninteractive stored HTTPS credential'
p=out/('github-channel-check-'+str(uuid.uuid4())+'.json');p.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps({**result,'receipt':str(p)},ensure_ascii=False))
