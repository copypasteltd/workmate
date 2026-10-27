"""Execute the real removal macros in an isolated, non-destructive NSIS harness."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import argparse
import json
import os
import re
import subprocess
import sys
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[2]
L=ROOT/'dev/copypaste-delivery'
D=ROOT/'dev/copypaste-desktop'
parser=argparse.ArgumentParser()
parser.add_argument('--attempt',default='01')
args=parser.parse_args()
assert re.fullmatch(r'\d{2}',args.attempt)
OUT=L/f'evidence/desktop-removal-nsis-{args.attempt}.json'
EVID=L/f'evidence/desktop-removal-nsis-{args.attempt}'
OWNED=L/'.data/nsis-removal-117'/str(uuid4())
assert not OUT.exists() and not EVID.exists() and not OWNED.exists()
assert OWNED.parent==L/'.data/nsis-removal-117'
OWNED.mkdir(parents=True);EVID.mkdir()
cache=Path(os.environ['LOCALAPPDATA'])/'electron-builder/Cache/nsis'
compiler=cache/'nsis-3.0.4.1/makensis.exe'
plugin=cache/'nsis-resources-3.4.1/plugins/x86-unicode/nsProcess.dll'
csc=Path(os.environ.get('SystemRoot','C:/Windows'))/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
assert all(p.is_file() for p in [compiler,plugin,csc])
hook=D/'scripts/desktop-lifecycle.nsh'
original=hook.read_bytes()
digest=lambda p:sha256(p.read_bytes()).hexdigest()
def ref(p):return {'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)}
def write(p,data):
    with p.open('xb') as f:f.write(data)
fake_name='CopyPaste-RemovalFixture-'+uuid4().hex+'.exe'
fixture=OWNED/fake_name
source=r'''using System;using System.IO;using System.Threading;
class Fixture { static int Main(string[] args) {
 string root=AppDomain.CurrentDomain.BaseDirectory;
 if(args.Length==1&&args[0]=="--hold"){File.WriteAllText(Path.Combine(root,"holding.txt"),"owned");Thread.Sleep(60000);return 0;}
 if(args.Length!=1||args[0]!="--prepare-uninstall")return 99;
 File.AppendAllText(Path.Combine(root,"prepared.txt"),"prepare\n");
 return Int32.Parse(File.ReadAllText(Path.Combine(root,"prepare-exit.txt")));
}}'''
write(EVID/'fixture.cs',source.encode())
def run(command,log,timeout=60):
    result=subprocess.run([str(v) for v in command],cwd=OWNED,capture_output=True,timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW)
    write(log,result.stdout+result.stderr)
    return result
compiled=run([csc,'/nologo','/target:exe','/out:'+str(fixture),EVID/'fixture.cs'],EVID/'csc.log')
assert compiled.returncode==0
def nsis(installer=False):
    target=OWNED/('install-check.exe' if installer else 'remove-check.exe')
    text=f'''Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "CopyPaste isolated removal verification"
OutFile "{target}"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!addplugindir /x86-unicode "{plugin.parent}"
!define APP_EXECUTABLE_FILENAME "{fake_name}"
!define BUILD_UNINSTALLER
Var UpdatedFlag
!define isUpdated '$UpdatedFlag == "1"'
!include "{hook}"
Function .onInit
 StrCpy $INSTDIR "{OWNED}"
 StrCpy $UpdatedFlag "0"
 ${{GetParameters}} $R0
 ClearErrors
 ${{GetOptions}} $R0 "--updated" $R1
 ${{IfNot}} ${{Errors}}
  StrCpy $UpdatedFlag "1"
 ${{EndIf}}
 ClearErrors
'''
    if not installer:text+=' !insertmacro customUnInit\n'
    text+='FunctionEnd\n'
    if installer:text+='!undef BUILD_UNINSTALLER\n'
    text+='Section "Owned verification only"\n !insertmacro '+('customCheckAppRunning' if installer else 'customUnInstall')+'\n'
    text+=' FileOpen $R2 "$INSTDIR\\removal-boundary.txt" w\n FileWrite $R2 "hook completed"\n FileClose $R2\nSectionEnd\n'
    file=EVID/('install-check.nsi' if installer else 'remove-check.nsi')
    write(file,text.encode('utf-8-sig'))
    result=run([compiler,'/V3',file],EVID/(file.stem+'-compile.log'))
    assert result.returncode==0, (file,result.stdout.decode(errors='replace')[-2000:])
    return target

checks=[];failure=None;held=None
try:
    removal,install=nsis(),nsis(True)
    marker=OWNED/'removal-boundary.txt'
    def attempt(name,code,flags=(),target=removal,success=False):
        assert marker.parent==OWNED
        marker.unlink(missing_ok=True)
        (OWNED/'prepare-exit.txt').write_text(str(code),encoding='ascii')
        before=(OWNED/'prepared.txt').read_text() if (OWNED/'prepared.txt').exists() else ''
        result=run([target,'/S',*flags],EVID/(name+'.log'))
        after=(OWNED/'prepared.txt').read_text() if (OWNED/'prepared.txt').exists() else ''
        actual={'name':name,'exit_code':result.returncode,'boundary_reached':marker.exists(),'prepare_invocations':after.count('prepare')-before.count('prepare')}
        checks.append(actual)
        assert (result.returncode==0)==success,actual
        assert marker.exists()==success,actual
        return actual
    assert attempt('customer-cancel',41)['exit_code']==41
    assert attempt('preparation-failure',43)['exit_code']==41
    assert attempt('confirmed-local-removal',0,success=True)['prepare_invocations']==1
    assert attempt('updated-skips-disconnect',43,['--updated'],success=True)['prepare_invocations']==0
    assert attempt('delete-app-data-is-refused',0,['--delete-app-data'])['exit_code']==44
    held=subprocess.Popen([str(fixture),'--hold'],cwd=OWNED,creationflags=subprocess.CREATE_NO_WINDOW)
    import time
    deadline=time.monotonic()+15
    while not (OWNED/'holding.txt').exists():
        assert held.poll() is None and time.monotonic()<deadline
        time.sleep(.05)
    assert attempt('owned-process-is-never-killed',0)['exit_code']==42
    assert held.poll() is None
    assert attempt('installer-refuses-active-process',0,target=install)['exit_code']==42
    assert held.poll() is None
    held.terminate();held.wait(timeout=15);held=None
    assert attempt('installer-continues-when-idle',0,target=install,success=True)['prepare_invocations']==0
except Exception as exc:failure=str(exc)
finally:
    if held is not None and held.poll() is None:held.terminate();held.wait(timeout=15)
    assert hook.read_bytes()==original
    files=[ref(p) for p in sorted(EVID.iterdir()) if p.is_file()]
    value={'at':datetime.now(timezone.utc).isoformat(),'status':'passed' if failure is None else 'failed','checks':checks,'error':failure,'source_unchanged':True,'nsis_lifecycle':ref(hook),'evidence_files':files,
        'compiler':{'version_directory':'nsis-3.0.4.1','sha256':digest(compiler),'process_plugin_sha256':digest(plugin)},'owned_fixture':{'path':OWNED.relative_to(ROOT).as_posix(),'executable_sha256':digest(fixture)},
        'installer_executed':False,'company_signed_uninstall_qualified':False,
        'scope':'Execute actual product NSIS macros using an isolated inert executable and a marker after the removal boundary. No real installer, app directory, registry registration or customer file is removed. An owned held process remains alive on refusal; only the harness terminates it in finally.',
        'verifier_sha256':digest(Path(__file__))}
    write(OUT,(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({'status':value['status'],'checks':len(checks),'error':failure}))
sys.exit(0 if failure is None else 1)
