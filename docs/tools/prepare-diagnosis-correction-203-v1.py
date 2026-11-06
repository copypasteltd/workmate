from pathlib import Path
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts'
p=S/'diagnose-specialist-source-203-v1.sh';s=p.read_text('utf-8')
s=s.replace("import path from 'node:path';","import path from 'node:path';import {execFileSync} from 'node:child_process';")
s=s.replace("const id='24238674-b8ed-47a0-8927-0e6adba946a1'","const pid=execFileSync('systemctl',['show','workmate-api.service','-p','MainPID','--value'],{encoding:'utf8'}).trim(),environ=(await readFile('/proc/'+pid+'/environ','utf8')).split('\\0'),actualData=environ.find(v=>v.startsWith('DATA_DIR='))?.slice(9)??'.data';\nconst id='24238674-b8ed-47a0-8927-0e6adba946a1'")
s=s.replace("path.resolve(process.env.DATA_DIR,'runs'","path.resolve(actualData,'runs'")
s=s.replace('await walk(base);const client=','try{await walk(base);}catch(e){rows.push({read_error:e.code,base});}const client=')
out=S/'diagnose-specialist-source-203-v2.sh';assert not out.exists();out.write_text(s,encoding='utf-8',newline='\n')
print('Prepared original-process DATA_DIR read and retained missing-path diagnosis; no remote settings changed.')
