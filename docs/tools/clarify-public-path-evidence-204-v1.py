"""Keep the observed public-path limitation explicit in unexecuted guides."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2]
p=R/'docs/tools/update-integrated-readmes-204-v1.py';s=p.read_text('utf-8-sig')
s=s.replace('Original generic failure/lease root causes and default public HTTP/2 remain unproven;', 'Original generic failure/lease root causes, default public HTTP/2 and normal DNS-address failover remain unproven; QA alone selects another current public address without changing server networking;')
s=s.replace('原通用错误／租约历史根因及公网默认HTTP/2未因此证明；', '原通用错误／租约历史根因、公网默认HTTP/2及正常DNS地址故障转移未因此证明；仅本机验证选用另一个当前公网地址，服务器网络保持不变；')
s=s.replace('cloud45-second','cloud 45-second').replace('Schema165','Schema 165').replace('retaining22','retaining 22').replace('Retain22','Retain 22').replace('Retain93','Retain 93').replace('final0.7.17','final 0.7.17').replace('Download Desktop0.7.17','Download Desktop 0.7.17')
p.write_text(s,encoding='utf-8',newline='\n')
p=R/'docs/tools/document-integrated-round-204-v1.py';s=p.read_text('utf-8-sig')
s=s.replace('公网默认HTTP/2／开发机直接出口与历史根因仍未证明。', '公网默认HTTP/2、正常DNS地址故障转移、开发机直接出口与历史根因仍未证明；本机QA改用另一个当前公网地址不代表修复了公网路径。')
s=s.replace('Original default publicHTTP2 stalls remain; QAHTTP1 success does not certify direct developer egress.', 'Original default publicHTTP2 and first-address stalls remain; local QAHTTP1/current-DNS address selection does not certify normal DNS failover or direct developer egress.')
s=s.replace('只读，原凭证和DB', '只读，原凭证和DB')
p.write_text(s,encoding='utf-8',newline='\n')
print(json.dumps({'status':'clarified','original_failed_paths_retained':True,'server_network_changes':False}))
