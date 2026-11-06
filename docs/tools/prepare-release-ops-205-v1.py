from pathlib import Path
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery'
for old,new in [('upload-downloads-204-v1.py','upload-downloads-205-v1.py'),('activate-downloads-204-v1.sh','activate-downloads-205-v1.sh'),('qualify-inner-downloads-204-v1.py','qualify-inner-downloads-205-v1.py'),('finalize-release-metadata-204-v1.mjs','finalize-release-metadata-205-v1.mjs')]:
 s=(L/'scripts'/old).read_text('utf-8').replace('deployment-204-v1','deployment-205-v1').replace('integrated-204-v11','integrated-205-v1').replace('downloads-204-v1','downloads-205-v1').replace('integrated-204/','integrated-205/').replace('20401','20501').replace('0.7.17','0.7.18').replace("'stage':204","'stage':205").replace('stage:204','stage:205')
 (L/'scripts'/new).write_text(s,'utf-8')
network=(L/'scripts/verify-network-preserved-204-v1.sh').read_text('utf-8').replace("'stage':204","'stage':205").replace('integrated-204/network-preserved-v1.json','integrated-205/network-preserved-v1.json')
(L/'scripts/verify-network-preserved-205-v1.sh').write_text(network,'utf-8')
print('Fresh release/checksum/download and read-only network observer scripts prepared; no networking actions executed.')
