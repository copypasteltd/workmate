#!/usr/bin/python3
"""Native Linux guardian: private namespaces, bounded cgroup and owned cleanup.

Customer programs never inherit service files, environment, sockets or other
workspaces. Chromium keeps its own renderer sandbox inside the private namespace.
"""
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import struct
import subprocess
import sys
import time

UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
MANIFEST = json.loads((Path(__file__).resolve().parent/'manifest.json').read_text())

def digest(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

assert sys.platform == 'linux' and os.uname().machine == 'x86_64'
assert digest(MANIFEST['bubblewrap_path']) == MANIFEST['bubblewrap_sha256']
def group_root(root=None):
    raw=os.environ.get('COPYPASTE_NATIVE_CGROUP_ROOT')
    if root is not None:
        for file in ['host-owner.json','owner.json']:
            try:raw=json.loads((root/file).read_text()).get('cgroup_root') or raw;break
            except FileNotFoundError:pass
    assert raw and re.fullmatch(r'/sys/fs/cgroup/system.slice/workmate-(?:api|candidate-[a-z0-9-]+|native-qualification-[a-z0-9-]+)\.service/executions',raw)
    result=Path(raw)
    assert result.resolve()==result and not result.is_symlink()
    return result

def owned(root,kind):
    root=Path(root).resolve()
    assert UUID.fullmatch(root.name) and root.parent.name==('cloud-browsers' if kind=='browser' else 'cloud-programs')
    return root

def write_json(file,value,exclusive=False):
    data=json.dumps(value,separators=(',',':'))+'\n'
    if exclusive:
        with Path(file).open('x') as f:f.write(data)
    else:
        temp=Path(str(file)+'.next')
        with temp.open('w') as f:f.write(data)
        os.replace(temp,file)

def processes(group):
    result=[]
    try:pids=(group/'cgroup.procs').read_text().split()
    except FileNotFoundError:return result
    for pid in pids:
        try:
            facts={k:v.strip() for k,v in (line.split(':',1) for line in Path('/proc',pid,'status').read_text().splitlines() if ':' in line)}
            namespace_pids=[int(v) for v in facts['NSpid'].split()]
            # CDP reports identifiers in the browser's outer PID namespace.
            # Renderer sandboxes may introduce one more nested namespace.
            result.append({'host_pid':int(pid),'pid':namespace_pids[1] if len(namespace_pids)>1 else int(pid),
                           'namespace_pids':namespace_pids,'seccomp':int(facts['Seccomp']),
                           'no_new_privs':facts['NoNewPrivs']=='1','uid':int(facts['Uid'].split()[0])})
        except (OSError,KeyError,ValueError):pass
    return result

def group_empty(group):
    try:
        facts=dict(line.split() for line in (group/'cgroup.events').read_text().splitlines())
        return facts.get('populated')=='0' and not (group/'cgroup.procs').read_text().strip()
    except FileNotFoundError:return True

def remove_empty_group(group):
    for _ in range(200):
        if group_empty(group):
            try:group.rmdir();return
            except OSError as e:
                if e.errno not in [16,39]:raise
        time.sleep(.01)
    raise RuntimeError('OWNED_GROUP_CLEANUP_TIMEOUT')

def inspect(root):
    root=owned(root,'browser')
    group=group_root(root)/('browser-'+root.name)
    members=processes(group)
    return {'schema':1,'job_name':'cgroup:'+root.name,'job_exists':group.exists(),'job_empty':group_empty(group),'processes':members}

def program_filter():
    # x86-64 only. Deny x32, process creation, networking and namespace/mount/
    # kernel inspection APIs. pthread clone remains available to the pinned Node.
    ins=[]
    def emit(code,jt=0,jf=0,k=0):ins.append(struct.pack('HBBI',code,jt,jf,k))
    emit(0x20,k=4);emit(0x15,1,0,0xc000003e);emit(0x06,k=0x80000000)
    emit(0x20,k=0);emit(0x35,0,1,0x40000000);emit(0x06,k=0x00050001)
    for number in [41,42,43,49,50,53,57,58,101,155,165,166,175,176,246,272,298,303,304,308,310,311,312,313,321,323]:
        emit(0x15,0,1,number);emit(0x06,k=0x00050001)
    emit(0x15,0,1,435);emit(0x06,k=0x00050026) # clone3 -> ENOSYS; libc safely falls back.
    emit(0x15,0,3,56);emit(0x20,k=16);emit(0x45,1,0,0x10000);emit(0x06,k=0x00050001)
    emit(0x06,k=0x7fff0000)
    fd=os.memfd_create('copypaste-seccomp',0)
    os.write(fd,b''.join(ins));os.lseek(fd,0,0)
    return fd

if len(sys.argv)==3 and sys.argv[1]=='--inspect-job':
    print(json.dumps(inspect(sys.argv[2])));sys.exit(0)
if len(sys.argv)==3 and sys.argv[1]=='--cleanup':
    root=owned(sys.argv[2],'program');group=group_root(root)/('program-'+root.name)
    if group.exists():
        assert group_empty(group),'Owned execution is still running'
        remove_empty_group(group)
    sys.exit(0)

kind=MANIFEST['kind']
if kind=='browser':
    root=owned(os.environ['COPYPASTE_BROWSER_ROOT'],'browser')
    (root/'profile').mkdir(mode=0o700,exist_ok=True)
    binary=Path(os.environ['COPYPASTE_CHROMIUM_BINARY']).resolve()
    assert digest(binary)==os.environ['COPYPASTE_BROWSER_SHA256']
    timeout=int(os.environ['COPYPASTE_BROWSER_DEADLINE_MS'])
    assert 1<=timeout<=45000
    args=[]
    for arg in sys.argv[1:]:
        assert arg not in ['--no-sandbox','--disable-seccomp-filter-sandbox','--disable-namespace-sandbox']
        args.append(arg.replace(str(root/'profile'),'/profile').replace(str(root/'tmp'),'/tmp'))
    target=['/browser/'+binary.name,'--disable-setuid-sandbox',*args]
    stdin_channel=False
else:
    assert len(sys.argv)>=6
    root=owned(sys.argv[1],'program');binary=Path(sys.argv[2]).resolve()
    assert binary==root/'runtime/node' and digest(binary)==sys.argv[3]
    timeout=int(sys.argv[4]);assert 100<=timeout<=30000
    stdin_channel=sys.argv[5]=='--stdin-channel'
    args=sys.argv[6:] if stdin_channel else sys.argv[5:]
    target=['/runtime/node',*[a.replace(str(root/'runtime'),'/runtime').replace(str(root/'work'),'/work') for a in args]]

parent=os.getppid()
assert parent>1
if kind=='browser':assert parent==int(os.environ['COPYPASTE_BROWSER_PARENT_PID'])
groups=group_root();group=groups/(kind+'-'+root.name);group.mkdir(mode=0o700)
for name,value in {'memory.max':str(1073741824 if kind=='browser' else 536870912),'memory.swap.max':'0',
                   'pids.max':str(128 if kind=='browser' else 32),'cpu.max':'100000 100000'}.items():
    (group/name).write_text(value)
boundary=MANIFEST['boundary']
def parent_stamp():
    try:return Path('/proc',str(parent),'stat').read_text().rsplit(') ',1)[1].split()[19]
    except OSError:return None
original_parent=parent_stamp()
owner={'schema':1,'boundary':boundary,'execution_id':root.name,'controller_pid':parent,'cgroup_root':str(groups)}
if kind=='program':write_json(root/'owner.json',owner,True)
command=[MANIFEST['bubblewrap_path'],'--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL',
         '--uid',str(os.getuid()),'--gid',str(os.getgid()),'--clearenv']
for location in ['/usr','/lib','/lib64']:
    if Path(location).exists():command+=['--ro-bind',location,location]
command+=['--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/etc']
for location in ['/etc/ld.so.cache','/etc/fonts']:
    if Path(location).exists():command+=['--ro-bind',location,location]
command+=['--setenv','LANG','C.UTF-8','--setenv','PATH','/runtime:/usr/bin','--setenv','TMPDIR','/tmp']
fds=[]
if kind=='browser':
    for fd in [3,4]:os.fstat(fd)
    fds=[3,4]
    command+=['--ro-bind',str(binary.parent),'/browser','--bind',str(root/'profile'),'/profile',
              '--setenv','HOME','/profile','--setenv','XDG_CONFIG_HOME','/profile','--setenv','XDG_CACHE_HOME','/profile',
              '--chdir','/profile']
else:
    seccomp=program_filter();fds=[seccomp]
    command+=['--seccomp',str(seccomp),'--ro-bind',str(root/'runtime'),'/runtime','--bind',str(root/'work'),'/work',
              '--setenv','HOME','/work','--chdir','/work']
command+=['--',*target]
started=time.monotonic();child=None;cancelled=False;timed_out=False;parent_gone=False;failure=None
guardian_pid=os.getpid()
stop_requested=False
def stop(*_):
    global stop_requested
    stop_requested=True
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
def before_exec():
    (group/'cgroup.procs').write_text(str(os.getpid()))
    ctypes.CDLL(None).prctl(1,signal.SIGKILL,0,0,0)
    if os.getppid()!=guardian_pid:os._exit(125)
    if kind=='program':os.write(1,('CPCLOUD1 '+str(os.getpid())+'\n').encode())

def receipt(running,code=None):
    members=processes(group)
    return {'schema':1,'boundary':boundary,'execution_id':root.name,'controller_pid':parent,'host_pid':os.getpid(),
            'process_id':child.pid if child else None,'job_name':'cgroup:'+root.name,'processes':members,
            'running':running,'resumed':child is not None,'failure':failure,'exit_code':code,
            'job_empty':group_empty(group),'kill_on_close':True,'no_network_capabilities':True,
            'child_processes_prohibited':kind=='program','stdin_channel':stdin_channel,
            'profile_created':True,'profile_deleted':not running and group_empty(group),
            'timed_out':timed_out,'cancelled':cancelled,'parent_gone':parent_gone,
            'native_linux':True,'memory_limit_bytes':1073741824 if kind=='browser' else 536870912}
try:
    child=subprocess.Popen(command,stdin=subprocess.PIPE if kind=='program' else None,stdout=None,stderr=None,
                           pass_fds=tuple(fds),preexec_fn=before_exec)
    write_json(root/'host-owner.json',{'schema':1,'boundary':boundary,'execution_id':root.name,'controller_pid':parent,
                                     'host_pid':os.getpid(),'job_name':'cgroup:'+root.name,'cgroup_root':str(groups)},True)
    buffered=b'';read_stdin=kind=='program';last_write=0
    while child.poll() is None:
        now=time.monotonic()
        timed_out=now-started>timeout/1000
        parent_gone=original_parent is None or parent_stamp()!=original_parent
        cancelled=stop_requested or (root/'cancel').exists()
        if timed_out or parent_gone or cancelled:
            (group/'cgroup.kill').write_text('1');break
        if now-last_write>.08:
            write_json(root/'host-receipt.json',receipt(True));last_write=now
        if read_stdin and select.select([0],[],[],.025)[0]:
            piece=os.read(0,32768)
            if not piece:read_stdin=False;cancelled=True;stop_requested=True;continue
            buffered+=piece
            if len(buffered)>65536:raise ValueError('CONTROL_INPUT_LIMIT')
            while b'\n' in buffered:
                line,buffered=buffered.split(b'\n',1)
                if line==b'cancel':stop_requested=True
                elif line==b'eof' and stdin_channel:child.stdin.close()
                elif line.startswith(b'data:') and stdin_channel:
                    child.stdin.write(base64.b64decode(line[5:],validate=True));child.stdin.flush()
                else:raise ValueError('CONTROL_INPUT_INVALID')
        else:time.sleep(.015)
    exit_code=child.wait(timeout=5)
    exit_code=exit_code if exit_code>=0 else 128-exit_code
except Exception as error:
    failure=type(error).__name__;exit_code=125
finally:
    if group.exists():
        if processes(group):(group/'cgroup.kill').write_text('1')
        if child:
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:failure='OWNED_CLEANUP_TIMEOUT'
        for _ in range(100):
            if group_empty(group):break
            time.sleep(.02)
        final=receipt(False,exit_code)
        if not final['job_empty']:final['failure']='OWNED_GROUP_NOT_EMPTY'
        if final['job_empty']:
            try:remove_empty_group(group)
            except Exception:final['failure']='OWNED_GROUP_CLEANUP_TIMEOUT';final['profile_deleted']=False
        write_json(root/'host-receipt.json',final)
    for fd in fds:
        if kind=='program':os.close(fd)
sys.exit(exit_code)
