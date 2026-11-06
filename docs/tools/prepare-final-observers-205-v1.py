from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery'
def fresh(p,s):
 assert not p.exists(),p;p.write_text(s,'utf-8')
s=(L/'scripts/collect-final-service-state-204-v1.sh').read_text('utf-8').replace('overlays/integrated-204-v2','overlays/integrated-205-v1').replace("==165","==166").replace("'stage':204","'stage':205").replace('qualified204','qualified205').replace('integrated-204/final-service-state','integrated-205/final-service-state')
fresh(L/'scripts/collect-final-service-state-205-v1.sh',s)
s=(L/'scripts/collect-runtime-cleanup-204-v1.ps1').read_text('utf-8').replace('acceptance-204','acceptance-205').replace('transport-v2/','transport-v1/').replace('owned-native-db-204-v1','owned-native-db-205-v1').replace('company-qa-tunnel-204-v[12]','company-qa-tunnel-205-v1').replace('deployment-204-v2','deployment-205-v1').replace('stage=204','stage=205')
start=s.index('$originalTransport =');end=s.index('$processes =',start);s=s[:start]+s[end:]
s=s.replace('@($transport.owner_pid,$originalTransport.owner_pid)','@($transport.owner_pid)').replace('([uri]$transport.proxy).Port,([uri]$originalTransport.proxy).Port,55432','([uri]$transport.proxy).Port,55432')
fresh(L/'scripts/collect-runtime-cleanup-205-v1.ps1',s)
print(json.dumps({'status':'prepared','server_network_mutations':False,'observer_kills_processes':False}))
