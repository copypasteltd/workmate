from pathlib import Path
import json
ROOT=Path('D:/dev/copypasted/自有agent')
for folder in ['dev/copypaste-web/src','dev/copypaste-desktop/renderer/src']:
 p=ROOT/folder/'work-navigation.tsx';s=p.read_text(encoding='utf-8')
 s=s.replace('return {path:(path:string)=>','return {currentPath:location.pathname,path:(path:string)=>')
 s=s.replace('path:scopedWorkPath(/^\\/app\\/(tasks|conversations|files|notifications)(\\/|$)/.test(location.pathname)?location.pathname+location.search:"/app/tasks",w.tenant,w.project)',
 'path:scopedWorkPath(location.pathname==="/app"||/^\\/app\\/(conversations|files|notifications)(\\/|$)/.test(location.pathname)||location.pathname==="/app/tasks"?location.pathname+location.search:"/app/tasks",w.tenant,w.project)')
 s=s.replace('["/app/tasks","/app/conversations","/app/notifications"].includes(u.pathname)','(["/app","/app/tasks","/app/conversations","/app/notifications"].includes(u.pathname)||/^\\/app\\/conversations\\/[a-f\\d-]{36}$/i.test(u.pathname))')
 s=s.replace('const name=target.startsWith("/app/conversations")?', 'const name=target.split("?")[0]==="/app"?t("返回工作空間","Back to workspace"):target.startsWith("/app/conversations/")?t("返回原會話","Back to conversation"):target.startsWith("/app/conversations")?')
 p.write_text(s,encoding='utf-8',newline='\n')
 p=ROOT/folder/'task-workbench.tsx';s=p.read_text(encoding='utf-8');old='<Link className="text-link workbench-detail"';assert s.count(old)==1
 s=s.replace(old,'{work.currentPath!=="/app/tasks/"+taskId&&<Link className="text-link workbench-detail"').replace('review")} →</Link>','review")} →</Link>}')
 p.write_text(s,encoding='utf-8',newline='\n')

# Do not bypass the deferred desktop owner guard in isolated test data.
# Real desktop directory records are exercised by the actual packaged native journey.
base=ROOT/'dev/copypaste-platform';p=base/'tests/task-directory-198-v1.test.ts';s=p.read_text(encoding='utf-8')
s=s.replace("CASE WHEN n%5=0 THEN 'desktop' ELSE 'cloud' END","'cloud'")
s=s.replace("execution_location='desktop'","execution_location='cloud'").replace('mode:"ask",location:"desktop"','mode:"ask",location:"cloud"')
s=s.replace('assert.deepEqual(await walk(f,{q:"%_"}),[]);','assert.deepEqual(await walk(f,{q:"%_"}),[]);assert.deepEqual(await walk(f,{location:"desktop"}),[]);')
(base/'tests/task-directory-198-v2.test.ts').write_text(s,encoding='utf-8',newline='\n')

contract={'schema':'copypaste-task-directory-routes-198-v1','baseline_lf_sha256':'4cfe133903ad3e046a697453a3aefbf498de83dbaede3085b4224057297146e0','routes':[{'method':'GET','path':'/v1/tenants/:tenant/projects/:project/task-directory'}],'conditional_routes':[],'expected_current_routes':752,'expected_current_conditional_routes':1,'authorization':'Read-only current user/session and project authority, private task RLS and original business-source boundaries. Signed filter/session/scope pagination; no AI execution or ledger write.'}
(base/'contracts/task-directory-route-additions-198.json').write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
p=base/'tests/route-inventory-189-v2.ts';s=p.read_text(encoding='utf-8');(base/'tests/history/route-inventory-189-v2.pre198.ts.snapshot').write_text(s,encoding='utf-8',newline='\n')
old='  return {...previous,routes:currentRoutes,conditional_routes:currentConditional};';assert old in s
s=s.replace(old,'''  const directory=JSON.parse(await readFile("contracts/task-directory-route-additions-198.json","utf8"));
  assert.equal(directory.baseline_lf_sha256,addition.baseline_lf_sha256);
  const finalRoutes=[...currentRoutes,...directory.routes],finalConditional=[...currentConditional,...directory.conditional_routes];
  assert.equal(new Set([...finalRoutes,...finalConditional].map(row=>row.method+" "+row.path)).size,finalRoutes.length+finalConditional.length);
  assert.equal(finalRoutes.length,directory.expected_current_routes);assert.equal(finalConditional.length,directory.expected_current_conditional_routes);
  return {...previous,routes:finalRoutes,conditional_routes:finalConditional};''')
p.write_text(s,encoding='utf-8',newline='\n')
p=ROOT/'dev/copypaste-delivery/scripts/verify-integrated-round-198-v2.mjs';s=p.read_text(encoding='utf-8').replace('integrated-198-v2','integrated-198-v3');p.with_name('verify-integrated-round-198-v3.mjs').write_text(s,encoding='utf-8',newline='\n')
p=ROOT/'dev/copypaste-desktop/scripts/package-integrated-198-v1.mjs';s=p.read_text(encoding='utf-8').replace('integrated-198-v2','integrated-198-v3');p.write_text(s,encoding='utf-8',newline='\n')
p=ROOT/'dev/copypaste-delivery/scripts/finalize-release-metadata-198-v1.mjs';s=p.read_text(encoding='utf-8').replace('integrated-198-v2','integrated-198-v3');p.write_text(s,encoding='utf-8',newline='\n')
print('All collected198 corrections written, original failed attempts and desktop ownership guard retained.')
