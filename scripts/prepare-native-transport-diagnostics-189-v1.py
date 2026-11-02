from pathlib import Path
scripts=Path(__file__).resolve().parent
text=(scripts/'public-qa-transport-189-v1.py').read_text(encoding='utf8')
text=text.replace('import sys\n','import sys\nimport time\n\nmetrics = []\nmetric_lock = threading.Lock()\n')
text=text.replace('11236','11237')
text=text.replace('        channel = None\n',"        channel = None\n        observed = {'host': hostname, 'started_at': time.time(), 'sent_bytes': 0, 'received_bytes': 0}\n")
text=text.replace('                    break\n                except (OSError',"                    observed['address'] = address\n                    break\n                except (OSError",1)
text=text.replace('                    channel.sendall(data)',"                    observed['sent_bytes'] += len(data)\n                    channel.sendall(data)")
text=text.replace('                    self.connection.sendall(data)',"                    observed['received_bytes'] += len(data)\n                    self.connection.sendall(data)")
text=text.replace('            if channel:\n                channel.close()',"            observed['elapsed_ms'] = round((time.time() - observed.pop('started_at')) * 1000)\n            with metric_lock:\n                metrics.append(observed)\n            if channel:\n                channel.close()")
text=text.replace("        if json.loads(line).get('action') == 'close':\n            break", "        action = json.loads(line).get('action')\n        if action == 'status':\n            with metric_lock:\n                print(json.dumps({'connections': metrics}), flush=True)\n        if action == 'close':\n            break")
with (scripts/'public-qa-transport-189-v2.py').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
text=(scripts/'qualify-real-desktop-189-v4.mjs').read_text(encoding='utf8')
text=text.replace('11236','11237')
before="cp=process.getBuiltinModule('node:child_process'),spawn=cp.spawn;cp.spawn=function(file,args,options){if(String(file).toLowerCase().endsWith('codex.exe'))options={...options,env:{...options.env,HTTPS_PROXY:'http://127.0.0.1:11237',HTTP_PROXY:'http://127.0.0.1:11237',NO_PROXY:'127.0.0.1,localhost'}};return spawn.call(this,file,args,options);};"
after="cp=process.getBuiltinModule('node:child_process'),spawn=cp.spawn;globalThis.__qaNativeSpawn=[];cp.spawn=function(file,args,options){if(String(file).toLowerCase().endsWith('codex.exe')){options={...options,env:{...options.env,HTTPS_PROXY:'http://127.0.0.1:11237',HTTP_PROXY:'http://127.0.0.1:11237',NO_PROXY:'127.0.0.1,localhost'}};globalThis.__qaNativeSpawn.push({pinned_codex:true,proxy_present:!!options.env.HTTPS_PROXY,no_proxy_loopback:options.env.NO_PROXY==='127.0.0.1,localhost'});}return spawn.call(this,file,args,options);};"
assert text.count(before)==1;text=text.replace(before,after)
text=text.replace('node:process.versions.node,requests:globalThis.__qaFetch','node:process.versions.node,requests:globalThis.__qaFetch,native_spawns:globalThis.__qaNativeSpawn')
with (scripts/'qualify-real-desktop-189-v5.mjs').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
