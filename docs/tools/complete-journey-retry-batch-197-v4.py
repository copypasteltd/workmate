from pathlib import Path
root=Path(__file__).resolve().parents[2];s=root/'dev/copypaste-delivery/scripts'
# Preserve all executed drivers. A bounded second navigation is safe only for these read-only page GETs.
helper=(s/'live-owner-197-v1.mjs').read_text(encoding='utf8')
helper=helper.replace("e.name!=='TimeoutError'", "!(e.name==='TimeoutError'||/net::ERR_(?:TIMED_OUT|CONNECTION_TIMED_OUT|CONNECTION_RESET|NETWORK_CHANGED)/.test(e.message))")
(s/'live-owner-197-v2.mjs').write_text(helper,encoding='utf8',newline='\n')
for old,new in [('qualify-web-review-197-v3.mjs','qualify-web-review-197-v4.mjs'),('smoke-integrated-197-v3.mjs','smoke-integrated-197-v4.mjs'),('qualify-desktop-delta-197-v1.mjs','qualify-desktop-delta-197-v2.mjs')]:
 text=(s/old).read_text(encoding='utf8').replace('live-owner-197-v1.mjs','live-owner-197-v2.mjs')
 if old.startswith('qualify-web-'):
  text=text.replace('authenticateOwner197}', 'authenticateOwner197,navigate}').replace("await p.goto(WEB+'/app/tasks/'+owned.task_id,{waitUntil:'domcontentloaded'})", "await navigate(p,WEB+'/app/tasks/'+owned.task_id)")
  text=text.replace("'197-v3'","'197-v4'").replace('197-v3-task-review.png','197-v4-task-review.png')
 if old.startswith('smoke-'):
  text=text.replace('authenticateOwner197}', 'authenticateOwner197,navigate}')
  for var in ['p','page','a']:
   import re
   text=re.sub(r'await '+var+r"\.goto\(([^;]*?),\{waitUntil:'domcontentloaded'\}\)",r'await navigate('+var+r',\1)',text)
  text=text.replace("'197-v2'","'197-v4'").replace('197-v2-service-readiness.png','197-v4-service-readiness.png')
 if old.startswith('qualify-desktop-'):
  text=text.replace("'197-v3'","'197-v4'").replace('197-v3-desktop-review.png','197-v4-desktop-review.png')
 (s/new).write_text(text,encoding='utf8',newline='\n')
print('Completed read-only browser navigation retry driver batch; no product/API/model call is replaced or replayed.')
