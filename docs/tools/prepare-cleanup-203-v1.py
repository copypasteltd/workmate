from pathlib import Path
R=Path(__file__).resolve().parents[2];S=R/'dev/copypaste-delivery/scripts';text=(S/'collect-runtime-cleanup-202-v1.ps1').read_text('utf-8').replace('acceptance-202','acceptance-203').replace('owned-native-db-202-v1','owned-native-db-203-v1').replace('company-qa-tunnel-202-v1','company-qa-tunnel-203-v1').replace('deployment-202-v2','deployment-203-v1').replace('stage=202','stage=203')
out=S/'collect-runtime-cleanup-203-v1.ps1';assert not out.exists();out.write_text(text,encoding='utf-8',newline='\n')
