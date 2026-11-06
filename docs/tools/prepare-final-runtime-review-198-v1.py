from pathlib import Path
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts'
old=(scripts/'cleanup-owned-runtime-197-v1.ps1').read_text(encoding='utf8')
new=old.replace('197','198').replace('postgres-alMKmM','postgres-Aj3Gvs').replace('24568','5836').replace('24456','31092').replace('23644','33040').replace("'.data\\deployment-198\\runtime-cleanup-v1.sanitized.json'","'.data\\deployment-198-v1\\runtime-cleanup-v1.sanitized.json'")
p=scripts/'cleanup-owned-runtime-198-v1.ps1';assert not p.exists();p.write_text(new,encoding='utf8',newline='\n')
old=(scripts/'inspect-owned-native-tasks-197-v1.sh').read_text(encoding='utf8')
new=old.replace('197','198')
start=new.index('const ids=');end=new.index('\ntry{',start)
new=new[:start]+"const ids=['50753841-921c-4437-a9f3-69835e8f92c6'];"+new[end:]
p=scripts/'inspect-owned-native-tasks-198-v1.sh';assert not p.exists();p.write_text(new,encoding='utf8',newline='\n')
print('prepared ownership-bound native cleanup and read-only exact task accounting')
