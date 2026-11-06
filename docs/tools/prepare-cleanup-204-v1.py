from pathlib import Path
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts'
text=(S/'collect-runtime-cleanup-203-v1.ps1').read_text('utf-8').replace('acceptance-203','acceptance-204').replace('owned-native-db-203-v1','owned-native-db-204-v1').replace('company-qa-tunnel-203-v1','company-qa-tunnel-204-v1').replace('deployment-203-v1','deployment-204-v2').replace('stage=203','stage=204')
with (S/'collect-runtime-cleanup-204-v1.ps1').open('x',encoding='utf-8',newline='\n') as f:f.write(text)
print('Prepared exact-owner read-only cleanup collector; no processes changed.')
