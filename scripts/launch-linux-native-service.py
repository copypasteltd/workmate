#!/usr/bin/python3
"""Run the controller in its own leaf under systemd Delegate=yes as its user."""
import os
from pathlib import Path
import re
import sys

assert sys.platform=='linux' and os.getuid()!=0
entries=Path('/proc/self/cgroup').read_text().splitlines()
relative=next(line[3:] for line in entries if line.startswith('0::'))
assert re.fullmatch(r'/system.slice/workmate-(?:api|candidate-[a-z0-9-]+|native-qualification-[a-z0-9-]+)\.service',relative)
root=Path('/sys/fs/cgroup'+relative)
assert root.resolve()==root
controller=root/'controller';controller.mkdir(exist_ok=True)
(controller/'cgroup.procs').write_text(str(os.getpid()))
(root/'cgroup.subtree_control').write_text('+cpu +memory +pids')
groups=root/'executions';groups.mkdir(exist_ok=True)
(groups/'cgroup.subtree_control').write_text('+cpu +memory +pids')
os.environ['COPYPASTE_NATIVE_CGROUP_ROOT']=str(groups)
assert len(sys.argv)>=2 and Path(sys.argv[1]).is_absolute()
os.execv(sys.argv[1],sys.argv[1:])
