"""Create application-only activation/collection for the final backend correction."""
from pathlib import Path
import ast
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts'
s=(scripts/'activate-integrated-202-v3.sh').read_text('utf8')
s=s.replace("root=Path('/opt/workmate/overlays/integrated-202-v1')","root=Path('/opt/workmate/overlays/integrated-202-v2')")
s=s.replace("previous=Path('/opt/workmate/overlays/integrated-201-v1/backend')","previous=Path('/opt/workmate/overlays/integrated-202-v1/backend')")
s=s.replace('integrated-202/activation-v2','integrated-202/activation-v3').replace("'z'*41+'-integrated-202-v1.conf'","'z'*42+'-integrated-202-v2.conf'").replace('workmate-candidate-integrated-202-v1.service','workmate-candidate-integrated-202-v2.service')
a=s.index(' # Preserve the existing Nginx root paths');b=s.index(' assert proxy.read_bytes()==proxy_before',a);s=s[:a]+" # Backend-only correction; existing static directories/symlinks stay untouched.\n"+s[b:]
s=s.replace("'web_root':str(root/'web/dist')","'web_root':str((root/'web/dist').resolve())").replace("'admin_root':str(root/'admin/dist')","'admin_root':str((root/'admin/dist').resolve())").replace("'static_rollback_suffix':'dist.before-integrated-202-v1'","'static_directory_swaps':False")
ast.parse(s.split("<<'WM_ACTIVATE_200_V1'",1)[1].split('WM_ACTIVATE_200_V1',1)[0]);assert 'proxy.write' not in s and "'reload','workmate-lan-proxy.service'" not in s
(scripts/'activate-integrated-202-v4.sh').write_text(s,encoding='utf8',newline='\n')
s=(scripts/'collect-integrated-202-v2.sh').read_text('utf8').replace("Path('/opt/workmate/overlays/integrated-202-v1')","Path('/opt/workmate/overlays/integrated-202-v2')").replace("cfg/'activation-v2/deployment.sanitized.json'","cfg/'activation-v3/deployment.sanitized.json'")
(scripts/'collect-integrated-202-v3.sh').write_text(s,encoding='utf8',newline='\n')
print('Application-only final backend activation prepared; no remote operation performed.')
